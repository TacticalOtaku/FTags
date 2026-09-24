import {
  BULK_CONCURRENCY,
  MAX_TAG_COUNT,
  MODULE_ID,
  SCHEMA_VERSION,
  SUPPORTED_DOCUMENT_TYPES,
  TYPE_LOCALIZATION_KEYS
} from "../constants.js";
import {
  TagValidationError,
  createTagId,
  mergeDictionaries,
  normalizeSpotlightFilterState,
  normalizeTagColor,
  normalizeTagName,
  sanitizeTagIds,
  sortTags,
  tagNameKey,
  validateDictionaryPayload,
  validateTagDraft
} from "./model.js";
import {buildSpotlightIndex, searchSpotlightIndexWithTotal} from "./search.js";
import {getAutomaticTags, getAutomaticTagLibrary} from "./automatic-tags.js";
import {getPresetTags, isPresetInstance} from "./presets.js";

export class TagService {
  constructor(repository) {
    this.repository = repository;
  }

  listTags() {
    return this.repository.getDictionary().tags;
  }

  listSearchTags() {
    return [...this.listTags(), ...getAutomaticTagLibrary()];
  }

  async applyPreset(id) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    let created = 0;
    for (const {aliases, baseId, ...tag} of getPresetTags(id)) {
      const aliasKeys = new Set(aliases.map(tagNameKey));
      if (dictionary.tags.some(existing => (
        isPresetInstance(existing.id, baseId) || aliasKeys.has(tagNameKey(existing.name))
      ))) continue;
      const suffix = createTagId().replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
      dictionary.tags.push(validateTagDraft({...tag, id: `${baseId}-${suffix}`}, dictionary.tags));
      created++;
    }
    if (dictionary.tags.length > MAX_TAG_COUNT) throw new TagValidationError("too-many-tags", {max: MAX_TAG_COUNT});
    if (created) await this.repository.setDictionary(dictionary);
    return {created};
  }

  getTag(tagId) {
    return this.listTags().find((tag) => tag.id === tagId) ?? null;
  }

  async createTag({name, color, shape}) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    if (dictionary.tags.length >= MAX_TAG_COUNT) {
      throw new TagValidationError("too-many-tags", {max: MAX_TAG_COUNT});
    }
    const tag = validateTagDraft({id: createTagId(), name, color, shape}, dictionary.tags);
    dictionary.tags = sortTags([...dictionary.tags, tag]);
    await this.repository.setDictionary(dictionary);
    return tag;
  }

  async updateTag(tagId, {name, color, shape}) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    const index = dictionary.tags.findIndex((tag) => tag.id === tagId);
    if (index < 0) throw new Error("Unknown FTags tag");
    const updated = validateTagDraft(
      {id: tagId, name: normalizeTagName(name), color: normalizeTagColor(color), shape: shape ?? dictionary.tags[index].shape},
      dictionary.tags,
      tagId
    );
    dictionary.tags[index] = updated;
    dictionary.tags = sortTags(dictionary.tags);
    await this.repository.setDictionary(dictionary);
    return updated;
  }

  async deleteTag(tagId) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    const tag = dictionary.tags.find((candidate) => candidate.id === tagId);
    if (!tag) return {tag: null, deleted: false, cleaned: 0, failed: 0, errors: [], lockedPacks: []};

    const carriesTag = (document) => this.repository.getTagIds(document).includes(tagId);
    const targets = this.repository.getAllTaggableObjects().filter(carriesTag);
    const lockedPacks = [];
    const loadErrors = [];

    await this.repository.prepareCompendiumIndexes?.();
    for (const pack of this.repository.getCompendiumPacks()) {
      const folders = [...(pack.folders ?? [])].filter(carriesTag);
      const ids = [...(pack.index ?? [])].filter(carriesTag).map((entry) => entry._id);
      if (!folders.length && !ids.length) continue;
      if (pack.locked) {
        lockedPacks.push(pack.title ?? pack.collection);
        continue;
      }
      targets.push(...folders);
      if (!ids.length) continue;
      try {
        targets.push(...await pack.getDocuments({_id__in: ids}));
      } catch (error) {
        loadErrors.push({item: pack.collection, error});
      }
    }

    // A document that cannot even be loaded would keep the id, so it aborts like a failed write.
    if (loadErrors.length) {
      return {tag, deleted: false, cleaned: 0, failed: loadErrors.length, errors: loadErrors, lockedPacks};
    }

    const result = await runWithConcurrency(targets, BULK_CONCURRENCY, async (document) => {
      const next = this.repository.getTagIds(document).filter((id) => id !== tagId);
      await this.repository.setTagIds(document, next);
    });
    if (result.failed) return {...result, tag, deleted: false, cleaned: result.success, lockedPacks};

    dictionary.tags = dictionary.tags.filter((candidate) => candidate.id !== tagId);
    await this.repository.setDictionary(dictionary);
    await this.repository.cleanSpotlightFilters?.(new Set(this.listSearchTags().map((candidate) => candidate.id)));
    return {tag, deleted: true, cleaned: result.success, failed: 0, errors: [], lockedPacks};
  }

  getAssignments(document) {
    const valid = new Set(this.listTags().map((tag) => tag.id));
    return sanitizeTagIds(this.repository.getTagIds(document), valid);
  }

  async assignTags(document, tagIds) {
    this.repository.assertGM();
    const valid = new Set(this.listTags().map((tag) => tag.id));
    const clean = sanitizeTagIds(tagIds, valid);
    await this.repository.setTagIds(document, clean);
    return clean;
  }

  getFolderDocumentCount(folder) {
    return this.repository.getFolderDocuments(folder).length;
  }

  /**
   * Load every document in a folder tree. Compendium documents are fetched in one request, and
   * any failure surfaces before a single write happens.
   */
  async resolveFolderContents(folder) {
    this.repository.assertGM();
    const documents = this.repository.getFolderDocuments(folder);
    if (!folder?.pack) return documents;
    this.repository.assertPackUnlocked(folder.pack);
    const pack = this.repository.getPack(folder.pack);
    const ids = documents.map((entry) => entry._id ?? entry.id).filter(Boolean);
    if (!pack || !ids.length) return [];
    return pack.getDocuments({_id__in: ids});
  }

  async applyTagsToDocuments(documents, tagIds) {
    this.repository.assertGM();
    const valid = new Set(this.listTags().map((tag) => tag.id));
    const additions = sanitizeTagIds(tagIds, valid);
    if (!additions.length) return {success: 0, failed: 0, errors: []};

    const eligible = documents.filter((document) => {
      const current = new Set(this.repository.getTagIds(document));
      return additions.some((tagId) => !current.has(tagId));
    });

    return runWithConcurrency(eligible, BULK_CONCURRENCY, async (document) => {
      const next = sanitizeTagIds([...this.repository.getTagIds(document), ...additions], valid);
      await this.repository.setTagIds(document, next);
    });
  }

  async applyTagsToFolderContents(folder, tagIds) {
    return this.applyTagsToDocuments(await this.resolveFolderContents(folder), tagIds);
  }

  buildSpotlightIndex() {
    const tagsById = new Map(this.listTags().map((tag) => [tag.id, tag]));
    const validIds = new Set(tagsById.keys());
    const records = [];

    // World documents and folders
    for (const document of this.repository.getAllTaggableObjects()) {
      const tags = sanitizeTagIds(this.repository.getTagIds(document), validIds)
        .map((tagId) => tagsById.get(tagId)).concat(getAutomaticTags(document));
      if (!tags.length) continue;
      const isFolder = document.documentName === "Folder";
      records.push({
        uuid: document.uuid,
        name: document.name,
        document,
        documentName: document.documentName,
        typeLabel: localizeType(document.documentName),
        entityType: isFolder ? document.type : document.documentName,
        isFolder,
        isCompendium: false,
        path: getDocumentPath(document),
        tags
      });
    }

    // Compendium packs
    for (const pack of this.repository.getCompendiumPacks()) {
      // Folders inside pack
      for (const folder of pack.folders ?? []) {
        if (!SUPPORTED_DOCUMENT_TYPES.includes(folder.type)) continue;
        const tags = sanitizeTagIds(this.repository.getTagIds(folder), validIds)
          .map((tagId) => tagsById.get(tagId));
        if (!tags.length) continue;
        const folderPath = getCompendiumFolderPath(pack, folder.folder?.id ?? folder.folder);
        records.push({
          uuid: folder.uuid,
          name: folder.name,
          document: folder,
          documentName: "Folder",
          typeLabel: localizeType("Folder"),
          entityType: folder.type,
          isFolder: true,
          isCompendium: true,
          path: [pack.title, folderPath].filter(Boolean).join(" / "),
          tags
        });
      }

      // Documents indexed in pack
      if (pack.index) {
        for (const entry of pack.index) {
          const rawTags = this.repository.getTagIds(entry);
          const tags = sanitizeTagIds(rawTags, validIds).map((tagId) => tagsById.get(tagId))
            .concat(getAutomaticTags(entry, {documentName: pack.documentName}));
          if (!tags.length) continue;
          const entryFolder = entry.folder ? pack.folders?.get?.(entry.folder) : null;
          const folderPath = entryFolder ? getCompendiumFolderPath(pack, entryFolder.id) : "";
          records.push({
            uuid: entry.uuid ?? (entry._id ? `Compendium.${pack.collection}.${entry._id}` : null),
            name: entry.name,
            document: null,
            documentName: pack.documentName,
            typeLabel: localizeType(pack.documentName),
            entityType: pack.documentName,
            isFolder: false,
            isCompendium: true,
            path: [pack.title, folderPath].filter(Boolean).join(" / "),
            tags
          });
        }
      }
    }

    return buildSpotlightIndex(records);
  }

  /** @returns {{records: object[], total: number}} */
  searchSpotlight(index, query, options) {
    return searchSpotlightIndexWithTotal(index, query, options);
  }

  /** Current filters limited to existing tags. Reading never writes; cleanup happens on change. */
  readSpotlightFilters() {
    return this.normalizeSpotlightFilters(this.repository.getSpotlightFilterState());
  }

  normalizeSpotlightFilters(state) {
    return normalizeSpotlightFilterState(state, new Set(this.listSearchTags().map((tag) => tag.id)));
  }

  async setSpotlightFilters(state) {
    this.repository.assertGM();
    const valid = new Set(this.listSearchTags().map((tag) => tag.id));
    const cleaned = normalizeSpotlightFilterState(state, valid);
    await this.repository.setSpotlightFilterState(cleaned);
    return cleaned;
  }

  exportDictionary() {
    const dictionary = this.repository.getDictionary();
    return JSON.stringify({
      module: MODULE_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      tags: dictionary.tags
    }, null, 2);
  }

  previewImport(raw) {
    const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
    validateDictionaryPayload(payload);
    return mergeDictionaries(this.repository.getDictionary(), payload);
  }

  async importDictionary(raw) {
    this.repository.assertGM();
    const preview = this.previewImport(raw);
    await this.repository.setDictionary(preview.dictionary);
    await this.repository.cleanSpotlightFilters?.(new Set(this.listSearchTags().map((tag) => tag.id)));
    return preview;
  }
}

function getCompendiumFolderPath(pack, folderId) {
  if (!folderId || !pack.folders) return "";
  const folder = pack.folders.get(folderId);
  if (!folder) return "";
  const ancestors = [];
  let current = folder;
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ancestors.unshift(current.name);
    current = current.folder ? pack.folders.get(current.folder.id ?? current.folder) : null;
  }
  return ancestors.join(" / ");
}

function localizeType(documentName) {
  const key = TYPE_LOCALIZATION_KEYS[documentName];
  return key ? game.i18n.localize(key) : String(documentName ?? "");
}

function getDocumentPath(document) {
  if (document.documentName === "Folder") {
    return [...(document.ancestors ?? [])].reverse().map((folder) => folder.name).join(" / ");
  }
  if (!document.folder) return "";
  return [...(document.folder.ancestors ?? [])]
    .reverse()
    .concat(document.folder)
    .map((folder) => folder.name)
    .join(" / ");
}

export async function runWithConcurrency(items, concurrency, operation) {
  const queue = [...items];
  const errors = [];
  let success = 0;
  const workers = Array.from({length: Math.min(Math.max(concurrency, 1), queue.length || 1)}, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await operation(item);
        success += 1;
      } catch (error) {
        errors.push({item, error});
      }
    }
  });
  await Promise.all(workers);
  return {success, failed: errors.length, errors};
}

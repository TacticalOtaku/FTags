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
  collectSubfolderIds,
  createTagId,
  mergeDictionaries,
  normalizeSpotlightFilterState,
  normalizeTagColor,
  normalizeTagName,
  sanitizeTagIds,
  sortTags,
  validateDictionaryPayload,
  validateTagDraft
} from "./model.js";
import {buildSpotlightIndex, searchSpotlightIndex} from "./search.js";
import {getAutomaticTags, getAutomaticTagLibrary} from "./automatic-tags.js";
import {getPresetTags} from "./presets.js";

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
    for (const {aliases, ...tag} of getPresetTags(id)) {
      if (dictionary.tags.some(existing => existing.id === tag.id || aliases.some(name => (
        existing.name.localeCompare(name, undefined, {sensitivity: "base"}) === 0
      )))) continue;
      dictionary.tags.push(validateTagDraft(tag, dictionary.tags));
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
    if (!tag) return {tag: null, deleted: false, cleaned: 0, failed: 0, errors: []};

    const targets = this.repository.getAllTaggableObjects().filter((document) => (
      this.repository.getTagIds(document).includes(tagId)
    ));

    for (const pack of this.repository.getCompendiumPacks()) {
      if (pack.locked) continue;
      for (const folder of pack.folders ?? []) {
        if (this.repository.getTagIds(folder).includes(tagId)) {
          targets.push(folder);
        }
      }
      if (pack.index) {
        for (const entry of pack.index) {
          const rawTags = this.repository.getTagIds(entry);
          if (rawTags.includes(tagId)) {
            try {
              const doc = await pack.getDocument(entry._id);
              if (doc) targets.push(doc);
            } catch (error) {
              console.warn(`FTags: Could not load document ${entry._id} from pack ${pack.collection}`, error);
            }
          }
        }
      }
    }

    const result = await runWithConcurrency(targets, BULK_CONCURRENCY, async (document) => {
      const next = this.repository.getTagIds(document).filter((id) => id !== tagId);
      await this.repository.setTagIds(document, next);
    });
    if (result.failed) return {...result, tag, deleted: false, cleaned: result.success};

    dictionary.tags = dictionary.tags.filter((candidate) => candidate.id !== tagId);
    await this.repository.setDictionary(dictionary);
    await this.repository.cleanSpotlightFilters?.(new Set(this.listSearchTags().map((candidate) => candidate.id)));
    return {tag, deleted: true, cleaned: result.success, failed: 0, errors: []};
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

  async applyTagsToFolderContents(folder, tagIds) {
    this.repository.assertGM();
    if (folder.pack && game.packs?.get(folder.pack)?.locked) {
      const error = new Error("locked-compendium");
      error.code = "locked-compendium";
      throw error;
    }

    const valid = new Set(this.listTags().map((tag) => tag.id));
    const additions = sanitizeTagIds(tagIds, valid);
    if (!additions.length) return {success: 0, failed: 0, errors: []};

    let targets = this.repository.getFolderDocuments(folder);
    if (folder.pack && (!targets.length || !targets[0]?.setFlag)) {
      const pack = game.packs?.get(folder.pack);
      if (pack) {
        const folderIds = new Set([folder.id, ...collectSubfolderIds(folder)]);
        const entries = (pack.index ?? []).filter((e) => folderIds.has(e.folder));
        targets = (await Promise.all(entries.map((e) => pack.getDocument(e._id)))).filter(Boolean);
      }
    }

    const eligible = targets.filter((document) => {
      const current = new Set(this.repository.getTagIds(document));
      return additions.some((tagId) => !current.has(tagId));
    });

    return runWithConcurrency(eligible, BULK_CONCURRENCY, async (document) => {
      const next = sanitizeTagIds([...this.repository.getTagIds(document), ...additions], valid);
      await this.repository.setTagIds(document, next);
    });
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

  searchSpotlight(index, query, options) {
    return searchSpotlightIndex(index, query, options);
  }

  async getSpotlightFilters() {
    const valid = new Set(this.listSearchTags().map((tag) => tag.id));
    const current = this.repository.getSpotlightFilterState();
    const cleaned = normalizeSpotlightFilterState(current, valid);
    if (JSON.stringify(current) !== JSON.stringify(cleaned)) {
      await this.repository.setSpotlightFilterState(cleaned);
    }
    return cleaned;
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

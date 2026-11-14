import {
  BULK_CONCURRENCY,
  MODULE_ID,
  SUPPORTED_DOCUMENT_TYPES,
  TYPE_LOCALIZATION_KEYS,
} from "../constants.js";
import {
  TagValidationError,
  applyDictionaryPreset,
  coerceDictionary,
  createDictionaryTag,
  emptyDictionary,
  exportDictionary,
  listPresets,
  planDictionaryImport,
  removeDictionaryTag,
  sanitizeTagIds,
  updateDictionaryTag,
} from "../core/dictionary.js";
import { log } from "../core/logger.js";
import {
  defaultSpotlightFilterState,
  getAutomaticIndexFields,
  getAutomaticTagLibrary,
  getSpotlightWatchedFields,
  normalizeSpotlightFilterState,
  pruneSpotlightFilters,
} from "../core/spotlight.js";

/**
 * Stateful application boundary orchestrating the FTags tag dictionary, world and compendium
 * assignments, folder propagation, index preparation, and Spotlight projection over a
 * `FoundryWorldPort` adapter.
 */
export class TagWorkspace {
  #pendingPackIndexes = new Map();
  #preparedPacks = new Set();

  constructor(adapter) {
    if (!adapter) throw new Error("TagWorkspace requires a world adapter");
    this.adapter = adapter;
  }

  isGM() {
    return Boolean(this.adapter.isGM());
  }

  assertGM() {
    if (!this.isGM()) throw makeCodedError("gm-only");
  }

  getSystemId() {
    return this.adapter.getSystemId();
  }

  getLanguage() {
    return this.adapter.getLanguage();
  }

  getWorldId() {
    return this.adapter.getWorldId();
  }

  localize(key) {
    return this.adapter.localize(key);
  }

  format(key, data = {}) {
    return this.adapter.format(key, data);
  }

  iconForType(documentType) {
    return this.adapter.iconForType(documentType);
  }

  getTypeLabels() {
    return Object.fromEntries(
      Object.entries(TYPE_LOCALIZATION_KEYS).map(([documentType, key]) => [documentType, this.localize(key)]),
    );
  }

  getWatchedFields() {
    return getSpotlightWatchedFields(this.getSystemId());
  }

  getPackIndexFields(documentName) {
    return [`flags.${MODULE_ID}`, "folder", ...getAutomaticIndexFields(documentName, this.getSystemId())];
  }

  configureCompendiumIndexFields() {
    for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
      this.adapter.addCompendiumIndexFields(documentName, this.getPackIndexFields(documentName));
    }
  }

  registerSettings({ managerType, onSettingChange } = {}) {
    this.adapter.registerSettings({
      managerType,
      dictionaryDefault: emptyDictionary(),
      spotlightFiltersDefault: defaultSpotlightFilterState(),
      onSettingChange,
    });
  }

  invalidateCompendiumCache(packId = null) {
    if (packId) this.#preparedPacks.delete(packId);
    else this.#preparedPacks.clear();
  }

  getDictionary() {
    return coerceDictionary(this.adapter.getDictionaryRaw());
  }

  listTags() {
    return this.getDictionary().tags;
  }

  getTag(tagId) {
    return this.listTags().find((tag) => tag.id === tagId) ?? null;
  }

  listPresets() {
    return listPresets({ language: this.getLanguage() });
  }

  listSearchTags() {
    return [
      ...this.listTags(),
      ...getAutomaticTagLibrary({ systemId: this.getSystemId(), language: this.getLanguage() }),
    ];
  }

  getValidSearchTagIds() {
    return new Set(this.listSearchTags().map((tag) => tag.id));
  }

  async createTag({ name, color, shape } = {}) {
    this.assertGM();
    const { dictionary, tag } = createDictionaryTag(this.getDictionary(), { name, color, shape });
    await this.adapter.setDictionaryRaw(dictionary);
    return tag;
  }

  async updateTag(tagId, { name, color, shape } = {}) {
    this.assertGM();
    const { dictionary, tag } = updateDictionaryTag(this.getDictionary(), tagId, { name, color, shape });
    await this.adapter.setDictionaryRaw(dictionary);
    return tag;
  }

  async applyPreset(presetId) {
    this.assertGM();
    const { dictionary, created } = applyDictionaryPreset(this.getDictionary(), presetId, {
      language: this.getLanguage(),
    });
    if (created) await this.adapter.setDictionaryRaw(dictionary);
    return { created };
  }

  exportDictionary() {
    return exportDictionary(this.getDictionary());
  }

  previewImport(raw) {
    return planDictionaryImport(this.getDictionary(), raw);
  }

  async commitImport(plannedOrRaw) {
    this.assertGM();
    const plan =
      plannedOrRaw && typeof plannedOrRaw === "object" && plannedOrRaw.dictionary && plannedOrRaw.summary
        ? plannedOrRaw
        : this.previewImport(plannedOrRaw);
    await this.adapter.setDictionaryRaw(coerceDictionary(plan.dictionary));
    await this.cleanStaleSpotlightFilters();
    return plan;
  }

  async deleteTag(tagId) {
    this.assertGM();
    const dictionary = this.getDictionary();
    const tag = dictionary.tags.find((candidate) => candidate.id === tagId) ?? null;
    if (!tag) return { tag: null, deleted: false, cleaned: 0, failed: 0, errors: [], indexFailures: [] };

    const cleanupJobs = [];
    for (const target of this.#getAllWorldTaggableObjects()) {
      if (this.getRawTagIds(target).includes(tagId)) {
        cleanupJobs.push({ kind: "direct", target });
      }
    }

    // Only unlocked compendiums can be modified; do not force index downloads for locked packs.
    const indexFailures = await this.prepareCompendiumIndexes({ unlockedOnly: true });

    for (const pack of this.adapter.listCompendiumPacks()) {
      if (pack.locked) continue;
      for (const folder of iterableValues(pack.folders)) {
        if (this.getRawTagIds(folder).includes(tagId)) {
          cleanupJobs.push({ kind: "direct", target: folder });
        }
      }
      for (const entry of iterableValues(pack.index)) {
        if (this.getRawTagIds(entry).includes(tagId)) {
          const entryId = entry._id ?? entry.id;
          if (entryId) cleanupJobs.push({ kind: "compendium-doc", pack, entryId });
        }
      }
    }

    const result = await runWithConcurrency(cleanupJobs, BULK_CONCURRENCY, async (job) => {
      if (job.kind === "direct") {
        await this.#removeTagFromTarget(job.target, tagId);
        return;
      }
      const doc = await this.adapter.loadPackDocument(job.pack, job.entryId);
      if (!doc) throw new Error(`Missing document ${job.entryId} in pack ${job.pack.collection}`);
      await this.#removeTagFromTarget(doc, tagId);
    });

    if (result.failed) {
      return { ...result, tag, deleted: false, cleaned: result.success, indexFailures };
    }

    const { dictionary: updatedDictionary } = removeDictionaryTag(this.getDictionary(), tagId);
    await this.adapter.setDictionaryRaw(updatedDictionary);
    await this.cleanStaleSpotlightFilters();
    return { tag, deleted: true, cleaned: result.success, failed: 0, errors: [], indexFailures };
  }

  isTaggable(target) {
    if (target?.documentName === "Folder") return SUPPORTED_DOCUMENT_TYPES.includes(target.type);
    return SUPPORTED_DOCUMENT_TYPES.includes(target?.documentName);
  }

  getRawTagIds(target) {
    return sanitizeTagIds(this.adapter.getTagIdsRaw(target));
  }

  getAssignments(target) {
    const valid = new Set(this.listTags().map((tag) => tag.id));
    return sanitizeTagIds(this.adapter.getTagIdsRaw(target), valid);
  }

  getAssignedTags(target, tagsById = null) {
    const map = tagsById ?? new Map(this.listTags().map((tag) => [tag.id, tag]));
    const assigned = [];
    for (const tagId of this.getRawTagIds(target)) {
      const tag = map.get(tagId);
      if (tag) assigned.push(tag);
    }
    return assigned;
  }

  async assignTags(target, tagIds) {
    this.assertGM();
    if (!target || !this.isTaggable(target)) {
      throw new Error("Unsupported FTags document");
    }
    this.#assertPackUnlocked(target.pack);

    const valid = new Set(this.listTags().map((tag) => tag.id));
    const clean = sanitizeTagIds(tagIds, valid);
    const current = this.getRawTagIds(target);
    if (arraysEqual(current, clean)) return clean;
    await this.adapter.writeTagIds(target, clean);
    return clean;
  }

  getFolderDocuments(folder) {
    if (!folder || folder.documentName !== "Folder" || !SUPPORTED_DOCUMENT_TYPES.includes(folder.type)) {
      return [];
    }
    if (folder.pack) {
      const pack = this.adapter.getPack(folder.pack);
      if (!pack || !SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName)) return [];
      return this.#collectCompendiumFolderEntries(folder, pack);
    }
    return collectFolderDocuments(folder).filter((document) => this.isTaggable(document));
  }

  getFolderDocumentCount(folder) {
    return this.getFolderDocuments(folder).length;
  }

  async getAssignmentContext(target) {
    const isFolder = target?.documentName === "Folder";
    const pack = target?.pack ? this.adapter.getPack(target.pack) : null;
    if (isFolder && pack && pack.indexed === false) {
      await this.ensurePackIndexed(pack).catch((error) => {
        log.warn(`Could not index ${pack.collection} for folder count`, error);
      });
    }
    const assigned = new Set(this.getAssignments(target));
    const tags = this.listTags().map((tag) => ({ ...tag, assigned: assigned.has(tag.id) }));
    const folderContentCount = isFolder ? this.getFolderDocumentCount(target) : 0;
    return {
      targetName: target?.name ?? "",
      tags,
      hasTags: Boolean(tags.length),
      hasNoTags: !tags.length,
      isFolder,
      folderContentCount,
      hasNoFolderContents: folderContentCount === 0,
      isLocked: Boolean(pack?.locked),
      packTitle: pack?.title ?? "",
    };
  }

  async propagateTagsToFolder(folder, tagIds) {
    this.assertGM();
    if (!folder || folder.documentName !== "Folder" || !SUPPORTED_DOCUMENT_TYPES.includes(folder.type)) {
      throw new Error("Unsupported FTags folder");
    }
    this.#assertPackUnlocked(folder.pack);

    const valid = new Set(this.listTags().map((tag) => tag.id));
    const additions = sanitizeTagIds(tagIds, valid);
    if (!additions.length) return { success: 0, failed: 0, errors: [] };

    if (folder.pack) {
      const pack = this.adapter.getPack(folder.pack);
      if (!pack) return { success: 0, failed: 0, errors: [] };

      await this.ensurePackIndexed(pack);
      const entries = this.#collectCompendiumFolderEntries(folder, pack);
      const candidates = entries.filter((entry) => {
        const current = new Set(this.getRawTagIds(entry));
        return additions.some((tagId) => !current.has(tagId));
      });

      return runWithConcurrency(candidates, BULK_CONCURRENCY, async (entry) => {
        const entryId = entry._id ?? entry.id;
        const doc =
          typeof entry.setFlag === "function" ? entry : await this.adapter.loadPackDocument(pack, entryId);
        if (!doc) throw new Error(`Missing document ${entryId} in pack ${pack.collection}`);
        await this.#addTagsToDocument(doc, additions, valid);
      });
    }

    const targets = collectFolderDocuments(folder).filter((document) => this.isTaggable(document));
    const eligible = targets.filter((document) => {
      const current = new Set(this.getRawTagIds(document));
      return additions.some((tagId) => !current.has(tagId));
    });
    return runWithConcurrency(eligible, BULK_CONCURRENCY, async (document) => {
      await this.#addTagsToDocument(document, additions, valid);
    });
  }

  async ensurePackIndexed(packOrId) {
    const pack = typeof packOrId === "string" ? this.adapter.getPack(packOrId) : packOrId;
    if (!pack || !SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName)) return;
    const key = pack.collection ?? pack.metadata?.id ?? pack.id;
    if (key && this.#pendingPackIndexes.has(key)) {
      return this.#pendingPackIndexes.get(key);
    }
    if (key && this.#preparedPacks.has(key) && pack.indexed !== false) {
      return;
    }

    const fields = this.getPackIndexFields(pack.documentName);
    const promise = (async () => {
      try {
        await this.adapter.ensurePackIndex(pack, fields);
        if (key) this.#preparedPacks.add(key);
      } finally {
        if (key) this.#pendingPackIndexes.delete(key);
      }
    })();

    if (key) this.#pendingPackIndexes.set(key, promise);
    return promise;
  }

  async prepareCompendiumIndexes({ unlockedOnly = false } = {}) {
    this.assertGM();
    const queue = this.adapter.listCompendiumPacks().filter((pack) => !unlockedOnly || !pack.locked);
    const failures = [];
    const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
      while (queue.length) {
        const pack = queue.shift();
        try {
          await this.ensurePackIndexed(pack);
        } catch (error) {
          failures.push(pack.title ?? pack.collection);
          log.warn(`Could not index ${pack.collection}`, error);
        }
      }
    });
    await Promise.all(workers);
    return failures;
  }

  getSpotlightDataset() {
    const manualTags = this.listTags();
    const systemId = this.getSystemId();
    const language = this.getLanguage();
    const typeLabels = this.getTypeLabels();
    const records = [];

    for (const document of this.#getAllWorldTaggableObjects()) {
      const isFolder = document.documentName === "Folder";
      records.push({
        uuid: document.uuid,
        name: document.name,
        document,
        automaticSource: document,
        documentName: document.documentName,
        entityType: isFolder ? document.type : document.documentName,
        isFolder,
        isCompendium: false,
        path: formatWorldPath(document),
        tagIds: this.getRawTagIds(document),
      });
    }

    for (const pack of this.adapter.listCompendiumPacks()) {
      for (const folder of iterableValues(pack.folders)) {
        if (!SUPPORTED_DOCUMENT_TYPES.includes(folder.type)) continue;
        records.push({
          uuid: folder.uuid,
          name: folder.name,
          document: folder,
          automaticSource: null,
          documentName: "Folder",
          entityType: folder.type,
          isFolder: true,
          isCompendium: true,
          path: formatCompendiumPath(pack, extractFolderId(folder.folder)),
          tagIds: this.getRawTagIds(folder),
        });
      }

      for (const entry of iterableValues(pack.index)) {
        const entryId = entry._id ?? entry.id;
        records.push({
          uuid: entry.uuid ?? (entryId ? `Compendium.${pack.collection}.${entryId}` : null),
          name: entry.name,
          document: null,
          automaticSource: entry,
          documentName: pack.documentName,
          entityType: pack.documentName,
          isFolder: false,
          isCompendium: true,
          path: formatCompendiumPath(pack, extractFolderId(entry.folder)),
          tagIds: this.getRawTagIds(entry),
        });
      }
    }

    return { manualTags, systemId, language, typeLabels, records };
  }

  getSpotlightFilters() {
    const { filters } = pruneSpotlightFilters(
      this.adapter.getSpotlightFiltersRaw(),
      this.getValidSearchTagIds(),
    );
    return filters;
  }

  async cleanStaleSpotlightFilters() {
    this.assertGM();
    const { filters, changed } = pruneSpotlightFilters(
      this.adapter.getSpotlightFiltersRaw(),
      this.getValidSearchTagIds(),
    );
    if (changed) await this.adapter.setSpotlightFiltersRaw(filters);
    return filters;
  }

  async saveSpotlightFilters(state) {
    this.assertGM();
    const cleaned = normalizeSpotlightFilterState(state, this.getValidSearchTagIds());
    await this.adapter.setSpotlightFiltersRaw(cleaned);
    return cleaned;
  }

  getWorldCollection(documentName) {
    return this.adapter.getWorldCollection(documentName);
  }

  listCompendiumPacks(documentName = null) {
    return this.adapter.listCompendiumPacks(documentName);
  }

  resolveFolder(folderId, options = {}) {
    return this.adapter.resolveFolder(folderId, options);
  }

  getDirectoryRenderTargets() {
    return this.adapter.getDirectoryRenderTargets();
  }

  async openTarget(record, options = {}) {
    return this.adapter.openTarget(record, options);
  }

  #assertPackUnlocked(packId) {
    if (packId && this.adapter.isPackLocked(packId)) {
      throw makeCodedError("locked-compendium");
    }
  }

  async #removeTagFromTarget(target, tagId) {
    this.#assertPackUnlocked(target.pack);
    const current = this.getRawTagIds(target);
    const next = current.filter((id) => id !== tagId);
    if (arraysEqual(current, next)) return;
    await this.adapter.writeTagIds(target, next);
  }

  async #addTagsToDocument(document, additions, valid) {
    this.#assertPackUnlocked(document.pack);
    const current = this.getRawTagIds(document);
    const currentSet = new Set(current);
    if (additions.every((tagId) => currentSet.has(tagId))) return;
    const next = sanitizeTagIds([...current, ...additions], valid);
    await this.adapter.writeTagIds(document, next);
  }

  #getAllWorldTaggableObjects() {
    return [
      ...SUPPORTED_DOCUMENT_TYPES.flatMap((documentName) => this.adapter.listWorldDocuments(documentName)),
      ...this.adapter.listWorldFolders(),
    ];
  }

  #collectCompendiumFolderEntries(folder, pack) {
    const folderIds = new Set([folder.id, ...collectSubfolderIds(folder)]);
    const indexedEntries = [];
    for (const entry of iterableValues(pack.index)) {
      if (folderIds.has(extractFolderId(entry.folder))) indexedEntries.push(entry);
    }
    return indexedEntries.length ? indexedEntries : collectFolderDocuments(folder);
  }
}

function iterableValues(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (Array.isArray(collection.contents)) return collection.contents;
  if (typeof collection.values === "function") return collection.values();
  return collection;
}

export async function runWithConcurrency(items, concurrency, operation) {
  const queue = [...items];
  const errors = [];
  let success = 0;
  const workerCount = Math.min(Math.max(concurrency, 1), queue.length || 1);
  const workers = Array.from({ length: workerCount }, async () => {
    while (queue.length) {
      const item = queue.shift();
      try {
        await operation(item);
        success += 1;
      } catch (error) {
        errors.push({ item, error });
      }
    }
  });
  await Promise.all(workers);
  return { success, failed: errors.length, errors };
}

function getChildFolders(folder) {
  const direct = folder?.getSubfolders?.(false);
  if (Array.isArray(direct) && direct.length) return direct;
  return (folder?.children ?? [])
    .map((child) => child?.folder ?? child)
    .filter((child) => child?.documentName === "Folder");
}

function collectSubfolderIds(folder, visited = new Set()) {
  const ids = [];
  for (const child of getChildFolders(folder)) {
    if (!child?.id || visited.has(child.id)) continue;
    visited.add(child.id);
    ids.push(child.id, ...collectSubfolderIds(child, visited));
  }
  return ids;
}

function collectFolderDocuments(folder) {
  const documents = [];
  const visitedFolders = new Set();
  const visitedDocuments = new Set();

  const visit = (current) => {
    if (!current || visitedFolders.has(current.id)) return;
    visitedFolders.add(current.id);
    for (const document of current.contents ?? []) {
      const id = document?.id ?? document?._id;
      if (!id || visitedDocuments.has(document.uuid ?? id)) continue;
      visitedDocuments.add(document.uuid ?? id);
      documents.push(document);
    }
    for (const child of getChildFolders(current)) visit(child);
  };

  visit(folder);
  return documents;
}

function formatWorldPath(document) {
  if (document.documentName === "Folder") {
    return [...(document.ancestors ?? [])]
      .reverse()
      .map((folder) => folder.name)
      .join(" / ");
  }
  if (!document.folder) return "";
  return [...(document.folder.ancestors ?? [])]
    .reverse()
    .concat(document.folder)
    .map((folder) => folder.name)
    .join(" / ");
}

function formatCompendiumPath(pack, folderId) {
  if (!folderId || !pack.folders) return pack.title ?? "";
  const ancestors = [];
  let current = pack.folders.get(folderId);
  const visited = new Set();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    ancestors.unshift(current.name);
    const parentId = extractFolderId(current.folder);
    current = parentId ? pack.folders.get(parentId) : null;
  }
  return [pack.title, ancestors.join(" / ")].filter(Boolean).join(" / ");
}

function extractFolderId(folderRef) {
  if (!folderRef) return null;
  return typeof folderRef === "object" ? (folderRef.id ?? folderRef._id ?? null) : folderRef;
}

function makeCodedError(code) {
  if (code === "gm-only" || code === "locked-compendium") {
    return new TagValidationError(code);
  }
  const error = new Error(code);
  error.code = code;
  return error;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

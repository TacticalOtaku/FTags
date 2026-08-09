import {BULK_CONCURRENCY, MODULE_ID, SCHEMA_VERSION} from "../constants.js";
import {
  createTagId,
  mergeDictionaries,
  normalizeTagColor,
  normalizeTagName,
  sanitizeTagIds,
  sortTags,
  validateDictionaryPayload,
  validateTagDraft
} from "./model.js";
import {buildSpotlightIndex, searchSpotlightIndex} from "./search.js";

export class TagService {
  constructor(repository) {
    this.repository = repository;
  }

  listTags() {
    return this.repository.getDictionary().tags;
  }

  getTag(tagId) {
    return this.listTags().find((tag) => tag.id === tagId) ?? null;
  }

  async createTag({name, color}) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    const tag = validateTagDraft({id: createTagId(), name, color}, dictionary.tags);
    dictionary.tags = sortTags([...dictionary.tags, tag]);
    await this.repository.setDictionary(dictionary);
    return tag;
  }

  async updateTag(tagId, {name, color}) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    const index = dictionary.tags.findIndex((tag) => tag.id === tagId);
    if (index < 0) throw new Error("Unknown FTags tag");
    const updated = validateTagDraft(
      {id: tagId, name: normalizeTagName(name), color: normalizeTagColor(color)},
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
    const result = await runWithConcurrency(targets, BULK_CONCURRENCY, async (document) => {
      const next = this.repository.getTagIds(document).filter((id) => id !== tagId);
      await this.repository.setTagIds(document, next);
    });
    if (result.failed) return {...result, tag, deleted: false, cleaned: result.success};

    dictionary.tags = dictionary.tags.filter((candidate) => candidate.id !== tagId);
    await this.repository.setDictionary(dictionary);
    await this.repository.cleanSavedFilters(new Set(dictionary.tags.map((candidate) => candidate.id)));
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
    const valid = new Set(this.listTags().map((tag) => tag.id));
    const additions = sanitizeTagIds(tagIds, valid);
    if (!additions.length) return {success: 0, failed: 0, errors: []};

    const targets = this.repository.getFolderDocuments(folder).filter((document) => {
      const current = new Set(this.repository.getTagIds(document));
      return additions.some((tagId) => !current.has(tagId));
    });

    return runWithConcurrency(targets, BULK_CONCURRENCY, async (document) => {
      const next = sanitizeTagIds([...this.repository.getTagIds(document), ...additions], valid);
      await this.repository.setTagIds(document, next);
    });
  }

  async getActiveFilters(documentName) {
    const dictionary = this.repository.getDictionary();
    const valid = new Set(dictionary.tags.map((tag) => tag.id));
    const current = this.repository.getSavedFilter(documentName);
    const cleaned = sanitizeTagIds(current, valid);
    if (!arraysEqual(current, cleaned)) await this.repository.setSavedFilter(documentName, cleaned);
    return new Set(cleaned);
  }

  async toggleFilter(documentName, tagId) {
    this.repository.assertGM();
    const dictionary = this.repository.getDictionary();
    const valid = new Set(dictionary.tags.map((tag) => tag.id));
    if (!valid.has(tagId)) return this.getActiveFilters(documentName);
    const active = await this.getActiveFilters(documentName);
    if (active.has(tagId)) active.delete(tagId);
    else active.add(tagId);
    await this.repository.setSavedFilter(documentName, [...active]);
    return active;
  }

  async clearFilters(documentName) {
    this.repository.assertGM();
    await this.repository.setSavedFilter(documentName, []);
    return new Set();
  }

  buildSpotlightIndex() {
    const tagsById = new Map(this.listTags().map((tag) => [tag.id, tag]));
    const records = this.repository.getAllTaggableObjects().map((document) => {
      const tags = sanitizeTagIds(this.repository.getTagIds(document), new Set(tagsById.keys()))
        .map((tagId) => tagsById.get(tagId));
      const isFolder = document.documentName === "Folder";
      return {
        uuid: document.uuid,
        name: document.name,
        document,
        documentName: document.documentName,
        entityType: isFolder ? document.type : document.documentName,
        isFolder,
        path: getDocumentPath(document),
        tags
      };
    });
    return buildSpotlightIndex(records);
  }

  searchSpotlight(index, query, options) {
    return searchSpotlightIndex(index, query, options);
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
    await this.repository.cleanSavedFilters(new Set(preview.dictionary.tags.map((tag) => tag.id)));
    return preview;
  }
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

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

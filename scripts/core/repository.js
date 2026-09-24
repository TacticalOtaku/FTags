import {
  COLLECTION_PROPERTY_BY_DOCUMENT,
  FLAGS,
  MODULE_ID,
  SETTINGS,
  SUPPORTED_DOCUMENT_TYPES
} from "../constants.js";
import {
  coerceDictionary,
  collectFolderDocuments,
  defaultSpotlightFilterState,
  emptyDictionary,
  normalizeSpotlightFilterState,
  sanitizeTagIds
} from "./model.js";
import {getAutomaticIndexFields} from "./automatic-tags.js";

export class TagRepository {
  #dictionaryCache = null;
  #dictionaryRevision = 0;

  /** Increases whenever the dictionary may have changed; windows compare it to skip redundant renders. */
  get dictionaryRevision() {
    return this.#dictionaryRevision;
  }

  #invalidateDictionary() {
    this.#dictionaryCache = null;
    this.#dictionaryRevision += 1;
  }

  async prepareCompendiumIndexes() {
    this.assertGM();
    // Share an in-flight read between simultaneous Spotlight renders.
    if (this.indexPreparation) return this.indexPreparation;
    this.indexPreparation = this.#loadCompendiumIndexes();
    try { return await this.indexPreparation; }
    finally { this.indexPreparation = null; }
  }

  async #loadCompendiumIndexes() {
    const queue = this.getCompendiumPacks();
    const failures = [];
    const workers = Array.from({length: Math.min(4, queue.length)}, async () => {
      while (queue.length) {
        const pack = queue.shift();
        try {
          await pack.getIndex({fields: [`flags.${MODULE_ID}`, "folder", ...getAutomaticIndexFields(pack.documentName)]});
        } catch (error) {
          failures.push(pack.title ?? pack.collection);
          console.warn(`FTags: Could not index ${pack.collection}`, error);
        }
      }
    });
    await Promise.all(workers);
    return failures;
  }

  registerSettings({managerType, onDataChange} = {}) {
    game.settings.register(MODULE_ID, SETTINGS.DICTIONARY, {
      name: "FTAGS.Settings.DictionaryName",
      hint: "FTAGS.Settings.DictionaryHint",
      scope: "world",
      config: false,
      type: Object,
      default: emptyDictionary(),
      onChange: () => {
        this.#invalidateDictionary();
        onDataChange?.("dictionary");
      }
    });

    game.settings.register(MODULE_ID, SETTINGS.SPOTLIGHT_FILTERS, {
      name: "FTAGS.Settings.SpotlightFiltersName",
      hint: "FTAGS.Settings.SpotlightFiltersHint",
      scope: "user",
      config: false,
      type: Object,
      default: defaultSpotlightFilterState(),
      onChange: () => onDataChange?.("spotlight-filters")
    });

    if (managerType) {
      game.settings.registerMenu(MODULE_ID, SETTINGS.MANAGER, {
        name: "FTAGS.Settings.ManagerName",
        label: "FTAGS.Settings.ManagerLabel",
        hint: "FTAGS.Settings.ManagerHint",
        icon: "fa-solid fa-tags",
        type: managerType,
        restricted: true
      });
    }
  }

  /**
   * The normalized dictionary is cached until the setting changes; directory rendering and
   * Spotlight read it many times per render. Callers receive their own tag array to mutate.
   */
  getDictionary() {
    if (!this.#dictionaryCache) {
      const dictionary = coerceDictionary(game.settings.get(MODULE_ID, SETTINGS.DICTIONARY));
      dictionary.tags.forEach((tag) => Object.freeze(tag));
      this.#dictionaryCache = dictionary;
    }
    return {...this.#dictionaryCache, tags: [...this.#dictionaryCache.tags]};
  }

  async setDictionary(dictionary) {
    this.assertGM();
    try {
      return await game.settings.set(MODULE_ID, SETTINGS.DICTIONARY, coerceDictionary(dictionary));
    } finally {
      this.#invalidateDictionary();
    }
  }

  getTagIds(document) {
    return sanitizeTagIds(
      document?.getFlag?.(MODULE_ID, FLAGS.TAG_IDS)
      ?? foundry.utils.getProperty(document, `flags.${MODULE_ID}.${FLAGS.TAG_IDS}`)
    );
  }

  async setTagIds(document, tagIds) {
    this.assertGM();
    if (!document || !this.isTaggable(document)) {
      throw new Error("Unsupported FTags document");
    }

    if (document.pack) this.assertPackUnlocked(document.pack);

    const clean = sanitizeTagIds(tagIds);
    const current = this.getTagIds(document);
    if (arraysEqual(current, clean)) return document;
    if (!clean.length) return document.unsetFlag(MODULE_ID, FLAGS.TAG_IDS);
    return document.setFlag(MODULE_ID, FLAGS.TAG_IDS, clean);
  }

  /**
   * Compendium indexes only merge keys they already hold, so an entry indexed before its first
   * tag was assigned would keep reporting no tags. Copy the indexed fields from the source data.
   */
  syncCompendiumIndexEntry(document) {
    if (!document?.pack || !document.id) return;
    const pack = this.getPack(document.pack);
    const entry = pack?.index?.get?.(document.id);
    if (!entry) return;
    const source = document._source ?? document;
    const fields = [`flags.${MODULE_ID}.${FLAGS.TAG_IDS}`, "name", "folder", ...getAutomaticIndexFields(pack.documentName)];
    for (const field of fields) {
      const value = foundry.utils.getProperty(source, field);
      if (value === undefined) {
        const parts = field.split(".");
        const parent = parts.length > 1 ? foundry.utils.getProperty(entry, parts.slice(0, -1).join(".")) : entry;
        if (parent && typeof parent === "object") delete parent[parts.at(-1)];
      } else {
        foundry.utils.setProperty(entry, field, foundry.utils.deepClone(value));
      }
    }
  }

  getPack(packId) {
    return packId ? game.packs?.get(packId) ?? null : null;
  }

  assertPackUnlocked(packId) {
    if (!this.getPack(packId)?.locked) return;
    const error = new Error("locked-compendium");
    error.code = "locked-compendium";
    throw error;
  }

  getSpotlightFilterState() {
    return structuredClone(game.settings.get(MODULE_ID, SETTINGS.SPOTLIGHT_FILTERS));
  }

  async setSpotlightFilterState(state) {
    this.assertGM();
    return game.settings.set(
      MODULE_ID,
      SETTINGS.SPOTLIGHT_FILTERS,
      normalizeSpotlightFilterState(state)
    );
  }

  async cleanSpotlightFilters(validTagIds) {
    this.assertGM();
    const current = this.getSpotlightFilterState();
    const cleaned = normalizeSpotlightFilterState(current, validTagIds);
    // Compare normalized shapes so key order or legacy extras do not cause a write on every load.
    if (JSON.stringify(normalizeSpotlightFilterState(current)) !== JSON.stringify(cleaned)) {
      await this.setSpotlightFilterState(cleaned);
    }
    return cleaned;
  }

  getWorldCollection(documentName) {
    const property = COLLECTION_PROPERTY_BY_DOCUMENT[documentName];
    return (property ? game[property] : null) ?? game.collections?.get?.(documentName) ?? null;
  }

  getDocuments(documentName) {
    const collection = this.getWorldCollection(documentName);
    return [...(collection?.contents ?? collection ?? [])].filter((document) => !document.pack);
  }

  getFolders(documentName = null) {
    return [...(game.folders?.contents ?? game.folders ?? [])].filter((folder) => (
      !folder.pack
      && SUPPORTED_DOCUMENT_TYPES.includes(folder.type)
      && (!documentName || folder.type === documentName)
    ));
  }

  getCompendiumPacks(documentName = null) {
    return [...(game.packs?.contents ?? game.packs ?? [])].filter((pack) => (
      SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName)
      && (!documentName || pack.documentName === documentName)
    ));
  }

  getAllTaggableObjects() {
    return [
      ...SUPPORTED_DOCUMENT_TYPES.flatMap((documentName) => this.getDocuments(documentName)),
      ...this.getFolders()
    ];
  }

  /**
   * Documents in a folder tree. Compendium folders answer with index entries, read straight from
   * the pack index so the result does not depend on whether the pack window built its tree.
   */
  getFolderDocuments(folder) {
    if (!folder || folder.documentName !== "Folder" || !SUPPORTED_DOCUMENT_TYPES.includes(folder.type)) return [];
    if (folder.pack) {
      const pack = this.getPack(folder.pack);
      if (!pack || !SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName)) return [];
      const folderIds = new Set([folder.id, ...getPackSubfolderIds(pack, folder.id)]);
      return [...(pack.index ?? [])].filter((entry) => folderIds.has(entry.folder?.id ?? entry.folder));
    }
    return collectFolderDocuments(folder).filter((document) => this.isTaggable(document));
  }

  isTaggable(document) {
    if (document?.documentName === "Folder") return SUPPORTED_DOCUMENT_TYPES.includes(document.type);
    return SUPPORTED_DOCUMENT_TYPES.includes(document?.documentName);
  }

  assertGM() {
    if (!game.user?.isGM) {
      const error = new Error("gm-only");
      error.code = "gm-only";
      throw error;
    }
  }
}

/** Ids of every folder nested below `folderId` in a pack, following parent links. */
export function getPackSubfolderIds(pack, folderId) {
  const folders = [...(pack?.folders ?? [])];
  const parentOf = (folder) => folder?._source?.folder ?? folder?.folder?.id ?? folder?.folder ?? null;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const ids = [];
  for (const folder of folders) {
    if (folder.id === folderId) continue;
    const visited = new Set();
    let parentId = parentOf(folder);
    while (parentId && !visited.has(parentId)) {
      if (parentId === folderId) {
        ids.push(folder.id);
        break;
      }
      visited.add(parentId);
      parentId = parentOf(byId.get(parentId));
    }
  }
  return ids;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

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

export class TagRepository {
  registerSettings({managerType, onDataChange} = {}) {
    game.settings.register(MODULE_ID, SETTINGS.DICTIONARY, {
      name: "FTAGS.Settings.DictionaryName",
      hint: "FTAGS.Settings.DictionaryHint",
      scope: "world",
      config: false,
      type: Object,
      default: emptyDictionary(),
      onChange: () => onDataChange?.("dictionary")
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

  getDictionary() {
    return coerceDictionary(game.settings.get(MODULE_ID, SETTINGS.DICTIONARY));
  }

  async setDictionary(dictionary) {
    this.assertGM();
    return game.settings.set(MODULE_ID, SETTINGS.DICTIONARY, coerceDictionary(dictionary));
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

    if (document.pack) {
      const pack = game.packs?.get(document.pack);
      if (pack?.locked) {
        const error = new Error("locked-compendium");
        error.code = "locked-compendium";
        throw error;
      }
    }

    const clean = sanitizeTagIds(tagIds);
    const current = this.getTagIds(document);
    if (arraysEqual(current, clean)) return document;
    if (!clean.length) return document.unsetFlag(MODULE_ID, FLAGS.TAG_IDS);
    return document.setFlag(MODULE_ID, FLAGS.TAG_IDS, clean);
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
    if (JSON.stringify(current) !== JSON.stringify(cleaned)) {
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

  getFolderDocuments(folder) {
    if (!folder || folder.documentName !== "Folder" || !SUPPORTED_DOCUMENT_TYPES.includes(folder.type)) return [];
    if (folder.pack) {
      // Compendium folders yield index entries, which carry no `documentName` of their own;
      // the owning pack decides whether they are taggable.
      const pack = game.packs?.get(folder.pack);
      if (!pack || !SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName)) return [];
      return collectFolderDocuments(folder);
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

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

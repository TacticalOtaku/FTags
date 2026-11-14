import { FLAGS, MODULE_ID, SETTINGS, SUPPORTED_DOCUMENT_TYPES } from "../constants.js";

const COLLECTION_PROPERTY_BY_DOCUMENT = Object.freeze({
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal",
  RollTable: "tables",
  Cards: "cards",
  Playlist: "playlists",
  Macro: "macros",
});

/**
 * Narrow production adapter isolating Foundry VTT globals (`game`, `ui`, `CONFIG`,
 * `foundry.utils`, `fromUuid`) from `TagWorkspace`.
 */
export function createFoundryAdapter() {
  return {
    isGM() {
      return Boolean(game.user?.isGM);
    },

    getSystemId() {
      return String(game.system?.id ?? "");
    },

    getLanguage() {
      return String(game.i18n?.lang ?? "en");
    },

    getWorldId() {
      return String(game.world?.id ?? "world");
    },

    localize(key) {
      return game.i18n?.localize?.(key) ?? String(key);
    },

    format(key, data = {}) {
      return game.i18n?.format?.(key, data) ?? String(key);
    },

    iconForType(documentType) {
      return CONFIG?.[documentType]?.sidebarIcon ?? "fa-solid fa-file";
    },

    addCompendiumIndexFields(documentName, fields) {
      const config = CONFIG?.[documentName];
      if (!config) return;
      for (const field of fields) {
        if (Array.isArray(config.compendiumIndexFields)) {
          if (!config.compendiumIndexFields.includes(field)) {
            config.compendiumIndexFields.push(field);
          }
        } else if (config.compendiumIndexFields instanceof Set) {
          config.compendiumIndexFields.add(field);
        } else {
          config.compendiumIndexFields = [field];
        }
      }
    },

    registerSettings({ managerType, dictionaryDefault, spotlightFiltersDefault, onSettingChange } = {}) {
      game.settings.register(MODULE_ID, SETTINGS.DICTIONARY, {
        name: "FTAGS.Settings.DictionaryName",
        hint: "FTAGS.Settings.DictionaryHint",
        scope: "world",
        config: false,
        type: Object,
        default: dictionaryDefault,
        onChange: (value) => onSettingChange?.("dictionary", value),
      });

      game.settings.register(MODULE_ID, SETTINGS.SPOTLIGHT_FILTERS, {
        name: "FTAGS.Settings.SpotlightFiltersName",
        hint: "FTAGS.Settings.SpotlightFiltersHint",
        scope: "user",
        config: false,
        type: Object,
        default: spotlightFiltersDefault,
        onChange: (value) => onSettingChange?.("spotlight-filters", value),
      });

      if (managerType) {
        game.settings.registerMenu(MODULE_ID, SETTINGS.MANAGER, {
          name: "FTAGS.Settings.ManagerName",
          label: "FTAGS.Settings.ManagerLabel",
          hint: "FTAGS.Settings.ManagerHint",
          icon: "fa-solid fa-tags",
          type: managerType,
          restricted: true,
        });
      }
    },

    getDictionaryRaw() {
      return game.settings.get(MODULE_ID, SETTINGS.DICTIONARY);
    },

    async setDictionaryRaw(dictionary) {
      return game.settings.set(MODULE_ID, SETTINGS.DICTIONARY, dictionary);
    },

    getSpotlightFiltersRaw() {
      return structuredClone(game.settings.get(MODULE_ID, SETTINGS.SPOTLIGHT_FILTERS));
    },

    async setSpotlightFiltersRaw(state) {
      return game.settings.set(MODULE_ID, SETTINGS.SPOTLIGHT_FILTERS, state);
    },

    getTagIdsRaw(target) {
      return (
        target?.getFlag?.(MODULE_ID, FLAGS.TAG_IDS) ??
        foundry.utils.getProperty(target, `flags.${MODULE_ID}.${FLAGS.TAG_IDS}`)
      );
    },

    async writeTagIds(target, cleanTagIds) {
      if (!cleanTagIds.length) return target.unsetFlag(MODULE_ID, FLAGS.TAG_IDS);
      return target.setFlag(MODULE_ID, FLAGS.TAG_IDS, cleanTagIds);
    },

    getWorldCollection(documentName) {
      const property = COLLECTION_PROPERTY_BY_DOCUMENT[documentName];
      return (property ? game[property] : null) ?? game.collections?.get?.(documentName) ?? null;
    },

    listWorldDocuments(documentName) {
      const collection = this.getWorldCollection(documentName);
      return [...(collection?.contents ?? collection ?? [])].filter((document) => !document.pack);
    },

    listWorldFolders(documentName = null) {
      return [...(game.folders?.contents ?? game.folders ?? [])].filter(
        (folder) =>
          !folder.pack &&
          SUPPORTED_DOCUMENT_TYPES.includes(folder.type) &&
          (!documentName || folder.type === documentName),
      );
    },

    listCompendiumPacks(documentName = null) {
      return [...(game.packs?.contents ?? game.packs ?? [])].filter(
        (pack) =>
          SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName) &&
          (!documentName || pack.documentName === documentName),
      );
    },

    getPack(packId) {
      return packId ? (game.packs?.get?.(packId) ?? null) : null;
    },

    isPackLocked(packId) {
      return Boolean(packId && game.packs?.get?.(packId)?.locked);
    },

    async ensurePackIndex(pack, fields) {
      if (typeof pack?.getIndex === "function") {
        return pack.getIndex({ fields });
      }
      return pack?.index ?? [];
    },

    async loadPackDocument(pack, entryId) {
      return pack.getDocument(entryId);
    },

    resolveFolder(folderId, { preferredCollection = null, documentName = null } = {}) {
      if (!folderId) return null;
      const matchesType = (folder) => Boolean(folder && (!documentName || folder.type === documentName));

      const preferred = preferredCollection?.folders?.get?.(folderId);
      if (matchesType(preferred)) return preferred;

      const worldFolder = game.folders?.get?.(folderId);
      if (matchesType(worldFolder)) return worldFolder;

      for (const pack of game.packs ?? []) {
        const packFolder = pack.folders?.get?.(folderId);
        if (matchesType(packFolder)) return packFolder;
      }
      return null;
    },

    getDirectoryRenderTargets() {
      const targets = [];
      for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
        const collection = this.getWorldCollection(documentName);
        if (collection) targets.push(collection);
      }
      if (globalThis.ui?.compendium) targets.push(globalThis.ui.compendium);
      for (const pack of this.listCompendiumPacks()) {
        const apps =
          pack.apps instanceof Map
            ? pack.apps.values()
            : Array.isArray(pack.apps)
              ? pack.apps
              : Object.values(pack.apps ?? {});
        for (const app of apps) {
          if (app?.rendered) targets.push(app);
        }
      }
      return targets;
    },

    async openTarget(record, { onBeforeOpen } = {}) {
      if (!record) return false;
      let document = record.document ?? null;
      if (!document && record.uuid) {
        document = await fromUuid(record.uuid);
      }
      if (!document) return false;
      await onBeforeOpen?.(document);
      document.sheet?.render(true);
      return true;
    },
  };
}

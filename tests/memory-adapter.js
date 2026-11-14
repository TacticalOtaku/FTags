import { FLAGS, MODULE_ID, SETTINGS, SUPPORTED_DOCUMENT_TYPES } from "../scripts/constants.js";

/**
 * In-memory `FoundryWorldPort` implementation for plain-Node verification of `TagWorkspace`
 * and `DirectoryIntegration` without Foundry VTT runtime globals.
 */
export function createMemoryAdapter(options = {}) {
  const state = {
    isGM: options.isGM ?? true,
    systemId: options.systemId ?? "dnd5e",
    language: options.language ?? "ru",
    worldId: options.worldId ?? "test-world",
    dictionary: options.dictionary !== undefined ? structuredClone(options.dictionary) : undefined,
    spotlightFilters:
      options.spotlightFilters !== undefined ? structuredClone(options.spotlightFilters) : undefined,
    worldDocs: new Map(SUPPORTED_DOCUMENT_TYPES.map((type) => [type, []])),
    worldFolders: [],
    packs: new Map(),
    indexFieldsByType: new Map(),
    renderTargets: new Map(),
    compendiumDirectory: options.compendiumDirectory ?? null,
    onSettingChange: null,
    openedRecords: [],
    indexCalls: [],
    loadCalls: [],
    writeCalls: [],
    failIndexPacks: new Set(options.failIndexPacks ?? []),
    failLoadIds: new Set(options.failLoadIds ?? []),
    failWriteIds: new Set(options.failWriteIds ?? []),
  };

  function makeDocument(spec) {
    const doc = {
      id: spec.id,
      _id: spec._id ?? spec.id,
      uuid:
        spec.uuid ?? (spec.pack ? `Compendium.${spec.pack}.${spec.id}` : `${spec.documentName}.${spec.id}`),
      name: spec.name ?? spec.id,
      documentName: spec.documentName,
      type: spec.type,
      pack: spec.pack ?? null,
      folder: spec.folder ?? null,
      ancestors: spec.ancestors ?? [],
      system: spec.system ? structuredClone(spec.system) : undefined,
      flags: structuredClone(spec.flags ?? {}),
      sheet: spec.sheet ?? {
        renderedWith: 0,
        render() {
          this.renderedWith += 1;
        },
      },
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async setFlag(scope, key, value) {
        if (state.failWriteIds.has(this.id) || state.failWriteIds.has(this.uuid)) {
          throw new Error(`write failed for ${this.uuid}`);
        }
        this.flags[scope] ??= {};
        this.flags[scope][key] = structuredClone(value);
        syncCompendiumIndexEntry(this);
        return this;
      },
      async unsetFlag(scope, key) {
        if (state.failWriteIds.has(this.id) || state.failWriteIds.has(this.uuid)) {
          throw new Error(`unset failed for ${this.uuid}`);
        }
        if (this.flags?.[scope]) {
          delete this.flags[scope][key];
          if (!Object.keys(this.flags[scope]).length) delete this.flags[scope];
        }
        syncCompendiumIndexEntry(this);
        return this;
      },
    };
    return doc;
  }

  function makeFolder(spec) {
    const folder = {
      id: spec.id,
      uuid: spec.uuid ?? (spec.pack ? `Compendium.${spec.pack}.Folder.${spec.id}` : `Folder.${spec.id}`),
      name: spec.name ?? spec.id,
      documentName: "Folder",
      type: spec.type,
      pack: spec.pack ?? null,
      folder: spec.folder ?? null,
      ancestors: spec.ancestors ?? [],
      contents: spec.contents ?? [],
      children: spec.children ?? [],
      getSubfolders: spec.getSubfolders,
      flags: structuredClone(spec.flags ?? {}),
      getFlag(scope, key) {
        return this.flags?.[scope]?.[key];
      },
      async setFlag(scope, key, value) {
        if (state.failWriteIds.has(this.id) || state.failWriteIds.has(this.uuid)) {
          throw new Error(`write failed for ${this.uuid}`);
        }
        this.flags[scope] ??= {};
        this.flags[scope][key] = structuredClone(value);
        return this;
      },
      async unsetFlag(scope, key) {
        if (state.failWriteIds.has(this.id) || state.failWriteIds.has(this.uuid)) {
          throw new Error(`unset failed for ${this.uuid}`);
        }
        if (this.flags?.[scope]) {
          delete this.flags[scope][key];
          if (!Object.keys(this.flags[scope]).length) delete this.flags[scope];
        }
        return this;
      },
    };
    return folder;
  }

  function makePack(spec) {
    const docs = new Map();
    for (const rawDoc of spec.documents ?? []) {
      const doc = rawDoc.setFlag
        ? rawDoc
        : makeDocument({ ...rawDoc, documentName: spec.documentName, pack: spec.collection });
      docs.set(doc.id, doc);
    }

    const folderMap = new Map();
    for (const rawFolder of spec.folders ?? []) {
      const folder = rawFolder.setFlag
        ? rawFolder
        : makeFolder({ ...rawFolder, type: spec.documentName, pack: spec.collection });
      folderMap.set(folder.id, folder);
    }

    const indexMap = new Map();
    if (spec.index) {
      for (const entry of spec.index) {
        indexMap.set(entry._id ?? entry.id, structuredClone(entry));
      }
    } else if (spec.indexed !== false) {
      for (const doc of docs.values()) {
        indexMap.set(doc.id, projectIndexEntry(doc));
      }
    }

    const pack = {
      collection: spec.collection,
      title: spec.title ?? spec.collection,
      documentName: spec.documentName,
      locked: Boolean(spec.locked),
      indexed: spec.indexed ?? true,
      folders: folderMap,
      documents: docs,
      index: indexMap,
      apps: spec.apps ?? [],
      get(id) {
        return spec.exposeLoadedInGet ? docs.get(id) : undefined;
      },
      async getIndex({ fields = [] } = {}) {
        state.indexCalls.push({ collection: this.collection, fields: [...fields] });
        if (state.failIndexPacks.has(this.collection)) {
          throw new Error(`index failed for ${this.collection}`);
        }
        this.indexed = true;
        this.index.clear();
        for (const doc of this.documents.values()) {
          this.index.set(doc.id, projectIndexEntry(doc, fields));
        }
        return this.index;
      },
      async getDocument(id) {
        state.loadCalls.push({ collection: this.collection, id });
        if (state.failLoadIds.has(id) || state.failLoadIds.has(`${this.collection}.${id}`)) {
          throw new Error(`load failed for ${this.collection}.${id}`);
        }
        return this.documents.get(id) ?? null;
      },
    };
    return pack;
  }

  function projectIndexEntry(doc, fields = null) {
    const entry = {
      _id: doc.id,
      id: doc.id,
      uuid: doc.uuid,
      name: doc.name,
      folder: typeof doc.folder === "object" ? doc.folder?.id : doc.folder,
      type: doc.type,
    };
    if (!fields || fields.includes(`flags.${MODULE_ID}`)) {
      entry.flags = structuredClone(doc.flags ?? {});
    }
    if (!fields || fields.some((field) => field.startsWith("system."))) {
      if (doc.system !== undefined) entry.system = structuredClone(doc.system);
    }
    return entry;
  }

  function syncCompendiumIndexEntry(doc) {
    if (!doc.pack) return;
    const pack = state.packs.get(doc.pack);
    if (!pack || !pack.indexed) return;
    const existing = pack.index.get(doc.id);
    if (!existing) return;
    existing.flags = structuredClone(doc.flags ?? {});
  }

  function addWorldDocument(spec) {
    const doc = spec.setFlag ? spec : makeDocument(spec);
    if (!state.worldDocs.has(doc.documentName)) state.worldDocs.set(doc.documentName, []);
    state.worldDocs.get(doc.documentName).push(doc);
    return doc;
  }

  function addWorldFolder(spec) {
    const folder = spec.setFlag ? spec : makeFolder(spec);
    state.worldFolders.push(folder);
    return folder;
  }

  function addPack(spec) {
    const pack = makePack(spec);
    state.packs.set(pack.collection, pack);
    return pack;
  }

  for (const doc of options.worldDocs ?? []) addWorldDocument(doc);
  for (const folder of options.worldFolders ?? []) addWorldFolder(folder);
  for (const pack of options.packs ?? []) addPack(pack);

  const adapter = {
    state,
    addWorldDocument,
    addWorldFolder,
    addPack,
    makeDocument,
    makeFolder,

    isGM() {
      return state.isGM;
    },

    getSystemId() {
      return state.systemId;
    },

    getLanguage() {
      return state.language;
    },

    getWorldId() {
      return state.worldId;
    },

    localize(key) {
      return options.translations?.[key] ?? key;
    },

    format(key, data = {}) {
      let result = options.translations?.[key] ?? key;
      for (const [k, v] of Object.entries(data)) {
        result = result.replaceAll(`{${k}}`, String(v));
      }
      return result;
    },

    iconForType(documentType) {
      return `icon:${documentType}`;
    },

    addCompendiumIndexFields(documentName, fields) {
      if (!state.indexFieldsByType.has(documentName)) state.indexFieldsByType.set(documentName, new Set());
      const set = state.indexFieldsByType.get(documentName);
      for (const field of fields) set.add(field);
    },

    registerSettings({ dictionaryDefault, spotlightFiltersDefault, onSettingChange } = {}) {
      state.onSettingChange = onSettingChange ?? null;
      if (state.dictionary === undefined) state.dictionary = structuredClone(dictionaryDefault);
      if (state.spotlightFilters === undefined) {
        state.spotlightFilters = structuredClone(spotlightFiltersDefault);
      }
    },

    getDictionaryRaw() {
      return structuredClone(state.dictionary);
    },

    async setDictionaryRaw(dictionary) {
      state.dictionary = structuredClone(dictionary);
      state.onSettingChange?.("dictionary", structuredClone(dictionary));
      return state.dictionary;
    },

    getSpotlightFiltersRaw() {
      return structuredClone(state.spotlightFilters);
    },

    async setSpotlightFiltersRaw(filters) {
      state.spotlightFilters = structuredClone(filters);
      state.onSettingChange?.("spotlight-filters", structuredClone(filters));
      return state.spotlightFilters;
    },

    getTagIdsRaw(target) {
      return target?.getFlag?.(MODULE_ID, FLAGS.TAG_IDS) ?? target?.flags?.[MODULE_ID]?.[FLAGS.TAG_IDS];
    },

    async writeTagIds(target, cleanTagIds) {
      state.writeCalls.push({ id: target.id ?? target._id, tagIds: [...cleanTagIds] });
      if (!cleanTagIds.length) return target.unsetFlag(MODULE_ID, FLAGS.TAG_IDS);
      return target.setFlag(MODULE_ID, FLAGS.TAG_IDS, cleanTagIds);
    },

    getWorldCollection(documentName) {
      if (!state.renderTargets.has(documentName)) {
        const docs = state.worldDocs.get(documentName) ?? [];
        state.renderTargets.set(documentName, {
          documentName,
          renderedCalls: [],
          contents: docs,
          folders: {
            get(id) {
              return state.worldFolders.find((f) => f.type === documentName && f.id === id) ?? null;
            },
          },
          get(id) {
            return docs.find((d) => d.id === id) ?? null;
          },
          render(force, optionsArg) {
            this.renderedCalls.push({ force, options: optionsArg });
          },
        });
      }
      return state.renderTargets.get(documentName);
    },

    listWorldDocuments(documentName) {
      return (state.worldDocs.get(documentName) ?? []).filter((doc) => !doc.pack);
    },

    listWorldFolders(documentName = null) {
      return state.worldFolders.filter((f) => !f.pack && (!documentName || f.type === documentName));
    },

    listCompendiumPacks(documentName = null) {
      return [...state.packs.values()].filter(
        (pack) =>
          SUPPORTED_DOCUMENT_TYPES.includes(pack.documentName) &&
          (!documentName || pack.documentName === documentName),
      );
    },

    getPack(packId) {
      return state.packs.get(packId) ?? null;
    },

    isPackLocked(packId) {
      return Boolean(packId && state.packs.get(packId)?.locked);
    },

    async ensurePackIndex(pack, fields) {
      return pack.getIndex({ fields });
    },

    async loadPackDocument(pack, entryId) {
      return pack.getDocument(entryId);
    },

    resolveFolder(folderId, { preferredCollection = null, documentName = null } = {}) {
      if (!folderId) return null;
      const matches = (folder) => Boolean(folder && (!documentName || folder.type === documentName));

      const preferred = preferredCollection?.folders?.get?.(folderId);
      if (matches(preferred)) return preferred;

      const worldFolder = state.worldFolders.find((f) => f.id === folderId);
      if (matches(worldFolder)) return worldFolder;

      for (const pack of state.packs.values()) {
        const packFolder = pack.folders?.get?.(folderId);
        if (matches(packFolder)) return packFolder;
      }
      return null;
    },

    getDirectoryRenderTargets() {
      const targets = SUPPORTED_DOCUMENT_TYPES.map((type) => this.getWorldCollection(type));
      if (state.compendiumDirectory) targets.push(state.compendiumDirectory);
      for (const pack of state.packs.values()) {
        for (const app of pack.apps ?? []) {
          if (app?.rendered) targets.push(app);
        }
      }
      return targets;
    },

    async openTarget(record, { onBeforeOpen } = {}) {
      if (!record) return false;
      state.openedRecords.push(record);
      await onBeforeOpen?.(record.document ?? record);
      record.document?.sheet?.render?.(true);
      return true;
    },
  };

  return adapter;
}

export { SETTINGS };

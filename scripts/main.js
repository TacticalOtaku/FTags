import {MODULE_ID, SUPPORTED_DOCUMENT_TYPES} from "./constants.js";
import {tagRepository, tagService} from "./runtime.js";
import {registerContextMenuHooks} from "./ui/context-menus.js";
import {registerDirectoryHooks, renderSupportedDirectories} from "./ui/directory-enhancer.js";
import {TagAssignmentApp} from "./ui/tag-assignment.js";
import {openTagManager, TagManagerApp} from "./ui/tag-manager.js";
import {notifyError} from "./ui/notifications.js";
import {openSpotlight, registerSpotlightKeybinding, SpotlightApp} from "./ui/spotlight.js";
import {findAppInstances} from "./ui/app-utils.js";
import {getAutomaticIndexFields} from "./core/automatic-tags.js";

Hooks.once("init", () => {
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    const config = CONFIG[documentName];
    if (config) {
      for (const field of [`flags.${MODULE_ID}`, ...getAutomaticIndexFields(documentName)]) {
        if (Array.isArray(config.compendiumIndexFields)) {
          if (!config.compendiumIndexFields.includes(field)) config.compendiumIndexFields.push(field);
        } else if (config.compendiumIndexFields instanceof Set) {
          config.compendiumIndexFields.add(field);
        } else {
          config.compendiumIndexFields = [field];
        }
      }
    }
  }

  tagRepository.registerSettings({
    managerType: TagManagerApp,
    onDataChange: (reason) => {
      if (reason === "spotlight-filters") syncSpotlightFilters();
      else queueRefresh({dictionary: true});
    }
  });
  registerContextMenuHooks();
  registerDirectoryHooks();
  registerDocumentUpdateHooks();
  registerSpotlightKeybinding();

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = Object.freeze({
      openTagManager,
      openSpotlight,
      listTags: () => game.user?.isGM ? tagService.listTags() : [],
      getAssignments: (document) => game.user?.isGM ? tagService.getAssignments(document) : []
    });
  }
});

Hooks.once("ready", async () => {
  if (!game.user?.isGM) return;
  try {
    const valid = new Set(tagService.listSearchTags().map((tag) => tag.id));
    await tagRepository.cleanSpotlightFilters(valid);
    queueRefresh({dictionary: true});
  } catch (error) {
    notifyError(error);
  }
});

/*
 * Refreshes are collected and flushed after a short quiet period. Bulk operations update
 * documents one socket response at a time, so a microtask would still redraw every directory
 * once per document; the maximum wait keeps a steady stream of updates from starving the UI.
 */
const REFRESH_DELAY = 150;
const REFRESH_MAX_WAIT = 1000;
let refreshTimer = null;
let refreshQueuedAt = 0;
let pendingRefresh = emptyRefresh();

function emptyRefresh() {
  return {dictionary: false, spotlightIndex: false, directoryTypes: new Set(), documentUuids: new Set()};
}

function queueRefresh({dictionary = false, spotlightIndex = false, directoryType = null, documentUuid = null} = {}) {
  if (!game.user?.isGM) return;
  pendingRefresh.dictionary ||= dictionary;
  pendingRefresh.spotlightIndex ||= spotlightIndex;
  if (directoryType) pendingRefresh.directoryTypes.add(directoryType);
  if (documentUuid) pendingRefresh.documentUuids.add(documentUuid);

  const now = Date.now();
  if (!refreshTimer) refreshQueuedAt = now;
  clearTimeout(refreshTimer);
  const delay = Math.max(0, Math.min(REFRESH_DELAY, refreshQueuedAt + REFRESH_MAX_WAIT - now));
  refreshTimer = setTimeout(flushRefresh, delay);
}

function flushRefresh() {
  refreshTimer = null;
  const {dictionary, spotlightIndex, directoryTypes, documentUuids} = pendingRefresh;
  pendingRefresh = emptyRefresh();

  if (dictionary) renderSupportedDirectories();
  else if (directoryTypes.size) renderSupportedDirectories(directoryTypes);

  const revision = tagRepository.dictionaryRevision;
  for (const app of findAppInstances(TagManagerApp)) {
    if (app.rendered && dictionary && app.dictionaryRevision !== revision) void app.render();
  }
  for (const app of findAppInstances(TagAssignmentApp)) {
    if (!app.rendered) continue;
    const staleDictionary = dictionary && app.dictionaryRevision !== revision;
    if (staleDictionary || documentUuids.has(app.targetDocument?.uuid)) void app.render();
  }
  if (dictionary || spotlightIndex) {
    for (const app of findAppInstances(SpotlightApp)) {
      if (app.rendered) app.invalidateIndex({dictionary});
    }
  }
}

function syncSpotlightFilters() {
  if (!game.user?.isGM) return;
  for (const app of findAppInstances(SpotlightApp)) app.syncFiltersFromSettings();
}

/** Changes that alter a Spotlight record: its name, location, or a field behind automatic tags. */
function affectsSearch(document, changes) {
  const fields = ["name", "folder", "type", ...getAutomaticIndexFields(document?.documentName)];
  return fields.some((field) => foundry.utils.hasProperty(changes ?? {}, field));
}

function registerDocumentUpdateHooks() {
  const onUpdate = (document, changes) => {
    if (document?.pack) tagRepository.syncCompendiumIndexEntry(document);
    if (!game.user?.isGM) return;
    if (foundry.utils.hasProperty(changes ?? {}, `flags.${MODULE_ID}`)) {
      queueRefresh({
        spotlightIndex: true,
        directoryType: document.documentName === "Folder" ? document.type : document.documentName,
        documentUuid: document.uuid
      });
    } else if (affectsSearch(document, changes)) {
      queueRefresh({spotlightIndex: true});
    }
  };
  const onLifecycle = () => queueRefresh({spotlightIndex: true});

  Hooks.on("updateFolder", onUpdate);
  Hooks.on("createFolder", onLifecycle);
  Hooks.on("deleteFolder", onLifecycle);
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    Hooks.on(`update${documentName}`, onUpdate);
    Hooks.on(`create${documentName}`, onLifecycle);
    Hooks.on(`delete${documentName}`, onLifecycle);
  }
}

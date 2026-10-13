import {MODULE_ID, SUPPORTED_DOCUMENT_TYPES} from "./constants.js";
import {tagRepository, tagService} from "./runtime.js";
import {registerContextMenuHooks} from "./ui/context-menus.js";
import {registerDirectoryHooks, renderSupportedDirectories} from "./ui/directory-enhancer.js";
import {TagAssignmentApp} from "./ui/tag-assignment.js";
import {openTagManager, TagManagerApp} from "./ui/tag-manager.js";
import {notifyError} from "./ui/notifications.js";
import {openSpotlight, registerSpotlightKeybinding, SpotlightApp} from "./ui/spotlight.js";
import {getAutomaticIndexFields} from "./core/automatic-tags.js";
import {setDebugLogging} from "./core/logger.js";

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

  game.settings.register(MODULE_ID, "debug", {
    name: "FTAGS.Settings.DebugName",
    hint: "FTAGS.Settings.DebugHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: setDebugLogging
  });
  setDebugLogging(game.settings.get(MODULE_ID, "debug"));

  tagRepository.registerSettings({
    managerType: TagManagerApp,
    onDataChange: (reason) => {
      if (reason === "spotlight-filters") refreshOpenSpotlights({index: false});
      else scheduleRefresh();
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
    scheduleRefresh();
  } catch (error) {
    notifyError(error);
  }
});

let refreshQueued = false;
function scheduleRefresh() {
  if (!game.user?.isGM || refreshQueued) return;
  refreshQueued = true;
  queueMicrotask(() => {
    refreshQueued = false;
    renderSupportedDirectories();
    refreshOpenApps();
  });
}

function refreshOpenApps() {
  for (const AppClass of [TagManagerApp, TagAssignmentApp, SpotlightApp]) {
    for (const app of AppClass.instances()) {
      if (app.rendered) {
        app.markDirty?.();
        void app.render();
      }
    }
  }
}

function refreshOpenSpotlights(options) {
  if (!game.user?.isGM) return;
  for (const app of SpotlightApp.instances()) {
    if (!app.rendered) continue;
    app.markDirty(options);
    void app.render({parts: ["results"]});
  }
}

function registerDocumentUpdateHooks() {
  // Only the fields the search index reads may invalidate it; a hit point update must not.
  const watched = ["name", "folder", ...new Set(
    SUPPORTED_DOCUMENT_TYPES.flatMap((documentName) => getAutomaticIndexFields(documentName))
  )];
  const callback = (_document, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) scheduleRefresh();
    else if (Object.keys(foundry.utils.flattenObject(changes ?? {})).some((key) => (
      watched.some((field) => key === field || key.startsWith(`${field}.`))
    ))) refreshOpenSpotlights();
  };
  const lifecycleCallback = () => refreshOpenSpotlights();
  Hooks.on("updateCompendium", lifecycleCallback);
  Hooks.on("updateFolder", callback);
  Hooks.on("createFolder", lifecycleCallback);
  Hooks.on("deleteFolder", lifecycleCallback);
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    Hooks.on(`update${documentName}`, callback);
    Hooks.on(`create${documentName}`, lifecycleCallback);
    Hooks.on(`delete${documentName}`, lifecycleCallback);
  }
}

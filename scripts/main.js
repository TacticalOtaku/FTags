import {MODULE_ID, SUPPORTED_DOCUMENT_TYPES} from "./constants.js";
import {tagRepository, tagService} from "./runtime.js";
import {registerContextMenuHooks} from "./ui/context-menus.js";
import {registerDirectoryHooks, renderSupportedDirectories} from "./ui/directory-enhancer.js";
import {TagAssignmentApp} from "./ui/tag-assignment.js";
import {openTagManager, TagManagerApp} from "./ui/tag-manager.js";
import {notifyError} from "./ui/notifications.js";
import {openSpotlight, registerSpotlightKeybinding, SpotlightApp} from "./ui/spotlight.js";

Hooks.once("init", () => {
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    const config = CONFIG[documentName];
    if (config) {
      const field = `flags.${MODULE_ID}`;
      if (Array.isArray(config.compendiumIndexFields)) {
        if (!config.compendiumIndexFields.includes(field)) config.compendiumIndexFields.push(field);
      } else if (config.compendiumIndexFields instanceof Set) {
        config.compendiumIndexFields.add(field);
      } else {
        config.compendiumIndexFields = [field];
      }
    }
  }

  tagRepository.registerSettings({
    managerType: TagManagerApp,
    onDataChange: (reason) => {
      if (reason === "spotlight-filters") refreshOpenSpotlights();
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
    const valid = new Set(tagService.listTags().map((tag) => tag.id));
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

function refreshOpenSpotlights() {
  for (const app of SpotlightApp.instances()) {
    if (!app.rendered) continue;
    app.markDirty();
    void app.render({parts: ["results"]});
  }
}

function registerDocumentUpdateHooks() {
  const callback = (_document, changes) => {
    if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) scheduleRefresh();
    else if (
      foundry.utils.hasProperty(changes, "name")
      || foundry.utils.hasProperty(changes, "folder")
    ) refreshOpenSpotlights();
  };
  const lifecycleCallback = () => refreshOpenSpotlights();
  Hooks.on("updateFolder", callback);
  Hooks.on("createFolder", lifecycleCallback);
  Hooks.on("deleteFolder", lifecycleCallback);
  Hooks.on("updateCompendium", scheduleRefresh);
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    Hooks.on(`update${documentName}`, callback);
    Hooks.on(`create${documentName}`, lifecycleCallback);
    Hooks.on(`delete${documentName}`, lifecycleCallback);
  }
}

import { MODULE_ID, SUPPORTED_DOCUMENT_TYPES } from "./constants.js";
import { setDebugLogging } from "./core/logger.js";
import { RefreshCoordinator } from "./core/refresh.js";
import { createFoundryAdapter } from "./foundry/foundry-adapter.js";
import { TagWorkspace } from "./foundry/workspace.js";
import { createDirectoryIntegration } from "./ui/directory-integration.js";
import { notifyError } from "./ui/notifications.js";
import { createSpotlightController, SpotlightApp } from "./ui/spotlight.js";
import { openTagAssignment, TagAssignmentApp } from "./ui/tag-assignment.js";
import { openTagManager, TagManagerApp } from "./ui/tag-manager.js";

Hooks.once("init", () => {
  const adapter = createFoundryAdapter();
  const workspace = new TagWorkspace(adapter);
  let directoryIntegration = null;

  const coordinator = new RefreshCoordinator({
    isGM: () => workspace.isGM(),
    watchedFields: workspace.getWatchedFields(),
    onFlush: (batch) => {
      if (batch.directories) {
        directoryIntegration?.renderSupportedDirectories();
      }
      if (batch.dictionaryApps) {
        for (const app of TagManagerApp.instances()) {
          if (app.rendered) void app.render();
        }
      }
      if (batch.assignmentApps) {
        for (const app of TagAssignmentApp.instances()) {
          if (app.rendered) void app.render();
        }
      }
      if (batch.spotlightIndex || batch.spotlightFilters) {
        const parts = batch.spotlightIndex && !batch.spotlightFilters ? ["results"] : undefined;
        for (const app of SpotlightApp.instances()) {
          if (!app.rendered) continue;
          app.markDirty({
            index: batch.spotlightIndex,
            filters: batch.spotlightFilters,
          });
          void app.render(parts ? { parts } : undefined);
        }
      }
    },
  });

  workspace.configureCompendiumIndexFields();

  game.settings.register(MODULE_ID, "debug", {
    name: "FTAGS.Settings.DebugName",
    hint: "FTAGS.Settings.DebugHint",
    scope: "client",
    config: true,
    type: Boolean,
    default: false,
    onChange: setDebugLogging,
  });
  setDebugLogging(game.settings.get(MODULE_ID, "debug"));

  class ConfiguredTagManagerApp extends TagManagerApp {
    static PARTS = TagManagerApp.PARTS;

    constructor(options = {}) {
      super({ ...options, workspace });
    }
  }

  workspace.registerSettings({
    managerType: ConfiguredTagManagerApp,
    onSettingChange: (reason, value) => coordinator.onSettingChange(reason, value),
  });

  const spotlightController = createSpotlightController({ workspace, coordinator });
  const openManager = (parentApp = null) => openTagManager(parentApp, { workspace });
  const openAssignment = (target, parentApp = null) =>
    openTagAssignment(target, { parentApp, workspace, openManager });

  directoryIntegration = createDirectoryIntegration({
    workspace,
    openSpotlight: spotlightController.openSpotlight,
    openTagAssignment: openAssignment,
    openTagManager: openManager,
  });
  directoryIntegration.registerHooks();
  registerDocumentUpdateHooks(coordinator, workspace);
  spotlightController.registerKeybinding();

  const module = game.modules.get(MODULE_ID);
  if (module) {
    module.api = Object.freeze({
      openTagManager: (parentApp = null) => openManager(parentApp),
      openSpotlight: (options = {}) => spotlightController.openSpotlight(options),
      listTags: () => (workspace.isGM() ? workspace.listTags() : []),
      getAssignments: (document) => (workspace.isGM() ? workspace.getAssignments(document) : []),
    });
  }

  Hooks.once("ready", async () => {
    if (!workspace.isGM()) return;
    try {
      await workspace.cleanStaleSpotlightFilters();
      coordinator.schedule({ directories: true, dictionaryApps: true, assignmentApps: true });
    } catch (error) {
      notifyError(error);
    }
  });
});

function registerDocumentUpdateHooks(coordinator, workspace) {
  const onUpdate = (document, changes) => coordinator.onDocumentUpdate(document, changes);
  const onLifecycle = () => coordinator.onLifecycleChange();

  Hooks.on("updateCompendium", (pack) => {
    workspace.invalidateCompendiumCache(pack?.collection ?? null);
    coordinator.onLifecycleChange();
  });
  Hooks.on("updateFolder", onUpdate);
  Hooks.on("createFolder", onLifecycle);
  Hooks.on("deleteFolder", onLifecycle);

  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    Hooks.on(`update${documentName}`, onUpdate);
    Hooks.on(`create${documentName}`, onLifecycle);
    Hooks.on(`delete${documentName}`, onLifecycle);
  }
}

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID, SETTINGS } from "../scripts/constants.js";

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

describe("main.js composition root", () => {
  let previousGlobals;
  let hooks;
  let registeredSettings;
  let registeredMenus;
  let registeredKeybindings;
  let moduleObj;
  let settingsValues;
  let actorCollection;

  before(async () => {
    previousGlobals = {
      Hooks: globalThis.Hooks,
      game: globalThis.game,
      CONFIG: globalThis.CONFIG,
      ui: globalThis.ui,
      foundry: globalThis.foundry,
    };

    hooks = new Map();
    registeredSettings = new Map();
    registeredMenus = new Map();
    registeredKeybindings = new Map();
    settingsValues = new Map([
      [
        SETTINGS.DICTIONARY,
        { schemaVersion: 2, tags: [{ id: "valid-tag", name: "Valid", color: "#112233", shape: "circle" }] },
      ],
      [
        SETTINGS.SPOTLIGHT_FILTERS,
        {
          includeTagIds: ["valid-tag", "stale-tag"],
          excludeTagIds: [],
          matchMode: "any",
          documentTypes: ["Actor"],
          sortBy: "relevance",
        },
      ],
      ["debug", false],
    ]);

    const taggedActor = {
      id: "a1",
      uuid: "Actor.a1",
      name: "Tagged Hero",
      documentName: "Actor",
      type: "character",
      getFlag: () => ["valid-tag", "missing-tag"],
    };
    actorCollection = {
      contents: [taggedActor],
      renderCalls: 0,
      render() {
        this.renderCalls += 1;
      },
    };
    moduleObj = { id: MODULE_ID };

    globalThis.Hooks = {
      once(name, fn) {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
      on(name, fn) {
        hooks.set(name, [...(hooks.get(name) ?? []), fn]);
      },
    };
    globalThis.CONFIG = {
      Actor: { compendiumIndexFields: ["name"], sidebarIcon: "actor" },
      Item: { compendiumIndexFields: new Set(), sidebarIcon: "item" },
    };
    globalThis.ui = {
      notifications: { info: () => {}, warn: () => {}, error: () => {} },
      compendium: { render: () => {} },
    };

    class BaseApplicationV2 {
      static instances() {
        return [];
      }
      constructor(options = {}) {
        this.options = options;
        this.rendered = false;
      }
      _canRender() {
        return true;
      }
      async _prepareContext() {
        return {};
      }
      async _onRender() {}
      async _preClose() {}
      setPosition() {}
      bringToFront() {}
      async render() {
        this.rendered = true;
        return this;
      }
      async close() {
        this.rendered = false;
      }
    }

    globalThis.foundry = {
      applications: {
        api: {
          ApplicationV2: BaseApplicationV2,
          HandlebarsApplicationMixin: (Base) => Base,
          DialogV2: {},
        },
      },
      utils: {
        getProperty: (obj, path) => path.split(".").reduce((cur, seg) => cur?.[seg], obj),
        escapeHTML: (s) => String(s),
      },
    };

    globalThis.game = {
      user: { isGM: true },
      system: { id: "dnd5e" },
      i18n: { lang: "en", localize: (k) => k, format: (k) => k },
      world: { id: "w1" },
      actors: actorCollection,
      folders: [],
      packs: [],
      modules: { get: (id) => (id === MODULE_ID ? moduleObj : null) },
      settings: {
        register: (_mod, key, cfg) => registeredSettings.set(key, cfg),
        registerMenu: (_mod, key, cfg) => registeredMenus.set(key, cfg),
        get: (_mod, key) => settingsValues.get(key),
        set: async (_mod, key, val) => {
          settingsValues.set(key, val);
          registeredSettings.get(key)?.onChange?.(val);
        },
      },
      keybindings: {
        register: (_mod, key, cfg) => registeredKeybindings.set(key, cfg),
      },
    };

    await import("../scripts/main.js");
  });

  after(() => {
    globalThis.Hooks = previousGlobals.Hooks;
    globalThis.game = previousGlobals.game;
    globalThis.CONFIG = previousGlobals.CONFIG;
    globalThis.ui = previousGlobals.ui;
    globalThis.foundry = previousGlobals.foundry;
  });

  it("wires settings, compendium index fields, hooks, keybindings, frozen API, and startup cleanup", async () => {
    for (const initFn of hooks.get("init") ?? []) initFn();

    assert.ok(registeredSettings.has("debug"));
    assert.ok(registeredSettings.has(SETTINGS.DICTIONARY));
    assert.ok(registeredSettings.has(SETTINGS.SPOTLIGHT_FILTERS));
    assert.ok(registeredMenus.has(SETTINGS.MANAGER));
    assert.ok(registeredKeybindings.has("openSpotlight"));

    // Manager menu class instantiates with no args and binds workspace internally
    const MenuClass = registeredMenus.get(SETTINGS.MANAGER).type;
    const managerInstance = new MenuClass();
    assert.ok(managerInstance.workspace);

    // System-aware compendium index fields configured
    assert.ok(globalThis.CONFIG.Actor.compendiumIndexFields.includes(`flags.${MODULE_ID}`));
    assert.ok(globalThis.CONFIG.Actor.compendiumIndexFields.includes("system.details.cr"));
    assert.equal(globalThis.CONFIG.Item.compendiumIndexFields.has("system.rarity"), true);

    // Frozen module API obeys GM guard
    assert.equal(Object.isFrozen(moduleObj.api), true);
    assert.equal(moduleObj.api.listTags().length, 1);
    assert.deepEqual(moduleObj.api.getAssignments(actorCollection.contents[0]), ["valid-tag"]);

    globalThis.game.user.isGM = false;
    assert.deepEqual(moduleObj.api.listTags(), []);
    assert.deepEqual(moduleObj.api.getAssignments(actorCollection.contents[0]), []);
    globalThis.game.user.isGM = true;

    // Ready hook prunes stale spotlight filter IDs and schedules directory refresh
    for (const readyFn of hooks.get("ready") ?? []) await readyFn();
    assert.deepEqual(settingsValues.get(SETTINGS.SPOTLIGHT_FILTERS).includeTagIds, ["valid-tag"]);

    await flushMicrotasks();
    assert.ok(actorCollection.renderCalls >= 1);

    // Unwatched document updates do not trigger extra directory renders
    const beforeCalls = actorCollection.renderCalls;
    for (const fn of hooks.get("updateActor") ?? []) {
      fn(actorCollection.contents[0], { system: { attributes: { hp: { value: 5 } } } });
    }
    await flushMicrotasks();
    assert.equal(actorCollection.renderCalls, beforeCalls);

    // Tag flag updates schedule directory re-render
    for (const fn of hooks.get("updateActor") ?? []) {
      fn(actorCollection.contents[0], { flags: { [MODULE_ID]: { tagIds: ["valid-tag"] } } });
    }
    await flushMicrotasks();
    assert.equal(actorCollection.renderCalls, beforeCalls + 1);
  });

  it("drives SpotlightApp, TagManagerApp, and TagAssignmentApp lifecycle safely without timer leaks or echo renders", async () => {
    const { TagWorkspace } = await import("../scripts/foundry/workspace.js");
    const { createMemoryAdapter } = await import("./memory-adapter.js");
    const { RefreshCoordinator } = await import("../scripts/core/refresh.js");
    const { SpotlightApp } = await import("../scripts/ui/spotlight.js");
    const { TagManagerApp } = await import("../scripts/ui/tag-manager.js");
    const { TagAssignmentApp } = await import("../scripts/ui/tag-assignment.js");

    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();
    const tag = await workspace.createTag({ name: "Focus", color: "#509E6B", shape: "star" });
    const actor = adapter.addWorldDocument({
      id: "hero-1",
      name: "Vex",
      documentName: "Actor",
      type: "character",
      flags: { [MODULE_ID]: { tagIds: [tag.id] } },
    });

    let appRenderCount = 0;
    const echoFlushes = [];
    const coordinator = new RefreshCoordinator({
      isGM: () => workspace.isGM(),
      watchedFields: workspace.getWatchedFields(),
      onFlush: (batch) => echoFlushes.push(batch),
    });
    adapter.state.onSettingChange = (reason, val) => coordinator.onSettingChange(reason, val);

    const spotlight = new SpotlightApp({ workspace, coordinator });
    spotlight.render = async (opts) => {
      appRenderCount += 1;
      spotlight.rendered = true;
      await spotlight._prepareContext(opts ?? {});
      return spotlight;
    };

    await spotlight.activate({ includeTagId: tag.id });
    assert.equal(spotlight.filtersOpen, true);
    assert.equal(appRenderCount, 1);
    assert.deepEqual(
      spotlight.results.map((r) => r.uuid),
      ["Actor.hero-1"],
    );

    // Own filter save via coordinator suppression must not cause an echo flush
    await flushMicrotasks();
    assert.equal(echoFlushes.length, 0);

    // Simulate closing immediately while searchTimer & filterSaveTimer would be active
    spotlight.searchTimer = setTimeout(() => {
      throw new Error("searchTimer leaked past _preClose");
    }, 5000);
    await spotlight._preClose({});
    assert.equal(spotlight.searchTimer, null);
    assert.equal(spotlight.filterSaveTimer, null);

    // TagManagerApp context & TagAssignmentApp context reflect workspace cleanly
    const manager = new TagManagerApp({ workspace });
    const managerCtx = await manager._prepareContext({});
    assert.equal(managerCtx.hasTags, true);
    assert.equal(managerCtx.presets.length, 3);

    const assignment = new TagAssignmentApp(actor, { workspace });
    const assignCtx = await assignment._prepareContext({});
    assert.equal(assignCtx.targetName, "Vex");
    assert.equal(assignCtx.tags[0].assigned, true);
  });
});

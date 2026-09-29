import test from "node:test";
import assert from "node:assert/strict";

const handlers = new Map();
globalThis.Hooks = {on: (name, callback) => handlers.set(name, callback), once: (name, callback) => handlers.set(name, callback)};
class ApplicationV2 {static instances() {return [];} }
globalThis.foundry = {
  applications: {api: {ApplicationV2, HandlebarsApplicationMixin: Base => Base, DialogV2: {}}},
  utils: {hasProperty: (object, path) => path.split(".").reduce((o, key) => o?.[key], object) !== undefined}
};
globalThis.CONFIG = {Actor: {compendiumIndexFields: new Set(["name"])}, Item: {compendiumIndexFields: ["name"]}};
const settings = new Map();
globalThis.game = {
  user: {isGM: true}, system: {id: "dnd5e"}, modules: new Map(),
  settings: {register: (_scope, key, options) => settings.set(key, options.default), registerMenu() {}, get: (_scope, key) => settings.get(key), set: async (_scope, key, value) => settings.set(key, value)},
  keybindings: {register() {}}
};
await import("../scripts/main.js");
const {SpotlightApp} = await import("../scripts/ui/spotlight.js");
handlers.get("init")();

test("initialization registers automatic compendium fields without replacing existing fields", () => {
  assert.ok(CONFIG.Actor.compendiumIndexFields.has("name"));
  assert.ok(CONFIG.Actor.compendiumIndexFields.has("system.details.cr"));
  assert.ok(CONFIG.Item.compendiumIndexFields.includes("system.rarity"));
});

test("document property updates invalidate open searches, including flattened changes", () => {
  let dirtied = 0, rendered = 0;
  SpotlightApp.instances = () => [{rendered: true, markDirty() {dirtied++;}, render() {rendered++;}}];
  for (const changes of [{system: {details: {cr: 13}}}, {"system.rarity": "rare"}, {type: "equipment"}]) {
    handlers.get("updateActor")({}, changes);
  }
  handlers.get("updateCompendium")();
  assert.equal(dirtied, 4);
  assert.equal(rendered, 4);
  handlers.get("updateActor")({}, {img: "new.webp"});
  assert.equal(dirtied, 4);
  game.user.isGM = false;
  handlers.get("updateActor")({}, {system: {details: {cr: 5}}});
  assert.equal(dirtied, 4);
});

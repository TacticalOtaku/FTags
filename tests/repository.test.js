import test from "node:test";
import assert from "node:assert/strict";
import {TagRepository} from "../scripts/foundry/repository.js";
import {TagService} from "../scripts/foundry/service.js";

function environment(packs) {
  const settings = new Map();
  globalThis.game = {
    user: {isGM: true}, system: {id: "dnd5e"}, i18n: {lang: "en", localize: key => key}, packs,
    settings: {get: (_scope, key) => settings.get(key), set: async (_scope, key, value) => settings.set(key, value)}
  };
  globalThis.foundry = {utils: {getProperty: (object, path) => path.split(".").reduce((o, key) => o?.[key], object)}};
}

test("loads the fields of locked packs and indexes automatic-only records without writes", async () => {
  let loads = 0;
  const pack = {documentName: "Actor", collection: "test.actors", title: "Actors", locked: true, index: [], folders: [],
    async getIndex({fields}) {
      assert.ok(fields.includes("system.details.cr"));
      assert.ok(fields.includes("system.details.type"));
      loads++;
      this.index = [{_id: "undead", name: "Skeleton", type: "npc", system: {details: {cr: 3, type: {value: "undead"}}}}];
    }
  };
  environment([pack]);
  const repository = new TagRepository();
  const service = new TagService(repository);
  const results = await Promise.all([repository.prepareCompendiumIndexes(), repository.prepareCompendiumIndexes()]);
  assert.deepEqual(results, [[], []]);
  assert.equal(loads, 1);
  const found = service.searchSpotlight(service.buildSpotlightIndex(), "undead cr:3");
  assert.equal(found[0].uuid, "Compendium.test.actors.undead");
  assert.equal(found[0].document, null);
  assert.equal(repository.getDictionary().tags.length, 0);
});

test("pack failures preserve available search and retry on the next preparation", async () => {
  let fail = true;
  environment([{documentName: "Item", title: "Unavailable", collection: "test.items", async getIndex() {if (fail) throw new Error("offline");}}]);
  const repository = new TagRepository();
  const originalWarn = console.warn;
  console.warn = () => {};
  try {
    assert.deepEqual(await repository.prepareCompendiumIndexes(), ["Unavailable"]);
    fail = false;
    assert.deepEqual(await repository.prepareCompendiumIndexes(), []);
  } finally {console.warn = originalWarn;}
});

test("player cannot load search indexes", async () => {
  environment([]);
  game.user.isGM = false;
  await assert.rejects(new TagRepository().prepareCompendiumIndexes(), {code: "gm-only"});
});

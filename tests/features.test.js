import test from "node:test";
import assert from "node:assert/strict";
import {TagService} from "../scripts/core/service.js";
import {normalizeTag, mergeDictionaries} from "../scripts/core/model.js";
import {getAutomaticTags} from "../scripts/core/automatic-tags.js";

globalThis.game = {system: {id: "dnd5e"}, i18n: {lang: "ru", localize: key => key}};
const npc = (id, cr) => ({id, uuid: `Actor.${id}`, name: `Creature ${id}`, documentName: "Actor", type: "npc", system: {details: {cr, type: {value: "undead"}}}});
function setup(documents = []) {
  let dictionary = {schemaVersion: 1, tags: []};
  let filters = {};
  const repository = {
    assertGM() {}, getDictionary: () => structuredClone(dictionary),
    setDictionary: async value => {dictionary = value;},
    getTagIds: doc => doc.flags?.ftags?.tagIds ?? [],
    getAllTaggableObjects: () => documents, getCompendiumPacks: () => [],
    getSpotlightFilterState: () => filters, setSpotlightFilterState: async value => {filters = value;}
  };
  return new TagService(repository);
}

test("automatic-only creatures are searchable and CR is exact", () => {
  const service = setup([npc("three", 3), npc("thirteen", 13), npc("third", 0.125)]);
  const index = service.buildSpotlightIndex();
  for (const query of ["нежить CR 3", "undead cr:3", "#нежить #cr:3"]) {
    assert.deepEqual(service.searchSpotlight(index, query).map(r => r.document.id), ["three"]);
  }
  assert.deepEqual(service.searchSpotlight(index, "нежить CR 1/8").map(r => r.document.id), ["third"]);
  assert.deepEqual(service.searchSpotlight(index, "CR >= 10").map(r => r.document.id), ["thirteen"]);
});

test("item aliases distinguish rarity and weapon category", () => {
  const items = [
    ["sword", "uncommon", "martialM"], ["bow", "uncommon", "martialR"], ["rare", "rare", "martialM"]
  ].map(([id, rarity, type]) => ({id, name: id, uuid: `Item.${id}`, documentName: "Item", type: "weapon", system: {rarity, type: {value: type}}}));
  const service = setup(items);
  const index = service.buildSpotlightIndex();
  for (const query of ["оружие необычное ближнее", "оружие необычной редкости ближнее", "weapon uncommon melee"]) {
    assert.deepEqual(service.searchSpotlight(index, query).map(r => r.document.id), ["sword"]);
  }
  assert.deepEqual(service.searchSpotlight(index, "редкое оружие").map(r => r.document.id), ["rare"]);
});

test("shape defaults and import/export retain custom shapes", () => {
  assert.equal(normalizeTag({id: "old", name: "Old", color: "#123456"}).shape, "circle");
  const result = mergeDictionaries({tags: []}, {schemaVersion: 2, tags: [{id: "star", name: "Star", color: "#123456", shape: "star"}]});
  assert.equal(result.dictionary.tags[0].shape, "star");
  assert.throws(() => mergeDictionaries({tags: []}, {schemaVersion: 2, tags: [{id: "bad", name: "Bad", color: "#123456", shape: "<svg>"}]}));
  assert.equal(mergeDictionaries({tags: []}, {schemaVersion: 1, tags: [{id: "old", name: "Old", color: "#123456"}]}).dictionary.tags[0].shape, "circle");
});

test("presets are idempotent and do not overwrite existing manual tags", async () => {
  const service = setup();
  await service.createTag({name: "Готово", color: "#123456", shape: "diamond"});
  await service.applyPreset("preparation");
  await service.applyPreset("preparation");
  assert.equal(service.listTags().length, 3);
  assert.equal(service.listTags().find(t => t.name === "Готово").color, "#123456");
  assert.equal(service.listTags().find(t => t.name === "Готово").shape, "diamond");
});

test("automatic filters persist and combine with manual include/exclude", async () => {
  const first = npc("first", 3), second = npc("second", 3);
  const service = setup([first, second]);
  const tag = await service.createTag({name: "Prepared", color: "#123456"});
  first.flags = {ftags: {tagIds: [tag.id]}};
  const filters = await service.setSpotlightFilters({includeTagIds: [tag.id, "auto-dnd5e-cr-3"], matchMode: "all"});
  assert.equal(filters.includeTagIds.length, 2);
  const index = service.buildSpotlightIndex();
  assert.deepEqual(service.searchSpotlight(index, "", {filters}).map(r => r.document.id), ["first"]);
  filters.includeTagIds = ["auto-dnd5e-cr-3"];
  filters.excludeTagIds = [tag.id];
  assert.deepEqual(service.searchSpotlight(index, "", {filters}).map(r => r.document.id), ["second"]);
  assert.deepEqual(service.getAssignments(first), [tag.id]);
  assert.equal(JSON.parse(service.exportDictionary()).tags.length, 1);
});

test("missing and invalid CR never become CR zero; folders and other systems stay manual", () => {
  for (const value of [null, undefined, "", "bad", -1, Infinity]) {
    assert.ok(!getAutomaticTags(npc("test", value)).some(t => t.facet === "cr"));
  }
  assert.ok(getAutomaticTags(npc("zero", 0)).some(t => t.value === 0));
  assert.deepEqual(getAutomaticTags(npc("pf", 3), {systemId: "pf2e"}), []);
  assert.deepEqual(getAutomaticTags({...npc("folder", 3), documentName: "Folder"}), []);
});

test("legacy weapon fields, siege and natural weapon categories are handled accurately", () => {
  const item = {documentName: "Item", type: "weapon", system: {weaponType: "simpleM"}};
  assert.ok(getAutomaticTags(item).some(t => t.value === "melee"));
  item.system = {type: {value: "siege"}};
  assert.ok(getAutomaticTags(item).some(t => t.value === "ranged"));
  item.system = {type: {value: "natural"}};
  assert.ok(!getAutomaticTags(item).some(t => t.facet === "range"));
});

test("multiword rarity aliases tolerate whitespace and do not match rare", () => {
  const service = setup([{id: "v", name: "Wand", documentName: "Item", type: "equipment", system: {rarity: "veryRare"}}]);
  const index = service.buildSpotlightIndex();
  assert.equal(service.searchSpotlight(index, "очень   редкое").length, 1);
  assert.equal(service.searchSpotlight(index, '"very rare"').length, 1);
  assert.equal(service.searchSpotlight(index, "rare").length, 0);
  assert.equal(service.searchSpotlight(index, "броня").length, 0);
});

test("automatic identifiers cannot be imported as manual definitions", () => {
  assert.throws(() => normalizeTag({id: "auto-dnd5e-cr-3", name: "Fake", color: "#123456"}));
});

test("other systems retain manual CR-tag searches", async () => {
  game.system.id = "pf2e";
  try {
    const actor = npc("manual", 3);
    const service = setup([actor]);
    const tag = await service.createTag({name: "CR 3", color: "#123456"});
    actor.flags = {ftags: {tagIds: [tag.id]}};
    const index = service.buildSpotlightIndex();
    for (const query of ["CR 3", "#CR 3", '#"CR 3"']) {
      assert.equal(service.searchSpotlight(index, query).length, 1);
    }
  } finally {game.system.id = "dnd5e";}
});

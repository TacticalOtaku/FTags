import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SpotlightSession,
  chipColors,
  compileSpotlightIndex,
  countSpotlightFilters,
  defaultSpotlightFilterState,
  filtersEqual,
  getAutomaticIndexFields,
  getAutomaticTagLibrary,
  getAutomaticTags,
  getSpotlightWatchedFields,
  parseCR,
  pruneSpotlightFilters,
  searchSpotlightIndex,
} from "../scripts/core/spotlight.js";

describe("SpotlightEngine & SpotlightSession", () => {
  it("parses CR strings and numbers including fractions and decimals", () => {
    assert.equal(parseCR("1/4"), 0.25);
    assert.equal(parseCR("0,5"), 0.5);
    assert.equal(parseCR(12), 12);
    assert.equal(parseCR("-1"), null);
    assert.equal(parseCR("abc"), null);
  });

  it("gates automatic facets by explicit systemId and separates cached labels per language", () => {
    assert.deepEqual(getAutomaticTagLibrary({ systemId: "pf2e", language: "en" }), []);
    assert.deepEqual(getAutomaticIndexFields("Actor", "pf2e"), []);
    assert.deepEqual(getSpotlightWatchedFields("pf2e"), ["name", "folder"]);

    const dndFields = getSpotlightWatchedFields("dnd5e");
    assert.ok(dndFields.includes("system.details.cr"));
    assert.ok(dndFields.includes("system.rarity"));

    const ruUndead = getAutomaticTagLibrary({ systemId: "dnd5e", language: "ru" }).find(
      (tag) => tag.id === "auto-dnd5e-creature-undead",
    );
    const enUndead = getAutomaticTagLibrary({ systemId: "dnd5e", language: "en" }).find(
      (tag) => tag.id === "auto-dnd5e-creature-undead",
    );
    assert.equal(ruUndead.name, "Нежить");
    assert.equal(enUndead.name, "undead");

    const throwingSpear = {
      documentName: "Item",
      type: "weapon",
      system: { rarity: "uncommon", type: { value: "simpleM" }, properties: ["thr"] },
    };
    const autoTags = getAutomaticTags(throwingSpear, { systemId: "dnd5e", language: "en" });
    const ids = new Set(autoTags.map((t) => t.id));
    assert.ok(ids.has("auto-dnd5e-item-weapon"));
    assert.ok(ids.has("auto-dnd5e-rarity-uncommon"));
    assert.ok(ids.has("auto-dnd5e-range-melee"));
    assert.ok(!ids.has("auto-dnd5e-range-ranged"));
  });

  it("computes readable chip contrast colors and handles invalid hex safely", () => {
    const bright = chipColors("#FFFFFF");
    const dark = chipColors("#111111");
    const invalid = chipColors("not-hex");
    assert.equal(bright.foreground, "#111111");
    assert.equal(dark.foreground, "#F7F3E8");
    assert.equal(invalid.background, "#242936");
  });

  it("compiles indexes without leaking automatic tags into result chips and searches accurately", () => {
    const manualTags = [
      { id: "boss", name: "Boss", color: "#B84A4A", shape: "star" },
      { id: "quest", name: "Quest", color: "#4D88B3", shape: "circle" },
    ];
    const records = [
      {
        uuid: "Actor.lich",
        name: "Ancient Lich",
        documentName: "Actor",
        entityType: "Actor",
        isFolder: false,
        path: "Crypt",
        tagIds: ["boss"],
        automaticSource: {
          documentName: "Actor",
          type: "npc",
          system: { details: { type: { value: "undead" }, cr: 21 } },
        },
      },
      {
        uuid: "Actor.ghoul",
        name: "Ghoul",
        documentName: "Actor",
        entityType: "Actor",
        isFolder: false,
        path: "Crypt",
        tagIds: ["quest"],
        automaticSource: {
          documentName: "Actor",
          type: "npc",
          system: { details: { type: { value: "undead" }, cr: "1/2" } },
        },
      },
    ];

    const compiled = compileSpotlightIndex(records, {
      manualTags,
      systemId: "dnd5e",
      language: "ru",
      typeLabels: { Actor: "Персонаж" },
    });

    assert.equal(compiled.records.length, 2);
    assert.deepEqual(
      compiled.records[0].chips.map((c) => c.id),
      ["boss"],
    );

    const crHigh = searchSpotlightIndex(compiled, "нежить CR >= 10");
    assert.deepEqual(
      crHigh.map((r) => r.uuid),
      ["Actor.lich"],
    );

    const exactTag = searchSpotlightIndex(compiled, "#quest");
    assert.deepEqual(
      exactTag.map((r) => r.uuid),
      ["Actor.ghoul"],
    );

    const crHalf = searchSpotlightIndex(compiled, "ПО 1/2");
    assert.deepEqual(
      crHalf.map((r) => r.uuid),
      ["Actor.ghoul"],
    );
  });

  it("prunes stale filter ids and detects changes cleanly", () => {
    const valid = new Set(["boss", "auto-dnd5e-cr-3"]);
    const raw = {
      includeTagIds: ["boss", "deleted-id"],
      excludeTagIds: ["boss", "also-deleted"],
      matchMode: "all",
      documentTypes: ["Actor", "UnknownType"],
      sortBy: "name",
    };

    const pruned = pruneSpotlightFilters(raw, valid);
    assert.equal(pruned.changed, true);
    assert.deepEqual(pruned.filters.includeTagIds, ["boss"]);
    assert.deepEqual(pruned.filters.excludeTagIds, []);
    assert.deepEqual(pruned.filters.documentTypes, ["Actor"]);
    assert.equal(countSpotlightFilters(pruned.filters), 3);
    assert.equal(filtersEqual(pruned.filters, defaultSpotlightFilterState()), false);
  });

  it("drives full SpotlightSession state, filtering, selection wrapping, and view models", () => {
    const session = new SpotlightSession({ limit: 50 });
    assert.equal(session.needsIndex(), true);
    assert.equal(session.needsFilters(), true);

    session.setIndex(
      [
        {
          uuid: "Actor.a",
          name: "Skeleton",
          documentName: "Actor",
          entityType: "Actor",
          isFolder: false,
          path: "Ruins",
          tagIds: ["t1"],
          automaticSource: {
            documentName: "Actor",
            type: "npc",
            system: { details: { type: "undead", cr: 3 } },
          },
        },
        {
          uuid: "Folder.f1",
          name: "Undead Pack",
          documentName: "Folder",
          entityType: "Actor",
          isFolder: true,
          path: "",
          tagIds: ["t1", "t2"],
        },
      ],
      {
        manualTags: [
          { id: "t1", name: "Ready", color: "#509E6B", shape: "circle" },
          { id: "t2", name: "Secret", color: "#7B68EE", shape: "diamond" },
        ],
        systemId: "dnd5e",
        language: "en",
        typeLabels: { Actor: "Actor", Folder: "Folder" },
      },
    );
    session.setFilters(defaultSpotlightFilterState());

    assert.equal(session.results.length, 2);
    const { filtersChanged } = session.activate({ includeTagId: "t2" });
    assert.equal(filtersChanged, true);
    assert.equal(session.filtersOpen, true);
    assert.deepEqual(
      session.results.map((r) => r.uuid),
      ["Folder.f1"],
    );

    session.resetFilters();
    session.setSortBy("name");
    assert.deepEqual(
      session.results.map((r) => r.name),
      ["Skeleton", "Undead Pack"],
    );

    session.moveSelection(-1);
    assert.equal(session.selectedIndex, 1);
    session.moveSelection(1);
    assert.equal(session.selectedIndex, 0);

    const vm = session.getViewModel({
      localize: (k) => k,
      format: (k, d) => `${k}:${JSON.stringify(d)}`,
      typeLabels: { Actor: "Actor", Folder: "Folder" },
      iconForType: (t) => `icon:${t}`,
    });
    assert.equal(vm.hasAutomaticTags, true);
    assert.equal(vm.results[0].icon, "icon:Actor");
    assert.equal(vm.results[1].icon, "fa-solid fa-folder");
    assert.equal(
      vm.results[0].tags.every((tag) => !tag.automatic),
      true,
    );
  });
});

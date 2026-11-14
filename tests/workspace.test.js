import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BULK_CONCURRENCY, MODULE_ID } from "../scripts/constants.js";
import { TagValidationError } from "../scripts/core/dictionary.js";
import { compileSpotlightIndex, searchSpotlightIndex } from "../scripts/core/spotlight.js";
import { TagWorkspace } from "../scripts/foundry/workspace.js";
import { createMemoryAdapter } from "./memory-adapter.js";

describe("TagWorkspace over FoundryWorldPort", () => {
  it("enforces GM-only writes and lock checks consistently", async () => {
    const adapter = createMemoryAdapter({ isGM: false });
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    await assert.rejects(
      () => workspace.createTag({ name: "Secret" }),
      (error) => error instanceof TagValidationError && error.code === "gm-only",
    );
    await assert.rejects(
      () => workspace.applyPreset("story"),
      (error) => error instanceof TagValidationError && error.code === "gm-only",
    );
    await assert.rejects(
      () => workspace.cleanStaleSpotlightFilters(),
      (error) => error instanceof TagValidationError && error.code === "gm-only",
    );
  });

  it("propagates tags across nested world folders cleanly and skips already-tagged docs", async () => {
    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    const quest = await workspace.createTag({ name: "Quest", color: "#112233" });
    const boss = await workspace.createTag({ name: "Boss", color: "#B84A4A" });

    const alreadyTagged = adapter.addWorldDocument({
      id: "a1",
      name: "Tagged Hero",
      documentName: "Actor",
      type: "character",
      flags: { [MODULE_ID]: { tagIds: [quest.id] } },
    });
    const staleDoc = adapter.addWorldDocument({
      id: "a2",
      name: "Subfolder Mob",
      documentName: "Actor",
      type: "npc",
      flags: { [MODULE_ID]: { tagIds: ["deleted-tag"] } },
    });
    const subFolder = adapter.addWorldFolder({
      id: "f-sub",
      name: "Sub",
      type: "Actor",
      contents: [staleDoc],
    });
    const rootFolder = adapter.addWorldFolder({
      id: "f-root",
      name: "Root",
      type: "Actor",
      contents: [alreadyTagged],
      children: [{ folder: subFolder }],
    });

    assert.equal(workspace.getFolderDocumentCount(rootFolder), 2);
    const result = await workspace.propagateTagsToFolder(rootFolder, [quest.id, "missing"]);
    assert.deepEqual(result, { success: 1, failed: 0, errors: [] });
    assert.deepEqual(workspace.getAssignments(alreadyTagged), [quest.id]);
    assert.deepEqual(workspace.getAssignments(staleDoc), [quest.id]);

    // Existing valid assignments are preserved when adding a second tag
    await workspace.propagateTagsToFolder(rootFolder, [boss.id]);
    assert.deepEqual(workspace.getAssignments(staleDoc), [quest.id, boss.id]);
  });

  it("indexes unindexed compendium folders before propagating and skips loading already-tagged entries", async () => {
    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    const tag = await workspace.createTag({ name: "PackTag", color: "#509E6B" });
    const subFolder = adapter.makeFolder({
      id: "pf-sub",
      name: "PackSub",
      type: "Actor",
      pack: "world.npcs",
    });
    const rootFolder = adapter.makeFolder({
      id: "pf-root",
      name: "PackRoot",
      type: "Actor",
      pack: "world.npcs",
      children: [{ folder: subFolder }],
    });

    adapter.addPack({
      collection: "world.npcs",
      title: "World NPCs",
      documentName: "Actor",
      locked: false,
      indexed: false,
      folders: [rootFolder, subFolder],
      documents: [
        { id: "d1", name: "NeedsTag", folder: "pf-root", flags: {} },
        { id: "d2", name: "AlreadyTagged", folder: "pf-sub", flags: { [MODULE_ID]: { tagIds: [tag.id] } } },
        { id: "d3", name: "Outside", folder: null, flags: {} },
      ],
    });

    const ctx = await workspace.getAssignmentContext(rootFolder);
    assert.equal(ctx.folderContentCount, 2);
    assert.equal(adapter.state.indexCalls.length, 1);

    const res = await workspace.propagateTagsToFolder(rootFolder, [tag.id]);
    assert.deepEqual(res, { success: 1, failed: 0, errors: [] });
    // Already-tagged entry "d2" and outside entry "d3" must never trigger loadPackDocument!
    assert.deepEqual(
      adapter.state.loadCalls.map((call) => call.id),
      ["d1"],
    );
    assert.deepEqual(workspace.getAssignments(adapter.state.packs.get("world.npcs").documents.get("d1")), [
      tag.id,
    ]);
  });

  it("rejects propagating tags into locked compendium folders", async () => {
    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();
    const tag = await workspace.createTag({ name: "Any" });

    const lockedFolder = adapter.makeFolder({
      id: "pf-locked",
      name: "LockedFolder",
      type: "Item",
      pack: "world.locked",
    });
    adapter.addPack({
      collection: "world.locked",
      title: "Locked Items",
      documentName: "Item",
      locked: true,
      folders: [lockedFolder],
    });

    await assert.rejects(
      () => workspace.propagateTagsToFolder(lockedFolder, [tag.id]),
      (error) => error instanceof TagValidationError && error.code === "locked-compendium",
    );
  });

  it("skips indexing locked packs on deleteTag and aborts cleanly if loadPackDocument fails", async () => {
    const adapter = createMemoryAdapter({ failLoadIds: ["d-fail"] });
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();
    const curse = await workspace.createTag({ name: "Curse", color: "#B84A4A" });

    adapter.addPack({
      collection: "world.locked",
      title: "Locked",
      documentName: "Actor",
      locked: true,
      indexed: false,
    });
    adapter.addPack({
      collection: "world.unlocked",
      title: "Unlocked",
      documentName: "Actor",
      locked: false,
      indexed: false,
      documents: [
        { id: "d-ok", name: "Ok", flags: { [MODULE_ID]: { tagIds: [curse.id] } } },
        { id: "d-fail", name: "Broken", flags: { [MODULE_ID]: { tagIds: [curse.id] } } },
      ],
    });

    const aborted = await workspace.deleteTag(curse.id);
    // Must only index unlocked pack, never locked pack
    assert.deepEqual(
      adapter.state.indexCalls.map((c) => c.collection),
      ["world.unlocked"],
    );
    assert.equal(aborted.deleted, false);
    assert.equal(aborted.failed, 1);
    assert.equal(aborted.cleaned, 1);
    assert.ok(workspace.getTag(curse.id), "Tag must survive when compendium cleanup fails");

    // Resolve load failure and retry deletion
    adapter.state.failLoadIds.clear();
    const succeeded = await workspace.deleteTag(curse.id);
    assert.equal(succeeded.deleted, true);
    assert.equal(succeeded.failed, 0);
    assert.equal(workspace.getTag(curse.id), null);
  });

  it("deduplicates concurrent ensurePackIndexed calls and respects BULK_CONCURRENCY", async () => {
    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    const pack = adapter.addPack({
      collection: "world.monsters",
      documentName: "Actor",
      indexed: false,
    });

    await Promise.all([workspace.ensurePackIndexed(pack), workspace.ensurePackIndexed(pack)]);
    assert.equal(adapter.state.indexCalls.length, 1);
    assert.ok(BULK_CONCURRENCY >= 1);
  });

  it("projects world and compendium folders/entries into Spotlight dataset regardless of system", async () => {
    const adapter = createMemoryAdapter({ systemId: "pf2e", language: "en" });
    const workspace = new TagWorkspace(adapter);
    workspace.configureCompendiumIndexFields();
    workspace.registerSettings();
    assert.deepEqual(workspace.getWatchedFields(), ["name", "folder"]);

    const custom = await workspace.createTag({ name: "Dungeon" });
    const parentWorld = adapter.addWorldFolder({ id: "wf1", name: "Campaign", type: "Actor", ancestors: [] });
    adapter.addWorldDocument({
      id: "hero",
      name: "Ezren",
      documentName: "Actor",
      type: "character",
      folder: parentWorld,
      flags: { [MODULE_ID]: { tagIds: [custom.id] } },
    });

    const pFolder = adapter.makeFolder({
      id: "pf1",
      name: "Bestiary",
      type: "Actor",
      pack: "pf2e.bestiary",
    });
    adapter.addPack({
      collection: "pf2e.bestiary",
      title: "Bestiary Pack",
      documentName: "Actor",
      folders: [pFolder],
      documents: [
        {
          id: "goblin",
          name: "Goblin Pyro",
          folder: "pf1",
          flags: { [MODULE_ID]: { tagIds: [custom.id] } },
        },
      ],
    });

    const dataset = workspace.getSpotlightDataset();
    assert.equal(dataset.systemId, "pf2e");
    const index = compileSpotlightIndex(dataset.records, dataset);
    assert.equal(index.automaticTags.length, 0);

    const hits = searchSpotlightIndex(index, "#Dungeon");
    assert.equal(hits.length, 2);
    assert.equal(hits.find((r) => r.isCompendium).path, "Bestiary Pack / Bestiary");
    assert.equal(hits.find((r) => !r.isCompendium).path, "Campaign");
  });

  it("supports single-pass preview -> commitImport and prunes stale spotlight filters", async () => {
    const adapter = createMemoryAdapter({
      spotlightFilters: {
        includeTagIds: ["stale-id"],
        excludeTagIds: [],
        matchMode: "any",
        documentTypes: ["Actor"],
        sortBy: "name",
      },
    });
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    const json = JSON.stringify({
      module: MODULE_ID,
      schemaVersion: 2,
      tags: [{ id: "imported-tag", name: "Imported", color: "#4D88B3", shape: "square" }],
    });
    const plan = workspace.previewImport(json);
    assert.deepEqual(plan.summary, { created: 1, updated: 0, unchanged: 0 });

    await workspace.commitImport(plan);
    assert.equal(workspace.listTags().length, 1);
    assert.deepEqual(workspace.getSpotlightFilters().includeTagIds, []);
  });
});

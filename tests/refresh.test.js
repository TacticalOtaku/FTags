import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/constants.js";
import { RefreshCoordinator } from "../scripts/core/refresh.js";

const flushMicrotasks = () => new Promise((resolve) => queueMicrotask(resolve));

describe("RefreshCoordinator", () => {
  it("coalesces multiple rapid invalidations within the same microtask into one flush", async () => {
    const flushes = [];
    const coordinator = new RefreshCoordinator({
      isGM: () => true,
      watchedFields: ["name", "folder", "system.details.cr"],
      onFlush: (batch) => flushes.push(batch),
    });

    coordinator.onSettingChange("dictionary");
    coordinator.onDocumentUpdate({}, { name: "Renamed" });
    coordinator.onLifecycleChange();
    assert.equal(flushes.length, 0);

    await flushMicrotasks();
    assert.equal(flushes.length, 1);
    assert.deepEqual(flushes[0], {
      directories: true,
      dictionaryApps: true,
      assignmentApps: true,
      spotlightIndex: true,
      spotlightFilters: true,
    });
  });

  it("ignores unwatched updates such as hit points while matching nested watched paths", async () => {
    const flushes = [];
    const coordinator = new RefreshCoordinator({
      isGM: () => true,
      watchedFields: ["name", "folder", "system.details.cr", "system.details.type"],
      onFlush: (batch) => flushes.push(batch),
    });

    coordinator.onDocumentUpdate({}, { system: { attributes: { hp: { value: 12 } } } });
    await flushMicrotasks();
    assert.equal(flushes.length, 0);

    // Nested watched path and null-prototype change object
    const nullProto = Object.create(null);
    nullProto.type = { value: "undead" };
    coordinator.onDocumentUpdate({}, { system: { details: nullProto } });
    await flushMicrotasks();
    assert.equal(flushes.length, 1);
    assert.deepEqual(flushes[0], {
      directories: false,
      dictionaryApps: false,
      assignmentApps: false,
      spotlightIndex: true,
      spotlightFilters: false,
    });
  });

  it("marks assignmentApps dirty when folder changes or flags change without re-rendering manager", async () => {
    const flushes = [];
    const coordinator = new RefreshCoordinator({
      isGM: () => true,
      watchedFields: ["name", "folder"],
      onFlush: (batch) => flushes.push(batch),
    });

    coordinator.onDocumentUpdate({}, { folder: "folder-2" });
    await flushMicrotasks();
    assert.equal(flushes[0].assignmentApps, true);
    assert.equal(flushes[0].dictionaryApps, false);

    coordinator.onDocumentUpdate({}, { flags: { [MODULE_ID]: { tagIds: ["a"] } } });
    await flushMicrotasks();
    assert.equal(flushes[1].directories, true);
    assert.equal(flushes[1].assignmentApps, true);
    assert.equal(flushes[1].dictionaryApps, false);
    assert.equal(flushes[1].spotlightIndex, true);
  });

  it("suppresses filter-save echoes while allowing external filter changes through", async () => {
    const flushes = [];
    const coordinator = new RefreshCoordinator({
      isGM: () => true,
      onFlush: (batch) => flushes.push(batch),
    });

    const saved = {
      includeTagIds: ["boss"],
      excludeTagIds: [],
      matchMode: "all",
      documentTypes: ["Actor"],
      sortBy: "name",
    };
    coordinator.noteSpotlightFiltersSaved(saved);
    coordinator.onSettingChange("spotlight-filters", saved);
    await flushMicrotasks();
    assert.equal(flushes.length, 0);

    // Different value still triggers Spotlight filter refresh
    coordinator.noteSpotlightFiltersSaved(saved);
    coordinator.onSettingChange("spotlight-filters", {
      ...saved,
      sortBy: "type",
    });
    await flushMicrotasks();
    assert.equal(flushes.length, 1);
    assert.equal(flushes[0].spotlightFilters, true);
    assert.equal(flushes[0].spotlightIndex, false);
  });

  it("never schedules or flushes updates for non-GM users", async () => {
    const flushes = [];
    const coordinator = new RefreshCoordinator({
      isGM: () => false,
      watchedFields: ["name"],
      onFlush: (batch) => flushes.push(batch),
    });

    coordinator.onSettingChange("dictionary");
    coordinator.onDocumentUpdate({}, { name: "Change" });
    await flushMicrotasks();
    assert.equal(flushes.length, 0);
  });
});

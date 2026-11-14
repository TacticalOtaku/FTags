import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_TAG_COUNT, MAX_TAG_NAME_LENGTH, SCHEMA_VERSION } from "../scripts/constants.js";
import {
  PRESET_IDS,
  TagValidationError,
  applyDictionaryPreset,
  coerceDictionary,
  createDictionaryTag,
  emptyDictionary,
  exportDictionary,
  listPresets,
  planDictionaryImport,
  removeDictionaryTag,
  sanitizeTagIds,
  updateDictionaryTag,
} from "../scripts/core/dictionary.js";

describe("TagDictionary", () => {
  it("normalizes corrupted dictionaries and drops invalid entries", () => {
    const result = coerceDictionary({
      schemaVersion: SCHEMA_VERSION,
      tags: [
        { id: "alpha", name: "  Beta  ", color: "#abc123", shape: "star" },
        { id: "invalid id", name: "Ignored", color: "#111111" },
        { id: "beta", name: "   ", color: "#111111" },
        { id: "bad-color", name: "Bad Color", color: "not-a-color", shape: "circle" },
        { id: "gamma", name: "Alpha", color: "#112233" },
      ],
    });

    assert.equal(result.schemaVersion, SCHEMA_VERSION);
    assert.deepEqual(result.tags, [
      { id: "gamma", name: "Alpha", color: "#112233", shape: "circle" },
      { id: "alpha", name: "Beta", color: "#ABC123", shape: "star" },
    ]);
  });

  it("sanitizes flag tag id lists uniquely against optional valid ids", () => {
    const valid = new Set(["a", "b"]);
    assert.deepEqual(sanitizeTagIds([" a ", "bad id", "a", "c", "b"], valid), ["a", "b"]);
    assert.deepEqual(sanitizeTagIds([" a ", "b", "a"]), ["a", "b"]);
    assert.deepEqual(sanitizeTagIds(null), []);
  });

  it("creates, updates, and removes tags cleanly while enforcing validation limits", () => {
    let dict = emptyDictionary();
    const first = createDictionaryTag(dict, { name: "  Quest ", color: "#d49942", shape: "diamond" });
    dict = first.dictionary;
    assert.equal(first.tag.name, "Quest");
    assert.equal(first.tag.color, "#D49942");
    assert.equal(first.tag.shape, "diamond");

    const updated = updateDictionaryTag(dict, first.tag.id, {
      name: "Main Quest",
      color: "#112233",
      shape: "star",
    });
    dict = updated.dictionary;
    assert.equal(updated.tag.name, "Main Quest");
    assert.equal(dict.tags[0].shape, "star");

    const removed = removeDictionaryTag(dict, first.tag.id);
    assert.equal(removed.tag?.id, first.tag.id);
    assert.equal(removed.dictionary.tags.length, 0);

    assert.throws(
      () => createDictionaryTag(emptyDictionary(), { name: "   ", color: "#112233" }),
      (error) => error instanceof TagValidationError && error.code === "name-required",
    );
    assert.throws(
      () => createDictionaryTag(emptyDictionary(), { name: "a".repeat(MAX_TAG_NAME_LENGTH + 1) }),
      (error) => error instanceof TagValidationError && error.code === "name-too-long",
    );
    assert.throws(
      () => createDictionaryTag(emptyDictionary(), { name: "Bad Color", color: "red" }),
      (error) => error instanceof TagValidationError && error.code === "invalid-color",
    );
    assert.throws(
      () => createDictionaryTag(emptyDictionary(), { name: "Bad Shape", shape: "hexagon" }),
      (error) => error instanceof TagValidationError && error.code === "invalid-shape",
    );
  });

  it("uses one case-folding duplicate rule across create, update, preset, coerce, and import", () => {
    // Regression: localeCompare(base) collapsed Russian "й" and "и" while toLocaleLowerCase did not.
    let dict = createDictionaryTag(emptyDictionary(), { name: "Бой", color: "#112233" }).dictionary;
    dict = createDictionaryTag(dict, { name: "Бои", color: "#223344" }).dictionary;
    assert.equal(dict.tags.length, 2);

    assert.throws(
      () => createDictionaryTag(dict, { name: "бой", color: "#334455" }),
      (error) => error instanceof TagValidationError && error.code === "duplicate-name",
    );

    const updated = updateDictionaryTag(dict, dict.tags[1].id, {
      name: "Бой ",
      color: "#112233",
    }).dictionary;
    assert.equal(updated.tags.length, 2);

    assert.throws(
      () =>
        planDictionaryImport(dict, {
          module: "ftags",
          schemaVersion: SCHEMA_VERSION,
          tags: [{ id: "different-id", name: "БОЙ", color: "#445566" }],
        }),
      (error) => error instanceof TagValidationError && error.code === "import-name-conflict",
    );
  });

  it("rejects exceeding MAX_TAG_COUNT across creation and import", () => {
    let dict = emptyDictionary();
    const tags = Array.from({ length: MAX_TAG_COUNT }, (_, i) => ({
      id: `tag-${i}`,
      name: `Tag ${i}`,
      color: "#112233",
      shape: "circle",
    }));
    dict = coerceDictionary({ schemaVersion: SCHEMA_VERSION, tags });

    assert.throws(
      () => createDictionaryTag(dict, { name: "Overflow" }),
      (error) => error instanceof TagValidationError && error.code === "too-many-tags",
    );
  });

  it("lists presets per language and applies presets idempotently preserving user renames", () => {
    assert.deepEqual(PRESET_IDS, ["preparation", "story", "relations"]);
    const ruPresets = listPresets({ language: "ru" });
    const enPresets = listPresets({ language: "en" });
    assert.equal(ruPresets[0].tags[0].name, "Подготовить");
    assert.equal(enPresets[0].tags[0].name, "Prepare");

    let dict = createDictionaryTag(emptyDictionary(), { name: "Prepare", color: "#123456" }).dictionary;
    const firstRun = applyDictionaryPreset(dict, "preparation", { language: "ru" });
    assert.equal(firstRun.created, 2);
    assert.equal(firstRun.dictionary.tags.length, 3);

    const secondRun = applyDictionaryPreset(firstRun.dictionary, "preparation", { language: "ru" });
    assert.equal(secondRun.created, 0);
  });

  it("exports and plans single-pass imports accurately and rejects invalid payloads", () => {
    const initial = createDictionaryTag(emptyDictionary(), { name: "Keep", color: "#112233" }).dictionary;
    const existingId = initial.tags[0].id;
    const json = exportDictionary(initial, { now: new Date("2026-01-01T00:00:00.000Z") });
    const exported = JSON.parse(json);
    assert.equal(exported.exportedAt, "2026-01-01T00:00:00.000Z");

    const plan = planDictionaryImport(
      initial,
      JSON.stringify({
        module: "ftags",
        schemaVersion: SCHEMA_VERSION,
        tags: [
          { id: existingId, name: "Keep", color: "#112233", shape: "circle" },
          { id: "new-one", name: "Fresh", color: "#445566", shape: "triangle" },
        ],
      }),
    );
    assert.deepEqual(plan.summary, { created: 1, updated: 0, unchanged: 1 });
    assert.equal(plan.dictionary.tags.length, 2);

    assert.throws(
      () => planDictionaryImport(initial, { schemaVersion: 99, tags: [] }),
      (error) => error instanceof TagValidationError && error.code === "unsupported-schema",
    );
    assert.throws(
      () => planDictionaryImport(initial, { schemaVersion: SCHEMA_VERSION, tags: "nope" }),
      (error) => error instanceof TagValidationError && error.code === "tags-required",
    );
    assert.throws(
      () =>
        planDictionaryImport(initial, {
          schemaVersion: SCHEMA_VERSION,
          tags: [
            { id: "dup", name: "One", color: "#112233" },
            { id: "dup", name: "Two", color: "#223344" },
          ],
        }),
      (error) => error instanceof TagValidationError && error.code === "duplicate-id",
    );
  });
});

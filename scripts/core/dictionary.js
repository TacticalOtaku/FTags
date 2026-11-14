import { MAX_TAG_COUNT, MAX_TAG_NAME_LENGTH, MODULE_ID, SCHEMA_VERSION, TAG_SHAPES } from "../constants.js";

const TAG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

const PRESETS = {
  preparation: [
    ["prepare", "Подготовить", "Prepare", "#D49942", "triangle"],
    ["ready", "Готово", "Ready", "#62A879", "circle"],
    ["verified", "Проверено", "Verified", "#658FC4", "star"],
  ],
  story: [
    ["quest", "Квест", "Quest", "#BE944A", "star"],
    ["clue", "Зацепка", "Clue", "#5AADB0", "diamond"],
    ["secret", "Секрет", "Secret", "#9B7ABA", "square"],
  ],
  relations: [
    ["ally", "Союзник", "Ally", "#62A879", "circle"],
    ["enemy", "Противник", "Enemy", "#C56666", "triangle"],
    ["neutral", "Нейтральный", "Neutral", "#8593A6", "square"],
  ],
};

export const PRESET_IDS = Object.freeze(Object.keys(PRESETS));

export class TagValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "TagValidationError";
    this.code = code;
    this.details = details;
  }
}

export function emptyDictionary() {
  return { schemaVersion: SCHEMA_VERSION, tags: [] };
}

export function sanitizeTagIds(values, validIds = null) {
  const ids = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const id = String(value ?? "").trim();
    if (!TAG_ID_PATTERN.test(id) || seen.has(id) || (validIds && !validIds.has(id))) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export function sortTags(tags) {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}

export function coerceDictionary(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tags)) return emptyDictionary();

  const seenIds = new Set();
  const seenNames = new Set();
  const tags = [];
  for (const candidate of raw.tags) {
    try {
      const tag = normalizeTag(candidate);
      const key = nameKey(tag.name);
      if (seenIds.has(tag.id) || seenNames.has(key)) continue;
      seenIds.add(tag.id);
      seenNames.add(key);
      tags.push(tag);
    } catch {
      // Ignore malformed persisted entries so one bad record cannot disable the UI.
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    tags: sortTags(tags),
  };
}

export function listPresets({ language = "en" } = {}) {
  return PRESET_IDS.map((id) => ({
    id,
    labelKey: `FTAGS.Presets.${id}`,
    tags: presetEntries(id, language).map(({ aliases: _aliases, ...tag }) => tag),
  }));
}

export function createDictionaryTag(currentDictionary, { name, color, shape } = {}) {
  const dictionary = coerceDictionary(currentDictionary);
  if (dictionary.tags.length >= MAX_TAG_COUNT) {
    throw new TagValidationError("too-many-tags", { max: MAX_TAG_COUNT });
  }
  const tag = normalizeDraft({ id: createTagId(), name, color, shape }, dictionary.tags);
  return {
    dictionary: {
      schemaVersion: SCHEMA_VERSION,
      tags: sortTags([...dictionary.tags, tag]),
    },
    tag,
  };
}

export function updateDictionaryTag(currentDictionary, tagId, { name, color, shape } = {}) {
  const dictionary = coerceDictionary(currentDictionary);
  const index = dictionary.tags.findIndex((candidate) => candidate.id === tagId);
  if (index < 0) throw new Error("Unknown FTags tag");

  const nextShape = shape === undefined ? dictionary.tags[index].shape : shape;
  const updated = normalizeDraft({ id: tagId, name, color, shape: nextShape }, dictionary.tags, tagId);
  const tags = [...dictionary.tags];
  tags[index] = updated;
  return {
    dictionary: {
      schemaVersion: SCHEMA_VERSION,
      tags: sortTags(tags),
    },
    tag: updated,
  };
}

export function removeDictionaryTag(currentDictionary, tagId) {
  const dictionary = coerceDictionary(currentDictionary);
  const tag = dictionary.tags.find((candidate) => candidate.id === tagId) ?? null;
  if (!tag) return { dictionary, tag: null };
  return {
    dictionary: {
      schemaVersion: SCHEMA_VERSION,
      tags: dictionary.tags.filter((candidate) => candidate.id !== tagId),
    },
    tag,
  };
}

export function applyDictionaryPreset(currentDictionary, presetId, { language = "en" } = {}) {
  const dictionary = coerceDictionary(currentDictionary);
  const existingIds = new Set(dictionary.tags.map((tag) => tag.id));
  const existingNames = new Set(dictionary.tags.map((tag) => nameKey(tag.name)));
  const additions = [];
  let created = 0;

  for (const { aliases, ...draft } of presetEntries(presetId, language)) {
    if (existingIds.has(draft.id) || aliases.some((alias) => existingNames.has(nameKey(alias)))) {
      continue;
    }
    const tag = normalizeTag(draft);
    existingIds.add(tag.id);
    existingNames.add(nameKey(tag.name));
    additions.push(tag);
    created += 1;
  }

  if (dictionary.tags.length + additions.length > MAX_TAG_COUNT) {
    throw new TagValidationError("too-many-tags", { max: MAX_TAG_COUNT });
  }

  return {
    dictionary: created
      ? { schemaVersion: SCHEMA_VERSION, tags: sortTags([...dictionary.tags, ...additions]) }
      : dictionary,
    created,
  };
}

export function exportDictionary(currentDictionary, { now = new Date() } = {}) {
  const dictionary = coerceDictionary(currentDictionary);
  return JSON.stringify(
    {
      module: MODULE_ID,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: now.toISOString(),
      tags: dictionary.tags,
    },
    null,
    2,
  );
}

export function planDictionaryImport(currentDictionary, raw) {
  const payload = typeof raw === "string" ? JSON.parse(raw) : raw;
  const imported = validatePayload(payload);
  const current = coerceDictionary(currentDictionary);
  const byId = new Map(current.tags.map((tag) => [tag.id, tag]));
  const ownersByName = new Map(current.tags.map((tag) => [nameKey(tag.name), tag.id]));

  const summary = { created: 0, updated: 0, unchanged: 0 };
  for (const tag of imported.tags) {
    const key = nameKey(tag.name);
    const owner = ownersByName.get(key);
    if (owner && owner !== tag.id) {
      throw new TagValidationError("import-name-conflict", { name: tag.name });
    }

    const previous = byId.get(tag.id);
    if (!previous) summary.created += 1;
    else if (previous.name === tag.name && previous.color === tag.color && previous.shape === tag.shape) {
      summary.unchanged += 1;
    } else {
      summary.updated += 1;
    }

    if (previous) ownersByName.delete(nameKey(previous.name));
    ownersByName.set(key, tag.id);
    byId.set(tag.id, tag);
  }

  if (byId.size > MAX_TAG_COUNT) {
    throw new TagValidationError("too-many-tags", { max: MAX_TAG_COUNT });
  }

  return {
    dictionary: { schemaVersion: SCHEMA_VERSION, tags: sortTags([...byId.values()]) },
    summary,
  };
}

function presetEntries(id, language) {
  if (!Object.hasOwn(PRESETS, id)) throw new Error("Unknown FTags preset");
  const isRussian = String(language ?? "").startsWith("ru");
  return PRESETS[id].map(([key, ru, en, color, shape]) => ({
    id: `preset-${id}-${key}`,
    name: isRussian ? ru : en,
    color,
    shape,
    aliases: [ru, en],
  }));
}

function nameKey(name) {
  return String(name ?? "").toLocaleLowerCase();
}

function createTagId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeTagName(value) {
  const name = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!name) throw new TagValidationError("name-required");
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new TagValidationError("name-too-long", { max: MAX_TAG_NAME_LENGTH });
  }
  return name;
}

function normalizeTagColor(value = "#6B8E9B") {
  const color = String(value ?? "").trim();
  if (!COLOR_PATTERN.test(color)) throw new TagValidationError("invalid-color");
  return color.toUpperCase();
}

function normalizeTagId(value) {
  const id = String(value ?? "").trim();
  if (!TAG_ID_PATTERN.test(id) || id.startsWith("auto-dnd5e-")) {
    throw new TagValidationError("invalid-id");
  }
  return id;
}

function normalizeTagShape(value = "circle") {
  if (!TAG_SHAPES.includes(value)) throw new TagValidationError("invalid-shape");
  return value;
}

function normalizeTag(raw) {
  return {
    id: normalizeTagId(raw?.id),
    name: normalizeTagName(raw?.name),
    color: normalizeTagColor(raw?.color),
    shape: normalizeTagShape(raw?.shape),
  };
}

function normalizeDraft(raw, existingTags, editingId = null) {
  const tag = normalizeTag(raw);
  const key = nameKey(tag.name);
  const duplicate = existingTags.find((item) => item.id !== editingId && nameKey(item.name) === key);
  if (duplicate) throw new TagValidationError("duplicate-name", { name: tag.name });
  return tag;
}

function validatePayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TagValidationError("invalid-payload");
  }
  if (![1, SCHEMA_VERSION].includes(raw.schemaVersion)) {
    throw new TagValidationError("unsupported-schema", {
      expected: SCHEMA_VERSION,
      actual: raw.schemaVersion,
    });
  }
  if (!Array.isArray(raw.tags)) throw new TagValidationError("tags-required");
  if (raw.tags.length > MAX_TAG_COUNT) {
    throw new TagValidationError("too-many-tags", { max: MAX_TAG_COUNT });
  }

  const tags = raw.tags.map((tag) => normalizeTag(tag));
  const ids = new Set();
  const names = new Set();
  for (const tag of tags) {
    const key = nameKey(tag.name);
    if (ids.has(tag.id)) throw new TagValidationError("duplicate-id", { id: tag.id });
    if (names.has(key)) throw new TagValidationError("duplicate-name", { name: tag.name });
    ids.add(tag.id);
    names.add(key);
  }
  return { schemaVersion: SCHEMA_VERSION, tags: sortTags(tags) };
}

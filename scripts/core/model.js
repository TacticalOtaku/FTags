import {
  MAX_TAG_COUNT,
  MAX_TAG_NAME_LENGTH,
  MAX_VISIBLE_TAGS,
  SCHEMA_VERSION,
  SPOTLIGHT_DOCUMENT_TYPES,
  TAG_SHAPES
} from "../constants.js";

const TAG_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

export class TagValidationError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "TagValidationError";
    this.code = code;
    this.details = details;
  }
}

export function normalizeTagName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!name) throw new TagValidationError("name-required");
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new TagValidationError("name-too-long", {max: MAX_TAG_NAME_LENGTH});
  }
  return name;
}

export function normalizeTagColor(value) {
  const color = String(value ?? "").trim();
  if (!COLOR_PATTERN.test(color)) throw new TagValidationError("invalid-color");
  return color.toUpperCase();
}

export function normalizeTagId(value) {
  const id = String(value ?? "").trim();
  if (!TAG_ID_PATTERN.test(id) || id.startsWith("auto-dnd5e-")) throw new TagValidationError("invalid-id");
  return id;
}

export function createTagId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `tag-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function normalizeTag(raw, {requireId = true} = {}) {
  return {
    id: requireId ? normalizeTagId(raw?.id) : normalizeTagId(raw?.id || createTagId()),
    name: normalizeTagName(raw?.name),
    color: normalizeTagColor(raw?.color),
    shape: normalizeTagShape(raw?.shape)
  };
}

export function normalizeTagShape(value = "circle") {
  if (!TAG_SHAPES.includes(value)) throw new TagValidationError("invalid-shape");
  return value;
}

/** Case-insensitive identity of a tag name, shared by every uniqueness check. */
export function tagNameKey(name) {
  return String(name ?? "").normalize("NFC").toLocaleLowerCase();
}

/**
 * Persisted entries are repaired rather than dropped where possible, so a stricter future rule
 * or a hand-edited world setting cannot silently erase tags. Only an unusable id or name, or an
 * unreadable colour, still discards the entry.
 */
function normalizeStoredTag(raw) {
  const id = normalizeTagId(raw?.id);
  const name = String(raw?.name ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TAG_NAME_LENGTH).trim();
  if (!name) throw new TagValidationError("name-required");
  return {
    id,
    name,
    color: normalizeTagColor(raw?.color),
    shape: TAG_SHAPES.includes(raw?.shape) ? raw.shape : "circle"
  };
}

export function emptyDictionary() {
  return {schemaVersion: SCHEMA_VERSION, tags: []};
}

export function coerceDictionary(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.tags)) return emptyDictionary();

  const seenIds = new Set();
  const seenNames = new Set();
  const tags = [];
  for (const candidate of raw.tags) {
    try {
      const tag = normalizeStoredTag(candidate);
      const nameKey = tagNameKey(tag.name);
      if (seenIds.has(tag.id) || seenNames.has(nameKey)) {
        console.warn("FTags: Skipped a duplicate stored tag", candidate);
        continue;
      }
      seenIds.add(tag.id);
      seenNames.add(nameKey);
      tags.push(tag);
    } catch (error) {
      // One bad value must not break the module UI, but it should never vanish silently.
      console.warn("FTags: Skipped an unreadable stored tag", candidate, error);
    }
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    tags: sortTags(tags)
  };
}

export function validateDictionaryPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new TagValidationError("invalid-payload");
  }
  if (![1, SCHEMA_VERSION].includes(raw.schemaVersion)) {
    throw new TagValidationError("unsupported-schema", {
      expected: SCHEMA_VERSION,
      actual: raw.schemaVersion
    });
  }
  if (!Array.isArray(raw.tags)) throw new TagValidationError("tags-required");
  if (raw.tags.length > MAX_TAG_COUNT) {
    throw new TagValidationError("too-many-tags", {max: MAX_TAG_COUNT});
  }

  const tags = raw.tags.map((tag) => normalizeTag(tag));
  assertUniqueTags(tags);
  return {schemaVersion: SCHEMA_VERSION, tags: sortTags(tags)};
}

export function validateTagDraft(raw, existingTags = [], editingId = null) {
  const tag = normalizeTag(raw, {requireId: Boolean(raw?.id)});
  const nameKey = tagNameKey(tag.name);
  const duplicate = existingTags.find((item) => item.id !== editingId && tagNameKey(item.name) === nameKey);
  if (duplicate) throw new TagValidationError("duplicate-name", {name: tag.name});
  return tag;
}

export function mergeDictionaries(currentRaw, importedRaw) {
  const current = coerceDictionary(currentRaw);
  const imported = validateDictionaryPayload(importedRaw);
  const byId = new Map(current.tags.map((tag) => [tag.id, tag]));

  const summary = {created: 0, updated: 0, unchanged: 0};
  for (const tag of imported.tags) {
    const previous = byId.get(tag.id);
    if (!previous) summary.created += 1;
    else if (previous.name === tag.name && previous.color === tag.color && previous.shape === tag.shape) summary.unchanged += 1;
    else summary.updated += 1;
    byId.set(tag.id, tag);
  }

  // Names are checked against the merged result, so an import may swap or rename names freely
  // as long as the final dictionary stays unambiguous.
  const owners = new Map();
  for (const tag of byId.values()) {
    const nameKey = tagNameKey(tag.name);
    if (owners.has(nameKey)) throw new TagValidationError("import-name-conflict", {name: tag.name});
    owners.set(nameKey, tag.id);
  }

  if (byId.size > MAX_TAG_COUNT) {
    throw new TagValidationError("too-many-tags", {max: MAX_TAG_COUNT});
  }

  return {
    dictionary: {schemaVersion: SCHEMA_VERSION, tags: sortTags([...byId.values()])},
    summary
  };
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

/**
 * Split assigned tags into visible markers and overflow. Pass a prepared `Map` of tags by id when
 * calling this per directory row; a raw dictionary is normalized on every call.
 */
export function partitionVisibleTags(assignedIds, dictionaryOrTagsById, limit = MAX_VISIBLE_TAGS) {
  const byId = dictionaryOrTagsById instanceof Map
    ? dictionaryOrTagsById
    : new Map(coerceDictionary(dictionaryOrTagsById).tags.map((tag) => [tag.id, tag]));
  const resolved = sanitizeTagIds(assignedIds, new Set(byId.keys()))
    .map((id) => byId.get(id));
  return {
    visible: resolved.slice(0, limit),
    hidden: resolved.slice(limit),
    total: resolved.length
  };
}

const CHIP_SURFACE = [36, 41, 54];
// Must match the tag share used by the Spotlight chip rule in ftags.css.
const CHIP_TAG_SHARE = 0.84;

function hexChannels(hex) {
  const color = normalizeTagColor(hex).slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(color.slice(offset, offset + 2), 16));
}

function relativeLuminance(channels) {
  const linear = channels.map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function toHex(channels) {
  return `#${channels.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * Resolve the chip background and a foreground that stays readable on it. The background is
 * computed here rather than through CSS `color-mix` so the contrast decision is made against
 * the colour actually painted.
 */
export function chipColors(hex) {
  const tag = hexChannels(hex);
  const background = tag.map((value, index) => (
    value * CHIP_TAG_SHARE + CHIP_SURFACE[index] * (1 - CHIP_TAG_SHARE)
  ));
  return {
    background: toHex(background),
    foreground: relativeLuminance(background) > 0.179 ? "#111111" : "#F7F3E8",
    border: toHex(tag.map((value) => value * 0.68))
  };
}

/** Subfolders of a folder. Compendium folders return nothing from `getSubfolders`, so fall back to `children`. */
export function getChildFolders(folder) {
  const direct = folder?.getSubfolders?.(false);
  if (Array.isArray(direct) && direct.length) return direct;
  return (folder?.children ?? [])
    .map((child) => child?.folder ?? child)
    .filter((child) => child?.documentName === "Folder");
}

export function collectFolderDocuments(folder) {
  const documents = [];
  const visitedFolders = new Set();
  const visitedDocuments = new Set();

  const visit = (current) => {
    if (!current || visitedFolders.has(current.id)) return;
    visitedFolders.add(current.id);
    for (const document of current.contents ?? []) {
      // Compendium folders expose plain index entries keyed by `_id` instead of documents.
      const id = document?.id ?? document?._id;
      if (!id || visitedDocuments.has(document.uuid ?? id)) continue;
      visitedDocuments.add(document.uuid ?? id);
      documents.push(document);
    }
    for (const child of getChildFolders(current)) visit(child);
  };

  visit(folder);
  return documents;
}

export function defaultSpotlightFilterState() {
  return {
    includeTagIds: [],
    excludeTagIds: [],
    matchMode: "any",
    documentTypes: [...SPOTLIGHT_DOCUMENT_TYPES],
    sortBy: "relevance"
  };
}

export function normalizeSpotlightFilterState(raw, validTagIds = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const valid = validTagIds instanceof Set ? validTagIds : (validTagIds ? new Set(validTagIds) : null);
  const includeTagIds = sanitizeTagIds(source.includeTagIds, valid);
  const included = new Set(includeTagIds);
  const excludeTagIds = sanitizeTagIds(source.excludeTagIds, valid).filter((id) => !included.has(id));
  const knownTypes = new Set(SPOTLIGHT_DOCUMENT_TYPES);
  const documentTypes = Array.isArray(source.documentTypes)
    ? [...new Set(source.documentTypes.map(String).filter((type) => knownTypes.has(type)))]
    : [...SPOTLIGHT_DOCUMENT_TYPES];
  return {
    includeTagIds,
    excludeTagIds,
    matchMode: source.matchMode === "all" ? "all" : "any",
    documentTypes,
    sortBy: ["relevance", "name", "type"].includes(source.sortBy) ? source.sortBy : "relevance"
  };
}

export function countSpotlightFilters(raw) {
  const state = normalizeSpotlightFilterState(raw);
  let count = state.includeTagIds.length + state.excludeTagIds.length;
  if (state.matchMode === "all" && state.includeTagIds.length > 1) count += 1;
  if (state.documentTypes.length !== SPOTLIGHT_DOCUMENT_TYPES.length) count += 1;
  if (state.sortBy !== "relevance") count += 1;
  return count;
}

export function sortTags(tags) {
  return [...tags].sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: "base"}));
}

function assertUniqueTags(tags) {
  const ids = new Set();
  const names = new Set();
  for (const tag of tags) {
    const nameKey = tagNameKey(tag.name);
    if (ids.has(tag.id)) throw new TagValidationError("duplicate-id", {id: tag.id});
    if (names.has(nameKey)) throw new TagValidationError("duplicate-name", {name: tag.name});
    ids.add(tag.id);
    names.add(nameKey);
  }
}

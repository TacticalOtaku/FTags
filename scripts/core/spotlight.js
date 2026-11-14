import { SPOTLIGHT_DOCUMENT_TYPES } from "../constants.js";
import { sanitizeTagIds } from "./dictionary.js";

// System-derived facets live only in the search index, never in document flags.
const CREATURES = {
  aberration: "Аберрация",
  beast: "Зверь",
  celestial: "Небожитель",
  construct: "Конструкт",
  dragon: "Дракон",
  elemental: "Элементаль",
  fey: "Фея",
  fiend: "Исчадие",
  giant: "Великан",
  humanoid: "Гуманоид",
  monstrosity: "Монстр",
  ooze: "Слизь",
  plant: "Растение",
  undead: "Нежить",
};

const ITEMS = {
  weapon: "Оружие",
  equipment: "Снаряжение",
  consumable: "Расходник",
  tool: "Инструмент",
  loot: "Добыча",
  container: "Контейнер",
  spell: "Заклинание",
  feat: "Особенность",
  class: "Класс",
  subclass: "Подкласс",
  background: "Предыстория",
  race: "Вид",
};

const RARITIES = {
  common: ["Обычное", "обычный", "обычная", "обычной"],
  uncommon: ["Необычное", "необычный", "необычная", "необычной"],
  rare: ["Редкое", "редкий", "редкая", "редкой"],
  veryRare: ["Очень редкое", "очень редкий", "очень редкая", "очень редкой", "very rare"],
  legendary: ["Легендарное", "легендарный", "легендарная", "легендарной"],
  artifact: ["Артефакт", "артефактной"],
};

const RANGES = {
  melee: ["Ближнее", "ближний", "ближнего боя", "рукопашное"],
  ranged: ["Дальнобойное", "дальнобойный", "дальнего боя", "дальнее", "дистанционное"],
};

export const CR_VALUES = [0, 0.125, 0.25, 0.5, ...Array.from({ length: 30 }, (_, i) => i + 1)];

const COMBINING_MARKS = /[\u0300-\u036f]/g;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;
const CHIP_SURFACE = [36, 41, 54];
// Must match the tag share used by the Spotlight chip rule in ftags.css.
const CHIP_TAG_SHARE = 0.84;

const libraryCache = new Map();

export function parseCR(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const text = String(value).trim();
  if (!/^\d+(?:[.,]\d+)?(?:\/\d+)?$/.test(text)) return null;
  const [numerator, denominator = "1"] = text.replace(",", ".").split("/");
  const number = Number(numerator) / Number(denominator);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function getAutomaticIndexFields(documentName, systemId) {
  if (systemId !== "dnd5e") return [];
  if (documentName === "Actor") return ["type", "system.details.cr", "system.details.type"];
  if (documentName === "Item") return ["type", "system.rarity", "system.type.value", "system.weaponType"];
  return [];
}

export function getSpotlightWatchedFields(systemId, documentTypes = SPOTLIGHT_DOCUMENT_TYPES) {
  return [
    "name",
    "folder",
    ...new Set(documentTypes.flatMap((documentName) => getAutomaticIndexFields(documentName, systemId))),
  ];
}

export function getAutomaticTagLibrary({ systemId = "", language = "en" } = {}) {
  if (systemId !== "dnd5e") return [];
  const cacheKey = `${systemId}:${language ?? ""}`;
  const cached = libraryCache.get(cacheKey);
  if (cached) return cached;

  const library = [
    ...Object.entries(CREATURES).map(([key, ru]) => makeAutoTag("creature", key, ru, [], language)),
    ...Object.entries(ITEMS).map(([key, ru]) =>
      makeAutoTag("item", key, ru, key === "equipment" ? ["экипировка"] : [], language),
    ),
    ...Object.entries(RARITIES).map(([key, [ru, ...aliases]]) =>
      makeAutoTag("rarity", key, ru, [key, ...aliases], language),
    ),
    ...Object.entries(RANGES).map(([key, [ru, ...aliases]]) =>
      makeAutoTag("range", key, ru, aliases, language),
    ),
    ...CR_VALUES.map((value) => {
      const label = { 0.125: "1/8", 0.25: "1/4", 0.5: "1/2" }[value] ?? String(value);
      return makeAutoTag("cr", value, label, [`CR ${value}`, `ПО ${label}`], language);
    }),
  ];
  libraryCache.set(cacheKey, library);
  return library;
}

export function getAutomaticTags(
  document,
  { systemId = "", language = "en", documentName = document?.documentName } = {},
) {
  const library = getAutomaticTagLibrary({ systemId, language });
  if (!library.length || !document?.system) return [];
  const system = document.system;
  const facets = {};
  if (documentName === "Actor") {
    const type = system.details?.type;
    facets.creature = typeof type === "string" ? type : type?.value;
    if (document.type === "npc") facets.cr = parseCR(system.details?.cr);
  } else if (documentName === "Item") {
    facets.item = document.type;
    facets.rarity = system.rarity;
    if (document.type === "weapon") {
      const type = system.type?.value ?? system.weaponType;
      // Throwing a melee weapon does not turn it into a ranged weapon category.
      facets.range = {
        simpleM: "melee",
        martialM: "melee",
        simpleR: "ranged",
        martialR: "ranged",
        siege: "ranged",
      }[type];
    }
  }
  return library.filter((tag) => facets[tag.facet] === tag.value);
}

export function defaultSpotlightFilterState() {
  return {
    includeTagIds: [],
    excludeTagIds: [],
    matchMode: "any",
    documentTypes: [...SPOTLIGHT_DOCUMENT_TYPES],
    sortBy: "relevance",
  };
}

export function normalizeSpotlightFilterState(raw, validTagIds = null) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const valid = validTagIds instanceof Set ? validTagIds : validTagIds ? new Set(validTagIds) : null;
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
    sortBy: ["relevance", "name", "type"].includes(source.sortBy) ? source.sortBy : "relevance",
  };
}

export function pruneSpotlightFilters(raw, validTagIds) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const cleaned = normalizeSpotlightFilterState(source, validTagIds);
  return {
    filters: cleaned,
    changed: !filtersEqual(source, cleaned),
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

export function filtersEqual(left, right) {
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  return (
    arraysEqual(left.includeTagIds, right.includeTagIds) &&
    arraysEqual(left.excludeTagIds, right.excludeTagIds) &&
    left.matchMode === right.matchMode &&
    arraysEqual(left.documentTypes, right.documentTypes) &&
    left.sortBy === right.sortBy
  );
}

/**
 * Resolve the chip background and a foreground that stays readable on it. Computed here rather
 * than via CSS `color-mix` so the contrast decision matches the colour actually painted.
 */
export function chipColors(hex) {
  const color = String(hex ?? "").trim();
  if (!COLOR_PATTERN.test(color)) return { background: "#242936", foreground: "#F7F3E8", border: "#4D5566" };
  const raw = color.slice(1);
  const tag = [0, 2, 4].map((offset) => Number.parseInt(raw.slice(offset, offset + 2), 16));
  const background = tag.map(
    (value, index) => value * CHIP_TAG_SHARE + CHIP_SURFACE[index] * (1 - CHIP_TAG_SHARE),
  );
  return {
    background: toHex(background),
    foreground: relativeLuminance(background) > 0.179 ? "#111111" : "#F7F3E8",
    border: toHex(tag.map((value) => value * 0.68)),
  };
}

export function compileSpotlightIndex(
  rawRecords,
  { manualTags = [], systemId = "", language = "en", typeLabels = {} } = {},
) {
  const tagsById = new Map(manualTags.map((tag) => [tag.id, { ...tag, ...chipColors(tag.color) }]));
  const validManualIds = new Set(tagsById.keys());
  const automaticLibrary = getAutomaticTagLibrary({ systemId, language });
  const phrases = buildMultiWordPhrases(automaticLibrary);
  const validTagIds = new Set([...validManualIds, ...automaticLibrary.map((tag) => tag.id)]);

  const records = [];
  for (const raw of rawRecords ?? []) {
    const manual = sanitizeTagIds(raw.tagIds, validManualIds).map((id) => tagsById.get(id));
    const automatic = getAutomaticTags(raw.automaticSource ?? raw.document, {
      systemId,
      language,
      documentName: raw.documentName,
    });
    if (!manual.length && !automatic.length) continue;

    const filterTagIds = new Set([...manual, ...automatic].map((tag) => tag.id));
    const displayDocumentType = raw.isFolder ? "Folder" : raw.entityType;
    const typeLabel = typeLabels[displayDocumentType] ?? String(displayDocumentType ?? "");
    const folderContentType = raw.isFolder
      ? (typeLabels[raw.entityType] ?? String(raw.entityType ?? ""))
      : "";
    const metadata = [typeLabel, folderContentType, raw.path].filter(Boolean).join(" · ");

    records.push({
      uuid: raw.uuid,
      name: raw.name,
      document: raw.document ?? null,
      documentName: raw.documentName,
      entityType: raw.entityType,
      isFolder: Boolean(raw.isFolder),
      isCompendium: Boolean(raw.isCompendium),
      path: raw.path ?? "",
      typeLabel,
      metadata,
      chips: manual,
      chipNamesText: manual.map((tag) => tag.name).join(", "),
      _spotlight: {
        order: records.length,
        name: foldSearchText(raw.name),
        filterTagIds,
        tags: manual.map((tag) => foldSearchText(tag.name)).filter(Boolean),
        automatic: automatic.flatMap((tag) =>
          tag.aliases.flatMap((alias) =>
            tag.facet === "rarity"
              ? [foldSearchText(alias), foldSearchText(`${alias} редкости`)]
              : [foldSearchText(alias)],
          ),
        ),
        cr: automatic.find((tag) => tag.facet === "cr")?.value,
      },
    });
  }

  return {
    records,
    manualTags,
    automaticTags: automaticLibrary,
    validTagIds,
    phrases,
    hasAutomaticSyntax: automaticLibrary.length > 0,
  };
}

export function searchSpotlightIndex(compiledIndex, query, { limit = 100, filters = null } = {}) {
  const index = compiledIndex ?? { records: [], phrases: [], hasAutomaticSyntax: false };
  const tokens = tokenizeQuery(query, index.phrases, index.hasAutomaticSyntax);
  const safeLimit = Math.max(0, Number.isFinite(limit) ? Math.trunc(limit) : 100);
  const cleanFilters = normalizeSpotlightFilterState(filters);
  const matches = [];

  for (const record of index.records) {
    if (!matchesSpotlightFilters(record, cleanFilters)) continue;
    const search = record._spotlight;
    let score = 0;
    let matched = true;

    for (const token of tokens) {
      const tokenScore = scoreToken(search, token);
      if (tokenScore === null) {
        matched = false;
        break;
      }
      score += tokenScore;
    }
    if (matched) matches.push({ record, score, search });
  }

  return matches
    .sort((left, right) => compareMatches(left, right, cleanFilters.sortBy))
    .slice(0, safeLimit)
    .map(({ record }) => record);
}

export class SpotlightSession {
  constructor({ limit = 100 } = {}) {
    this.limit = limit;
    this.query = "";
    this.selectedIndex = 0;
    this.filtersOpen = false;
    this.compiledIndex = null;
    this.filters = null;
    this.results = [];
  }

  needsIndex() {
    return !this.compiledIndex;
  }

  needsFilters() {
    return !this.filters;
  }

  validTagIds() {
    return this.compiledIndex?.validTagIds ?? null;
  }

  invalidate({ index = true, filters = false } = {}) {
    if (index) this.compiledIndex = null;
    if (filters) this.filters = null;
  }

  setIndex(rawRecords, options) {
    this.compiledIndex = compileSpotlightIndex(rawRecords, options);
    if (this.filters) {
      this.filters = normalizeSpotlightFilterState(this.filters, this.compiledIndex.validTagIds);
      this.#recompute();
    }
    return this.compiledIndex;
  }

  setFilters(rawFilters) {
    this.filters = normalizeSpotlightFilterState(rawFilters, this.compiledIndex?.validTagIds ?? null);
    if (this.compiledIndex) this.#recompute();
    return this.filters;
  }

  activate({ includeTagId = null } = {}) {
    if (!this.filters) this.filters = defaultSpotlightFilterState();
    let filtersChanged = false;
    if (includeTagId) {
      const next = structuredClone(this.filters);
      next.excludeTagIds = next.excludeTagIds.filter((id) => id !== includeTagId);
      if (!next.includeTagIds.includes(includeTagId)) next.includeTagIds.push(includeTagId);
      this.filters = normalizeSpotlightFilterState(next, this.compiledIndex?.validTagIds ?? null);
      this.filtersOpen = true;
      this.selectedIndex = 0;
      filtersChanged = true;
      if (this.compiledIndex) this.#recompute();
    }
    return { filtersChanged, filters: this.filters };
  }

  setQuery(query) {
    this.query = String(query ?? "");
    this.selectedIndex = 0;
    if (this.compiledIndex) this.#recompute();
  }

  toggleFilters() {
    this.filtersOpen = !this.filtersOpen;
    return this.filtersOpen;
  }

  setTagFilter(tagId, state) {
    const next = structuredClone(this.filters ?? defaultSpotlightFilterState());
    next.includeTagIds = next.includeTagIds.filter((id) => id !== tagId);
    next.excludeTagIds = next.excludeTagIds.filter((id) => id !== tagId);
    if (state === "include") next.includeTagIds.push(tagId);
    else if (state === "exclude") next.excludeTagIds.push(tagId);
    return this.#applyFilterUpdate(next);
  }

  setMatchMode(mode) {
    const next = structuredClone(this.filters ?? defaultSpotlightFilterState());
    next.matchMode = mode === "all" ? "all" : "any";
    return this.#applyFilterUpdate(next);
  }

  setSortBy(sortBy) {
    const next = structuredClone(this.filters ?? defaultSpotlightFilterState());
    next.sortBy = sortBy;
    return this.#applyFilterUpdate(next);
  }

  setDocumentType(documentType, enabled) {
    const next = structuredClone(this.filters ?? defaultSpotlightFilterState());
    const types = new Set(next.documentTypes);
    if (enabled) types.add(documentType);
    else types.delete(documentType);
    next.documentTypes = SPOTLIGHT_DOCUMENT_TYPES.filter((type) => types.has(type));
    return this.#applyFilterUpdate(next);
  }

  resetFilters() {
    this.filters = defaultSpotlightFilterState();
    this.selectedIndex = 0;
    if (this.compiledIndex) this.#recompute();
    return { filters: this.filters, filterCount: 0 };
  }

  moveSelection(delta) {
    if (!this.results.length) {
      this.selectedIndex = 0;
      return 0;
    }
    const len = this.results.length;
    this.selectedIndex = (((this.selectedIndex + delta) % len) + len) % len;
    return this.selectedIndex;
  }

  setSelectedIndex(index) {
    this.selectedIndex = clampIndex(index, this.results.length);
    return this.selectedIndex;
  }

  getSelectedRecord() {
    return this.results[this.selectedIndex] ?? null;
  }

  findRecordByUuid(uuid) {
    return this.results.find((candidate) => candidate.uuid === uuid) ?? null;
  }

  getFilterCount() {
    return countSpotlightFilters(this.filters);
  }

  refreshResults() {
    if (this.compiledIndex) this.#recompute();
    return this.results;
  }

  getViewModel({ localize, format, typeLabels = {}, iconForType = () => "fa-solid fa-file" }) {
    const filters = this.filters ?? defaultSpotlightFilterState();
    const include = new Set(filters.includeTagIds);
    const exclude = new Set(filters.excludeTagIds);
    const enabledTypes = new Set(filters.documentTypes);
    const filterCount = countSpotlightFilters(filters);
    const manualTags = this.compiledIndex?.manualTags ?? [];
    const automaticTags = this.compiledIndex?.automaticTags ?? [];
    const resultCount = this.results.length;

    return {
      query: this.query,
      filtersOpen: this.filtersOpen,
      filterCount,
      hasActiveFilters: Boolean(filterCount),
      filtersButtonLabel: format("FTAGS.Spotlight.FiltersButton", { count: filterCount }),
      filterTags: manualTags.map((tag) => ({
        ...tag,
        ignored: !include.has(tag.id) && !exclude.has(tag.id),
        included: include.has(tag.id),
        excluded: exclude.has(tag.id),
      })),
      hasFilterTags: Boolean(manualTags.length),
      automaticFilterTags: automaticTags.map((tag) => ({
        ...tag,
        ignored: !include.has(tag.id) && !exclude.has(tag.id),
        included: include.has(tag.id),
        excluded: exclude.has(tag.id),
      })),
      hasAutomaticTags: Boolean(automaticTags.length),
      automaticFiltersActive: automaticTags.some((tag) => include.has(tag.id) || exclude.has(tag.id)),
      matchModes: [
        { value: "any", key: "FTAGS.Spotlight.Match.Any" },
        { value: "all", key: "FTAGS.Spotlight.Match.All" },
      ].map(({ value, key }) => ({
        value,
        selected: filters.matchMode === value,
        label: localize(key),
      })),
      documentTypes: SPOTLIGHT_DOCUMENT_TYPES.map((value) => ({
        value,
        checked: enabledTypes.has(value),
        label: typeLabels[value] ?? value,
      })),
      sortOptions: [
        { value: "relevance", key: "FTAGS.Spotlight.Sort.Relevance" },
        { value: "name", key: "FTAGS.Spotlight.Sort.Name" },
        { value: "type", key: "FTAGS.Spotlight.Sort.Type" },
      ].map(({ value, key }) => ({
        value,
        selected: filters.sortBy === value,
        label: localize(key),
      })),
      results: this.results.map((record, index) => ({
        ...record,
        selected: index === this.selectedIndex,
        icon: record.isFolder ? "fa-solid fa-folder" : iconForType(record.entityType),
        resultId: `ftags-spotlight-result-${index}`,
        openLabel: format("FTAGS.Spotlight.Open", {
          name: record.name,
          metadata: record.metadata,
          tags: record.chipNamesText,
        }),
        tags: record.chips,
      })),
      hasIndex: Boolean(this.compiledIndex?.records.length),
      hasResults: Boolean(resultCount),
      hasNoTypes: !filters.documentTypes.length,
      resultCount,
      resultCountLabel: format("FTAGS.Spotlight.ResultCount", { count: resultCount }),
    };
  }

  #applyFilterUpdate(next) {
    this.filters = normalizeSpotlightFilterState(next, this.compiledIndex?.validTagIds ?? null);
    this.selectedIndex = 0;
    if (this.compiledIndex) this.#recompute();
    return {
      filters: this.filters,
      filterCount: countSpotlightFilters(this.filters),
    };
  }

  #recompute() {
    this.results = searchSpotlightIndex(this.compiledIndex, this.query, {
      limit: this.limit,
      filters: this.filters,
    });
    this.selectedIndex = clampIndex(this.selectedIndex, this.results.length);
  }
}

export function foldSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(COMBINING_MARKS, "")
    .toLocaleLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function makeAutoTag(facet, value, ru, aliases, language) {
  const english = facet === "cr" ? `CR ${ru}` : String(value).replace("veryRare", "very rare");
  return {
    id: `auto-dnd5e-${facet}-${String(value).replace(".", "_")}`,
    name: language?.startsWith("ru") ? (facet === "cr" ? `CR ${ru}` : ru) : english,
    color: "#8593A6",
    shape: "circle",
    automatic: true,
    facet,
    value,
    aliases: [...new Set([english, ru, ...aliases].map(String))],
  };
}

function buildMultiWordPhrases(automaticLibrary) {
  return automaticLibrary
    .flatMap((tag) =>
      tag.aliases
        .filter(() => tag.facet !== "cr")
        .flatMap((alias) => (tag.facet === "rarity" ? [alias, `${alias} редкости`] : [alias])),
    )
    .filter((alias) => alias.includes(" "))
    .map((alias) => ({ rawLength: alias.length, folded: foldSearchText(alias) }))
    .sort((a, b) => b.rawLength - a.rawLength);
}

function matchesSpotlightFilters(record, filters) {
  const documentType = record.documentName ?? (record.isFolder ? "Folder" : record.entityType);
  if (!filters.documentTypes.includes(documentType)) return false;

  const tagIds = record._spotlight.filterTagIds;
  if (filters.excludeTagIds.some((id) => tagIds.has(id))) return false;
  if (!filters.includeTagIds.length) return true;
  return filters.matchMode === "all"
    ? filters.includeTagIds.every((id) => tagIds.has(id))
    : filters.includeTagIds.some((id) => tagIds.has(id));
}

function compareMatches(left, right, sortBy) {
  const byName = left.search.name.localeCompare(right.search.name);
  const byType = String(left.record.typeLabel ?? "").localeCompare(String(right.record.typeLabel ?? ""));
  if (sortBy === "name") return byName || byType || left.search.order - right.search.order;
  if (sortBy === "type") return byType || byName || left.search.order - right.search.order;
  return left.score - right.score || byName || byType || left.search.order - right.search.order;
}

function tokenizeQuery(query, phrases = [], hasAutomaticSyntax = false) {
  const tokens = [];
  let remaining = String(query ?? "")
    .replace(/\s+/g, " ")
    .trim();
  while (remaining) {
    const cr = remaining.match(/^#?(?:cr|по)(?:\s*[:=<>]|\s+\d)/i);
    if (cr && hasAutomaticSyntax) {
      const match = remaining.match(
        /^#?(?:cr|по)\s*:?\s*(<=|>=|=|<|>)?\s*(\d+(?:[.,]\d+)?(?:\/\d+)?)(?=\s|$)/i,
      );
      if (match) {
        tokens.push({ cr: true, operator: match[1] ?? "=", value: parseCR(match[2]) });
        remaining = remaining.slice(match[0].length).trimStart();
        continue;
      }
    }
    const tagOnly = remaining.startsWith("#");
    if (tagOnly) remaining = remaining.slice(1);
    const quoted = remaining.match(/^"([^"]*)"/);
    const folded = foldSearchText(remaining);
    const phrase =
      !quoted && phrases.find((entry) => folded === entry.folded || folded.startsWith(`${entry.folded} `));
    const raw =
      quoted?.[1] ?? (phrase ? remaining.slice(0, phrase.rawLength) : (remaining.match(/^\S+/)?.[0] ?? ""));
    const value = foldSearchText(raw);
    if (value) tokens.push({ tagOnly, value });
    remaining = remaining.slice(quoted ? quoted[0].length : raw.length).trimStart();
  }
  return tokens;
}

function scoreToken(search, token) {
  if (token.cr) {
    const value = search.cr;
    if (value == null || token.value == null) return null;
    const matches = {
      "=": value === token.value,
      "<": value < token.value,
      ">": value > token.value,
      "<=": value <= token.value,
      ">=": value >= token.value,
    }[token.operator];
    return matches ? 0 : null;
  }
  const candidates = [];
  if (!token.tagOnly) candidates.push(scoreValue(search.name, token.value, 0));
  for (const tag of search.tags) candidates.push(scoreValue(tag, token.value, token.tagOnly ? 0 : 40));
  if (search.automatic?.includes(token.value)) candidates.push(token.tagOnly ? 0 : 40);
  const valid = candidates.filter((score) => score !== null);
  return valid.length ? Math.min(...valid) : null;
}

function scoreValue(candidate, token, base) {
  if (candidate === token) return base;
  if (candidate.startsWith(token)) return base + 10;
  if (candidate.split(" ").some((word) => word.startsWith(token))) return base + 20;
  if (candidate.includes(token)) return base + 30;
  return null;
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

function arraysEqual(left, right) {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    left.length === right.length &&
    left.every((v, i) => v === right[i])
  );
}

function clampIndex(index, length) {
  if (!length) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

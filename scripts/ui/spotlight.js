import {MODULE_ID, SPOTLIGHT_DOCUMENT_TYPES} from "../constants.js";
import {countSpotlightFilters, defaultSpotlightFilterState} from "../core/model.js";
import {tagService} from "../runtime.js";
import {notifyError} from "./notifications.js";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;
const RESULT_LIMIT = 100;
const TYPE_LOCALIZATION_KEYS = Object.freeze({
  Actor: "FTAGS.Types.Actor",
  Item: "FTAGS.Types.Item",
  Scene: "FTAGS.Types.Scene",
  JournalEntry: "FTAGS.Types.JournalEntry",
  RollTable: "FTAGS.Types.RollTable",
  Cards: "FTAGS.Types.Cards",
  Playlist: "FTAGS.Types.Playlist",
  Macro: "FTAGS.Types.Macro",
  Folder: "FTAGS.Types.Folder"
});

export class SpotlightApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ftags-spotlight",
    classes: ["ftags-app", "ftags-spotlight-app"],
    position: {width: 680, height: "auto"},
    window: {icon: "fa-solid fa-magnifying-glass", resizable: true},
    actions: {
      openResult: this.#openResult,
      resetFilters: this.#resetFilters,
      toggleFilters: this.#toggleFilters
    }
  };

  static PARTS = {
    search: {template: `modules/${MODULE_ID}/templates/spotlight-search.hbs`},
    results: {
      template: `modules/${MODULE_ID}/templates/spotlight-results.hbs`,
      id: "results",
      scrollable: [".ftags-spotlight__list"]
    }
  };

  constructor(options = {}) {
    super(options);
    this.query = "";
    this.selectedIndex = 0;
    this.index = null;
    this.results = [];
    this.filters = null;
    this.filtersOpen = false;
    this.searchTimer = null;
    this.filterSaveTimer = null;
  }

  get title() {
    return game.i18n.localize("FTAGS.Spotlight.Title");
  }

  _canRender(options) {
    return Boolean(game.user?.isGM) && super._canRender(options);
  }

  markDirty() {
    this.index = null;
    this.filters = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.index ??= tagService.buildSpotlightIndex();
    this.filters ??= await tagService.getSpotlightFilters();
    this.results = tagService.searchSpotlight(this.index, this.query, {
      limit: RESULT_LIMIT,
      filters: this.filters
    });
    this.selectedIndex = clampIndex(this.selectedIndex, this.results.length);
    const resultCount = this.results.length;
    return {
      ...context,
      query: this.query,
      ...prepareFilters(this.filters, this.filtersOpen),
      results: this.results.map((record, index) => prepareResult(record, index === this.selectedIndex, index)),
      hasIndex: Boolean(this.index.length),
      hasResults: Boolean(resultCount),
      resultCount,
      resultCountLabel: game.i18n.format("FTAGS.Spotlight.ResultCount", {count: resultCount})
    };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    queueMicrotask(() => this.focusSearch());
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const searchInput = this.parts.search?.querySelector("[data-ftags-spotlight-search]");
    if (searchInput && !searchInput.dataset.ftagsBound) {
      searchInput.dataset.ftagsBound = "true";
      searchInput.addEventListener("input", () => {
        this.query = searchInput.value;
        this.selectedIndex = 0;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => void this.render({parts: ["results"]}), 75);
      });
      searchInput.addEventListener("keydown", (event) => this.#onKeyDown(event));
    }

    const searchPart = this.parts.search;
    if (searchPart && !searchPart.dataset.ftagsFiltersBound) {
      searchPart.dataset.ftagsFiltersBound = "true";
      for (const select of searchPart.querySelectorAll("[data-ftags-tag-filter]")) {
        select.addEventListener("change", () => this.#updateTagFilter(select.dataset.tagId, select.value));
      }
      searchPart.querySelector("[data-ftags-match-mode]")?.addEventListener("change", (event) => {
        this.filters.matchMode = event.currentTarget.value === "all" ? "all" : "any";
        this.#filtersChanged();
      });
      searchPart.querySelector("[data-ftags-sort]")?.addEventListener("change", (event) => {
        this.filters.sortBy = event.currentTarget.value;
        this.#filtersChanged();
      });
      for (const checkbox of searchPart.querySelectorAll("[data-ftags-document-type]")) {
        checkbox.addEventListener("change", () => this.#updateDocumentType(checkbox.value, checkbox.checked));
      }
    }

    for (const [index, result] of [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])].entries()) {
      result.addEventListener("pointerenter", () => {
        this.selectedIndex = index;
        this.#syncSelection();
      });
    }
    this.#syncSelection();
  }

  async _preClose(options) {
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
    await super._preClose(options);
  }

  focusSearch() {
    const input = this.parts.search?.querySelector("[data-ftags-spotlight-search]");
    input?.focus();
    input?.select();
  }

  async activate({includeTagId = null} = {}) {
    this.filters ??= await tagService.getSpotlightFilters();
    if (includeTagId) {
      this.filters.excludeTagIds = this.filters.excludeTagIds.filter((id) => id !== includeTagId);
      if (!this.filters.includeTagIds.includes(includeTagId)) this.filters.includeTagIds.push(includeTagId);
      this.filters = await tagService.setSpotlightFilters(this.filters);
      this.filtersOpen = true;
      this.selectedIndex = 0;
    }

    if (this.rendered) {
      this.bringToFront();
      if (includeTagId) await this.render({parts: ["search", "results"]});
      this.focusSearch();
      return this;
    }
    await this.render({force: true});
    return this;
  }

  #updateTagFilter(tagId, state) {
    this.filters.includeTagIds = this.filters.includeTagIds.filter((id) => id !== tagId);
    this.filters.excludeTagIds = this.filters.excludeTagIds.filter((id) => id !== tagId);
    if (state === "include") this.filters.includeTagIds.push(tagId);
    else if (state === "exclude") this.filters.excludeTagIds.push(tagId);
    this.#filtersChanged();
  }

  #updateDocumentType(documentType, enabled) {
    const types = new Set(this.filters.documentTypes);
    if (enabled) types.add(documentType);
    else types.delete(documentType);
    this.filters.documentTypes = SPOTLIGHT_DOCUMENT_TYPES.filter((type) => types.has(type));
    this.#filtersChanged();
  }

  #filtersChanged() {
    this.selectedIndex = 0;
    this.#syncFilterCount();
    clearTimeout(this.filterSaveTimer);
    this.filterSaveTimer = setTimeout(() => {
      void tagService.setSpotlightFilters(this.filters).catch((error) => notifyError(error));
    }, 120);
    void this.render({parts: ["results"]});
  }

  #syncFilterCount() {
    const count = countSpotlightFilters(this.filters);
    const button = this.parts.search?.querySelector("[data-ftags-filter-toggle]");
    const badge = button?.querySelector("[data-ftags-filter-count]");
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = !count;
    }
    button?.setAttribute("aria-label", game.i18n.format("FTAGS.Spotlight.FiltersButton", {count}));
  }

  #onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      void this.close();
      return;
    }
    if (!this.results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
      this.#syncSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
      this.#syncSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void this.openRecord(this.results[this.selectedIndex]);
    }
  }

  #syncSelection() {
    const rows = [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])];
    rows.forEach((row, index) => {
      const selected = index === this.selectedIndex;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
      if (selected) row.scrollIntoView({block: "nearest"});
    });
    const selected = rows[this.selectedIndex];
    const input = this.parts.search?.querySelector("[data-ftags-spotlight-search]");
    if (selected) input?.setAttribute("aria-activedescendant", selected.id);
    else input?.removeAttribute("aria-activedescendant");
  }

  async openRecord(record) {
    if (!record) return;
    let document = record.document;
    if (!document && record.uuid) {
      try {
        document = await fromUuid(record.uuid);
      } catch (error) {
        notifyError(error);
        return;
      }
    }
    if (!document) return;
    await this.close();
    document.sheet?.render(true);
  }

  /** @this {SpotlightApp} */
  static async #openResult(_event, target) {
    const record = this.results.find((candidate) => candidate.uuid === target.dataset.uuid);
    return this.openRecord(record);
  }

  /** @this {SpotlightApp} */
  static #toggleFilters(_event, target) {
    this.filtersOpen = !this.filtersOpen;
    target.setAttribute("aria-expanded", String(this.filtersOpen));
    const panel = this.parts.search?.querySelector("[data-ftags-filter-panel]");
    if (panel) panel.hidden = !this.filtersOpen;
  }

  /** @this {SpotlightApp} */
  static async #resetFilters() {
    clearTimeout(this.filterSaveTimer);
    this.filters = await tagService.setSpotlightFilters(defaultSpotlightFilterState());
    this.selectedIndex = 0;
    return this.render({parts: ["search", "results"]});
  }
}

let activeSpotlight = null;

export function registerSpotlightKeybinding() {
  game.keybindings.register(MODULE_ID, "openSpotlight", {
    name: "FTAGS.Keybindings.SpotlightName",
    hint: "FTAGS.Keybindings.SpotlightHint",
    editable: [],
    restricted: true,
    onDown: () => {
      if (!game.user?.isGM) return false;
      void openSpotlight();
      return true;
    }
  });
}

export function openSpotlight(options = {}) {
  if (!game.user?.isGM) return null;
  if (!activeSpotlight?.rendered) activeSpotlight = new SpotlightApp();
  void activeSpotlight.activate(options).catch((error) => notifyError(error));
  return activeSpotlight;
}

function prepareFilters(filters, filtersOpen) {
  const include = new Set(filters.includeTagIds);
  const exclude = new Set(filters.excludeTagIds);
  const enabledTypes = new Set(filters.documentTypes);
  const filterCount = countSpotlightFilters(filters);
  const tags = tagService.listTags();
  return {
    filtersOpen,
    filterCount,
    hasActiveFilters: Boolean(filterCount),
    filtersButtonLabel: game.i18n.format("FTAGS.Spotlight.FiltersButton", {count: filterCount}),
    filterTags: tags.map((tag) => ({
      ...tag,
      ignored: !include.has(tag.id) && !exclude.has(tag.id),
      included: include.has(tag.id),
      excluded: exclude.has(tag.id)
    })),
    hasFilterTags: Boolean(tags.length),
    matchModes: [
      {value: "any", key: "FTAGS.Spotlight.Match.Any"},
      {value: "all", key: "FTAGS.Spotlight.Match.All"}
    ].map(({value, key}) => ({
      value,
      selected: filters.matchMode === value,
      label: game.i18n.localize(key)
    })),
    documentTypes: SPOTLIGHT_DOCUMENT_TYPES.map((value) => ({
      value,
      checked: enabledTypes.has(value),
      label: game.i18n.localize(TYPE_LOCALIZATION_KEYS[value])
    })),
    sortOptions: [
      {value: "relevance", key: "FTAGS.Spotlight.Sort.Relevance"},
      {value: "name", key: "FTAGS.Spotlight.Sort.Name"},
      {value: "type", key: "FTAGS.Spotlight.Sort.Type"}
    ].map(({value, key}) => ({
      value,
      selected: filters.sortBy === value,
      label: game.i18n.localize(key)
    }))
  };
}

function prepareResult(record, selected, index) {
  const documentType = record.isFolder ? "Folder" : record.entityType;
  const typeLabel = game.i18n.localize(TYPE_LOCALIZATION_KEYS[documentType]);
  const folderContentType = record.isFolder
    ? game.i18n.localize(TYPE_LOCALIZATION_KEYS[record.entityType])
    : "";
  const metadata = [typeLabel, folderContentType, record.path].filter(Boolean).join(" · ");
  return {
    ...record,
    selected,
    icon: record.isFolder ? "fa-solid fa-folder" : (CONFIG[record.entityType]?.sidebarIcon ?? "fa-solid fa-file"),
    resultId: `ftags-spotlight-result-${index}`,
    metadata,
    openLabel: game.i18n.format("FTAGS.Spotlight.Open", {
      name: record.name,
      metadata,
      tags: record.tags.map((tag) => tag.name).join(", ")
    }),
    tags: record.tags
  };
}

function clampIndex(index, length) {
  if (!length) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

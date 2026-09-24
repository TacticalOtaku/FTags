import {MAX_VISIBLE_TAGS, MODULE_ID, SPOTLIGHT_DOCUMENT_TYPES, TYPE_LOCALIZATION_KEYS} from "../constants.js";
import {chipColors, countSpotlightFilters, defaultSpotlightFilterState} from "../core/model.js";
import {tagService, tagRepository} from "../runtime.js";
import {notifyError, notifyWarn} from "./notifications.js";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;
const RESULT_LIMIT = 100;
const SEARCH_DELAY = 75;
const FILTER_SAVE_DELAY = 120;

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
    search: {
      template: `modules/${MODULE_ID}/templates/spotlight-search.hbs`,
      scrollable: [".ftags-spotlight__filter-panel"]
    },
    results: {
      template: `modules/${MODULE_ID}/templates/spotlight-results.hbs`,
      id: "results",
      scrollable: [".ftags-spotlight__list"]
    }
  };

  #indexTask = null;
  #indexGeneration = 0;
  #indexStale = false;
  #savingFilters = null;
  #activation = Promise.resolve();

  constructor(options = {}) {
    super(options);
    this.query = "";
    this.selectedIndex = 0;
    this.index = null;
    this.results = [];
    this.total = 0;
    this.filters = null;
    this.filtersOpen = false;
    this.automaticOpen = null;
    this.searchTimer = null;
    this.filterSaveTimer = null;
  }

  get title() {
    return game.i18n.localize("FTAGS.Spotlight.Title");
  }

  /** True while an activation is queued or running, so a repeated shortcut reuses this window. */
  get isActivating() {
    return Boolean(this.#pendingActivations);
  }

  #pendingActivations = 0;

  _canRender(options) {
    return Boolean(game.user?.isGM) && super._canRender(options);
  }

  /**
   * Rebuild the search index after documents, tags or compendiums change. The previous results
   * stay on screen until the new index is ready, so frequent updates do not flash a loading
   * state. Local filter edits are kept; with `dictionary` they are limited to existing tags.
   */
  invalidateIndex({dictionary = false} = {}) {
    this.#indexGeneration += 1;
    this.#indexStale = true;
    if (dictionary && this.filters) this.filters = tagService.normalizeSpotlightFilters(this.filters);
    if (!this.rendered) return;
    if (dictionary) void this.refresh({parts: ["search"]});
    this.#ensureIndex();
  }

  /** Adopt filters saved elsewhere, unless this window has its own edits in flight. */
  syncFiltersFromSettings() {
    if (!this.rendered || this.filterSaveTimer || this.#savingFilters) return;
    const next = tagService.readSpotlightFilters();
    if (JSON.stringify(next) === JSON.stringify(this.filters)) return;
    this.filters = next;
    void this.refresh({parts: ["search", "results"]});
  }

  /** Render parts while keeping focus and caret in the search field. */
  async refresh({parts = ["results"]} = {}) {
    if (!this.rendered) return this;
    const input = this.#searchInput();
    const focused = parts.includes("search") && input && document.activeElement === input;
    const selection = focused ? [input.selectionStart, input.selectionEnd] : null;
    await this.render({parts});
    if (focused) {
      const next = this.#searchInput();
      next?.focus();
      if (selection && next) next.setSelectionRange(...selection);
    }
    return this;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.filters = tagService.normalizeSpotlightFilters(this.filters ?? tagService.readSpotlightFilters());
    this.#ensureIndex();
    const isLoading = !this.index;
    const {records, total} = isLoading
      ? {records: [], total: 0}
      : tagService.searchSpotlight(this.index, this.query, {limit: RESULT_LIMIT, filters: this.filters});
    this.results = records;
    this.total = total;
    this.selectedIndex = clampIndex(this.selectedIndex, this.results.length);
    const resultCount = this.results.length;
    return {
      ...context,
      query: this.query,
      ...prepareFilters(this.filters, this.filtersOpen, this.automaticOpen),
      results: this.results.map((record, index) => prepareResult(record, index === this.selectedIndex, index)),
      isLoading,
      hasIndex: Boolean(this.index?.length),
      hasResults: Boolean(resultCount),
      hasNoTypes: !this.filters.documentTypes.length,
      resultCount,
      resultCountLabel: total > resultCount
        ? game.i18n.format("FTAGS.Spotlight.ResultCountLimited", {count: resultCount, total})
        : game.i18n.format("FTAGS.Spotlight.ResultCount", {count: resultCount})
    };
  }

  /**
   * The window opens at once with a loading state; compendium indexes can take seconds on the
   * first search. An invalidation during a build discards that result; the render that follows
   * starts the next build.
   */
  #ensureIndex() {
    if ((this.index && !this.#indexStale) || this.#indexTask) return;
    const generation = this.#indexGeneration;
    this.#indexTask = (async () => {
      try {
        const failures = await tagRepository.prepareCompendiumIndexes();
        if (failures.length) notifyWarn("FTAGS.Spotlight.IndexFailed", {packs: failures.join(", ")});
        const index = tagService.buildSpotlightIndex();
        if (generation === this.#indexGeneration) {
          this.index = index;
          this.#indexStale = false;
        }
      } catch (error) {
        notifyError(error);
        if (generation === this.#indexGeneration) {
          this.index ??= [];
          this.#indexStale = false;
        }
      } finally {
        this.#indexTask = null;
        this.#renderResultsSoon();
      }
    })();
  }

  #renderResultsSoon() {
    setTimeout(() => {
      if (this.rendered) void this.render({parts: ["results"]});
      else if (this.state === ApplicationV2.RENDER_STATES.RENDERING) this.#renderResultsSoon();
    }, 0);
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    queueMicrotask(() => this.focusSearch());
  }

  async _onRender(context, options) {
    await super._onRender(context, options);
    const searchInput = this.#searchInput();
    if (searchInput && !searchInput.dataset.ftagsBound) {
      searchInput.dataset.ftagsBound = "true";
      searchInput.addEventListener("input", () => {
        this.query = searchInput.value;
        this.selectedIndex = 0;
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => void this.render({parts: ["results"]}), SEARCH_DELAY);
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
      searchPart.querySelector("[data-ftags-automatic]")?.addEventListener("toggle", (event) => {
        this.automaticOpen = event.currentTarget.open;
      });
    }

    for (const [index, result] of [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])].entries()) {
      result.addEventListener("pointerenter", () => {
        this.selectedIndex = index;
        // Scrolling here would move another row under a resting pointer and keep the list moving.
        this.#syncSelection({scroll: false});
      });
    }
    this.#syncSelection({scroll: true});
    this.keepInViewport();
  }

  /**
   * The window is centred while it is still short and then grows downwards as filters open or
   * results arrive, so nudge it back up whenever it would run past the bottom of the screen.
   */
  keepInViewport() {
    const element = this.element;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (!rect.height) return;
    const overflow = Math.round(rect.bottom - window.innerHeight + 8);
    if (overflow <= 0) return;
    this.setPosition({top: Math.max(8, Math.round(rect.top - overflow))});
  }

  async _preClose(options) {
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
    // A filter change made just before closing is still worth keeping.
    if (this.filterSaveTimer) void this.#saveFilters();
    await super._preClose(options);
  }

  focusSearch() {
    const input = this.#searchInput();
    input?.focus();
    input?.select();
  }

  #searchInput() {
    return this.parts?.search?.querySelector("[data-ftags-spotlight-search]") ?? null;
  }

  /** Activations run one after another, so a repeated shortcut cannot start a second render. */
  activate(options = {}) {
    this.#pendingActivations += 1;
    const run = this.#activation.then(() => this.#activate(options));
    this.#activation = run.catch(() => {}).finally(() => { this.#pendingActivations -= 1; });
    return run;
  }

  async #activate({includeTagId = null} = {}) {
    this.filters ??= tagService.readSpotlightFilters();
    if (includeTagId) {
      this.filters.excludeTagIds = this.filters.excludeTagIds.filter((id) => id !== includeTagId);
      if (!this.filters.includeTagIds.includes(includeTagId)) this.filters.includeTagIds.push(includeTagId);
      this.filtersOpen = true;
      this.selectedIndex = 0;
      await this.#saveFilters();
    }

    if (this.rendered) {
      if (this.minimized) await this.maximize();
      this.bringToFront();
      if (includeTagId) await this.refresh({parts: ["search", "results"]});
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
    this.filterSaveTimer = setTimeout(() => void this.#saveFilters(), FILTER_SAVE_DELAY);
    void this.render({parts: ["results"]});
  }

  /**
   * Persist the current filters. The in-memory object stays the source of truth, so edits made
   * while the write is in flight are neither lost nor overwritten by the saved copy.
   */
  async #saveFilters() {
    clearTimeout(this.filterSaveTimer);
    this.filterSaveTimer = null;
    const save = tagService.setSpotlightFilters(structuredClone(this.filters));
    this.#savingFilters = save;
    try {
      await save;
    } catch (error) {
      notifyError(error);
    } finally {
      if (this.#savingFilters === save) this.#savingFilters = null;
    }
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
      this.#syncSelection({scroll: true});
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
      this.#syncSelection({scroll: true});
    } else if (event.key === "Enter") {
      event.preventDefault();
      void this.openRecord(this.results[this.selectedIndex]);
    }
  }

  #syncSelection({scroll = false} = {}) {
    const rows = [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])];
    rows.forEach((row, index) => {
      const selected = index === this.selectedIndex;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
      if (selected && scroll) row.scrollIntoView({block: "nearest"});
    });
    const selected = rows[this.selectedIndex];
    const input = this.#searchInput();
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
    await openDocument(document);
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
    this.keepInViewport();
  }

  /** @this {SpotlightApp} */
  static async #resetFilters() {
    this.filters = defaultSpotlightFilterState();
    this.automaticOpen = null;
    this.selectedIndex = 0;
    await this.#saveFilters();
    await this.render({parts: ["search", "results"]});
    this.focusSearch();
  }
}

/**
 * Folders are revealed in their directory rather than opened in the folder configuration, which
 * mirrors what a click on a folder means in Foundry. Everything else opens its sheet.
 */
async function openDocument(document) {
  if (document.documentName === "Folder" && await revealFolder(document)) return;
  await document.sheet?.render({force: true});
}

async function revealFolder(folder) {
  try {
    const expanded = game.folders?._expanded;
    if (!expanded || typeof expanded !== "object") return false;
    // Foundry tracks sidebar expansion by folder uuid.
    for (const current of [folder, ...(folder.ancestors ?? [])]) {
      if (current?.uuid) expanded[current.uuid] = true;
    }

    let directory;
    if (folder.pack) {
      const pack = tagRepository.getPack(folder.pack);
      if (!pack) return false;
      pack.render(true);
      directory = await waitFor(() => [...(pack.apps ?? [])].find((app) => app.rendered));
    } else {
      directory = tagRepository.getWorldCollection(folder.type)?.directory;
      if (!directory) return false;
      if (directory.isPopout || !ui.sidebar) await directory.render({force: true});
      else {
        ui.sidebar.changeTab(directory.tabName, "primary");
        await directory.render();
      }
    }

    const row = directory?.element?.querySelector(`[data-folder-id="${CSS.escape(folder.id)}"]`);
    if (!row) return false;
    row.scrollIntoView({block: "center"});
    row.classList.add("ftags-revealed");
    setTimeout(() => row.classList.remove("ftags-revealed"), 1600);
    return true;
  } catch (error) {
    console.warn("FTags: Could not reveal folder", error);
    return false;
  }
}

async function waitFor(check, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return null;
}

let activeSpotlight = null;

export function registerSpotlightKeybinding() {
  game.keybindings.register(MODULE_ID, "openSpotlight", {
    name: "FTAGS.Keybindings.SpotlightName",
    hint: "FTAGS.Keybindings.SpotlightHint",
    editable: [{key: "KeyF", modifiers: ["Control", "Shift"]}],
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
  // Reuse a window that is open or still opening; replace one whose element left the DOM.
  const app = activeSpotlight;
  const usable = app && (app.rendered ? app.element?.isConnected : app.isActivating);
  if (!usable) activeSpotlight = new SpotlightApp();
  void activeSpotlight.activate(options).catch((error) => notifyError(error));
  return activeSpotlight;
}

function prepareFilters(filters, filtersOpen, automaticOpen) {
  const include = new Set(filters.includeTagIds);
  const exclude = new Set(filters.excludeTagIds);
  const enabledTypes = new Set(filters.documentTypes);
  const filterCount = countSpotlightFilters(filters);
  const tags = tagService.listSearchTags();
  const withState = (tag) => ({
    ...tag,
    ignored: !include.has(tag.id) && !exclude.has(tag.id),
    included: include.has(tag.id),
    excluded: exclude.has(tag.id)
  });
  const automaticFiltersActive = tags.some(tag => tag.automatic && (include.has(tag.id) || exclude.has(tag.id)));
  return {
    filtersOpen,
    filterCount,
    hasActiveFilters: Boolean(filterCount),
    filtersButtonLabel: game.i18n.format("FTAGS.Spotlight.FiltersButton", {count: filterCount}),
    filterTags: tags.filter(tag => !tag.automatic).map(withState),
    hasFilterTags: tags.some(tag => !tag.automatic),
    automaticFilterTags: tags.filter(tag => tag.automatic).map(withState),
    hasAutomaticTags: tags.some(tag => tag.automatic),
    automaticOpen: automaticOpen ?? automaticFiltersActive,
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
  const manualTags = record.tags.filter(tag => !tag.automatic);
  const hiddenTags = manualTags.slice(MAX_VISIBLE_TAGS);
  return {
    ...record,
    selected,
    icon: record.isFolder ? "fa-solid fa-folder" : (CONFIG[record.entityType]?.sidebarIcon ?? "fa-solid fa-file"),
    resultId: `ftags-spotlight-result-${index}`,
    metadata,
    openLabel: game.i18n.format("FTAGS.Spotlight.Open", {
      name: record.name,
      metadata,
      tags: manualTags.map((tag) => tag.name).join(", ")
    }),
    tags: manualTags.slice(0, MAX_VISIBLE_TAGS).map((tag) => ({...tag, ...chipColors(tag.color)})),
    overflow: hiddenTags.length ? {
      label: `+${hiddenTags.length}`,
      title: hiddenTags.map((tag) => tag.name).join(", ")
    } : null
  };
}

function clampIndex(index, length) {
  if (!length) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

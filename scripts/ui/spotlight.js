import { MODULE_ID } from "../constants.js";
import { SpotlightSession } from "../core/spotlight.js";
import { notifyError } from "./notifications.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const RESULT_LIMIT = 100;

export class SpotlightApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ftags-spotlight",
    classes: ["ftags-app", "ftags-spotlight-app"],
    position: { width: 680, height: "auto" },
    window: { icon: "fa-solid fa-magnifying-glass", resizable: true },
    actions: {
      openResult: this.#openResult,
      resetFilters: this.#resetFilters,
      toggleFilters: this.#toggleFilters,
    },
  };

  static PARTS = {
    search: { template: `modules/${MODULE_ID}/templates/spotlight-search.hbs` },
    results: {
      template: `modules/${MODULE_ID}/templates/spotlight-results.hbs`,
      id: "results",
      scrollable: [".ftags-spotlight__list"],
    },
  };

  #pendingFilterSave = null;

  constructor({ workspace = null, coordinator = null, ...options } = {}) {
    super(options);
    if (!workspace) throw new Error("SpotlightApp requires a workspace");
    this.workspace = workspace;
    this.coordinator = coordinator;
    this.session = new SpotlightSession({ limit: RESULT_LIMIT });
    this.searchTimer = null;
    this.filterSaveTimer = null;
  }

  get title() {
    return this.workspace.localize("FTAGS.Spotlight.Title");
  }

  get query() {
    return this.session.query;
  }

  set query(value) {
    this.session.setQuery(value);
  }

  get filtersOpen() {
    return this.session.filtersOpen;
  }

  set filtersOpen(value) {
    this.session.filtersOpen = Boolean(value);
  }

  get results() {
    return this.session.results;
  }

  get selectedIndex() {
    return this.session.selectedIndex;
  }

  _canRender(options) {
    return this.workspace.isGM() && super._canRender(options);
  }

  markDirty({ index = true, filters = false } = {}) {
    this.session.invalidate({ index, filters });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    if (this.session.needsIndex()) {
      const failures = await this.workspace.prepareCompendiumIndexes();
      if (failures.length) {
        ui.notifications.warn(
          this.workspace.format("FTAGS.Spotlight.IndexFailed", { packs: failures.join(", ") }),
        );
      }
      const dataset = this.workspace.getSpotlightDataset();
      this.session.setIndex(dataset.records, dataset);
    }
    if (this.session.needsFilters()) {
      this.session.setFilters(this.workspace.getSpotlightFilters());
    }
    this.session.refreshResults();

    const viewModel = this.session.getViewModel({
      localize: (key) => this.workspace.localize(key),
      format: (key, data) => this.workspace.format(key, data),
      typeLabels: this.workspace.getTypeLabels(),
      iconForType: (documentType) => this.workspace.iconForType(documentType),
    });

    return {
      ...context,
      ...viewModel,
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
        this.session.setQuery(searchInput.value);
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => void this.render({ parts: ["results"] }), 75);
      });
      searchInput.addEventListener("keydown", (event) => this.#onKeyDown(event));
    }

    const searchPart = this.parts.search;
    if (searchPart && !searchPart.dataset.ftagsFiltersBound) {
      searchPart.dataset.ftagsFiltersBound = "true";
      for (const select of searchPart.querySelectorAll("[data-ftags-tag-filter]")) {
        select.addEventListener("change", () => {
          const update = this.session.setTagFilter(select.dataset.tagId, select.value);
          this.#onFiltersMutated(update);
        });
      }
      searchPart.querySelector("[data-ftags-match-mode]")?.addEventListener("change", (event) => {
        const update = this.session.setMatchMode(event.currentTarget.value);
        this.#onFiltersMutated(update);
      });
      searchPart.querySelector("[data-ftags-sort]")?.addEventListener("change", (event) => {
        const update = this.session.setSortBy(event.currentTarget.value);
        this.#onFiltersMutated(update);
      });
      for (const checkbox of searchPart.querySelectorAll("[data-ftags-document-type]")) {
        checkbox.addEventListener("change", () => {
          const update = this.session.setDocumentType(checkbox.value, checkbox.checked);
          this.#onFiltersMutated(update);
        });
      }
    }

    const rows = [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])];
    for (const [index, result] of rows.entries()) {
      result.addEventListener("pointerenter", () => {
        this.session.setSelectedIndex(index);
        this.#syncSelection();
      });
    }
    this.#syncSelection();
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
    this.setPosition({ top: Math.max(8, Math.round(rect.top - overflow)) });
  }

  async _preClose(options) {
    clearTimeout(this.searchTimer);
    this.searchTimer = null;
    clearTimeout(this.filterSaveTimer);
    this.filterSaveTimer = null;
    const pending = this.#pendingFilterSave;
    this.#pendingFilterSave = null;
    if (pending) {
      await this.#persistFilters(pending).catch((error) => notifyError(error));
    }
    await super._preClose(options);
  }

  focusSearch() {
    const input = this.parts.search?.querySelector("[data-ftags-spotlight-search]");
    input?.focus();
    input?.select();
  }

  async activate({ includeTagId = null } = {}) {
    if (this.session.needsFilters()) {
      this.session.setFilters(this.workspace.getSpotlightFilters());
    }
    const { filtersChanged, filters } = this.session.activate({ includeTagId });
    if (filtersChanged) {
      clearTimeout(this.filterSaveTimer);
      this.filterSaveTimer = null;
      this.#pendingFilterSave = null;
      await this.#persistFilters(filters);
    }

    if (this.rendered) {
      this.bringToFront();
      if (includeTagId) await this.render({ parts: ["search", "results"] });
      this.focusSearch();
      return this;
    }
    await this.render({ force: true });
    return this;
  }

  async openRecord(record) {
    if (!record) return;
    try {
      await this.workspace.openTarget(record, {
        onBeforeOpen: () => this.close(),
      });
    } catch (error) {
      notifyError(error);
    }
  }

  #onFiltersMutated({ filters, filterCount }) {
    this.#syncFilterCount(filterCount);
    clearTimeout(this.filterSaveTimer);
    this.#pendingFilterSave = filters;
    this.filterSaveTimer = setTimeout(() => {
      const pending = this.#pendingFilterSave;
      this.filterSaveTimer = null;
      this.#pendingFilterSave = null;
      if (!pending) return;
      void this.#persistFilters(pending).catch((error) => notifyError(error));
    }, 120);
    void this.render({ parts: ["results"] });
  }

  async #persistFilters(filters) {
    this.coordinator?.noteSpotlightFiltersSaved?.(filters);
    const saved = await this.workspace.saveSpotlightFilters(filters);
    this.session.setFilters(saved);
    return saved;
  }

  #syncFilterCount(count) {
    const button = this.parts.search?.querySelector("[data-ftags-filter-toggle]");
    const badge = button?.querySelector("[data-ftags-filter-count]");
    if (badge) {
      badge.textContent = String(count);
      badge.hidden = !count;
    }
    button?.setAttribute("aria-label", this.workspace.format("FTAGS.Spotlight.FiltersButton", { count }));
  }

  #onKeyDown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      void this.close();
      return;
    }
    if (!this.session.results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      this.session.moveSelection(1);
      this.#syncSelection();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      this.session.moveSelection(-1);
      this.#syncSelection();
    } else if (event.key === "Enter") {
      event.preventDefault();
      void this.openRecord(this.session.getSelectedRecord());
    }
  }

  #syncSelection() {
    const rows = [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])];
    rows.forEach((row, index) => {
      const selected = index === this.session.selectedIndex;
      row.classList.toggle("is-selected", selected);
      row.setAttribute("aria-selected", String(selected));
      if (selected) row.scrollIntoView({ block: "nearest" });
    });
    const selected = rows[this.session.selectedIndex];
    const input = this.parts.search?.querySelector("[data-ftags-spotlight-search]");
    if (selected) input?.setAttribute("aria-activedescendant", selected.id);
    else input?.removeAttribute("aria-activedescendant");
  }

  /** @this {SpotlightApp} */
  static async #openResult(_event, target) {
    const record = this.session.findRecordByUuid(target.dataset.uuid);
    return this.openRecord(record);
  }

  /** @this {SpotlightApp} */
  static #toggleFilters(_event, target) {
    const open = this.session.toggleFilters();
    target.setAttribute("aria-expanded", String(open));
    const panel = this.parts.search?.querySelector("[data-ftags-filter-panel]");
    if (panel) panel.hidden = !open;
    this.keepInViewport();
  }

  /** @this {SpotlightApp} */
  static async #resetFilters() {
    clearTimeout(this.filterSaveTimer);
    this.filterSaveTimer = null;
    this.#pendingFilterSave = null;
    const { filters } = this.session.resetFilters();
    await this.#persistFilters(filters);
    return this.render({ parts: ["search", "results"] });
  }
}

export function createSpotlightController({ workspace, coordinator = null } = {}) {
  let activeSpotlight = null;

  function openSpotlight(options = {}) {
    if (!workspace?.isGM?.()) return null;
    // A cached instance whose element left the DOM would never render again, so replace it.
    if (!activeSpotlight?.rendered || !activeSpotlight.element?.isConnected) {
      activeSpotlight = new SpotlightApp({ workspace, coordinator });
    }
    void activeSpotlight.activate(options).catch((error) => notifyError(error));
    return activeSpotlight;
  }

  function registerKeybinding() {
    game.keybindings.register(MODULE_ID, "openSpotlight", {
      name: "FTAGS.Keybindings.SpotlightName",
      hint: "FTAGS.Keybindings.SpotlightHint",
      editable: [{ key: "KeyF", modifiers: ["Control", "Shift"] }],
      restricted: true,
      onDown: () => {
        if (!workspace?.isGM?.()) return false;
        void openSpotlight();
        return true;
      },
    });
  }

  return { openSpotlight, registerKeybinding };
}

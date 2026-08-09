import {MODULE_ID} from "../constants.js";
import {contrastTextColor} from "../core/model.js";
import {tagService} from "../runtime.js";

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
    position: {width: 640, height: "auto"},
    window: {icon: "fa-solid fa-magnifying-glass", resizable: true},
    actions: {
      openResult: this.#openResult
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
  }

  get title() {
    return game.i18n.localize("FTAGS.Spotlight.Title");
  }

  _canRender(options) {
    return Boolean(game.user?.isGM) && super._canRender(options);
  }

  markDirty() {
    this.index = null;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.index ??= tagService.buildSpotlightIndex();
    this.results = tagService.searchSpotlight(this.index, this.query, {limit: RESULT_LIMIT});
    this.selectedIndex = clampIndex(this.selectedIndex, this.results.length);
    const resultCount = this.results.length;
    return {
      ...context,
      query: this.query,
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
      let timer = null;
      searchInput.addEventListener("input", () => {
        this.query = searchInput.value;
        this.selectedIndex = 0;
        clearTimeout(timer);
        timer = setTimeout(() => void this.render({parts: ["results"]}), 75);
      });
      searchInput.addEventListener("keydown", (event) => this.#onKeyDown(event));
    }

    for (const [index, result] of [...(this.parts.results?.querySelectorAll("[data-ftags-result]") ?? [])].entries()) {
      result.addEventListener("pointerenter", () => {
        this.selectedIndex = index;
        this.#syncSelection();
      });
    }
    this.#syncSelection();
  }

  focusSearch() {
    const input = this.parts.search?.querySelector("[data-ftags-spotlight-search]");
    input?.focus();
    input?.select();
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
    if (!record?.document) return;
    await this.close();
    record.document.sheet?.render(true);
  }

  /** @this {SpotlightApp} */
  static async #openResult(_event, target) {
    const record = this.results.find((candidate) => candidate.uuid === target.dataset.uuid);
    return this.openRecord(record);
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

export function openSpotlight() {
  if (!game.user?.isGM) return null;
  if (activeSpotlight?.rendered) {
    activeSpotlight.bringToFront();
    activeSpotlight.focusSearch();
    return activeSpotlight;
  }
  activeSpotlight = new SpotlightApp();
  void activeSpotlight.render({force: true});
  return activeSpotlight;
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
    tags: record.tags.map((tag) => ({...tag, foreground: contrastTextColor(tag.color)}))
  };
}

function clampIndex(index, length) {
  if (!length) return 0;
  return Math.min(Math.max(index, 0), length - 1);
}

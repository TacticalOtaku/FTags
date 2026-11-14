import { MODULE_ID } from "../constants.js";
import { filtersEqual, normalizeSpotlightFilterState } from "./spotlight.js";

const EMPTY_PENDING = {
  directories: false,
  dictionaryApps: false,
  assignmentApps: false,
  spotlightIndex: false,
  spotlightFilters: false,
};

export class RefreshCoordinator {
  #isGM;
  #watchedFields;
  #onFlush;
  #pending = { ...EMPTY_PENDING };
  #queued = false;
  #lastSavedFilters = null;

  constructor({ isGM = () => false, watchedFields = [], onFlush = () => {} } = {}) {
    this.#isGM = isGM;
    this.#watchedFields = [...watchedFields];
    this.#onFlush = onFlush;
  }

  setWatchedFields(fields) {
    this.#watchedFields = [...fields];
  }

  noteSpotlightFiltersSaved(filters) {
    this.#lastSavedFilters = normalizeSpotlightFilterState(filters);
  }

  onSettingChange(key, value) {
    if (key === "dictionary") {
      this.schedule({
        directories: true,
        dictionaryApps: true,
        assignmentApps: true,
        spotlightIndex: true,
        spotlightFilters: true,
      });
      return;
    }
    if (key === "spotlight-filters") {
      if (value !== undefined && this.#lastSavedFilters) {
        const normalized = normalizeSpotlightFilterState(value);
        if (filtersEqual(normalized, this.#lastSavedFilters)) {
          this.#lastSavedFilters = null;
          return;
        }
      }
      this.#lastSavedFilters = null;
      this.schedule({ spotlightFilters: true });
    }
  }

  onDocumentUpdate(_document, changes) {
    if (hasPath(changes, `flags.${MODULE_ID}`)) {
      this.schedule({
        directories: true,
        assignmentApps: true,
        spotlightIndex: true,
      });
      return;
    }

    const flatKeys = flattenKeys(changes);
    if (
      !flatKeys.some((key) =>
        this.#watchedFields.some((field) => key === field || key.startsWith(`${field}.`)),
      )
    ) {
      return;
    }

    const folderChanged = flatKeys.some((key) => key === "folder" || key.startsWith("folder."));
    this.schedule({
      spotlightIndex: true,
      assignmentApps: folderChanged,
    });
  }

  onLifecycleChange() {
    this.schedule({
      spotlightIndex: true,
      assignmentApps: true,
    });
  }

  schedule(flags = {}) {
    if (!this.#isGM()) return;
    let changed = false;
    for (const key of Object.keys(EMPTY_PENDING)) {
      if (flags[key]) {
        this.#pending[key] = true;
        changed = true;
      }
    }
    if (!changed || this.#queued) return;
    this.#queued = true;
    queueMicrotask(() => this.flush());
  }

  flush() {
    this.#queued = false;
    if (!this.#isGM()) {
      this.#pending = { ...EMPTY_PENDING };
      return;
    }
    const batch = this.#pending;
    this.#pending = { ...EMPTY_PENDING };
    if (
      !batch.directories &&
      !batch.dictionaryApps &&
      !batch.assignmentApps &&
      !batch.spotlightIndex &&
      !batch.spotlightFilters
    ) {
      return;
    }
    this.#onFlush(batch);
  }
}

function hasPath(object, path) {
  let current = object;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object" || !(segment in current)) return false;
    current = current[segment];
  }
  return current !== undefined;
}

function flattenKeys(object, prefix = "") {
  const keys = [];
  if (!object || typeof object !== "object") return keys;
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainRecord(value)) {
      keys.push(...flattenKeys(value, path));
    } else {
      keys.push(path);
    }
  }
  return keys;
}

function isPlainRecord(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

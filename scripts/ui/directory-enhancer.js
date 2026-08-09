import {
  DIRECTORY_LIST_SELECTOR,
  DIRECTORY_NAME_SELECTOR,
  ENTRY_ROW_SELECTOR,
  FOLDER_ROW_SELECTOR,
  MAX_VISIBLE_TAGS,
  SUPPORTED_DOCUMENT_TYPES
} from "../constants.js";
import {contrastTextColor, matchesAnyTag, partitionVisibleTags} from "../core/model.js";
import {tagRepository, tagService} from "../runtime.js";
import {notifyError} from "./notifications.js";
import {openTagManager} from "./tag-manager.js";
import {openSpotlight} from "./spotlight.js";

const renderVersions = new WeakMap();

export function registerDirectoryHooks() {
  Hooks.on("renderDocumentDirectory", (application, element) => {
    void enhanceDirectory(application, element).catch((error) => notifyError(error));
  });
}

export async function enhanceDirectory(application, element) {
  if (!game.user?.isGM || !(element instanceof HTMLElement)) return;
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;

  const version = (renderVersions.get(application) ?? 0) + 1;
  renderVersions.set(application, version);
  const dictionary = tagRepository.getDictionary();
  const activeFilters = await tagService.getActiveFilters(documentName);
  if (renderVersions.get(application) !== version) return;

  element.querySelectorAll(".ftags-row-tags, .ftags-directory-toolbar").forEach((node) => node.remove());
  const rows = collectRows(element, application, documentName);
  for (const record of rows) injectRowTags(record, dictionary, activeFilters, application, documentName);
  const matchedCount = applyFilters(rows, activeFilters);
  injectToolbar(element, dictionary, activeFilters, application, documentName, matchedCount);
}

export function renderSupportedDirectories() {
  if (!game.user?.isGM) return;
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    tagRepository.getWorldCollection(documentName)?.render?.(true, {renderContext: "ftags"});
  }
}

function collectRows(root, application, documentName) {
  const records = [];
  const seen = new Set();
  for (const row of root.querySelectorAll(ENTRY_ROW_SELECTOR)) {
    if (seen.has(row)) continue;
    const id = row.dataset.entryId ?? row.dataset.documentId;
    const document = id ? application.collection?.get?.(id) : null;
    if (!document || document.documentName !== documentName) continue;
    seen.add(row);
    records.push({row, document, isFolder: false});
  }
  for (const row of root.querySelectorAll(FOLDER_ROW_SELECTOR)) {
    if (seen.has(row)) continue;
    const folder = row.dataset.folderId ? game.folders?.get?.(row.dataset.folderId) : null;
    if (!folder || folder.type !== documentName) continue;
    seen.add(row);
    records.push({row, document: folder, isFolder: true});
  }
  return records;
}

function injectRowTags(record, dictionary, activeFilters, application, documentName) {
  if (record.isFolder && record.document.type !== documentName) return;
  const assignment = tagRepository.getTagIds(record.document);
  const {visible, hidden} = partitionVisibleTags(assignment, dictionary, MAX_VISIBLE_TAGS);
  if (!visible.length && !hidden.length) return;

  const container = document.createElement("span");
  container.className = "ftags-row-tags";
  container.dataset.ftagsFor = record.document.id;
  for (const tag of visible) {
    container.append(createInteractiveChip(tag, activeFilters.has(tag.id), async (event) => {
      event.preventDefault();
      event.stopPropagation();
      try {
        await tagService.toggleFilter(documentName, tag.id);
        await application.render({force: true});
      } catch (error) {
        notifyError(error);
      }
    }));
  }
  if (hidden.length) {
    const overflow = document.createElement("span");
    overflow.className = "ftags-chip ftags-chip--overflow";
    overflow.textContent = `+${hidden.length}`;
    const names = [...visible, ...hidden].map((tag) => tag.name).join(", ");
    overflow.title = game.i18n.format("FTAGS.Filter.FullList", {names});
    overflow.setAttribute("aria-label", overflow.title);
    container.append(overflow);
  }

  const nameElement = record.row.querySelector(DIRECTORY_NAME_SELECTOR);
  if (nameElement?.parentElement) nameElement.insertAdjacentElement("afterend", container);
  else record.row.append(container);
}

function injectToolbar(root, dictionary, activeFilters, application, documentName, matchedCount) {
  const toolbar = document.createElement("div");
  toolbar.className = "ftags-directory-toolbar";

  const searchButton = document.createElement("button");
  searchButton.type = "button";
  searchButton.className = "icon ftags-directory-toolbar__search";
  searchButton.setAttribute("aria-label", game.i18n.localize("FTAGS.Filter.Search"));
  searchButton.dataset.tooltip = game.i18n.localize("FTAGS.Filter.Search");
  searchButton.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
  searchButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openSpotlight();
  });
  toolbar.append(searchButton);

  const manageButton = document.createElement("button");
  manageButton.type = "button";
  manageButton.className = "icon ftags-directory-toolbar__manage";
  manageButton.setAttribute("aria-label", game.i18n.localize("FTAGS.Filter.Manage"));
  manageButton.dataset.tooltip = game.i18n.localize("FTAGS.Filter.Manage");
  manageButton.innerHTML = '<i class="fa-solid fa-tags" aria-hidden="true"></i>';
  manageButton.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openTagManager(application);
  });
  toolbar.append(manageButton);

  if (activeFilters.size) {
    const label = document.createElement("span");
    label.className = "ftags-directory-toolbar__label";
    label.textContent = game.i18n.localize("FTAGS.Filter.Label");
    toolbar.append(label);

    const filters = document.createElement("span");
    filters.className = "ftags-directory-toolbar__filters";
    const byId = new Map(dictionary.tags.map((tag) => [tag.id, tag]));
    const activeTags = [...activeFilters].map((id) => byId.get(id)).filter(Boolean);
    activeTags.forEach((tag, index) => {
      if (index) {
        const operator = document.createElement("span");
        operator.className = "ftags-directory-toolbar__operator";
        operator.textContent = game.i18n.localize("FTAGS.Filter.Or");
        filters.append(operator);
      }
      filters.append(createInteractiveChip(tag, true, async () => {
        try {
          await tagService.toggleFilter(documentName, tag.id);
          await application.render({force: true});
        } catch (error) {
          notifyError(error);
        }
      }));
    });
    toolbar.append(filters);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "icon";
    clearButton.setAttribute("aria-label", game.i18n.localize("FTAGS.Filter.Clear"));
    clearButton.dataset.tooltip = game.i18n.localize("FTAGS.Filter.Clear");
    clearButton.innerHTML = '<i class="fa-solid fa-filter-circle-xmark" aria-hidden="true"></i>';
    clearButton.addEventListener("click", async () => {
      try {
        await tagService.clearFilters(documentName);
        await application.render({force: true});
      } catch (error) {
        notifyError(error);
      }
    });
    toolbar.append(clearButton);

    if (!matchedCount) {
      const noMatches = document.createElement("p");
      noMatches.className = "ftags-no-matches";
      noMatches.textContent = game.i18n.localize("FTAGS.Filter.NoMatches");
      toolbar.append(noMatches);
    }
  }

  const list = root.querySelector(DIRECTORY_LIST_SELECTOR);
  if (list?.parentElement) list.parentElement.insertBefore(toolbar, list);
  else root.prepend(toolbar);
}

function applyFilters(records, activeFilters) {
  records.forEach(({row}) => row.classList.remove("ftags-filtered-out"));
  if (!activeFilters.size) return records.length;

  let matched = 0;
  const matchingRows = [];
  for (const record of records) {
    const matches = matchesAnyTag(tagRepository.getTagIds(record.document), activeFilters);
    record.row.classList.toggle("ftags-filtered-out", !matches);
    if (matches) {
      matched += 1;
      matchingRows.push(record.row);
    }
  }

  for (const row of matchingRows) {
    let ancestor = row.parentElement?.closest?.(FOLDER_ROW_SELECTOR);
    while (ancestor) {
      ancestor.classList.remove("ftags-filtered-out");
      ancestor = ancestor.parentElement?.closest?.(FOLDER_ROW_SELECTOR);
    }
  }
  return matched;
}

function createInteractiveChip(tag, active, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ftags-chip";
  button.textContent = tag.name;
  button.title = tag.name;
  button.dataset.tagId = tag.id;
  button.setAttribute("aria-pressed", String(active));
  button.style.setProperty("--ftags-tag-color", tag.color);
  button.style.setProperty("--ftags-tag-foreground", contrastTextColor(tag.color));
  button.addEventListener("click", onClick);
  return button;
}

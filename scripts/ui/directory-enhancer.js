import {
  DIRECTORY_LIST_SELECTOR,
  DIRECTORY_NAME_SELECTOR,
  ENTRY_ROW_SELECTOR,
  FOLDER_ROW_SELECTOR,
  MAX_VISIBLE_TAGS,
  SUPPORTED_DOCUMENT_TYPES
} from "../constants.js";
import {partitionVisibleTags} from "../core/model.js";
import {tagRepository} from "../runtime.js";
import {asElement} from "./app-utils.js";
import {notifyError} from "./notifications.js";
import {openTagManager} from "./tag-manager.js";
import {openSpotlight} from "./spotlight.js";

export function registerDirectoryHooks() {
  // Compendium pack windows extend DocumentDirectory, so this hook already covers them.
  Hooks.on("renderDocumentDirectory", (application, element) => {
    void enhanceDirectory(application, element).catch((error) => notifyError(error));
  });
  Hooks.on("renderCompendiumDirectory", (application, element) => {
    void enhanceCompendiumDirectory(application, element).catch((error) => notifyError(error));
  });
}

export async function enhanceDirectory(application, element) {
  const root = asElement(element);
  if (!game.user?.isGM || !root) return;
  const documentName = application?.documentName
    ?? application?.collection?.documentName
    ?? application?.metadata?.type;
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;

  const tagsById = new Map(tagRepository.getDictionary().tags.map((tag) => [tag.id, tag]));

  root.querySelectorAll(".ftags-row-tags, .ftags-directory-toolbar").forEach((node) => node.remove());
  const rows = collectRows(root, application, documentName);
  for (const record of rows) injectRowTags(record, tagsById, documentName);
  injectToolbar(root, application);
}

export async function enhanceCompendiumDirectory(application, element) {
  const root = asElement(element);
  if (!game.user?.isGM || !root) return;
  root.querySelectorAll(".ftags-directory-toolbar").forEach((node) => node.remove());
  injectToolbar(root, application);
}

/**
 * Re-render open directories (sidebar tabs, their popouts and compendium pack windows) that list
 * one of the given document types, or every supported type when none are given.
 */
export function renderSupportedDirectories(documentNames = null) {
  if (!game.user?.isGM) return;
  const registry = foundry.applications?.instances;
  if (!registry) return;
  for (const app of registry.values()) {
    const documentName = app?.documentName ?? app?.collection?.documentName;
    if (!app?.rendered || !app.collection || !SUPPORTED_DOCUMENT_TYPES.includes(documentName)) continue;
    if (documentNames && !documentNames.has(documentName)) continue;
    if (!app.element?.querySelector?.(DIRECTORY_LIST_SELECTOR)) continue;
    void app.render();
  }
}

function collectRows(root, application, documentName) {
  const records = [];
  const seen = new Set();
  const collection = application.collection;

  for (const row of root.querySelectorAll(ENTRY_ROW_SELECTOR)) {
    if (seen.has(row)) continue;
    const id = row.dataset.entryId ?? row.dataset.documentId;
    if (!id) continue;
    const document = collection?.get?.(id) ?? collection?.index?.get?.(id);
    if (!document) continue;
    seen.add(row);
    records.push({row, document, isFolder: false});
  }
  for (const row of root.querySelectorAll(FOLDER_ROW_SELECTOR)) {
    if (seen.has(row)) continue;
    const folderId = row.dataset.folderId;
    if (!folderId) continue;
    const folder = collection?.folders?.get?.(folderId) ?? game.folders?.get?.(folderId);
    if (!folder || (folder.type && folder.type !== documentName)) continue;
    seen.add(row);
    records.push({row, document: folder, isFolder: true});
  }
  return records;
}

function injectRowTags(record, tagsById, documentName) {
  if (record.isFolder && record.document.type !== documentName) return;
  const assignment = tagRepository.getTagIds(record.document);
  const {visible, hidden} = partitionVisibleTags(assignment, tagsById, MAX_VISIBLE_TAGS);
  if (!visible.length && !hidden.length) return;

  const container = document.createElement("span");
  container.className = "ftags-row-tags";
  container.dataset.ftagsFor = record.document.id;
  const names = [...visible, ...hidden].map((tag) => tag.name).join(", ");
  container.title = game.i18n.format("FTAGS.Filter.FullList", {names});
  for (const tag of visible) {
    container.append(createInteractiveStrip(tag, (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSpotlight({includeTagId: tag.id});
    }));
  }
  if (hidden.length) {
    const overflow = document.createElement("span");
    overflow.className = "ftags-tag-strip ftags-tag-strip--overflow";
    overflow.style.setProperty("--ftags-strip-background", buildColorSegments(hidden));
    overflow.title = game.i18n.format("FTAGS.Filter.FullList", {names});
    overflow.setAttribute("role", "img");
    overflow.setAttribute("aria-label", overflow.title);
    container.append(overflow);
  }

  // Folder rows and playlists nest child lists, so only a name that belongs to this row counts.
  const nameElement = [...record.row.querySelectorAll(DIRECTORY_NAME_SELECTOR)]
    .find((candidate) => candidate.closest(record.isFolder ? FOLDER_ROW_SELECTOR : ENTRY_ROW_SELECTOR) === record.row);
  if (nameElement?.parentElement) nameElement.insertAdjacentElement("afterend", container);
  else (record.row.querySelector(":scope > header") ?? record.row).append(container);
}

function injectToolbar(root, application) {
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

  const anchor = resolveToolbarAnchor(root);
  if (anchor?.parentElement) anchor.parentElement.insertBefore(toolbar, anchor);
  else root.prepend(toolbar);
}

/**
 * Pick the element the toolbar should sit in front of. Compendium windows lay the directory
 * list out absolutely inside a positioned wrapper, so a sibling toolbar would be painted over
 * and become unclickable; anchor on the wrapper in that case.
 */
function resolveToolbarAnchor(root) {
  const list = root.querySelector(DIRECTORY_LIST_SELECTOR);
  if (!list) return null;
  let anchor = list;
  while (anchor?.parentElement && anchor.parentElement !== root) {
    if (globalThis.getComputedStyle?.(anchor)?.position !== "absolute") break;
    anchor = anchor.parentElement;
  }
  return anchor;
}

function createInteractiveStrip(tag, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "ftags-tag-strip";
  button.title = tag.name;
  button.dataset.tagId = tag.id;
  button.dataset.ftagsShape = tag.shape;
  button.setAttribute("aria-label", game.i18n.format("FTAGS.Filter.OpenTag", {name: tag.name}));
  button.style.setProperty("--ftags-strip-background", tag.color);
  button.addEventListener("click", onClick);
  return button;
}

function buildColorSegments(tags) {
  const segment = 100 / tags.length;
  const stops = tags.flatMap((tag, index) => {
    const start = (index * segment).toFixed(2);
    const end = ((index + 1) * segment).toFixed(2);
    return [`${tag.color} ${start}%`, `${tag.color} ${end}%`];
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

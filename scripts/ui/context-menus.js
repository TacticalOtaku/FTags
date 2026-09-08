import {SUPPORTED_DOCUMENT_TYPES} from "../constants.js";
import {openTagAssignment} from "./tag-assignment.js";

const MENU_MARKER = Symbol("ftags-menu-entry");

export function registerContextMenuHooks() {
  const entryHookNames = new Set(
    SUPPORTED_DOCUMENT_TYPES.map((documentName) => `get${documentName}ContextOptions`)
  );
  for (const hookName of entryHookNames) Hooks.on(hookName, addDocumentMenuEntry);

  Hooks.on("getFolderContextOptions", addFolderMenuEntry);
}

function addDocumentMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName) || hasFTagsEntry(menuItems)) return;
  const isVisible = (target) => game.user?.isGM && Boolean(resolveEntryReference(application, target));
  const open = async (_event, target) => {
    const document = await loadDocument(application, target);
    if (document) return openTagAssignment(document, application);
  };
  const entry = {
    name: game.i18n.localize("FTAGS.Context.Assign"),
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    condition: isVisible,
    visible: isVisible,
    // The deprecated `callback` path is invoked as (target, event); `onClick` as (event, target).
    callback: (target, event) => open(event, target),
    onClick: open
  };
  entry[MENU_MARKER] = true;
  menuItems.push(entry);
}

function addFolderMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (documentName && !SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;
  if (hasFTagsEntry(menuItems)) return;
  const isVisible = (target) => game.user?.isGM && Boolean(resolveFolder(documentName, target));
  const open = (_event, target) => {
    const folder = resolveFolder(documentName, target);
    if (folder) return openTagAssignment(folder, application);
  };
  const entry = {
    name: game.i18n.localize("FTAGS.Context.Assign"),
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    condition: isVisible,
    visible: isVisible,
    callback: (target, event) => open(event, target),
    onClick: open
  };
  entry[MENU_MARKER] = true;
  menuItems.push(entry);
}

/**
 * Synchronous existence check used by `visible`. A compendium collection only resolves
 * already-loaded documents through `get`, so fall back to its index entry.
 */
function resolveEntryReference(application, target) {
  const collection = application?.collection;
  const id = rowId(target);
  if (!id || !collection) return null;
  return collection.get?.(id) ?? collection.index?.get?.(id) ?? null;
}

/** Asynchronous resolution used by the click handler, loading compendium documents on demand. */
async function loadDocument(application, target) {
  const collection = application?.collection;
  const id = rowId(target);
  if (!id || !collection) return null;
  const cached = collection.get?.(id);
  if (cached) return cached;
  if (typeof collection.getDocument === "function") return collection.getDocument(id);
  return null;
}

function rowId(target) {
  const element = asElement(target);
  const row = element?.closest?.("[data-entry-id], [data-document-id]") ?? element;
  return row?.dataset?.entryId ?? row?.dataset?.documentId ?? null;
}

function resolveFolder(documentName, target) {
  const element = asElement(target);
  const row = element?.closest?.("[data-folder-id]") ?? element;
  const id = row?.dataset?.folderId;
  if (!id) return null;

  const worldFolder = game.folders?.get?.(id);
  if (worldFolder && (!documentName || worldFolder.type === documentName)) return worldFolder;

  for (const pack of game.packs ?? []) {
    const folder = pack.folders?.get?.(id);
    if (folder && (!documentName || folder.type === documentName)) return folder;
  }
  return null;
}

function hasFTagsEntry(menuItems) {
  return Array.isArray(menuItems) && menuItems.some((entry) => entry[MENU_MARKER]);
}

function asElement(value) {
  if (value instanceof HTMLElement) return value;
  return value?.[0] instanceof HTMLElement ? value[0] : null;
}

import {SUPPORTED_DOCUMENT_TYPES} from "../constants.js";
import {asElement} from "./app-utils.js";
import {openTagAssignment} from "./tag-assignment.js";

const MENU_MARKER = Symbol("ftags-menu-entry");
const MENU_ICON = "fa-solid fa-tags";

export function registerContextMenuHooks() {
  for (const documentName of SUPPORTED_DOCUMENT_TYPES) {
    Hooks.on(`get${documentName}ContextOptions`, addDocumentMenuEntry);
  }
  Hooks.on("getFolderContextOptions", addFolderMenuEntry);
}

function addDocumentMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName) || hasFTagsEntry(menuItems)) return;
  menuItems.push(createEntry({
    visible: (target) => Boolean(game.user?.isGM && resolveEntryReference(application, target)),
    onClick: async (_event, target) => {
      const document = await loadDocument(application, target);
      if (document) return openTagAssignment(document);
    }
  }));
}

function addFolderMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (documentName && !SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;
  if (hasFTagsEntry(menuItems)) return;
  menuItems.push(createEntry({
    visible: (target) => Boolean(game.user?.isGM && resolveFolder(application, documentName, target)),
    onClick: (_event, target) => {
      const folder = resolveFolder(application, documentName, target);
      if (folder) return openTagAssignment(folder);
    }
  }));
}

function createEntry({visible, onClick}) {
  return {
    label: "FTAGS.Context.Assign",
    icon: MENU_ICON,
    visible,
    onClick,
    [MENU_MARKER]: true
  };
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

/** Only folders that hold a supported document type can carry tags. */
function resolveFolder(application, documentName, target) {
  const element = asElement(target);
  const row = element?.closest?.("[data-folder-id]") ?? element;
  const id = row?.dataset?.folderId;
  if (!id) return null;

  const accepts = (folder) => Boolean(folder)
    && SUPPORTED_DOCUMENT_TYPES.includes(folder.type)
    && (!documentName || folder.type === documentName);

  const own = application?.collection?.folders?.get?.(id);
  if (accepts(own)) return own;
  const worldFolder = game.folders?.get?.(id);
  if (accepts(worldFolder)) return worldFolder;
  for (const pack of game.packs ?? []) {
    const folder = pack.folders?.get?.(id);
    if (accepts(folder)) return folder;
  }
  return null;
}

function hasFTagsEntry(menuItems) {
  return Array.isArray(menuItems) && menuItems.some((entry) => entry?.[MENU_MARKER]);
}

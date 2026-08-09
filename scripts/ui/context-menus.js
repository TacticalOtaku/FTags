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
  const entry = {
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    visible: (target) => game.user?.isGM && Boolean(resolveDocument(application, target)),
    onClick: (_event, target) => {
      const document = resolveDocument(application, target);
      if (document) return openTagAssignment(document, application);
    }
  };
  entry[MENU_MARKER] = true;
  menuItems.push(entry);
}

function addFolderMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName) || hasFTagsEntry(menuItems)) return;
  const entry = {
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    visible: (target) => game.user?.isGM && Boolean(resolveFolder(documentName, target)),
    onClick: (_event, target) => {
      const folder = resolveFolder(documentName, target);
      if (folder) return openTagAssignment(folder, application);
    }
  };
  entry[MENU_MARKER] = true;
  menuItems.push(entry);
}

function resolveDocument(application, target) {
  const element = asElement(target);
  const row = element?.closest?.("[data-entry-id], [data-document-id]") ?? element;
  const id = row?.dataset?.entryId ?? row?.dataset?.documentId;
  return id ? application.collection?.get?.(id) ?? null : null;
}

function resolveFolder(documentName, target) {
  const element = asElement(target);
  const row = element?.closest?.("[data-folder-id]") ?? element;
  const id = row?.dataset?.folderId;
  const folder = id ? game.folders?.get?.(id) : null;
  return folder?.type === documentName ? folder : null;
}

function hasFTagsEntry(menuItems) {
  return menuItems.some((entry) => entry[MENU_MARKER]);
}

function asElement(value) {
  if (value instanceof HTMLElement) return value;
  return value?.[0] instanceof HTMLElement ? value[0] : null;
}

import {SUPPORTED_DOCUMENT_TYPES} from "../constants.js";
import {openTagAssignment} from "./tag-assignment.js";

const MENU_MARKER = Symbol("ftags-menu-entry");

export function registerContextMenuHooks() {
  const entryHookNames = new Set(
    SUPPORTED_DOCUMENT_TYPES.map((documentName) => `get${documentName}ContextOptions`)
  );
  for (const hookName of entryHookNames) Hooks.on(hookName, addDocumentMenuEntry);

  Hooks.on("getFolderContextOptions", addFolderMenuEntry);
  Hooks.on("getCompendiumEntryContext", addCompendiumMenuEntry);
}

function addDocumentMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName) || hasFTagsEntry(menuItems)) return;
  const entry = {
    name: game.i18n.localize("FTAGS.Context.Assign"),
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    condition: (target) => game.user?.isGM && Boolean(resolveDocument(application, target)),
    visible: (target) => game.user?.isGM && Boolean(resolveDocument(application, target)),
    callback: async (target) => {
      const document = await resolveDocument(application, target);
      if (document) return openTagAssignment(document, application);
    },
    onClick: async (_event, target) => {
      const document = await resolveDocument(application, target);
      if (document) return openTagAssignment(document, application);
    }
  };
  entry[MENU_MARKER] = true;
  menuItems.push(entry);
}

function addFolderMenuEntry(application, menuItems) {
  const documentName = application?.documentName ?? application?.collection?.documentName;
  if (documentName && !SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;
  if (hasFTagsEntry(menuItems)) return;
  const entry = {
    name: game.i18n.localize("FTAGS.Context.Assign"),
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    condition: (target) => game.user?.isGM && Boolean(resolveFolder(documentName, target)),
    visible: (target) => game.user?.isGM && Boolean(resolveFolder(documentName, target)),
    callback: (_event, target) => {
      const folder = resolveFolder(documentName, target);
      if (folder) return openTagAssignment(folder, application);
    },
    onClick: (_event, target) => {
      const folder = resolveFolder(documentName, target);
      if (folder) return openTagAssignment(folder, application);
    }
  };
  entry[MENU_MARKER] = true;
  menuItems.push(entry);
}

function addCompendiumMenuEntry(applicationOrHtml, menuItems) {
  if (hasFTagsEntry(menuItems)) return;
  const entry = {
    name: game.i18n.localize("FTAGS.Context.Assign"),
    label: game.i18n.localize("FTAGS.Context.Assign"),
    icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
    condition: (target) => game.user?.isGM && Boolean(resolveCompendiumDocument(applicationOrHtml, target)),
    visible: (target) => game.user?.isGM && Boolean(resolveCompendiumDocument(applicationOrHtml, target)),
    callback: async (target) => {
      const document = await resolveCompendiumDocument(applicationOrHtml, target);
      if (document) return openTagAssignment(document);
    },
    onClick: async (_event, target) => {
      const document = await resolveCompendiumDocument(applicationOrHtml, target);
      if (document) return openTagAssignment(document);
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
  if (!id) return null;

  const worldFolder = game.folders?.get?.(id);
  if (worldFolder && (!documentName || worldFolder.type === documentName)) return worldFolder;

  for (const pack of game.packs ?? []) {
    const folder = pack.folders?.get?.(id);
    if (folder && (!documentName || folder.type === documentName)) return folder;
  }
  return null;
}

function resolveCompendiumDocument(appOrHtml, target) {
  const element = asElement(target);
  const row = element?.closest?.("[data-entry-id], [data-document-id]") ?? element;
  const id = row?.dataset?.entryId ?? row?.dataset?.documentId;
  if (!id) return null;

  const collection = appOrHtml?.collection ?? (appOrHtml?.metadata?.type ? appOrHtml : null);
  if (collection?.getDocument) {
    return collection.get(id) ?? collection.getDocument(id);
  }

  const packId = row?.dataset?.pack ?? row?.closest?.("[data-pack]")?.dataset?.pack;
  if (packId) {
    const pack = game.packs?.get(packId);
    if (pack) return pack.get(id) ?? pack.getDocument(id);
  }

  for (const pack of game.packs ?? []) {
    if (pack.index?.has(id)) return pack.get(id) ?? pack.getDocument(id);
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

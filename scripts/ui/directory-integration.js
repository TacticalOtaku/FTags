import { MAX_VISIBLE_TAGS, SUPPORTED_DOCUMENT_TYPES } from "../constants.js";
import { notifyError } from "./notifications.js";

const ENTRY_ROW_SELECTOR =
  ".directory-item.entry[data-entry-id], .directory-item.document[data-document-id], .directory-item.document[data-entry-id], [data-entry-id], [data-document-id]";
const FOLDER_ROW_SELECTOR = ".directory-item.folder[data-folder-id], [data-folder-id]";
const DIRECTORY_NAME_SELECTOR =
  ".entry-name, .document-name, .folder-header h3, .folder-header h4, header h3, header h4";
const DIRECTORY_LIST_SELECTOR = ".directory-list";
const MENU_MARKER = Symbol("ftags-menu-entry");

export function partitionVisibleTags(tags, maxVisible = MAX_VISIBLE_TAGS) {
  const list = Array.isArray(tags) ? tags : [];
  return {
    visible: list.slice(0, maxVisible),
    hidden: list.slice(maxVisible),
  };
}

export function buildColorSegments(tags) {
  const segment = 100 / tags.length;
  const stops = tags.flatMap((tag, index) => {
    const start = (index * segment).toFixed(2);
    const end = ((index + 1) * segment).toFixed(2);
    return [`${tag.color} ${start}%`, `${tag.color} ${end}%`];
  });
  return `linear-gradient(to right, ${stops.join(", ")})`;
}

/**
 * Unifies sidebar/compendium directory enhancements (tag markers, toolbar actions) and
 * context menu registration around shared row/folder resolution and `TagWorkspace`.
 */
export function createDirectoryIntegration({
  workspace,
  openSpotlight,
  openTagAssignment,
  openTagManager,
} = {}) {
  if (!workspace) throw new Error("DirectoryIntegration requires a workspace");

  function registerHooks() {
    Hooks.on("renderDocumentDirectory", (application, element) => {
      void enhanceDirectory(application, element).catch((error) => notifyError(error));
    });
    Hooks.on("renderCompendium", (application, element) => {
      void enhanceDirectory(application, element).catch((error) => notifyError(error));
    });
    Hooks.on("renderCompendiumDirectory", (application, element) => {
      void enhanceCompendiumDirectory(application, element).catch((error) => notifyError(error));
    });

    const entryHookNames = new Set(
      SUPPORTED_DOCUMENT_TYPES.map((documentName) => `get${documentName}ContextOptions`),
    );
    for (const hookName of entryHookNames) Hooks.on(hookName, addDocumentMenuEntry);
    Hooks.on("getFolderContextOptions", addFolderMenuEntry);
  }

  async function enhanceDirectory(application, element) {
    const root = asElement(element);
    if (!workspace.isGM() || !root) return;
    const documentName = resolveDocumentName(application);
    if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;

    if (typeof application?.collection?.getIndex === "function") {
      await workspace.ensurePackIndexed(application.collection);
    }

    const tagsById = new Map(workspace.listTags().map((tag) => [tag.id, tag]));
    root.querySelectorAll(".ftags-row-tags, .ftags-directory-toolbar").forEach((node) => node.remove());
    const rows = collectRows(root, application, documentName);
    for (const record of rows) injectRowTags(record, tagsById, documentName);
    injectToolbar(root, application);
  }

  async function enhanceCompendiumDirectory(application, element) {
    const root = asElement(element);
    if (!workspace.isGM() || !root) return;
    root.querySelectorAll(".ftags-directory-toolbar").forEach((node) => node.remove());
    injectToolbar(root, application);
  }

  function renderSupportedDirectories() {
    if (!workspace.isGM()) return;
    for (const target of workspace.getDirectoryRenderTargets()) {
      void target?.render?.(false, { renderContext: "ftags" });
    }
  }

  function addDocumentMenuEntry(application, menuItems) {
    const documentName = resolveDocumentName(application);
    if (!SUPPORTED_DOCUMENT_TYPES.includes(documentName) || hasFTagsEntry(menuItems)) return;
    const isVisible = (target) => workspace.isGM() && Boolean(resolveEntryReference(application, target));
    const open = async (_event, target) => {
      const targetDoc = await loadEntryDocument(application, target);
      if (targetDoc) return openTagAssignment?.(targetDoc, application);
    };
    pushMenuEntry(menuItems, isVisible, open);
  }

  function addFolderMenuEntry(application, menuItems) {
    const documentName = resolveDocumentName(application);
    if (documentName && !SUPPORTED_DOCUMENT_TYPES.includes(documentName)) return;
    if (hasFTagsEntry(menuItems)) return;
    const isVisible = (target) =>
      workspace.isGM() && Boolean(resolveFolder(application, documentName, target));
    const open = (_event, target) => {
      const folder = resolveFolder(application, documentName, target);
      if (folder) return openTagAssignment?.(folder, application);
    };
    pushMenuEntry(menuItems, isVisible, open);
  }

  function pushMenuEntry(menuItems, isVisible, open) {
    const label = workspace.localize("FTAGS.Context.Assign");
    const entry = {
      name: label,
      label,
      icon: '<i class="fa-solid fa-tags" aria-hidden="true"></i>',
      condition: isVisible,
      visible: isVisible,
      // The deprecated `callback` path is invoked as (target, event); `onClick` as (event, target).
      callback: (target, event) => open(event, target),
      onClick: open,
    };
    entry[MENU_MARKER] = true;
    menuItems.push(entry);
  }

  function collectRows(root, application, documentName) {
    const records = [];
    const seen = new Set();
    const collection = application?.collection;

    for (const row of root.querySelectorAll(ENTRY_ROW_SELECTOR)) {
      if (seen.has(row)) continue;
      const id = row.dataset?.entryId ?? row.dataset?.documentId;
      if (!id) continue;
      const targetDoc = collection?.get?.(id) ?? collection?.index?.get?.(id);
      if (!targetDoc) continue;
      seen.add(row);
      records.push({ row, document: targetDoc, isFolder: false });
    }
    for (const row of root.querySelectorAll(FOLDER_ROW_SELECTOR)) {
      if (seen.has(row)) continue;
      const folderId = row.dataset?.folderId;
      if (!folderId) continue;
      const folder = workspace.resolveFolder(folderId, {
        preferredCollection: collection,
        documentName,
      });
      if (!folder || (folder.type && folder.type !== documentName)) continue;
      seen.add(row);
      records.push({ row, document: folder, isFolder: true });
    }
    return records;
  }

  function injectRowTags(record, tagsById, documentName) {
    if (record.isFolder && record.document.type !== documentName) return;
    const assignedTags = workspace.getAssignedTags(record.document, tagsById);
    const { visible, hidden } = partitionVisibleTags(assignedTags, MAX_VISIBLE_TAGS);
    if (!visible.length && !hidden.length) return;

    const dom = record.row.ownerDocument ?? globalThis.document;
    const container = dom.createElement("span");
    container.className = "ftags-row-tags";
    container.dataset.ftagsFor = record.document.id ?? record.document._id;
    const names = [...visible, ...hidden].map((tag) => tag.name).join(", ");
    const fullListLabel = workspace.format("FTAGS.Filter.FullList", { names });
    container.title = fullListLabel;

    for (const tag of visible) {
      container.append(
        createInteractiveStrip(dom, tag, (event) => {
          event.preventDefault();
          event.stopPropagation();
          openSpotlight?.({ includeTagId: tag.id });
        }),
      );
    }

    if (hidden.length) {
      const overflow = dom.createElement("span");
      overflow.className = "ftags-tag-strip ftags-tag-strip--overflow";
      overflow.style.setProperty("--ftags-strip-background", buildColorSegments(hidden));
      overflow.title = fullListLabel;
      overflow.setAttribute("role", "img");
      overflow.setAttribute("aria-label", fullListLabel);
      container.append(overflow);
    }

    const nameElement = record.row.querySelector(DIRECTORY_NAME_SELECTOR);
    if (nameElement?.parentElement) nameElement.insertAdjacentElement("afterend", container);
    else record.row.append(container);
  }

  function injectToolbar(root, application) {
    const dom = root.ownerDocument ?? globalThis.document;
    const toolbar = dom.createElement("div");
    toolbar.className = "ftags-directory-toolbar";

    const searchLabel = workspace.localize("FTAGS.Filter.Search");
    const searchButton = dom.createElement("button");
    searchButton.type = "button";
    searchButton.className = "icon ftags-directory-toolbar__search";
    searchButton.setAttribute("aria-label", searchLabel);
    searchButton.dataset.tooltip = searchLabel;
    searchButton.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i>';
    searchButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openSpotlight?.();
    });
    toolbar.append(searchButton);

    const manageLabel = workspace.localize("FTAGS.Filter.Manage");
    const manageButton = dom.createElement("button");
    manageButton.type = "button";
    manageButton.className = "icon ftags-directory-toolbar__manage";
    manageButton.setAttribute("aria-label", manageLabel);
    manageButton.dataset.tooltip = manageLabel;
    manageButton.innerHTML = '<i class="fa-solid fa-tags" aria-hidden="true"></i>';
    manageButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      openTagManager?.(application);
    });
    toolbar.append(manageButton);

    const anchor = resolveToolbarAnchor(root);
    if (anchor?.parentElement) anchor.parentElement.insertBefore(toolbar, anchor);
    else root.prepend(toolbar);
  }

  function createInteractiveStrip(dom, tag, onClick) {
    const button = dom.createElement("button");
    button.type = "button";
    button.className = "ftags-tag-strip";
    button.title = tag.name;
    button.dataset.tagId = tag.id;
    button.dataset.ftagsShape = tag.shape;
    button.setAttribute("aria-label", workspace.format("FTAGS.Filter.OpenTag", { name: tag.name }));
    button.style.setProperty("--ftags-strip-background", tag.color);
    button.addEventListener("click", onClick);
    return button;
  }

  function resolveFolder(application, documentName, target) {
    const element = asElement(target);
    const row = element?.closest?.("[data-folder-id]") ?? element;
    const folderId = row?.dataset?.folderId;
    if (!folderId) return null;
    return workspace.resolveFolder(folderId, {
      preferredCollection: application?.collection,
      documentName,
    });
  }

  return {
    registerHooks,
    enhanceDirectory,
    enhanceCompendiumDirectory,
    renderSupportedDirectories,
  };
}

function resolveDocumentName(application) {
  return (
    application?.documentName ?? application?.collection?.documentName ?? application?.metadata?.type ?? null
  );
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

function resolveEntryReference(application, target) {
  const collection = application?.collection;
  const id = rowId(target);
  if (!id || !collection) return null;
  return collection.get?.(id) ?? collection.index?.get?.(id) ?? null;
}

async function loadEntryDocument(application, target) {
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

function hasFTagsEntry(menuItems) {
  return Array.isArray(menuItems) && menuItems.some((entry) => entry[MENU_MARKER]);
}

function asElement(value) {
  if (value?.nodeType === 1) return value;
  return value?.[0]?.nodeType === 1 ? value[0] : null;
}

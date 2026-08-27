export const MODULE_ID = "ftags";
export const MODULE_TITLE = "FTags";
export const SCHEMA_VERSION = 1;
export const MAX_VISIBLE_TAGS = 3;
export const MAX_TAG_NAME_LENGTH = 48;
export const MAX_TAG_COUNT = 500;
export const BULK_CONCURRENCY = 5;

export const SETTINGS = Object.freeze({
  DICTIONARY: "tagDictionary",
  SPOTLIGHT_FILTERS: "spotlightFilters",
  MANAGER: "tagManager"
});

export const FLAGS = Object.freeze({
  TAG_IDS: "tagIds"
});

export const SUPPORTED_DOCUMENT_TYPES = Object.freeze([
  "Actor",
  "Item",
  "Scene",
  "JournalEntry",
  "RollTable",
  "Cards",
  "Playlist",
  "Macro"
]);

export const SPOTLIGHT_DOCUMENT_TYPES = Object.freeze([
  ...SUPPORTED_DOCUMENT_TYPES,
  "Folder"
]);

export const COLLECTION_PROPERTY_BY_DOCUMENT = Object.freeze({
  Actor: "actors",
  Item: "items",
  Scene: "scenes",
  JournalEntry: "journal",
  RollTable: "tables",
  Cards: "cards",
  Playlist: "playlists",
  Macro: "macros"
});

export const ENTRY_ROW_SELECTOR = [
  ".directory-item.document[data-entry-id]",
  ".directory-item.entry[data-entry-id]",
  ".directory-item[data-entry-id]",
  ".directory-item[data-document-id]",
  "[data-entry-id].document",
  "[data-document-id].document",
  "li.directory-item[data-entry-id]",
  "li.directory-item[data-document-id]",
  "li.entry[data-entry-id]",
  "li[data-entry-id]"
].join(",");

export const FOLDER_ROW_SELECTOR = [
  ".directory-item.folder[data-folder-id]",
  "[data-folder-id].folder",
  "li.folder[data-folder-id]",
  "li[data-folder-id]"
].join(",");

export const DIRECTORY_NAME_SELECTOR = [
  ".folder-header .folder-name",
  ".folder-header .entry-name",
  ".folder-header h3",
  ".folder-header h4",
  ".entry-name",
  ".document-name",
  "h4.entry-name",
  "a.entry-name"
].join(",");

export const DIRECTORY_LIST_SELECTOR = [
  ".directory-list",
  "ol.directory-list",
  "ul.directory-list",
  ".compendium-list",
  "ol.compendium-list",
  "ul.compendium-list"
].join(",");


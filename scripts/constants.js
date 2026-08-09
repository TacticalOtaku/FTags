export const MODULE_ID = "ftags";
export const MODULE_TITLE = "FTags";
export const SCHEMA_VERSION = 1;
export const MAX_VISIBLE_TAGS = 3;
export const MAX_TAG_NAME_LENGTH = 48;
export const BULK_CONCURRENCY = 5;

export const SETTINGS = Object.freeze({
  DICTIONARY: "tagDictionary",
  FILTERS: "savedFilters",
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
  "[data-entry-id].document",
  "[data-document-id].document"
].join(",");

export const FOLDER_ROW_SELECTOR = [
  ".directory-item.folder[data-folder-id]",
  "[data-folder-id].folder"
].join(",");

export const DIRECTORY_NAME_SELECTOR = [
  ".folder-header .folder-name",
  ".folder-header .entry-name",
  ".folder-header h3",
  ".entry-name",
  ".document-name"
].join(",");

export const DIRECTORY_LIST_SELECTOR = [
  ".directory-list",
  "ol.directory-list",
  "ul.directory-list"
].join(",");

export const MODULE_ID = "ftags";
export const SCHEMA_VERSION = 2;
export const TAG_SHAPES = Object.freeze(["circle", "square", "diamond", "star", "triangle"]);
export const MAX_VISIBLE_TAGS = 3;
export const MAX_TAG_NAME_LENGTH = 48;
export const MAX_TAG_COUNT = 500;
export const BULK_CONCURRENCY = 5;

export const SETTINGS = Object.freeze({
  DICTIONARY: "tagDictionary",
  SPOTLIGHT_FILTERS: "spotlightFilters",
  MANAGER: "tagManager",
});

export const FLAGS = Object.freeze({
  TAG_IDS: "tagIds",
});

export const SUPPORTED_DOCUMENT_TYPES = Object.freeze([
  "Actor",
  "Item",
  "Scene",
  "JournalEntry",
  "RollTable",
  "Cards",
  "Playlist",
  "Macro",
]);

export const SPOTLIGHT_DOCUMENT_TYPES = Object.freeze([...SUPPORTED_DOCUMENT_TYPES, "Folder"]);

export const TYPE_LOCALIZATION_KEYS = Object.freeze({
  Actor: "FTAGS.Types.Actor",
  Item: "FTAGS.Types.Item",
  Scene: "FTAGS.Types.Scene",
  JournalEntry: "FTAGS.Types.JournalEntry",
  RollTable: "FTAGS.Types.RollTable",
  Cards: "FTAGS.Types.Cards",
  Playlist: "FTAGS.Types.Playlist",
  Macro: "FTAGS.Types.Macro",
  Folder: "FTAGS.Types.Folder",
});

import {MAX_TAG_NAME_LENGTH} from "../constants.js";

const ERROR_KEYS = Object.freeze({
  "gm-only": "FTAGS.Errors.GMOnly",
  "name-required": "FTAGS.Errors.NameRequired",
  "name-too-long": "FTAGS.Errors.NameTooLong",
  "too-many-tags": "FTAGS.Errors.TooManyTags",
  "duplicate-name": "FTAGS.Errors.DuplicateName",
  "import-name-conflict": "FTAGS.Errors.DuplicateName",
  "invalid-color": "FTAGS.Errors.InvalidColor"
});

export function notifyError(error, fallbackKey = "FTAGS.Errors.Generic") {
  console.error("FTags", error);
  const key = ERROR_KEYS[error?.code] ?? fallbackKey;
  const details = {
    ...(error?.details ?? {}),
    max: error?.details?.max ?? MAX_TAG_NAME_LENGTH,
    reason: error?.message ?? String(error)
  };
  ui.notifications.error(game.i18n.format(key, details));
}

export function notifyInfo(key, data = {}) {
  ui.notifications.info(game.i18n.format(key, data));
}

export function notifyWarn(key, data = {}) {
  ui.notifications.warn(game.i18n.format(key, data));
}

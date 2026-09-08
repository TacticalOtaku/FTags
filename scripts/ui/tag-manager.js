import {MAX_TAG_NAME_LENGTH, MODULE_ID} from "../constants.js";
import {tagService} from "../runtime.js";
import {notifyError, notifyInfo, notifyWarn} from "./notifications.js";

const {ApplicationV2, DialogV2, HandlebarsApplicationMixin} = foundry.applications.api;

export class TagManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ftags-manager",
    classes: ["ftags-app", "ftags-manager-app"],
    position: {width: 560, height: "auto"},
    window: {icon: "fa-solid fa-tags", resizable: true},
    actions: {
      create: this.#createTag,
      edit: this.#editTag,
      delete: this.#deleteTag,
      export: this.#exportTags,
      import: this.#importTags
    }
  };

  static PARTS = {
    content: {template: `modules/${MODULE_ID}/templates/tag-manager.hbs`}
  };

  constructor({returnApp = null, ...options} = {}) {
    super(options);
    this.returnApp = returnApp;
  }

  get title() {
    return game.i18n.localize("FTAGS.Manager.Title");
  }

  _canRender(options) {
    return Boolean(game.user?.isGM) && super._canRender(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tags = tagService.listTags();
    return {
      ...context,
      tags,
      hasTags: Boolean(tags.length),
      hasNoTags: !tags.length,
      maxTagNameLength: MAX_TAG_NAME_LENGTH
    };
  }

  async refreshRelatedApps() {
    await this.render();
    if (this.returnApp?.rendered) await this.returnApp.render();
  }

  /** @this {TagManagerApp} */
  static async #createTag(_event, _target) {
    const nameInput = this.element.querySelector('input[name="newName"]');
    const colorInput = this.element.querySelector('input[name="newColor"]');
    try {
      await tagService.createTag({name: nameInput?.value, color: colorInput?.value});
      notifyInfo("FTAGS.Manager.CreateSuccess");
      await this.refreshRelatedApps();
    } catch (error) {
      notifyError(error);
      nameInput?.focus();
    }
  }

  /** @this {TagManagerApp} */
  static async #editTag(_event, target) {
    const tag = tagService.getTag(target.dataset.tagId);
    if (!tag) return;

    let result;
    try {
      result = await DialogV2.wait({
        window: {title: game.i18n.format("FTAGS.Manager.Edit", {name: tag.name})},
        content: editDialogContent(tag),
        rejectClose: false,
        modal: true,
        buttons: [
          {action: "cancel", label: game.i18n.localize("FTAGS.Common.Cancel")},
          {
            action: "save",
            label: game.i18n.localize("FTAGS.Common.Save"),
            icon: "fa-solid fa-check",
            default: true,
            callback: (_event, button) => ({
              name: button.form.elements.name.value,
              color: button.form.elements.color.value
            })
          }
        ]
      });
    } catch (error) {
      notifyError(error);
      return;
    }
    if (!result || result === "cancel") return;

    try {
      await tagService.updateTag(tag.id, result);
      notifyInfo("FTAGS.Manager.UpdateSuccess");
      await this.refreshRelatedApps();
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagManagerApp} */
  static async #deleteTag(_event, target) {
    const tag = tagService.getTag(target.dataset.tagId);
    if (!tag) return;
    const message = game.i18n.format("FTAGS.Manager.DeleteContent", {name: tag.name});
    const confirmed = await DialogV2.confirm({
      window: {title: game.i18n.localize("FTAGS.Manager.DeleteTitle")},
      content: `<p>${foundry.utils.escapeHTML(message)}</p>`,
      rejectClose: false,
      modal: true
    });
    if (!confirmed) return;

    try {
      const result = await tagService.deleteTag(tag.id);
      if (result.failed) {
        console.error("FTags tag cleanup failures", result.errors);
        notifyWarn("FTAGS.Manager.DeleteAborted", {count: result.failed});
      } else {
        notifyInfo("FTAGS.Manager.DeleteSuccess", {count: result.cleaned});
      }
      await this.refreshRelatedApps();
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagManagerApp} */
  static async #exportTags() {
    try {
      const json = tagService.exportDictionary();
      downloadJson(json, `ftags-${game.world?.id ?? "world"}-tags.json`);
      notifyInfo("FTAGS.Manager.ExportSuccess");
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagManagerApp} */
  static async #importTags() {
    const input = this.element.querySelector("[data-ftags-import-input]");
    if (!input) return;
    input.value = "";
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const preview = tagService.previewImport(text);
        const summary = game.i18n.format("FTAGS.Manager.ImportSummary", preview.summary);
        const confirmed = await DialogV2.confirm({
          window: {title: game.i18n.localize("FTAGS.Manager.ImportTitle")},
          content: `<p>${foundry.utils.escapeHTML(summary)}</p>`,
          rejectClose: false,
          modal: true
        });
        if (!confirmed) return;
        await tagService.importDictionary(text);
        notifyInfo("FTAGS.Manager.ImportSuccess");
        await this.refreshRelatedApps();
      } catch (error) {
        notifyError(error, "FTAGS.Errors.InvalidImport");
      }
    };
    input.click();
  }
}

export function openTagManager(parentApp = null) {
  if (!game.user?.isGM) return null;
  const app = new TagManagerApp({returnApp: parentApp});
  if (parentApp?.renderChild) return parentApp.renderChild(app, {force: true});
  return app.render({force: true});
}

function editDialogContent(tag) {
  // DialogV2 rejects a content element that carries any attribute and only keeps its
  // innerHTML, so the outer div stays bare and the styling hook lives one level down.
  const root = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.className = "ftags-manager ftags-manager__edit";

  const nameLabel = document.createElement("label");
  const nameText = document.createElement("span");
  nameText.textContent = game.i18n.localize("FTAGS.Manager.NewName");
  const nameInput = document.createElement("input");
  nameInput.name = "name";
  nameInput.type = "text";
  nameInput.maxLength = MAX_TAG_NAME_LENGTH;
  // The element is serialized to innerHTML, so the value has to live in the attribute.
  nameInput.setAttribute("value", tag.name);
  nameLabel.append(nameText, nameInput);

  const colorLabel = document.createElement("label");
  const colorText = document.createElement("span");
  colorText.textContent = game.i18n.localize("FTAGS.Manager.Color");
  const colorInput = document.createElement("input");
  colorInput.name = "color";
  colorInput.type = "color";
  colorInput.setAttribute("value", tag.color);
  colorLabel.append(colorText, colorInput);

  wrapper.append(nameLabel, colorLabel);
  root.append(wrapper);
  return root;
}

function downloadJson(json, filename) {
  const blob = new Blob([json], {type: "application/json;charset=utf-8"});
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

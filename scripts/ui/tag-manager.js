import { MAX_TAG_NAME_LENGTH, MODULE_ID, TAG_SHAPES } from "../constants.js";
import { log } from "../core/logger.js";
import { notifyError, notifyInfo, notifyWarn } from "./notifications.js";

const { ApplicationV2, DialogV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TagManagerApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "ftags-manager",
    classes: ["ftags-app", "ftags-manager-app"],
    position: { width: 560, height: "auto" },
    window: { icon: "fa-solid fa-tags", resizable: true },
    actions: {
      create: this.#createTag,
      edit: this.#editTag,
      delete: this.#deleteTag,
      export: this.#exportTags,
      import: this.#importTags,
      preset: this.#applyPreset,
    },
  };

  static PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/tag-manager.hbs` },
  };

  constructor({ workspace = null, ...options } = {}) {
    super(options);
    if (!workspace) throw new Error("TagManagerApp requires a workspace");
    this.workspace = workspace;
  }

  get title() {
    return this.workspace.localize("FTAGS.Manager.Title");
  }

  _canRender(options) {
    return this.workspace.isGM() && super._canRender(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const tags = this.workspace.listTags();
    return {
      ...context,
      tags,
      shapes: shapeOptions(this.workspace),
      presets: this.workspace.listPresets().map((preset) => ({
        id: preset.id,
        label: this.workspace.localize(preset.labelKey),
        description: preset.tags.map((tag) => tag.name).join(" · "),
      })),
      hasTags: Boolean(tags.length),
      hasNoTags: !tags.length,
      maxTagNameLength: MAX_TAG_NAME_LENGTH,
    };
  }

  /** @this {TagManagerApp} */
  static async #createTag(_event, _target) {
    const nameInput = this.element.querySelector('input[name="newName"]');
    const colorInput = this.element.querySelector('input[name="newColor"]');
    try {
      const shape = this.element.querySelector('select[name="newShape"]')?.value;
      await this.workspace.createTag({ name: nameInput?.value, color: colorInput?.value, shape });
      notifyInfo("FTAGS.Manager.CreateSuccess");
      await this.render();
    } catch (error) {
      notifyError(error);
      nameInput?.focus();
    }
  }

  /** @this {TagManagerApp} */
  static async #applyPreset(_event, target) {
    target.disabled = true;
    try {
      const result = await this.workspace.applyPreset(target.dataset.presetId);
      notifyInfo("FTAGS.Presets.Added", result);
      await this.render();
    } catch (error) {
      notifyError(error);
    } finally {
      target.disabled = false;
    }
  }

  /** @this {TagManagerApp} */
  static async #editTag(_event, target) {
    const tag = this.workspace.getTag(target.dataset.tagId);
    if (!tag) return;

    let result;
    try {
      result = await DialogV2.wait({
        window: { title: this.workspace.format("FTAGS.Manager.Edit", { name: tag.name }) },
        content: editDialogContent(tag, this.workspace),
        rejectClose: false,
        modal: true,
        buttons: [
          { action: "cancel", label: this.workspace.localize("FTAGS.Common.Cancel") },
          {
            action: "save",
            label: this.workspace.localize("FTAGS.Common.Save"),
            icon: "fa-solid fa-check",
            default: true,
            callback: (_event, button) => ({
              name: button.form.elements.name.value,
              color: button.form.elements.color.value,
              shape: button.form.elements.shape.value,
            }),
          },
        ],
      });
    } catch (error) {
      notifyError(error);
      return;
    }
    if (!result || result === "cancel") return;

    try {
      await this.workspace.updateTag(tag.id, result);
      notifyInfo("FTAGS.Manager.UpdateSuccess");
      await this.render();
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagManagerApp} */
  static async #deleteTag(_event, target) {
    const tag = this.workspace.getTag(target.dataset.tagId);
    if (!tag) return;
    const message = this.workspace.format("FTAGS.Manager.DeleteContent", { name: tag.name });
    const confirmed = await DialogV2.confirm({
      window: { title: this.workspace.localize("FTAGS.Manager.DeleteTitle") },
      content: `<p>${foundry.utils.escapeHTML(message)}</p>`,
      rejectClose: false,
      modal: true,
    });
    if (!confirmed) return;

    try {
      const result = await this.workspace.deleteTag(tag.id);
      if (result.failed) {
        log.error("Tag cleanup failures", result.errors);
        notifyWarn("FTAGS.Manager.DeleteAborted", { count: result.failed });
      } else if (result.indexFailures.length) {
        notifyWarn("FTAGS.Manager.DeleteIndexFailed", {
          count: result.cleaned,
          packs: result.indexFailures.join(", "),
        });
      } else {
        notifyInfo("FTAGS.Manager.DeleteSuccess", { count: result.cleaned });
      }
      await this.render();
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagManagerApp} */
  static async #exportTags() {
    try {
      const json = this.workspace.exportDictionary();
      downloadJson(json, `ftags-${this.workspace.getWorldId()}-tags.json`);
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
        const plan = this.workspace.previewImport(text);
        const summary = this.workspace.format("FTAGS.Manager.ImportSummary", plan.summary);
        const confirmed = await DialogV2.confirm({
          window: { title: this.workspace.localize("FTAGS.Manager.ImportTitle") },
          content: `<p>${foundry.utils.escapeHTML(summary)}</p>`,
          rejectClose: false,
          modal: true,
        });
        if (!confirmed) return;
        await this.workspace.commitImport(plan);
        notifyInfo("FTAGS.Manager.ImportSuccess");
        await this.render();
      } catch (error) {
        notifyError(error, "FTAGS.Errors.InvalidImport");
      }
    };
    input.click();
  }
}

export function openTagManager(parentApp = null, { workspace } = {}) {
  if (!workspace?.isGM?.()) return null;
  const app = new TagManagerApp({ workspace });
  if (parentApp?.renderChild) return parentApp.renderChild(app, { force: true });
  return app.render({ force: true });
}

function editDialogContent(tag, workspace) {
  // DialogV2 rejects a content element that carries any attribute and only keeps its
  // innerHTML, so the outer div stays bare and the styling hook lives one level down.
  const root = document.createElement("div");
  const wrapper = document.createElement("div");
  wrapper.className = "ftags-manager ftags-manager__edit";

  const nameLabel = document.createElement("label");
  const nameText = document.createElement("span");
  nameText.textContent = workspace.localize("FTAGS.Manager.NewName");
  const nameInput = document.createElement("input");
  nameInput.name = "name";
  nameInput.type = "text";
  nameInput.maxLength = MAX_TAG_NAME_LENGTH;
  // The element is serialized to innerHTML, so the value has to live in the attribute.
  nameInput.setAttribute("value", tag.name);
  nameLabel.append(nameText, nameInput);

  const colorLabel = document.createElement("label");
  const colorText = document.createElement("span");
  colorText.textContent = workspace.localize("FTAGS.Manager.Color");
  const colorInput = document.createElement("input");
  colorInput.name = "color";
  colorInput.type = "color";
  colorInput.setAttribute("value", tag.color);
  colorLabel.append(colorText, colorInput);

  const shapeLabel = document.createElement("label");
  const shapeText = document.createElement("span");
  shapeText.textContent = workspace.localize("FTAGS.Manager.Shape");
  const shapeSelect = document.createElement("select");
  shapeSelect.name = "shape";
  for (const { value, label } of shapeOptions(workspace)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    if (value === tag.shape) option.setAttribute("selected", "");
    shapeSelect.append(option);
  }
  shapeLabel.append(shapeText, shapeSelect);
  wrapper.append(nameLabel, colorLabel, shapeLabel);
  root.append(wrapper);
  return root;
}

function shapeOptions(workspace) {
  const symbols = { circle: "●", square: "■", diamond: "◆", star: "★", triangle: "▲" };
  return TAG_SHAPES.map((value) => ({
    value,
    label: `${symbols[value]} ${workspace.localize(`FTAGS.Shapes.${value}`)}`,
  }));
}

function downloadJson(json, filename) {
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
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

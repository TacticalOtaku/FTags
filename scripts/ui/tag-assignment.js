import { MODULE_ID } from "../constants.js";
import { log } from "../core/logger.js";
import { notifyError, notifyInfo, notifyWarn } from "./notifications.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class TagAssignmentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ftags-app", "ftags-assignment-app"],
    tag: "form",
    position: { width: 440, height: "auto" },
    window: { icon: "fa-solid fa-tags", resizable: true },
    form: {
      closeOnSubmit: false,
      handler: this.#save,
    },
    actions: {
      manage: this.#openManager,
    },
  };

  static PARTS = {
    content: { template: `modules/${MODULE_ID}/templates/tag-assignment.hbs` },
  };

  constructor(targetDocument, { workspace = null, openManager = null, ...options } = {}) {
    super({ id: `ftags-assignment-${targetDocument.documentName}-${targetDocument.id}`, ...options });
    if (!workspace) throw new Error("TagAssignmentApp requires a workspace");
    this.targetDocument = targetDocument;
    this.workspace = workspace;
    this.openManager = openManager;
  }

  get title() {
    return this.workspace.localize("FTAGS.Assignment.Title");
  }

  _canRender(options) {
    return this.workspace.isGM() && super._canRender(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const assignmentContext = await this.workspace.getAssignmentContext(this.targetDocument);
    return {
      ...context,
      ...assignmentContext,
    };
  }

  /** @this {TagAssignmentApp} */
  static async #save(_event, form) {
    const formData = new FormData(form);
    const tagIds = formData.getAll("tagIds").map(String);
    const applyToContents = formData.get("applyToContents") === "on";
    try {
      await this.workspace.assignTags(this.targetDocument, tagIds);
      notifyInfo("FTAGS.Assignment.SaveSuccess");
      if (applyToContents && this.targetDocument.documentName === "Folder") {
        const result = await this.workspace.propagateTagsToFolder(this.targetDocument, tagIds);
        if (result.failed) {
          log.error("Folder propagation failures", result.errors);
          notifyWarn("FTAGS.Assignment.ApplyPartial", { success: result.success, failed: result.failed });
        } else {
          notifyInfo("FTAGS.Assignment.ApplySuccess", { count: result.success });
        }
      }
      await this.close({ submitted: true });
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagAssignmentApp} */
  static async #openManager() {
    return this.openManager?.(this);
  }
}

export async function openTagAssignment(targetDocument, { parentApp = null, workspace, openManager } = {}) {
  if (!workspace?.isGM?.()) return null;
  const doc = await Promise.resolve(targetDocument);
  if (!doc) return null;
  const app = new TagAssignmentApp(doc, { workspace, openManager });
  if (parentApp?.renderChild) return parentApp.renderChild(app, { force: true });
  return app.render({ force: true });
}

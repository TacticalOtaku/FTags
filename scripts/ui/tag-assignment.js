import {MODULE_ID} from "../constants.js";
import {tagService} from "../runtime.js";
import {notifyError, notifyInfo, notifyWarn} from "./notifications.js";
import {openTagManager} from "./tag-manager.js";

const {ApplicationV2, HandlebarsApplicationMixin} = foundry.applications.api;

export class TagAssignmentApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    classes: ["ftags-app", "ftags-assignment-app"],
    tag: "form",
    position: {width: 440, height: "auto"},
    window: {icon: "fa-solid fa-tags", resizable: true},
    form: {
      closeOnSubmit: false,
      handler: this.#save
    },
    actions: {
      manage: this.#openManager
    }
  };

  static PARTS = {
    content: {template: `modules/${MODULE_ID}/templates/tag-assignment.hbs`}
  };

  constructor(targetDocument, options = {}) {
    super({id: `ftags-assignment-${targetDocument.documentName}-${targetDocument.id}`, ...options});
    this.targetDocument = targetDocument;
  }

  get title() {
    return game.i18n.localize("FTAGS.Assignment.Title");
  }

  _canRender(options) {
    return Boolean(game.user?.isGM) && super._canRender(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const assigned = new Set(tagService.getAssignments(this.targetDocument));
    const tags = tagService.listTags().map((tag) => ({...tag, assigned: assigned.has(tag.id)}));
    const isFolder = this.targetDocument.documentName === "Folder";
    const folderContentCount = isFolder ? tagService.getFolderDocumentCount(this.targetDocument) : 0;
    const pack = this.targetDocument.pack ? game.packs?.get(this.targetDocument.pack) : null;
    const isLocked = Boolean(pack?.locked);
    return {
      ...context,
      targetName: this.targetDocument.name,
      tags,
      hasTags: Boolean(tags.length),
      hasNoTags: !tags.length,
      isFolder,
      folderContentCount,
      hasNoFolderContents: folderContentCount === 0,
      isLocked,
      packTitle: pack?.title ?? ""
    };
  }

  /** @this {TagAssignmentApp} */
  static async #save(_event, form) {
    const formData = new FormData(form);
    const tagIds = formData.getAll("tagIds").map(String);
    const applyToContents = formData.get("applyToContents") === "on";
    try {
      await tagService.assignTags(this.targetDocument, tagIds);
      notifyInfo("FTAGS.Assignment.SaveSuccess");
      if (applyToContents && this.targetDocument.documentName === "Folder") {
        const result = await tagService.applyTagsToFolderContents(this.targetDocument, tagIds);
        if (result.failed) {
          console.error("FTags folder propagation failures", result.errors);
          notifyWarn("FTAGS.Assignment.ApplyPartial", {success: result.success, failed: result.failed});
        } else {
          notifyInfo("FTAGS.Assignment.ApplySuccess", {count: result.success});
        }
      }
      await this.close({submitted: true});
    } catch (error) {
      notifyError(error);
    }
  }

  /** @this {TagAssignmentApp} */
  static async #openManager() {
    return openTagManager(this);
  }
}

export async function openTagAssignment(targetDocument, parentApp = null) {
  if (!game.user?.isGM) return null;
  const doc = await Promise.resolve(targetDocument);
  if (!doc) return null;
  const app = new TagAssignmentApp(doc);
  if (parentApp?.renderChild) return parentApp.renderChild(app, {force: true});
  return app.render({force: true});
}

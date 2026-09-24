import {MODULE_ID} from "../constants.js";
import {tagRepository, tagService} from "../runtime.js";
import {focusExistingInstance, idFragment} from "./app-utils.js";
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

  /** Unsaved choices survive re-renders caused by dictionary changes elsewhere. */
  #draft = null;

  constructor(targetDocument, options = {}) {
    // World and compendium documents may share an id, so the pack takes part in the app id.
    const scope = idFragment(targetDocument.pack ?? "world");
    super({id: `ftags-assignment-${scope}-${targetDocument.documentName}-${targetDocument.id}`, ...options});
    this.targetDocument = targetDocument;
  }

  get title() {
    return game.i18n.localize("FTAGS.Assignment.Title");
  }

  _canRender(options) {
    return Boolean(game.user?.isGM) && super._canRender(options);
  }

  render(options, _options) {
    const existing = focusExistingInstance(this);
    return existing ? Promise.resolve(existing) : super.render(options, _options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.dictionaryRevision = tagRepository.dictionaryRevision;
    const saved = new Set(tagService.getAssignments(this.targetDocument));
    const assigned = this.#draft?.tagIds ?? saved;
    const tags = tagService.listTags().map((tag) => ({...tag, assigned: assigned.has(tag.id)}));
    const isFolder = this.targetDocument.documentName === "Folder";
    const folderContentCount = isFolder ? tagService.getFolderDocumentCount(this.targetDocument) : 0;
    const pack = tagRepository.getPack(this.targetDocument.pack);
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
      applyToContents: Boolean(this.#draft?.applyToContents) && folderContentCount > 0,
      isLocked,
      packTitle: pack?.title ?? ""
    };
  }

  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    // The form element outlives part re-renders, so one listener is enough.
    this.element.addEventListener("change", () => this.#captureDraft());
  }

  #captureDraft() {
    const formData = new FormData(this.element);
    this.#draft = {
      tagIds: new Set(formData.getAll("tagIds").map(String)),
      applyToContents: formData.get("applyToContents") === "on"
    };
  }

  /** @this {TagAssignmentApp} */
  static async #save(_event, form) {
    const formData = new FormData(form);
    const tagIds = formData.getAll("tagIds").map(String);
    const applyToContents = formData.get("applyToContents") === "on"
      && this.targetDocument.documentName === "Folder";
    try {
      // Load the folder contents first, so a failed read leaves nothing half-saved.
      const contents = applyToContents ? await tagService.resolveFolderContents(this.targetDocument) : null;
      await tagService.assignTags(this.targetDocument, tagIds);
      notifyInfo("FTAGS.Assignment.SaveSuccess");
      if (contents) {
        const result = await tagService.applyTagsToDocuments(contents, tagIds);
        if (result.failed) {
          console.error("FTags folder propagation failures", result.errors);
          notifyWarn("FTAGS.Assignment.ApplyPartial", {success: result.success, failed: result.failed});
        } else {
          notifyInfo("FTAGS.Assignment.ApplySuccess", {count: result.success});
        }
      }
      this.#draft = null;
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

export async function openTagAssignment(targetDocument) {
  if (!game.user?.isGM) return null;
  const doc = await Promise.resolve(targetDocument);
  if (!doc) return null;
  return new TagAssignmentApp(doc).render({force: true});
}

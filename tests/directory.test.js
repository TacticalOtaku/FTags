import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MODULE_ID } from "../scripts/constants.js";
import { TagWorkspace } from "../scripts/foundry/workspace.js";
import {
  buildColorSegments,
  createDirectoryIntegration,
  partitionVisibleTags,
} from "../scripts/ui/directory-integration.js";
import { createMemoryAdapter } from "./memory-adapter.js";

class MockElement {
  constructor(tagName, ownerDocument, attrs = {}) {
    this.nodeType = 1;
    this.tagName = tagName.toUpperCase();
    this.ownerDocument = ownerDocument;
    this.className = attrs.className ?? "";
    this.dataset = { ...(attrs.dataset ?? {}) };
    this.attributes = new Map();
    this.styleMap = new Map();
    this.style = {
      setProperty: (k, v) => this.styleMap.set(k, v),
      getPropertyValue: (k) => this.styleMap.get(k) ?? "",
    };
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.title = "";
    this.type = "";
    this.innerHTML = "";
  }

  get classList() {
    return {
      contains: (cls) => this.className.split(/\s+/).filter(Boolean).includes(cls),
    };
  }

  setAttribute(name, value) {
    const str = String(value);
    this.attributes.set(name, str);
    if (name.startsWith("data-")) {
      const camel = name.slice(5).replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      this.dataset[camel] = str;
    }
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }

  dispatchClick() {
    let prevented = false;
    let stopped = false;
    const event = {
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation: () => {
        stopped = true;
      },
    };
    for (const fn of this.listeners.get("click") ?? []) fn(event);
    return { prevented, stopped };
  }

  append(...nodes) {
    for (const node of nodes) {
      node.remove?.();
      node.parentElement = this;
      this.children.push(node);
    }
  }

  prepend(...nodes) {
    for (const node of [...nodes].reverse()) {
      node.remove?.();
      node.parentElement = this;
      this.children.unshift(node);
    }
  }

  insertBefore(node, reference) {
    node.remove?.();
    const idx = this.children.indexOf(reference);
    node.parentElement = this;
    if (idx < 0) this.children.push(node);
    else this.children.splice(idx, 0, node);
  }

  insertAdjacentElement(position, node) {
    if (position === "afterend" && this.parentElement) {
      node.remove?.();
      const idx = this.parentElement.children.indexOf(this);
      node.parentElement = this.parentElement;
      this.parentElement.children.splice(idx + 1, 0, node);
    }
  }

  remove() {
    if (!this.parentElement) return;
    const idx = this.parentElement.children.indexOf(this);
    if (idx >= 0) this.parentElement.children.splice(idx, 1);
    this.parentElement = null;
  }

  matchesSelector(part) {
    const trimmed = part.trim();
    const attrMatch = /^([^[]+)?\[data-([a-z0-9-]+)(?:="([^"]*)")?\]$/i.exec(trimmed);
    let selectorHead = trimmed;
    let attrCheck = null;
    if (attrMatch) {
      selectorHead = attrMatch[1] ?? "";
      const dataKey = attrMatch[2].replace(/-([a-z])/g, (_, ch) => ch.toUpperCase());
      attrCheck = { key: dataKey, value: attrMatch[3] };
    }
    if (selectorHead) {
      const classes = selectorHead.split(".").filter(Boolean);
      for (const cls of classes) {
        if (!this.classList.contains(cls)) return false;
      }
    }
    if (attrCheck) {
      if (!(attrCheck.key in this.dataset)) return false;
      if (attrCheck.value !== undefined && this.dataset[attrCheck.key] !== attrCheck.value) return false;
    }
    return true;
  }

  matches(selector) {
    return selector.split(",").some((part) => this.matchesSelector(part));
  }

  closest(selector) {
    let cur = this;
    while (cur) {
      if (cur.matches(selector)) return cur;
      cur = cur.parentElement;
    }
    return null;
  }

  querySelectorAll(selector) {
    const out = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) out.push(child);
        visit(child);
      }
    };
    visit(this);
    return out;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
}

function createMockDocument() {
  return {
    createElement(tagName) {
      return new MockElement(tagName, this);
    },
  };
}

describe("DirectoryIntegration", () => {
  it("partitions visible vs overflow tags and generates multi-stop gradients", () => {
    const tags = [
      { id: "a", name: "A", color: "#111111" },
      { id: "b", name: "B", color: "#222222" },
      { id: "c", name: "C", color: "#333333" },
      { id: "d", name: "D", color: "#444444" },
      { id: "e", name: "E", color: "#555555" },
    ];
    const part = partitionVisibleTags(tags, 3);
    assert.equal(part.visible.length, 3);
    assert.equal(part.hidden.length, 2);
    assert.equal(
      buildColorSegments(part.hidden),
      "linear-gradient(to right, #444444 0.00%, #444444 50.00%, #555555 50.00%, #555555 100.00%)",
    );
  });

  it("enhances directories, deduplicates compendium index prep, and dispatches toolbar & strip actions", async () => {
    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    const t1 = await workspace.createTag({ name: "One", color: "#112233", shape: "circle" });
    const t2 = await workspace.createTag({ name: "Two", color: "#445566", shape: "square" });
    const t3 = await workspace.createTag({ name: "Three", color: "#778899", shape: "diamond" });
    const t4 = await workspace.createTag({ name: "Four", color: "#AABBCC", shape: "star" });

    const pack = adapter.addPack({
      collection: "world.actors",
      documentName: "Actor",
      indexed: false,
      documents: [
        { id: "doc1", name: "Lich", flags: { [MODULE_ID]: { tagIds: [t1.id, t2.id, t3.id, t4.id] } } },
      ],
    });

    const spotlightCalls = [];
    const managerCalls = [];
    const integration = createDirectoryIntegration({
      workspace,
      openSpotlight: (opts) => spotlightCalls.push(opts),
      openTagManager: (app) => managerCalls.push(app),
      openTagAssignment: () => {},
    });

    const dom = createMockDocument();
    const buildRoot = () => {
      const root = dom.createElement("section");
      const list = dom.createElement("ol");
      list.className = "directory-list";
      const row = dom.createElement("li");
      row.className = "directory-item document";
      row.setAttribute("data-entry-id", "doc1");
      const nameEl = dom.createElement("span");
      nameEl.className = "entry-name";
      row.append(nameEl);
      list.append(row);
      root.append(list);
      return root;
    };

    const app = { documentName: "Actor", collection: pack };
    const rootA = buildRoot();
    const rootB = buildRoot();
    await Promise.all([integration.enhanceDirectory(app, rootA), integration.enhanceDirectory(app, rootB)]);

    assert.equal(adapter.state.indexCalls.length, 1);

    const strips = rootA.querySelectorAll(".ftags-tag-strip");
    assert.equal(strips.length, 4);
    assert.equal(strips[3].classList.contains("ftags-tag-strip--overflow"), true);
    assert.equal(strips[0].dataset.ftagsShape, "circle");

    const stripClick = strips[0].dispatchClick();
    assert.equal(stripClick.prevented, true);
    assert.equal(stripClick.stopped, true);
    assert.deepEqual(spotlightCalls[0], { includeTagId: t1.id });

    rootA.querySelector(".ftags-directory-toolbar__search").dispatchClick();
    assert.equal(spotlightCalls[1], undefined);

    rootA.querySelector(".ftags-directory-toolbar__manage").dispatchClick();
    assert.equal(managerCalls[0], app);
  });

  it("unifies context menus and folder resolution across world and compendium collections", async () => {
    const adapter = createMemoryAdapter();
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();

    // Create a world folder and a compendium folder with the SAME id ("shared-id") to test precedence
    adapter.addWorldFolder({ id: "shared-id", name: "World Folder", type: "Actor" });
    const packFolder = adapter.makeFolder({
      id: "shared-id",
      name: "Compendium Folder",
      type: "Actor",
      pack: "world.npcs",
    });
    const pack = adapter.addPack({
      collection: "world.npcs",
      documentName: "Actor",
      folders: [packFolder],
      documents: [{ id: "mob1", name: "Goblin" }],
    });

    const hooks = new Map();
    const previousHooks = globalThis.Hooks;
    globalThis.Hooks = {
      on: (name, fn) => {
        if (!hooks.has(name)) hooks.set(name, []);
        hooks.get(name).push(fn);
      },
    };

    try {
      const assigned = [];
      const integration = createDirectoryIntegration({
        workspace,
        openSpotlight: () => {},
        openTagManager: () => {},
        openTagAssignment: (target, parentApp) => assigned.push({ target, parentApp }),
      });
      integration.registerHooks();

      // Test getFolderContextOptions with `metadata.type` fallback and ID collision resolution
      const folderApp = { metadata: { type: "Actor" }, collection: pack };
      const folderMenu = [];
      for (const fn of hooks.get("getFolderContextOptions") ?? []) fn(folderApp, folderMenu);
      for (const fn of hooks.get("getFolderContextOptions") ?? []) fn(folderApp, folderMenu);
      assert.equal(folderMenu.length, 1, "Must not register duplicate context menu entries");

      const dom = createMockDocument();
      const folderRow = dom.createElement("li");
      folderRow.setAttribute("data-folder-id", "shared-id");
      assert.equal(folderMenu[0].visible(folderRow), true);
      folderMenu[0].onClick(null, folderRow);
      assert.equal(assigned[0].target, packFolder);

      // Test getActorContextOptions loading a full document asynchronously on click
      const entryMenu = [];
      const entryApp = { documentName: "Actor", collection: pack };
      for (const fn of hooks.get("getActorContextOptions") ?? []) fn(entryApp, entryMenu);
      assert.equal(entryMenu.length, 1);

      const entryRow = dom.createElement("li");
      entryRow.setAttribute("data-entry-id", "mob1");
      assert.equal(entryMenu[0].condition(entryRow), true);
      assert.equal(adapter.state.loadCalls.length, 0);

      await entryMenu[0].callback(entryRow, null);
      assert.equal(adapter.state.loadCalls.length, 1);
      assert.equal(assigned[1].target.id, "mob1");
      assert.equal(assigned[1].target.name, "Goblin");
    } finally {
      globalThis.Hooks = previousHooks;
    }
  });

  it("renders world collections, compendium directory, and open compendium windows on refresh", () => {
    const openPackApp = {
      rendered: true,
      calls: 0,
      render(force, opts) {
        this.calls += 1;
        this.last = { force, opts };
      },
    };
    const closedPackApp = {
      rendered: false,
      calls: 0,
      render() {
        this.calls += 1;
      },
    };
    const compDir = {
      calls: 0,
      render() {
        this.calls += 1;
      },
    };

    const adapter = createMemoryAdapter({
      compendiumDirectory: compDir,
      packs: [
        {
          collection: "world.actors",
          documentName: "Actor",
          apps: [openPackApp, closedPackApp],
        },
      ],
    });
    const workspace = new TagWorkspace(adapter);
    workspace.registerSettings();
    const integration = createDirectoryIntegration({ workspace });

    integration.renderSupportedDirectories();
    assert.equal(adapter.getWorldCollection("Actor").renderedCalls.length, 1);
    assert.equal(compDir.calls, 1);
    assert.equal(openPackApp.calls, 1);
    assert.equal(closedPackApp.calls, 0);
  });
});

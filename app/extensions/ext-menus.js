/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global ExtensionAPIPersistent, EventManager, tabTracker */

// The menus (contextMenus) API for the one context menu a page has in Swell.
// Firefox builds XUL menus (browser/components/extensions/parent/ext-menus.js);
// here the items an extension created are turned into plain descriptions that
// the window's ContextMenu draws, and a click comes back as an action. The
// child side is Firefox's own, unmodified.
//
// A page's menu only gets the items of extensions that may see the page's
// container: the copies of the add-ons of that space.

var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { ExtensionMenus } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionMenus.sys.mjs"
);
var { SwellExtensionUI } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellExtensionUI.sys.mjs"
);

var { ExtensionError, parseMatchPatterns } = ExtensionUtils;

// Map[Extension -> Map[ID -> MenuItem]]
var gMenuMap = new Map();

// Map[Extension -> MenuItem]
var gRootItems = new Map();

// If id is not specified for an item we use an integer.
var gNextMenuItemID = 0;

var MENU_LABEL_LENGTH = 64;
var SELECTION_LABEL_LENGTH = 15;

var CONTEXTS = {
  onAudio: "audio",
  onEditable: "editable",
  inFrame: "frame",
  onImage: "image",
  onLink: "link",
  onPassword: "password",
  isTextSelected: "selection",
  onVideo: "video",
};

function menuContexts(contextData) {
  const contexts = new Set(["all"]);
  for (const [key, value] of Object.entries(CONTEXTS)) {
    if (contextData[key]) {
      contexts.add(value);
    }
  }
  if (contexts.size == 1) {
    contexts.add("page");
  }
  return contexts;
}

function addMenuEventInfo(info, contextData, extension, includeSensitiveData) {
  if (contextData.onVideo) {
    info.mediaType = "video";
  } else if (contextData.onAudio) {
    info.mediaType = "audio";
  } else if (contextData.onImage) {
    info.mediaType = "image";
  }
  info.editable = contextData.onEditable || false;
  if (!includeSensitiveData) {
    return;
  }
  if (contextData.onLink) {
    info.linkText = contextData.linkText;
    info.linkUrl = contextData.linkUrl;
  }
  if (contextData.onAudio || contextData.onImage || contextData.onVideo) {
    info.srcUrl = contextData.srcUrl;
  }
  info.pageUrl = contextData.pageUrl;
  if (contextData.isTextSelected) {
    info.selectionText = contextData.selectionText;
  }
}

/**
 *
 */
class MenuItem {
  constructor(extension, createProperties, isRoot = false) {
    this.extension = extension;
    this.children = [];
    this.parent = null;

    this.setDefaults();
    this.setProps(createProperties);

    if (!this.hasOwnProperty("_id")) {
      this.id = gNextMenuItemID++;
    }
    if (!isRoot && !this.parent) {
      this.root.addChild(this);
    }
  }

  setProps(createProperties) {
    ExtensionMenus.mergeMenuProperties(this, createProperties);

    if (createProperties.documentUrlPatterns != null) {
      this.documentUrlMatchPattern = parseMatchPatterns(
        this.documentUrlPatterns,
        { restrictSchemes: this.extension.restrictSchemes }
      );
    }
    if (createProperties.targetUrlPatterns != null) {
      this.targetUrlMatchPattern = parseMatchPatterns(this.targetUrlPatterns, {
        restrictSchemes: false,
      });
    }
    if (createProperties.parentId && !createProperties.contexts) {
      this.contexts = this.parent.contexts;
    }
  }

  setDefaults() {
    this.setProps({
      type: "normal",
      checked: false,
      contexts: ["all"],
      enabled: true,
      visible: true,
    });
  }

  set id(id) {
    if (this.hasOwnProperty("_id")) {
      throw new ExtensionError("ID of a MenuItem cannot be changed");
    }
    if (gMenuMap.get(this.extension).has(id)) {
      throw new ExtensionError(`ID already exists: ${id}`);
    }
    this._id = id;
  }

  get id() {
    return this._id;
  }

  ensureValidParentId(parentId) {
    if (parentId === undefined) {
      return;
    }
    const menuMap = gMenuMap.get(this.extension);
    if (!menuMap.has(parentId)) {
      throw new ExtensionError(`Cannot find menu item with id ${parentId}`);
    }
    for (let item = menuMap.get(parentId); item; item = item.parent) {
      if (item === this) {
        throw new ExtensionError(
          "MenuItem cannot be an ancestor (or self) of its new parent."
        );
      }
    }
  }

  set parentId(parentId) {
    this.ensureValidParentId(parentId);
    if (this.parent) {
      this.parent.detachChild(this);
    }
    if (parentId === undefined) {
      this.root.addChild(this);
    } else {
      gMenuMap.get(this.extension).get(parentId).addChild(this);
    }
  }

  get parentId() {
    return this.parent ? this.parent.id : undefined;
  }

  addChild(child) {
    if (child.parent) {
      throw new Error("Child MenuItem already has a parent.");
    }
    this.children.push(child);
    child.parent = this;
  }

  detachChild(child) {
    const idx = this.children.indexOf(child);
    if (idx < 0) {
      throw new Error("Child MenuItem not found, it cannot be removed.");
    }
    this.children.splice(idx, 1);
    child.parent = null;
  }

  get root() {
    if (!gRootItems.has(this.extension)) {
      gRootItems.set(
        this.extension,
        new MenuItem(this.extension, { title: this.extension.name }, true)
      );
    }
    return gRootItems.get(this.extension);
  }

  get descendantIds() {
    return this.children.flatMap(m => [m.id, ...m.descendantIds]);
  }

  remove() {
    if (this.parent) {
      this.parent.detachChild(this);
    }
    for (const child of this.children.slice(0)) {
      child.remove();
    }
    gMenuMap.get(this.extension).delete(this.id);
    if (this.root == this) {
      gRootItems.delete(this.extension);
    }
  }

  getClickInfo(contextData, wasChecked) {
    const info = { menuItemId: this.id };
    if (this.parent) {
      info.parentMenuItemId = this.parentId;
    }
    addMenuEventInfo(info, contextData, this.extension, true);
    if (this.type === "checkbox" || this.type === "radio") {
      info.checked = this.checked;
      info.wasChecked = wasChecked;
    }
    return info;
  }

  enabledForContext(contextData) {
    if (!this.visible) {
      return false;
    }
    const contexts = menuContexts(contextData);
    if (!this.contexts.some(n => contexts.has(n))) {
      return false;
    }
    const pageURI = Services.io.newURI(contextData.pageUrl);
    if (this.documentUrlMatchPattern?.matches(pageURI) === false) {
      return false;
    }
    const target = this.targetUrlMatchPattern;
    if (target) {
      const uris = [];
      if (contextData.onImage || contextData.onAudio || contextData.onVideo) {
        uris.push(Services.io.newURI(contextData.srcUrl));
      }
      if (contextData.onLink && contextData.linkUrl) {
        uris.push(Services.io.newURI(contextData.linkUrl));
      }
      if (!uris.some(uri => target.matches(uri))) {
        return false;
      }
    }
    return true;
  }
}

// What an item is called in the menu: "%s" stands for the selected text, and
// "&" marks an access key, which a menu drawn in the page does not have.
function labelOf(item, contextData) {
  let label = item.title ?? "";
  if (label.includes("%s")) {
    let selection = contextData.selectionText ?? "";
    if (selection.length > SELECTION_LABEL_LENGTH) {
      selection = `${selection.slice(0, SELECTION_LABEL_LENGTH)}…`;
    }
    label = label.replaceAll("%s", selection);
  }
  label = label.replace(/&(&?)/g, "$1");
  return label.length > MENU_LABEL_LENGTH
    ? `${label.slice(0, MENU_LABEL_LENGTH)}…`
    : label;
}

function chosen(item, contextData) {
  const wasChecked = item.checked;
  if (item.type == "checkbox") {
    item.checked = !item.checked;
  } else if (item.type == "radio") {
    // The radio items next to each other form one group.
    const siblings = item.parent.children;
    let first = siblings.indexOf(item);
    let last = first;
    while (first > 0 && siblings[first - 1].type == "radio") {
      first--;
    }
    while (last < siblings.length - 1 && siblings[last + 1].type == "radio") {
      last++;
    }
    for (const sibling of siblings.slice(first, last + 1)) {
      sibling.checked = sibling === item;
    }
  }
  if (item.type == "checkbox" || item.type == "radio") {
    ExtensionMenus.updateMenu(item.extension, item.id, {
      checked: item.checked,
    });
  }
  item.extension.emit(
    "webext-menu-menuitem-click",
    item.getClickInfo(contextData, wasChecked),
    contextData.nativeTab
  );
}

function describe(item, contextData, shown) {
  if (item.type == "separator") {
    return { separator: true };
  }
  if (!item.enabledForContext(contextData)) {
    return null;
  }
  shown.push(item.id);
  const description = {
    label: labelOf(item, contextData),
    disabled: !item.enabled,
    action: () => chosen(item, contextData),
  };
  if (item.type == "checkbox" || item.type == "radio") {
    description.checked = item.checked;
  }
  const children = clean(
    item.children.map(child => describe(child, contextData, shown))
  );
  if (children.length) {
    description.children = children;
    delete description.action;
  }
  return description;
}

// Drops what is not shown, and separators that would be first, last or twice.
function clean(descriptions) {
  const items = [];
  for (const description of descriptions) {
    if (!description) {
      continue;
    }
    if (description.separator && (!items.length || items.at(-1).separator)) {
      continue;
    }
    items.push(description);
  }
  if (items.at(-1)?.separator) {
    items.pop();
  }
  return items;
}

this.menusInternal = class extends ExtensionAPIPersistent {
  #promiseInitialized = null;
  #wasShown = false;

  constructor(extension) {
    super(extension);
    gMenuMap.set(extension, new Map());
    this.provider = {
      items: contextData => this.#items(contextData),
      hidden: () => this.#hidden(),
    };
    SwellExtensionUI.menuProviders.add(this.provider);
  }

  #canAccess(contextData) {
    const { extension } = this;
    return (
      contextData.nativeTab &&
      (extension.canAccessContainer?.(contextData.nativeTab.userContextId) ??
        true)
    );
  }

  #items(contextData) {
    const { extension } = this;
    const root = gRootItems.get(extension);
    if (!root || !this.#canAccess(contextData)) {
      return [];
    }
    const shown = [];
    const top = clean(
      root.children.map(child => describe(child, contextData, shown))
    );
    this.#wasShown = true;
    extension.emit("webext-menu-shown", shown, {
      ...contextData,
      tab: contextData.nativeTab,
    });
    if (top.length > 1) {
      return [{ label: extension.name, children: top }];
    }
    return top;
  }

  #hidden() {
    if (this.#wasShown) {
      this.#wasShown = false;
      this.extension.emit("webext-menu-hidden");
    }
  }

  async initExtensionMenus() {
    const { extension } = this;

    await ExtensionMenus.asyncInitForExtension(extension);

    if (
      extension.hasShutdown ||
      !ExtensionMenus.shouldPersistMenus(extension)
    ) {
      return;
    }

    const notifyMenusCreated = () =>
      extension.emit("webext-menus-created", gMenuMap.get(extension));

    const menus = ExtensionMenus.getMenus(extension);
    const createErrorMenuIds = [];
    for (const createProperties of menus.values()) {
      // Parents come before their children in the persisted menus.
      try {
        const menuItem = new MenuItem(extension, createProperties);
        gMenuMap.get(extension).set(menuItem.id, menuItem);
      } catch (err) {
        console.error(
          `Unexpected error on recreating persisted menu ${createProperties?.id} for ${extension.id}: ${err}`
        );
        createErrorMenuIds.push(createProperties.id);
      }
    }
    if (createErrorMenuIds.length) {
      ExtensionMenus.deleteMenus(extension, createErrorMenuIds);
    }
    notifyMenusCreated();
  }

  onStartup() {
    this.#promiseInitialized = this.initExtensionMenus();
  }

  onShutdown() {
    const { extension } = this;
    SwellExtensionUI.menuProviders.delete(this.provider);
    gMenuMap.delete(extension);
    gRootItems.delete(extension);
  }

  PERSISTENT_EVENTS = {
    onShown({ fire }) {
      const { extension } = this;
      const listener = (event, menuIds, contextData) => {
        const info = {
          menuIds,
          contexts: Array.from(menuContexts(contextData)),
        };
        const nativeTab = contextData.tab;
        // The event comes before the user chose anything of this extension, so
        // what the page holds is only given to an extension that may see it.
        const includeSensitiveData =
          (nativeTab &&
            extension.tabManager.hasActiveTabPermission(nativeTab)) ||
          extension.allowedOrigins.matches(contextData.pageUrl);
        addMenuEventInfo(info, contextData, extension, includeSensitiveData);
        fire.sync(info, nativeTab && extension.tabManager.convert(nativeTab));
      };
      extension.on("webext-menu-shown", listener);
      return {
        unregister() {
          extension.off("webext-menu-shown", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },
    onHidden({ fire }) {
      const { extension } = this;
      const listener = () => fire.sync();
      extension.on("webext-menu-hidden", listener);
      return {
        unregister() {
          extension.off("webext-menu-hidden", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },
    onClicked({ context, fire }) {
      const { extension } = this;
      const listener = async (event, info, nativeTab) => {
        const { linkedBrowser } = nativeTab || tabTracker.activeTab;
        const tab = nativeTab && extension.tabManager.convert(nativeTab);
        if (fire.wakeup) {
          await fire.wakeup();
          if (!tabTracker.getTabForBrowser(linkedBrowser)) {
            console.error(
              "menus.onClicked: target tab closed during background startup."
            );
            return;
          }
        }
        context.withPendingBrowser(linkedBrowser, () => fire.sync(info, tab));
      };
      extension.on("webext-menu-menuitem-click", listener);
      return {
        unregister() {
          extension.off("webext-menu-menuitem-click", listener);
        },
        convert(_fire, _context) {
          fire = _fire;
          context = _context;
        },
      };
    },
  };

  getAPI(context) {
    const { extension } = context;

    const menus = {
      // The menu is built when it opens, so there is nothing to refresh.
      refresh() {},

      onShown: new EventManager({
        context,
        module: "menusInternal",
        event: "onShown",
        name: "menus.onShown",
        extensionApi: this,
      }).api(),
      onHidden: new EventManager({
        context,
        module: "menusInternal",
        event: "onHidden",
        name: "menus.onHidden",
        extensionApi: this,
      }).api(),
    };

    return {
      contextMenus: menus,
      menus,
      menusInternal: {
        create: async createProperties => {
          await this.#promiseInitialized;
          if (extension.hasShutdown) {
            return;
          }
          if (ExtensionMenus.shouldPersistMenus(extension)) {
            if (!createProperties.id) {
              throw new ExtensionError(
                "menus.create requires an id for non-persistent background scripts."
              );
            }
            if (gMenuMap.get(extension).has(createProperties.id)) {
              throw new ExtensionError(
                `The menu id ${createProperties.id} already exists in menus.create.`
              );
            }
          }
          const menuItem = new MenuItem(extension, createProperties);
          ExtensionMenus.addMenu(extension, createProperties);
          gMenuMap.get(extension).set(menuItem.id, menuItem);
        },

        update: async (id, updateProperties) => {
          await this.#promiseInitialized;
          if (extension.hasShutdown) {
            return;
          }
          const menuItem = gMenuMap.get(extension).get(id);
          if (!menuItem) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          menuItem.setProps(updateProperties);
          ExtensionMenus.updateMenu(extension, id, updateProperties);
        },

        remove: async id => {
          await this.#promiseInitialized;
          if (extension.hasShutdown) {
            return;
          }
          const menuItem = gMenuMap.get(extension).get(id);
          if (!menuItem) {
            throw new ExtensionError(`Cannot find menu item with id ${id}`);
          }
          const menuIds = [menuItem.id, ...menuItem.descendantIds];
          menuItem.remove();
          ExtensionMenus.deleteMenus(extension, menuIds);
        },

        removeAll: async () => {
          await this.#promiseInitialized;
          if (extension.hasShutdown) {
            return;
          }
          gRootItems.get(extension)?.remove();
          ExtensionMenus.deleteAllMenus(extension);
        },

        onClicked: new EventManager({
          context,
          module: "menusInternal",
          event: "onClicked",
          name: "menus.onClicked",
          extensionApi: this,
        }).api(),
      },
    };
  }
};

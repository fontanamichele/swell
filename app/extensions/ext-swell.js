/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global global, extensions, WindowTrackerBase, TabTrackerBase, TabBase,
   WindowBase, TabManagerBase, WindowManagerBase, EventEmitter,
   getCookieStoreIdForTab, isContainerCookieStoreId, CONTAINER_STORE */

// The platform layer the toolkit's WebExtension code expects of an
// application: how to find windows and tabs, and how to describe them to an
// extension. Firefox does this in browser/components/extensions/parent/
// ext-browser.js on top of gBrowser; Swell has one window and its engine
// bridge, so this is built on those (the layout follows ext-android.js).
//
// Every tab belongs to one space and so to one container. An extension is
// only shown the tabs of containers it may access (Extension.canAccessContainer).

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { SwellWindows } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellWindows.sys.mjs"
);

var { ExtensionError } = ExtensionUtils;
var { defineLazyGetter } = ExtensionCommon;

const BrowserStatusFilter = Components.Constructor(
  "@mozilla.org/appshell/component/browser-status-filter;1",
  "nsIWebProgress",
  "addProgressListener"
);

const WINDOW_TYPE = "navigator:browser";
const PROGRESS_FLAGS =
  Ci.nsIWebProgress.NOTIFY_STATE_ALL |
  Ci.nsIWebProgress.NOTIFY_LOCATION |
  Ci.nsIWebProgress.NOTIFY_STATUS;

const bridge = () => SwellWindows.bridge;

// Calls a tab progress listener with the browser prepended to the arguments.
/**
 *
 */
class BrowserProgressListener {
  constructor(browser, listener) {
    this.browser = browser;
    this.listener = listener;
    this.filter = new BrowserStatusFilter(this, PROGRESS_FLAGS);
    browser.addProgressListener(this.filter, PROGRESS_FLAGS);
  }

  destroy() {
    this.browser.removeProgressListener(this.filter);
    this.filter.removeProgressListener(this);
  }

  delegate(method, ...args) {
    this.listener[method]?.(this.browser, ...args);
  }

  onLocationChange(...args) {
    this.delegate("onLocationChange", ...args);
  }

  onStateChange(...args) {
    this.delegate("onStateChange", ...args);
  }

  onStatusChange(...args) {
    this.delegate("onStatusChange", ...args);
  }
}

/**
 *
 */
class WindowTracker extends WindowTrackerBase {
  #progress = new Map(); // listener -> Map(browser -> BrowserProgressListener)

  get topWindow() {
    return SwellWindows.window;
  }

  get topNonPBWindow() {
    return SwellWindows.window;
  }

  isBrowserWindow(window) {
    return (
      window.document.documentElement.getAttribute("windowtype") == WINDOW_TYPE
    );
  }

  addProgressListener(window, listener) {
    if (this.#progress.has(listener)) {
      return;
    }
    const wrappers = new Map();
    this.#progress.set(listener, wrappers);
    const attach = tab => {
      if (!wrappers.has(tab.browser)) {
        wrappers.set(
          tab.browser,
          new BrowserProgressListener(tab.browser, listener)
        );
      }
    };
    bridge().tabs().forEach(attach);
    wrappers.stopListening = bridge().on("tabopened", snapshot => {
      const tab = bridge().tab(snapshot.liveTab);
      if (tab) {
        attach(tab);
      }
    });
  }

  removeProgressListener(window, listener) {
    const wrappers = this.#progress.get(listener);
    if (!wrappers) {
      return;
    }
    wrappers.stopListening?.();
    for (const wrapper of wrappers.values()) {
      wrapper.destroy();
    }
    this.#progress.delete(listener);
  }
}

/**
 *
 */
class TabTracker extends TabTrackerBase {
  #ids = new WeakMap();
  #nextId = 1;
  #open = new Map(); // liveTab -> native tab, to name a tab that is gone

  init() {
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    const b = bridge();
    for (const tab of b.tabs()) {
      this.#open.set(tab.liveTab, tab);
    }
    b.on("tabopened", snapshot => {
      const nativeTab = b.tab(snapshot.liveTab);
      if (nativeTab) {
        this.#open.set(snapshot.liveTab, nativeTab);
        // Its browser has no address before its frame loader exists.
        nativeTab.ready.then(() => this.emit("tab-created", { nativeTab }));
      }
    });
    b.on("tabclosed", ({ liveTab }) => {
      const nativeTab = this.#open.get(liveTab);
      this.#open.delete(liveTab);
      if (nativeTab) {
        this.emit("tab-removed", {
          nativeTab,
          tabId: this.getId(nativeTab),
          windowId: windowTracker.getId(SwellWindows.window),
          isWindowClosing: false,
        });
      }
    });
    let previous = b.selectedTab;
    b.on("selected", snapshot => {
      const nativeTab = snapshot ? b.tab(snapshot.liveTab) : null;
      if (nativeTab) {
        this.emit("tab-activated", {
          tabId: this.getId(nativeTab),
          previousTabId: previous ? this.getId(previous) : undefined,
          windowId: windowTracker.getId(SwellWindows.window),
          nativeTab,
        });
        previous = nativeTab;
      }
    });
  }

  getId(nativeTab) {
    let id = this.#ids.get(nativeTab);
    if (!id) {
      id = this.#nextId++;
      this.#ids.set(nativeTab, id);
    }
    return id;
  }

  getTab(id, default_ = undefined) {
    for (const nativeTab of bridge().tabs()) {
      if (this.getId(nativeTab) == id) {
        return nativeTab;
      }
    }
    if (default_ !== undefined) {
      return default_;
    }
    throw new ExtensionError(`Invalid tab ID: ${id}`);
  }

  getTabForBrowser(browser) {
    return bridge()?.tabForBrowser(browser) ?? null;
  }

  getBrowserData(browser) {
    const window = browser.documentGlobal;
    if (!window || window != SwellWindows.window) {
      return { tabId: -1, windowId: -1 };
    }
    const nativeTab = this.getTabForBrowser(browser);
    return {
      tabId: nativeTab ? this.getId(nativeTab) : -1,
      windowId: windowTracker.getId(window),
    };
  }

  get activeTab() {
    return bridge()?.selectedTab ?? null;
  }
}

const windowTracker = new WindowTracker();
const tabTracker = new TabTracker();

Object.assign(global, { tabTracker, windowTracker });

// A container of Swell is not a contextual identity of the engine: the
// engine's list of them is empty, so a cookie store id of a container is
// accepted when a space uses that container.
global.getContainerForCookieStoreId = function (storeId) {
  if (!isContainerCookieStoreId(storeId)) {
    return null;
  }
  const id = parseInt(storeId.substring(CONTAINER_STORE.length), 10);
  const known = SwellWindows.bridge?.userContextIds().includes(id);
  return known ? id : null;
};

/**
 *
 */
class Tab extends TabBase {
  get _favIconUrl() {
    return this.nativeTab.icon ?? undefined;
  }

  get attention() {
    return false;
  }

  get audible() {
    return false;
  }

  get autoDiscardable() {
    return true;
  }

  get browser() {
    return this.nativeTab.browser;
  }

  get discarded() {
    return false;
  }

  get cookieStoreId() {
    return getCookieStoreIdForTab(this, this.nativeTab);
  }

  get height() {
    return this.browser.clientHeight;
  }

  get hidden() {
    return false;
  }

  get incognito() {
    return false;
  }

  get index() {
    return bridge().tabs(this.nativeTab.space).indexOf(this.nativeTab);
  }

  get lastAccessed() {
    return undefined;
  }

  get mutedInfo() {
    return { muted: false };
  }

  get pinned() {
    return false;
  }

  get active() {
    return bridge().selectedTab === this.nativeTab;
  }

  get highlighted() {
    return this.active;
  }

  get status() {
    return this.nativeTab.loading ? "loading" : "complete";
  }

  get successorTabId() {
    return -1;
  }

  get groupId() {
    return -1;
  }

  get splitViewId() {
    return -1;
  }

  get width() {
    return this.browser.clientWidth;
  }

  get window() {
    return SwellWindows.window;
  }

  get windowId() {
    return windowTracker.getId(this.window);
  }

  get isArticle() {
    return false;
  }

  get isInReaderMode() {
    return false;
  }

  get sharingState() {
    const sharing = this.nativeTab.sharing;
    return {
      screen: sharing?.screen ? "Screen" : undefined,
      microphone: !!sharing?.microphone,
      camera: !!sharing?.camera,
    };
  }
}

// Per-tab data of an extension (a browser action's badge, for one) that goes
// when its tab does.
/**
 *
 */
class TabContext extends EventEmitter {
  constructor(getDefaultPrototype) {
    super();
    this.getDefaultPrototype = getDefaultPrototype;
    this.tabData = new Map();
    windowTracker.addListener("progress", this);
    this.stopSelected = bridge().on("selected", snapshot => {
      const tab = snapshot ? bridge().tab(snapshot.liveTab) : null;
      if (tab) {
        this.emit("tab-select", tab);
      }
    });
    this.stopClosed = bridge().on("tabclosed", ({ liveTab }) =>
      this.emit("tab-closed", { liveTab })
    );
  }

  onLocationChange(browser, webProgress, request, locationURI, flags) {
    if (!webProgress.isTopLevel) {
      return;
    }
    const nativeTab = tabTracker.getTabForBrowser(browser);
    if (!nativeTab) {
      return;
    }
    const fromBrowse = !(
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
    );
    this.emit(
      "location-change",
      {
        id: tabTracker.getId(nativeTab),
        linkedBrowser: browser,
        selected: bridge().selectedTab === nativeTab,
      },
      fromBrowse
    );
  }

  get(tabId) {
    if (!this.tabData.has(tabId)) {
      this.tabData.set(tabId, Object.create(this.getDefaultPrototype(tabId)));
    }
    return this.tabData.get(tabId);
  }

  clear(tabId) {
    this.tabData.delete(tabId);
  }

  shutdown() {
    windowTracker.removeListener("progress", this);
    this.stopSelected?.();
    this.stopClosed?.();
  }
}

/**
 *
 */
class Window extends WindowBase {
  get focused() {
    return this.window.document.hasFocus();
  }

  get top() {
    return this.window.screenY;
  }

  get left() {
    return this.window.screenX;
  }

  get width() {
    return this.window.outerWidth;
  }

  get height() {
    return this.window.outerHeight;
  }

  get incognito() {
    return false;
  }

  get alwaysOnTop() {
    return false;
  }

  get isLastFocused() {
    return true;
  }

  static getState(window) {
    switch (window.windowState) {
      case window.STATE_MAXIMIZED:
        return "maximized";
      case window.STATE_MINIMIZED:
        return "minimized";
      case window.STATE_FULLSCREEN:
        return "fullscreen";
      default:
        return "normal";
    }
  }

  get state() {
    return Window.getState(this.window);
  }

  set state(state) {
    const { window } = this;
    switch (state) {
      case "maximized":
        window.maximize();
        break;
      case "minimized":
        window.minimize();
        break;
      case "normal":
        window.restore();
        break;
    }
  }

  *getTabs() {
    const { tabManager } = this.extension;
    for (const nativeTab of bridge().tabs()) {
      if (tabManager.canAccessTab(nativeTab)) {
        yield tabManager.getWrapper(nativeTab);
      }
    }
  }

  *getHighlightedTabs() {
    const active = this.activeTab;
    if (active) {
      yield active;
    }
  }

  get activeTab() {
    const nativeTab = bridge().selectedTab;
    const { tabManager } = this.extension;
    return nativeTab && tabManager.canAccessTab(nativeTab)
      ? tabManager.getWrapper(nativeTab)
      : null;
  }

  getTabAtIndex(index) {
    return [...this.getTabs()][index];
  }
}

Object.assign(global, { Tab, TabContext, Window });

/**
 *
 */
class TabManager extends TabManagerBase {
  get(tabId, default_ = undefined) {
    const nativeTab = tabTracker.getTab(tabId, default_);
    return nativeTab && nativeTab !== default_
      ? this.getWrapper(nativeTab)
      : default_;
  }

  addActiveTabPermission(nativeTab = tabTracker.activeTab) {
    return super.addActiveTabPermission(nativeTab);
  }

  revokeActiveTabPermission(nativeTab = tabTracker.activeTab) {
    return super.revokeActiveTabPermission(nativeTab);
  }

  canAccessTab(nativeTab) {
    return this.extension.canAccessContainer?.(nativeTab.userContextId) ?? true;
  }

  wrapTab(nativeTab) {
    return new Tab(this.extension, nativeTab, tabTracker.getId(nativeTab));
  }
}

/**
 *
 */
class WindowManager extends WindowManagerBase {
  get(windowId, context) {
    return this.getWrapper(windowTracker.getWindow(windowId, context));
  }

  *getAll(context) {
    for (const window of windowTracker.browserWindows()) {
      if (!this.canAccessWindow(window, context)) {
        continue;
      }
      const wrapped = this.getWrapper(window);
      if (wrapped) {
        yield wrapped;
      }
    }
  }

  wrapWindow(window) {
    return new Window(this.extension, window, windowTracker.getId(window));
  }
}

// eslint-disable-next-line mozilla/balanced-listeners
extensions.on("startup", (type, extension) => {
  defineLazyGetter(extension, "tabManager", () => new TabManager(extension));
  defineLazyGetter(
    extension,
    "windowManager",
    () => new WindowManager(extension)
  );
});

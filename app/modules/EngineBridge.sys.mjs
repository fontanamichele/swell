/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The only code that creates web content. Every `<browser>` made here carries
// the `userContextId` of its space's identity, so Gecko keeps each space's
// storage and network state apart; context 0 never holds web content.
//
// Events from the engine (navigations, titles, closes) are reported to the
// core; the core's open/select/close requests are carried out here.

import { Transition } from "moz-src:///swell/app/modules/Core.sys.mjs";

const WebProgress = Ci.nsIWebProgressListener;
const BrowserDOMWindow = Ci.nsIBrowserDOMWindow;
const NOT_REMOTE = null;
const BLANK = "about:blank";

// The page zoom steps of the engine, from 30% to 500%. The engine keeps the
// zoom as a 32-bit float, so compare with a margin.
const ZOOM_STEPS = [
  0.3, 0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.2, 1.33, 1.5, 1.7, 2, 2.4, 3, 4, 5,
];

function hostOf(url) {
  try {
    const { protocol, hostname } = new URL(url);
    return protocol == "http:" || protocol == "https:" ? hostname : "";
  } catch (e) {
    return "";
  }
}

const BROWSER_ATTRIBUTES = {
  message: "true",
  messagemanagergroup: "browsers",
  type: "content",
  manualactiveness: "true",
  autocompletepopup: "PopupAutoComplete",
};

// Forwards top-level state of one browser to the bridge.
/**
 *
 */
class ProgressListener {
  QueryInterface = ChromeUtils.generateQI([
    "nsIWebProgressListener",
    "nsIWebProgressListener2",
    "nsISupportsWeakReference",
  ]);

  constructor(bridge, tab) {
    this.bridge = bridge;
    this.tab = tab;
  }

  onLocationChange(webProgress, request, location, flags) {
    if (webProgress.isTopLevel) {
      this.bridge.locationChanged(this.tab, location, flags);
    }
  }

  onStateChange(webProgress, request, stateFlags) {
    if (
      !webProgress.isTopLevel ||
      !(stateFlags & WebProgress.STATE_IS_NETWORK)
    ) {
      return;
    }
    if (stateFlags & WebProgress.STATE_START) {
      this.bridge.loadingChanged(this.tab, true);
    } else if (stateFlags & WebProgress.STATE_STOP) {
      this.bridge.loadingChanged(this.tab, false);
    }
  }

  onProgressChange() {}
  onStatusChange() {}
  onSecurityChange() {}
  onContentBlockingEvent() {}
  onProgressChange64() {}
  onRefreshAttempted() {
    return true;
  }
}

// One tab of the window: a live `<browser>` and what is known about it. A tab
// the engine opened by itself has no `liveTab` until the core has recorded it.
/**
 *
 */
class Tab {
  liveTab = null;
  node = null;
  title = "";
  url = "";
  icon = null;
  loading = false;
  canGoBack = false;
  canGoForward = false;
  crashed = false;
  pendingTransition = null;
  zoomHost = "";
  listener = null;
  findbar = null;
  findbarSlot = null;
  ready = Promise.resolve();

  constructor({ space, userContextId, browser }) {
    this.space = space;
    this.userContextId = userContextId;
    this.browser = browser;
  }

  snapshot(selected) {
    return {
      liveTab: this.liveTab,
      node: this.node,
      space: this.space,
      title: this.title,
      url: this.url,
      icon: this.icon,
      loading: this.loading,
      canGoBack: this.canGoBack,
      canGoForward: this.canGoForward,
      crashed: this.crashed,
      selected,
    };
  }
}

/**
 *
 */
export class EngineBridge {
  #window;
  #core;
  #pages;
  #windowId;
  #spaces = new Map();
  #tabs = new Map();
  #byBrowser = new WeakMap();
  #lastSelected = new Map();
  #subscribers = new Map();
  #selected = null;
  #activeSpace = null;
  #unsubscribe = [];
  #openInBackground = new Set();

  // options.window: The Swell window.
  // options.pages: Container for the `<browser>` elements.
  // [options.windowId]:
  constructor({ window, core, pages, windowId = "main" }) {
    this.#window = window;
    this.#core = core;
    this.#pages = pages;
    this.#windowId = windowId;
  }

  get windowId() {
    return this.#windowId;
  }

  get activeSpace() {
    return this.#activeSpace;
  }

  get selectedTab() {
    return this.#selected;
  }

  // The tab behind a live tab id, or undefined.
  tab(liveTab) {
    return this.#tabs.get(liveTab);
  }

  // The tab hosting `browser`, or undefined.
  tabForBrowser(browser) {
    return this.#byBrowser.get(browser);
  }

  tabs(space = null) {
    return [...this.#tabs.values()].filter(tab => !space || tab.space == space);
  }

  // event: One of tabopened, tabclosed, tabstate, selected.
  // Returns Unsubscribes.
  on(event, callback) {
    if (!this.#subscribers.has(event)) {
      this.#subscribers.set(event, new Set());
    }
    this.#subscribers.get(event).add(callback);
    return () => this.#subscribers.get(event).delete(callback);
  }

  #emit(event, detail) {
    for (const callback of this.#subscribers.get(event) ?? []) {
      try {
        callback(detail);
      } catch (e) {
        console.error(`Swell bridge ${event} subscriber failed`, e);
      }
    }
  }

  async init(initialSpace) {
    await this.#core.openWindow(this.#windowId);
    for (const space of await this.#core.listSpaces()) {
      this.#spaces.set(space.id, space);
    }
    this.#activeSpace =
      initialSpace ?? this.#spaces.keys().next().value ?? null;
    this.#unsubscribe.push(
      this.#core.on("spacesChanged", spaces => {
        this.#spaces = new Map(spaces.map(space => [space.id, space]));
      }),
      this.#core.on("activeSpaceChanged", ({ window, space }) => {
        if (window == this.#windowId) {
          this.showSpace(space);
        }
      }),
      this.#core.on("openTab", event => this.#onOpenTab(event)),
      this.#core.on("selectTab", ({ window, liveTab }) => {
        if (window == this.#windowId) {
          this.selectTab(liveTab);
        }
      }),
      this.#core.on("closeTab", ({ window, liveTab }) => {
        if (window == this.#windowId) {
          this.#removeTab(this.#tabs.get(liveTab));
        }
      })
    );
    Services.obs.addObserver(this, "oop-frameloader-crashed", true);
    this.#installBrowserDOMWindow();
  }

  QueryInterface = ChromeUtils.generateQI([
    "nsIObserver",
    "nsISupportsWeakReference",
  ]);

  observe(subject, topic) {
    if (topic != "oop-frameloader-crashed") {
      return;
    }
    const tab = this.#byBrowser.get(subject.ownerElement);
    if (tab) {
      tab.crashed = true;
      tab.loading = false;
      this.#emitState(tab);
    }
  }

  // Makes `space` the space whose tabs are shown.
  showSpace(space) {
    this.#activeSpace = space;
    const remembered = this.#lastSelected.get(space);
    const tab =
      (remembered && this.#tabs.get(remembered)) ||
      this.tabs(space).at(-1) ||
      null;
    this.#show(tab);
  }

  // Opens `url` in a new tab of the active space (or `space`).
  //
  // [space]:
  // Returns The live tab id.
  openUrl(url, space = this.#activeSpace, { background = false } = {}) {
    if (background) {
      this.#openInBackground.add(url);
    }
    return this.#core.openUrl(this.#windowId, space, url);
  }

  // Opens a saved node, or selects it if it is already open.
  openNode(node, space = this.#activeSpace) {
    return this.#core.openNode(this.#windowId, space, node);
  }

  // Loads what the user typed into the selected tab.
  loadInSelected(url) {
    const tab = this.#selected;
    if (!tab) {
      return this.openUrl(url);
    }
    tab.pendingTransition = Transition.TYPED;
    this.#load(tab.browser, url);
    return Promise.resolve(tab.liveTab);
  }

  // Opens the find bar of the selected tab, making it on first use.
  async openFind() {
    const tab = this.#selected;
    if (!tab) {
      return;
    }
    if (!tab.findbar) {
      const doc = this.#window.document;
      const slot = doc.createElement("div");
      slot.className = "findbar-slot";
      const findbar = doc.createXULElement("findbar");
      slot.append(findbar);
      doc.getElementById("findbars").append(slot);
      tab.findbar = findbar;
      tab.findbarSlot = slot;
      await new Promise(resolve => this.#window.requestAnimationFrame(resolve));
      if (!this.#tabs.has(tab.liveTab) && tab.liveTab) {
        slot.remove();
        return;
      }
      findbar.browser = tab.browser;
    }
    this.#showFindBars();
    tab.findbar.startFind(tab.findbar.FIND_NORMAL);
  }

  // Only the selected tab's find bar is visible.
  #showFindBars() {
    for (const tab of this.#tabs.values()) {
      if (tab.findbarSlot) {
        tab.findbarSlot.hidden = tab !== this.#selected;
      }
    }
  }

  goBack() {
    this.#selected?.browser.goBack();
  }

  goForward() {
    this.#selected?.browser.goForward();
  }

  // Zooms the selected page: 1 in, -1 out, 0 back to 100%. The zoom of a
  // site is remembered by the core for the space's identity.
  zoom(direction) {
    const tab = this.#selected;
    const context = tab?.browser.browsingContext;
    if (!context) {
      return;
    }
    let next = 1;
    if (direction) {
      const current = context.fullZoom;
      const steps = direction > 0 ? ZOOM_STEPS : [...ZOOM_STEPS].reverse();
      next =
        steps.find(step =>
          direction > 0 ? step > current + 1e-3 : step < current - 1e-3
        ) ?? current;
    }
    context.fullZoom = next;
    const host = hostOf(tab.url);
    if (host) {
      this.#core
        .setSiteZoom(tab.space, host, next)
        .catch(e => console.error("Swell: could not save the zoom", e));
    }
  }

  // Puts the saved zoom of `host` on the page when it changes host.
  #applyZoom(tab, host) {
    if (tab.zoomHost === host) {
      return;
    }
    tab.zoomHost = host;
    const context = tab.browser.browsingContext;
    if (!host) {
      if (context) {
        context.fullZoom = 1;
      }
      return;
    }
    this.#core
      .siteZoom(tab.space, host)
      .then(factor => {
        const live = tab.browser.browsingContext;
        if (tab.zoomHost === host && live) {
          live.fullZoom = factor;
        }
      })
      .catch(e => console.error("Swell: could not read the zoom", e));
  }

  reload() {
    const tab = this.#selected;
    if (tab?.crashed) {
      this.#revive(tab);
    } else {
      tab?.browser.reload();
    }
  }

  stop() {
    this.#selected?.browser.stop();
  }

  // Closes a tab the user closed; the core is told, and drops a Today node.
  async closeTab(liveTab) {
    const tab = this.#tabs.get(liveTab);
    if (!tab) {
      return;
    }
    const next = this.#neighbour(tab);
    this.#removeTab(tab, next);
    try {
      await this.#core.onTabClosed(liveTab);
    } catch (e) {
      console.warn("Swell: the core did not know the closed tab", e);
    }
  }

  // Brings a tab to the front; it must belong to the active space.
  selectTab(liveTab) {
    const tab = this.#tabs.get(liveTab);
    if (tab) {
      this.#show(tab);
    }
  }

  #onOpenTab({ window, space, userContextId, url, liveTab, node }) {
    if (window != this.#windowId) {
      return;
    }
    const tab = this.#newTab({ space, userContextId, url });
    tab.liveTab = liveTab;
    tab.node = node;
    this.#register(tab);
    tab.ready = this.#attach(tab, url);
    const background = this.#openInBackground.delete(url);
    if (space == this.#activeSpace && !background) {
      this.#show(tab);
    }
  }

  // Refuses to create web content outside a space's own container.
  assertContainer(space, userContextId) {
    const known = this.#spaces.get(space);
    if (!Number.isInteger(userContextId) || userContextId <= 0) {
      throw new Error(
        `Refusing to open web content in container ${userContextId}`
      );
    }
    if (!known || known.userContextId != userContextId) {
      throw new Error(
        `Container ${userContextId} does not belong to space ${space}`
      );
    }
  }

  #predictRemoteType(url, { userContextId, preferredRemoteType = undefined }) {
    return ChromeUtils.predictRemoteTypeForURI(url, {
      window: this.#window,
      userContextId,
      preferredRemoteType,
    });
  }

  #newTab({
    space,
    userContextId,
    url,
    openWindowInfo = null,
    preferredRemoteType = undefined,
    forceNotRemote = false,
    skipLoad = false,
  }) {
    this.assertContainer(space, userContextId);
    const document = this.#window.document;
    const browser = document.createXULElement("browser");
    browser.permanentKey = new (Cu.getGlobalForObject(Services).Object)();
    for (const [name, value] of Object.entries(BROWSER_ATTRIBUTES)) {
      browser.setAttribute(name, value);
    }
    browser.setAttribute("usercontextid", String(userContextId));
    browser.setAttribute("maychangeremoteness", "true");
    const remoteType = forceNotRemote
      ? NOT_REMOTE
      : this.#predictRemoteType(url ?? BLANK, {
          userContextId,
          preferredRemoteType,
        });
    if (remoteType) {
      browser.setAttribute("remoteType", remoteType);
      browser.setAttribute("remote", "true");
    }
    if (openWindowInfo) {
      browser.openWindowInfo = openWindowInfo;
    }
    if (skipLoad || url != BLANK) {
      browser.setAttribute("nodefaultsrc", "true");
    }
    browser.hidden = true;
    return new Tab({ space, userContextId, browser });
  }

  #register(tab) {
    this.#tabs.set(tab.liveTab, tab);
    this.#byBrowser.set(tab.browser, tab);
    this.#emit("tabopened", tab.snapshot(false));
  }

  // Puts the browser in the page and, once Gecko has created its frame
  // loader, starts listening to it and loads `url`.
  #attach(tab, url) {
    const { browser } = tab;
    const created = new Promise(resolve =>
      browser.addEventListener("XULFrameLoaderCreated", resolve, { once: true })
    );
    this.#pages.appendChild(browser);
    this.#watch(tab);
    return created.then(() => {
      tab.listener = new ProgressListener(this, tab);
      browser.addProgressListener(
        tab.listener,
        Ci.nsIWebProgress.NOTIFY_LOCATION |
          Ci.nsIWebProgress.NOTIFY_STATE_NETWORK
      );
      if (url) {
        this.#load(browser, url);
      }
    });
  }

  #watch(tab) {
    const { browser } = tab;
    browser.addEventListener("pagetitlechanged", () => {
      tab.title = browser.contentTitle;
      this.#emitState(tab);
      this.#report(tab, liveTab =>
        this.#core.onNavigation(
          liveTab,
          tab.url,
          tab.title || tab.url,
          Transition.OTHER
        )
      );
    });
    browser.addEventListener("DOMWindowClose", event => {
      event.preventDefault();
      if (tab.liveTab) {
        this.closeTab(tab.liveTab);
      }
    });
  }

  #load(browser, url) {
    browser.fixupAndLoadURIString(url, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
  }

  // Runs a report to the core once the tab has a live tab id.
  #report(tab, report) {
    tab.ready
      .then(() => report(tab.liveTab))
      .catch(e => console.warn("Swell: a report to the core failed", e));
  }

  locationChanged(tab, location, flags) {
    const { browser } = tab;
    tab.canGoBack = browser.canGoBack;
    tab.canGoForward = browser.canGoForward;
    tab.crashed = false;
    if (flags & WebProgress.LOCATION_CHANGE_ERROR_PAGE) {
      this.#emitState(tab);
      return;
    }
    const url = location.spec;
    tab.url = url;
    tab.title = browser.contentTitle || tab.title;
    this.#emitState(tab);
    this.#applyZoom(tab, hostOf(url));
    if (url == BLANK) {
      return;
    }
    let transition = tab.pendingTransition ?? Transition.LINK;
    tab.pendingTransition = null;
    if (flags & WebProgress.LOCATION_CHANGE_RELOAD) {
      transition = Transition.RELOAD;
    } else if (flags & WebProgress.LOCATION_CHANGE_SAME_DOCUMENT) {
      transition = Transition.OTHER;
    }
    this.#report(tab, liveTab =>
      this.#core.onNavigation(liveTab, url, tab.title || url, transition)
    );
  }

  loadingChanged(tab, loading) {
    tab.loading = loading;
    this.#emitState(tab);
  }

  setIcon(tab, icon) {
    tab.icon = icon;
    this.#emitState(tab);
    this.#report(tab, liveTab => this.#core.onFavicon(liveTab, icon));
  }

  #emitState(tab) {
    this.#emit("tabstate", tab.snapshot(tab === this.#selected));
  }

  #show(tab) {
    if (this.#selected && this.#selected !== tab) {
      this.#setActive(this.#selected, false);
    }
    this.#selected = tab;
    for (const other of this.#tabs.values()) {
      if (other !== tab) {
        other.browser.hidden = true;
      }
    }
    if (tab) {
      this.#lastSelected.set(tab.space, tab.liveTab);
      tab.browser.hidden = false;
      this.#setActive(tab, true);
    }
    this.#showFindBars();
    this.#emit("selected", tab ? tab.snapshot(true) : null);
  }

  #setActive(tab, active) {
    tab.ready.then(() => {
      tab.browser.docShellIsActive = active && tab === this.#selected;
      if (active && tab === this.#selected) {
        tab.browser.focus();
      }
    });
  }

  #neighbour(tab) {
    const siblings = this.tabs(tab.space);
    const index = siblings.indexOf(tab);
    return siblings[index + 1] ?? siblings[index - 1] ?? null;
  }

  #removeTab(tab, next = undefined) {
    if (!tab) {
      return;
    }
    if (next === undefined) {
      next = this.#neighbour(tab);
    }
    this.#tabs.delete(tab.liveTab);
    this.#byBrowser.delete(tab.browser);
    if (tab.listener) {
      try {
        tab.browser.removeProgressListener(tab.listener);
      } catch (e) {
        // The browser is already gone.
      }
    }
    tab.browser.remove();
    tab.findbarSlot?.remove();
    if (this.#lastSelected.get(tab.space) == tab.liveTab) {
      this.#lastSelected.delete(tab.space);
    }
    this.#emit("tabclosed", { liveTab: tab.liveTab, node: tab.node });
    if (this.#selected === tab) {
      this.#selected = null;
      this.#show(next && next.space == this.#activeSpace ? next : null);
    }
  }

  // Replaces a crashed tab's browser with a fresh one in the same container.
  #revive(tab) {
    const url = tab.url;
    const old = tab.browser;
    const replacement = this.#newTab({
      space: tab.space,
      userContextId: tab.userContextId,
      url,
    });
    this.#byBrowser.delete(old);
    old.remove();
    tab.browser = replacement.browser;
    tab.listener = null;
    tab.crashed = false;
    this.#byBrowser.set(tab.browser, tab);
    tab.ready = this.#attach(tab, url);
    if (this.#selected === tab) {
      tab.browser.hidden = false;
      this.#setActive(tab, true);
    }
    this.#emitState(tab);
  }

  // `window.open` and `target=_blank`: Gecko wants the new browser (or its
  // browsing context) back at once, so it is made here and the core is told
  // afterwards. The new tab stays in the opener's container and space.
  #openFromContent({ uri, openWindowInfo, openerBrowser, where, skipLoad }) {
    const opener = this.#byBrowser.get(
      openerBrowser ?? openWindowInfo?.parent?.top.embedderElement
    );
    const base = opener ?? this.#selected;
    const space = base?.space ?? this.#activeSpace;
    const userContextId = openWindowInfo
      ? openWindowInfo.originAttributes.userContextId
      : base?.userContextId;
    const url = uri ? uri.spec : BLANK;
    const tab = this.#newTab({
      space,
      userContextId,
      url,
      openWindowInfo,
      preferredRemoteType: opener?.browser.remoteType,
      forceNotRemote: !!openWindowInfo && !openWindowInfo.isRemote,
      skipLoad,
    });
    const background = where == BrowserDOMWindow.OPEN_NEWTAB_BACKGROUND;
    this.#byBrowser.set(tab.browser, tab);
    tab.ready = this.#attach(tab, skipLoad ? null : url).then(async () => {
      const { liveTab, node } = await this.#core.onTabOpened(
        this.#windowId,
        space,
        url
      );
      tab.liveTab = liveTab;
      tab.node = node;
      this.#register(tab);
      if (!background && space == this.#activeSpace) {
        this.#show(tab);
      }
    });
    tab.ready.catch(e =>
      console.error("Swell: could not record an opened tab", e)
    );
    return tab;
  }

  #installBrowserDOMWindow() {
    const bridge = this;
    const opensTab = where =>
      where == BrowserDOMWindow.OPEN_NEWTAB ||
      where == BrowserDOMWindow.OPEN_NEWTAB_BACKGROUND ||
      where == BrowserDOMWindow.OPEN_NEWTAB_FOREGROUND ||
      where == BrowserDOMWindow.OPEN_NEWTAB_AFTER_CURRENT ||
      where == BrowserDOMWindow.OPEN_DEFAULTWINDOW ||
      where == BrowserDOMWindow.OPEN_NEWWINDOW;
    const inCurrentTab = (uri, openWindowInfo, where) => {
      if (where != BrowserDOMWindow.OPEN_CURRENTWINDOW || !bridge.#selected) {
        return null;
      }
      if (uri) {
        bridge.#load(bridge.#selected.browser, uri.spec);
      }
      return bridge.#selected.browser.browsingContext;
    };
    this.#window.browserDOMWindow = {
      QueryInterface: ChromeUtils.generateQI(["nsIBrowserDOMWindow"]),
      createContentWindow(uri, openWindowInfo, where) {
        return (
          inCurrentTab(uri, openWindowInfo, where) ??
          bridge.#openFromContent({
            uri: null,
            openWindowInfo,
            where,
            skipLoad: true,
          })?.browser.browsingContext ??
          null
        );
      },
      openURI(uri, openWindowInfo, where) {
        return (
          inCurrentTab(uri, openWindowInfo, where) ??
          bridge.#openFromContent({
            uri,
            openWindowInfo,
            where,
            skipLoad: false,
          })?.browser.browsingContext ??
          null
        );
      },
      // A remote content process opens windows through these two, and wants
      // the new <browser> element.
      createContentWindowInFrame(uri, params, where) {
        if (!opensTab(where)) {
          return null;
        }
        return (
          bridge.#openFromContent({
            uri: null,
            openWindowInfo: params.openWindowInfo,
            openerBrowser: params.openerBrowser,
            where,
            skipLoad: true,
          })?.browser ?? null
        );
      },
      openURIInFrame(uri, params, where) {
        if (!opensTab(where)) {
          return null;
        }
        return (
          bridge.#openFromContent({
            uri,
            openWindowInfo: params.openWindowInfo,
            openerBrowser: params.openerBrowser,
            where,
            skipLoad: false,
          })?.browser ?? null
        );
      },
      canClose() {
        return true;
      },
      get tabCount() {
        return bridge.#tabs.size;
      },
    };
  }

  destroy() {
    for (const off of this.#unsubscribe) {
      off();
    }
    this.#unsubscribe = [];
    Services.obs.removeObserver(this, "oop-frameloader-crashed");
    this.#window.browserDOMWindow = null;
  }
}
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

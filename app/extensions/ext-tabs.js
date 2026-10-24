/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The tabs API on Swell's tabs (see ext-swell.js). The shape follows the
// application-neutral parts of Firefox's and GeckoView's implementations;
// there is one window, a tab belongs to one space, and a space is one
// container, so a new tab opens in the space of the extension's container.

var { SwellWindows } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellWindows.sys.mjs"
);

const tabsBridge = () => SwellWindows.bridge;

this.tabs = class extends ExtensionAPIPersistent {
  tabEventRegistrar({ event, listener }) {
    const { extension } = this;
    const { tabManager } = extension;
    return ({ fire }) => {
      const listener2 = (eventName, eventData, ...args) => {
        if (
          eventData.nativeTab &&
          !tabManager.canAccessTab(eventData.nativeTab)
        ) {
          return;
        }
        listener(fire, eventData, ...args);
      };
      tabTracker.on(event, listener2);
      return {
        unregister() {
          tabTracker.off(event, listener2);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    };
  }

  PERSISTENT_EVENTS = {
    onActivated: this.tabEventRegistrar({
      event: "tab-activated",
      listener: (fire, event) => {
        fire.async({
          tabId: event.tabId,
          previousTabId: event.previousTabId,
          windowId: event.windowId,
        });
      },
    }),
    onCreated: this.tabEventRegistrar({
      event: "tab-created",
      listener: (fire, event) => {
        const { tabManager } = this.extension;
        fire.async(tabManager.convert(event.nativeTab));
      },
    }),
    onRemoved: this.tabEventRegistrar({
      event: "tab-removed",
      listener: (fire, event) => {
        fire.async(event.tabId, {
          windowId: event.windowId,
          isWindowClosing: event.isWindowClosing,
        });
      },
    }),
    onUpdated({ fire }) {
      const { tabManager } = this.extension;
      const restricted = ["url", "favIconUrl", "title"];
      const known = new Map(); // live tab -> what was last reported

      const sanitize = (tab, changed) => {
        const result = {};
        let needed = false;
        for (const prop in changed) {
          if (!restricted.includes(prop) || tab.hasTabPermission) {
            needed = true;
            result[prop] = changed[prop];
          }
        }
        return [needed, result];
      };

      const stop = tabsBridge().on("tabstate", snapshot => {
        const nativeTab = tabsBridge().tab(snapshot.liveTab);
        if (!nativeTab || !tabManager.canAccessTab(nativeTab)) {
          return;
        }
        const before = known.get(snapshot.liveTab) ?? {};
        const status = snapshot.loading ? "loading" : "complete";
        const now = {
          status,
          url: snapshot.url,
          title: snapshot.title,
          favIconUrl: snapshot.icon ?? undefined,
        };
        known.set(snapshot.liveTab, now);
        const changed = {};
        for (const prop in now) {
          if (now[prop] !== before[prop] && now[prop] !== undefined) {
            changed[prop] = now[prop];
          }
        }
        if (!Object.keys(changed).length) {
          return;
        }
        const tab = tabManager.getWrapper(nativeTab);
        const [needed, changeInfo] = sanitize(tab, changed);
        if (needed) {
          fire.async(tab.id, changeInfo, tab.convert());
        }
      });

      return {
        unregister() {
          stop();
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },
  };

  getAPI(context) {
    const { extension } = context;
    const { tabManager } = extension;
    const extensionApi = this;
    const module = "tabs";

    function getTabOrActive(tabId) {
      const nativeTab =
        tabId !== null && tabId !== undefined
          ? tabTracker.getTab(tabId)
          : tabTracker.activeTab;
      if (!nativeTab || !tabManager.canAccessTab(nativeTab)) {
        throw new ExtensionError(
          tabId == null ? "Cannot access activeTab" : `Invalid tab ID: ${tabId}`
        );
      }
      return nativeTab;
    }

    async function promiseTabWhenReady(tabId) {
      const nativeTab = getTabOrActive(tabId);
      await tabTracker.awaitTabReady(nativeTab);
      return tabManager.getWrapper(nativeTab);
    }

    // The tab behind a live tab id, once the bridge has made it.
    function tabOnceOpen(liveTab) {
      return new Promise(resolve => {
        const present = tabsBridge().tab(liveTab);
        if (present) {
          resolve(present);
          return;
        }
        const stop = tabsBridge().on("tabopened", snapshot => {
          if (snapshot.liveTab == liveTab) {
            stop();
            resolve(tabsBridge().tab(liveTab));
          }
        });
      });
    }

    function checkedUrl(url) {
      url = context.uri.resolve(url);
      if (
        !ExtensionUtils.isExtensionUrl(url) &&
        !context.checkLoadURL(url, { dontReportErrors: true })
      ) {
        throw new ExtensionError(`Illegal URL: ${url}`);
      }
      return url;
    }

    function loadURIInTab(nativeTab, url) {
      const { browser } = nativeTab;
      let loadFlags = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
      let { principal } = context;
      const isAboutUrl = url.startsWith("about:");
      if (
        isAboutUrl ||
        (ExtensionUtils.isExtensionUrl(url) &&
          !context.checkLoadURL(url, { dontReportErrors: true }))
      ) {
        principal =
          Services.scriptSecurityManager.getLoadContextContentPrincipal(
            Services.io.newURI(url),
            browser.loadContext
          );
      }
      if (isAboutUrl) {
        loadFlags |= Ci.nsIWebNavigation.LOAD_FLAGS_DISALLOW_INHERIT_PRINCIPAL;
      }
      browser.fixupAndLoadURIString(url, {
        loadFlags,
        triggeringPrincipal: principal,
      });
    }

    // The container a new tab opens in: the one asked for if the extension may
    // use it, else the extension's own (or the active space's).
    function containerFor(cookieStoreId) {
      let userContextId;
      if (cookieStoreId) {
        userContextId = getUserContextIdForCookieStoreId(
          extension,
          cookieStoreId,
          false
        );
      } else if (extension.boundUserContextId >= 0) {
        userContextId = extension.boundUserContextId;
      } else {
        userContextId = tabsBridge().userContextOf(tabsBridge().activeSpace);
      }
      if (
        !userContextId ||
        !(extension.canAccessContainer?.(userContextId) ?? true)
      ) {
        throw new ExtensionError(
          `Illegal cookieStoreId: ${cookieStoreId ?? "(none)"}`
        );
      }
      return userContextId;
    }

    return {
      tabs: {
        onActivated: new EventManager({
          context,
          module,
          event: "onActivated",
          extensionApi,
        }).api(),
        onCreated: new EventManager({
          context,
          module,
          event: "onCreated",
          extensionApi,
        }).api(),
        onRemoved: new EventManager({
          context,
          module,
          event: "onRemoved",
          extensionApi,
        }).api(),
        onUpdated: new EventManager({
          context,
          module,
          event: "onUpdated",
          extensionApi,
        }).api(),
        onHighlighted: new EventManager({
          context,
          name: "tabs.onHighlighted",
          register: fire => {
            const listener = (eventName, event) =>
              fire.async({ tabIds: [event.tabId], windowId: event.windowId });
            tabTracker.on("tab-activated", listener);
            return () => tabTracker.off("tab-activated", listener);
          },
        }).api(),
        // Tabs never move between windows or get replaced here.
        onAttached: new EventManager({
          context,
          name: "tabs.onAttached",
          register: () => () => {},
        }).api(),
        onDetached: new EventManager({
          context,
          name: "tabs.onDetached",
          register: () => () => {},
        }).api(),
        onMoved: new EventManager({
          context,
          name: "tabs.onMoved",
          register: () => () => {},
        }).api(),
        onReplaced: new EventManager({
          context,
          name: "tabs.onReplaced",
          register: () => () => {},
        }).api(),

        async create({ active, cookieStoreId, url } = {}) {
          const userContextId = containerFor(cookieStoreId);
          const space = tabsBridge().spaceForContext(userContextId);
          if (!space) {
            throw new ExtensionError("No space uses that container");
          }
          url = url ? checkedUrl(url) : "about:blank";
          const liveTab = await tabsBridge().openUrl(url, space, {
            background: active === false,
          });
          const nativeTab = await tabOnceOpen(liveTab);
          await nativeTab.ready;
          tabTracker.addTabReadyBlocker(nativeTab);
          if (active !== false && space == tabsBridge().activeSpace) {
            tabsBridge().selectTab(liveTab);
          }
          return tabManager.convert(nativeTab);
        },

        async remove(tabIds) {
          const ids = Array.isArray(tabIds) ? tabIds : [tabIds];
          await Promise.all(
            ids.map(async tabId => {
              const nativeTab = getTabOrActive(tabId);
              await tabsBridge().closeTab(nativeTab.liveTab);
            })
          );
        },

        async update(tabId, { active, url } = {}) {
          const nativeTab = getTabOrActive(tabId);
          if (url !== null && url !== undefined) {
            loadURIInTab(nativeTab, checkedUrl(url));
          }
          if (active && nativeTab.space == tabsBridge().activeSpace) {
            tabsBridge().selectTab(nativeTab.liveTab);
          }
          return tabManager.convert(nativeTab);
        },

        async reload(tabId, reloadProperties) {
          const { browser } = getTabOrActive(tabId);
          let flags = Ci.nsIWebNavigation.LOAD_FLAGS_NONE;
          if (reloadProperties?.bypassCache) {
            flags |= Ci.nsIWebNavigation.LOAD_FLAGS_BYPASS_CACHE;
          }
          browser.reloadWithFlags(flags);
        },

        async get(tabId) {
          return tabManager.convert(getTabOrActive(tabId));
        },

        async getCurrent() {
          if (context.tabId) {
            return tabManager.get(context.tabId).convert();
          }
          return undefined;
        },

        async query(queryInfo) {
          return Array.from(tabManager.query(queryInfo, context), tab =>
            tab.convert()
          );
        },

        async detectLanguage(tabId) {
          const tab = await promiseTabWhenReady(tabId);
          const results = await tab.queryContent("DetectLanguage", {});
          return results[0];
        },

        async executeScript(tabId, details) {
          const tab = await promiseTabWhenReady(tabId);
          return tab.executeScript(context, details);
        },

        async insertCSS(tabId, details) {
          const tab = await promiseTabWhenReady(tabId);
          return tab.insertCSS(context, details);
        },

        async removeCSS(tabId, details) {
          const tab = await promiseTabWhenReady(tabId);
          return tab.removeCSS(context, details);
        },

        goForward(tabId) {
          getTabOrActive(tabId).browser.goForward(false);
        },

        goBack(tabId) {
          getTabOrActive(tabId).browser.goBack(false);
        },
      },
    };
  }
};

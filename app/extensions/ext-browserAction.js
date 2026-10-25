/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global global, ExtensionAPIPersistent, EventManager, tabTracker, windowTracker,
   TabContext */

// The browserAction (and MV3 action) API: the button of an extension and its
// popup. Firefox puts the button in a CustomizableUI widget and the popup in
// a XUL panel (browser/components/extensions/parent/ext-browserAction.js);
// here the state lives in the toolkit's ExtensionActions and the window
// (content/extension-actions.mjs) draws the buttons of the active space and
// hosts the popup, through SwellExtensionUI.

var { ExtensionUtils } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs"
);
var { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);
var { BrowserActionBase } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionActions.sys.mjs"
);
var { SwellExtensionUI } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellExtensionUI.sys.mjs"
);

var { ExtensionError } = ExtensionUtils;
var { IconDetails, StartupCache } = ExtensionParent;

// WeakMap[Extension -> browserAction API instance]
var browserActionMap = new WeakMap();

/**
 *
 */
class BrowserAction extends BrowserActionBase {
  constructor(extension, buttonDelegate) {
    const tabContext = new TabContext(() => this.getContextData(null));
    super(tabContext, extension);
    this.buttonDelegate = buttonDelegate;
  }

  updateOnChange() {
    SwellExtensionUI.actionsChanged();
  }

  getTab(tabId) {
    return tabId !== null ? tabTracker.getTab(tabId) : null;
  }

  getWindow(windowId) {
    return windowId !== null ? windowTracker.getWindow(windowId) : null;
  }

  dispatchClick(tab, clickInfo) {
    this.buttonDelegate.emit("click", tab, clickInfo);
  }

  isPanelShownBlockingOpenPopup() {
    return false;
  }
}

this.browserAction = class extends ExtensionAPIPersistent {
  static for(extension) {
    return browserActionMap.get(extension);
  }

  async onManifestEntry() {
    const { extension } = this;

    this.action = new BrowserAction(extension, this);
    await this.action.loadIconData();
    this.iconStyles = new Map();
    this.tabManager = extension.tabManager;
    browserActionMap.set(extension, this);

    SwellExtensionUI.actions.set(extension.id, {
      extension,
      describe: nativeTab => this.describe(nativeTab),
      activate: nativeTab =>
        this.action.triggerClickOrPopup(nativeTab, {
          button: 0,
          modifiers: [],
        }),
    });
    SwellExtensionUI.actionsChanged();
  }

  onShutdown() {
    const { extension } = this;
    browserActionMap.delete(extension);
    this.action.onShutdown();
    SwellExtensionUI.actions.delete(extension.id);
    SwellExtensionUI.actionsChanged();
  }

  // What the window needs to draw the button for a tab.
  describe(nativeTab) {
    const { extension, action } = this;
    const data = action.getContextData(nativeTab);
    const serializeColor = ([r, g, b, a]) =>
      `rgba(${r}, ${g}, ${b}, ${a / 255})`;
    return {
      title: data.title || extension.name,
      enabled: !!data.enabled,
      popup: data.popup || "",
      badgeText: data.badgeText,
      badgeStyle: [
        `background-color: ${serializeColor(data.badgeBackgroundColor)}`,
        `color: ${serializeColor(action.getTextColor(data))}`,
      ].join("; "),
      iconStyle: this.iconStyle(data.icon),
    };
  }

  iconStyle(icons) {
    const cached = this.iconStyles.get(icons);
    if (cached) {
      return cached;
    }
    const { extension } = this;
    const url = (icon, theme) =>
      IconDetails.escapeUrl(typeof icon === "object" ? icon[theme] : icon);
    const image = (icon1x, icon2x, theme) => {
      const image1x = `url("${url(icon1x, theme)}")`;
      const image2x = `url("${url(icon2x, theme)}")`;
      return image1x == image2x
        ? image1x
        : `image-set(${image1x} 1dppx, ${image2x} 2dppx)`;
    };
    const icon16 = IconDetails.getPreferredIcon(icons, extension, 16).icon;
    const icon32 = IconDetails.getPreferredIcon(icons, extension, 32).icon;
    const style = `--extension-icon: ${image(icon16, icon32, "light")}; --extension-icon-dark: ${image(icon16, icon32, "dark")};`;
    this.iconStyles.set(icons, style);
    return style;
  }

  PERSISTENT_EVENTS = {
    onClicked({ context, fire }) {
      const { extension } = this;
      const { tabManager } = extension;
      const listener = async (_event, tab, clickInfo) => {
        if (fire.wakeup) {
          await fire.wakeup();
        }
        context?.withPendingBrowser(tab.linkedBrowser, () =>
          fire.sync(tabManager.convert(tab), clickInfo)
        );
      };
      this.on("click", listener);
      return {
        unregister: () => {
          this.off("click", listener);
        },
        convert(newFire, extContext) {
          fire = newFire;
          context = extContext;
        },
      };
    },
  };

  getAPI(context) {
    const { extension } = context;
    const { action } = this;
    const namespace =
      extension.manifestVersion < 3 ? "browserAction" : "action";

    return {
      [namespace]: {
        ...action.api(context),

        onClicked: new EventManager({
          context,
          // The module is "browserAction" in ext-swell.json, whatever the
          // manifest version is.
          module: "browserAction",
          event: "onClicked",
          inputHandling: true,
          extensionApi: this,
        }).api(),

        // Every button is on the toolbar of its space.
        onUserSettingsChanged: new EventManager({
          context,
          name: `${namespace}.onUserSettingsChanged`,
          register: () => () => {},
        }).api(),

        getUserSettings: () => ({ isOnToolbar: true }),

        openPopup: async () => {
          const isHandlingUserInput =
            context.callContextData?.isHandlingUserInput;
          if (
            !Services.prefs.getBoolPref(
              "extensions.openPopupWithoutUserGesture.enabled",
              false
            ) &&
            !isHandlingUserInput
          ) {
            throw new ExtensionError("openPopup requires a user gesture");
          }
          const tab = tabTracker.activeTab;
          if (!tab || !extension.canAccessContainer?.(tab.userContextId)) {
            throw new ExtensionError("There is no tab to show the popup for");
          }
          const popupUrl = action.getPopupUrl(tab, true);
          await SwellExtensionUI.openPopup(extension.id, popupUrl);
        },
      },
    };
  }
};

global.browserActionFor = this.browserAction.for;

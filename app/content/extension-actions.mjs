/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { ExtensionParent } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionParent.sys.mjs"
);
const { SwellExtensionUI } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellExtensionUI.sys.mjs"
);

const POPUP_MAX_WIDTH = 800;
const POPUP_MAX_HEIGHT = 600;
const POPUP_BACKGROUND = "#fff";

/**
 * The buttons that add-ons of the active space put in the sidebar
 * (browserAction), and the popup that one of them may open. A button only
 * shows for the add-ons that may see the space's container, so what a space
 * has installed is all its sidebar shows.
 */
export class ExtensionActionsUI {
  #app;
  #row;
  #host;
  #popup = null;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#row = doc.getElementById("extension-actions");
    this.#host = doc.getElementById("extension-popup");
    SwellExtensionUI.onActionsChanged(() => app.scheduleRender());
    SwellExtensionUI.popupHost = {
      open: (extensionId, popupUrl) =>
        this.#open(extensionId, popupUrl, this.#row),
    };
    const win = doc.defaultView;
    win.addEventListener("mousedown", event => {
      if (this.#popup && !this.#host.contains(event.target)) {
        this.close();
      }
    });
    win.addEventListener("keydown", event => {
      if (event.key == "Escape") {
        this.close();
      }
    });
  }

  get #userContextId() {
    return this.#app.space?.userContextId ?? 0;
  }

  get #tab() {
    const tab = this.#app.bridge.selectedTab;
    return tab?.userContextId == this.#userContextId ? tab : null;
  }

  render() {
    const doc = this.#app.document;
    const tab = this.#tab;
    const buttons = [];
    for (const delegate of SwellExtensionUI.actions.values()) {
      const { extension } = delegate;
      if (!extension.canAccessContainer?.(this.#userContextId)) {
        continue;
      }
      const state = delegate.describe(tab);
      const button = doc.createElement("button");
      button.className = "extension-action";
      button.title = state.title;
      button.setAttribute("aria-label", state.title);
      button.disabled = !state.enabled || !tab;
      button.setAttribute("style", state.iconStyle);
      if (state.badgeText) {
        const badge = doc.createElement("span");
        badge.className = "badge";
        badge.textContent = state.badgeText;
        badge.setAttribute("style", state.badgeStyle);
        button.append(badge);
      }
      button.addEventListener("click", () => this.#activate(delegate, button));
      buttons.push(button);
    }
    this.#row.replaceChildren(...buttons);
    this.#row.hidden = !buttons.length;
    if (
      this.#popup &&
      !this.#popup.extension.canAccessContainer?.(this.#userContextId)
    ) {
      this.close();
    }
  }

  #activate(delegate, button) {
    const tab = this.#tab;
    if (!tab) {
      return;
    }
    if (this.#popup?.extension === delegate.extension) {
      this.close();
      return;
    }
    const popupUrl = delegate.activate(tab);
    if (popupUrl) {
      this.#open(delegate.extension.id, popupUrl, button).catch(e =>
        console.error("Swell: the popup of an add-on did not open", e)
      );
    }
  }

  async #open(extensionId, popupUrl, anchor) {
    const delegate = SwellExtensionUI.actions.get(extensionId);
    if (!delegate) {
      return;
    }
    this.close();
    const { extension } = delegate;
    const doc = this.#app.document;
    const browser = doc.createXULElement("browser");
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("messagemanagergroup", "webext-browsers");
    browser.setAttribute("class", "webextension-popup-browser");
    browser.setAttribute("webextension-view-type", "popup");
    browser.setAttribute("constrainpopups", "false");
    // The popup is a page of a copy that belongs to one container.
    browser.setAttribute("usercontextid", String(this.#userContextId));
    browser.setAttribute(
      "initialBrowsingContextGroupId",
      extension.policy.browsingContextGroupId
    );
    if (extension.remote) {
      browser.setAttribute("remote", "true");
      browser.setAttribute("remoteType", extension.remoteType);
      browser.setAttribute("maychangeremoteness", "true");
    }
    const popup = { extension, browser, destroyed: false };
    this.#popup = popup;
    popup.receiveMessage = ({ name: message, data }) => {
      if (message == "Extension:BrowserResized") {
        this.#resize(popup, data);
      } else if (message == "Extension:BrowserBackgroundChanged") {
        this.#host.style.setProperty(
          "--popup-background",
          data.background || POPUP_BACKGROUND
        );
      }
    };
    browser.addEventListener("DOMWindowClose", () => this.close());

    // A remote browser has no message manager before its frame loader exists.
    const ready = extension.remote
      ? new Promise(resolve =>
          browser.addEventListener("XULFrameLoaderCreated", resolve, {
            once: true,
          })
        )
      : null;
    this.#host.replaceChildren(browser);
    this.#host.hidden = false;
    this.#place(anchor);
    if (!extension.remote) {
      browser.contentWindow; // eslint-disable-line no-unused-expressions
    }
    await ready;
    if (popup.destroyed) {
      return;
    }

    const init = () => {
      const mm = browser.messageManager;
      mm.addMessageListener("Extension:BrowserResized", popup);
      mm.addMessageListener("Extension:BrowserBackgroundChanged", popup);
      ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
      mm.loadFrameScript(
        "chrome://extensions/content/ext-browser-content.js",
        false,
        true
      );
      mm.sendAsyncMessage("Extension:InitBrowser", {
        allowScriptsToClose: true,
        blockParser: false,
        fixedWidth: false,
        maxWidth: POPUP_MAX_WIDTH,
        maxHeight: POPUP_MAX_HEIGHT,
        stylesheets: [],
      });
    };
    browser.addEventListener("DidChangeBrowserRemoteness", init);
    init();
    browser.fixupAndLoadURIString(popupUrl, {
      triggeringPrincipal: extension.principal,
    });
  }

  #place(anchor) {
    const rect = anchor.getBoundingClientRect();
    this.#host.style.top = `${rect.bottom + 4}px`;
    this.#host.style.left = `${rect.left}px`;
  }

  #resize(popup, { width, height }) {
    if (popup.destroyed) {
      return;
    }
    const { style } = popup.browser;
    style.width = `${Math.min(width, POPUP_MAX_WIDTH)}px`;
    style.height = `${Math.min(height, POPUP_MAX_HEIGHT)}px`;
  }

  close() {
    const popup = this.#popup;
    if (!popup) {
      return;
    }
    this.#popup = null;
    popup.destroyed = true;
    const mm = popup.browser.messageManager;
    mm?.removeMessageListener("Extension:BrowserResized", popup);
    mm?.removeMessageListener("Extension:BrowserBackgroundChanged", popup);
    this.#host.hidden = true;
    this.#host.replaceChildren();
    this.#host.style.removeProperty("--popup-background");
  }

  get isPopupOpen() {
    return !!this.#popup;
  }
}

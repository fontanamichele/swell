/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { SubDialogManager } = ChromeUtils.importESModule(
  "resource://gre/modules/SubDialog.sys.mjs"
);

/**
 * The dialogs a page opens (alert, confirm, prompt, leave-the-page, HTTP
 * authentication) shown over that tab's page, as Firefox's TabDialogBox does.
 * PromptParent finds this through `window.gBrowser.getTabDialogBox`.
 */
class DialogBox {
  #doc;
  #pages;
  #browser;
  #tab;
  #tabManager;
  #contentManager = null;
  #lastPrincipal = null;

  constructor({ doc, pages, browser, tab }) {
    this.#doc = doc;
    this.#pages = pages;
    this.#browser = browser;
    this.#tab = tab;
    this.#tabManager = this.#makeManager("tab-prompt-dialog");
    tab.addEventListener("TabClose", () => this.abortAllDialogs());
  }

  get browser() {
    return this.#browser;
  }

  #makeManager(className) {
    const doc = this.#doc;
    const stack = doc.createXULElement("stack");
    stack.className = `dialogStack ${className}`;
    stack.hidden = true;
    stack.dataset.liveTab = this.#tab.liveTab;
    const template = doc.createXULElement("vbox");
    template.className = "dialogTemplate dialogOverlay";
    template.setAttribute("topmost", "true");
    template.hidden = true;
    const box = doc.createXULElement("hbox");
    box.className = "dialogBox";
    const frame = doc.createXULElement("browser");
    frame.className = "dialogFrame";
    frame.setAttribute("autoscroll", "false");
    frame.setAttribute("disablehistory", "true");
    box.appendChild(frame);
    template.appendChild(box);
    stack.appendChild(template);
    this.#pages.appendChild(stack);
    const manager = new SubDialogManager({
      dialogStack: stack,
      dialogTemplate: template,
      orderType: SubDialogManager.ORDER_QUEUE,
      allowDuplicateDialogs: true,
      dialogOptions: { consumeOutsideClicks: false },
    });
    manager.stack = stack;
    return manager;
  }

  #contentDialogManager() {
    this.#contentManager ??= this.#makeManager("content-prompt-dialog");
    return this.#contentManager;
  }

  #hasDialogs() {
    return (
      this.#tabManager.hasDialogs || Boolean(this.#contentManager?.hasDialogs)
    );
  }

  // Returns {closedPromise, dialog}, as TabDialogBox.open does.
  open(
    url,
    {
      features = null,
      allowDuplicateDialogs = true,
      sizeTo,
      keepOpenSameOriginNav,
      modalType = null,
      hideContent = false,
      webProgress = undefined,
    } = {},
    ...params
  ) {
    let resolveClosed;
    const closedPromise = new Promise(resolve => (resolveClosed = resolve));
    const isContent = modalType == Ci.nsIPrompt.MODAL_TYPE_CONTENT;
    const manager = isContent ? this.#contentDialogManager() : this.#tabManager;
    const progress = webProgress ?? this.#browser.webProgress;

    if (!this.#hasDialogs()) {
      this.#lastPrincipal = this.#browser.contentPrincipal;
      progress.addProgressListener(this, Ci.nsIWebProgress.NOTIFY_LOCATION);
    }
    const closingCallback = () => {
      if (!this.#hasDialogs()) {
        progress.removeProgressListener(this);
        this.#lastPrincipal = null;
      }
    };
    const dialog = manager.open(
      url,
      {
        features,
        allowDuplicateDialogs,
        sizeTo: isContent ? "limitheight" : sizeTo,
        closingCallback,
        closedCallback: resolveClosed,
        hideContent,
      },
      ...params
    );
    if (dialog) {
      dialog._keepOpenSameOriginNav = keepOpenSameOriginNav;
    }
    return { closedPromise, dialog };
  }

  abortAllDialogs() {
    this.#tabManager.abortDialogs();
    this.#contentManager?.abortDialogs();
  }

  focus() {
    if (this.#tabManager._dialogs.length) {
      this.#tabManager.focusTopDialog();
      return;
    }
    this.#contentManager?.focusTopDialog();
  }

  // A dialog does not survive its page being left; the same origin may keep it.
  onLocationChange(webProgress, request, uri, flags) {
    if (
      !webProgress.isTopLevel ||
      flags & Ci.nsIWebProgressListener.LOCATION_CHANGE_SAME_DOCUMENT
    ) {
      return;
    }
    let filter;
    if (
      this.#lastPrincipal?.isSameOrigin(
        uri,
        this.#browser.browsingContext.usePrivateBrowsing
      )
    ) {
      filter = dialog => !dialog._keepOpenSameOriginNav;
    }
    this.#lastPrincipal = this.#browser.contentPrincipal;
    this.#tabManager.abortDialogs(filter);
    this.#contentManager?.abortDialogs(filter);
  }

  getTabDialogManager() {
    return this.#tabManager;
  }

  getContentDialogManager() {
    return this.#contentDialogManager();
  }

  // Firefox asks for a tab-switch permission checkbox; Swell has none.
  onNextPromptShowAllowFocusCheckboxFor() {}
}

DialogBox.prototype.QueryInterface = ChromeUtils.generateQI([
  "nsIWebProgressListener",
  "nsISupportsWeakReference",
]);

/**
 * Gives the window the part of `gBrowser` that the toolkit's and Firefox's
 * prompt code reaches for, and shows each tab's dialogs only while it is in front.
 */
export class Dialogs {
  #doc;
  #pages;
  #bridge;
  #boxes = new WeakMap();

  constructor({ win, bridge, pages }) {
    this.#doc = win.document;
    this.#pages = pages;
    this.#bridge = bridge;
    win.gBrowser = {
      getTabDialogBox: browser => this.boxFor(browser),
      getTabForBrowser: browser => this.#bridge.tabForBrowser(browser),
      get selectedBrowser() {
        return bridge.selectedTab?.browser;
      },
      setTabLabelForAuthPrompts() {},
      // The test harness keeps a tabbrowser's tabs tidy when this exists.
      tabs: [],
      addTab() {},
      removeTab() {},
      stop() {},
    };
    bridge.on("selected", () => this.#showSelected());
    bridge.on("tabclosed", ({ liveTab }) => {
      for (const stack of this.#pages.querySelectorAll(".dialogStack")) {
        if (stack.dataset.liveTab == liveTab) {
          stack.remove();
        }
      }
    });
  }

  boxFor(browser) {
    let box = this.#boxes.get(browser);
    if (!box) {
      const tab = this.#bridge.tabForBrowser(browser);
      box = new DialogBox({
        doc: this.#doc,
        pages: this.#pages,
        browser,
        tab,
      });
      this.#boxes.set(browser, box);
    }
    this.#showSelected();
    return box;
  }

  #showSelected() {
    const selected = this.#bridge.selectedTab?.liveTab;
    for (const stack of this.#pages.querySelectorAll(".dialogStack")) {
      stack.toggleAttribute("inactive", stack.dataset.liveTab != selected);
    }
  }
}

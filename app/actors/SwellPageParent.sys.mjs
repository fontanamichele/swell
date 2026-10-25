/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * The window's side of SwellPage: hands what the page reports to the app.
 */
export class SwellPageParent extends JSWindowActorParent {
  #app() {
    const browser = this.browsingContext.top.embedderElement;
    const window = browser?.documentGlobal;
    return window?.SwellApp ? { browser, ready: window.SwellApp.ready } : null;
  }

  async receiveMessage({ name, data }) {
    const target = this.#app();
    if (!target) {
      return;
    }
    const { app } = await target.ready;
    if (name == "Swell:ContextMenu") {
      app.showPageMenu({ browser: target.browser, actor: this, ...data });
    } else if (name == "Swell:Navigate") {
      if (app.bridge.selectedTab?.browser === target.browser) {
        app.run(() =>
          data.direction < 0 ? app.bridge.goBack() : app.bridge.goForward()
        );
      }
    } else if (name == "Swell:OpenLink") {
      app.openLinkFrom(target.browser, data.url, data);
    }
  }
}

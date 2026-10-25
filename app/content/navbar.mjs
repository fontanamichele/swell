/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const IS_MAC = Services.appinfo.OS == "Darwin";

// What the address pill shows: the host, without "www.", or the whole address
// for pages that have none (about:, file:, data:).
function shortAddress(url) {
  if (!url) {
    return "";
  }
  try {
    const { host } = new URL(url);
    return host ? host.replace(/^www\./, "") : url;
  } catch (e) {
    return url;
  }
}

/**
 * Back, forward and reload (stop while loading) for the page in front, and a
 * pill with its address: clicking it opens the command bar on that address,
 * the copy button puts the address on the clipboard.
 */
export class NavBar {
  #app;
  #back;
  #forward;
  #reload;
  #address;
  #copy;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#back = doc.getElementById("nav-back");
    this.#forward = doc.getElementById("nav-forward");
    this.#reload = doc.getElementById("nav-reload");
    this.#address = doc.getElementById("nav-address");
    this.#copy = doc.getElementById("nav-copy");
    const accel = IS_MAC ? "⌘" : "Ctrl+";
    this.#back.title = `Back (${accel}[)`;
    this.#forward.title = `Forward (${accel}])`;
    this.#back.addEventListener("click", () => app.bridge.goBack());
    this.#forward.addEventListener("click", () => app.bridge.goForward());
    this.#reload.addEventListener("click", () => {
      if (app.selectedTab?.loading) {
        app.bridge.stop();
      } else {
        app.bridge.reload();
      }
    });
    this.#address.addEventListener("click", () =>
      app.commandBar.open({ mode: "current" })
    );
    this.#copy.addEventListener("click", () => {
      const url = app.selectedTab?.url;
      if (url) {
        Cc["@mozilla.org/widget/clipboardhelper;1"]
          .getService(Ci.nsIClipboardHelper)
          .copyString(url);
        app.toasts.show({ text: "Address copied" });
      }
    });
  }

  render() {
    const tab = this.#app.selectedTab;
    this.#back.disabled = !tab?.canGoBack;
    this.#forward.disabled = !tab?.canGoForward;
    this.#reload.disabled = !tab;
    const loading = !!tab?.loading;
    this.#reload.classList.toggle("loading", loading);
    this.#reload.title = loading
      ? "Stop"
      : `Reload (${IS_MAC ? "⌘R" : "Ctrl+R"})`;
    this.#reload.setAttribute("aria-label", loading ? "Stop" : "Reload");
    const text = shortAddress(tab?.url);
    this.#address.textContent = text || "Search or enter address";
    this.#address.classList.toggle("empty", !text);
    this.#address.title = tab?.url ?? "";
    this.#address.disabled = !this.#app.space;
    this.#copy.disabled = !tab?.url;
  }
}

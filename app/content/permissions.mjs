/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** What a request type is called in the permission database, and in the prompt. */
const KNOWN = new Map([
  ["geolocation", { key: "geo", what: "know your location" }],
  [
    "desktop-notification",
    { key: "desktop-notification", what: "show notifications" },
  ],
  [
    "persistent-storage",
    { key: "persistent-storage", what: "store data on this device" },
  ],
  ["midi", { key: "midi", what: "use your MIDI devices" }],
  ["xr", { key: "xr", what: "use virtual reality devices" }],
]);

const ALLOW = Ci.nsIPermissionManager.ALLOW_ACTION;
const DENY = Ci.nsIPermissionManager.DENY_ACTION;

/**
 * Asks the user about permission requests from the page in front, one bar
 * at a time. Choices are remembered by the permission manager, which keeps
 * them per container because `permissions.isolateBy.userContext` is on.
 */
export class PermissionBar {
  #app;
  #bar;
  #pending = [];

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#bar = doc.getElementById("permission-bar");
    doc
      .getElementById("permission-allow")
      .addEventListener("click", () => this.#decide(ALLOW));
    doc
      .getElementById("permission-block")
      .addEventListener("click", () => this.#decide(DENY));
    doc
      .getElementById("permission-later")
      .addEventListener("click", () => this.#decide(null));
    app.bridge.on("selected", () => this.render());
    app.bridge.on("tabclosed", ({ liveTab }) =>
      this.#drop(entry => entry.tab.liveTab === liveTab)
    );
    app.bridge.on("tabstate", tab => {
      this.#drop(
        entry =>
          entry.tab.liveTab === tab.liveTab &&
          entry.origin != this.#originOf(tab.url)
      );
    });
  }

  #originOf(url) {
    try {
      return new URL(url).origin;
    } catch (e) {
      return "";
    }
  }

  /** @param {nsIContentPermissionRequest} request */
  ask(request) {
    const tab = this.#app.bridge.tabForBrowser(request.element);
    let type;
    try {
      const types = request.types.QueryInterface(Ci.nsIArray);
      type =
        types.length == 1
          ? types.queryElementAt(0, Ci.nsIContentPermissionType).type
          : null;
    } catch (e) {
      type = null;
    }
    const known = KNOWN.get(type);
    if (!tab || !known || !request.principal.URI?.schemeIs("https")) {
      request.cancel();
      return;
    }
    const stored = Services.perms.testExactPermissionFromPrincipal(
      request.principal,
      known.key
    );
    if (stored == ALLOW) {
      request.allow({});
      return;
    }
    if (stored == DENY) {
      request.cancel();
      return;
    }
    this.#pending.push({
      request,
      tab,
      key: known.key,
      what: known.what,
      origin: request.principal.originNoSuffix,
    });
    this.render();
  }

  get #current() {
    const selected = this.#app.bridge.selectedTab;
    return this.#pending.find(entry => entry.tab === selected) ?? null;
  }

  render() {
    const entry = this.#current;
    this.#bar.hidden = !entry;
    if (entry) {
      const host = entry.request.principal.URI.host;
      this.#bar.querySelector(".permission-text").textContent =
        `${host} wants to ${entry.what}`;
    }
  }

  /** @param {number|null} action ALLOW, DENY, or null to dismiss without remembering. */
  #decide(action) {
    const entry = this.#current;
    if (!entry) {
      return;
    }
    this.#pending.splice(this.#pending.indexOf(entry), 1);
    const { request, key } = entry;
    if (action === ALLOW) {
      Services.perms.addFromPrincipal(
        request.principal,
        key,
        ALLOW,
        Ci.nsIPermissionManager.EXPIRE_NEVER
      );
      request.allow({});
    } else {
      if (action === DENY) {
        Services.perms.addFromPrincipal(
          request.principal,
          key,
          DENY,
          Ci.nsIPermissionManager.EXPIRE_NEVER
        );
      }
      request.cancel();
    }
    this.render();
  }

  #drop(matches) {
    const gone = this.#pending.filter(matches);
    if (!gone.length) {
      return;
    }
    this.#pending = this.#pending.filter(entry => !gone.includes(entry));
    for (const entry of gone) {
      entry.request.cancel();
    }
    this.render();
  }
}

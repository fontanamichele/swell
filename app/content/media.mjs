/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { MediaPromptHandler } = ChromeUtils.importESModule(
  "moz-src:///swell/app/actors/SwellMediaParent.sys.mjs"
);

const NO_CAPTURE = 0;

function kindName(kind) {
  if (kind == "Screen") {
    return "screen";
  }
  return kind == "AudioCapture" ? "computer audio" : kind.toLowerCase();
}

function hostOf(site) {
  try {
    return new URL(site).host;
  } catch (e) {
    return site;
  }
}

function fill(select, devices, label) {
  select.replaceChildren(
    ...devices.map(device => {
      const option = select.ownerDocument.createElement("option");
      option.value = device.deviceIndex;
      option.textContent = device.name;
      return option;
    })
  );
  select.title = label;
  select.hidden = !devices.length;
}

/**
 * Asks whether a page may use the camera, the microphone or the screen, one
 * request at a time and only for the page in front, and says what a page is
 * sharing. A saved answer never reaches this far: SwellMediaParent keeps it
 * as a permission of the page's origin in the page's container.
 */
export class MediaUI {
  #app;
  #bar;
  #indicator;
  #pending = new Map(); // browser -> {site, request, resolve}
  #sharing = new Map(); // browser -> {state, actor}
  #shown = null;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#bar = doc.getElementById("media-bar");
    this.#indicator = doc.getElementById("media-indicator");
    doc
      .getElementById("media-allow")
      .addEventListener("click", () => this.#answer(true));
    doc
      .getElementById("media-block")
      .addEventListener("click", () => this.#answer(false));
    doc
      .getElementById("media-later")
      .addEventListener("click", () => this.#answer(null));
    doc.getElementById("media-stop").addEventListener("click", () => {
      const entry = this.#sharing.get(this.#selectedBrowser);
      entry?.actor.stopSharing(entry.state.windowId);
    });
    app.bridge.on("selected", () => this.#render());
    app.bridge.on("tabclosed", () => this.#render());
    MediaPromptHandler.set({
      ask: request => this.#ask(request),
      update: (browser, state, actor) => this.#update(browser, state, actor),
      cancel: (browser, callID) => this.#cancel(browser, callID),
    });
  }

  get #selectedBrowser() {
    return this.#app.bridge.selectedTab?.browser ?? null;
  }

  #ask({ browser, origin: site, request }) {
    return new Promise(resolve => {
      this.#pending.get(browser)?.resolve(null);
      this.#pending.set(browser, { site, request, resolve });
      this.#render();
    });
  }

  #cancel(browser, callID) {
    const entry = this.#pending.get(browser);
    if (entry?.request.callID == callID) {
      this.#pending.delete(browser);
      entry.resolve(null);
      this.#render();
    }
  }

  #update(browser, state, actor) {
    const tab = this.#app.bridge.tabForBrowser(browser);
    if (!tab) {
      return;
    }
    if (state.remove) {
      this.#sharing.delete(browser);
      this.#app.bridge.setSharing(tab, null);
    } else {
      this.#sharing.set(browser, { state, actor });
      this.#app.bridge.setSharing(tab, {
        camera: state.camera != NO_CAPTURE,
        microphone: state.microphone != NO_CAPTURE,
        screen:
          state.screen != NO_CAPTURE ||
          state.window != NO_CAPTURE ||
          state.browser != NO_CAPTURE,
      });
    }
    this.#render();
  }

  #render() {
    const doc = this.#app.document;
    const browser = this.#selectedBrowser;

    const sharing = this.#sharing.get(browser);
    this.#indicator.hidden = !sharing;
    if (sharing) {
      const what = [
        sharing.state.camera != NO_CAPTURE && "camera",
        sharing.state.microphone != NO_CAPTURE && "microphone",
        (sharing.state.screen != NO_CAPTURE ||
          sharing.state.window != NO_CAPTURE ||
          sharing.state.browser != NO_CAPTURE) &&
          "screen",
      ].filter(Boolean);
      doc.querySelector("#media-indicator .media-indicator-text").textContent =
        `This page is sharing your ${what.join(" and ")}`;
    }

    const entry = browser && this.#pending.get(browser);
    this.#shown = entry ?? null;
    this.#bar.hidden = !entry;
    if (!entry) {
      return;
    }
    const { site, request } = entry;
    const kinds = request.requestTypes.map(kindName);
    doc.querySelector("#media-bar .media-text").textContent =
      `${hostOf(site)} wants to use your ${kinds.join(" and ")}`;
    fill(
      doc.getElementById("media-camera"),
      request.sharingScreen ? [] : request.videoInputDevices,
      "Camera"
    );
    fill(
      doc.getElementById("media-screen"),
      request.sharingScreen ? request.videoInputDevices : [],
      "Screen to share"
    );
    fill(
      doc.getElementById("media-microphone"),
      request.audioInputDevices,
      "Microphone"
    );
    // Only a camera or a microphone is worth remembering, never a screen.
    doc.getElementById("media-remember-label").hidden =
      request.sharingScreen || request.sharingAudio;
    doc.getElementById("media-remember").checked = false;
  }

  #answer(allow) {
    const entry = this.#shown;
    if (!entry) {
      return;
    }
    const doc = this.#app.document;
    const browser = [...this.#pending].find(
      ([, value]) => value === entry
    )?.[0];
    this.#pending.delete(browser);
    this.#shown = null;
    this.#bar.hidden = true;
    if (allow === null) {
      entry.resolve(null);
      return;
    }
    const devices = [];
    for (const id of ["media-camera", "media-screen", "media-microphone"]) {
      const select = doc.getElementById(id);
      if (!select.hidden && select.value !== "") {
        devices.push(Number(select.value));
      }
    }
    entry.resolve({
      allow,
      devices,
      remember: doc.getElementById("media-remember").checked,
    });
    this.#render();
  }
}

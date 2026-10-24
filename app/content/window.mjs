/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { App } from "chrome://swell/content/app.mjs";

// macOS: draw in the titlebar, so the window controls sit over our sidebar.
// Elsewhere the native titlebar stays until the window controls are drawn here.
if (Services.appinfo.OS == "Darwin") {
  document.documentElement.setAttribute("customtitlebar", "true");
}

// Registers the toolkit's content actors (find, select popups, autocomplete,
// popup blocking, media controls); nothing else in this application does.
ChromeUtils.importESModule("resource://gre/modules/ActorManagerParent.sys.mjs");

// Address and credit card autofill, with its own prompt (see AutofillPrompter).
const { startAutofill } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/Autofill.sys.mjs"
);
startAutofill();

// Loaded into the shared system global, not this window's module map: the
// UniFFI bindings only work there.
const { Core, Icon } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/Core.sys.mjs"
);
const { EngineBridge } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/EngineBridge.sys.mjs"
);
const { TreeState } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/TreeState.sys.mjs"
);
const { Downloads } = ChromeUtils.importESModule(
  "resource://gre/modules/Downloads.sys.mjs"
);

ChromeUtils.registerWindowActor("SwellPage", {
  parent: {
    esModuleURI: "moz-src:///swell/app/actors/SwellPageParent.sys.mjs",
  },
  child: {
    esModuleURI: "moz-src:///swell/app/actors/SwellPageChild.sys.mjs",
    events: {
      contextmenu: { mozSystemGroup: true },
      click: { mozSystemGroup: true, capture: true },
    },
  },
  allFrames: false,
  messageManagerGroups: ["browsers"],
  safeForUntrustedWebProcess: true,
});

// Camera, microphone and screen sharing: Firefox's own child actor under the
// name it looks itself up by, and ours for the parent side.
ChromeUtils.registerWindowActor("WebRTC", {
  parent: {
    esModuleURI: "moz-src:///swell/app/actors/SwellMediaParent.sys.mjs",
  },
  child: {
    esModuleURI: "moz-src:///browser/actors/WebRTCChild.sys.mjs",
  },
  allFrames: true,
  messageManagerGroups: ["browsers"],
  safeForUntrustedWebProcess: true,
});

ChromeUtils.registerProcessActor("SwellProcess", {
  child: {
    esModuleURI: "moz-src:///swell/app/actors/SwellProcessChild.sys.mjs",
    observers: [
      "getUserMedia:request",
      "recording-device-stopped",
      "PeerConnection:request",
      "recording-device-events",
      "recording-window-ended",
    ],
  },
  safeForUntrustedWebProcess: true,
});

ChromeUtils.registerWindowActor("SwellLink", {
  parent: {
    esModuleURI: "moz-src:///swell/app/actors/SwellLinkParent.sys.mjs",
  },
  child: {
    esModuleURI: "moz-src:///swell/app/actors/SwellLinkChild.sys.mjs",
    events: {
      DOMHeadElementParsed: {},
      DOMLinkAdded: {},
      DOMLinkChanged: {},
      pageshow: {},
      pagehide: { createActor: false },
    },
  },
  allFrames: false,
  messageManagerGroups: ["browsers"],
  safeForUntrustedWebProcess: true,
});

async function start() {
  const core = Core.get();
  const bridge = new EngineBridge({
    window,
    core,
    pages: document.getElementById("pages"),
  });
  await bridge.init(await core.lastActiveSpace());
  const app = new App({
    doc: document,
    core,
    bridge,
    state: new TreeState(),
    Icon,
    Downloads,
  });
  await app.init();
  const commandLine = window.arguments?.[0];
  if (commandLine instanceof Ci.nsICommandLine) {
    const path = commandLine.handleFlagWithParam("import-arc", false);
    if (path) {
      await app.importArcFile(path);
    }
  }
  return { core, bridge, app };
}

// The script preloader, Marionette and the test harness expect these two
// notifications, in this order, once the main window is ready.
window.SwellApp = { ready: start() };
window.SwellApp.ready
  .catch(e => console.error("Swell failed to start", e))
  .finally(() => {
    Services.obs.notifyObservers(window, "browser-delayed-startup-finished");
    window.requestIdleCallback(() => {
      Services.obs.notifyObservers(
        window,
        "browser-idle-startup-tasks-finished"
      );
    });
  });

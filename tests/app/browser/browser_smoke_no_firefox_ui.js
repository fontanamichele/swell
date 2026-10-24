/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async function test_swell_window_is_the_only_window() {
  const root = document.documentElement;
  is(
    root.getAttribute("windowtype"),
    "navigator:browser",
    "this is the application's main window"
  );
  is(
    document.documentURI,
    "chrome://swell/content/window.xhtml",
    "the window document is Swell's"
  );
  is(Services.appinfo.name, "Swell", "application name");
});

add_task(async function test_no_firefox_ui_exists() {
  for (const id of [
    "TabsToolbar",
    "nav-bar",
    "navigator-toolbox",
    "PersonalToolbar",
  ]) {
    ok(!document.getElementById(id), `no #${id}`);
  }
  ok(!window.gBrowser, "no gBrowser");
  ok(!window.gBrowserInit, "no gBrowserInit");
  for (const url of [
    "chrome://browser/content/browser.xhtml",
    "chrome://browser/content/browser.js",
  ]) {
    let resolved = true;
    try {
      Services.io
        .newChannel(
          url,
          null,
          null,
          null,
          Services.scriptSecurityManager.getSystemPrincipal(),
          null,
          Ci.nsILoadInfo.SEC_ALLOW_CROSS_ORIGIN_SEC_CONTEXT_IS_NULL,
          Ci.nsIContentPolicy.TYPE_OTHER
        )
        .open();
    } catch (e) {
      resolved = false;
    }
    ok(!resolved, `${url} does not exist`);
  }
});

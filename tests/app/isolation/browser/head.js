/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Helpers of the Swell window tests (swellApp, openInSpace, freshSpace, ...).
Services.scriptloader.loadSubScript(
  "chrome://mochitests/content/browser/swell/tests/app/browser/head.js",
  this
);

const PAGE = `${BASE}file_blank.html`;

// tools/isolation.sh runs the whole suite a second time with this pref set.
// Both "spaces" then use one container, so every case must report its store
// as shared. A case that still passes in that run does not test anything.
const SHARE_CONTAINER = Services.prefs.getBoolPref(
  "swell.test.shareContainer",
  false
);

// Records one row of the audit and fails if the store is shared.
function audit(store, isolated, detail = "") {
  info(`AUDIT|${store}|${isolated ? "isolated" : "shared"}|${detail}`);
  ok(isolated, `${store} is isolated between spaces. ${detail}`);
}

/**
 * Two fresh spaces, each with the page open in its own container. With
 * swell.test.shareContainer the second tab is opened in the first space.
 */
async function pair() {
  const { bridge, app } = await swellApp();
  const a = await freshSpace(app, "Isolation A");
  const tabA = await openInSpace(bridge, a.id, PAGE);
  const b = await freshSpace(app, "Isolation B");
  if (SHARE_CONTAINER) {
    const tabB = await openInSpace(bridge, a.id, PAGE);
    return { a, b: a, tabA, tabB, bridge };
  }
  const tabB = await openInSpace(bridge, b.id, PAGE);
  Assert.notEqual(a.userContextId, b.userContextId);
  return { a, b, tabA, tabB, bridge };
}

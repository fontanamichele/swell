/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const CONTAINER_A = 1;
const CONTAINER_B = 2;
const BASE = "https://example.com/browser/swell/tests/isolation/browser/";

add_setup(async function () {
  await SpecialPowers.pushPrefEnv({
    set: [["privacy.userContext.enabled", true]],
  });
});

async function openTabInUserContext(url, userContextId) {
  let tab = BrowserTestUtils.addTab(gBrowser, url, { userContextId });
  gBrowser.selectedTab = tab;
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

async function openPair(url) {
  return [
    await openTabInUserContext(url, CONTAINER_A),
    await openTabInUserContext(url, CONTAINER_B),
  ];
}

function closeTabs(...tabs) {
  for (let tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
}

// Records one row of the audit table and asserts the store is isolated, so a
// shared store shows up as a test failure.
function audit(store, isolated, detail = "") {
  info(`AUDIT|${store}|${isolated ? "isolated" : "shared"}|${detail}`);
  ok(isolated, `${store} is isolated between containers. ${detail}`);
}

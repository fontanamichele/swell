/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Zoom is remembered per site and per identity: zooming example.com in one
// space does not zoom it in another.

add_task(async function test_site_zoom() {
  const { a, tabA, tabB, bridge } = await pair();
  const { app } = await swellApp();
  await app.core.setSiteZoom(a.id, "example.com", 1.7);
  // Reload B: a page of the same site in the other space reads its own zoom.
  tabB.browser.reload();
  await TestUtils.waitForCondition(
    () => !tabB.loading,
    "space B's page reloads"
  );
  const bZoom = tabB.browser.browsingContext.fullZoom;
  const stored = await app.core.siteZoom(
    (await app.core.listSpaces()).find(
      s => s.userContextId == tabB.browser.contentPrincipal.userContextId
    ).id,
    "example.com"
  );
  audit(
    "site zoom",
    stored == 1 && bZoom == 1,
    `space B stores ${stored} and shows ${bZoom}`
  );
  await app.core.setSiteZoom(a.id, "example.com", 1);
  await closeAllTabs(bridge);
  Assert.ok(tabA);
});

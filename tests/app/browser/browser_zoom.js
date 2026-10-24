/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_blank.html`;

// The engine stores the zoom as a 32-bit float.
function zoomIs(context, expected, message) {
  Assert.less(Math.abs(context.fullZoom - expected), 1e-3, message);
}

add_task(async function test_zoom_keys_and_memory_per_space() {
  const { bridge, app } = await swellApp();
  const a = await freshSpace(app, "Zoom A");
  const tabA = await openInSpace(bridge, a.id, PAGE);
  const context = tabA.browser.browsingContext;
  zoomIs(context, 1, "starts at 100%");

  bridge.zoom(1);
  zoomIs(context, 1.1, "zoom in");
  bridge.zoom(1);
  zoomIs(context, 1.2, "zoom in again");
  bridge.zoom(-1);
  zoomIs(context, 1.1, "zoom out");
  await TestUtils.waitForCondition(
    async () => (await app.core.siteZoom(a.id, "example.com")) == 1.1,
    "the core remembers the zoom for example.com"
  );

  const b = await freshSpace(app, "Zoom B");
  const tabB = await openInSpace(bridge, b.id, PAGE);
  zoomIs(tabB.browser.browsingContext, 1, "another space does not inherit it");

  await app.switchSpace(a.id);
  await TestUtils.waitForCondition(
    () => bridge.selectedTab === tabA,
    "back in space A"
  );
  bridge.zoom(0);
  zoomIs(context, 1, "reset");
  await TestUtils.waitForCondition(
    async () => (await app.core.siteZoom(a.id, "example.com")) == 1,
    "the reset is remembered"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_saved_zoom_is_applied_when_a_site_loads() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Zoom load");
  await app.core.setSiteZoom(space.id, "example.com", 1.5);
  const tab = await openInSpace(bridge, space.id, PAGE);
  await TestUtils.waitForCondition(
    () => Math.abs(tab.browser.browsingContext.fullZoom - 1.5) < 1e-3,
    "the saved zoom is applied"
  );
  await app.core.setSiteZoom(space.id, "example.com", 1);
  await closeAllTabs(bridge);
});

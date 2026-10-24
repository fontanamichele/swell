/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// History is per space: Places tags each visit with its container and answers
// :visited only for the container that asks (patch 0200); the core keeps its
// own per-identity history for the command bar.

ChromeUtils.defineESModuleGetters(this, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PlacesTestUtils: "resource://testing-common/PlacesTestUtils.sys.mjs",
});

const VISITED_URL = `${BASE}file_blank.html?swellvisited`;

async function linkIsVisited(tab) {
  return SpecialPowers.spawn(tab.browser, [], async () => {
    const VISITED_STATE = 1 << 18; // ElementState::VISITED
    const link = content.document.getElementById("link");
    try {
      await ContentTaskUtils.waitForCondition(
        () => content.InspectorUtils.getContentState(link) & VISITED_STATE,
        "the link becomes visited",
        100,
        30
      );
      return true;
    } catch (e) {
      return false;
    }
  });
}

add_setup(async () => {
  await PlacesUtils.history.clear();
});

add_task(async function test_visited_links_and_places() {
  const { a, b, bridge } = await pair();
  const { app } = await swellApp();
  await openInSpace(bridge, a.id, VISITED_URL);
  await TestUtils.waitForCondition(
    () => PlacesTestUtils.isPageInDB(VISITED_URL),
    "the page is in Places"
  );
  const rows = await PlacesUtils.withConnectionWrapper("swell", db =>
    db.execute(
      `SELECT v.userContextId FROM moz_historyvisits v
       JOIN moz_places p ON p.id = v.place_id WHERE p.url = :url`,
      { url: VISITED_URL }
    )
  );
  Assert.equal(
    rows[0].getResultByName("userContextId"),
    a.userContextId,
    "the visit records the container it happened in"
  );

  const inA = await openInSpace(bridge, a.id, `${BASE}file_visited.html`);
  Assert.ok(await linkIsVisited(inA), "the link is visited in the space");
  const inB = await openInSpace(bridge, b.id, `${BASE}file_visited.html`);
  const seenInB = await linkIsVisited(inB);
  audit("visited links", !seenInB, `link coloured visited in B: ${seenInB}`);

  const found = await app.core.queryCommandBar(b.id, "swellvisited");
  const suggested = found.some(s => s.url == VISITED_URL);
  audit(
    "command bar history",
    !suggested,
    `space B is offered the page: ${suggested}`
  );
  await closeAllTabs(bridge);
  await app.core.clearHistory(a.id);
});

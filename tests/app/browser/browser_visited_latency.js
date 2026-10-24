/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// How long a link takes to turn :visited when Places already holds many
// visits (the question M0 left open). The numbers go to the log as
// LATENCY lines; the assertion is only a ceiling.

ChromeUtils.defineESModuleGetters(this, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PlacesTestUtils: "resource://testing-common/PlacesTestUtils.sys.mjs",
});

const TARGET = `${BASE}file_blank.html?swellvisited`;
const CEILING_MS = 5000;

async function fill(count, userContextId) {
  const visits = [];
  for (let i = 0; i < count; i++) {
    visits.push({
      url: `https://filler${i % 500}.test/page/${i}`,
      title: `filler ${i}`,
      visits: [{ date: new Date(Date.now() - i * 1000), userContextId }],
    });
  }
  for (let i = 0; i < visits.length; i += 5000) {
    await PlacesUtils.history.insertMany(visits.slice(i, i + 5000));
  }
}

async function secondsUntilVisited(bridge, space) {
  const tab = await openInSpace(bridge, space.id, `${BASE}file_visited.html`);
  const start = performance.now();
  await SpecialPowers.spawn(tab.browser, [], async () => {
    const VISITED_STATE = 1 << 18; // ElementState::VISITED
    const link = content.document.getElementById("link");
    await ContentTaskUtils.waitForCondition(
      () => content.InspectorUtils.getContentState(link) & VISITED_STATE,
      "the link becomes visited",
      20,
      500
    );
  });
  return performance.now() - start;
}

add_setup(async () => {
  await PlacesUtils.history.clear();
  registerCleanupFunction(() => PlacesUtils.history.clear());
});

for (const count of [1000, 100000]) {
  add_task(async function test_visited_latency() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, `Latency ${count}`);
    await PlacesUtils.history.clear();
    await fill(count, space.userContextId);
    await openInSpace(bridge, space.id, TARGET);
    await TestUtils.waitForCondition(
      () => PlacesTestUtils.isPageInDB(TARGET),
      "the target is in Places"
    );
    const ms = await secondsUntilVisited(bridge, space);
    info(`LATENCY|${count} visits in the container|${Math.round(ms)} ms`);
    Assert.less(ms, CEILING_MS, `visited within ${CEILING_MS} ms`);
    await closeAllTabs(bridge);
  });
}

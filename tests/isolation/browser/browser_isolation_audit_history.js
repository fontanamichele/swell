/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  PlacesTestUtils: "resource://testing-common/PlacesTestUtils.sys.mjs",
  UrlbarTestUtils: "resource://testing-common/UrlbarTestUtils.sys.mjs",
});

const VISITED_URL = BASE + "file_blank.html?swellvisited";

add_setup(async function () {
  UrlbarTestUtils.init(this);
  await PlacesUtils.history.clear();
});

async function visitInA() {
  let tab = await openTabInUserContext(VISITED_URL, CONTAINER_A);
  await TestUtils.waitForCondition(
    () => PlacesTestUtils.isPageInDB(VISITED_URL),
    "The page is in Places"
  );
  return tab;
}

add_task(async function test_places_history() {
  let tabA = await visitInA();
  let rows = await PlacesUtils.withConnectionWrapper("swell", db =>
    db.execute(
      `SELECT v.userContextId FROM moz_historyvisits v
       JOIN moz_places p ON p.id = v.place_id WHERE p.url = :url`,
      { url: VISITED_URL }
    )
  );
  is(
    rows[0].getResultByName("userContextId"),
    CONTAINER_A,
    "The visit records the container it happened in"
  );
  // Places has no per-container query API, so what container B can see is the
  // profile-wide page entry.
  let seenFromB = await PlacesUtils.history.hasVisits(VISITED_URL);
  audit("placesHistory", !seenFromB, `visit visible profile-wide: ${seenFromB}`);
  closeTabs(tabA);
});

add_task(async function test_visited_links() {
  let tabA = await visitInA();
  let tabB = await openTabInUserContext(BASE + "file_visited.html", CONTAINER_B);
  let visited = await SpecialPowers.spawn(tabB.linkedBrowser, [], async () => {
    // ElementState::VISITED
    const VISITED_STATE = 1 << 18;
    let link = content.document.getElementById("link");
    try {
      await ContentTaskUtils.waitForCondition(
        () => content.InspectorUtils.getContentState(link) & VISITED_STATE,
        "link becomes visited",
        100,
        30
      );
      return true;
    } catch (e) {
      return false;
    }
  });
  audit("visitedLinks", !visited, `link coloured visited in B: ${visited}`);
  closeTabs(tabA, tabB);
});

add_task(async function test_urlbar_suggestions() {
  let tabA = await visitInA();
  let tabB = await openTabInUserContext(BASE + "file_blank.html", CONTAINER_B);
  await UrlbarTestUtils.promiseAutocompleteResultPopup({
    window,
    value: "swellvisited",
  });
  let urls = [];
  for (let i = 0; i < UrlbarTestUtils.getResultCount(window); i++) {
    urls.push((await UrlbarTestUtils.getDetailsOfResultAt(window, i)).url);
  }
  let suggested = urls.includes(VISITED_URL);
  audit(
    "urlbarHistory",
    !suggested,
    `history URL suggested from container B: ${suggested}`
  );
  await UrlbarTestUtils.promisePopupClose(window);
  closeTabs(tabA, tabB);
});

/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const URL = "https://example.com/";

async function openTabInUserContext(userContextId) {
  let tab = BrowserTestUtils.addTab(gBrowser, URL, { userContextId });
  gBrowser.selectedTab = tab;
  await BrowserTestUtils.browserLoaded(tab.linkedBrowser);
  return tab;
}

add_task(async function test_two_containers_in_one_window() {
  let tabA = await openTabInUserContext(1);
  let tabB = await openTabInUserContext(2);

  Assert.equal(tabA.userContextId, 1, "Tab A is in container 1");
  Assert.equal(tabB.userContextId, 2, "Tab B is in container 2");

  BrowserTestUtils.removeTab(tabA);
  BrowserTestUtils.removeTab(tabB);
});

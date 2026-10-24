/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// A camera or microphone choice that is remembered belongs to the space: the
// page of another space is asked again (the media permission is keyed by the
// page's container).

const MEDIA_PAGE = `${BASE}file_media.html`;
const bar = () => document.getElementById("media-bar");

async function inFront(bridge, app, space) {
  const tab = await openInSpace(bridge, space.id, MEDIA_PAGE);
  await app.switchSpace(space.id);
  bridge.selectTab(tab.liveTab);
  await TestUtils.waitForCondition(
    () => bridge.selectedTab === tab,
    "the tab is in front"
  );
  return tab;
}

async function ask(tab) {
  await SpecialPowers.spawn(tab.browser, [], () => {
    content.wrappedJSObject.swellMedia = content.wrappedJSObject.ask(
      Cu.cloneInto({ audio: true }, content)
    );
  });
}

add_task(async function test_remembered_media_grants_are_per_space() {
  registerCleanupFunction(() => Services.perms.removeByType("microphone"));
  const { a, b, bridge } = await pair();
  const { app } = await swellApp();

  const tabA = await inFront(bridge, app, a);
  await ask(tabA);
  await TestUtils.waitForCondition(() => !bar().hidden, "space A is asked");
  document.getElementById("media-remember").checked = true;
  document.getElementById("media-allow").click();

  const tabB = await inFront(bridge, app, b);
  await ask(tabB);
  let asked = true;
  try {
    await TestUtils.waitForCondition(() => !bar().hidden, "space B is asked");
  } catch (e) {
    asked = false;
  }
  audit("media grants", asked, `space B was asked again: ${asked}`);
  if (asked) {
    document.getElementById("media-later").click();
  }
  await closeAllTabs(bridge);
});

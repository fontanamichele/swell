/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Camera, microphone and screen sharing, with fake devices.

const PAGE = `${BASE}file_media.html`;
const bar = () => document.getElementById("media-bar");
const indicator = () => document.getElementById("media-indicator");

async function inFront(bridge, app, space) {
  const tab = await openInSpace(bridge, space.id, PAGE);
  await app.switchSpace(space.id);
  bridge.selectTab(tab.liveTab);
  await TestUtils.waitForCondition(
    () => bridge.selectedTab === tab,
    "the tab is in front"
  );
  return tab;
}

// Starts a request from the page's own script (a call from chrome code would
// count as a system caller and need no permission); the result is read with
// `outcome`.
async function request(tab, constraints) {
  await SpecialPowers.spawn(tab.browser, [constraints], wanted => {
    content.document.notifyUserGestureActivation();
    content.wrappedJSObject.swellMedia = wanted.display
      ? content.wrappedJSObject.askDisplay()
      : content.wrappedJSObject.ask(Cu.cloneInto(wanted, content));
  });
}

function outcome(tab) {
  return SpecialPowers.spawn(tab.browser, [], () =>
    content.wrappedJSObject.swellMedia.then(result =>
      JSON.parse(JSON.stringify(result))
    )
  );
}

add_setup(() => {
  registerCleanupFunction(() => {
    for (const type of ["camera", "microphone", "MediaManagerVideo"]) {
      Services.perms.removeByType(type);
    }
  });
});

add_task(async function test_a_page_asks_and_shares_and_can_be_stopped() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Media allow");
  const tab = await inFront(bridge, app, space);
  Assert.ok(bar().hidden, "no bar before a request");

  await request(tab, { video: true, audio: true });
  await TestUtils.waitForCondition(() => !bar().hidden, "the bar appears");
  Assert.equal(
    bar().querySelector(".media-text").textContent,
    "example.com wants to use your camera and microphone"
  );
  Assert.ok(!document.getElementById("media-camera").hidden, "pick a camera");
  Assert.ok(
    !document.getElementById("media-microphone").hidden,
    "pick a microphone"
  );
  document.getElementById("media-allow").click();
  Assert.deepEqual(
    (await outcome(tab)).tracks.sort(),
    ["audio", "video"],
    "Allow gives the page both"
  );
  // The camera service captures only for an origin that holds this permission; a real
  // camera fails with NotReadableError without it, and a fake one does not need it.
  Assert.equal(
    Services.perms.testExactPermissionFromPrincipal(
      tab.browser.contentPrincipal,
      "MediaManagerVideo"
    ),
    Services.perms.ALLOW_ACTION,
    "allowing a camera lets the camera service capture for the page"
  );

  await TestUtils.waitForCondition(
    () => !indicator().hidden,
    "the window says the page is sharing"
  );
  Assert.ok(
    document.querySelector(".row.sharing, #today .row"),
    "the tab shows it"
  );
  Assert.ok(
    bridge.selectedTab.sharing?.camera,
    "the tab knows about the camera"
  );
  document.getElementById("media-stop").click();
  await TestUtils.waitForCondition(
    () => indicator().hidden,
    "Stop sharing ends it"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_block_denies() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Media block");
  const tab = await inFront(bridge, app, space);
  await request(tab, { audio: true });
  await TestUtils.waitForCondition(() => !bar().hidden, "the bar appears");
  document.getElementById("media-block").click();
  Assert.equal((await outcome(tab)).error, "NotAllowedError", "Block denies");
  await closeAllTabs(bridge);
});

add_task(async function test_remember_is_kept_for_the_space_only() {
  const { bridge, app } = await swellApp();
  const a = await freshSpace(app, "Media A");
  const tabA = await inFront(bridge, app, a);
  await request(tabA, { audio: true });
  await TestUtils.waitForCondition(() => !bar().hidden, "the bar appears");
  document.getElementById("media-remember").checked = true;
  document.getElementById("media-allow").click();
  Assert.equal((await outcome(tabA)).tracks[0], "audio");

  await request(tabA, { audio: true });
  Assert.equal(
    (await outcome(tabA)).tracks[0],
    "audio",
    "asked again, the page gets it without a bar"
  );
  Assert.ok(bar().hidden, "no bar for a remembered answer");

  const b = await freshSpace(app, "Media B");
  const tabB = await inFront(bridge, app, b);
  await request(tabB, { audio: true });
  await TestUtils.waitForCondition(
    () => !bar().hidden,
    "another space is asked: the answer was not shared"
  );
  document.getElementById("media-later").click();
  Assert.equal(
    (await outcome(tabB)).error,
    "NotAllowedError",
    "Not now leaves the request denied"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_screen_sharing_asks_for_a_screen() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Media screen");
  const tab = await inFront(bridge, app, space);
  await request(tab, { display: { video: true } });
  await TestUtils.waitForCondition(() => !bar().hidden, "the bar appears");
  Assert.ok(
    bar().querySelector(".media-text").textContent.includes("screen"),
    "it asks about the screen"
  );
  Assert.ok(!document.getElementById("media-screen").hidden, "pick a screen");
  Assert.ok(
    document.getElementById("media-remember-label").hidden,
    "a screen is never remembered"
  );
  document.getElementById("media-allow").click();
  const result = await outcome(tab);
  if (result.tracks) {
    Assert.deepEqual(result, { tracks: ["video"] });
    await TestUtils.waitForCondition(
      () => !indicator().hidden,
      "the window says the screen is shared"
    );
    document.getElementById("media-stop").click();
    await TestUtils.waitForCondition(() => indicator().hidden, "stopped");
  } else {
    // Without a screen or the system's screen recording permission, as in a
    // headless run, the system refuses after the user said yes: before the capture
    // starts when it says so (NotFoundError), or when the capture starts.
    Assert.ok(
      ["NotFoundError", "NotReadableError"].includes(result.error),
      `the system refused: ${result.error}`
    );
  }
  await closeAllTabs(bridge);
});

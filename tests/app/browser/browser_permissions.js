/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_blank.html`;
const bar = () => document.getElementById("permission-bar");

async function request(tab) {
  await SpecialPowers.spawn(tab.browser, [], () => {
    content.window.swellAnswer = content.Notification.requestPermission();
  });
}

async function answer(tab) {
  return SpecialPowers.spawn(tab.browser, [], () => content.window.swellAnswer);
}

add_setup(async () => {
  registerCleanupFunction(() =>
    Services.perms.removeByType("desktop-notification")
  );
});

add_task(
  async function test_a_request_is_asked_remembered_and_kept_to_its_space() {
    const { bridge, app } = await swellApp();
    const a = await freshSpace(app, "Perm A");
    const tabA = await openInSpace(bridge, a.id, PAGE);
    Assert.ok(bar().hidden, "no bar before a request");

    await request(tabA);
    await rendered(() => !bar().hidden, "the bar appears");
    Assert.equal(
      bar().querySelector(".permission-text").textContent,
      "example.com wants to show notifications"
    );
    document.getElementById("permission-allow").click();
    Assert.equal(await answer(tabA), "granted", "Allow grants");
    Assert.ok(bar().hidden, "the bar goes away");

    const b = await freshSpace(app, "Perm B");
    const tabB = await openInSpace(bridge, b.id, PAGE);
    await request(tabB);
    await rendered(
      () => !bar().hidden,
      "another space is asked again: the answer was not shared"
    );
    document.getElementById("permission-block").click();
    Assert.equal(await answer(tabB), "denied", "Block denies");

    await app.switchSpace(a.id);
    await rendered(
      () => bridge.selectedTab === tabA,
      "back in the first space"
    );
    await request(tabA);
    Assert.equal(
      await answer(tabA),
      "granted",
      "a remembered answer is applied without asking"
    );
    Assert.ok(bar().hidden, "and no bar is shown");
    await closeAllTabs(bridge);
  }
);

add_task(
  async function test_not_now_does_not_remember_and_the_bar_follows_the_tab() {
    const { bridge, app } = await swellApp();
    Services.perms.removeByType("desktop-notification");
    const space = await freshSpace(app, "Perm later");
    const first = await openInSpace(bridge, space.id, PAGE);
    await request(first);
    await rendered(() => !bar().hidden, "the bar appears over the asking tab");

    const second = await openInSpace(
      bridge,
      space.id,
      `${BASE}file_opener.html`
    );
    await rendered(
      () => bridge.selectedTab === second && bar().hidden,
      "the bar stays with the tab that asked"
    );
    bridge.selectTab(first.liveTab);
    await rendered(() => !bar().hidden, "and returns with it");

    document.getElementById("permission-later").click();
    Assert.equal(
      await answer(first),
      "default",
      "Not now leaves the question open"
    );
    await request(first);
    await rendered(() => !bar().hidden, "so it is asked again");
    document.getElementById("permission-later").click();
    await closeAllTabs(bridge);
  }
);

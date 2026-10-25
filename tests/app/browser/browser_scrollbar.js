/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The list of the sidebar scrolls under a scrollbar that floats over it and
// is thin: it takes no room from the rows.

add_task(
  async function test_the_sidebar_scrolls_under_a_thin_floating_scrollbar() {
    const { app, core } = await swellApp();
    const space = await freshSpace(app, "Scrolling");
    for (let i = 0; i < 40; i++) {
      await savedTab(
        core,
        space,
        space.pinnedRoot,
        `https://a.test/${i}`,
        `Tab ${i}`
      );
    }
    const lists = document.getElementById("lists");
    await rendered(
      () => lists.scrollHeight > lists.clientHeight + 50,
      "it overflows"
    );
    Assert.equal(
      lists.offsetWidth,
      lists.clientWidth,
      "the scrollbar takes no width from the rows"
    );
    Assert.equal(getComputedStyle(lists).scrollbarWidth, "thin");
    Assert.equal(Services.prefs.getIntPref("ui.useOverlayScrollbars"), 1);
  }
);

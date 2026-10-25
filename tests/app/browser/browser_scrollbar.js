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

add_task(async function test_many_pins_do_not_cover_the_favorites() {
  const { app, core } = await swellApp();
  const space = await freshSpace(app, "Pins and favorites");
  const favorites = [];
  for (let i = 0; i < 3; i++) {
    favorites.push(
      await savedTab(
        core,
        space,
        space.pinnedRoot,
        `https://f.test/${i}`,
        `Fav ${i}`
      )
    );
  }
  for (let i = 0; i < 36; i++) {
    await savedTab(
      core,
      space,
      space.pinnedRoot,
      `https://a.test/${i}`,
      `Tab ${i}`
    );
  }
  for (const node of favorites) {
    await app.favorite(node);
  }
  await rendered(
    () => document.querySelectorAll("#favorites .favorite").length == 3,
    "the favorites show"
  );
  await rendered(
    () => document.querySelectorAll("#pinned .row").length >= 36,
    "and the pins"
  );
  const box = id => document.getElementById(id).getBoundingClientRect();
  const tiles = [...document.querySelectorAll("#favorites .favorite")].map(t =>
    t.getBoundingClientRect()
  );
  Assert.lessOrEqual(
    Math.max(...tiles.map(t => t.bottom)),
    box("favorites").bottom + 0.5,
    "the tiles are inside the area of the favorites"
  );
  Assert.lessOrEqual(
    box("favorites").bottom,
    box("lists").top + 0.5,
    "which ends where the lists begin"
  );
  Assert.lessOrEqual(
    box("navbar").bottom,
    box("favorites").top + 0.5,
    "after the address row"
  );
  Assert.lessOrEqual(
    box("lists").bottom,
    box("sidebar-footer").top + 0.5,
    "and the lists end where the footer begins"
  );
  const lists = document.getElementById("lists");
  Assert.greater(lists.scrollHeight, lists.clientHeight, "the lists scroll");
});

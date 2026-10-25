/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(
  async function test_dropped_links_load_here_and_in_new_tabs_of_the_space() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Drop");
    const tab = await openInSpace(bridge, space.id, `${BASE}file_blank.html`);
    const before = bridge.tabs(space.id).length;
    const [first, second] = [`${BASE}file_form.html`, `${BASE}file_links.html`];

    Assert.ok(tab.browser.droppedLinkHandler, "the page takes dropped links");
    tab.browser.droppedLinkHandler(null, [{ url: first }, { url: second }]);

    await rendered(
      () => tab.browser.currentURI?.spec == first,
      "the first link loads in the tab"
    );
    await rendered(
      () => bridge.tabs(space.id).length == before + 1,
      "the second opens a tab"
    );
    Assert.equal(
      bridge.tabs(space.id).at(-1).userContextId,
      space.userContextId,
      "in the same container"
    );
    await closeAllTabs(bridge);
  }
);

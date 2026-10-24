/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_icon.html`;

add_task(
  async function test_an_icon_is_loaded_in_the_tabs_container_and_shown() {
    const { core, bridge, app } = await swellApp();
    const space = await freshSpace(app, "Icons");
    const requests = [];
    const observer = {
      observe(subject) {
        const channel = subject.QueryInterface(Ci.nsIHttpChannel);
        if (channel.URI.spec.endsWith("file_icon.png")) {
          requests.push(channel.loadInfo.originAttributes.userContextId);
        }
      },
    };
    Services.obs.addObserver(observer, "http-on-modify-request");

    const live = await bridge.openUrl(PAGE, space.id);
    await rendered(() => bridge.tab(live)?.icon, "the page's icon arrives");
    Services.obs.removeObserver(observer, "http-on-modify-request");
    const tab = bridge.tab(live);
    Assert.ok(
      tab.icon.startsWith("data:image/png"),
      "it is a data URI, not a network address"
    );
    Assert.ok(
      requests.length && requests.every(id => id == space.userContextId),
      `the icon was fetched in the space's container: ${requests}`
    );

    await rendered(
      () => rowFor(tab.node)?.querySelector("img.avatar.icon"),
      "the sidebar row shows it"
    );
    Assert.equal(
      rowFor(tab.node).querySelector("img.avatar.icon").src,
      tab.icon
    );

    await rendered(async () => {
      const tree = await core.spaceTree(space.id);
      return tree.nodes.find(n => n.id == tab.node)?.kind.icon == tab.icon;
    }, "the core keeps it, so it survives a restart");
    await closeAllTabs(bridge);
  }
);

add_task(
  async function test_a_page_that_cannot_have_an_icon_keeps_its_letter() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "No icons");
    const url = "data:text/html,<title>plain</title>plain";
    const live = await bridge.openUrl(url, space.id);
    await rendered(() => bridge.tab(live)?.url == url, "loaded");
    await rendered(() => rowFor(bridge.tab(live).node), "drawn");
    Assert.ok(
      rowFor(bridge.tab(live).node).querySelector("span.avatar"),
      "the letter stays"
    );
    Assert.ok(!bridge.tab(live).icon);
    await closeAllTabs(bridge);
  }
);

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_blank.html`;

// The two spaces under test; other test files add spaces of their own.
let gA;
let gB;

add_task(async function test_each_tab_carries_its_spaces_container() {
  const { core, bridge } = await swellApp();
  const [a] = await core.listSpaces();
  const b = await newSpace(core, "Work");
  gA = a;
  gB = b;
  Assert.notEqual(a.userContextId, 0, "context 0 is never used");
  Assert.notEqual(a.userContextId, b.userContextId);

  bridge.showSpace(a.id);
  const tabA = await openInSpace(bridge, a.id, PAGE);
  bridge.showSpace(b.id);
  const tabB = await openInSpace(bridge, b.id, PAGE);

  for (const [tab, space] of [
    [tabA, a],
    [tabB, b],
  ]) {
    Assert.equal(
      tab.browser.getAttribute("usercontextid"),
      String(space.userContextId)
    );
    Assert.equal(
      tab.browser.contentPrincipal.originAttributes.userContextId,
      space.userContextId,
      "the page runs in the space's container"
    );
  }
  Assert.notEqual(
    tabA.browser.remoteType,
    tabB.browser.remoteType,
    "two containers never share a content process"
  );
  info(`remote types: ${tabA.browser.remoteType} | ${tabB.browser.remoteType}`);
});

add_task(async function test_cookies_and_storage_do_not_cross_spaces() {
  const { bridge } = await swellApp();
  const [a, b] = [gA, gB];
  bridge.showSpace(a.id);
  const tabA = bridge.tabs(a.id)[0];
  const tabB = bridge.tabs(b.id)[0];

  await SpecialPowers.spawn(tabA.browser, [], () => {
    content.document.cookie = "swell=a; path=/";
    content.localStorage.setItem("swell", "a");
  });
  const seenInB = await SpecialPowers.spawn(tabB.browser, [], () => ({
    cookie: content.document.cookie,
    storage: content.localStorage.getItem("swell"),
  }));
  Assert.equal(seenInB.cookie, "", "B sees no cookie of A");
  Assert.equal(seenInB.storage, null, "B sees no storage of A");

  const cookiesIn = userContextId =>
    Services.cookies.getCookiesFromHost("example.com", { userContextId })
      .length;
  Assert.equal(cookiesIn(a.userContextId), 1);
  Assert.equal(cookiesIn(b.userContextId), 0);
  Assert.equal(cookiesIn(0), 0, "nothing leaks into the default container");
});

add_task(async function test_the_bridge_refuses_the_default_container() {
  const { core, bridge } = await swellApp();
  const [a] = await core.listSpaces();
  Assert.throws(
    () => bridge.assertContainer(a.id, 0),
    /Refusing to open web content in container 0/
  );
  Assert.throws(
    () => bridge.assertContainer(a.id, 987654),
    /does not belong to space/
  );
  Assert.throws(
    () => bridge.assertContainer("nope", a.userContextId),
    /does not belong to space/
  );
  bridge.assertContainer(a.id, a.userContextId);
});

add_task(
  async function test_a_popup_stays_in_the_openers_space_and_container() {
    const { core, bridge } = await swellApp();
    const [a, b] = [gA, gB];
    bridge.showSpace(b.id);
    const opener = await openInSpace(bridge, b.id, `${BASE}file_opener.html`);
    const before = bridge.tabs(b.id).length;

    await SpecialPowers.spawn(
      opener.browser,
      [`${BASE}file_blank.html`],
      url => {
        content.window.open(url);
      }
    );
    await TestUtils.waitForCondition(
      () => bridge.tabs(b.id).length == before + 1,
      "the popup became a tab of the same space"
    );
    const popup = bridge.tabs(b.id).at(-1);
    Assert.equal(
      popup.userContextId,
      b.userContextId,
      "same container as the opener"
    );
    Assert.equal(
      popup.browser.getAttribute("usercontextid"),
      String(b.userContextId)
    );
    Assert.equal(bridge.tabs(a.id).length, 1, "space A is untouched");

    const today = (await core.spaceTree(b.id)).children.find(
      c => c.parent == b.todayRoot
    ).ids;
    Assert.equal(
      today.length,
      before + 1,
      "the core recorded the popup in Today"
    );
    Assert.ok(popup.liveTab && popup.node, "the popup is known to the core");
  }
);

add_task(async function test_closing_a_today_tab_drops_its_node() {
  const { core, bridge } = await swellApp();
  const b = gB;
  const tabs = bridge.tabs(b.id);
  const counts = async () =>
    (await core.spaceTree(b.id)).children.find(c => c.parent == b.todayRoot).ids
      .length;
  const before = await counts();
  await bridge.closeTab(tabs.at(-1).liveTab);
  Assert.equal(await counts(), before - 1, "the Today node went with the tab");
  Assert.equal(bridge.tabs(b.id).length, tabs.length - 1);
});

add_task(async function cleanup() {
  const { bridge } = await swellApp();
  await closeAllTabs(bridge);
  Assert.equal(bridge.tabs().length, 0);
});

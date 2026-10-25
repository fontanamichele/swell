/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const LINKS = `${BASE}file_links.html`;
const menu = () => document.getElementById("menu");
const labels = () =>
  [...menu().querySelectorAll("button")].map(b => b.textContent);

async function openLinks(space) {
  const { bridge } = await swellApp();
  const tab = await openInSpace(bridge, space.id, LINKS);
  await SpecialPowers.spawn(
    tab.browser,
    [],
    () => content.document.getElementById("link").offsetWidth
  );
  return tab;
}

add_task(
  async function test_a_links_menu_opens_it_in_a_new_tab_of_the_same_space() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Menu links");
    const opener = await openLinks(space);
    const before = bridge.tabs(space.id).length;

    await BrowserTestUtils.synthesizeMouse(
      "#link",
      10,
      10,
      { type: "contextmenu", button: 2 },
      opener.browser
    );
    await rendered(() => !menu().hidden, "the menu opens");
    Assert.ok(labels().includes("Open link in new tab"), labels().join());
    Assert.ok(labels().includes("Copy link"));
    [...menu().querySelectorAll("button")]
      .find(b => b.textContent == "Open link in new tab")
      .click();

    await rendered(
      () => bridge.tabs(space.id).length == before + 1,
      "a tab opens"
    );
    const opened = bridge.tabs(space.id).at(-1);
    Assert.equal(
      opened.userContextId,
      space.userContextId,
      "same container as the page"
    );
    await rendered(
      () => opened.browser.currentURI?.spec == `${BASE}file_blank.html`,
      "the link loads"
    );
    await closeAllTabs(bridge);
  }
);

add_task(async function test_a_middle_click_opens_in_the_background() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Middle");
  const opener = await openLinks(space);
  Assert.equal(bridge.selectedTab, opener);

  await BrowserTestUtils.synthesizeMouse(
    "#link",
    10,
    10,
    { button: 1 },
    opener.browser
  );
  await rendered(() => bridge.tabs(space.id).length == 2, "a second tab opens");
  Assert.equal(
    bridge.selectedTab,
    opener,
    "the page you are reading stays in front"
  );
  Assert.equal(
    opener.browser.currentURI.spec,
    LINKS,
    "the page did not navigate"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_a_plain_page_menu_has_navigation() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Plain");
  const tab = await openLinks(space);
  await BrowserTestUtils.synthesizeMouse(
    "#empty",
    10,
    10,
    { type: "contextmenu", button: 2 },
    tab.browser
  );
  await rendered(() => !menu().hidden, "the menu opens");
  Assert.deepEqual(labels(), ["Back", "Forward", "Reload", "Inspect"]);
  menu().hidden = true;
  await closeAllTabs(bridge);
});

add_task(async function test_a_text_field_menu_has_edit_commands() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Field");
  const tab = await openLinks(space);
  await BrowserTestUtils.synthesizeMouse(
    "#field",
    10,
    10,
    { type: "contextmenu", button: 2 },
    tab.browser
  );
  await rendered(() => !menu().hidden, "the menu opens");
  Assert.deepEqual(labels(), ["Cut", "Copy", "Paste", "Select all", "Inspect"]);
  menu().hidden = true;
  await closeAllTabs(bridge);
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_blank.html`;
const bar = () => document.getElementById("commandbar");
const input = () => document.getElementById("commandbar-input");
const items = () => [...document.querySelectorAll("#commandbar-list li")];

async function type(text) {
  input().value = text;
  input().dispatchEvent(new Event("input", { bubbles: true }));
  await rendered(
    () =>
      document.getElementById("commandbar-list").dataset.query === text &&
      !!items().length,
    `suggestions for "${text}" are drawn`
  );
}

function press(key) {
  input().dispatchEvent(
    new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
  );
}

add_task(async function test_accel_t_opens_the_bar_and_escape_closes_it() {
  const { app } = await swellApp();
  await freshSpace(app, "Bar");
  Assert.ok(bar().hidden);
  EventUtils.synthesizeKey("t", { accelKey: true }, window);
  await rendered(() => !bar().hidden, "the bar opens");
  Assert.equal(document.activeElement, input(), "the input has focus");
  EventUtils.synthesizeKey("KEY_Escape", {}, window);
  await rendered(() => bar().hidden, "Escape closes it");
});

add_task(
  async function test_enter_opens_a_typed_address_in_a_new_tab_of_the_space() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Typed");
    app.commandBar.open({ mode: "new" });
    await type(PAGE);
    Assert.ok(
      items()[0].textContent.includes(PAGE),
      "the address is the first entry"
    );
    press("Enter");
    await rendered(() => bridge.tabs(space.id).length == 1, "a tab opens");
    const tab = bridge.tabs(space.id)[0];
    Assert.equal(tab.userContextId, space.userContextId);
    await rendered(
      () => tab.browser.currentURI?.spec == PAGE,
      "the address loads"
    );
    Assert.ok(bar().hidden, "the bar closes");
  }
);

add_task(
  async function test_a_saved_tab_is_found_and_selected_instead_of_reopened() {
    const { core, bridge, app } = await swellApp();
    const space = await freshSpace(app, "Jump");
    const node = await savedTab(core, space, space.pinnedRoot, PAGE, "Quokka");
    app.commandBar.open({ mode: "new" });
    await type("quokka");
    Assert.ok(
      items()[0].textContent.includes("Quokka"),
      "the saved tab comes first"
    );
    press("Enter");
    await rendered(
      () => bridge.selectedTab?.node === node,
      "the saved tab opens"
    );
    const count = bridge.tabs(space.id).length;
    app.commandBar.open({ mode: "new" });
    await type("quokka");
    press("Enter");
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 200));
    Assert.equal(
      bridge.tabs(space.id).length,
      count,
      "no second tab for the same node"
    );
  }
);

add_task(async function test_a_word_offers_a_web_search() {
  const { app } = await swellApp();
  await freshSpace(app, "Search");
  app.commandBar.open({ mode: "new" });
  await type("rust lifetimes");
  Assert.ok(
    items()[0].textContent.includes("Search Google"),
    "search is offered"
  );
  app.commandBar.close();
});

add_task(async function test_accel_l_loads_into_the_selected_tab() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Current");
  const liveTab = await bridge.openUrl(PAGE, space.id);
  await rendered(() => bridge.selectedTab?.liveTab === liveTab, "tab selected");
  await rendered(() => bridge.selectedTab.url == PAGE, "loaded");
  EventUtils.synthesizeKey("l", { accelKey: true }, window);
  await rendered(() => !bar().hidden, "the bar opens");
  Assert.equal(input().value, PAGE, "the bar starts with the tab's address");
  const other = `${BASE}file_opener.html`;
  await type(other);
  press("Enter");
  await rendered(
    () => bridge.selectedTab.url == other,
    "the same tab navigates"
  );
  Assert.equal(bridge.tabs(space.id).length, 1, "no new tab");
});

add_task(
  async function test_accel_w_closes_the_selected_tab_and_digits_switch_spaces() {
    const { core, bridge, app } = await swellApp();
    const space = await freshSpace(app, "Keys");
    const liveTab = await bridge.openUrl(PAGE, space.id);
    await rendered(() => bridge.tab(liveTab), "opened");
    EventUtils.synthesizeKey("w", { accelKey: true }, window);
    await rendered(() => !bridge.tab(liveTab), "Accel+W closes the tab");

    const spaces = await core.listSpaces();
    const index = spaces.findIndex(s => s.id == space.id);
    const first = spaces[0];
    EventUtils.synthesizeKey("1", { accelKey: true }, window);
    await rendered(
      () => app.activeSpaceId == first.id,
      "Accel+1 switches to the first space"
    );
    Assert.notEqual(index, 0);
  }
);

add_task(async function cleanup() {
  const { bridge } = await swellApp();
  await closeAllTabs(bridge);
});

add_task(async function test_shortcuts_work_while_web_content_has_focus() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Focus");
  const liveTab = await bridge.openUrl(PAGE, space.id);
  await rendered(
    () =>
      bridge.selectedTab?.liveTab === liveTab && bridge.selectedTab.url == PAGE,
    "loaded"
  );
  const { browser } = bridge.selectedTab;
  browser.focus();
  await SpecialPowers.spawn(browser, [], async () => {
    content.document.body.setAttribute("tabindex", "0");
    content.document.body.focus();
  });
  await TestUtils.waitForCondition(
    () => Services.focus.focusedElement === browser,
    "the page has focus"
  );
  Assert.ok(document.getElementById("commandbar").hidden);
  await EventUtils.synthesizeKey("t", { accelKey: true }, window);
  await rendered(
    () => !document.getElementById("commandbar").hidden,
    "Accel+T opens the bar from the page"
  );
  app.commandBar.close();
});

add_task(async function test_accel_f_opens_the_find_bar_of_the_selected_tab() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Find");
  const liveTab = await bridge.openUrl(`${BASE}file_links.html`, space.id);
  await rendered(
    () =>
      bridge.selectedTab?.liveTab === liveTab &&
      bridge.selectedTab.url == `${BASE}file_links.html`,
    "loaded"
  );
  const tab = bridge.selectedTab;
  EventUtils.synthesizeKey("f", { accelKey: true }, window);
  await rendered(
    () => tab.findbar && !tab.findbar.hidden,
    "the find bar opens"
  );
  Assert.ok(!tab.findbarSlot.hidden, "and is visible");

  const other = await bridge.openUrl(`${BASE}file_blank.html`, space.id);
  await rendered(
    () => bridge.selectedTab?.liveTab === other,
    "another tab is selected"
  );
  Assert.ok(
    tab.findbarSlot.hidden,
    "the first tab's find bar is hidden while it is in the background"
  );
  await closeAllTabs(bridge);
  Assert.ok(
    !document.querySelector("#findbars .findbar-slot"),
    "find bars go with their tabs"
  );
});

add_task(async function test_the_bar_is_in_the_middle_of_the_page() {
  const { app } = await swellApp();
  const middle = element => {
    const rect = element.getBoundingClientRect();
    return rect.left + rect.width / 2;
  };
  const panel = document.querySelector("#commandbar .panel");
  const page = document.getElementById("content");

  app.commandBar.open({ mode: "new" });
  Assert.less(
    Math.abs(middle(panel) - middle(page)),
    1.5,
    "over the page, not over the window and the sidebar"
  );
  app.commandBar.close();

  app.sidebarLayout.toggle();
  app.commandBar.open({ mode: "new" });
  Assert.less(
    Math.abs(middle(panel) - middle(page)),
    1.5,
    "also with the sidebar hidden"
  );
  app.commandBar.close();
  app.sidebarLayout.toggle();
});

add_task(async function test_the_empty_bar_is_just_its_input() {
  const { app } = await swellApp();
  app.commandBar.open({ mode: "new" });
  const field = document.getElementById("commandbar-input");
  field.value = "";
  field.dispatchEvent(new Event("input"));
  const panel = document.querySelector("#commandbar .panel");
  await rendered(
    () => !document.getElementById("commandbar-list").children.length,
    "nothing is suggested"
  );
  const box = panel.getBoundingClientRect();
  const fieldBox = field.getBoundingClientRect();
  Assert.less(
    Math.abs(box.height - fieldBox.height - 2),
    1.5,
    "the bar is as tall as its input (and its border)"
  );
  Assert.less(
    Math.abs(fieldBox.top - box.top - (box.bottom - fieldBox.bottom)),
    1.5,
    "with the same room above the input and below it"
  );
  app.commandBar.close();
});

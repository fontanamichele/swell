/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const FIRST = `${BASE}file_blank.html`;
const SECOND = `${BASE}file_links.html`;

const byId = id => document.getElementById(id);

// What the mouse's back and forward buttons send to the window.
const appCommand = command =>
  window.dispatchEvent(
    new CommandEvent("AppCommand", { command, bubbles: true, cancelable: true })
  );

async function inFront(bridge, app, space, url = FIRST) {
  const tab = await openInSpace(bridge, space.id, url);
  await app.switchSpace(space.id);
  bridge.selectTab(tab.liveTab);
  await rendered(() => bridge.selectedTab === tab, "the tab is in front");
  await rendered(() => app.selectedNode == tab.node, "its row is selected");
  return tab;
}

add_task(async function test_accel_d_pins_and_unpins_the_tab_in_front() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Pin keys");
  const tab = await inFront(bridge, app, space);
  Assert.equal(
    app.state.parent(tab.node),
    space.todayRoot,
    "open tabs start in Today"
  );

  EventUtils.synthesizeKey("d", { accelKey: true }, window);
  await rendered(
    () => app.state.parent(tab.node) === space.pinnedRoot,
    "accel+D pins it"
  );
  EventUtils.synthesizeKey("d", { accelKey: true }, window);
  await rendered(
    () => app.state.parent(tab.node) === space.todayRoot,
    "and again unpins it"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_a_middle_click_closes_a_tab() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Middle click");
  const tab = await inFront(bridge, app, space);
  const row = await rendered(() => rowFor(tab.node), "the row shows");
  row.dispatchEvent(
    new MouseEvent("auxclick", { button: 1, bubbles: true, cancelable: true })
  );
  await rendered(() => !bridge.tab(tab.liveTab), "the tab is closed");
});

add_task(async function test_the_close_button_and_icons_are_drawn_to_size() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Sizes");
  const first = await inFront(bridge, app, space);
  const second = await openInSpace(bridge, space.id, SECOND);
  await rendered(
    () => rowFor(first.node) && rowFor(second.node),
    "two rows show"
  );
  const a = rowFor(first.node).getBoundingClientRect();
  const b = rowFor(second.node).getBoundingClientRect();
  Assert.equal(
    Math.abs(b.top - a.top),
    a.height + 4,
    "a small gap between tabs"
  );
  const close = rowFor(first.node).querySelector(".close");
  Assert.ok(
    getComputedStyle(close, "::before").maskImage.includes("xmark.svg"),
    "the close button is an icon"
  );
  const box = close.getBoundingClientRect();
  Assert.equal(box.width, box.height, "in a square");
  Assert.equal(
    getComputedStyle(rowFor(first.node).querySelector(".title")).fontWeight,
    "400",
    "tab titles are in the regular weight"
  );
  Assert.equal(
    getComputedStyle(rowFor(first.node).querySelector(".avatar")).width,
    "14px",
    "icons are small"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_mouse_buttons_go_back_and_forward_in_a_page() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Mouse history");
  const tab = await inFront(bridge, app, space);
  for (const id of ["sidebar", "titlebar-left"]) {
    byId(id).dispatchEvent(new MouseEvent("mouseleave"));
  }
  tab.browser.fixupAndLoadURIString(SECOND, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  await rendered(
    () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
    "the second page loads"
  );
  appCommand("Back");
  await rendered(
    () => app.selectedTab?.url == FIRST && !app.selectedTab.loading,
    "the back button goes back"
  );
  appCommand("Forward");
  await rendered(
    () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
    "the forward button goes forward"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_mouse_buttons_on_the_sidebar_switch_spaces() {
  const { app } = await swellApp();
  const a = await freshSpace(app, "Slide A");
  const b = await freshSpace(app, "Slide B");
  const sidebar = byId("sidebar");
  sidebar.dispatchEvent(new MouseEvent("mouseenter"));

  appCommand("Back");
  await rendered(() => app.activeSpaceId == a.id, "back is the previous space");
  await rendered(
    () => sidebar.classList.contains("slide-prev"),
    "the lists slide in from the left"
  );
  Assert.ok(
    getComputedStyle(byId("lists")).animationName.includes("slide-in-prev"),
    "with an animation"
  );
  appCommand("Forward");
  await rendered(() => app.activeSpaceId == b.id, "forward is the next one");
  await rendered(
    () => sidebar.classList.contains("slide-next"),
    "sliding in from the right"
  );
  const last = app.spaces.at(-1);
  await app.switchSpace(last.id);
  appCommand("Forward");
  Assert.equal(app.activeSpaceId, last.id, "and it stops at the last space");
  sidebar.dispatchEvent(new MouseEvent("mouseleave"));
});

add_task(
  async function test_a_pinned_tab_shows_where_it_went_and_resets_on_close() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Pinned nav");
    const tab = await inFront(bridge, app, space);
    await app.pin(tab.node);
    await rendered(
      () => app.state.parent(tab.node) === space.pinnedRoot && rowFor(tab.node),
      "the tab is pinned"
    );
    const pinnedUrl = app.state.describe(tab.node).url;
    Assert.equal(pinnedUrl, FIRST);
    Assert.ok(!rowFor(tab.node).classList.contains("away"), "not away yet");

    tab.browser.fixupAndLoadURIString(SECOND, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await rendered(
      () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
      "it navigates"
    );
    const row = await rendered(
      () => rowFor(tab.node)?.classList.contains("away") && rowFor(tab.node),
      "the row shows that it went elsewhere"
    );
    Assert.equal(
      row.querySelector(".title").textContent,
      app.selectedTab.title || SECOND,
      "with the title of the page it is on"
    );
    Assert.ok(row.querySelector(".divider"), "and a divider after the icon");
    Assert.equal(
      app.state.describe(tab.node).url,
      FIRST,
      "the pin did not follow"
    );

    row.querySelector(".back-to-pin").click();
    await rendered(
      () => app.selectedTab?.url == FIRST && !app.selectedTab.loading,
      "the button goes back to the pinned page"
    );
    await rendered(
      () => !rowFor(tab.node).classList.contains("away"),
      "and the row is the pinned one again"
    );

    tab.browser.fixupAndLoadURIString(SECOND, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await rendered(
      () => rowFor(tab.node)?.classList.contains("away"),
      "away again"
    );
    await bridge.closeTab(tab.liveTab);
    await rendered(
      () => !rowFor(tab.node).classList.contains("away"),
      "closed, it is the pinned page"
    );
    Assert.equal(app.state.describe(tab.node).url, FIRST);

    await app.openNode(tab.node);
    await rendered(
      () => app.selectedTab?.url == FIRST && !app.selectedTab.loading,
      "opened again it starts from the pinned page"
    );
    await closeAllTabs(bridge);
  }
);

add_task(async function test_accel_d_pins_a_pinned_tab_again_where_it_is() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Repin");
  const tab = await inFront(bridge, app, space);
  await app.pin(tab.node);
  await rendered(
    () => app.state.parent(tab.node) === space.pinnedRoot && rowFor(tab.node),
    "the tab is pinned"
  );
  tab.browser.fixupAndLoadURIString(SECOND, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  await rendered(
    () => rowFor(tab.node)?.classList.contains("away"),
    "it went elsewhere"
  );

  EventUtils.synthesizeKey("d", { accelKey: true }, window);
  await rendered(
    () => app.state.describe(tab.node).url == SECOND,
    "accel+D pins the page it is on"
  );
  await rendered(
    () => !rowFor(tab.node).classList.contains("away"),
    "so it is not away any more"
  );
  Assert.equal(app.state.parent(tab.node), space.pinnedRoot, "still pinned");

  EventUtils.synthesizeKey("d", { accelKey: true }, window);
  await rendered(
    () => app.state.parent(tab.node) === space.todayRoot,
    "and on its pinned page it unpins"
  );

  await app.pin(tab.node);
  await rendered(
    () => app.state.parent(tab.node) === space.pinnedRoot,
    "pinned again"
  );
  await bridge.closeTab(tab.liveTab);
  await app.openNode(tab.node);
  await rendered(
    () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
    "opened again it starts from the page that was pinned"
  );
  await closeAllTabs(bridge);
});

add_task(
  async function test_the_bracket_shortcuts_work_on_any_keyboard_layout() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Brackets");
    const tab = await inFront(bridge, app, space);
    tab.browser.fixupAndLoadURIString(SECOND, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await rendered(
      () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
      "the second page loads"
    );
    // On an Italian keyboard the key that is "[" in US layout types "\u00e8".
    EventUtils.synthesizeKey(
      "\u00e8",
      { accelKey: true, code: "BracketLeft" },
      window
    );
    await rendered(
      () => app.selectedTab?.url == FIRST && !app.selectedTab.loading,
      "accel plus the key that is [ in US layout goes back"
    );
    EventUtils.synthesizeKey(
      "*",
      { accelKey: true, code: "BracketRight" },
      window
    );
    await rendered(
      () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
      "and the key that is ] goes forward"
    );
    await closeAllTabs(bridge);
  }
);

add_task(
  async function test_accel_arrows_go_back_and_forward_or_change_space() {
    const { bridge, app } = await swellApp();
    const a = await freshSpace(app, "Arrows A");
    const b = await freshSpace(app, "Arrows B");
    const tab = await inFront(bridge, app, b);
    tab.browser.fixupAndLoadURIString(SECOND, {
      triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
    });
    await rendered(
      () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
      "the second page loads"
    );

    EventUtils.synthesizeKey("KEY_ArrowLeft", { accelKey: true }, window);
    await rendered(
      () => app.selectedTab?.url == FIRST && !app.selectedTab.loading,
      "accel+Left goes back"
    );
    EventUtils.synthesizeKey("KEY_ArrowRight", { accelKey: true }, window);
    await rendered(
      () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
      "accel+Right goes forward"
    );

    const sidebar = byId("sidebar");
    sidebar.dispatchEvent(new MouseEvent("mouseenter"));
    EventUtils.synthesizeKey("KEY_ArrowLeft", { accelKey: true }, window);
    await rendered(
      () => app.activeSpaceId == a.id,
      "over the sidebar, accel+Left is the previous space"
    );
    EventUtils.synthesizeKey(
      "]",
      { accelKey: true, code: "BracketRight" },
      window
    );
    await rendered(
      () => app.activeSpaceId == b.id,
      "and the brackets are the previous and next space too"
    );
    sidebar.dispatchEvent(new MouseEvent("mouseleave"));

    app.commandBar.open({ mode: "new" });
    const input = byId("commandbar-input");
    input.focus();
    const typing = new KeyboardEvent("keydown", {
      key: "ArrowLeft",
      code: "ArrowLeft",
      metaKey: Services.appinfo.OS == "Darwin",
      ctrlKey: Services.appinfo.OS != "Darwin",
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(typing);
    Assert.ok(
      !typing.defaultPrevented,
      "in a text field the arrows are the caret's"
    );
    app.commandBar.close();
    await closeAllTabs(bridge);
  }
);

add_task(
  async function test_the_cross_closes_an_open_page_and_deletes_a_pin_that_is_not_open() {
    const { core, bridge, app } = await swellApp();
    const space = await freshSpace(app, "Crosses");
    const saved = await savedTab(
      core,
      space,
      space.pinnedRoot,
      "https://a.test/",
      "Saved"
    );
    const open = await inFront(bridge, app, space);
    await app.pin(open.node);
    await rendered(
      () => rowFor(saved) && rowFor(open.node)?.classList.contains("open"),
      "a pin that is not open and one that is"
    );

    const crossOf = node => rowFor(node).querySelector(".close");
    Assert.equal(
      crossOf(open.node).title,
      "Close tab",
      "an open page is closed"
    );
    Assert.equal(
      crossOf(saved).title,
      "Delete",
      "a pin that is not open is deleted"
    );
    Assert.equal(
      getComputedStyle(crossOf(saved)).visibility,
      "hidden",
      "the cross shows when the pointer is over the row"
    );

    crossOf(open.node).click();
    await rendered(() => !bridge.tab(open.liveTab), "the page is closed");
    Assert.ok(rowFor(open.node), "and its pin stays");
    Assert.equal(app.state.parent(open.node), space.pinnedRoot);
    await rendered(
      () => crossOf(open.node)?.title == "Delete",
      "now it is one that is not open, and its cross deletes"
    );

    crossOf(saved).click();
    await rendered(() => !rowFor(saved), "a pin that is not open is deleted");
    Assert.ok(rowFor(open.node), "the others stay");
    await closeAllTabs(bridge);
  }
);

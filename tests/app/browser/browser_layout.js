/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const byId = id => document.getElementById(id);
const rect = id => byId(id).getBoundingClientRect();

add_task(async function test_the_page_is_a_rounded_card_with_a_margin() {
  await swellApp();
  const content = getComputedStyle(byId("content"));
  Assert.equal(content.borderTopLeftRadius, "10px", "rounded corners");
  Assert.equal(content.overflow, "hidden", "that clip the page");
  Assert.equal(content.marginRight, "10px", "a margin on the right");
  Assert.equal(content.marginBottom, "10px", "and at the bottom");
  Assert.equal(content.marginLeft, "0px", "next to the sidebar");
  Assert.greater(rect("content").left, rect("sidebar").right - 1);
});

add_task(async function test_the_controls_sit_where_the_sidebar_is() {
  await swellApp();
  const row = rect("titlebar-left");
  Assert.equal(Math.round(row.width), Math.round(rect("sidebar").width));
  Assert.less(
    rect("sidebar-toggle").left,
    rect("nav-back").left,
    "the sidebar button is before the page arrows"
  );
  Assert.greater(
    rect("nav-reload").right,
    row.right - 20,
    "the arrows and reload are at the right edge of the sidebar"
  );
  Assert.less(rect("nav-reload").right, row.right + 1);
  const pill = byId("navbar")
    .querySelector(".nav-pill")
    .getBoundingClientRect().width;
  Assert.greaterOrEqual(
    pill,
    rect("sidebar").width - 24,
    "the address pill takes the width of the sidebar"
  );
});

add_task(async function test_new_tab_is_above_the_open_tabs() {
  await swellApp();
  const newTab = byId("new-tab");
  Assert.ok(byId("today-section").contains(newTab), "it is in the list");
  Assert.less(
    newTab.getBoundingClientRect().bottom,
    rect("today").top + 1,
    "above the tabs"
  );
  Assert.ok(!byId("sidebar-footer").contains(newTab), "not in the footer");
});

add_task(async function test_the_sidebar_is_hidden_and_shown_by_its_button() {
  const { app } = await swellApp();
  const width = rect("sidebar").width;
  const left = rect("content").left;
  const top = rect("content").top;
  Assert.ok(!app.sidebarLayout.collapsed);
  byId("sidebar-toggle").click();
  Assert.ok(app.sidebarLayout.collapsed, "hidden");
  await TestUtils.waitForCondition(
    () => getComputedStyle(byId("sidebar")).visibility == "hidden",
    "the sidebar slides out of the way"
  );
  Assert.less(rect("content").left, left, "the page takes the room");
  Assert.equal(rect("content").top, top, "the top margin stays the same");
  Assert.equal(
    getComputedStyle(byId("sidebar-toggle")).visibility,
    "hidden",
    "the button goes with the sidebar"
  );
  Assert.equal(getComputedStyle(byId("nav-buttons")).visibility, "hidden");
  app.sidebarLayout.toggle();
  Assert.ok(!app.sidebarLayout.collapsed, "shown again");
  Assert.equal(rect("sidebar").width, width);
  Assert.equal(rect("content").top, top);
});

add_task(async function test_a_hidden_sidebar_floats_back_at_the_left_edge() {
  const { app } = await swellApp();
  const sidebar = byId("sidebar");
  const top = rect("content").top;
  const left = rect("content").left;
  app.sidebarLayout.toggle();
  await TestUtils.waitForCondition(
    () => getComputedStyle(sidebar).visibility == "hidden",
    "the sidebar slides out of the way"
  );
  const edge = byId("sidebar-peek-edge");
  Assert.equal(getComputedStyle(edge).display, "block", "there is a hot edge");

  edge.dispatchEvent(new MouseEvent("mouseenter"));
  Assert.ok(document.documentElement.hasAttribute("sidebar-peek"));
  Assert.equal(getComputedStyle(sidebar).position, "fixed", "it floats");
  Assert.equal(getComputedStyle(sidebar).visibility, "visible");
  Assert.equal(
    getComputedStyle(sidebar).borderTopLeftRadius,
    getComputedStyle(byId("content")).borderTopLeftRadius,
    "the floating sidebar and the page are cards of the same shape"
  );
  Assert.ok(
    getComputedStyle(sidebar).transitionDuration.includes("0.2s"),
    "it slides"
  );
  Assert.equal(
    getComputedStyle(sidebar).transitionTimingFunction,
    "ease",
    "with an ease"
  );
  Assert.ok(
    rect("content").left < left && rect("content").top == top,
    "the page does not move"
  );
  Assert.equal(
    getComputedStyle(byId("sidebar-toggle")).visibility,
    "visible",
    "the button is there to keep it open"
  );
  Assert.equal(getComputedStyle(byId("nav-buttons")).visibility, "visible");
  for (const id of ["sidebar-toggle", "nav-back", "nav-reload"]) {
    const box = byId(id).getBoundingClientRect();
    const hit = document.elementFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2
    );
    Assert.ok(
      hit == byId(id) || byId(id).contains(hit),
      `${id} is on top of the floating sidebar, not under it`
    );
  }

  await TestUtils.waitForCondition(
    () => Math.round(rect("sidebar").left) == 0,
    "it settles flush with the window's left edge"
  );
  const stripHeight =
    Services.appinfo.OS == "Darwin" ? 0 : rect("titlebar").height;
  Assert.equal(
    Math.round(window.innerHeight - rect("sidebar").bottom),
    0,
    "down to the bottom of the window"
  );
  Assert.equal(
    Math.round(rect("sidebar").top),
    Math.round(stripHeight),
    "and from the top of the window, under the strip where there is one"
  );

  sidebar.dispatchEvent(new MouseEvent("mouseenter"));
  sidebar.dispatchEvent(
    new MouseEvent("mouseleave", { clientX: 300, clientY: 300 })
  );
  sidebar.dispatchEvent(new MouseEvent("mouseenter"));
  await new Promise(resolve => requestAnimationFrame(resolve));
  Assert.ok(
    document.documentElement.hasAttribute("sidebar-peek"),
    "coming back in time keeps it"
  );

  sidebar.dispatchEvent(
    new MouseEvent("mouseleave", { clientX: 300, clientY: 300 })
  );
  await TestUtils.waitForCondition(
    () => !document.documentElement.hasAttribute("sidebar-peek"),
    "it goes when the pointer has left"
  );
  await TestUtils.waitForCondition(
    () => getComputedStyle(sidebar).visibility == "hidden",
    "and is out of the way once it has slid"
  );

  edge.dispatchEvent(new MouseEvent("mouseenter"));
  byId("sidebar-toggle").click();
  Assert.ok(!app.sidebarLayout.collapsed, "the button pins it open");
  Assert.ok(!document.documentElement.hasAttribute("sidebar-peek"));
  Assert.equal(getComputedStyle(sidebar).position, "static");
});

add_task(async function test_the_sidebar_is_resized_by_dragging_its_edge() {
  const { app } = await swellApp();
  const edge = rect("sidebar-resizer");
  const y = edge.top + 200;
  const startX = edge.left + edge.width / 2;
  EventUtils.synthesizeMouseAtPoint(startX, y, { type: "mousedown" }, window);
  EventUtils.synthesizeMouseAtPoint(340, y, { type: "mousemove" }, window);
  EventUtils.synthesizeMouseAtPoint(340, y, { type: "mouseup" }, window);
  Assert.equal(rect("sidebar").width, 340, "wider");
  Assert.equal(
    Services.xulStore.getValue(
      "chrome://swell/content/window.xhtml",
      "swell-window",
      "sidebarwidth"
    ),
    "340",
    "and remembered"
  );

  const grown = rect("sidebar-resizer");
  EventUtils.synthesizeMouseAtPoint(
    grown.left + 3,
    y,
    { type: "mousedown" },
    window
  );
  EventUtils.synthesizeMouseAtPoint(20, y, { type: "mousemove" }, window);
  EventUtils.synthesizeMouseAtPoint(20, y, { type: "mouseup" }, window);
  Assert.equal(rect("sidebar").width, 180, "not narrower than a minimum");

  byId("sidebar-resizer").dispatchEvent(new MouseEvent("dblclick"));
  Assert.equal(rect("sidebar").width, 264, "a double click resets it");
  Assert.ok(app);
});

add_task(async function test_buttons_use_iconoir_icons() {
  await swellApp();
  for (const [id, icon] of [
    ["nav-back", "nav-arrow-left"],
    ["nav-forward", "nav-arrow-right"],
    ["nav-reload", "refresh"],
    ["nav-copy", "link"],
    ["sidebar-toggle", "transition-right"],
  ]) {
    const mask = getComputedStyle(byId(id), "::before").maskImage;
    Assert.ok(mask.includes(`icons/${icon}.svg`), `${id} shows ${icon}`);
    Assert.equal(byId(id).textContent.trim(), "", `${id} has no text glyph`);
    const response = await fetch(`chrome://swell/content/icons/${icon}.svg`);
    Assert.ok(response.ok, `${icon}.svg is packaged`);
  }
  const { app } = await swellApp();
  app.sidebarLayout.toggle();
  byId("sidebar-peek-edge").dispatchEvent(new MouseEvent("mouseenter"));
  Assert.ok(
    getComputedStyle(byId("sidebar-toggle"), "::before").maskImage.includes(
      "transition-right.svg"
    ),
    "the sidebar button has the same icon when the sidebar floats"
  );
  Assert.equal(
    getComputedStyle(byId("sidebar-toggle"), "::before").transform,
    "matrix(-1, 0, 0, 1, 0, 0)",
    "turned the other way round"
  );
  byId("sidebar-toggle").click();
});

add_task(async function test_macos_reserves_room_for_the_window_buttons() {
  if (Services.appinfo.OS != "Darwin") {
    return;
  }
  await swellApp();
  const box = rect("window-buttons-box");
  Assert.greater(
    box.width,
    40,
    "the window button box has the size of the buttons"
  );
  Assert.greater(box.height, 8);
  Assert.less(
    box.right,
    rect("sidebar-toggle").left + 1,
    "before the sidebar button"
  );
});

add_task(async function test_the_window_is_dragged_by_its_margins() {
  await swellApp();
  const css = await (await fetch("chrome://swell/content/window.css")).text();
  Assert.ok(
    /html,\s*body \{[^}]*-moz-window-dragging: drag/s.test(css),
    "the window background drags the window"
  );
  Assert.ok(
    /#content,[^{]*button,[^{]*\{\s*-moz-window-dragging: no-drag/s.test(css),
    "the page and what is clickable do not"
  );
  Assert.ok(
    !/(^|\n)#sidebar,\s*[^{]*\{\s*-moz-window-dragging: no-drag/.test(css),
    "the sidebar as a whole does not either, so that its top part drags"
  );
});

add_task(async function test_the_window_buttons_belong_to_the_sidebar() {
  if (Services.appinfo.OS != "Darwin") {
    return;
  }
  const { app } = await swellApp();
  const box = byId("window-buttons-box");
  Assert.notEqual(getComputedStyle(box).display, "none", "shown with it");
  app.sidebarLayout.toggle();
  Assert.equal(
    getComputedStyle(box).display,
    "none",
    "no room for them when the sidebar is hidden, so macOS hides them"
  );
  byId("sidebar-peek-edge").dispatchEvent(new MouseEvent("mouseenter"));
  Assert.notEqual(getComputedStyle(box).display, "none", "back with it");
  Assert.greaterOrEqual(
    box.getBoundingClientRect().left,
    rect("sidebar").left,
    "inside the floating sidebar"
  );
  app.sidebarLayout.toggle();
});

add_task(
  async function test_the_sidebar_stays_when_the_pointer_leaves_the_window() {
    const { app } = await swellApp();
    const root = document.documentElement;
    app.sidebarLayout.toggle();
    const edge = byId("sidebar-peek-edge");
    edge.dispatchEvent(new MouseEvent("mouseenter"));
    edge.dispatchEvent(
      new MouseEvent("mouseleave", { clientX: -1, clientY: 300 })
    );
    // A delay longer than the one that hides it.
    // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
    await new Promise(resolve => setTimeout(resolve, 600));
    Assert.ok(root.hasAttribute("sidebar-peek"), "it stays at the border");

    edge.dispatchEvent(
      new MouseEvent("mouseleave", { clientX: 200, clientY: 300 })
    );
    await TestUtils.waitForCondition(
      () => !root.hasAttribute("sidebar-peek"),
      "it goes when the pointer moves on over the page"
    );
    app.sidebarLayout.toggle();
  }
);

add_task(async function test_holding_accel_s_shows_the_sidebar_while_held() {
  const { app } = await swellApp();
  const root = document.documentElement;
  app.sidebarLayout.toggle();

  EventUtils.synthesizeKey("s", { accelKey: true, type: "keydown" }, window);
  await TestUtils.waitForCondition(
    () => root.hasAttribute("sidebar-peek"),
    "held, the sidebar floats in"
  );
  EventUtils.synthesizeKey("s", { accelKey: true, type: "keyup" }, window);
  Assert.ok(!root.hasAttribute("sidebar-peek"), "and goes when released");
  Assert.ok(app.sidebarLayout.collapsed, "without having been shown for good");

  EventUtils.synthesizeKey("s", { accelKey: true, type: "keydown" }, window);
  EventUtils.synthesizeKey("s", { accelKey: true, type: "keyup" }, window);
  Assert.ok(!app.sidebarLayout.collapsed, "a tap shows it for good");
  EventUtils.synthesizeKey("s", { accelKey: true, type: "keydown" }, window);
  EventUtils.synthesizeKey("s", { accelKey: true, type: "keyup" }, window);
  Assert.ok(app.sidebarLayout.collapsed, "and another hides it");
  app.sidebarLayout.toggle();
});

add_task(
  async function test_a_floating_sidebars_top_is_not_cancelled_by_the_page() {
    await swellApp();
    const css = await (await fetch("chrome://swell/content/window.css")).text();
    Assert.ok(
      /\[sidebar-peek\] #content \{\s*-moz-window-dragging: default/.test(css),
      "the page is not a no-drag area as a whole while the sidebar floats"
    );
    Assert.ok(
      /\[sidebar-peek\] #content::before \{[^}]*-moz-window-dragging: no-drag/s.test(
        css
      ),
      "only the part to the right of the sidebar is"
    );
  }
);

add_task(async function test_the_sidebar_is_laid_out_like_arcs() {
  const { app } = await swellApp();
  const style = id => getComputedStyle(byId(id));

  Assert.equal(
    byId("pinned-section").querySelector(".heading").offsetParent,
    null,
    "the sections have no headings"
  );

  const space = await freshSpace(app, "Like Arc");
  const tab = await savedTab(
    app.core,
    space,
    space.pinnedRoot,
    `${BASE}file_blank.html`,
    "A tab"
  );
  await rendered(() => rowFor(tab), "the tab shows");
  Assert.equal(rowFor(tab).getBoundingClientRect().height, 40, "tall rows");
  Assert.equal(getComputedStyle(rowFor(tab)).borderTopLeftRadius, "12px");

  Assert.equal(style("favorites").display, "none", "no favorites, no gap");
  byId("sidebar").classList.add("tab-dragging");
  Assert.equal(style("favorites").display, "grid", "a place to drop one");
  Assert.equal(
    style("favorites").gridTemplateColumns.split(" ").length,
    3,
    "favorites are three to a row"
  );
  byId("sidebar").classList.remove("tab-dragging");

  rowFor(tab).dispatchEvent(
    new MouseEvent("contextmenu", { bubbles: true, clientX: 30, clientY: 200 })
  );
  const add = [...document.querySelectorAll("#menu button")].find(
    b => b.textContent == "Add to favorites"
  );
  Assert.ok(add, "a saved tab can be made a favorite");
  add.click();
  await rendered(
    () => byId("favorites").querySelector(`[data-id="${CSS.escape(tab)}"]`),
    "it becomes a tile at the top"
  );
  Assert.equal(style("favorites").display, "grid");
  Assert.ok(!rowFor(tab), "and leaves the list");
});

add_task(async function test_the_bottom_bar_has_downloads_and_new_space() {
  await swellApp();
  Assert.ok(!byId("more"), "the three dots are gone");
  Assert.ok(
    getComputedStyle(byId("downloads-button"), "::before").maskImage.includes(
      "download.svg"
    )
  );
  Assert.less(
    byId("downloads-button").getBoundingClientRect().right,
    rect("spaces").left + 1,
    "downloads at the left"
  );
  Assert.greater(
    byId("space-add").getBoundingClientRect().left,
    rect("spaces").right - 1,
    "new space at the right"
  );
  byId("downloads-button").click();
  await TestUtils.waitForCondition(
    () => byId("downloads-dialog").open,
    "it shows the downloads"
  );
  byId("downloads-close").click();
});

add_task(
  async function test_the_system_menu_bar_has_what_the_sidebar_has_not() {
    await swellApp();
    const bar = byId("main-menubar");
    const labels = [...bar.querySelectorAll(":scope > menu")].map(m =>
      m.getAttribute("label")
    );
    Assert.deepEqual(labels, ["Swell", "File", "View", "Tools"]);
    const tools = [...bar.querySelectorAll("#tools-menu menuitem")].map(
      m => m.dataset.action
    );
    Assert.deepEqual(tools, [
      "downloads",
      "extensions",
      "passwords",
      "autofill",
      "import-arc",
    ]);
    const item = bar.querySelector('[data-action="downloads"]');
    item.dispatchEvent(new CustomEvent("command", { bubbles: true }));
    await TestUtils.waitForCondition(
      () => byId("downloads-dialog").open,
      "an item does what it says"
    );
    byId("downloads-close").click();

    bar
      .querySelector('[data-action="new-space"]')
      .dispatchEvent(new CustomEvent("command", { bubbles: true }));
    Assert.ok(byId("space-dialog").open, "New Space opens the editor");
    byId("space-cancel").click();
  }
);

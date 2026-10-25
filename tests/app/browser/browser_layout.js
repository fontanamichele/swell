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
  Assert.equal(content.marginRight, "8px", "a margin on the right");
  Assert.equal(content.marginBottom, "8px", "and at the bottom");
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
  const pill = rect("nav-address").width + rect("nav-copy").width;
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
  Assert.ok(!app.sidebarLayout.collapsed);
  byId("sidebar-toggle").click();
  Assert.ok(app.sidebarLayout.collapsed, "hidden");
  Assert.equal(getComputedStyle(byId("sidebar")).display, "none");
  Assert.less(rect("content").left, left, "the page takes the room");
  Assert.equal(byId("sidebar-toggle").getAttribute("aria-expanded"), "false");
  Assert.notEqual(
    getComputedStyle(byId("sidebar-toggle")).display,
    "none",
    "the button stays"
  );
  Assert.equal(getComputedStyle(byId("nav-buttons")).display, "none");
  byId("sidebar-toggle").click();
  Assert.ok(!app.sidebarLayout.collapsed, "shown again");
  Assert.equal(rect("sidebar").width, width);
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

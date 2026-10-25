/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_links.html`;

const item = action =>
  document.querySelector(`#main-menubar menuitem[data-action="${action}"]`);

function choose(action) {
  item(action).dispatchEvent(new CustomEvent("command", { bubbles: true }));
}

add_task(async function test_select_all_and_copy_work_on_the_page() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Edit menu");
  const tab = await openInSpace(bridge, space.id, PAGE);
  tab.browser.focus();
  await SpecialPowers.spawn(tab.browser, [], () => content.focus());

  const expected = await SpecialPowers.spawn(tab.browser, [], () =>
    content.document.body.innerText.trim()
  );
  SpecialPowers.clipboardCopyString("sentinel");
  choose("edit:cmd_selectAll");
  choose("edit:cmd_copy");
  await rendered(
    () => SpecialPowers.getClipboardData("text/plain") != "sentinel",
    "Copy replaced the clipboard"
  );
  Assert.equal(
    SpecialPowers.getClipboardData("text/plain").replace(/\s+/g, " ").trim(),
    expected.replace(/\s+/g, " "),
    "Select All and Copy put the text of the page on the clipboard"
  );
  await closeAllTabs(bridge);
});

add_task(
  async function test_find_opens_the_find_bar_and_the_window_menu_exists() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Find menu");
    const tab = await openInSpace(bridge, space.id, PAGE);

    choose("find");
    await rendered(
      () => tab.findbar && !tab.findbarSlot.hidden,
      "find bar opens"
    );
    await rendered(
      () => tab.findbar.getBoundingClientRect().width > 300,
      "the find bar is laid out with its field and options"
    );
    const bar = tab.findbar.getBoundingClientRect();
    const page = document.getElementById("pages").getBoundingClientRect();
    Assert.greater(bar.width, 300, "the find bar holds its field and options");
    Assert.less(
      Math.abs(bar.left + bar.width / 2 - (page.left + page.width / 2)),
      4,
      "it floats in the middle of the page"
    );
    Assert.greater(bar.bottom, page.bottom - 80, "near the bottom");
    Assert.ok(item("find-next") && item("find-previous"), "find again items");
    Assert.ok(item("minimize") && item("zoom-window"), "window menu items");
    await closeAllTabs(bridge);
  }
);

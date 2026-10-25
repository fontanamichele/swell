/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const FIRST = `${BASE}file_blank.html`;
const SECOND = `${BASE}file_links.html`;

const button = id => document.getElementById(id);

add_task(async function test_the_controls_follow_the_page_in_front() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Nav");
  const tab = await openInSpace(bridge, space.id, FIRST);
  bridge.selectTab(tab.liveTab);
  await rendered(() => app.selectedTab?.url == FIRST, "the page is in front");
  await rendered(
    () => button("nav-address").textContent == "example.com",
    "the pill shows the host"
  );
  Assert.ok(button("nav-back").disabled, "nothing to go back to");
  Assert.ok(button("nav-forward").disabled, "or forward to");
  Assert.ok(!button("nav-reload").disabled);
  Assert.equal(
    button("nav-address").title,
    FIRST,
    "the whole address on hover"
  );

  tab.browser.fixupAndLoadURIString(SECOND, {
    triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal(),
  });
  await rendered(
    () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
    "the second page loads"
  );
  await rendered(() => !button("nav-back").disabled, "back is on");
  Assert.ok(button("nav-forward").disabled);

  button("nav-back").click();
  await rendered(
    () => app.selectedTab?.url == FIRST && !app.selectedTab.loading,
    "back goes back"
  );
  await rendered(() => !button("nav-forward").disabled, "forward is on");
  button("nav-forward").click();
  await rendered(
    () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
    "forward goes forward"
  );

  button("nav-reload").click();
  await rendered(
    () => app.selectedTab?.url == SECOND && !app.selectedTab.loading,
    "reload keeps the page"
  );
  await closeAllTabs(bridge);
  await rendered(() => button("nav-back").disabled, "nothing left in front");
  Assert.equal(button("nav-address").textContent, "Search or enter address");
  Assert.ok(button("nav-copy").disabled);
});

add_task(async function test_the_pill_opens_the_command_bar_and_copy_copies() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Nav pill");
  const tab = await openInSpace(bridge, space.id, FIRST);
  bridge.selectTab(tab.liveTab);
  await rendered(() => app.selectedTab?.url == FIRST, "the page is in front");

  button("nav-address").click();
  Assert.ok(app.commandBar.isOpen, "the command bar opens");
  Assert.equal(
    document.getElementById("commandbar-input").value,
    FIRST,
    "on the address of the page"
  );
  app.commandBar.close();

  await SimpleTest.promiseClipboardChange(FIRST, () =>
    button("nav-copy").click()
  );
  await closeAllTabs(bridge);
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PAGE = `${BASE}file_blank.html`;

const shownFrame = () =>
  [
    ...document.querySelectorAll(
      ".dialogStack:not([inactive], [hidden]) .dialogFrame"
    ),
  ].find(
    frame =>
      frame.contentDocument?.documentURI ==
      "chrome://global/content/commonDialog.xhtml"
  );

async function shownDialog() {
  let dialog;
  await rendered(() => {
    dialog = shownFrame()?.contentDocument?.getElementById("commonDialog");
    return dialog && dialog.ownerDocument.readyState == "complete";
  }, "a dialog is shown over the page");
  // Being in the document is not being seen: it needs a size and to be visible.
  await rendered(() => {
    const box = shownFrame().closest(".dialogBox").getBoundingClientRect();
    return box.width > 150 && box.height > 60;
  }, "the dialog has a size");
  const overlay = shownFrame().closest(".dialogOverlay");
  Assert.equal(
    getComputedStyle(overlay).visibility,
    "visible",
    "the dialog is not hidden"
  );
  return dialog;
}

// Calls `code` in the page from a timer, so that the dialog does not block the test.
async function callInPage(tab, code) {
  await SpecialPowers.spawn(tab.browser, [code], source => {
    content.setTimeout(() => {
      const run = new content.Function("result", source);
      run(value => {
        content.document.title = String(value);
      });
    }, 0);
  });
}

const pageTitle = tab =>
  SpecialPowers.spawn(tab.browser, [], () => content.document.title);

add_task(
  async function test_alert_confirm_and_prompt_are_answered_in_the_window() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Dialogs");
    const tab = await openInSpace(bridge, space.id, PAGE);

    await callInPage(tab, "alert('hello'); result('after alert');");
    let dialog = await shownDialog();
    Assert.equal(
      dialog.ownerDocument.getElementById("infoBody").textContent,
      "hello",
      "the dialog shows the message of the page"
    );
    dialog.acceptDialog();
    await rendered(async () => (await pageTitle(tab)) == "after alert");

    await callInPage(tab, "result(confirm('sure?'));");
    dialog = await shownDialog();
    dialog.cancelDialog();
    await rendered(async () => (await pageTitle(tab)) == "false");

    await callInPage(tab, "result(prompt('name?', 'x'));");
    dialog = await shownDialog();
    dialog.ownerDocument.getElementById("loginTextbox").value = "swell";
    dialog.acceptDialog();
    await rendered(async () => (await pageTitle(tab)) == "swell");

    await closeAllTabs(bridge);
  }
);

add_task(async function test_a_dialog_belongs_to_its_tab() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Dialogs two");
  const first = await openInSpace(bridge, space.id, PAGE);
  await callInPage(first, "result(confirm('first?'));");
  const dialog = await shownDialog();

  const second = await openInSpace(bridge, space.id, PAGE);
  await rendered(
    () => bridge.selectedTab === second && !shownFrame(),
    "another tab in front shows no dialog"
  );

  bridge.selectTab(first.liveTab);
  await rendered(() => shownFrame(), "the dialog is back with its tab");
  dialog.acceptDialog();
  await rendered(async () => (await pageTitle(first)) == "true");

  await callInPage(first, "result(confirm('closing'));");
  await shownDialog();
  await bridge.closeTab(first.liveTab);
  Assert.equal(
    document.querySelectorAll(".dialogStack").length,
    0,
    "closing the tab removes its dialogs"
  );

  await closeAllTabs(bridge);
});

add_task(async function test_http_authentication_asks_in_the_window() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Dialogs auth");
  // The page does not load until the prompt is answered.
  const liveTab = await bridge.openUrl(`${BASE}file_auth.sjs`, space.id);
  const tab = await rendered(() => bridge.tab(liveTab), "the tab appears");
  const dialog = await shownDialog();
  Assert.ok(
    dialog.ownerDocument.getElementById("loginContainer"),
    "the authentication dialog has a user name and a password"
  );
  dialog.cancelDialog();
  await rendered(
    async () =>
      (await SpecialPowers.spawn(
        tab.browser,
        [],
        () => content.document.body.textContent
      )) == "unauthorized",
    "cancelling shows the 401 page"
  );

  await closeAllTabs(bridge);
});

add_task(
  async function test_a_page_that_asks_before_it_goes_can_keep_its_tab() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Dialogs unload");
    const tab = await openInSpace(
      bridge,
      space.id,
      `${BASE}file_beforeunload.html`
    );
    // A page only gets to ask after the user has used it.
    await SpecialPowers.spawn(tab.browser, [], () => {
      content.document.notifyUserGestureActivation();
    });
    await rendered(() => tab.browser.hasBeforeUnload, "the page registered it");

    const closing = bridge.closeTab(tab.liveTab);
    const dialog = await shownDialog();
    dialog.cancelDialog();
    await closing;
    Assert.ok(bridge.tab(tab.liveTab), "Stay keeps the tab");

    const again = bridge.closeTab(tab.liveTab);
    const second = await shownDialog();
    second.acceptDialog();
    await again;
    await rendered(() => !bridge.tab(tab.liveTab), "Leave closes it");
    await closeAllTabs(bridge);
  }
);

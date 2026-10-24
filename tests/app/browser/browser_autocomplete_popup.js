/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Form history, saved logins and autofill all offer their entries in the
// toolkit's autocomplete popup, which the window has to provide.

ChromeUtils.defineESModuleGetters(this, {
  FormHistory: "resource://gre/modules/FormHistory.sys.mjs",
  FormHistoryTestUtils:
    "resource://testing-common/FormHistoryTestUtils.sys.mjs",
});

const FORM = `${BASE}file_form.html`;
const popup = () => document.getElementById("PopupAutoComplete");

async function type(tab, text) {
  tab.browser.focus();
  await SpecialPowers.spawn(tab.browser, [], () =>
    content.document.getElementById("field").focus()
  );
  for (const ch of text) {
    await BrowserTestUtils.sendChar(ch, tab.browser);
  }
}

add_setup(async () => {
  await FormHistoryTestUtils.clear("swellfield");
  registerCleanupFunction(() => FormHistoryTestUtils.clear("swellfield"));
});

add_task(async function test_the_popup_offers_form_history_of_the_space() {
  const { bridge, app } = await swellApp();
  const a = await freshSpace(app, "Popup A");
  const b = await freshSpace(app, "Popup B");
  await FormHistory.update({
    op: "add",
    fieldname: "swellfield",
    value: "swellvalue",
    userContextId: a.userContextId,
  });

  const tabA = await openInSpace(bridge, a.id, FORM);
  await app.switchSpace(a.id);
  await TestUtils.waitForCondition(() => bridge.selectedTab === tabA, "A");
  await type(tabA, "sw");
  await TestUtils.waitForCondition(
    () => popup().popupOpen,
    "the autocomplete popup opens for a value of the space"
  );
  Assert.equal(popup().view.matchCount, 1, "one suggestion");
  Assert.equal(popup().view.getValueAt(0), "swellvalue");

  await closeAllTabs(bridge);

  const tabB = await openInSpace(bridge, b.id, FORM);
  await app.switchSpace(b.id);
  await TestUtils.waitForCondition(() => bridge.selectedTab === tabB, "B");
  await type(tabB, "sw");
  await new Promise(resolve => setTimeout(resolve, 500));
  Assert.ok(!popup().popupOpen, "nothing is offered in another space");
  await closeAllTabs(bridge);
});

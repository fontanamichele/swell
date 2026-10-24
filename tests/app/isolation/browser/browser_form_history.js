/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Values typed into a form are suggested again only in the space where they
// were typed (patch 0210).

ChromeUtils.defineESModuleGetters(this, {
  FormHistory: "resource://gre/modules/FormHistory.sys.mjs",
  FormHistoryTestUtils:
    "resource://testing-common/FormHistoryTestUtils.sys.mjs",
});

const FORM = `${BASE}file_form.html`;

async function suggestionsFor(tab) {
  const actor =
    tab.browser.browsingContext.currentWindowGlobal.getActor("FormHistory");
  const { formHistoryEntries } = await actor.searchAutoCompleteEntries(
    "swell",
    {
      inputName: "swellfield",
    }
  );
  return formHistoryEntries.map(entry => entry.text);
}

add_setup(async () => {
  await FormHistoryTestUtils.clear("swellfield");
  registerCleanupFunction(() => FormHistoryTestUtils.clear("swellfield"));
});

add_task(async function test_form_history() {
  const { a, b, bridge } = await pair();
  const formA = await openInSpace(bridge, a.id, FORM);
  bridge.selectTab(formA.liveTab);
  formA.browser.focus();
  await SpecialPowers.spawn(formA.browser, [], () =>
    content.document.getElementById("field").focus()
  );
  for (const ch of "swellvalue") {
    await BrowserTestUtils.sendChar(ch, formA.browser);
  }
  const loaded = BrowserTestUtils.browserLoaded(formA.browser);
  await SpecialPowers.spawn(formA.browser, [], () =>
    content.document.getElementById("submit").click()
  );
  await loaded;
  await TestUtils.waitForCondition(
    async () => (await FormHistoryTestUtils.count("swellfield")) > 0,
    "the submitted value is saved in form history"
  );

  const rows = await FormHistory.search(["value", "userContextId"], {
    fieldname: "swellfield",
  });
  Assert.deepEqual(
    rows,
    [{ value: "swellvalue", userContextId: a.userContextId }],
    "the entry remembers its container"
  );

  const formA2 = await openInSpace(bridge, a.id, FORM);
  Assert.deepEqual(
    await suggestionsFor(formA2),
    ["swellvalue"],
    "the space where it was typed is offered the value"
  );
  const formB = await openInSpace(bridge, b.id, FORM);
  const inB = await suggestionsFor(formB);
  audit(
    "form history",
    !inB.length,
    `space B is offered ${JSON.stringify(inB)}`
  );
  await closeAllTabs(bridge);
});

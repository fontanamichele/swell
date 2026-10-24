/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  OSKeyStoreTestUtils: "resource://testing-common/OSKeyStoreTestUtils.sys.mjs",
  autofillStorageFor: "moz-src:///swell/app/modules/Autofill.sys.mjs",
});

const FORM = `${BASE}file_address_form.html`;
const bar = () => document.getElementById("autofill-bar");

async function typeInto(tab, id, text) {
  tab.browser.focus();
  await SpecialPowers.spawn(tab.browser, [id], inputId =>
    content.document.getElementById(inputId).focus()
  );
  for (const ch of text) {
    await BrowserTestUtils.sendChar(ch, tab.browser);
  }
}

async function fillAndSubmit(tab) {
  await typeInto(tab, "name", "Swell Tester");
  await typeInto(tab, "street", "1 Main Street");
  await typeInto(tab, "city", "Springfield");
  await typeInto(tab, "state", "IL");
  await typeInto(tab, "zip", "62701");
  await typeInto(tab, "email", "tester@swell.test");
  await SpecialPowers.spawn(tab.browser, [], () => {
    const country = content.document.getElementById("country");
    country.value = "US";
    country.dispatchEvent(new content.Event("input", { bubbles: true }));
    country.dispatchEvent(new content.Event("change", { bubbles: true }));
    content.document.getElementById("submit").click();
  });
}

add_task(async function test_a_submitted_address_is_offered_for_saving() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Autofill save");
  const tab = await openInSpace(bridge, space.id, FORM);
  await app.switchSpace(space.id);
  await TestUtils.waitForCondition(() => bridge.selectedTab === tab, "tab");
  await fillAndSubmit(tab);
  await TestUtils.waitForCondition(() => !bar().hidden, "the save bar shows");
  Assert.ok(
    bar()
      .querySelector(".autofill-text")
      .textContent.startsWith("Save this address"),
    "it asks about an address"
  );
  document.getElementById("autofill-save").click();
  const storage = await autofillStorageFor(space.userContextId);
  await TestUtils.waitForCondition(
    async () => (await storage.addresses.getAll()).length == 1,
    "the address is saved in the space's storage"
  );
  const [saved] = await storage.addresses.getAll();
  Assert.equal(saved.name, "Swell Tester");
  Assert.equal(saved["postal-code"], "62701");
  await storage.addresses.remove(saved.guid);
  await closeAllTabs(bridge);
});

add_task(async function test_a_submitted_card_is_offered_for_saving() {
  await OSKeyStoreTestUtils.setup();
  registerCleanupFunction(() => OSKeyStoreTestUtils.cleanup());
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Autofill card");
  const tab = await openInSpace(bridge, space.id, `${BASE}file_card_form.html`);
  await app.switchSpace(space.id);
  await TestUtils.waitForCondition(() => bridge.selectedTab === tab, "tab");
  await typeInto(tab, "cc-name", "Swell Tester");
  await typeInto(tab, "cc-number", "4111111111111111");
  await typeInto(tab, "cc-month", "12");
  await typeInto(tab, "cc-year", "2031");
  await SpecialPowers.spawn(tab.browser, [], () =>
    content.document.getElementById("submit").click()
  );
  await TestUtils.waitForCondition(() => !bar().hidden, "the save bar shows");
  Assert.ok(
    bar()
      .querySelector(".autofill-text")
      .textContent.startsWith("Save this card"),
    "it asks about a card"
  );
  document.getElementById("autofill-save").click();
  const storage = await autofillStorageFor(space.userContextId);
  await TestUtils.waitForCondition(
    async () => (await storage.creditCards.getAll()).length == 1,
    "the card is saved in the space's storage"
  );
  const [card] = await storage.creditCards.getAll();
  Assert.equal(card["cc-name"], "Swell Tester");
  Assert.ok(
    !JSON.stringify(card).includes("4111111111111111"),
    "the number is not kept in the clear"
  );
  Assert.ok(card["cc-number-encrypted"], "it is kept encrypted");
  await storage.creditCards.remove(card.guid);
  await closeAllTabs(bridge);
});

add_task(async function test_not_now_and_other_tabs_save_nothing() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Autofill later");
  const tab = await openInSpace(bridge, space.id, FORM);
  await app.switchSpace(space.id);
  await TestUtils.waitForCondition(() => bridge.selectedTab === tab, "tab");
  await fillAndSubmit(tab);
  await TestUtils.waitForCondition(() => !bar().hidden, "the save bar shows");
  document.getElementById("autofill-later").click();
  Assert.ok(bar().hidden, "the bar goes away");
  const storage = await autofillStorageFor(space.userContextId);
  // A wait for something that must not happen has no event to listen for.
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 300));
  Assert.equal((await storage.addresses.getAll()).length, 0, "nothing saved");
  await closeAllTabs(bridge);
});

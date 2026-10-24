/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Saved addresses are offered only in the space that saved them: each space
// has a storage and a file of its own (patch 0211).

ChromeUtils.defineESModuleGetters(this, {
  OSKeyStoreTestUtils: "resource://testing-common/OSKeyStoreTestUtils.sys.mjs",
  autofillStorageFor: "moz-src:///swell/app/modules/Autofill.sys.mjs",
});

const FORM = `${BASE}file_address_form.html`;
const ADDRESS = {
  name: "Swell Tester",
  organization: "Swell",
  "street-address": "1 Main Street",
  "address-level2": "Springfield",
  "address-level1": "IL",
  "postal-code": "62701",
  country: "US",
  email: "tester@swell.test",
  tel: "+12175550100",
};

const fileFor = userContextId =>
  PathUtils.join(
    PathUtils.profileDir,
    `autofill-profiles-${userContextId}.json`
  );

async function offered(tab) {
  const actor =
    tab.browser.browsingContext.currentWindowGlobal.getActor("FormAutofill");
  const records = await actor.getRecords({
    searchString: "",
    fieldName: "name",
  });
  return records.map(record => record.name);
}

add_task(async function test_addresses_are_per_space() {
  const { a, b, bridge } = await pair();
  const storage = await autofillStorageFor(a.userContextId);
  const guid = await storage.addresses.add(ADDRESS);
  await storage._saveImmediately();
  registerCleanupFunction(async () => {
    await storage.addresses.remove(guid);
    await storage._saveImmediately();
  });

  Assert.ok(
    await IOUtils.exists(fileFor(a.userContextId)),
    "the space keeps its addresses in a file of its own"
  );

  const formA = await openInSpace(bridge, a.id, FORM);
  Assert.deepEqual(
    await offered(formA),
    ["Swell Tester"],
    "the space that saved the address is offered it"
  );
  const formB = await openInSpace(bridge, b.id, FORM);
  const inB = await offered(formB);
  audit("addresses", !inB.length, `space B is offered ${JSON.stringify(inB)}`);
  if (!SHARE_CONTAINER) {
    Assert.ok(
      !(await IOUtils.exists(fileFor(b.userContextId))),
      "the other space has no file"
    );
  }
  await closeAllTabs(bridge);
});

add_task(async function test_cards_are_per_space() {
  await OSKeyStoreTestUtils.setup();
  registerCleanupFunction(() => OSKeyStoreTestUtils.cleanup());
  const { a, b, bridge } = await pair();
  const storage = await autofillStorageFor(a.userContextId);
  const guid = await storage.creditCards.add({
    "cc-name": "Swell Cardholder",
    "cc-number": "4111111111111111",
    "cc-exp-month": 12,
    "cc-exp-year": 2031,
  });
  registerCleanupFunction(() => storage.creditCards.remove(guid));
  const names = async tab =>
    (
      await tab.browser.browsingContext.currentWindowGlobal
        .getActor("FormAutofill")
        .getRecords({
          searchString: "",
          collectionName: "creditCards",
          fieldName: "cc-name",
        })
    ).map(record => record["cc-name"]);
  const inA = await openInSpace(bridge, a.id, FORM);
  Assert.deepEqual(await names(inA), ["Swell Cardholder"], "offered in A");
  const inB = await names(await openInSpace(bridge, b.id, FORM));
  audit(
    "credit cards",
    !inB.length,
    `space B is offered ${JSON.stringify(inB)}`
  );
  await closeAllTabs(bridge);
});

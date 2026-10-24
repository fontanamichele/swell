/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  OSKeyStoreTestUtils: "resource://testing-common/OSKeyStoreTestUtils.sys.mjs",
  autofillStorageFor: "moz-src:///swell/app/modules/Autofill.sys.mjs",
});

const dialog = () => document.getElementById("autofill-dialog");
const summaries = () =>
  [...dialog().querySelectorAll(".autofill-summary")].map(n => n.textContent);
const button = label =>
  [...dialog().querySelectorAll("button")].find(b => b.textContent == label);

async function submitForm(values) {
  const form = document.getElementById("autofill-form");
  for (const [name, value] of Object.entries(values)) {
    form.querySelector(`input[name="${name}"]`).value = value;
  }
  form.requestSubmit();
}

add_task(
  async function test_the_dialog_manages_the_spaces_addresses_and_cards() {
    await OSKeyStoreTestUtils.setup();
    registerCleanupFunction(() => OSKeyStoreTestUtils.cleanup());
    const { app } = await swellApp();
    const a = await freshSpace(app, "Dialog A");
    const storageA = await autofillStorageFor(a.userContextId);

    await app.autofill.show();
    Assert.ok(dialog().open, "the dialog opens");
    Assert.deepEqual(summaries(), [], "nothing saved yet");

    button("Add address").click();
    await submitForm({
      name: "Dialog Tester",
      "street-address": "2 Side Street",
      "address-level2": "Shelbyville",
      "postal-code": "12345",
      country: "US",
    });
    await TestUtils.waitForCondition(
      () => summaries().length == 1,
      "the address is listed"
    );
    Assert.ok(summaries()[0].includes("Dialog Tester"));
    Assert.equal((await storageA.addresses.getAll()).length, 1, "and stored");

    button("Edit").click();
    await submitForm({ name: "Dialog Renamed" });
    await TestUtils.waitForCondition(
      () => summaries()[0]?.includes("Dialog Renamed"),
      "the edit shows"
    );

    button("Add card").click();
    await submitForm({
      "cc-name": "Dialog Tester",
      "cc-number": "4111111111111111",
      "cc-exp-month": "11",
      "cc-exp-year": "2032",
    });
    await TestUtils.waitForCondition(
      () => summaries().length == 2,
      "the card is listed"
    );
    Assert.ok(summaries()[1].includes("1111"), "by its last digits");
    Assert.ok(!summaries().join().includes("4111111111111111"));

    info("Another space sees none of it");
    const b = await freshSpace(app, "Dialog B");
    await app.autofill.show();
    Assert.deepEqual(summaries(), [], "the other space has nothing");
    document.getElementById("autofill-close").click();

    await app.switchSpace(a.id);
    await TestUtils.waitForCondition(() => app.activeSpaceId == a.id, "A");
    await app.autofill.show();
    for (const label of ["Remove", "Remove"]) {
      button(label).click();
      await TestUtils.waitForCondition(
        () => !button(label) || summaries().length < 2,
        "removed"
      );
    }
    await TestUtils.waitForCondition(
      () => !summaries().length,
      "everything removed"
    );
    document.getElementById("autofill-close").click();
    Assert.ok(!dialog().open, "Close closes it");
    Assert.ok(b);
  }
);

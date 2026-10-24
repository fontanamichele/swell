/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  ExtensionTestCommon: "resource://testing-common/ExtensionTestCommon.sys.mjs",
  copiesOf: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
  installCopy: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
});

const dialog = () => document.getElementById("extensions-dialog");
const prompt = () => document.getElementById("extension-prompt");
const rows = () =>
  [...dialog().querySelectorAll(".extension-row")].map(r => r.textContent);
const button = label =>
  [...dialog().querySelectorAll("button")].find(b => b.textContent == label);

add_setup(() => {
  Services.prefs.setBoolPref("swell.extensions.allowUnsigned", true);
  registerCleanupFunction(() =>
    Services.prefs.clearUserPref("swell.extensions.allowUnsigned")
  );
});

add_task(async function test_the_dialog_manages_the_spaces_add_ons() {
  const { app } = await swellApp();
  const a = await freshSpace(app, "Add-ons A");
  const xpi = await ExtensionTestCommon.generateXPI({
    manifest: {
      name: "Dialog fixture",
      version: "2.0",
      browser_specific_settings: { gecko: { id: "dialogfixture@swell.test" } },
      permissions: ["tabs", "https://example.com/*"],
    },
  });
  await installCopy(xpi, a.userContextId, { prompt: async () => {} });

  await app.extensions.show();
  Assert.ok(dialog().open, "the dialog opens");
  Assert.ok(rows()[0].includes("Dialog fixture 2.0"), "the add-on is listed");

  const b = await freshSpace(app, "Add-ons B");
  await app.extensions.show();
  Assert.ok(
    !rows().some(text => text.includes("Turn off")),
    "space B has none of its own"
  );
  const offered = rows().find(text => text.includes("Add to this space"));
  Assert.ok(offered?.includes("Dialog fixture"), "but is offered the one of A");

  button("Add to this space").click();
  await TestUtils.waitForCondition(
    () => prompt().open,
    "the permissions are shown"
  );
  const permissions = [
    ...prompt().querySelectorAll("#extension-prompt-permissions li"),
  ].map(li => li.textContent);
  Assert.ok(permissions.includes("tabs"), "it lists what the add-on can use");
  document.getElementById("extension-prompt-add").click();
  await TestUtils.waitForCondition(
    () => rows().some(text => text.includes("Turn off")),
    "the add-on is now in space B"
  );
  Assert.equal((await copiesOf(b.userContextId)).length, 1);

  button("Turn off").click();
  await TestUtils.waitForCondition(
    () => rows().some(text => text.includes("Turn on")),
    "it can be turned off"
  );
  button("Turn on").click();
  await TestUtils.waitForCondition(
    () => rows().some(text => text.includes("Turn off")),
    "and on again"
  );

  info("Cancelling the prompt installs nothing");
  button("Remove").click();
  await TestUtils.waitForCondition(
    async () => !(await copiesOf(b.userContextId)).length,
    "removed from space B"
  );
  await TestUtils.waitForCondition(
    () => rows().some(text => text.includes("Add to this space")),
    "it is offered again"
  );
  button("Add to this space").click();
  await TestUtils.waitForCondition(() => prompt().open, "asked again");
  document.getElementById("extension-prompt-cancel").click();
  await TestUtils.waitForCondition(() => !prompt().open, "prompt closed");
  Assert.equal(
    (await copiesOf(b.userContextId)).length,
    0,
    "nothing installed"
  );

  document.getElementById("extensions-close").click();
  for (const copy of await copiesOf(a.userContextId)) {
    await copy.uninstall();
  }
  Assert.ok(!dialog().open, "Close closes it");
});

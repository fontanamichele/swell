/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  LoginHelper: "resource://gre/modules/LoginHelper.sys.mjs",
  deleteLoginsKey: "moz-src:///swell/app/modules/SwellLoginStorage.sys.mjs",
});

const FORM = `${BASE}file_login.html`;
const bar = () => document.getElementById("autofill-bar");
const dialog = () => document.getElementById("passwords-dialog");

async function typeInto(tab, id, text) {
  tab.browser.focus();
  await SpecialPowers.spawn(tab.browser, [id], inputId =>
    content.document.getElementById(inputId).focus()
  );
  for (const ch of text) {
    await BrowserTestUtils.sendChar(ch, tab.browser);
  }
}

async function submitLogin(tab, user, password) {
  await typeInto(tab, "user", user);
  await typeInto(tab, "pass", password);
  await SpecialPowers.spawn(tab.browser, [], () =>
    content.document.getElementById("submit").click()
  );
}

async function inFront(bridge, app, space, url) {
  const tab = await openInSpace(bridge, space.id, url);
  await app.switchSpace(space.id);
  bridge.selectTab(tab.liveTab);
  await TestUtils.waitForCondition(
    () => bridge.selectedTab === tab,
    "the tab is in front"
  );
  return tab;
}

add_setup(async () => {
  Services.prefs.setStringPref(
    "swell.logins.keyLabelPrefix",
    "Swell test logins"
  );
  Services.prefs.setBoolPref("signon.rememberSignons", true);
  registerCleanupFunction(async () => {
    for (let id = 1; id < 40; id++) {
      await deleteLoginsKey(id);
    }
    Services.prefs.clearUserPref("swell.logins.keyLabelPrefix");
    Services.prefs.clearUserPref("signon.rememberSignons");
  });
});

add_task(async function test_a_submitted_login_is_offered_for_saving() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Login save");
  const logins = LoginHelper.loginsFor(space.userContextId);
  const tab = await inFront(bridge, app, space, FORM);
  await submitLogin(tab, "swell-capture@test", "capture-secret");
  await TestUtils.waitForCondition(() => !bar().hidden, "the save bar shows");
  Assert.ok(
    bar()
      .querySelector(".autofill-text")
      .textContent.startsWith("Save the password for swell-capture@test"),
    "it asks about this login"
  );
  document.getElementById("autofill-save").click();
  await TestUtils.waitForCondition(
    async () =>
      (await logins.searchLoginsAsync({ origin: "https://example.com" }))
        .length == 1,
    "the login is saved in the space",
    // The first save makes the space's key in the system keychain.
    100,
    300
  );
  const [saved] = await logins.searchLoginsAsync({
    origin: "https://example.com",
  });
  Assert.equal(saved.username, "swell-capture@test");
  Assert.equal(saved.password, "capture-secret");
  await logins.removeLoginAsync(saved);
  await closeAllTabs(bridge);
});

add_task(async function test_never_for_this_site_is_remembered_for_the_space() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Login never");
  const logins = LoginHelper.loginsFor(space.userContextId);
  registerCleanupFunction(() =>
    logins.setLoginSavingEnabled("https://example.com", true)
  );
  const tab = await inFront(bridge, app, space, FORM);
  await submitLogin(tab, "swell-never@test", "never-secret");
  await TestUtils.waitForCondition(() => !bar().hidden, "the save bar shows");
  document.getElementById("autofill-never").click();
  await TestUtils.waitForCondition(
    () => !logins.getLoginSavingEnabled("https://example.com"),
    "saving is switched off for the site in this space"
  );
  Assert.equal(
    (await logins.searchLoginsAsync({ origin: "https://example.com" })).length,
    0,
    "and nothing was saved"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_the_passwords_dialog_manages_the_spaces_logins() {
  const { app } = await swellApp();
  const a = await freshSpace(app, "Passwords A");
  const summaries = () =>
    [...dialog().querySelectorAll(".password-row")].map(row => row.textContent);
  const button = label =>
    [...dialog().querySelectorAll("button")].find(b => b.textContent == label);
  const submit = values => {
    const form = document.getElementById("passwords-form");
    for (const [name, value] of Object.entries(values)) {
      form.querySelector(`input[name="${name}"]`).value = value;
    }
    form.requestSubmit();
  };

  await app.passwords.show();
  Assert.ok(dialog().open, "the dialog opens");
  Assert.deepEqual(summaries(), [], "nothing saved yet");

  button("Add password").click();
  submit({
    origin: "https://dialog.test",
    username: "dialog-user",
    password: "dialog-secret",
  });
  await TestUtils.waitForCondition(
    () => summaries().length == 1,
    "the login is listed",
    100,
    300
  );
  Assert.ok(summaries()[0].includes("dialog.test"));
  Assert.ok(summaries()[0].includes("dialog-user"));
  Assert.ok(
    !summaries()[0].includes("dialog-secret"),
    "the password is hidden"
  );
  button("Show").click();
  await TestUtils.waitForCondition(
    () => summaries()[0].includes("dialog-secret"),
    "Show reveals it"
  );

  button("Edit").click();
  submit({ username: "dialog-renamed", password: "dialog-secret-2" });
  await TestUtils.waitForCondition(
    () => summaries()[0]?.includes("dialog-renamed"),
    "the edit shows"
  );

  const b = await freshSpace(app, "Passwords B");
  await app.passwords.show();
  Assert.deepEqual(summaries(), [], "the other space has none");
  document.getElementById("passwords-close").click();

  await app.switchSpace(a.id);
  await TestUtils.waitForCondition(() => app.activeSpaceId == a.id, "A");
  await app.passwords.show();
  button("Remove").click();
  await TestUtils.waitForCondition(
    () => !summaries().length,
    "the login is removed"
  );
  document.getElementById("passwords-close").click();
  Assert.ok(!dialog().open, "Close closes it");
  Assert.ok(b);
});

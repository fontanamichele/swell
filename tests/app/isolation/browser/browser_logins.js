/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Saved logins are per space: each space's logins sit in the core under its
// own container, encrypted with a key of its own in the system keychain
// (patch 0220). The tests use keychain items of their own.

ChromeUtils.defineESModuleGetters(this, {
  LoginHelper: "resource://gre/modules/LoginHelper.sys.mjs",
  deleteLoginsKey: "moz-src:///swell/app/modules/SwellLoginStorage.sys.mjs",
});

const FORM = `${BASE}file_login.html`;
const ORIGIN = "https://example.com";

function newLogin(username, password) {
  const login = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
    Ci.nsILoginInfo
  );
  login.init(
    ORIGIN,
    ORIGIN,
    null,
    username,
    password,
    "swelluser",
    "swellpass"
  );
  return login;
}

async function filled(tab) {
  return SpecialPowers.spawn(tab.browser, [], async () => {
    const pass = content.document.getElementById("pass");
    try {
      await ContentTaskUtils.waitForCondition(
        () => pass.value,
        "the password is filled",
        100,
        30
      );
    } catch (e) {
      // nothing was filled
    }
    return pass.value;
  });
}

add_setup(async () => {
  Services.prefs.setStringPref(
    "swell.logins.keyLabelPrefix",
    "Swell test logins"
  );
  registerCleanupFunction(async () => {
    for (let id = 1; id < 40; id++) {
      await deleteLoginsKey(id);
    }
    Services.prefs.clearUserPref("swell.logins.keyLabelPrefix");
  });
});

add_task(async function test_logins_are_per_space() {
  const { a, b, bridge } = await pair();
  const { app } = await swellApp();
  const inA = LoginHelper.loginsFor(a.userContextId);
  const saved = await inA.addLoginAsync(
    newLogin("swell-account@test", "swellpass-A")
  );
  Assert.ok(saved.guid, "the login is saved in space A");

  const [found] = await inA.searchLoginsAsync({ origin: ORIGIN });
  Assert.equal(found.password, "swellpass-A", "and found, decrypted");
  const [record] = await app.core.loginsAll(a.userContextId);
  Assert.ok(
    !JSON.stringify(record).includes("swellpass-A") &&
      !JSON.stringify(record).includes("swell-account"),
    "the core holds the user name and password encrypted"
  );

  const inB = await LoginHelper.loginsFor(b.userContextId).searchLoginsAsync({
    origin: ORIGIN,
  });
  audit("saved logins", !inB.length, `space B finds ${inB.length}`);

  info("The real fill path");
  // Forms are only filled in a page that is in front.
  const show = async (space, url) => {
    const tab = await openInSpace(bridge, space.id, url);
    await app.switchSpace(space.id);
    bridge.selectTab(tab.liveTab);
    await TestUtils.waitForCondition(
      () => bridge.selectedTab === tab,
      "the tab is in front"
    );
    return tab;
  };
  const tabA = await show(a, FORM);
  Assert.equal(await filled(tabA), "swellpass-A", "the page of A is filled");
  const filledInB = await filled(await show(b, FORM));
  audit("autofilled logins", filledInB === "", `B autofilled "${filledInB}"`);

  await inA.removeLoginAsync(found);
  await closeAllTabs(bridge);
});

add_task(async function test_never_save_is_per_space() {
  const { a, b } = await pair();
  const inA = LoginHelper.loginsFor(a.userContextId);
  const inB = LoginHelper.loginsFor(b.userContextId);
  registerCleanupFunction(() => inA.setLoginSavingEnabled(ORIGIN, true));
  inA.setLoginSavingEnabled(ORIGIN, false);
  Assert.ok(!inA.getLoginSavingEnabled(ORIGIN), "disabled in space A");
  audit(
    "never save passwords",
    inB.getLoginSavingEnabled(ORIGIN),
    `space B may save: ${inB.getLoginSavingEnabled(ORIGIN)}`
  );
  inA.setLoginSavingEnabled(ORIGIN, true);
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Runs only when SWELL_ADDONS points at the derived add-ons directory
// (swell/spikes/m0/addons/derived).

ChromeUtils.defineESModuleGetters(this, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

const DIR = Services.env.get("SWELL_ADDONS");
const PAGE = BASE + "file_blank.html";
const DARK_READER = "addon--sa@darkreader.org";

// Real add-ons phone home or open help pages on install. Cancel anything that
// is not the local test server before it reaches the network.
const blockExternal = {
  observe(subject) {
    let channel = subject.QueryInterface(Ci.nsIHttpChannel);
    if (!["example.com", "example.org", "localhost", "127.0.0.1"].includes(channel.URI.host)) {
      channel.cancel(Cr.NS_ERROR_ABORT);
    }
  },
};

async function installDerived(fileName) {
  let file = new FileUtils.File(PathUtils.join(DIR, fileName));
  ok(file.exists(), `${fileName} exists`);
  return AddonManager.installTemporaryAddon(file);
}

async function darkReaderTabs(config, prefs) {
  await SpecialPowers.pushPrefEnv({
    set: [["xpinstall.signatures.required", false], ...prefs],
  });
  Services.obs.addObserver(blockExternal, "http-on-modify-request");
  let addon = await installDerived(`${DARK_READER}.xpi`);
  is(addon.id, DARK_READER, "The derived copy installs under its derived ID");

  let hit = [];
  let tabs = [];
  for (let ucid of [0, 1, 2]) {
    let tab = await openTabInUserContext(PAGE, ucid);
    tabs.push(tab);
    let ok_ = await SpecialPowers.spawn(tab.linkedBrowser, [], async () => {
      try {
        await ContentTaskUtils.waitForCondition(
          () => content.document.documentElement.hasAttribute("data-darkreader-mode"),
          "dark reader marker",
          200,
          40
        );
        return true;
      } catch (e) {
        return false;
      }
    });
    if (ok_) {
      hit.push(`firefox-${ucid ? "container-" + ucid : "default"}`);
    }
  }
  let foreign = hit.filter(s => s != "firefox-container-1");
  info(`OBS|${config}|a|Dark Reader content script|${foreign.length ? "leaks" : "isolated"}|marker in ${JSON.stringify(hit)}`);
  ok(hit.includes("firefox-container-1"), `${config}: Dark Reader works in its own container`);
  ok(!foreign.length, `${config}: Dark Reader is limited to its own container. Marker in ${JSON.stringify(hit)}`);

  await addon.uninstall();
  while (gBrowser.tabs.length > 1) {
    BrowserTestUtils.removeTab(gBrowser.tabs.at(-1));
  }
  Services.obs.removeObserver(blockExternal, "http-on-modify-request");
  await SpecialPowers.popPrefEnv();
}

add_task(async function test_darkreader_C0() {
  if (!DIR) {
    todo(false, "SWELL_ADDONS is not set");
    return;
  }
  await darkReaderTabs("C0", []);
});

add_task(async function test_darkreader_C2() {
  if (!DIR) {
    return;
  }
  await darkReaderTabs("C2", [[`swell.spike.boundUserContext.${DARK_READER}`, 1]]);
});

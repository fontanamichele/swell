/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  FormHistory: "resource://gre/modules/FormHistory.sys.mjs",
  FormHistoryTestUtils:
    "resource://testing-common/FormHistoryTestUtils.sys.mjs",
  LoginTestUtils: "resource://testing-common/LoginTestUtils.sys.mjs",
});

add_task(async function test_saved_logins() {
  // The store has no container field, so the login is added through the API
  // and then looked up by the real autofill path in each container.
  await LoginTestUtils.addLogin({
    username: "swelluser",
    password: "swellpass",
  });
  let [tabA, tabB] = [
    await openTabInUserContext(BASE + "file_login.html", CONTAINER_A),
    await openTabInUserContext(BASE + "file_login.html", CONTAINER_B),
  ];
  const filled = browser =>
    SpecialPowers.spawn(browser, [], async () => {
      let pass = content.document.getElementById("pass");
      try {
        await ContentTaskUtils.waitForCondition(
          () => pass.value,
          "password autofilled",
          100,
          30
        );
      } catch (e) {}
      return pass.value;
    });
  let inA = await filled(tabA.linkedBrowser);
  let inB = await filled(tabB.linkedBrowser);
  is(inA, "swellpass", "The login is autofilled in container A");
  audit("savedLogins", inB !== "swellpass", `B autofilled value: "${inB}"`);
  closeTabs(tabA, tabB);
  LoginTestUtils.clearData();
});

add_task(async function test_form_history() {
  let tabA = await openTabInUserContext(BASE + "file_form.html", CONTAINER_A);
  let tabB = await openTabInUserContext(BASE + "file_form.html", CONTAINER_B);
  gBrowser.selectedTab = tabA;
  // Form history only keeps values the user typed.
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#field",
    {},
    tabA.linkedBrowser
  );
  for (let ch of "swellvalue") {
    await BrowserTestUtils.sendChar(ch, tabA.linkedBrowser);
  }
  let loaded = BrowserTestUtils.browserLoaded(tabA.linkedBrowser);
  await BrowserTestUtils.synthesizeMouseAtCenter(
    "#submit",
    {},
    tabA.linkedBrowser
  );
  await loaded;
  await TestUtils.waitForCondition(
    async () => (await FormHistoryTestUtils.count("swellfield")) > 0,
    "The submitted value is saved in form history"
  );
  let results = await FormHistory.getAutoCompleteResults("swell", {
    fieldname: "swellfield",
  });
  let suggested = results.some(r => r.text == "swellvalue");
  audit(
    "formHistory",
    !suggested,
    `value from A offered for the same field in B: ${suggested}`
  );
  await FormHistoryTestUtils.clear("swellfield");
  closeTabs(tabA, tabB);
});

add_task(async function test_downloads_list() {
  let [tabA, tabB] = await openPair(BASE + "file_blank.html");
  let target = PathUtils.join(
    Services.dirsvc.get("TmpD", Ci.nsIFile).path,
    "swell-download.txt"
  );
  let download = await Downloads.createDownload({
    source: { url: BASE + "file_blank.html", userContextId: CONTAINER_A },
    target,
  });
  let list = await Downloads.getList(Downloads.PUBLIC);
  await list.add(download);
  let all = await list.getAll();
  is(
    all[0].source.userContextId,
    CONTAINER_A,
    "The download remembers its container"
  );
  // The list has no container filter, so every container sees every entry.
  audit(
    "downloadsList",
    false,
    `list holds ${all.length} entries, none filtered by container`
  );
  await list.remove(download);
  closeTabs(tabA, tabB);
});

add_task(async function test_site_zoom() {
  let [tabA, tabB] = await openPair(BASE + "file_blank.html");
  gBrowser.selectedTab = tabA;
  FullZoom.enlarge();
  await TestUtils.waitForCondition(
    () => ZoomManager.getZoomForBrowser(tabA.linkedBrowser) > 1,
    "Zoom was applied in container A"
  );
  gBrowser.selectedTab = tabB;
  let reloaded = BrowserTestUtils.browserLoaded(tabB.linkedBrowser);
  tabB.linkedBrowser.reload();
  await reloaded;
  let zoomB = ZoomManager.getZoomForBrowser(tabB.linkedBrowser);
  audit("siteZoom", zoomB === 1, `container B zoom after reload: ${zoomB}`);
  gBrowser.selectedTab = tabA;
  FullZoom.reset();
  closeTabs(tabA, tabB);
});

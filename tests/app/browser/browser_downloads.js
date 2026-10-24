/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

add_task(async function test_an_attachment_is_saved_without_asking() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Downloads");
  const dir = new FileUtils.File(
    await IOUtils.createUniqueDirectory(PathUtils.tempDir, "swell-downloads")
  );
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setComplexValue("browser.download.dir", Ci.nsIFile, dir);
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref("browser.download.folderList");
    Services.prefs.clearUserPref("browser.download.dir");
    await IOUtils.remove(dir.path, { recursive: true });
  });
  const list = await Downloads.getList(Downloads.ALL);
  const finished = new Promise(resolve => {
    list.addView({
      onDownloadChanged(download) {
        if (download.succeeded || download.error) {
          resolve(download);
        }
      },
    });
  });
  const liveTab = await bridge.openUrl(`${BASE}file_blank.html`, space.id);
  await rendered(
    () => bridge.tab(liveTab)?.url == `${BASE}file_blank.html`,
    "loaded"
  );
  await SpecialPowers.spawn(
    bridge.tab(liveTab).browser,
    [`${BASE}file_download.sjs`],
    url => {
      content.location.href = url;
    }
  );
  const download = await finished;
  Assert.ok(download.succeeded, `the download finished: ${download.error}`);
  Assert.ok(await IOUtils.exists(download.target.path), "the file exists");
  Assert.equal(
    new TextDecoder().decode(await IOUtils.read(download.target.path)),
    "swell download test"
  );
  Assert.equal(PathUtils.filename(download.target.path), "swell-test.bin");
  await rendered(
    () =>
      [...document.querySelectorAll("#toasts .toast-text")].some(
        t => t.textContent == "Downloaded swell-test.bin"
      ),
    "a toast says the download finished"
  );

  await app.downloads.show();
  const dialog = document.getElementById("downloads-dialog");
  Assert.ok(dialog.open, "the downloads dialog opens");
  Assert.deepEqual(
    [...dialog.querySelectorAll(".download-name")].map(n => n.textContent),
    ["swell-test.bin"],
    "the dialog lists this space's download"
  );
  document.getElementById("downloads-close").click();
  Assert.ok(!dialog.open, "Close closes it");
  await closeAllTabs(bridge);
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// A download belongs to the space whose tab started it: the list and the
// toasts of another space do not show it.

ChromeUtils.defineESModuleGetters(this, {
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
});

add_task(async function test_downloads_are_per_space() {
  const { a, b, tabA, bridge } = await pair();
  const { app } = await swellApp();
  const dir = new FileUtils.File(
    await IOUtils.createUniqueDirectory(PathUtils.tempDir, "swell-downloads")
  );
  Services.prefs.setIntPref("browser.download.folderList", 2);
  Services.prefs.setComplexValue("browser.download.dir", Ci.nsIFile, dir);
  const list = await Downloads.getList(Downloads.ALL);
  registerCleanupFunction(async () => {
    Services.prefs.clearUserPref("browser.download.folderList");
    Services.prefs.clearUserPref("browser.download.dir");
    for (const download of await list.getAll()) {
      await list.remove(download);
    }
    await IOUtils.remove(dir.path, { recursive: true });
  });

  // Look at space B while space A's tab downloads a file.
  await app.switchSpace(b.id);
  await TestUtils.waitForCondition(
    () => app.activeSpaceId == b.id,
    "space B is active"
  );
  const finished = new Promise(resolve =>
    list.addView({
      onDownloadChanged(download) {
        if (download.succeeded || download.error) {
          resolve(download);
        }
      },
    })
  );
  await SpecialPowers.spawn(tabA.browser, [`${BASE}file_download.sjs`], url => {
    content.location.href = url;
  });
  const download = await finished;
  Assert.ok(download.succeeded, `the download finished: ${download.error}`);
  Assert.equal(
    download.source.userContextId,
    a.userContextId,
    "the download remembers its container"
  );

  const inB = await app.downloads.forActiveSpace();
  const toastInB = [...document.querySelectorAll("#toasts .toast-text")].some(
    t => t.textContent.includes("swell-test.bin")
  );
  audit(
    "downloads list",
    !inB.length,
    `space B lists ${inB.map(d => PathUtils.filename(d.target.path))}`
  );
  audit("download toasts", !toastInB, `a toast shows in space B: ${toastInB}`);

  await app.switchSpace(a.id);
  await TestUtils.waitForCondition(
    () => app.activeSpaceId == a.id,
    "space A is active"
  );
  Assert.equal(
    (await app.downloads.forActiveSpace()).length,
    1,
    "space A lists its download"
  );
  await closeAllTabs(bridge);
});

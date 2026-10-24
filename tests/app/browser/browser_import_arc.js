/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async function test_importing_an_arc_file_adds_its_spaces_and_trees() {
  const { core, bridge, app } = await swellApp();
  const before = (await core.listSpaces()).length;
  const path = getTestFilePath("arc_sidebar_synthetic.json");

  const report = await app.importArcFile(path.replace(/^file:\/\//, ""));
  Assert.ok(report, "the import ran");
  Assert.equal(report.spaces, 3);
  Assert.equal(report.tabs, 10);
  Assert.equal(report.favorites, 3);
  await rendered(
    () => app.spaces.length == before + 3,
    "the imported spaces are listed"
  );
  await rendered(
    () =>
      [...document.querySelectorAll("#toasts .toast-text")].some(t =>
        t.textContent.startsWith("Imported 3 spaces and 13 tabs")
      ),
    "a toast says what came across"
  );

  const work = app.spaces.find(s => s.title == "Work");
  const home = app.spaces.find(s => s.title == "Home");
  const client = app.spaces.find(s => s.title == "Client");
  Assert.equal(
    work.identityId,
    home.identityId,
    "spaces on one Arc profile share a container"
  );
  Assert.notEqual(work.identityId, client.identityId);
  Assert.notEqual(work.userContextId, 0);

  await app.switchSpace(work.id);
  await rendered(
    () => app.activeSpaceId == work.id,
    "switched to the imported space"
  );
  await rendered(
    () => !!rowTitles("pinned").length,
    "its pinned tree is drawn"
  );
  Assert.deepEqual(rowTitles("pinned"), [
    "Docs été",
    "-Doc A",
    "-My Drive",
    "中文 Mail",
  ]);
  Assert.deepEqual(rowTitles("today"), ["News", "Post"]);
  Assert.equal(
    document.querySelectorAll("#favorites .favorite").length,
    2,
    "its identity's Favorites"
  );

  const live = await bridge.openUrl(`${BASE}file_blank.html`, work.id);
  await rendered(() => bridge.tab(live), "a tab opens in the imported space");
  Assert.equal(bridge.tab(live).userContextId, work.userContextId);
  await closeAllTabs(bridge);
});

add_task(async function test_a_file_that_is_not_an_arc_sidebar_is_reported() {
  const { app } = await swellApp();
  const path = getTestFilePath("file_blank.html").replace(/^file:\/\//, "");
  const report = await app.importArcFile(path);
  Assert.equal(report, null);
  await rendered(
    () =>
      [...document.querySelectorAll("#toasts .toast-text")].some(t =>
        t.textContent.startsWith("Could not import")
      ),
    "a toast explains the failure"
  );
});

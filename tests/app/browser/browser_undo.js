/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async function test_a_deleted_row_comes_back_with_accel_z() {
  const { app, core } = await swellApp();
  const space = await freshSpace(app, "Undo");
  const folder = await core.createFolder(space.pinnedRoot, "Reading", 0);
  await savedTab(core, space, folder, "https://example.com/a", "Page A");
  await savedTab(
    core,
    space,
    space.pinnedRoot,
    "https://example.com/b",
    "Page B"
  );
  await rendered(
    () => rowTitles("pinned").join("|") == "Reading|-Page A|Page B",
    "the tree is drawn"
  );

  await app.removeNode(folder);
  await rendered(
    () => rowTitles("pinned").join("|") == "Page B",
    "the folder and its page are gone"
  );
  const toast = await rendered(
    () =>
      [...document.querySelectorAll("#toasts .toast")].find(t =>
        t.textContent.includes("Removed Reading")
      ),
    "a toast says what was removed"
  );
  Assert.ok(toast.textContent.includes("Undo"), "and offers to undo it");

  EventUtils.synthesizeKey("z", { accelKey: true }, window);
  await rendered(
    () => rowTitles("pinned").join("|") == "Reading|-Page A|Page B",
    "accel+Z puts back the folder, its page, in the same place"
  );

  EventUtils.synthesizeKey("z", { accelKey: true }, window);
  Assert.equal(
    rowTitles("pinned").join("|"),
    "Reading|-Page A|Page B",
    "with nothing left to undo, it does nothing"
  );
});

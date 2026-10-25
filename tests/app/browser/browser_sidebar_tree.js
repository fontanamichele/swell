/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async function test_the_tree_renders_and_folders_collapse() {
  const { core, app } = await swellApp();
  const space = await freshSpace(app, "Tree");
  const folder = await core.createFolder(space.pinnedRoot, "Work", 0);
  await savedTab(core, space, folder, "https://a.test/", "Alpha");
  await savedTab(core, space, space.pinnedRoot, "https://b.test/", "Beta");

  await rendered(() => rowTitles("pinned").length == 3, "three pinned rows");
  Assert.deepEqual(rowTitles("pinned"), ["Work", "-Alpha", "Beta"]);

  rowFor(folder).click();
  await rendered(() => rowTitles("pinned").length == 2, "the folder collapses");
  Assert.deepEqual(rowTitles("pinned"), ["Work", "Beta"]);
  rowFor(folder).click();
  await rendered(() => rowTitles("pinned").length == 3, "the folder expands");
});

add_task(
  async function test_clicking_a_saved_tab_opens_it_in_the_spaces_container() {
    const { core, bridge, app } = await swellApp();
    const space = await freshSpace(app, "Click");
    const node = await savedTab(
      core,
      space,
      space.pinnedRoot,
      `${BASE}file_blank.html`,
      "Blank"
    );
    await rendered(() => rowFor(node), "the saved tab is drawn");
    Assert.ok(!rowFor(node).classList.contains("open"));

    rowFor(node).click();
    await rendered(
      () => bridge.selectedTab?.node === node,
      "the tab opens and is selected"
    );
    const tab = bridge.selectedTab;
    Assert.equal(tab.userContextId, space.userContextId);
    await rendered(
      () => rowFor(node).classList.contains("selected"),
      "the row shows it is selected"
    );
    Assert.ok(
      rowFor(node).querySelector(".close"),
      "an open tab has a close button"
    );

    rowFor(node).querySelector(".close").click();
    await rendered(() => !bridge.tab(tab.liveTab), "the tab closes");
    await rendered(
      () => !rowFor(node).classList.contains("open"),
      "the row is no longer open"
    );
    Assert.ok(
      rowFor(node),
      "a pinned tab keeps its row after its page is closed"
    );
  }
);

add_task(async function test_a_row_can_be_renamed_in_place() {
  const { core, app } = await swellApp();
  const space = await freshSpace(app, "Rename");
  const node = await savedTab(
    core,
    space,
    space.pinnedRoot,
    "https://a.test/",
    "Alpha"
  );
  await rendered(() => rowFor(node), "drawn");

  app.sidebar.startRename(node);
  const input = rowFor(node).querySelector(".rename");
  Assert.ok(input, "an input replaces the title");
  input.value = "Gamma";
  input.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
  );
  await rendered(
    () => rowTitles("pinned")[0] == "Gamma",
    "the new title is shown"
  );
});

add_task(async function test_the_context_menu_pins_unpins_and_deletes() {
  const { core, app } = await swellApp();
  const space = await freshSpace(app, "Menu");
  const node = await savedTab(
    core,
    space,
    space.pinnedRoot,
    "https://a.test/",
    "Alpha"
  );
  await rendered(() => rowFor(node), "drawn");
  const menu = document.getElementById("menu");
  const choose = async label => {
    rowFor(node).dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: 40,
        clientY: 40,
      })
    );
    Assert.ok(!menu.hidden, "the menu opens");
    const labels = [...menu.querySelectorAll("button")].map(b => b.textContent);
    Assert.ok(labels.includes(label), `${label} is in the menu: ${labels}`);
    [...menu.querySelectorAll("button")]
      .find(b => b.textContent == label)
      ?.click();
  };

  await choose("Unpin");
  await rendered(
    () =>
      rowTitles("today").includes("Alpha") &&
      !rowTitles("pinned").includes("Alpha"),
    "unpinned to Today"
  );
  await choose("Pin");
  await rendered(() => rowTitles("pinned").includes("Alpha"), "pinned again");
  await choose("Delete");
  await rendered(() => !rowFor(node), "the row is deleted");
});

add_task(async function test_space_buttons_switch_what_is_shown() {
  const { core, app } = await swellApp();
  const a = await freshSpace(app, "One");
  await savedTab(core, a, a.pinnedRoot, "https://a.test/", "In one");
  const b = await freshSpace(app, "Two");
  await savedTab(core, b, b.pinnedRoot, "https://b.test/", "In two");
  await rendered(
    () => rowTitles("pinned").includes("In two"),
    "space Two is shown"
  );
  Assert.ok(!rowTitles("pinned").includes("In one"));

  document
    .querySelector(`#spaces .space[data-id="${CSS.escape(a.id)}"]`)
    .click();
  await rendered(
    () => rowTitles("pinned").includes("In one"),
    "space One is shown"
  );
  Assert.ok(
    !rowTitles("pinned").includes("In two"),
    "another space's tabs are not drawn"
  );
  Assert.ok(
    document
      .querySelector(`#spaces .space[data-id="${CSS.escape(a.id)}"]`)
      .classList.contains("active")
  );
});

function dragEvent(type, target, where = 0.5) {
  const { left, top, width, height } = target.getBoundingClientRect();
  return new DragEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: left + width / 2,
    clientY: top + height * where,
    dataTransfer: dragEvent.transfer,
  });
}

async function drag(sourceId, target, where) {
  dragEvent.transfer = new DataTransfer();
  const source = rowFor(sourceId);
  source.dispatchEvent(dragEvent("dragstart", source));
  target.dispatchEvent(dragEvent("dragover", target, where));
  target.dispatchEvent(dragEvent("drop", target, where));
  source.dispatchEvent(dragEvent("dragend", source));
}

add_task(async function test_dragging_reorders_pins_and_nests() {
  const { core, app } = await swellApp();
  const space = await freshSpace(app, "Drag");
  const folder = await core.createFolder(space.pinnedRoot, "Folder", 0);
  const a = await savedTab(
    core,
    space,
    space.pinnedRoot,
    "https://a.test/",
    "A"
  );
  const b = await savedTab(
    core,
    space,
    space.pinnedRoot,
    "https://b.test/",
    "B"
  );
  const { liveTab, node: today } = await core.onTabOpened(
    "main",
    space.id,
    "https://t.test/"
  );
  await core.onNavigation(liveTab, "https://t.test/", "T", Transition.TYPED);
  await rendered(
    () => rowTitles("today").length == 1 && rowTitles("pinned").length == 3,
    "drawn"
  );
  Assert.deepEqual(rowTitles("pinned"), ["Folder", "A", "B"]);

  await drag(b, rowFor(a), 0.1);
  await rendered(
    () => rowTitles("pinned").join() == "Folder,B,A",
    "B moved before A"
  );

  await drag(a, rowFor(folder), 0.5);
  await rendered(
    () => rowTitles("pinned").join() == "Folder,-A,B",
    "A moved into the folder"
  );

  await drag(today, rowFor(b), 0.9);
  await rendered(
    () =>
      rowTitles("pinned").join() == "Folder,-A,B,T" &&
      !rowTitles("today").length,
    "a Today tab is pinned by dragging"
  );

  const folderTodayDrop = document.getElementById("today");
  await drag(folder, folderTodayDrop, 0.5);
  // eslint-disable-next-line mozilla/no-arbitrary-setTimeout
  await new Promise(resolve => setTimeout(resolve, 100));
  Assert.deepEqual(
    rowTitles("pinned"),
    ["Folder", "-A", "B", "T"],
    "Today refuses folders"
  );
  await core.onTabClosed(liveTab);
});

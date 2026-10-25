/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  DevTools: "moz-src:///swell/app/modules/DevTools.sys.mjs",
});

// The developer tools, in their own window, for the tab in front.

const PAGE = `${BASE}file_links.html`;

async function inFront(bridge, app, space) {
  const tab = await openInSpace(bridge, space.id, PAGE);
  await app.switchSpace(space.id);
  bridge.selectTab(tab.liveTab);
  await rendered(() => bridge.selectedTab === tab, "the tab is in front");
  return tab;
}

async function closeToolbox(tab) {
  const toolbox = DevTools.toolboxFor(tab);
  if (toolbox) {
    await toolbox.destroy();
  }
}

add_task(async function test_the_inspector_opens_in_its_own_window() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Inspector");
  const tab = await inFront(bridge, app, space);

  const toolbox = await app.openDevTools("inspector");
  Assert.ok(toolbox, "the toolbox opens");
  Assert.equal(toolbox.hostType, "window", "in a window of its own");
  Assert.equal(toolbox.currentToolId, "inspector", "on the inspector");
  const inspector = toolbox.getPanel("inspector");
  Assert.ok(inspector, "the inspector is there");
  await TestUtils.waitForCondition(
    () => inspector.markup,
    "the markup of the page is shown"
  );
  Assert.equal(
    DevTools.toolboxFor(tab),
    toolbox,
    "it is the toolbox of the tab"
  );
  await closeToolbox(tab);
  await closeAllTabs(bridge);
});

add_task(async function test_inspect_selects_the_element_that_was_clicked() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Inspect element");
  const tab = await inFront(bridge, app, space);
  const reference = await SpecialPowers.spawn(tab.browser, [], () => {
    const { ContentDOMReference } = ChromeUtils.importESModule(
      "resource://gre/modules/ContentDOMReference.sys.mjs"
    );
    return ContentDOMReference.get(content.document.querySelector("a"));
  });

  await DevTools.inspectNode(tab, reference);
  const toolbox = DevTools.toolboxFor(tab);
  Assert.ok(toolbox, "the toolbox opens");
  const inspector = toolbox.getPanel("inspector");
  await TestUtils.waitForCondition(
    () => inspector.selection.nodeFront?.nodeName == "A",
    "the link is the selected element"
  );
  await closeToolbox(tab);
  await closeAllTabs(bridge);
});

add_task(async function test_the_shortcuts_and_the_menu_open_the_tools() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Dev shortcuts");
  const tab = await inFront(bridge, app, space);

  const openedBy = async fire => {
    fire();
    const toolbox = await TestUtils.waitForCondition(
      () => DevTools.toolboxFor(tab),
      "a toolbox opens"
    );
    const id = toolbox.currentToolId;
    await closeToolbox(tab);
    await TestUtils.waitForCondition(
      () => !DevTools.toolboxFor(tab),
      "and closes"
    );
    return id;
  };
  const mod = { accelKey: true, altKey: true };
  Assert.equal(
    await openedBy(() =>
      EventUtils.synthesizeKey("c", { ...mod, code: "KeyC" }, window)
    ),
    "inspector",
    "accel+alt+C is the inspector"
  );
  Assert.equal(
    await openedBy(() =>
      EventUtils.synthesizeKey("k", { ...mod, code: "KeyK" }, window)
    ),
    "webconsole",
    "accel+alt+K is the console"
  );
  Assert.equal(
    await openedBy(() =>
      document
        .querySelector('#main-menubar [data-action="inspector"]')
        .dispatchEvent(new CustomEvent("command", { bubbles: true }))
    ),
    "inspector",
    "the View menu has the inspector"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_the_page_menu_offers_inspect() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Inspect menu");
  const tab = await inFront(bridge, app, space);
  app.showPageMenu({
    browser: tab.browser,
    actor: { sendAsyncMessage() {} },
    clientX: 10,
    clientY: 10,
    linkURL: null,
    linkText: null,
    imageURL: null,
    mediaURL: null,
    mediaType: null,
    password: false,
    selection: "",
    editable: false,
    contentDomReference: { browsingContextId: 0, id: 0 },
  });
  const labels = [...document.querySelectorAll("#menu button")].map(
    button => button.textContent
  );
  Assert.ok(labels.includes("Inspect"), "the menu of a page has Inspect");
  app.menu.hide();
  await closeAllTabs(bridge);
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global browser */

ChromeUtils.defineESModuleGetters(this, {
  ExtensionTestCommon: "resource://testing-common/ExtensionTestCommon.sys.mjs",
  installCopy: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
});

// The menus and browserAction APIs: what an add-on puts in a page's context
// menu and in the sidebar.

const PAGE = `${BASE}file_blank.html`;

async function inFront(bridge, app, space) {
  const tab = await openInSpace(bridge, space.id, PAGE);
  await app.switchSpace(space.id);
  bridge.selectTab(tab.liveTab);
  await TestUtils.waitForCondition(
    () => bridge.selectedTab === tab,
    "the tab is in front"
  );
  return tab;
}

function openPageMenu(app, tab, details = {}) {
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
    ...details,
  });
  return [...document.querySelectorAll("#menu button, #menu hr")];
}

const labelsOf = nodes =>
  nodes.filter(node => node.localName == "button").map(b => b.textContent);

function buttonLabelled(label) {
  return [...document.querySelectorAll("#menu button")].find(
    b => b.textContent == label
  );
}

add_task(async function test_menus_show_in_the_page_menu_and_report_clicks() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Ext menus");
  const tab = await inFront(bridge, app, space);
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { permissions: ["menus", "tabs"] },
    async background() {
      const create = props =>
        new Promise(resolve => browser.menus.create(props, resolve));
      await create({ id: "page", title: "Page item", contexts: ["page"] });
      await create({ id: "link", title: "Link item", contexts: ["link"] });
      await create({
        id: "check",
        type: "checkbox",
        title: "Checkbox item",
        contexts: ["all"],
      });
      await create({ id: "parent", title: "Parent item", contexts: ["all"] });
      await create({ id: "child", parentId: "parent", title: "Child item" });
      browser.menus.onClicked.addListener(async (info, clickedTab) => {
        const [active] = await browser.tabs.query({ active: true });
        browser.test.sendMessage("clicked", {
          info,
          tabId: clickedTab.id,
          activeId: active.id,
        });
      });
      const events = [];
      browser.menus.onShown.addListener(info =>
        events.push(["shown", info.menuIds])
      );
      browser.menus.onHidden.addListener(() => events.push(["hidden"]));
      browser.test.onMessage.addListener(() =>
        browser.test.sendMessage("events", events)
      );
      browser.test.sendMessage("ready");
    },
  });
  await extension.startup();
  await extension.awaitMessage("ready");

  let nodes = openPageMenu(app, tab);
  Assert.ok(labelsOf(nodes).includes("Page item"), "a page item shows");
  Assert.ok(!labelsOf(nodes).includes("Link item"), "a link item does not");
  Assert.ok(labelsOf(nodes).includes("Checkbox item"));
  Assert.ok(
    nodes.some(n => n.localName == "hr"),
    "set apart by a separator"
  );
  const parent = buttonLabelled("Parent item");
  Assert.ok(parent.classList.contains("has-submenu"), "a submenu");
  Assert.equal(
    parent.parentElement.querySelector(":scope > .submenu button").textContent,
    "Child item"
  );

  buttonLabelled("Page item").click();
  const click = await extension.awaitMessage("clicked");
  Assert.equal(click.info.menuItemId, "page");
  Assert.equal(click.info.pageUrl, PAGE, "the page is reported");
  Assert.equal(click.tabId, click.activeId, "for the tab in front");

  nodes = openPageMenu(app, tab, {
    linkURL: "https://example.org/target",
    linkText: "a link",
  });
  Assert.ok(labelsOf(nodes).includes("Link item"), "a link item shows");
  Assert.ok(!labelsOf(nodes).includes("Page item"), "the page item goes");
  buttonLabelled("Link item").click();
  const linkClick = await extension.awaitMessage("clicked");
  Assert.equal(linkClick.info.linkUrl, "https://example.org/target");
  Assert.equal(linkClick.info.linkText, "a link");

  openPageMenu(app, tab);
  buttonLabelled("Checkbox item").click();
  const checked = await extension.awaitMessage("clicked");
  Assert.deepEqual(
    [checked.info.checked, checked.info.wasChecked],
    [true, false],
    "a checkbox reports its state"
  );
  nodes = openPageMenu(app, tab);
  Assert.equal(
    buttonLabelled("Checkbox item").getAttribute("aria-checked"),
    "true",
    "and shows it"
  );
  app.menu.hide();

  extension.sendMessage("events");
  const events = await extension.awaitMessage("events");
  const [, firstShown] = events.find(([kind]) => kind == "shown");
  Assert.ok(
    firstShown.includes("page") &&
      firstShown.includes("check") &&
      !firstShown.includes("link"),
    "onShown lists what is shown"
  );
  Assert.ok(
    events.some(([kind]) => kind == "hidden"),
    "onHidden fires when the menu closes"
  );

  await extension.unload();
  await closeAllTabs(bridge);
});

add_task(async function test_a_browser_action_has_a_button_and_a_popup() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Ext action");
  await inFront(bridge, app, space);
  const extension = ExtensionTestUtils.loadExtension({
    manifest: {
      permissions: ["tabs"],
      browser_action: { default_title: "Do it", default_popup: "popup.html" },
    },
    files: {
      "popup.html": `<!doctype html><meta charset="utf-8"><body style="margin:0"><div style="width:200px;height:100px">popup</div><script src="popup.js"></script>`,
      "popup.js": `browser.test.sendMessage("popup-loaded", location.href);`,
    },
    async background() {
      browser.browserAction.onClicked.addListener(async clicked => {
        const [active] = await browser.tabs.query({ active: true });
        browser.test.sendMessage("clicked", [clicked.id, active.id]);
      });
      browser.test.onMessage.addListener(async message => {
        if (message == "badge") {
          await browser.browserAction.setBadgeText({ text: "7" });
        } else if (message == "no-popup") {
          await browser.browserAction.setPopup({ popup: "" });
        }
        browser.test.sendMessage("done");
      });
      browser.test.sendMessage("ready");
    },
  });
  await extension.startup();
  await extension.awaitMessage("ready");

  const button = await rendered(
    () => document.querySelector("#extension-actions .extension-action"),
    "the button shows in the sidebar"
  );
  Assert.equal(button.title, "Do it");
  Assert.ok(!button.disabled);

  button.click();
  const popup = document.getElementById("extension-popup");
  await extension.awaitMessage("popup-loaded");
  Assert.ok(!popup.hidden, "the popup opens");
  const browserElement = popup.querySelector("browser");
  Assert.equal(
    browserElement.getAttribute("usercontextid"),
    String(space.userContextId),
    "the popup is in the container of its space"
  );
  await rendered(
    () => parseInt(browserElement.style.height, 10) >= 100,
    "the popup is sized to its page"
  );
  button.click();
  Assert.ok(popup.hidden, "a second click closes it");

  extension.sendMessage("badge");
  await extension.awaitMessage("done");
  const badge = await rendered(
    () => document.querySelector("#extension-actions .badge"),
    "the badge shows"
  );
  Assert.equal(badge.textContent, "7");

  extension.sendMessage("no-popup");
  await extension.awaitMessage("done");
  document.querySelector("#extension-actions .extension-action").click();
  const [clickedId, activeId] = await extension.awaitMessage("clicked");
  Assert.equal(clickedId, activeId, "without a popup the click is delivered");
  Assert.ok(popup.hidden, "and no popup opens");

  await extension.unload();
  await rendered(
    () => !document.querySelector("#extension-actions .extension-action"),
    "the button goes with the add-on"
  );
  await closeAllTabs(bridge);
});

add_task(async function test_a_copy_only_shows_in_its_own_space() {
  const { bridge, app } = await swellApp();
  const a = await freshSpace(app, "Copy A");
  const b = await freshSpace(app, "Copy B");
  const xpi = await ExtensionTestCommon.generateXPI({
    manifest: {
      name: "Copy",
      version: "1.0",
      browser_specific_settings: { gecko: { id: "copy@swell.test" } },
      permissions: ["menus"],
      browser_action: { default_title: "Copy action" },
    },
    background() {
      browser.menus.create({ id: "copy", title: "Copy item" });
    },
  });
  const addon = await installCopy(xpi, a.userContextId, {
    allowUnsigned: true,
  });

  const tabA = await inFront(bridge, app, a);
  await rendered(
    () =>
      document.querySelector("#extension-actions .extension-action")?.title ==
      "Copy action",
    "the button shows in its space"
  );
  await rendered(
    () => labelsOf(openPageMenu(app, tabA)).includes("Copy item"),
    "and the menu item"
  );
  app.menu.hide();

  const tabB = await inFront(bridge, app, b);
  await rendered(
    () => !document.querySelector("#extension-actions .extension-action"),
    "no button in another space"
  );
  Assert.ok(
    !labelsOf(openPageMenu(app, tabB)).includes("Copy item"),
    "no menu item in another space"
  );
  app.menu.hide();

  await addon.uninstall();
  await closeAllTabs(bridge);
});

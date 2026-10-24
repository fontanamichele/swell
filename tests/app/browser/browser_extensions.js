/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global browser */

// WebExtensions on Swell's own tabs and window (app/extensions).

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

add_task(
  async function test_an_extension_starts_and_sees_the_window_and_tabs() {
    const { bridge, app } = await swellApp();
    const space = await freshSpace(app, "Ext basics");
    const tab = await inFront(bridge, app, space);
    const extension = ExtensionTestUtils.loadExtension({
      manifest: { permissions: ["tabs", "storage"] },
      async background() {
        await browser.storage.local.set({ k: 1 });
        const { k } = await browser.storage.local.get("k");
        const tabs = await browser.tabs.query({});
        const current = await browser.windows.getCurrent();
        const all = await browser.windows.getAll();
        browser.test.sendMessage("result", {
          k,
          tabs: tabs.map(t => ({
            url: t.url,
            store: t.cookieStoreId,
            active: t.active,
          })),
          windowType: current.type,
          windows: all.length,
        });
      },
    });
    await extension.startup();
    const result = await extension.awaitMessage("result");
    Assert.equal(result.k, 1, "storage works");
    Assert.equal(result.windows, 1, "one window");
    Assert.equal(result.windowType, "normal");
    Assert.ok(
      result.tabs.some(
        t =>
          t.url == PAGE &&
          t.active &&
          t.store == `firefox-container-${space.userContextId}`
      ),
      "the tab is listed with its space's container"
    );
    await extension.unload();
    await closeAllTabs(bridge);
    Assert.ok(tab);
  }
);

add_task(async function test_tabs_create_update_remove_and_events() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Ext tabs");
  await inFront(bridge, app, space);
  const store = `firefox-container-${space.userContextId}`;
  const extension = ExtensionTestUtils.loadExtension({
    manifest: { permissions: ["tabs", "https://example.com/*"] },
    async background() {
      const events = [];
      browser.tabs.onCreated.addListener(tab =>
        events.push(["created", tab.id])
      );
      browser.tabs.onRemoved.addListener(id => events.push(["removed", id]));
      browser.tabs.onActivated.addListener(info =>
        events.push(["activated", info.tabId])
      );
      browser.tabs.onUpdated.addListener((id, change) => {
        if (change.status == "complete") {
          events.push(["updated", id]);
        }
      }, {});
      const created = await browser.tabs.create({
        url: "https://example.com/browser/swell/tests/app/browser/file_blank.html?second",
      });
      browser.test.sendMessage("created", {
        id: created.id,
        store: created.cookieStoreId,
        url: created.url,
      });
      browser.test.onMessage.addListener(async (message, arg) => {
        if (message == "update") {
          const updated = await browser.tabs.update(arg, {
            url: "https://example.com/browser/swell/tests/app/browser/file_blank.html?third",
          });
          browser.test.sendMessage("updated", updated.id);
        } else if (message == "remove") {
          await browser.tabs.remove(arg);
          browser.test.sendMessage("removed", events);
        }
      });
    },
  });
  await extension.startup();
  const created = await extension.awaitMessage("created");
  Assert.equal(created.store, store, "the new tab is in the space's container");
  await TestUtils.waitForCondition(
    () => bridge.tabs(space.id).length == 2,
    "the bridge has the second tab"
  );
  extension.sendMessage("update", created.id);
  await extension.awaitMessage("updated");
  await TestUtils.waitForCondition(
    () => bridge.tabs(space.id).some(t => t.url.endsWith("?third")),
    "the tab was sent to the new address"
  );
  extension.sendMessage("remove", created.id);
  const events = await extension.awaitMessage("removed");
  Assert.deepEqual(
    events.filter(([kind]) => kind == "created" || kind == "removed"),
    [
      ["created", created.id],
      ["removed", created.id],
    ],
    "created and removed events arrived"
  );
  Assert.equal(bridge.tabs(space.id).length, 1, "the tab is gone");
  await extension.unload();
  await closeAllTabs(bridge);
});

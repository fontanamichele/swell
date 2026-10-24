/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* global browser */

// Two copies of one add-on, each made for one space (the id carries the
// container). Each one reports what it can see; anything of the other space
// means the copy is not isolated.

function background() {
  const seen = { webRequest: new Set(), cookieChanges: new Set() };
  browser.runtime.onMessage.addListener((message, sender) => {
    seen.contentScript = sender.tab?.cookieStoreId ?? "no-tab";
  });
  browser.webRequest.onBeforeRequest.addListener(
    details => {
      if (details.url.includes("file_blank.html")) {
        seen.webRequest.add(details.cookieStoreId ?? "none");
      }
    },
    { urls: ["https://example.com/*"] }
  );
  browser.cookies.onChanged.addListener(info =>
    seen.cookieChanges.add(info.cookie.storeId)
  );
  browser.test.onMessage.addListener(async (message, arg) => {
    if (message == "set") {
      await browser.storage.local.set({ k: arg });
      browser.test.sendMessage("set-done");
    } else if (message == "get") {
      const { k } = await browser.storage.local.get("k");
      browser.test.sendMessage("get-done", k ?? null);
    } else if (message == "observe") {
      const out = {};
      out.tabs = [
        ...new Set((await browser.tabs.query({})).map(t => t.cookieStoreId)),
      ];
      out.cookies = {};
      for (const storeId of arg.stores) {
        try {
          const list = await browser.cookies.getAll({ url: arg.page, storeId });
          if (list.length) {
            out.cookies[storeId] = list.map(c => c.value);
          }
        } catch (e) {
          out.cookies[storeId] = `error: ${e.message}`;
        }
      }
      out.webRequest = [...seen.webRequest];
      out.cookieChanges = [...seen.cookieChanges];
      out.contentScript = seen.contentScript ?? null;
      browser.test.sendMessage("observed", out);
    }
  });
  browser.test.sendMessage("ready");
}

function load(id) {
  return ExtensionTestUtils.loadExtension({
    useAddonManager: "temporary",
    manifest: {
      browser_specific_settings: { gecko: { id } },
      permissions: [
        "tabs",
        "cookies",
        "storage",
        "webRequest",
        "https://example.com/*",
      ],
      content_scripts: [
        {
          matches: ["https://example.com/*"],
          js: ["content.js"],
          run_at: "document_idle",
        },
      ],
    },
    files: {
      "content.js": `browser.runtime.sendMessage("hello");`,
    },
    background,
  });
}

add_task(async function test_copies_of_an_add_on_are_per_space() {
  // Two spaces with their own containers in every run; the self-test run
  // only stops binding the second copy.
  const { bridge, app } = await swellApp();
  const a = await freshSpace(app, "Isolation A");
  const b = await freshSpace(app, "Isolation B");
  const storeA = `firefox-container-${a.userContextId}`;
  const storeB = `firefox-container-${b.userContextId}`;
  const copyA = load(`fixture--s${a.userContextId}@swell.test`);
  // The self-test run stands for a build that does not bind copies: the
  // second add-on then has an id of its own and sees every container.
  const copyB = load(
    SHARE_CONTAINER
      ? "fixture-unbound@swell.test"
      : `fixture--s${b.userContextId}@swell.test`
  );
  await copyA.startup();
  await copyA.awaitMessage("ready");
  await copyB.startup();
  await copyB.awaitMessage("ready");

  // A cookie in each space.
  Services.cookies.add(
    "example.com",
    "/",
    "swell",
    "value-a",
    true,
    false,
    false,
    Date.now() / 1000 + 3600,
    { userContextId: a.userContextId },
    Ci.nsICookie.SAMESITE_NONE,
    Ci.nsICookie.SCHEME_HTTPS
  );
  Services.cookies.add(
    "example.com",
    "/",
    "swell",
    "value-b",
    true,
    false,
    false,
    Date.now() / 1000 + 3600,
    { userContextId: b.userContextId },
    Ci.nsICookie.SAMESITE_NONE,
    Ci.nsICookie.SCHEME_HTTPS
  );
  registerCleanupFunction(() => Services.cookies.removeAll());

  // Reload the pages so that content scripts and requests happen.
  await openInSpace(bridge, a.id, PAGE);
  await openInSpace(bridge, b.id, PAGE);
  await app.switchSpace(a.id);

  const observe = async copy => {
    copy.sendMessage("observe", {
      page: PAGE,
      stores: ["firefox-default", storeA, storeB],
    });
    return copy.awaitMessage("observed");
  };
  const seenByA = await observe(copyA);
  const seenByB = await observe(copyB);
  const foreignFor = (seen, own) => {
    const stores = new Set([
      ...seen.tabs,
      ...seen.webRequest,
      ...seen.cookieChanges,
      ...Object.keys(seen.cookies).filter(
        store => !String(seen.cookies[store]).startsWith("error")
      ),
      ...(seen.contentScript ? [seen.contentScript] : []),
    ]);
    stores.delete(own);
    return [...stores];
  };
  Assert.deepEqual(foreignFor(seenByA, storeA), [], "copy A sees only space A");
  const foreign = foreignFor(seenByB, storeB);
  audit(
    "extension copies",
    !foreign.length,
    `the copy of space B sees ${JSON.stringify(foreign)}`
  );
  Assert.ok(seenByA.tabs.includes(storeA), "copy A sees its own tab");

  info("storage.local is separate per copy");
  copyA.sendMessage("set", "from-a");
  await copyA.awaitMessage("set-done");
  copyB.sendMessage("get");
  const inB = await copyB.awaitMessage("get-done");
  // Separate by id, so the self-test cannot make it shared.
  audit("extension storage (by id)", inB === null, `copy B reads ${inB}`);

  await copyA.unload();
  await copyB.unload();
  await closeAllTabs(bridge);
});

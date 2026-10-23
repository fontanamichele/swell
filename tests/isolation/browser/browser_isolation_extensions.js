/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Two derived copies of one fixture add-on, each meant for one container.
// Every observation is a set of cookieStoreIds a copy could see; foreign
// entries (anything but the copy's own store) mean the copy is not isolated.

const PAGE = BASE + "file_blank.html";
const ECHO = BASE + "file_echo_cookie.sjs";
const COPIES = {
  a: { id: "fixture--sa@swell.test", store: "firefox-container-1", ucid: 1 },
  b: { id: "fixture--sb@swell.test", store: "firefox-container-2", ucid: 2 },
};
const STORES = ["firefox-default", "firefox-container-1", "firefox-container-2"];

function background() {
  const seen = {
    contentScripts: new Set(),
    webRequest: new Set(),
    cookieChanges: new Set(),
  };
  browser.runtime.onMessage.addListener((msg, sender) => {
    seen.contentScripts.add(sender.tab?.cookieStoreId ?? "no-tab");
  });
  browser.webRequest.onBeforeRequest.addListener(
    details => {
      if (details.url.includes("file_blank.html")) {
        seen.webRequest.add(details.cookieStoreId ?? "none");
      }
    },
    { urls: ["https://example.com/*"] }
  );
  browser.cookies.onChanged.addListener(info => {
    seen.cookieChanges.add(info.cookie.storeId);
  });

  browser.test.onMessage.addListener(async (msg, arg) => {
    if (msg == "set") {
      await browser.storage.local.set({ k: arg });
      browser.test.sendMessage("set-done");
    } else if (msg == "get") {
      let { k } = await browser.storage.local.get("k");
      browser.test.sendMessage("get-done", k ?? null);
    } else if (msg == "observe") {
      const out = {};
      out.tabs = [
        ...new Set((await browser.tabs.query({})).map(t => t.cookieStoreId)),
      ];
      out.stores = (await browser.cookies.getAllCookieStores()).map(s => s.id);
      out.cookies = {};
      for (let storeId of arg.stores) {
        try {
          let list = await browser.cookies.getAll({ url: arg.page, storeId });
          if (list.length) {
            out.cookies[storeId] = list.map(c => c.value);
          }
        } catch (e) {
          out.cookies[storeId] = `error: ${e.message}`;
        }
      }
      try {
        out.fetch = await (
          await fetch(arg.echo, { credentials: "include", cache: "no-store" })
        ).text();
      } catch (e) {
        out.fetch = `error: ${e.message}`;
      }
      for (let [k, v] of Object.entries(seen)) {
        out[k] = [...v];
      }
      browser.test.sendMessage("observed", out);
    }
  });
  browser.test.sendMessage("ready");
}

function loadCopy({ id }) {
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
        { matches: ["https://example.com/*"], js: ["content.js"] },
      ],
    },
    files: {
      "content.js": `
        document.documentElement.setAttribute("data-copy-" + browser.runtime.id.split("@")[0].slice(-1), "1");
        browser.runtime.sendMessage({ url: location.href });
      `,
    },
    background,
  });
}

function obs(config, copy, question, foreign, detail) {
  info(`OBS|${config}|${copy}|${question}|${foreign.length ? "leaks" : "isolated"}|${detail}`);
  ok(
    !foreign.length,
    `${config} copy ${copy}: ${question} sees only its own space. ${detail}`
  );
}

async function runScenario(config, prefs = []) {
  await SpecialPowers.pushPrefEnv({ set: prefs });
  let exts = {};
  for (let [name, copy] of Object.entries(COPIES)) {
    exts[name] = loadCopy(copy);
    await exts[name].startup();
    await exts[name].awaitMessage("ready");
  }

  let uuidA = WebExtensionPolicy.getByID(COPIES.a.id).mozExtensionHostname;
  let uuidB = WebExtensionPolicy.getByID(COPIES.b.id).mozExtensionHostname;
  isnot(uuidA, uuidB, `${config}: the copies get different moz-extension UUIDs`);

  exts.a.sendMessage("set", "from-a");
  await exts.a.awaitMessage("set-done");
  exts.b.sendMessage("get");
  let leaked = await exts.b.awaitMessage("get-done");
  info(`OBS|${config}|b|storage.local|${leaked === null ? "isolated" : "leaks"}|b reads ${leaked}`);
  is(leaked, null, `${config}: storage.local is separate per copy`);

  let tabs = [];
  for (let ucid of [0, 1, 2]) {
    let tab = await openTabInUserContext(PAGE, ucid);
    await SpecialPowers.spawn(tab.linkedBrowser, [ucid], n => {
      content.document.cookie = `swell=c${n}; path=/`;
    });
    tabs.push(tab);
  }
  // Content scripts and webRequest already ran for the loads above; give
  // asynchronous deliveries a moment before reading the results.
  await new Promise(resolve => setTimeout(resolve, 500)); // eslint-disable-line mozilla/no-arbitrary-setTimeout

  // Direct injection probe: which tabs did each copy's content script touch?
  let injected = { a: [], b: [] };
  for (let [i, tab] of tabs.entries()) {
    let marks = await SpecialPowers.spawn(tab.linkedBrowser, [], () =>
      ["a", "b"].filter(n =>
        content.document.documentElement.hasAttribute(`data-copy-${n}`)
      )
    );
    for (let n of marks) {
      injected[n].push(`firefox-${i ? "container-" + i : "default"}`);
    }
  }

  for (let [name, copy] of Object.entries(COPIES)) {
    exts[name].sendMessage("observe", { stores: STORES, page: PAGE, echo: ECHO });
    let r = await exts[name].awaitMessage("observed");
    const foreign = list => list.filter(s => s != copy.store);
    obs(config, name, "content script injected", foreign(injected[name]), JSON.stringify(injected[name]));
    obs(config, name, "content script messages", foreign(r.contentScripts), JSON.stringify(r.contentScripts));
    obs(config, name, "tabs.query", foreign(r.tabs), JSON.stringify(r.tabs));
    obs(config, name, "cookies.getAllCookieStores", foreign(r.stores), JSON.stringify(r.stores));
    obs(config, name, "cookies.getAll", foreign(Object.keys(r.cookies)), JSON.stringify(r.cookies));
    obs(config, name, "cookies.onChanged", foreign(r.cookieChanges), JSON.stringify(r.cookieChanges));
    obs(config, name, "webRequest", foreign(r.webRequest), JSON.stringify(r.webRequest));
    // The background page's own request: which container's cookie did it carry?
    const owner = `swell=c${copy.ucid}`;
    obs(config, name, "background fetch", r.fetch == owner ? [] : [r.fetch], `Cookie header: "${r.fetch}" (own would be "${owner}")`);
  }

  for (let tab of tabs) {
    BrowserTestUtils.removeTab(tab);
  }
  for (let ext of Object.values(exts)) {
    await ext.unload();
  }
  Services.cookies.removeAll();
  await SpecialPowers.popPrefEnv();
}

add_task(async function test_C0_stock() {
  await runScenario("C0");
});

add_task(async function test_C1_existing_denylist() {
  // Copy a may only use container 1, copy b only container 2.
  await runScenario("C1", [
    ["extensions.userContextIsolation.enabled", true],
    [`extensions.userContextIsolation.${COPIES.a.id}.restricted`, "[0,2]"],
    [`extensions.userContextIsolation.${COPIES.b.id}.restricted`, "[0,1]"],
  ]);
});

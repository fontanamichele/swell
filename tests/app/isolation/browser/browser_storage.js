/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The storage cases of the M0 isolation audit (swell/tests/isolation), driven
// through Swell's own window: two spaces, one container each, the same
// action in both.

add_task(async function test_cookies() {
  const { a, b, tabA, bridge } = await pair();
  await SpecialPowers.spawn(tabA.browser, [], () => {
    content.document.cookie = "swell=a; path=/";
  });
  const cookies = userContextId =>
    Services.cookies.getCookiesFromHost("example.com", { userContextId });
  Assert.equal(
    cookies(a.userContextId).length,
    1,
    "the cookie is stored for space A"
  );
  audit(
    "cookies",
    !cookies(b.userContextId).length,
    `space B has ${cookies(b.userContextId).length}`
  );
  audit(
    "cookies (default container)",
    !cookies(0).length,
    "nothing in container 0"
  );
  await closeAllTabs(bridge);
  Services.cookies.removeAll();
});

add_task(async function test_localStorage() {
  const { tabA, tabB, bridge } = await pair();
  await SpecialPowers.spawn(tabA.browser, [], () =>
    content.localStorage.setItem("swell", "a")
  );
  const value = await SpecialPowers.spawn(tabB.browser, [], () =>
    content.localStorage.getItem("swell")
  );
  audit("localStorage", value === null, `space B reads ${value}`);
  await SpecialPowers.spawn(tabA.browser, [], () =>
    content.localStorage.clear()
  );
  await closeAllTabs(bridge);
});

add_task(async function test_indexedDB() {
  const { tabA, tabB, bridge } = await pair();
  await SpecialPowers.spawn(tabA.browser, [], async () => {
    await new Promise((resolve, reject) => {
      const req = content.indexedDB.open("swell", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("s");
      req.onsuccess = () => {
        const tx = req.result.transaction("s", "readwrite");
        tx.objectStore("s").put("a", "key");
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
  });
  const dbs = await SpecialPowers.spawn(tabB.browser, [], async () => {
    const list = await content.indexedDB.databases();
    return list.map(d => d.name);
  });
  audit("indexedDB", !dbs.includes("swell"), `space B sees ${dbs}`);
  await SpecialPowers.spawn(tabA.browser, [], () => {
    content.indexedDB.deleteDatabase("swell");
  });
  await closeAllTabs(bridge);
});

add_task(async function test_cacheAPI() {
  const { tabA, tabB, bridge } = await pair();
  await SpecialPowers.spawn(tabA.browser, [], async () => {
    const cache = await content.caches.open("swell");
    await cache.put("/swell", new content.Response("a"));
  });
  const has = await SpecialPowers.spawn(tabB.browser, [], () =>
    content.caches.has("swell")
  );
  audit("cacheAPI", !has, `space B has the cache: ${has}`);
  await SpecialPowers.spawn(tabA.browser, [], () =>
    content.caches.delete("swell")
  );
  await closeAllTabs(bridge);
});

add_task(async function test_serviceWorkers() {
  const { tabA, tabB, bridge } = await pair();
  await SpecialPowers.spawn(
    tabA.browser,
    [`${BASE}file_worker.js`],
    async script => {
      await content.navigator.serviceWorker.register(script);
    }
  );
  const registrations = await SpecialPowers.spawn(
    tabB.browser,
    [],
    async () => {
      const regs = await content.navigator.serviceWorker.getRegistrations();
      return regs.length;
    }
  );
  audit(
    "serviceWorkers",
    registrations === 0,
    `space B has ${registrations} registrations`
  );
  await SpecialPowers.spawn(tabA.browser, [], async () => {
    const regs = await content.navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  });
  await closeAllTabs(bridge);
});

add_task(async function test_httpCache() {
  const { tabA, tabB, bridge } = await pair();
  const url = `${BASE}file_counter.sjs`;
  const fetchText = tab =>
    SpecialPowers.spawn(tab.browser, [url], async u =>
      (await content.fetch(u)).text()
    );
  const first = await fetchText(tabA);
  const second = await fetchText(tabA);
  const inB = await fetchText(tabB);
  Assert.equal(second, first, "space A is served from the HTTP cache");
  audit("httpCache", inB !== first, `A=${first} B=${inB}`);
  await closeAllTabs(bridge);
});

add_task(async function test_httpAuth() {
  const { a, b, tabA, tabB, bridge } = await pair();
  const url = `${BASE}file_auth.sjs`;
  const seen = [];
  let cancelUnauthed = false;
  const observer = {
    observe(subject) {
      const channel = subject.QueryInterface(Ci.nsIHttpChannel);
      if (!channel.URI.spec.endsWith("file_auth.sjs")) {
        return;
      }
      let hasAuth = true;
      try {
        channel.getRequestHeader("Authorization");
      } catch (e) {
        hasAuth = false;
      }
      seen.push({
        userContextId: channel.loadInfo.originAttributes.userContextId,
        hasAuth,
      });
      // Avoid the blocking credentials prompt on the unauthenticated request.
      if (cancelUnauthed && !hasAuth && channel.responseStatus == 401) {
        channel.cancel(Cr.NS_BINDING_ABORTED);
      }
    },
  };
  Services.obs.addObserver(observer, "http-on-examine-response");

  await SpecialPowers.spawn(tabA.browser, [url], async u => {
    await new Promise(resolve => {
      const xhr = new content.XMLHttpRequest();
      xhr.open("GET", u, true, "user", "pass");
      xhr.onloadend = resolve;
      xhr.send();
    });
  });
  const plainFetch = tab =>
    SpecialPowers.spawn(tab.browser, [url], async u => {
      try {
        return (await content.fetch(u)).status;
      } catch (e) {
        return "aborted";
      }
    });
  cancelUnauthed = true;
  seen.length = 0;
  const statusA = await plainFetch(tabA);
  const fromA = seen.filter(s => s.userContextId == a.userContextId);
  Assert.equal(statusA, 200, "space A reuses the cached credentials");
  Assert.ok(
    fromA.length && fromA.every(s => s.hasAuth),
    "space A sends the cached Authorization header"
  );

  seen.length = 0;
  await plainFetch(tabB);
  const fromB = seen.filter(s => s.userContextId == b.userContextId);
  Services.obs.removeObserver(observer, "http-on-examine-response");
  audit(
    "httpAuth",
    fromB.length && fromB.every(s => !s.hasAuth),
    `space B requests: ${JSON.stringify(fromB)}`
  );
  await closeAllTabs(bridge);
});
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

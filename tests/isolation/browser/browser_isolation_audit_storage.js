/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PAGE = BASE + "file_blank.html";

add_task(async function test_cookies() {
  let [tabA, tabB] = await openPair(PAGE);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], () => {
    content.document.cookie = "swell=a; path=/";
  });
  let inB = Services.cookies.getCookiesFromHost("example.com", {
    userContextId: CONTAINER_B,
  });
  let inA = Services.cookies.getCookiesFromHost("example.com", {
    userContextId: CONTAINER_A,
  });
  is(inA.length, 1, "Cookie is stored for container A");
  audit("cookies", !inB.length, `container B has ${inB.length} cookies`);
  closeTabs(tabA, tabB);
  Services.cookies.removeAll();
});

add_task(async function test_localStorage() {
  let [tabA, tabB] = await openPair(PAGE);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], () => {
    content.localStorage.setItem("swell", "a");
  });
  let value = await SpecialPowers.spawn(tabB.linkedBrowser, [], () =>
    content.localStorage.getItem("swell")
  );
  audit("localStorage", value === null, `container B reads ${value}`);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], () =>
    content.localStorage.clear()
  );
  closeTabs(tabA, tabB);
});

add_task(async function test_indexedDB() {
  let [tabA, tabB] = await openPair(PAGE);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], async () => {
    await new Promise((resolve, reject) => {
      let req = content.indexedDB.open("swell", 1);
      req.onupgradeneeded = () => req.result.createObjectStore("s");
      req.onsuccess = () => {
        let tx = req.result.transaction("s", "readwrite");
        tx.objectStore("s").put("a", "key");
        tx.oncomplete = () => {
          req.result.close();
          resolve();
        };
      };
      req.onerror = () => reject(req.error);
    });
  });
  let dbs = await SpecialPowers.spawn(tabB.linkedBrowser, [], async () => {
    let list = await content.indexedDB.databases();
    return list.map(d => d.name);
  });
  audit("indexedDB", !dbs.includes("swell"), `container B sees ${dbs}`);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], () => {
    content.indexedDB.deleteDatabase("swell");
  });
  closeTabs(tabA, tabB);
});

add_task(async function test_cacheAPI() {
  let [tabA, tabB] = await openPair(PAGE);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], async () => {
    let cache = await content.caches.open("swell");
    await cache.put("/swell", new content.Response("a"));
  });
  let has = await SpecialPowers.spawn(tabB.linkedBrowser, [], () =>
    content.caches.has("swell")
  );
  audit("cacheAPI", !has, `container B has cache: ${has}`);
  await SpecialPowers.spawn(tabA.linkedBrowser, [], () =>
    content.caches.delete("swell")
  );
  closeTabs(tabA, tabB);
});

add_task(async function test_serviceWorkers() {
  let [tabA, tabB] = await openPair(PAGE);
  await SpecialPowers.spawn(
    tabA.linkedBrowser,
    [BASE + "file_worker.js"],
    async script => {
      await content.navigator.serviceWorker.register(script);
    }
  );
  let regsB = await SpecialPowers.spawn(tabB.linkedBrowser, [], async () => {
    let regs = await content.navigator.serviceWorker.getRegistrations();
    return regs.length;
  });
  audit(
    "serviceWorkers",
    regsB === 0,
    `container B has ${regsB} registrations`
  );
  await SpecialPowers.spawn(tabA.linkedBrowser, [], async () => {
    let regs = await content.navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
  });
  closeTabs(tabA, tabB);
});

add_task(async function test_httpCache() {
  let [tabA, tabB] = await openPair(PAGE);
  let url = BASE + "file_counter.sjs";
  let fetchText = () =>
    SpecialPowers.spawn(gBrowser.selectedBrowser, [url], async u =>
      (await content.fetch(u)).text()
    );
  gBrowser.selectedTab = tabA;
  let first = await fetchText();
  let second = await fetchText();
  gBrowser.selectedTab = tabB;
  let inB = await fetchText();
  is(second, first, "Container A is served from the HTTP cache");
  audit("httpCache", inB !== first, `A=${first} B=${inB}`);
  closeTabs(tabA, tabB);
});

add_task(async function test_httpAuth() {
  let [tabA, tabB] = await openPair(PAGE);
  let url = BASE + "file_auth.sjs";
  let seen = [];
  let cancelUnauthed = false;
  let observer = {
    observe(subject) {
      let channel = subject.QueryInterface(Ci.nsIHttpChannel);
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

  // Authenticate through the challenge flow in A so that the credentials land
  // in the HTTP auth cache.
  await SpecialPowers.spawn(tabA.linkedBrowser, [url], async u => {
    await new Promise(resolve => {
      let xhr = new content.XMLHttpRequest();
      xhr.open("GET", u, true, "user", "pass");
      xhr.onloadend = resolve;
      xhr.send();
    });
  });
  const plainFetch = u =>
    SpecialPowers.spawn(tabA.linkedBrowser, [u], async v => {
      try {
        return (await content.fetch(v)).status;
      } catch (e) {
        return "aborted";
      }
    });
  cancelUnauthed = true;
  seen.length = 0;
  let statusA = await plainFetch(url);
  let fromA = seen.filter(s => s.userContextId == CONTAINER_A);
  is(statusA, 200, "Container A reuses the cached credentials");
  ok(
    fromA.length && fromA.every(s => s.hasAuth),
    "Container A sends the cached Authorization header"
  );

  seen.length = 0;
  await SpecialPowers.spawn(tabB.linkedBrowser, [url], async u => {
    try {
      await content.fetch(u);
    } catch (e) {}
  });
  let fromB = seen.filter(s => s.userContextId == CONTAINER_B);
  Services.obs.removeObserver(observer, "http-on-examine-response");
  audit(
    "httpAuth",
    fromB.length && fromB.every(s => !s.hasAuth),
    `container B requests: ${JSON.stringify(fromB)}`
  );
  closeTabs(tabA, tabB);
});

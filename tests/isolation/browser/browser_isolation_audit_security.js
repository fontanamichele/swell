/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

const PAGE = BASE + "file_blank.html";
const HOST_URI = Services.io.newURI("https://example.com/");

add_task(async function test_hsts() {
  let sss = Cc["@mozilla.org/ssservice;1"].getService(
    Ci.nsISiteSecurityService
  );
  let [tabA, tabB] = await openPair(PAGE);
  await SpecialPowers.spawn(
    tabA.linkedBrowser,
    [BASE + "file_hsts.sjs"],
    async u => (await content.fetch(u)).text()
  );
  // HSTS entries are also keyed by the (http-scheme) partition key.
  const oa = userContextId => ({
    userContextId,
    partitionKey: "(http,example.com)",
  });
  let inA = sss.isSecureURI(HOST_URI, oa(CONTAINER_A));
  let inB = sss.isSecureURI(HOST_URI, oa(CONTAINER_B));
  ok(inA, "HSTS was recorded for container A");
  audit("hsts", !inB, `secure in A=${inA} B=${inB}`);
  sss.resetState(HOST_URI, oa(CONTAINER_A));
  sss.resetState(HOST_URI, oa(CONTAINER_B));
  closeTabs(tabA, tabB);
});

add_task(async function test_certOverrides() {
  let overrides = Cc["@mozilla.org/security/certoverride;1"].getService(
    Ci.nsICertOverrideService
  );
  let [tabA, tabB] = await openPair(PAGE);
  gBrowser.selectedTab = tabA;
  let cert = gBrowser.securityUI.secInfo.serverCert;
  ok(cert, "Got the server certificate");
  overrides.rememberValidityOverride(
    "example.com",
    443,
    { userContextId: CONTAINER_A },
    cert,
    true
  );
  let inA = overrides.hasMatchingOverride(
    "example.com",
    443,
    { userContextId: CONTAINER_A },
    cert,
    {}
  );
  let inB = overrides.hasMatchingOverride(
    "example.com",
    443,
    { userContextId: CONTAINER_B },
    cert,
    {}
  );
  ok(inA, "Override was recorded for container A");
  audit("certOverrides", !inB, `override in A=${inA} B=${inB}`);
  overrides.clearValidityOverride("example.com", 443, {
    userContextId: CONTAINER_A,
  });
  overrides.clearValidityOverride("example.com", 443, {
    userContextId: CONTAINER_B,
  });
  closeTabs(tabA, tabB);
});

function principalFor(userContextId) {
  return Services.scriptSecurityManager.createContentPrincipal(
    Services.io.newURI("https://example.com/"),
    { userContextId }
  );
}

async function checkPermission(label, type, isolateByUserContext) {
  await SpecialPowers.pushPrefEnv({
    set: [["permissions.isolateBy.userContext", isolateByUserContext]],
  });
  let pm = Services.perms;
  let a = principalFor(CONTAINER_A);
  let b = principalFor(CONTAINER_B);
  pm.addFromPrincipal(a, type, pm.ALLOW_ACTION);
  let inA = pm.testPermissionFromPrincipal(a, type);
  let inB = pm.testPermissionFromPrincipal(b, type);
  is(inA, pm.ALLOW_ACTION, `${label}: permission was set for container A`);
  audit(label, inB !== pm.ALLOW_ACTION, `A=${inA} B=${inB}`);
  pm.removeFromPrincipal(a, type);
  pm.removeFromPrincipal(b, type);
  await SpecialPowers.popPrefEnv();
}

add_task(async function test_permissions_default() {
  await checkPermission("permissions(pref off)", "swell-test", false);
});

add_task(async function test_permissions_isolated() {
  await checkPermission("permissions(pref on)", "swell-test", true);
});

add_task(async function test_permissions_forced_strip() {
  await checkPermission("permissions(pref on, cookie)", "cookie", true);
});

add_task(async function test_storage_access_grant() {
  await checkPermission(
    "storageAccessGrant(pref on)",
    "3rdPartyStorage^https://other.example.org",
    true
  );
});

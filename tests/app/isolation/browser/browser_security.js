/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// HSTS state and certificate exceptions are keyed by origin attributes. Stock
// Firefox drops the container from both keys; Swell turns on
// security.hsts.isolate_by_user_context and
// security.cert_override.isolate_by_user_context (patch 0230).

add_task(async function test_hsts() {
  const { tabA, tabB, bridge } = await pair();
  const oaA = { userContextId: tabA.browser.contentPrincipal.userContextId };
  const oaB = { userContextId: tabB.browser.contentPrincipal.userContextId };
  const sss = Cc["@mozilla.org/ssservice;1"].getService(
    Ci.nsISiteSecurityService
  );
  const secure = Services.io.newURI("https://hsts.swell-test.example/");
  const plain = Services.io.newURI("https://hsts.swell-test.example/");
  registerCleanupFunction(() => sss.resetState(secure, oaA));

  sss.processHeader(secure, "max-age=1000", oaA);
  Assert.ok(
    sss.isSecureURI(plain, oaA),
    "HSTS applies in the space that got it"
  );
  audit(
    "HSTS",
    !sss.isSecureURI(plain, oaB),
    `space B treats the host as secure: ${sss.isSecureURI(plain, oaB)}`
  );
  sss.resetState(secure, oaA);
  await closeAllTabs(bridge);
});

add_task(async function test_certificate_exceptions() {
  const { tabA, tabB, bridge } = await pair();
  const oaA = { userContextId: tabA.browser.contentPrincipal.userContextId };
  const oaB = { userContextId: tabB.browser.contentPrincipal.userContextId };
  const cert = tabA.browser.browsingContext.secureBrowserUI.secInfo.serverCert;
  Assert.ok(cert, "the test page has a certificate");
  const overrides = Cc["@mozilla.org/security/certoverride;1"].getService(
    Ci.nsICertOverrideService
  );
  const host = "swell-override.example";
  registerCleanupFunction(() =>
    overrides.clearValidityOverride(host, 443, oaA)
  );

  overrides.rememberValidityOverride(host, 443, oaA, cert, true);
  Assert.ok(
    overrides.hasMatchingOverride(host, 443, oaA, cert, {}),
    "the exception applies in the space that made it"
  );
  const inB = overrides.hasMatchingOverride(host, 443, oaB, cert, {});
  audit("certificate exceptions", !inB, `space B has the exception: ${inB}`);
  overrides.clearValidityOverride(host, 443, oaA);
  await closeAllTabs(bridge);
});

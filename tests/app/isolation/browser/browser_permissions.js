/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Saved site permissions follow the document's principal, whose origin
// attributes carry the container (permissions.isolateBy.userContext).

const TYPES = ["desktop-notification", "geo", "camera", "microphone"];

add_task(async function test_site_permissions() {
  const { tabA, tabB, bridge } = await pair();
  const principalA = tabA.browser.contentPrincipal;
  const principalB = tabB.browser.contentPrincipal;
  registerCleanupFunction(() => {
    for (const type of TYPES) {
      Services.perms.removeByType(type);
    }
  });
  for (const type of TYPES) {
    Services.perms.addFromPrincipal(
      principalA,
      type,
      Services.perms.ALLOW_ACTION
    );
    const seenInB = Services.perms.testExactPermissionFromPrincipal(
      principalB,
      type
    );
    audit(
      `permission ${type}`,
      seenInB == Services.perms.UNKNOWN_ACTION,
      `space B sees ${seenInB}`
    );
    Assert.equal(
      Services.perms.testExactPermissionFromPrincipal(principalA, type),
      Services.perms.ALLOW_ACTION,
      `${type} is granted in space A`
    );
    Services.perms.removeFromPrincipal(principalA, type);
  }
  await closeAllTabs(bridge);
});

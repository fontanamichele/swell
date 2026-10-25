/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// Sites choose between their modern and a basic page by the user agent, and a
// browser that does not say it is a Gecko one (Firefox) gets the basic one.

add_task(async function test_the_user_agent_has_the_firefox_token() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "User agent");
  const tab = await openInSpace(bridge, space.id, `${BASE}file_blank.html`);
  const ua = await SpecialPowers.spawn(tab.browser, [], () => {
    return content.navigator.userAgent;
  });
  Assert.ok(
    /^Mozilla\/5\.0 \(Macintosh; Intel Mac OS X [\d.]+; rv:\d+\.0\) Gecko\/20100101 Firefox\/\d+\.0 Swell\/[\d.]+$/.test(
      ua
    ) || Services.appinfo.OS != "Darwin",
    `the user agent is Firefox's with Swell's name after it: ${ua}`
  );
  Assert.ok(ua.includes(" Firefox/"), "it has the Firefox token");
  await closeAllTabs(bridge);
});

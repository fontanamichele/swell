/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

add_task(async function test_print_opens_the_print_dialog_over_the_page() {
  const { bridge, app } = await swellApp();
  const space = await freshSpace(app, "Print");
  const tab = await openInSpace(bridge, space.id, `${BASE}file_links.html`);

  app.print();
  await rendered(
    () =>
      [
        ...document.querySelectorAll(
          ".dialogStack:not([inactive]) .dialogFrame"
        ),
      ].some(f => f.contentDocument?.documentURI?.includes("print.html")),
    "the print dialog opens over the page"
  );
  await rendered(
    () => document.querySelector(".printPreviewBrowser"),
    "a print preview is made"
  );
  Assert.ok(tab.browser, "still the same page");

  window.gBrowser.getTabDialogBox(tab.browser).abortAllDialogs();
  await closeAllTabs(bridge);
});

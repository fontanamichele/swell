/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Receives permission requests from web content (location, notifications,
 * ...) and hands them to the Swell window that hosts the page.
 */
export function ContentPermissionPrompt() {}

ContentPermissionPrompt.prototype = {
  classID: Components.ID("{7e54622e-d679-4b4b-82ac-0ec57c33e5f9}"),

  QueryInterface: ChromeUtils.generateQI(["nsIContentPermissionPrompt"]),

  prompt(request) {
    const window = request.element?.documentGlobal;
    if (!window?.SwellApp) {
      request.cancel();
      return;
    }
    window.SwellApp.ready.then(
      ({ app }) => app.permissions.ask(request),
      () => request.cancel()
    );
  },
};

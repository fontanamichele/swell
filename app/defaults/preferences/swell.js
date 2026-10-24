/* global pref */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

pref("toolkit.defaultChromeURI", "chrome://swell/content/window.xhtml");
pref("toolkit.defaultChromeFeatures", "chrome,dialog=no,all,resizable");
pref("privacy.userContext.enabled", true);
pref("permissions.isolateBy.userContext", true);
pref("places.history.enabled", false);

// Every link and window.open becomes a tab of the opener's space.
pref("browser.link.open_newwindow", 3);
pref("browser.link.open_newwindow.restriction", 0);

// Downloads go straight to the user's Downloads folder.
pref("browser.download.useDownloadDir", true);
pref("browser.download.folderList", 1);

// Find in page.
pref("accessibility.typeaheadfind", false);
pref("accessibility.typeaheadfind.timeout", 5000);
pref("accessibility.typeaheadfind.linksonly", false);
pref("accessibility.typeaheadfind.flashBar", 1);

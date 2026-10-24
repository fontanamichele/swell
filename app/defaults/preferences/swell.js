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

// Nothing here talks to Mozilla or Google on its own. An idle first run makes
// no request (tests/e2e/network_silence.py); these keep it so if a service
// that is currently not started ever gets started. Remote Settings stays:
// read-only blocklist and revocation downloads.
pref("network.connectivity-service.enabled", false);
pref("network.captive-portal-service.enabled", false);
pref("captivedetect.canonicalURL", "");
pref("browser.region.update.enabled", false);
pref("geo.provider.network.url", "");
pref("dom.push.enabled", false);
pref("toolkit.telemetry.server", "");
pref("toolkit.telemetry.unified", false);
pref("datareporting.healthreport.uploadEnabled", false);
pref("media.gmp-manager.url", "");
pref("media.gmp-manager.url.override", "");
pref("browser.safebrowsing.downloads.enabled", false);
pref("browser.safebrowsing.downloads.remote.enabled", false);
pref("network.trr.mode", 5);

// Find in page.
pref("accessibility.typeaheadfind", false);
pref("accessibility.typeaheadfind.timeout", 5000);
pref("accessibility.typeaheadfind.linksonly", false);
pref("accessibility.typeaheadfind.flashBar", 1);

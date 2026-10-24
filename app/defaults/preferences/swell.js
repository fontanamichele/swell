/* global pref */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

pref("toolkit.defaultChromeURI", "chrome://swell/content/window.xhtml");
pref("toolkit.defaultChromeFeatures", "chrome,dialog=no,all,resizable");
pref("privacy.userContext.enabled", true);
pref("permissions.isolateBy.userContext", true);

// Visits are recorded with the container they happened in, and :visited only
// counts visits of the asking container (patch 0200). Nothing lists history
// across spaces. The command bar reads the core's own per-identity history.
pref("places.history.enabled", true);
pref("places.history.isolate_by_user_context", true);
pref("places.semanticHistory.featureGate", false);

// What was typed into forms stays with the space it was typed in (patch 0210).
pref("browser.formfill.isolate_by_user_context", true);

// Addresses and cards are kept per space (patch 0211), the prompt to save
// them is Swell's own, and autofill is on everywhere.
pref("extensions.formautofill.isolate_by_user_context", true);
pref(
  "extensions.formautofill.prompterModuleURI",
  "moz-src:///swell/app/modules/AutofillPrompter.sys.mjs"
);
pref("extensions.formautofill.addresses.supported", "on");
pref("extensions.formautofill.creditCards.supported", "on");
// Firefox's trial copy of cards into its Rust store; Swell keeps its own files.
pref(
  "extensions.formautofill.creditCards.storage.rust.runMigrationTest",
  false
);
pref("extensions.formautofill.addresses.storage.rust.runMigrationTest", false);

// HSTS state and certificate exceptions belong to one space (patch 0500).
pref("security.hsts.isolate_by_user_context", true);
pref("security.cert_override.isolate_by_user_context", true);

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

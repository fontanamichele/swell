/* global pref */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

pref("toolkit.defaultChromeURI", "chrome://swell/content/window.xhtml");
pref("toolkit.defaultChromeFeatures", "chrome,dialog=no,all,resizable");
pref("privacy.userContext.enabled", true);

// Say "Firefox/<version>" in the user agent, before our own name. Sites choose
// their modern or a basic page by it, and Google serves the basic one to a
// browser it does not know (the same engine and version as Firefox's).
pref("general.useragent.compatMode.firefox", true);
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

// Saved logins are kept per space in the core, encrypted with a key of the
// space that the system keychain holds (patch 0220).
pref("signon.isolate_by_user_context", true);
pref(
  "signon.storageModuleURI",
  "moz-src:///swell/app/modules/SwellLoginStorage.sys.mjs"
);
pref(
  "signon.prompterModuleURI",
  "moz-src:///swell/app/modules/LoginPrompter.sys.mjs"
);

// An add-on is installed once per space, as a copy with an id of its own that
// carries the space's container. The copy is not signed (its id changed), so
// signatures are not required; ExtensionInstaller checks the original's.
pref("xpinstall.signatures.required", false);

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

// macOS: make the whole window transparent (patch 0600) so that the system
// sidebar material shows through where the page leaves it clear. Off: the
// material already shows without it, and how the shadow and corners look with
// it has not been judged.
pref("swell.window.transparent", false);

// Scrollbars float over what they scroll and are thin, as with a trackpad,
// even when a mouse is what the system sees: nothing is made narrower by them.
pref("ui.useOverlayScrollbars", 1);
pref("ui.allowOverlayScrollbarsOverlap", 1);

// The toolbox of the developer tools is a window of its own: the other places
// for it, under and beside the page, are made by the browser window of Firefox.
pref("devtools.toolbox.host", "window");
pref("devtools.toolbox.previousHost", "window");

// The project on GitHub whose releases "Check for updates" reads, and whether the
// pre-releases (the alpha) count. Nothing is sent unless the user presses the button.
pref("swell.update.repository", "ivantacca/swell");
pref("swell.update.channel", "alpha");

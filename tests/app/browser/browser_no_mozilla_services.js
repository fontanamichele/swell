/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The default prefs in app/defaults/preferences/swell.js; the harness runs
// with them unless a manifest overrides one.
const OFF = {
  "network.connectivity-service.enabled": false,
  "network.captive-portal-service.enabled": false,
  "browser.region.update.enabled": false,
  "dom.push.enabled": false,
  "toolkit.telemetry.unified": false,
  "datareporting.healthreport.uploadEnabled": false,
  "browser.safebrowsing.downloads.enabled": false,
};
const EMPTY = [
  "captivedetect.canonicalURL",
  "geo.provider.network.url",
  "toolkit.telemetry.server",
  "media.gmp-manager.url",
  "media.gmp-manager.url.override",
];

add_task(function test_mozilla_services_are_off() {
  for (const [name, value] of Object.entries(OFF)) {
    is(Services.prefs.getBoolPref(name, null), value, `${name} is off`);
  }
  for (const name of EMPTY) {
    // The harness points these at its own server on 127.0.0.1.
    const value = Services.prefs.getStringPref(name, null);
    ok(
      value === "" || /^https?:\/\/127\.0\.0\.1[:/]/.test(value),
      `${name} has no external URL (${value})`
    );
  }
  is(Services.prefs.getIntPref("network.trr.mode"), 5, "DoH is explicitly off");
});

add_task(function test_build_has_no_mozilla_services() {
  for (const flag of [
    "MOZ_TELEMETRY_REPORTING",
    "MOZ_UPDATER",
    "MOZ_CRASHREPORTER",
  ]) {
    ok(!AppConstants[flag], `${flag} is not compiled in`);
  }
});

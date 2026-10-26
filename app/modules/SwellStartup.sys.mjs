/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What has to be in place before the first window opens and the first content process
 * starts: a process that starts before the spell checker knows its dictionary never
 * learns of it, and its pages are not checked at all.
 */
export function SwellStartup() {}

SwellStartup.prototype = {
  classID: Components.ID("{3b8f6a52-0f0a-4a43-9a0e-6d2f0c4b7e11}"),

  QueryInterface: ChromeUtils.generateQI(["nsIObserver"]),

  observe(subject, topic) {
    if (topic == "profile-after-change") {
      // The only dictionary in the tree. Firefox registers its dictionaries from a list
      // of built-in add-ons that Swell does not have.
      Cc["@mozilla.org/spellchecker/engine;1"]
        .getService(Ci.mozISpellCheckingEngine)
        .addDictionary(
          "en-US",
          Services.io.newURI("resource://gre/dictionaries/en-US.aff")
        );
    }
  },
};

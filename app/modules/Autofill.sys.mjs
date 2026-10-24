/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Starts the toolkit's address and credit card autofill. In Firefox a
// built-in add-on does this (browser/extensions/formautofill/api.js); Swell
// has no such add-on, so the window calls startAutofill() itself.

import { FormAutofillStatus } from "resource://autofill/FormAutofillParent.sys.mjs";
import { getFormAutofillStorageFor } from "resource://autofill/FormAutofillStorage.sys.mjs";

let started = false;

export function startAutofill() {
  if (started) {
    return;
  }
  started = true;

  // Web content looks at this to see whether autocomplete tokens are supported.
  Services.prefs.setBoolPref("dom.forms.autocomplete.formautofill", true);
  FormAutofillStatus.init();

  ChromeUtils.registerWindowActor("FormAutofill", {
    parent: {
      esModuleURI: "resource://autofill/FormAutofillParent.sys.mjs",
    },
    child: {
      esModuleURI: "resource://autofill/FormAutofillChild.sys.mjs",
      events: {
        focusin: { capture: true },
        "form-changed": { createActor: false },
        "form-submission-detected": { createActor: false },
      },
    },
    allFrames: true,
    safeForUntrustedWebProcess: true,
  });
}

/**
 * The storage of one container: its addresses and credit cards, ready to use.
 *
 * @param {number} userContextId
 */
export async function autofillStorageFor(userContextId) {
  const storage = getFormAutofillStorageFor(userContextId);
  await storage.initialize();
  return storage;
}

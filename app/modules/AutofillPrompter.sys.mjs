/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What FormAutofillParent asks when a submitted form holds an address or a
// card worth keeping. Firefox answers with a doorhanger; Swell's window
// answers through the handler it registers here
// (extensions.formautofill.prompterModuleURI names this module).

let handler = null;

export const AutofillPromptHandler = {
  /**
   * @param {Function} fn Called with `{type, browser, update, oldRecord,
   *   newRecord}`; resolves with "save", "create" (save as a new record when
   *   updating), "disable" or anything else for "not now".
   */
  set(fn) {
    handler = fn;
  },
};

const ADDRESS = "address";
const CREDIT_CARD = "creditCard";

const DISABLE_PREFS = {
  [ADDRESS]: "extensions.formautofill.addresses.capture.enabled",
  [CREDIT_CARD]: "extensions.formautofill.creditCards.enabled",
};

async function promptToSave(type, browser, storage, { oldRecord, newRecord }) {
  if (!browser || !handler) {
    return;
  }
  const update = !!Object.keys(oldRecord).length;
  const answer = await handler({
    type,
    browser,
    update,
    oldRecord,
    newRecord,
  });
  if (answer == "disable") {
    Services.prefs.setBoolPref(DISABLE_PREFS[type], false);
    return;
  }
  if (answer != "save" && answer != "create") {
    return;
  }
  let guid;
  if (update && answer == "save") {
    guid = oldRecord.guid;
    await storage.update(guid, newRecord, true);
  } else {
    guid = await storage.add(newRecord);
  }
  await storage.notifyUsed(guid);
}

export const FormAutofillPrompter = {
  promptToSaveAddress(browser, storage, flowId, records) {
    return promptToSave(ADDRESS, browser, storage, records);
  },

  promptToSaveCreditCard(browser, storage, flowId, records) {
    return promptToSave(CREDIT_CARD, browser, storage, records);
  },
};

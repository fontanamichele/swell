/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// What FormAutofillParent asks when a submitted form holds an address or a
// card worth keeping. Firefox answers with a doorhanger; Swell's window
// answers through the handler it registers here
// (extensions.formautofill.prompterModuleURI names this module).

import { AutofillDataTypes } from "resource://gre/modules/shared/AutofillDataTypes.sys.mjs";

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

export const FormAutofillPrompter = {
  async promptToSave(
    type,
    browser,
    storage,
    flowId,
    { oldRecord = {}, newRecord }
  ) {
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
      const descriptor = AutofillDataTypes.get(type);
      Services.prefs.setBoolPref(
        type == AutofillDataTypes.ADDRESS
          ? `extensions.formautofill.${descriptor.prefKey}.capture.enabled`
          : descriptor.enabledPref,
        false
      );
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
  },
};

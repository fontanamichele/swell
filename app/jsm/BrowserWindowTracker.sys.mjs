/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Places looks this module up while recording a visit
// (History::VisitURI imports resource:///modules/BrowserWindowTracker.sys.mjs)
// and crashes the process if the file does not exist. Swell has no tab strip
// to search: no browser is ever found, and the visit is recorded without the
// search-engine tagging that only Firefox's address bar uses.
export const BrowserWindowTracker = {
  QueryInterface: ChromeUtils.generateQI(["nsIBrowserWindowTracker"]),

  getAllVisibleTabs() {
    return [];
  },

  getBrowserById() {
    return null;
  },
};

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where the WebExtension platform layer (extensions/ext-swell.js) finds
// Swell's window and its engine bridge. The window registers itself.

export const SwellWindows = {
  window: null,
  bridge: null,

  register(window, bridge) {
    this.window = window;
    this.bridge = bridge;
  },
};

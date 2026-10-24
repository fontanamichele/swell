/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The parts of Swell's extension APIs that live in the extension's own
// process (tabs.connect and tabs.sendMessage talk to the messenger there).

extensions.registerModules({
  tabs: {
    url: "chrome://swellext/content/child/ext-tabs.js",
    scopes: ["addon_child"],
    paths: [["tabs"]],
  },
});

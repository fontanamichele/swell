/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  WebRTCChild: "moz-src:///browser/actors/WebRTCChild.sys.mjs",
});

// The per-process half of camera and microphone access. Firefox registers it
// as "BrowserProcess" (browser/actors/BrowserProcessChild.sys.mjs), together
// with things Swell does not have; this hands the WebRTC notifications to
// Firefox's own WebRTCChild, which talks to SwellMediaParent.
/**
 *
 */
export class SwellProcessChild extends JSProcessActorChild {
  observe(subject, topic, data) {
    lazy.WebRTCChild.observe(subject, topic, data);
  }
}

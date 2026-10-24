/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The parent side of camera, microphone and screen sharing for a page.
// Firefox's WebRTCChild (unmodified) turns getUserMedia requests into
// "webrtc:Request" messages and waits for "webrtc:Allow" or "webrtc:Deny";
// Firefox answers them in browser/actors/WebRTCParent.sys.mjs and
// webrtcUI.sys.mjs, which need its window. This answers them for Swell's.
//
// Saved choices are permissions of the page's origin in the page's
// container, so they belong to one space (permissions.isolateBy.userContext).

const ALLOW = Ci.nsIPermissionManager.ALLOW_ACTION;
const DENY = Ci.nsIPermissionManager.DENY_ACTION;

// What the window shows and answers. The window registers it.
let ui = null;

export const MediaPromptHandler = {
  /**
   * @param {object} handler
   * @param {Function} handler.ask `({browser, origin, request}) =>` an answer
   *   `{allow, devices, remember}`, or null when the page is not asked now.
   * @param {Function} handler.update `(browser, state)` the sharing state of a
   *   page changed; `state.remove` when it stopped.
   * @param {Function} handler.cancel `(browser, callID)` the request is moot.
   */
  set(handler) {
    ui = handler;
  },
};

const KIND_PERMISSION = new Map([
  ["Camera", "camera"],
  ["Microphone", "microphone"],
]);

/**
 *
 */
export class WebRTCParent extends JSWindowActorParent {
  get #browser() {
    return this.browsingContext?.top.embedderElement ?? null;
  }

  get #principal() {
    return this.browsingContext?.top.currentWindowGlobal?.documentPrincipal;
  }

  receiveMessage({ name, data }) {
    switch (name) {
      case "rtcpeer:Request":
        // A peer connection needs no device; the page may make one.
        this.sendAsyncMessage("rtcpeer:Allow", {
          callID: data.callID,
          windowID: data.windowID,
        });
        break;
      case "webrtc:Request":
        return this.#request(data);
      case "webrtc:CancelRequest":
        ui?.cancel(this.#browser, data);
        break;
      case "webrtc:UpdateIndicators":
        ui?.update(this.#browser, data, this);
        break;
      case "webrtc:StopRecording":
      case "rtcpeer:CancelRequest":
        break;
    }
    return undefined;
  }

  /**
   * Stops what a page is sharing.
   *
   * @param {number} windowId The inner window id of the page
   */
  stopSharing(windowId) {
    this.sendAsyncMessage("webrtc:StopSharing", windowId);
  }

  muteCamera(windowId, mute) {
    this.sendAsyncMessage(
      mute ? "webrtc:MuteCamera" : "webrtc:UnmuteCamera",
      windowId
    );
  }

  muteMicrophone(windowId, mute) {
    this.sendAsyncMessage(
      mute ? "webrtc:MuteMicrophone" : "webrtc:UnmuteMicrophone",
      windowId
    );
  }

  #deny(request) {
    this.sendAsyncMessage("webrtc:Deny", {
      callID: request.callID,
      windowID: request.windowID,
    });
  }

  #allow(request, devices) {
    this.sendAsyncMessage("webrtc:Allow", {
      callID: request.callID,
      windowID: request.windowID,
      devices,
      suppressNotifications: false,
    });
  }

  async #request(request) {
    const principal = this.#principal;
    const browser = this.#browser;
    if (!principal || !browser || !ui || !request.secure) {
      this.#deny(request);
      return;
    }

    // Only a page on its own can ask for a speaker or the audio of a screen.
    const kinds = request.requestTypes;
    const saved = kinds.map(kind => {
      const permission = KIND_PERMISSION.get(kind);
      return permission
        ? Services.perms.testExactPermissionFromPrincipal(principal, permission)
        : Services.perms.UNKNOWN_ACTION;
    });
    if (saved.includes(DENY)) {
      this.#deny(request);
      return;
    }
    const first = devices => (devices.length ? [devices[0].deviceIndex] : []);
    if (
      kinds.every(kind => KIND_PERMISSION.has(kind)) &&
      saved.every(state => state == ALLOW)
    ) {
      this.#allow(request, [
        ...first(request.videoInputDevices),
        ...first(request.audioInputDevices),
      ]);
      return;
    }

    const answer = await ui.ask({
      browser,
      origin: principal.originNoSuffix,
      request,
    });
    if (!answer?.allow) {
      this.#deny(request);
      if (answer?.remember) {
        for (const kind of kinds) {
          const permission = KIND_PERMISSION.get(kind);
          if (permission) {
            Services.perms.addFromPrincipal(
              principal,
              permission,
              DENY,
              Services.perms.EXPIRE_NEVER
            );
          }
        }
      }
      return;
    }
    if (answer.remember) {
      for (const kind of kinds) {
        const permission = KIND_PERMISSION.get(kind);
        if (permission) {
          Services.perms.addFromPrincipal(
            principal,
            permission,
            ALLOW,
            Services.perms.EXPIRE_NEVER
          );
        }
      }
    }
    this.#allow(request, answer.devices);
  }
}

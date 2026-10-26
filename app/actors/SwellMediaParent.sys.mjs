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

const lazy = {};
ChromeUtils.defineLazyGetter(lazy, "OSPermissions", () =>
  Cc["@mozilla.org/ospermissionrequest;1"].getService(Ci.nsIOSPermissionRequest)
);

const ALLOW = Ci.nsIPermissionManager.ALLOW_ACTION;
const DENY = Ci.nsIPermissionManager.DENY_ACTION;
const VIDEO_CAPTURE = "MediaManagerVideo";

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

  // Answers yes once the system lets Swell use the devices. On macOS the system asks the
  // user the first time (the page's permission and the system's are two things), and
  // without asking, the capture fails with NotReadableError.
  async #allow(request, devices) {
    const kinds = request.requestTypes;
    const allowed = await this.#systemAllows(
      kinds.includes("Camera"),
      kinds.includes("Microphone"),
      kinds.includes("Screen")
    );
    if (!allowed) {
      this.sendAsyncMessage("webrtc:Deny", {
        callID: request.callID,
        windowID: request.windowID,
        noOSPermission: true,
      });
      return;
    }
    // The camera service lets a page capture only if its origin holds this permission,
    // which Firefox's prompt code sets when the user allows. One request's worth; it is
    // removed at the start of the next one.
    if (kinds.includes("Camera") && this.#principal) {
      Services.perms.addFromPrincipal(
        this.#principal,
        VIDEO_CAPTURE,
        ALLOW,
        Services.perms.EXPIRE_SESSION
      );
    }
    this.sendAsyncMessage("webrtc:Allow", {
      callID: request.callID,
      windowID: request.windowID,
      devices,
      suppressNotifications: false,
    });
  }

  async #systemAllows(camera, microphone, screen) {
    // Fake devices need no permission, and the dialog cannot be answered in a test.
    if (
      !screen &&
      Services.prefs.getBoolPref("media.navigator.streams.fake", false)
    ) {
      return true;
    }
    const OSPermissions = lazy.OSPermissions;
    const asked = async (state, request) => {
      if (
        state == OSPermissions.PERMISSION_STATE_DENIED ||
        state == OSPermissions.PERMISSION_STATE_RESTRICTED
      ) {
        return false;
      }
      return state == OSPermissions.PERMISSION_STATE_NOTDETERMINED
        ? await request()
        : true;
    };
    const cameraState = {};
    const microphoneState = {};
    if (camera || microphone) {
      OSPermissions.getMediaCapturePermissionState(
        cameraState,
        microphoneState
      );
    }
    if (
      camera &&
      !(await asked(cameraState.value, () =>
        OSPermissions.requestVideoCapturePermission()
      ))
    ) {
      return false;
    }
    if (
      microphone &&
      !(await asked(microphoneState.value, () =>
        OSPermissions.requestAudioCapturePermission()
      ))
    ) {
      return false;
    }
    if (screen) {
      const screenState = {};
      OSPermissions.getScreenCapturePermissionState(screenState);
      if (screenState.value == OSPermissions.PERMISSION_STATE_DENIED) {
        OSPermissions.maybeRequestScreenCapturePermission();
        return false;
      }
    }
    return true;
  }

  async #request(request) {
    const principal = this.#principal;
    const browser = this.#browser;
    // What the last allowed request left behind is not for this one.
    if (principal) {
      Services.perms.removeFromPrincipal(principal, VIDEO_CAPTURE);
    }
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

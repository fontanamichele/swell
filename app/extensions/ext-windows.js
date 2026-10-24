/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

// The windows API for an application with one window: it can be read and
// focused, and made bigger or smaller, but not opened or closed by an
// extension.

this.windows = class extends ExtensionAPIPersistent {
  PERSISTENT_EVENTS = {
    onFocusChanged({ fire }) {
      const listener = (eventName, windowId) => fire.async(windowId);
      windowTracker.on("window-focus", listener);
      return {
        unregister() {
          windowTracker.off("window-focus", listener);
        },
        convert(_fire) {
          fire = _fire;
        },
      };
    },
  };

  getAPI(context) {
    const { extension } = context;
    const { windowManager } = extension;
    const extensionApi = this;
    const module = "windows";

    return {
      windows: {
        onCreated: new EventManager({
          context,
          name: "windows.onCreated",
          register: () => () => {},
        }).api(),
        onRemoved: new EventManager({
          context,
          name: "windows.onRemoved",
          register: () => () => {},
        }).api(),
        onFocusChanged: new EventManager({
          context,
          module,
          event: "onFocusChanged",
          extensionApi,
        }).api(),

        get(windowId, getInfo) {
          const window = windowManager.get(windowId, context);
          if (!window) {
            throw new ExtensionError(`Invalid window ID: ${windowId}`);
          }
          return window.convert(getInfo);
        },

        getCurrent(getInfo) {
          const window = context.currentWindow || windowTracker.topWindow;
          return windowManager.getWrapper(window).convert(getInfo);
        },

        getLastFocused(getInfo) {
          return windowManager
            .getWrapper(windowTracker.topWindow)
            .convert(getInfo);
        },

        getAll(getInfo) {
          return Array.from(windowManager.getAll(context), window =>
            window.convert(getInfo)
          );
        },

        create() {
          throw new ExtensionError(
            "Swell has one window; it cannot be created"
          );
        },

        async update(windowId, updateInfo) {
          const window = windowManager.get(windowId, context);
          if (!window) {
            throw new ExtensionError(`Invalid window ID: ${windowId}`);
          }
          if (updateInfo.focused) {
            window.window.focus();
          }
          if (updateInfo.state !== null && updateInfo.state !== undefined) {
            window.state = updateInfo.state;
          }
          return window.convert();
        },

        remove() {
          throw new ExtensionError("Swell has one window; it cannot be closed");
        },
      },
    };
  }
};

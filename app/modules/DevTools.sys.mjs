/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The developer tools (the toolbox, with the inspector, console, debugger and
// the rest) for the tabs of the window. The toolbox is its own window: the
// other places for it, under or beside the page, are made by the browser
// window of Firefox.

const lazy = {};

ChromeUtils.defineLazyGetter(lazy, "gDevTools", () => {
  const { require } = ChromeUtils.importESModule(
    "resource://devtools/shared/loader/Loader.sys.mjs"
  );
  return require("devtools/client/framework/devtools").gDevTools;
});

const HOST = "window";

export const DevTools = {
  /**
   * Opens the toolbox of a tab, on `toolId` (the inspector, the console...).
   *
   * @param {object} tab A tab of the engine bridge.
   * @param {string} [toolId]
   * @returns {Promise<object|undefined>} The toolbox.
   */
  openToolbox(tab, toolId = "inspector") {
    return lazy.gDevTools.showToolboxForTab(tab, { toolId, hostType: HOST });
  },

  /**
   * Opens the inspector on one element of the page of a tab.
   *
   * @param {object} tab
   * @param {object} contentDomReference From ContentDOMReference.get(element).
   */
  inspectNode(tab, contentDomReference) {
    return lazy.gDevTools.inspectNode(tab, contentDomReference);
  },

  /**
   * @param {object} tab
   * @returns {object|undefined} The toolbox of the tab, if it has one.
   */
  toolboxFor(tab) {
    return lazy.gDevTools.getToolboxForTab(tab);
  },
};

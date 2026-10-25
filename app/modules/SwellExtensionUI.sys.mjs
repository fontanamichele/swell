/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Where the extension APIs that have a face (extensions/ext-menus.js,
// extensions/ext-browserAction.js) and the window that draws it find each
// other. The API scripts run in the extension framework's global, the window
// in its own; this module is shared by both.

export const SwellExtensionUI = {
  /**
   * Context menu contributors. Each is `{ items(contextData), hidden() }`, where
   * `items` returns what the window's ContextMenu shows for a right-click.
   */
  menuProviders: new Set(),

  /**
   * Browser actions by extension id: `{ extension, describe(nativeTab),
   * activate(nativeTab) }`. `describe` returns `{ title, icon, badgeText,
   * badgeColor, badgeTextColor, enabled, popup }`, `activate` returns the popup
   * URL to open, if the action has one, and otherwise fires the click.
   */
  actions: new Map(),

  listeners: new Set(),

  menuItemsFor(contextData) {
    const items = [];
    for (const provider of this.menuProviders) {
      const own = provider.items(contextData);
      if (own.length) {
        items.push({ separator: true }, ...own);
      }
    }
    return items;
  },

  menuHidden() {
    for (const provider of this.menuProviders) {
      provider.hidden();
    }
  },

  onActionsChanged(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  },

  actionsChanged() {
    for (const listener of this.listeners) {
      listener();
    }
  },
};

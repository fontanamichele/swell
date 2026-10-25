/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * What the menu bar of the system does. The menus are the `<menubar>` of
 * window.xhtml, which macOS shows as its own; an item names its action in
 * `data-action`. They hold what the sidebar has no room for: the places that
 * list what a space keeps (downloads, add-ons, passwords, addresses and
 * cards) and importing from Arc.
 */
export class MenuBar {
  #actions;

  constructor(app) {
    this.#actions = {
      "new-tab": () => app.commandBar.open({ mode: "new" }),
      "new-space": () => app.spaceEditor.create(),
      "close-tab": () =>
        app.selectedTab?.liveTab &&
        app.run(() => app.bridge.closeTab(app.selectedTab.liveTab)),
      "toggle-sidebar": () => app.sidebarLayout.toggle(),
      reload: () => app.bridge.reload(),
      downloads: () => app.downloads.show(),
      extensions: () => app.extensions.show(),
      passwords: () => app.passwords.show(),
      autofill: () => app.autofill.show(),
      "import-arc": () => app.chooseArcFile(),
    };
    app.document
      .getElementById("main-menubar")
      ?.addEventListener("command", event => {
        const action = event.target.dataset?.action;
        this.#actions[action]?.();
      });
  }
}

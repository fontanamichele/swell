/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { Sidebar } from "chrome://swell/content/sidebar.mjs";
import { CommandBar } from "chrome://swell/content/commandbar.mjs";
import { ContextMenu } from "chrome://swell/content/menu.mjs";
import { Toasts } from "chrome://swell/content/toasts.mjs";
import { PermissionBar } from "chrome://swell/content/permissions.mjs";
import { DownloadsPanel } from "chrome://swell/content/downloads.mjs";
import { AutofillUI } from "chrome://swell/content/autofill.mjs";
import { PasswordsUI } from "chrome://swell/content/passwords.mjs";
import { ExtensionsUI } from "chrome://swell/content/extensions.mjs";
import { MediaUI } from "chrome://swell/content/media.mjs";
import { SidebarLayout } from "chrome://swell/content/sidebar-layout.mjs";
import { NavBar } from "chrome://swell/content/navbar.mjs";
import { SpaceEditor } from "chrome://swell/content/space-editor.mjs";
import { ExtensionActionsUI } from "chrome://swell/content/extension-actions.mjs";

const { SwellExtensionUI } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellExtensionUI.sys.mjs"
);

const IS_MAC = Services.appinfo.OS == "Darwin";

// The window: holds what the core says about the active space, keeps track of
// which saved tabs are open, and turns clicks and keys into core and bridge
// commands. It never decides anything about state itself.
/**
 *
 */
export class App {
  // Takes the window's document as `doc`, the core client, the engine bridge,
  // the tree state, the UniFFI `Icon` enum (for creating spaces) and the
  // toolkit downloads API.
  constructor({ doc, core, bridge, state, Icon, Downloads }) {
    this.document = doc;
    this.core = core;
    this.bridge = bridge;
    this.state = state;
    this.Icon = Icon;
    this.Downloads = Downloads;
    this.toasts = new Toasts(doc);
    this.spaces = [];
    this.activeSpaceId = null;
    this.openTabs = new Map();
    this.selectedNode = null;
    this.selectedTab = null;
    this.menu = new ContextMenu(this);
    this.sidebar = new Sidebar(this);
    this.commandBar = new CommandBar(this);
    this.permissions = new PermissionBar(this);
    this.downloads = new DownloadsPanel(this);
    this.autofill = new AutofillUI(this);
    this.passwords = new PasswordsUI(this);
    this.extensions = new ExtensionsUI(this);
    this.extensionActions = new ExtensionActionsUI(this);
    this.media = new MediaUI(this);
    this.spaceEditor = new SpaceEditor(this);
    this.navBar = new NavBar(this);
    this.sidebarLayout = new SidebarLayout(this);
    this.#renderQueued = false;
  }

  #renderQueued;

  get space() {
    return this.spaces.find(space => space.id == this.activeSpaceId) ?? null;
  }

  // Roots that hold tabs only, where folders may not be dropped.
  get tabsOnlyRoots() {
    const space = this.space;
    return new Set(space ? [space.todayRoot, space.favoritesRoot] : []);
  }

  async init() {
    this.spaces = await this.core.listSpaces();
    this.activeSpaceId = this.bridge.activeSpace ?? this.spaces[0]?.id ?? null;
    await this.#loadTree();
    this.core.on("treeChanged", diff => {
      this.state.apply(diff);
      this.scheduleRender();
    });
    this.core.on("spacesChanged", spaces => {
      this.spaces = spaces;
      this.scheduleRender();
    });
    this.core.on("activeSpaceChanged", ({ window: windowId, space }) => {
      if (windowId == this.bridge.windowId) {
        this.activeSpaceId = space;
        this.#loadTree().then(() => this.scheduleRender());
      }
    });
    this.bridge.on("tabopened", tab => this.#tabChanged(tab));
    this.bridge.on("tabstate", tab => this.#tabChanged(tab));
    this.bridge.on("tabclosed", ({ node }) => {
      this.openTabs.delete(node);
      this.scheduleRender();
    });
    this.bridge.on("selected", tab => {
      this.selectedTab = tab;
      this.selectedNode = tab?.node ?? null;
      this.#windowChanged();
      this.scheduleRender();
    });
    this.#installShortcuts();
    this.#windowChanged();
    this.render();
    this.downloads.init();
  }

  // Asks for an Arc StorableSidebar.json and imports it.
  async chooseArcFile() {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    picker.init(
      this.document.defaultView.browsingContext,
      "Choose Arc's StorableSidebar.json",
      Ci.nsIFilePicker.modeOpen
    );
    picker.appendFilter("JSON", "*.json");
    try {
      const arc = Services.dirsvc.get("Home", Ci.nsIFile);
      arc.append("Library");
      arc.append("Application Support");
      arc.append("Arc");
      if (arc.exists()) {
        picker.displayDirectory = arc;
      }
    } catch (e) {
      // No Arc folder here; the picker opens where it likes.
    }
    const result = await new Promise(resolve => picker.open(resolve));
    if (result == Ci.nsIFilePicker.returnOK) {
      await this.importArcFile(picker.file.path);
    }
  }

  // Imports an Arc sidebar file and says what came across.
  async importArcFile(path) {
    try {
      const report = await this.core.importArc(path);
      const warnings = report.warnings.length
        ? `, ${report.warnings.length} skipped`
        : "";
      this.toasts.show({
        text: `Imported ${report.spaces} spaces and ${report.tabs + report.favorites} tabs from Arc${warnings}`,
      });
      return report;
    } catch (e) {
      console.error("Swell: the Arc import failed", e);
      this.toasts.show({
        text: `Could not import that file: ${e.reason ?? e.message ?? e}`,
      });
      return null;
    }
  }

  // A link opened from a page (middle- or accel-click) becomes a tab of that page's space.
  setTabIcon(browser, icon) {
    const tab = this.bridge.tabForBrowser(browser);
    if (tab) {
      this.bridge.setIcon(tab, icon);
    }
  }

  openLinkFrom(browser, url, { background }) {
    const tab = this.bridge.tabForBrowser(browser);
    return this.run(() =>
      this.bridge.openUrl(url, tab?.space ?? this.activeSpaceId, { background })
    );
  }

  // The menu for a right-click in a page, from what the page reported.
  showPageMenu({
    browser,
    actor,
    clientX,
    clientY,
    linkURL,
    linkText,
    imageURL,
    mediaURL,
    mediaType,
    password,
    selection,
    editable,
  }) {
    const tab = this.bridge.tabForBrowser(browser);
    const space = tab?.space ?? this.activeSpaceId;
    const copy = text =>
      Cc["@mozilla.org/widget/clipboardhelper;1"]
        .getService(Ci.nsIClipboardHelper)
        .copyString(text);
    const command = commandName => () =>
      actor.sendAsyncMessage("Swell:Command", { command: commandName });
    const items = [];
    if (linkURL) {
      items.push(
        {
          label: "Open link in new tab",
          action: () => this.run(() => this.bridge.openUrl(linkURL, space)),
        },
        { label: "Copy link", action: () => copy(linkURL) }
      );
    }
    if (imageURL) {
      items.push(
        {
          label: "Open image in new tab",
          action: () => this.run(() => this.bridge.openUrl(imageURL, space)),
        },
        { label: "Copy image address", action: () => copy(imageURL) }
      );
    }
    if (editable) {
      items.push(
        { label: "Cut", action: command("cmd_cut") },
        { label: "Copy", action: command("cmd_copy") },
        { label: "Paste", action: command("cmd_paste") },
        { label: "Select all", action: command("cmd_selectAll") }
      );
    } else if (selection) {
      items.push({ label: "Copy", action: command("cmd_copy") });
      const shown =
        selection.length > 24 ? `${selection.slice(0, 24)}\u2026` : selection;
      items.push({
        label: `Search for \u201C${shown}\u201D`,
        action: () =>
          this.run(() =>
            this.bridge.openUrl(
              `https://www.google.com/search?q=${encodeURIComponent(selection)}`,
              space
            )
          ),
      });
    }
    if (!linkURL && !imageURL && !editable && !selection) {
      items.push(
        { label: "Back", action: () => this.bridge.goBack() },
        { label: "Forward", action: () => this.bridge.goForward() },
        { label: "Reload", action: () => this.bridge.reload() }
      );
    }
    if (tab) {
      items.push(
        ...SwellExtensionUI.menuItemsFor({
          nativeTab: tab,
          pageUrl: browser.currentURI.spec,
          onLink: !!linkURL,
          linkUrl: linkURL,
          linkText,
          onImage: !!imageURL,
          onVideo: mediaType == "video",
          onAudio: mediaType == "audio",
          srcUrl: imageURL ?? mediaURL,
          onEditable: editable,
          onPassword: password,
          isTextSelected: !!selection,
          selectionText: selection,
        })
      );
    }
    const rect = browser.getBoundingClientRect();
    this.menu.show(rect.left + clientX, rect.top + clientY, items, {
      onHide: () => SwellExtensionUI.menuHidden(),
    });
  }

  async #loadTree() {
    if (this.activeSpaceId) {
      this.state.load(await this.core.spaceTree(this.activeSpaceId));
    }
  }

  #tabChanged(tab) {
    if (tab.node) {
      this.openTabs.set(tab.node, tab);
    }
    if (tab.selected) {
      this.selectedTab = tab;
      this.#windowChanged();
    }
    this.scheduleRender();
  }

  #windowChanged() {
    const tab = this.selectedTab;
    this.document.title = tab?.title ? `${tab.title} - Swell` : "Swell";
    this.document.getElementById("empty").hidden = !!tab;
  }

  scheduleRender() {
    if (this.#renderQueued) {
      return;
    }
    this.#renderQueued = true;
    this.document.defaultView.requestAnimationFrame(() => {
      this.#renderQueued = false;
      this.render();
    });
  }

  // The tint of the active space, for the CSS that colours the sidebar.
  #applyTint() {
    const root = this.document.documentElement;
    const tint = this.space?.tint;
    if (tint) {
      root.style.setProperty("--space-tint", tint);
    } else {
      root.style.removeProperty("--space-tint");
    }
    root.toggleAttribute("tinted", !!tint);
  }

  render() {
    this.#applyTint();
    this.sidebar.render();
    this.extensionActions.render();
    this.navBar.render();
  }

  // Reports a failed command instead of leaving the window silently stale.
  async run(command) {
    try {
      return await command();
    } catch (e) {
      console.error("Swell command failed", e);
      return null;
    }
  }

  switchSpace(id) {
    return this.run(() => this.core.switchSpace(this.bridge.windowId, id));
  }

  openNode(id) {
    return this.run(() => this.bridge.openNode(id));
  }

  closeNodeTab(id) {
    const tab = this.openTabs.get(id);
    return tab ? this.run(() => this.bridge.closeTab(tab.liveTab)) : null;
  }

  moveNode(id, parentId, index) {
    return this.run(() => this.core.moveNode(id, parentId, index));
  }

  async newFolder(parentId = this.space.pinnedRoot) {
    const count = this.state.childrenOf(parentId).length;
    const id = await this.run(() =>
      this.core.createFolder(parentId, "New folder", count)
    );
    if (id) {
      this.sidebar.startRename(id);
    }
  }

  removeNode(id) {
    return this.run(() => this.core.removeNode(id));
  }

  renameNode(id, title) {
    return this.run(() => this.core.renameNode(id, title));
  }

  setCollapsed(id, collapsed) {
    return this.run(() => this.core.setCollapsed(id, collapsed));
  }

  // Moves a tab into Pinned, at the end.
  pin(id) {
    const space = this.space;
    return this.moveNode(
      id,
      space.pinnedRoot,
      this.state.childrenOf(space.pinnedRoot).length
    );
  }

  // Moves a pinned or favorite tab to the end of Today.
  unpin(id) {
    return this.run(() => this.core.unpinNode(id, this.activeSpaceId));
  }

  async createSpace(title, emoji, tint = null) {
    const icon = emoji
      ? new this.Icon.Emoji({ glyph: emoji })
      : new this.Icon.Symbol({ name: "circle" });
    const id = await this.run(() =>
      this.core.createSpace(title || "New space", icon)
    );
    if (id) {
      if (tint) {
        await this.run(() => this.core.setSpaceTint(id, tint));
      }
      await this.switchSpace(id);
    }
  }

  async updateSpace(id, title, emoji, tint = null) {
    const icon = emoji
      ? new this.Icon.Emoji({ glyph: emoji })
      : new this.Icon.Symbol({ name: "circle" });
    await this.run(() => this.core.updateSpace(id, title, icon));
    await this.run(() => this.core.setSpaceTint(id, tint));
  }

  moveSpace(id, index) {
    return this.run(() => this.core.moveSpace(id, index));
  }

  // Asks, then deletes the space and what the engine keeps for its container.
  async deleteSpace(id) {
    const space = this.spaces.find(s => s.id == id);
    if (
      !space ||
      this.spaces.length < 2 ||
      !(await this.spaceEditor.confirmDelete(space))
    ) {
      return;
    }
    const deleted = await this.run(() => this.core.deleteSpace(id));
    if (!deleted?.identityRemoved) {
      return;
    }
    const { forgetContainer } = ChromeUtils.importESModule(
      "moz-src:///swell/app/modules/SpaceCleanup.sys.mjs"
    );
    const failures = await forgetContainer(deleted.userContextId);
    this.toasts.show({
      text: failures.length
        ? `Deleted ${space.title}, but could not remove: ${failures.join("; ")}`
        : `Deleted ${space.title}`,
    });
  }

  #installShortcuts() {
    const win = this.document.defaultView;
    win.addEventListener("keydown", event => {
      const accel = IS_MAC
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey;
      if (event.key == "Escape" && this.commandBar.isOpen) {
        this.commandBar.close();
        event.preventDefault();
        return;
      }
      if (!accel || event.altKey) {
        return;
      }
      const handled = this.#shortcut(event);
      if (handled) {
        event.preventDefault();
      }
    });
  }

  #shortcut(event) {
    switch (event.key.toLowerCase()) {
      case "t":
        this.commandBar.open({ mode: "new" });
        return true;
      case "l":
        this.commandBar.open({ mode: "current" });
        return true;
      case "w":
        if (this.selectedTab?.liveTab) {
          this.run(() => this.bridge.closeTab(this.selectedTab.liveTab));
        }
        return true;
      case "r":
        this.bridge.reload();
        return true;
      case "s":
        this.sidebarLayout.shortcutDown(event);
        return true;
      case "f":
        this.bridge.openFind();
        return true;
      case "=":
      case "+":
        this.bridge.zoom(1);
        return true;
      case "-":
        this.bridge.zoom(-1);
        return true;
      case "0":
        this.bridge.zoom(0);
        return true;
      case "[":
        this.bridge.goBack();
        return true;
      case "]":
        this.bridge.goForward();
        return true;
      default:
        break;
    }
    const digit = Number(event.key);
    if (digit >= 1 && digit <= 9 && !event.shiftKey) {
      const space = this.spaces[digit - 1];
      if (space) {
        this.switchSpace(space.id);
      }
      return true;
    }
    return false;
  }
}
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

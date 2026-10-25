/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const DRAG_TYPE = "application/x-swell-node";

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (e) {
    return "";
  }
}

// The one letter shown where a site icon would go.
function letterOf(info) {
  const source =
    (info.title && info.title != info.url ? info.title : hostOf(info.url)) ||
    "?";
  return source.trim().charAt(0).toUpperCase() || "?";
}

// Draws Favorites, the Pinned tree, Today and the space switcher from the
// app's state, and turns drags, clicks and edits into commands. It owns no
// state of its own beyond what is drawn.
/**
 *
 */
const SPACE_MIME = "application/x-swell-space";

/**
 *
 */
export class Sidebar {
  #app;
  #doc;
  #dragged = null;
  #draggedSpace = null;

  constructor(app) {
    this.#app = app;
    this.#doc = app.document;
    const doc = this.#doc;
    doc
      .getElementById("new-tab")
      .addEventListener("click", () => app.commandBar.open({ mode: "new" }));
    doc
      .getElementById("new-folder")
      .addEventListener("click", () => app.newFolder());
    doc
      .getElementById("downloads-button")
      .addEventListener("click", () => app.downloads.show());
    doc
      .getElementById("space-add")
      .addEventListener("click", () => app.spaceEditor.create());
    for (const id of ["pinned", "today", "favorites"]) {
      this.#installDropZone(doc.getElementById(id));
    }
    const mac = Services.appinfo.OS == "Darwin";
    doc.getElementById("new-tab-key").textContent = mac ? "⌘T" : "Ctrl+T";
  }

  /**
   * The lists of the sidebar slide in from the side the new space is on.
   *
   * @param {"next"|"prev"} direction
   */
  slide(direction) {
    const sidebar = this.#doc.getElementById("sidebar");
    sidebar.classList.remove("slide-next", "slide-prev");
    // Restarts the animation if one is running.
    sidebar.getBoundingClientRect();
    sidebar.classList.add(`slide-${direction}`);
    sidebar.addEventListener(
      "animationend",
      () => sidebar.classList.remove("slide-next", "slide-prev"),
      { once: true }
    );
  }

  render() {
    const app = this.#app;
    const space = app.space;
    if (!space) {
      return;
    }
    this.#renderTree("pinned", space.pinnedRoot);
    this.#renderTree("today", space.todayRoot);
    this.#renderFavorites(space.favoritesRoot);
    this.#renderSpaces();
  }

  #renderTree(containerId, root) {
    const container = this.#doc.getElementById(containerId);
    container.dataset.rootId = root;
    const rows = this.#app.state
      .rows(root)
      .map(({ id, depth }) => this.#row(id, depth));
    container.replaceChildren(...rows.filter(Boolean));
  }

  #row(id, depth) {
    const app = this.#app;
    const info = app.state.describe(id);
    if (!info) {
      return null;
    }
    const doc = this.#doc;
    const row = doc.createElement("div");
    row.className = `row ${info.kind}`;
    row.dataset.id = id;
    row.draggable = true;
    row.style.paddingInlineStart = `${6 + depth * 14}px`;
    const openTab = app.openTabs.get(id);
    row.classList.toggle("open", !!openTab);
    row.classList.toggle("selected", app.selectedNode === id);
    row.classList.toggle("sharing", !!openTab?.sharing);

    if (info.kind == "folder") {
      const caret = doc.createElement("span");
      caret.className = "caret";
      caret.classList.toggle("collapsed", info.collapsed);
      row.append(caret);
    }
    const avatar = this.#avatar(info, openTab);
    avatar.classList.toggle("loading", !!openTab?.loading);
    const title = doc.createElement("span");
    title.className = "title";
    title.textContent = info.title;
    row.append(avatar, title);
    if (openTab) {
      const closeButton = doc.createElement("button");
      closeButton.className = "close";
      closeButton.title = "Close tab";
      closeButton.addEventListener("click", event => {
        event.stopPropagation();
        app.closeNodeTab(id);
      });
      row.append(closeButton);
    }
    row.addEventListener("click", () => this.#activate(id));
    row.addEventListener("auxclick", event => {
      if (event.button == 1) {
        event.preventDefault();
        app.closeNodeTab(id);
      }
    });
    row.addEventListener("dblclick", event => {
      event.stopPropagation();
      this.startRename(id);
    });
    row.addEventListener("contextmenu", event => this.#showMenu(event, id));
    this.#installDragSource(row, id);
    return row;
  }

  // The site icon if one is known, else the first letter of its name.
  #avatar(info, openTab) {
    const doc = this.#doc;
    const icon = openTab?.icon ?? info.icon;
    if (info.kind == "tab" && icon?.startsWith("data:image/")) {
      const image = doc.createElement("img");
      image.className = "avatar icon";
      image.src = icon;
      image.draggable = false;
      image.addEventListener(
        "error",
        () => image.replaceWith(this.#avatar({ ...info, icon: null }, null)),
        {
          once: true,
        }
      );
      return image;
    }
    const avatar = doc.createElement("span");
    avatar.className = "avatar";
    avatar.textContent = info.kind == "folder" ? "▤" : letterOf(info);
    return avatar;
  }

  #activate(id) {
    const info = this.#app.state.describe(id);
    if (info?.kind == "folder") {
      this.#app.setCollapsed(id, !info.collapsed);
    } else if (info) {
      this.#app.openNode(id);
    }
  }

  #renderFavorites(root) {
    const app = this.#app;
    const container = this.#doc.getElementById("favorites");
    container.dataset.rootId = root;
    container.replaceChildren(
      ...app.state.childrenOf(root).map(id => {
        const info = app.state.describe(id);
        const button = this.#doc.createElement("button");
        button.className = "favorite";
        button.dataset.id = id;
        button.draggable = true;
        button.title = info.title;
        button.classList.toggle("open", app.openTabs.has(id));
        button.classList.toggle("selected", app.selectedNode === id);
        button.append(this.#avatar(info, app.openTabs.get(id)));
        button.addEventListener("click", () => app.openNode(id));
        button.addEventListener("auxclick", event => {
          if (event.button == 1) {
            event.preventDefault();
            app.closeNodeTab(id);
          }
        });
        button.addEventListener("contextmenu", event =>
          this.#showMenu(event, id)
        );
        this.#installDragSource(button, id);
        return button;
      })
    );
  }

  #renderSpaces() {
    const app = this.#app;
    const nav = this.#doc.getElementById("spaces");
    const buttons = app.spaces.map(space => {
      const button = this.#doc.createElement("button");
      button.className = "space";
      button.classList.toggle("active", space.id == app.activeSpaceId);
      button.title = space.title;
      button.dataset.id = space.id;
      button.draggable = true;
      button.textContent =
        space.icon.glyph ?? space.title.charAt(0).toUpperCase();
      button.addEventListener("click", () => app.switchSpace(space.id));
      button.addEventListener("contextmenu", event => {
        event.preventDefault();
        app.menu.show(event.clientX, event.clientY, [
          {
            label: "Edit space\u2026",
            action: () => app.spaceEditor.edit(space),
          },
          {
            label: "Delete space\u2026",
            danger: true,
            disabled: app.spaces.length < 2,
            action: () => app.deleteSpace(space.id),
          },
        ]);
      });
      this.#installSpaceDrag(button, space.id);
      return button;
    });
    nav.replaceChildren(...buttons);
  }

  // Spaces are dragged by their buttons; dropping on the left half of another
  // one puts the space before it, on the right half after it.
  #installSpaceDrag(button, id) {
    const clear = () => button.classList.remove("drop-before", "drop-after");
    button.addEventListener("dragstart", event => {
      this.#draggedSpace = id;
      event.dataTransfer.setData(SPACE_MIME, id);
      event.dataTransfer.effectAllowed = "move";
      button.classList.add("dragging");
    });
    button.addEventListener("dragend", () => {
      this.#draggedSpace = null;
      button.classList.remove("dragging");
      for (const other of this.#doc.querySelectorAll(".space")) {
        other.classList.remove("drop-before", "drop-after");
      }
    });
    button.addEventListener("dragover", event => {
      if (!this.#draggedSpace || this.#draggedSpace == id) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const rect = button.getBoundingClientRect();
      const before = event.clientX < rect.left + rect.width / 2;
      button.classList.toggle("drop-before", before);
      button.classList.toggle("drop-after", !before);
    });
    button.addEventListener("dragleave", clear);
    button.addEventListener("drop", event => {
      const dragged = this.#draggedSpace;
      if (!dragged || dragged == id) {
        return;
      }
      event.preventDefault();
      const after = button.classList.contains("drop-after");
      clear();
      const order = this.#app.spaces.map(space => space.id);
      let target = order.indexOf(id) + (after ? 1 : 0);
      if (order.indexOf(dragged) < target) {
        target--;
      }
      this.#app.moveSpace(dragged, target);
    });
  }

  // Replaces a row's title with an input; Enter or leaving it saves.
  startRename(id) {
    const row = this.#doc.querySelector(`.row[data-id="${CSS.escape(id)}"]`);
    const info = this.#app.state.describe(id);
    if (!row || !info) {
      return;
    }
    const titleEl = row.querySelector(".title");
    const input = this.#doc.createElement("input");
    input.className = "rename";
    input.value = info.title;
    row.draggable = false;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = save => {
      if (done) {
        return;
      }
      done = true;
      row.draggable = true;
      const value = input.value.trim();
      if (save && value && value != info.title) {
        this.#app.renameNode(id, value);
      } else {
        this.#app.scheduleRender();
      }
    };
    input.addEventListener("keydown", event => {
      event.stopPropagation();
      if (event.key == "Enter") {
        finish(true);
      } else if (event.key == "Escape") {
        finish(false);
      }
    });
    input.addEventListener("blur", () => finish(true));
    input.addEventListener("click", event => event.stopPropagation());
  }

  #showMenu(event, id) {
    event.preventDefault();
    const app = this.#app;
    const info = app.state.describe(id);
    const space = app.space;
    const parentId = app.state.parent(id);
    const inToday = parentId === space.todayRoot;
    const items = [];
    if (info.kind == "folder") {
      items.push({ label: "New subfolder", action: () => app.newFolder(id) });
    } else {
      items.push({ label: "Open", action: () => app.openNode(id) });
      const inFavorites = parentId === space.favoritesRoot;
      if (inToday) {
        items.push({ label: "Pin", action: () => app.pin(id) });
      } else if (!inFavorites) {
        items.push({ label: "Unpin", action: () => app.unpin(id) });
      }
      if (inFavorites) {
        items.push({
          label: "Remove from favorites",
          action: () => app.unpin(id),
        });
      } else {
        items.push({
          label: "Add to favorites",
          action: () => app.favorite(id),
        });
      }
      if (app.openTabs.has(id)) {
        items.push({ label: "Close tab", action: () => app.closeNodeTab(id) });
      }
    }
    items.push({ label: "Rename", action: () => this.startRename(id) });
    items.push({
      label: info.kind == "folder" ? "Delete folder" : "Delete",
      danger: true,
      action: () => app.removeNode(id),
    });
    app.menu.show(event.clientX, event.clientY, items);
  }

  #installDragSource(element, id) {
    element.addEventListener("dragstart", event => {
      this.#dragged = id;
      event.dataTransfer.setData(DRAG_TYPE, id);
      event.dataTransfer.effectAllowed = "move";
      element.classList.add("dragging");
      this.#doc.getElementById("sidebar").classList.add("tab-dragging");
    });
    element.addEventListener("dragend", () => {
      this.#dragged = null;
      element.classList.remove("dragging");
      this.#doc.getElementById("sidebar").classList.remove("tab-dragging");
      this.#clearDropMarks();
    });
  }

  #installDropZone(container) {
    container.addEventListener("dragover", event => {
      const drop = this.#dropFor(container, event);
      this.#clearDropMarks();
      if (!drop) {
        return;
      }
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      drop.element.classList.add(`drop-${drop.where}`);
    });
    container.addEventListener("dragleave", event => {
      if (!container.contains(event.relatedTarget)) {
        this.#clearDropMarks();
      }
    });
    container.addEventListener("drop", event => {
      const drop = this.#dropFor(container, event);
      this.#clearDropMarks();
      if (drop) {
        event.preventDefault();
        this.#app.moveNode(
          this.#dragged,
          drop.target.parent,
          drop.target.index
        );
      }
    });
  }

  // Resolves a pointer position to a row (or an empty list) and a place
  // relative to it, then asks the tree whether that drop is allowed.
  #dropFor(container, event) {
    const dragged = this.#dragged;
    if (!dragged) {
      return null;
    }
    const state = this.#app.state;
    const row = event.target.closest?.("[data-id]");
    let targetId;
    let where;
    let element;
    if (row && container.contains(row)) {
      targetId = row.dataset.id;
      element = row;
      const { top: rowTop, height } = row.getBoundingClientRect();
      const offset = (event.clientY - rowTop) / height;
      if (state.isFolder(targetId) && offset > 0.25 && offset < 0.75) {
        where = "inside";
      } else {
        where = offset < 0.5 ? "before" : "after";
      }
    } else {
      targetId = container.dataset.rootId;
      where = "inside";
      element = container;
    }
    const target = state.dropTarget({
      dragged,
      target: targetId,
      where,
      tabsOnly: this.#app.tabsOnlyRoots,
    });
    return target ? { target, where, element } : null;
  }

  #clearDropMarks() {
    for (const element of this.#doc.querySelectorAll(
      ".drop-before, .drop-after, .drop-inside"
    )) {
      element.classList.remove("drop-before", "drop-after", "drop-inside");
    }
  }
}
// /* This Source Code Form is subject to the terms of the Mozilla Public
// License, v. 2.0. If a copy of the MPL was not distributed with this
// file, You can obtain one at http://mozilla.org/MPL/2.0/.

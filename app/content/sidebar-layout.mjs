/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const STORE_URL = "chrome://swell/content/window.xhtml";
const STORE_ID = "swell-window";
const MIN_WIDTH = 180;
const MAX_FRACTION = 0.5;
const DEFAULT_WIDTH = 264;

/**
 * How wide the sidebar is and whether it is shown: dragged on the edge between
 * it and the page, hidden and shown by a button (and the accel key S). Both
 * are remembered for the window.
 */
export class SidebarLayout {
  #app;
  #root;
  #toggle;
  #resizer;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#root = doc.documentElement;
    this.#toggle = doc.getElementById("sidebar-toggle");
    this.#resizer = doc.getElementById("sidebar-resizer");
    this.#toggle.addEventListener("click", () => this.toggle());
    this.#resizer.addEventListener("pointerdown", event => this.#drag(event));
    this.#resizer.addEventListener("dblclick", () =>
      this.#setWidth(DEFAULT_WIDTH, true)
    );
    const width = Number(this.#stored("sidebarwidth"));
    if (width) {
      this.#setWidth(width, false);
    }
    this.#setCollapsed(this.#stored("sidebarcollapsed") == "true", false);
  }

  get collapsed() {
    return this.#root.hasAttribute("sidebar-collapsed");
  }

  toggle() {
    this.#setCollapsed(!this.collapsed, true);
  }

  #stored(attribute) {
    try {
      return Services.xulStore.getValue(STORE_URL, STORE_ID, attribute);
    } catch (e) {
      return "";
    }
  }

  #store(attribute, value) {
    try {
      Services.xulStore.setValue(STORE_URL, STORE_ID, attribute, String(value));
    } catch (e) {
      // The layout is a convenience; losing it is not worth an error.
    }
  }

  #setCollapsed(collapsed, save) {
    this.#root.toggleAttribute("sidebar-collapsed", collapsed);
    this.#toggle.setAttribute("aria-expanded", String(!collapsed));
    const label = collapsed ? "Show sidebar" : "Hide sidebar";
    this.#toggle.setAttribute("aria-label", label);
    this.#toggle.title = `${label} (${Services.appinfo.OS == "Darwin" ? "⌘S" : "Ctrl+S"})`;
    if (save) {
      this.#store("sidebarcollapsed", collapsed);
    }
  }

  #setWidth(width, save) {
    const win = this.#app.document.defaultView;
    const clamped = Math.round(
      Math.max(MIN_WIDTH, Math.min(width, win.innerWidth * MAX_FRACTION))
    );
    this.#root.style.setProperty("--sidebar-width", `${clamped}px`);
    if (save) {
      this.#store("sidebarwidth", clamped);
    }
    return clamped;
  }

  #drag(event) {
    event.preventDefault();
    const resizer = this.#resizer;
    resizer.setPointerCapture(event.pointerId);
    const move = moveEvent => this.#setWidth(moveEvent.clientX, false);
    const finish = upEvent => {
      resizer.removeEventListener("pointermove", move);
      resizer.removeEventListener("pointerup", finish);
      resizer.removeEventListener("pointercancel", finish);
      resizer.releasePointerCapture(upEvent.pointerId);
      this.#setWidth(upEvent.clientX, true);
    };
    resizer.addEventListener("pointermove", move);
    resizer.addEventListener("pointerup", finish);
    resizer.addEventListener("pointercancel", finish);
  }
}

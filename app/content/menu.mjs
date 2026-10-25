/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A small context menu drawn in the window: a list of labelled actions at a
 * point, closed by choosing one, clicking elsewhere or pressing Escape.
 */
export class ContextMenu {
  #element;
  #onHide = null;

  constructor(app) {
    this.#element = app.document.getElementById("menu");
    const win = app.document.defaultView;
    win.addEventListener("mousedown", event => {
      if (!this.#element.contains(event.target)) {
        this.hide();
      }
    });
    win.addEventListener("keydown", event => {
      if (event.key == "Escape") {
        this.hide();
      }
    });
    win.addEventListener("blur", () => this.hide());
  }

  get isOpen() {
    return !this.#element.hidden;
  }

  /**
   * @param {number} x
   * @param {number} y
   * @param {Array<{label?: string, action?: Function, danger?: boolean,
   *   separator?: boolean, disabled?: boolean, checked?: boolean,
   *   children?: Array}>} items A separator has no label; an item with
   *   `children` opens them as a submenu instead of acting.
   * @param {object} [options]
   * @param {Function} [options.onHide] Called once, when the menu closes.
   */
  show(x, y, items, { onHide = null } = {}) {
    this.#onHide?.();
    this.#onHide = onHide;
    const doc = this.#element.ownerDocument;
    this.#element.replaceChildren(...this.#build(doc, items));
    this.#element.hidden = false;
    const { innerWidth: viewWidth, innerHeight: viewHeight } = doc.defaultView;
    const { width, height } = this.#element.getBoundingClientRect();
    this.#element.style.left = `${Math.max(4, Math.min(x, viewWidth - width - 4))}px`;
    this.#element.style.top = `${Math.max(4, Math.min(y, viewHeight - height - 4))}px`;
  }

  #build(doc, items) {
    return items.map(item => {
      if (item.separator) {
        return doc.createElement("hr");
      }
      const button = doc.createElement("button");
      button.textContent = item.label;
      button.classList.toggle("danger", !!item.danger);
      button.disabled = !!item.disabled;
      if (item.checked !== undefined) {
        button.setAttribute("role", "menuitemcheckbox");
        button.setAttribute("aria-checked", String(item.checked));
        button.classList.toggle("checked", item.checked);
      }
      if (item.children) {
        const wrapper = doc.createElement("div");
        wrapper.className = "submenu-parent";
        button.classList.add("has-submenu");
        const submenu = doc.createElement("div");
        submenu.className = "submenu";
        submenu.append(...this.#build(doc, item.children));
        wrapper.append(button, submenu);
        return wrapper;
      }
      button.addEventListener("click", () => {
        this.hide();
        item.action();
      });
      return button;
    });
  }

  hide() {
    this.#element.hidden = true;
    const onHide = this.#onHide;
    this.#onHide = null;
    onHide?.();
  }
}

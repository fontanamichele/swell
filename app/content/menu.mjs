/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * A small context menu drawn in the window: a list of labelled actions at a
 * point, closed by choosing one, clicking elsewhere or pressing Escape.
 */
export class ContextMenu {
  #element;

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
   * @param {Array<{label: string, action: Function, danger?: boolean}>} items
   */
  show(x, y, items) {
    const doc = this.#element.ownerDocument;
    this.#element.replaceChildren(
      ...items.map(({ label, action, danger }) => {
        const button = doc.createElement("button");
        button.textContent = label;
        button.classList.toggle("danger", !!danger);
        button.addEventListener("click", () => {
          this.hide();
          action();
        });
        return button;
      })
    );
    this.#element.hidden = false;
    const { innerWidth: viewWidth, innerHeight: viewHeight } = doc.defaultView;
    const { width, height } = this.#element.getBoundingClientRect();
    this.#element.style.left = `${Math.max(4, Math.min(x, viewWidth - width - 4))}px`;
    this.#element.style.top = `${Math.max(4, Math.min(y, viewHeight - height - 4))}px`;
  }

  hide() {
    this.#element.hidden = true;
  }
}

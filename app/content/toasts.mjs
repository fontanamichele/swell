/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Short-lived notices in the corner of the window, each with optional
 * actions; they go away by themselves.
 */
export class Toasts {
  #container;

  constructor(doc) {
    this.#container = doc.getElementById("toasts");
  }

  /**
   * @param {object} options
   * @param {string} options.text
   * @param {Array<{label: string, run: Function}>} [options.actions]
   * @param {number} [options.timeout] Milliseconds before it goes away.
   * @returns {{update: Function, dismiss: Function}}
   */
  show({ text, actions = [], timeout = 6000 }) {
    const doc = this.#container.ownerDocument;
    const toast = doc.createElement("div");
    toast.className = "toast";
    const label = doc.createElement("span");
    label.className = "toast-text";
    label.textContent = text;
    toast.append(label);
    for (const { label: actionLabel, run } of actions) {
      const button = doc.createElement("button");
      button.textContent = actionLabel;
      button.addEventListener("click", () => {
        run();
        dismiss();
      });
      toast.append(button);
    }
    let timer = null;
    const dismiss = () => {
      clearTimeout(timer);
      toast.remove();
    };
    const arm = () => {
      clearTimeout(timer);
      if (timeout) {
        timer = setTimeout(dismiss, timeout);
      }
    };
    this.#container.append(toast);
    arm();
    return {
      update(newText) {
        label.textContent = newText;
        arm();
      },
      dismiss,
    };
  }
}

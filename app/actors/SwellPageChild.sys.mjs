/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const SAFE_SCHEMES = ["http:", "https:", "file:", "about:"];

/**
 * Runs in every page: describes what was right-clicked for the window's
 * context menu, sends modifier- and middle-clicks on links to the window so
 * they open new tabs, and carries out edit commands the menu asks for.
 */
export class SwellPageChild extends JSWindowActorChild {
  handleEvent(event) {
    if (event.type == "contextmenu") {
      this.#onContextMenu(event);
    } else if (event.type == "click") {
      this.#onClick(event);
    }
  }

  receiveMessage({ name, data }) {
    if (name == "Swell:Command") {
      this.docShell.doCommand(data.command);
    }
  }

  #closest(target, selector) {
    return target?.closest?.(selector) ?? null;
  }

  #onContextMenu(event) {
    if (event.defaultPrevented || !this.contentWindow) {
      return;
    }
    const target = event.composedTarget ?? event.target;
    const link = this.#closest(target, "a[href], area[href]");
    const image = this.#closest(target, "img");
    const media = this.#closest(target, "video, audio");
    const editable =
      !!this.#closest(target, "input, textarea, [contenteditable]") &&
      !target.readOnly;
    this.sendAsyncMessage("Swell:ContextMenu", {
      clientX: event.clientX,
      clientY: event.clientY,
      linkURL: link ? link.href : null,
      linkText: link ? link.textContent.trim() : null,
      imageURL: image ? image.currentSrc || image.src : null,
      mediaURL: media ? media.currentSrc || media.src : null,
      mediaType: media ? media.localName : null,
      password: !!this.#closest(target, "input[type=password]"),
      selection: this.contentWindow.getSelection().toString().trim(),
      editable,
    });
  }

  #onClick(event) {
    const link = this.#closest(
      event.composedTarget ?? event.target,
      "a[href], area[href]"
    );
    if (!link || event.defaultPrevented) {
      return;
    }
    const middle = event.button == 1;
    const accel = event.button == 0 && (event.metaKey || event.ctrlKey);
    if (!middle && !accel) {
      return;
    }
    let url;
    try {
      url = new URL(link.href);
    } catch (e) {
      return;
    }
    if (!SAFE_SCHEMES.includes(url.protocol)) {
      return;
    }
    event.preventDefault();
    this.sendAsyncMessage("Swell:OpenLink", {
      url: url.href,
      background: !event.shiftKey,
    });
  }
}

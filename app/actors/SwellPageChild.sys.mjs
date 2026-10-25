/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  ContentDOMReference: "resource://gre/modules/ContentDOMReference.sys.mjs",
  setTimeout: "resource://gre/modules/Timer.sys.mjs",
  InlineSpellCheckerContent:
    "resource://gre/modules/InlineSpellCheckerContent.sys.mjs",
  SpellCheckHelper: "resource://gre/modules/InlineSpellChecker.sys.mjs",
});

const SAFE_SCHEMES = ["http:", "https:", "file:", "about:"];

/**
 * Runs in every page: describes what was right-clicked for the window's
 * context menu, sends modifier- and middle-clicks on links to the window so
 * they open new tabs, and carries out edit commands the menu asks for.
 */
export class SwellPageChild extends JSWindowActorChild {
  #destructionObservers = new Set();

  // The spell checker asks to be told when this actor goes away.
  registerDestructionObserver(observer) {
    this.#destructionObservers.add(observer);
  }

  unregisterDestructionObserver(observer) {
    this.#destructionObservers.delete(observer);
  }

  didDestroy() {
    for (const observer of this.#destructionObservers) {
      observer.actorDestroyed();
    }
    this.#destructionObservers.clear();
  }

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
    } else if (name == "Swell:ReplaceMisspelling") {
      lazy.InlineSpellCheckerContent.replaceMisspelling(data.suggestion);
    }
  }

  #closest(target, selector) {
    return target?.closest?.(selector) ?? null;
  }

  async #onContextMenu(event) {
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
    const spelling = editable ? await this.#spelling(event, target) : null;
    this.sendAsyncMessage("Swell:ContextMenu", {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
      linkURL: link ? link.href : null,
      linkText: link ? link.textContent.trim() : null,
      imageURL: image ? image.currentSrc || image.src : null,
      mediaURL: media ? media.currentSrc || media.src : null,
      mediaType: media ? media.localName : null,
      password: !!this.#closest(target, "input[type=password]"),
      selection: this.contentWindow.getSelection().toString().trim(),
      editable,
      spelling,
      // For the developer tools to find the element in the page.
      contentDomReference: lazy.ContentDOMReference.get(target),
    });
  }

  // The misspelled word under the pointer and what to suggest for it, or null.
  async #spelling(event, target) {
    const flags = lazy.SpellCheckHelper.isEditable(target, this.contentWindow);
    if (!(flags & lazy.SpellCheckHelper.SPELLCHECKABLE)) {
      return null;
    }
    lazy.InlineSpellCheckerContent.uninitContextMenu();
    let info;
    // The first pass over a field can still be running right after it loads.
    for (let attempt = 0; attempt < 15; attempt++) {
      info = await lazy.InlineSpellCheckerContent.initContextMenu(
        event,
        flags,
        this
      );
      if (!info.initialSpellCheckPending) {
        break;
      }
      await new Promise(resolve => lazy.setTimeout(resolve, 200));
    }
    if (!info.overMisspelling) {
      return null;
    }
    return { word: info.misspelling, suggestions: info.spellSuggestions };
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

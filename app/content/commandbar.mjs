/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The core's SuggestionKind values.
const KIND_PINNED = 0;
const KIND_TODAY = 1;
const KIND_URL = 2;
const KIND_SEARCH = 3;

const KIND_MARK = new Map([
  [KIND_PINNED, "★"],
  [KIND_TODAY, "●"],
  [KIND_URL, "↗"],
  [KIND_SEARCH, "⌕"],
]);

/**
 * The overlay for opening addresses and searches, and for jumping to a tab
 * of the active space. What it shows is the core's ranking; Enter does what
 * the first entry says.
 */
export class CommandBar {
  #app;
  #root;
  #input;
  #list;
  #mode = "new";
  #suggestions = [];
  #active = 0;
  #sequence = 0;
  #timer = null;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#root = doc.getElementById("commandbar");
    this.#input = doc.getElementById("commandbar-input");
    this.#list = doc.getElementById("commandbar-list");
    this.#input.addEventListener("input", () => this.#queue());
    this.#input.addEventListener("keydown", event => this.#key(event));
    this.#root.addEventListener("mousedown", event => {
      if (event.target === this.#root) {
        this.close();
      }
    });
  }

  get isOpen() {
    return !this.#root.hidden;
  }

  /**
   * @param {object} options
   * @param {"new"|"current"} options.mode Open in a new tab, or load into the selected one.
   */
  open({ mode }) {
    const tab = this.#app.selectedTab;
    this.#mode = mode == "current" && tab ? "current" : "new";
    this.#root.hidden = false;
    this.#input.value = this.#mode == "current" ? tab.url : "";
    this.#input.focus();
    this.#input.select();
    this.#query();
  }

  close() {
    this.#root.hidden = true;
    clearTimeout(this.#timer);
    this.#sequence++;
    this.#app.bridge.selectedTab?.browser.focus();
  }

  #queue() {
    clearTimeout(this.#timer);
    this.#timer = setTimeout(() => this.#query(), 30);
  }

  async #query() {
    const space = this.#app.activeSpaceId;
    if (!space) {
      return;
    }
    const sequence = ++this.#sequence;
    const text = this.#input.value;
    const suggestions = await this.#app.run(() =>
      this.#app.core.queryCommandBar(space, text)
    );
    if (sequence !== this.#sequence || !suggestions) {
      return;
    }
    this.#suggestions = suggestions;
    this.#active = 0;
    this.#list.dataset.query = text;
    this.#render();
  }

  #render() {
    const doc = this.#app.document;
    this.#list.replaceChildren(
      ...this.#suggestions.map((suggestion, index) => {
        const item = doc.createElement("li");
        item.setAttribute("role", "option");
        item.classList.toggle("active", index === this.#active);
        const mark = doc.createElement("span");
        mark.textContent = KIND_MARK.get(suggestion.kind) ?? "";
        const title = doc.createElement("span");
        title.textContent = suggestion.title;
        item.append(mark, title);
        if (suggestion.kind != KIND_URL && suggestion.kind != KIND_SEARCH) {
          const url = doc.createElement("span");
          url.className = "url";
          url.textContent = suggestion.isOpen
            ? `${suggestion.url}  (open)`
            : suggestion.url;
          item.append(url);
        }
        item.addEventListener("mousemove", () => {
          if (this.#active !== index) {
            this.#active = index;
            this.#render();
          }
        });
        item.addEventListener("click", () => this.#choose(suggestion));
        return item;
      })
    );
  }

  #key(event) {
    const count = this.#suggestions.length;
    switch (event.key) {
      case "ArrowDown":
        this.#active = count ? (this.#active + 1) % count : 0;
        this.#render();
        break;
      case "ArrowUp":
        this.#active = count ? (this.#active - 1 + count) % count : 0;
        this.#render();
        break;
      case "Enter":
        if (this.#suggestions[this.#active]) {
          this.#choose(this.#suggestions[this.#active]);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  async #choose(suggestion) {
    const mode = this.#mode;
    this.close();
    const bridge = this.#app.bridge;
    if (suggestion.kind == KIND_PINNED || suggestion.kind == KIND_TODAY) {
      await this.#app.openNode(suggestion.node);
    } else if (mode == "current") {
      await this.#app.run(() => bridge.loadInSelected(suggestion.url));
    } else {
      await this.#app.run(() => bridge.openUrl(suggestion.url));
    }
  }
}

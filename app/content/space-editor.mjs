/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The skin tone modifiers of Unicode, light to dark.
const SKIN_TONES = [
  "\u{1F3FB}",
  "\u{1F3FC}",
  "\u{1F3FD}",
  "\u{1F3FE}",
  "\u{1F3FF}",
];

const NO_EMOJI_LABEL = "Choose an emoji";

/**
 * The dialog that makes a space or changes one (name and emoji, with a picker
 * for the emoji), and the one that asks before a space is deleted.
 */
export class SpaceEditor {
  #app;
  #doc;
  #dialog;
  #title;
  #heading;
  #submit;
  #emojiButton;
  #picker;
  #search;
  #tabs;
  #grid;
  #editing = null;
  #glyph = "";
  #emojiLoaded = null;
  #categories = [];
  #category = null;
  #tone = 0;
  #tones;

  constructor(app) {
    this.#app = app;
    const doc = (this.#doc = app.document);
    this.#dialog = doc.getElementById("space-dialog");
    this.#title = doc.getElementById("space-title");
    this.#heading = doc.getElementById("space-dialog-title");
    this.#submit = doc.getElementById("space-save");
    this.#emojiButton = doc.getElementById("space-emoji-button");
    this.#picker = doc.getElementById("emoji-picker");
    this.#search = doc.getElementById("emoji-search");
    this.#tabs = doc.getElementById("emoji-tabs");
    this.#grid = doc.getElementById("emoji-grid");
    this.#tones = doc.getElementById("emoji-tones");
    this.#tone = Number(this.#storedTone());

    doc
      .getElementById("space-cancel")
      .addEventListener("click", () => this.#dialog.close());
    doc.getElementById("space-form").addEventListener("submit", event => {
      event.preventDefault();
      this.#save();
    });
    this.#emojiButton.addEventListener("click", () => this.#togglePicker());
    this.#title.addEventListener("input", () => this.#showIcon());
    doc.getElementById("emoji-clear").addEventListener("click", () => {
      this.#choose("");
    });
    this.#search.addEventListener("input", () => this.#renderGrid());
    // Escape closes the picker before it closes the dialog.
    this.#dialog.addEventListener(
      "keydown",
      event => {
        if (event.key == "Escape" && !this.#picker.hidden) {
          event.preventDefault();
          event.stopPropagation();
          this.#togglePicker(false);
        }
      },
      true
    );
    this.#dialog.addEventListener("close", () => this.#togglePicker(false));
    this.#installDeleteDialog();
  }

  create() {
    this.#open(null);
  }

  edit(space) {
    this.#open(space);
  }

  #open(space) {
    this.#editing = space;
    this.#heading.textContent = space ? "Edit space" : "New space";
    this.#submit.textContent = space ? "Save" : "Create space";
    this.#title.value = space?.title ?? "";
    this.#choose(space?.icon.glyph ?? "");
    this.#search.value = "";
    this.#dialog.showModal();
    this.#title.focus();
    this.#title.select();
  }

  async #save() {
    const title = this.#title.value.trim();
    const glyph = this.#glyph;
    const editing = this.#editing;
    this.#dialog.close();
    if (editing) {
      await this.#app.updateSpace(editing.id, title || editing.title, glyph);
    } else {
      await this.#app.createSpace(title, glyph);
    }
  }

  #choose(glyph) {
    this.#glyph = glyph;
    this.#showIcon();
    this.#emojiButton.title = glyph ? `${glyph} – change` : NO_EMOJI_LABEL;
    this.#emojiButton.setAttribute("aria-label", this.#emojiButton.title);
    this.#togglePicker(false);
  }

  // The button shows what the space's button in the sidebar will show: the
  // emoji, or the first letter of the name.
  #showIcon() {
    this.#emojiButton.textContent =
      this.#glyph || this.#title.value.trim().charAt(0).toUpperCase() || "?";
    this.#emojiButton.classList.toggle("empty", !this.#glyph);
  }

  #togglePicker(show = this.#picker.hidden) {
    this.#picker.hidden = !show;
    this.#emojiButton.setAttribute("aria-expanded", String(show));
    if (show) {
      this.#search.focus();
      this.#loadEmoji().then(() => this.#renderGrid());
    }
  }

  // The emoji, in the groups and with the words of the Unicode data set
  // (emoji-data.json, from emojibase). Read when the picker is first opened.
  #loadEmoji() {
    this.#emojiLoaded ??= fetch("chrome://swell/content/emoji-data.json")
      .then(response => response.json())
      .then(categories => {
        this.#categories = categories;
        this.#category = categories[0].name;
        this.#renderTabs();
        this.#renderTones();
      });
    return this.#emojiLoaded;
  }

  #storedTone() {
    try {
      return (
        Services.xulStore.getValue(
          "chrome://swell/content/window.xhtml",
          "swell-window",
          "emojitone"
        ) || 0
      );
    } catch (e) {
      return 0;
    }
  }

  #renderTones() {
    // The first is no tone; the others are the five tones of Unicode.
    const hands = ["\u{1F44B}", ...SKIN_TONES.map(tone => `\u{1F44B}${tone}`)];
    const names = [
      "Default",
      "Light",
      "Medium-light",
      "Medium",
      "Medium-dark",
      "Dark",
    ];
    this.#tones.replaceChildren(
      ...hands.map((hand, tone) => {
        const button = this.#doc.createElement("button");
        button.type = "button";
        button.className = "emoji-tone";
        button.textContent = hand;
        button.title = `${names[tone]} skin tone`;
        button.setAttribute("role", "radio");
        button.setAttribute("aria-label", button.title);
        button.setAttribute("aria-checked", String(tone == this.#tone));
        button.classList.toggle("selected", tone == this.#tone);
        button.addEventListener("click", () => {
          this.#tone = tone;
          try {
            Services.xulStore.setValue(
              "chrome://swell/content/window.xhtml",
              "swell-window",
              "emojitone",
              String(tone)
            );
          } catch (e) {
            // The tone is a convenience.
          }
          this.#renderTones();
          this.#renderGrid();
        });
        return button;
      })
    );
  }

  #renderTabs() {
    this.#tabs.replaceChildren(
      ...this.#categories.map(category => {
        const tab = this.#doc.createElement("button");
        tab.type = "button";
        tab.className = "emoji-tab";
        tab.textContent = category.icon;
        tab.title = category.name;
        tab.dataset.category = category.name;
        tab.addEventListener("click", () => {
          this.#category = category.name;
          this.#search.value = "";
          this.#renderGrid();
        });
        return tab;
      })
    );
  }

  #renderGrid() {
    if (!this.#categories.length) {
      return;
    }
    const query = this.#search.value.trim().toLowerCase();
    for (const tab of this.#tabs.children) {
      tab.classList.toggle(
        "selected",
        !query && tab.dataset.category == this.#category
      );
    }
    const entries = query
      ? this.#categories
          .flatMap(category => category.emoji)
          .filter(([, keywords]) =>
            query.split(/\s+/).every(word => keywords.includes(word))
          )
      : this.#categories.find(category => category.name == this.#category)
          .emoji;
    // An emoji with skin tones is shown in the chosen one.
    const shown = ([glyph, , skins]) =>
      skins && this.#tone ? skins[this.#tone - 1] : glyph;
    this.#grid.replaceChildren(
      ...entries.map(entry => {
        const glyph = shown(entry);
        const button = this.#doc.createElement("button");
        button.type = "button";
        button.className = "emoji";
        button.textContent = glyph;
        button.title = entry[1].split(" ").slice(0, 4).join(", ");
        button.setAttribute("aria-label", entry[1].split(" ")[0]);
        button.classList.toggle("selected", glyph == this.#glyph);
        button.addEventListener("click", () => this.#choose(glyph));
        return button;
      })
    );
    this.#grid.classList.toggle("none", !entries.length);
  }

  #installDeleteDialog() {
    const doc = this.#doc;
    const dialog = doc.getElementById("delete-space-dialog");
    const cancel = doc.getElementById("delete-space-cancel");
    const accept = doc.getElementById("delete-space-confirm");
    this.confirmDelete = space =>
      new Promise(resolve => {
        doc.getElementById("delete-space-name").textContent =
          `${space.icon.glyph ?? ""} ${space.title}`.trim();
        const finish = answer => {
          cancel.removeEventListener("click", onCancel);
          accept.removeEventListener("click", onConfirm);
          dialog.removeEventListener("close", onCancel);
          if (dialog.open) {
            dialog.close();
          }
          resolve(answer);
        };
        const onCancel = () => finish(false);
        const onConfirm = () => finish(true);
        cancel.addEventListener("click", onCancel);
        accept.addEventListener("click", onConfirm);
        dialog.addEventListener("close", onCancel);
        dialog.showModal();
        cancel.focus();
      });
  }
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { EMOJI_CATEGORIES } from "chrome://swell/content/emoji-data.mjs";

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
  #category = EMOJI_CATEGORIES[0].name;

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

    doc
      .getElementById("space-cancel")
      .addEventListener("click", () => this.#dialog.close());
    doc.getElementById("space-form").addEventListener("submit", event => {
      event.preventDefault();
      this.#save();
    });
    this.#emojiButton.addEventListener("click", () => this.#togglePicker());
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
    this.#renderTabs();
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
    this.#emojiButton.textContent = glyph || "\u{1F642}";
    this.#emojiButton.classList.toggle("empty", !glyph);
    this.#emojiButton.title = glyph ? `${glyph} – change` : NO_EMOJI_LABEL;
    this.#emojiButton.setAttribute("aria-label", this.#emojiButton.title);
    this.#togglePicker(false);
  }

  #togglePicker(show = this.#picker.hidden) {
    this.#picker.hidden = !show;
    this.#emojiButton.setAttribute("aria-expanded", String(show));
    if (show) {
      this.#renderGrid();
      this.#search.focus();
    }
  }

  #renderTabs() {
    this.#tabs.replaceChildren(
      ...EMOJI_CATEGORIES.map(category => {
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
    const query = this.#search.value.trim().toLowerCase();
    for (const tab of this.#tabs.children) {
      tab.classList.toggle(
        "selected",
        !query && tab.dataset.category == this.#category
      );
    }
    const entries = query
      ? EMOJI_CATEGORIES.flatMap(category => category.emoji).filter(
          ([, keywords]) =>
            query.split(/\s+/).every(word => keywords.includes(word))
        )
      : EMOJI_CATEGORIES.find(category => category.name == this.#category)
          .emoji;
    this.#grid.replaceChildren(
      ...entries.map(([glyph, keywords]) => {
        const button = this.#doc.createElement("button");
        button.type = "button";
        button.className = "emoji";
        button.textContent = glyph;
        button.title = keywords;
        button.setAttribute("aria-label", keywords);
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

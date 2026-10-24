/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { AutofillPromptHandler } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/AutofillPrompter.sys.mjs"
);
const { LoginPromptHandler } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/LoginPrompter.sys.mjs"
);
const { autofillStorageFor } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/Autofill.sys.mjs"
);

const ADDRESS = "address";

// The fields of the forms in the dialog; the names are the autofill field names.
const ADDRESS_FIELDS = [
  ["name", "Name"],
  ["organization", "Organization"],
  ["street-address", "Street address"],
  ["address-level2", "City"],
  ["address-level1", "State or province"],
  ["postal-code", "Postal code"],
  ["country", "Country (code, such as US)"],
  ["email", "Email"],
  ["tel", "Phone"],
];
const CARD_FIELDS = [
  ["cc-name", "Name on card"],
  ["cc-number", "Card number"],
  ["cc-exp-month", "Expiry month"],
  ["cc-exp-year", "Expiry year"],
];

function summarizeAddress(record) {
  return [
    record.name,
    record["street-address"]?.replaceAll("\n", ", "),
    record["address-level2"],
    record["postal-code"],
  ]
    .filter(Boolean)
    .join(", ");
}

function summarizeCard(record) {
  const number = record["cc-number"] ?? "";
  return [record["cc-name"], number ? `•••• ${number.slice(-4)}` : ""]
    .filter(Boolean)
    .join(" ");
}

/**
 * The prompt that asks whether to keep an address or card typed into a form,
 * and the dialog that lists, adds, edits and removes the active space's
 * addresses and cards. What is kept belongs to the space: the toolkit hands
 * both a storage of that space's container only.
 */
export class AutofillUI {
  #app;
  #bar;
  #dialog;
  #lists;
  #form;
  #pending = null;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#bar = doc.getElementById("autofill-bar");
    this.#dialog = doc.getElementById("autofill-dialog");
    this.#lists = doc.getElementById("autofill-lists");
    this.#form = doc.getElementById("autofill-form");
    for (const [id, answer] of [
      ["autofill-save", "save"],
      ["autofill-create", "create"],
      ["autofill-never", "disable"],
      ["autofill-later", "later"],
    ]) {
      doc
        .getElementById(id)
        .addEventListener("click", () => this.#answer(answer));
    }
    doc
      .getElementById("autofill-close")
      .addEventListener("click", () => this.#dialog.close());
    app.bridge.on("selected", () => this.#answer("later"));
    app.bridge.on("tabclosed", () => this.#answer("later"));
    AutofillPromptHandler.set(request => this.#ask(request));
    LoginPromptHandler.set(async request => {
      const answer = await this.#askLogin(request);
      return answer == "disable" ? "never" : answer;
    });
  }

  #ask({ type, browser, update, newRecord }) {
    const what = type == ADDRESS ? "address" : "card";
    const summary =
      type == ADDRESS ? summarizeAddress(newRecord) : summarizeCard(newRecord);
    return this.#showBar(browser, {
      text: `${update ? "Update" : "Save"} this ${what}${summary ? ` (${summary})` : ""}?`,
      update,
      never: "Never",
    });
  }

  #askLogin({ browser, update, login }) {
    let site = login.origin;
    try {
      site = new URL(login.origin).host;
    } catch (e) {
      // keep the origin as it is
    }
    const who = login.username ? ` for ${login.username}` : "";
    return this.#showBar(browser, {
      text: `${update ? "Update" : "Save"} the password${who} on ${site}?`,
      update: false,
      never: "Never for this site",
      save: update ? "Update" : "Save",
    });
  }

  // Shows the bar for the page in front; resolves with "save", "create",
  // "disable" or "later". A page that is not in front is not asked.
  #showBar(browser, { text, update, never, save }) {
    const tab = this.#app.bridge.tabForBrowser(browser);
    if (!tab || tab !== this.#app.bridge.selectedTab) {
      return Promise.resolve("later");
    }
    this.#answer("later");
    const doc = this.#app.document;
    doc.querySelector("#autofill-bar .autofill-text").textContent = text;
    doc.getElementById("autofill-save").textContent =
      save ?? (update ? "Update" : "Save");
    doc.getElementById("autofill-create").hidden = !update;
    doc.getElementById("autofill-never").textContent = never;
    this.#bar.hidden = false;
    return new Promise(resolve => {
      this.#pending = resolve;
    });
  }

  #answer(answer) {
    this.#bar.hidden = true;
    const pending = this.#pending;
    this.#pending = null;
    pending?.(answer);
  }

  get #userContextId() {
    return this.#app.space?.userContextId ?? 0;
  }

  async show() {
    await this.#renderLists();
    this.#form.hidden = true;
    if (!this.#dialog.open) {
      this.#dialog.showModal();
    }
  }

  async #renderLists() {
    const doc = this.#app.document;
    const storage = await autofillStorageFor(this.#userContextId);
    const sections = [];
    for (const [title, collection, summarize, fields, kind] of [
      [
        "Addresses",
        await storage.addresses.getAll(),
        summarizeAddress,
        ADDRESS_FIELDS,
        "address",
      ],
      [
        "Cards",
        await storage.creditCards.getAll(),
        summarizeCard,
        CARD_FIELDS,
        "card",
      ],
    ]) {
      const heading = doc.createElement("h3");
      heading.textContent = title;
      sections.push(heading);
      for (const record of collection) {
        const row = doc.createElement("div");
        row.className = "autofill-row";
        const summary = doc.createElement("span");
        summary.className = "autofill-summary";
        summary.textContent = summarize(record) || "(empty)";
        const edit = doc.createElement("button");
        edit.textContent = "Edit";
        edit.addEventListener("click", () => this.#edit(kind, fields, record));
        const remove = doc.createElement("button");
        remove.textContent = "Remove";
        remove.addEventListener("click", async () => {
          await storage[kind == "address" ? "addresses" : "creditCards"].remove(
            record.guid
          );
          await this.#renderLists();
        });
        row.append(summary, edit, remove);
        sections.push(row);
      }
      const add = doc.createElement("button");
      add.textContent = kind == "address" ? "Add address" : "Add card";
      add.addEventListener("click", () => this.#edit(kind, fields, null));
      sections.push(add);
    }
    this.#lists.replaceChildren(...sections);
  }

  #edit(kind, fields, record) {
    const doc = this.#app.document;
    const inputs = fields.map(([fieldName, label]) => {
      const wrapper = doc.createElement("label");
      wrapper.textContent = label;
      const input = doc.createElement("input");
      input.name = fieldName;
      input.value = record?.[fieldName] ?? "";
      input.autocomplete = "off";
      wrapper.append(input);
      return wrapper;
    });
    const buttons = doc.createElement("div");
    buttons.className = "buttons";
    const cancel = doc.createElement("button");
    cancel.type = "button";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", () => {
      this.#form.hidden = true;
      this.#lists.hidden = false;
    });
    const save = doc.createElement("button");
    save.textContent = "Save";
    buttons.append(cancel, save);
    this.#form.replaceChildren(...inputs, buttons);
    this.#form.onsubmit = async event => {
      event.preventDefault();
      const values = {};
      for (const input of this.#form.querySelectorAll("input")) {
        if (input.value.trim()) {
          values[input.name] = input.value.trim();
        }
      }
      const storage = await autofillStorageFor(this.#userContextId);
      const collection =
        kind == "address" ? storage.addresses : storage.creditCards;
      if (record) {
        await collection.update(record.guid, values);
      } else {
        await collection.add(values);
      }
      this.#form.hidden = true;
      this.#lists.hidden = false;
      await this.#renderLists();
    };
    this.#lists.hidden = true;
    this.#form.hidden = false;
  }
}

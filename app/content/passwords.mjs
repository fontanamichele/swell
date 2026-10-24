/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { loginsOfContainer } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/SwellLoginStorage.sys.mjs"
);
const { LoginHelper } = ChromeUtils.importESModule(
  "resource://gre/modules/LoginHelper.sys.mjs"
);

function hostOf(site) {
  try {
    return new URL(site).host;
  } catch (e) {
    return site;
  }
}

/**
 * The passwords of the active space: list, show, add, edit and remove. They
 * are the space's own; the login manager is asked through the container's
 * view of it (LoginHelper.loginsFor), like the page of a tab would.
 */
export class PasswordsUI {
  #app;
  #dialog;
  #list;
  #form;
  #shown = new Set();

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#dialog = doc.getElementById("passwords-dialog");
    this.#list = doc.getElementById("passwords-list");
    this.#form = doc.getElementById("passwords-form");
    doc
      .getElementById("passwords-close")
      .addEventListener("click", () => this.#dialog.close());
  }

  get #userContextId() {
    return this.#app.space?.userContextId ?? 0;
  }

  async show() {
    this.#shown.clear();
    await this.#render();
    this.#list.hidden = false;
    this.#form.hidden = true;
    if (!this.#dialog.open) {
      this.#dialog.showModal();
    }
  }

  async #render() {
    const doc = this.#app.document;
    const logins = await loginsOfContainer(this.#userContextId);
    const rows = logins.map(login => {
      const row = doc.createElement("div");
      row.className = "password-row";
      const site = doc.createElement("span");
      site.className = "password-site";
      site.textContent = hostOf(login.origin);
      const user = doc.createElement("span");
      user.className = "password-user";
      user.textContent = login.username || "(no user name)";
      const secret = doc.createElement("span");
      secret.className = "password-secret";
      const revealed = this.#shown.has(login.guid);
      secret.textContent = revealed ? login.password : "•".repeat(8);
      const reveal = doc.createElement("button");
      reveal.textContent = revealed ? "Hide" : "Show";
      reveal.addEventListener("click", () => {
        if (revealed) {
          this.#shown.delete(login.guid);
        } else {
          this.#shown.add(login.guid);
        }
        this.#render();
      });
      const edit = doc.createElement("button");
      edit.textContent = "Edit";
      edit.addEventListener("click", () => this.#edit(login));
      const remove = doc.createElement("button");
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await LoginHelper.loginsFor(this.#userContextId).removeLoginAsync(
          login
        );
        await this.#render();
      });
      row.append(site, user, secret, reveal, edit, remove);
      return row;
    });
    const add = doc.createElement("button");
    add.textContent = "Add password";
    add.addEventListener("click", () => this.#edit(null));
    const empty = doc.createElement("p");
    empty.className = "downloads-empty";
    empty.textContent = "No passwords in this space";
    this.#list.replaceChildren(...(rows.length ? rows : [empty]), add);
  }

  #edit(login) {
    const doc = this.#app.document;
    const fields = [
      ["origin", "Site (https://example.com)", login?.origin ?? ""],
      ["username", "User name", login?.username ?? ""],
      ["password", "Password", login?.password ?? ""],
    ];
    const inputs = fields.map(([fieldName, label, value]) => {
      const wrapper = doc.createElement("label");
      wrapper.textContent = label;
      const input = doc.createElement("input");
      input.name = fieldName;
      input.value = value;
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
      this.#list.hidden = false;
    });
    const save = doc.createElement("button");
    save.textContent = "Save";
    buttons.append(cancel, save);
    this.#form.replaceChildren(...inputs, buttons);
    this.#form.onsubmit = async event => {
      event.preventDefault();
      const value = field =>
        this.#form.querySelector(`input[name="${field}"]`).value;
      const next = Cc["@mozilla.org/login-manager/loginInfo;1"].createInstance(
        Ci.nsILoginInfo
      );
      next.init(
        login ? login.origin : value("origin").trim(),
        login ? login.formActionOrigin : "",
        login ? login.httpRealm : null,
        value("username"),
        value("password"),
        login ? login.usernameField : "",
        login ? login.passwordField : ""
      );
      const logins = LoginHelper.loginsFor(this.#userContextId);
      try {
        if (login) {
          await logins.modifyLoginAsync(login, next);
        } else {
          await logins.addLoginAsync(next);
        }
      } catch (e) {
        console.error("Swell: could not save the password", e);
        this.#app.toasts.show({
          text: `Could not save that password: ${e.message ?? e}`,
        });
        return;
      }
      this.#form.hidden = true;
      this.#list.hidden = false;
      await this.#render();
    };
    this.#list.hidden = true;
    this.#form.hidden = false;
  }
}

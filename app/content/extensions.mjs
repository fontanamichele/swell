/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const {
  availableFromOtherSpaces,
  copiesOf,
  installCopy,
  installCopyFromUrl,
  installStoredCopy,
} = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs"
);

function describePermissions(info) {
  const wanted = info?.permissions ?? info?.addon?.userPermissions ?? {};
  const permissions = wanted.permissions ?? [];
  const origins = wanted.origins ?? [];
  return [...permissions, ...origins];
}

/**
 * The add-ons of the active space: list, turn off and on, remove, install
 * from a file or an address, and install here what another space has. An
 * add-on is installed once per space, as a copy that only sees that space.
 */
export class ExtensionsUI {
  #app;
  #dialog;
  #list;
  #prompt;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#dialog = doc.getElementById("extensions-dialog");
    this.#list = doc.getElementById("extensions-list");
    this.#prompt = doc.getElementById("extension-prompt");
    doc
      .getElementById("extensions-close")
      .addEventListener("click", () => this.#dialog.close());
  }

  get #userContextId() {
    return this.#app.space?.userContextId ?? 0;
  }

  async show() {
    await this.#render();
    if (!this.#dialog.open) {
      this.#dialog.showModal();
    }
  }

  // Asks whether an add-on may be installed with the permissions it wants.
  #ask(info) {
    const doc = this.#app.document;
    const addon = info?.addon;
    doc.getElementById("extension-prompt-title").textContent =
      `Add ${addon?.name ?? "this add-on"} to this space?`;
    const list = doc.getElementById("extension-prompt-permissions");
    const names = describePermissions(info);
    list.replaceChildren(
      ...(names.length ? names : ["No special permissions"]).map(entry => {
        const item = doc.createElement("li");
        item.textContent = entry;
        return item;
      })
    );
    return new Promise((resolve, reject) => {
      const done = approved => {
        this.#prompt.close();
        if (approved) {
          resolve();
        } else {
          reject(new Error("The user cancelled the installation"));
        }
      };
      doc.getElementById("extension-prompt-add").onclick = () => done(true);
      doc.getElementById("extension-prompt-cancel").onclick = () => done(false);
      this.#prompt.showModal();
    });
  }

  async #attempt(work) {
    try {
      await work();
    } catch (e) {
      console.error("Swell: add-on installation failed", e);
      if (!/cancelled/.test(e.message)) {
        this.#app.toasts.show({
          text: `Could not add that add-on: ${e.message}`,
        });
      }
    }
    await this.#render();
  }

  async #installFromFile() {
    const picker = Cc["@mozilla.org/filepicker;1"].createInstance(
      Ci.nsIFilePicker
    );
    picker.init(
      this.#app.document.defaultView.browsingContext,
      "Choose an add-on",
      Ci.nsIFilePicker.modeOpen
    );
    picker.appendFilter("Add-ons", "*.xpi");
    const result = await new Promise(resolve => picker.open(resolve));
    if (result == Ci.nsIFilePicker.returnOK) {
      await this.#attempt(() =>
        installCopy(picker.file, this.#userContextId, {
          prompt: info => this.#ask(info),
        })
      );
    }
  }

  async #render() {
    const doc = this.#app.document;
    const copies = await copiesOf(this.#userContextId);
    const rows = copies.map(addon => {
      const row = doc.createElement("div");
      row.className = "extension-row";
      const label = doc.createElement("span");
      label.className = "extension-name";
      label.textContent = `${addon.name} ${addon.version}`;
      const toggle = doc.createElement("button");
      toggle.textContent = addon.userDisabled ? "Turn on" : "Turn off";
      toggle.addEventListener("click", async () => {
        await (addon.userDisabled ? addon.enable() : addon.disable());
        await this.#render();
      });
      const remove = doc.createElement("button");
      remove.textContent = "Remove";
      remove.addEventListener("click", async () => {
        await addon.uninstall();
        await this.#render();
      });
      row.append(label, toggle, remove);
      return row;
    });
    const heading = doc.createElement("h3");
    heading.textContent = "Add-ons in this space";
    const empty = doc.createElement("p");
    empty.className = "downloads-empty";
    empty.textContent = "No add-ons in this space";

    const fromFile = doc.createElement("button");
    fromFile.textContent = "Install from a file…";
    fromFile.addEventListener("click", () => this.#installFromFile());
    const address = doc.createElement("input");
    address.type = "url";
    address.placeholder = "https://…/addon.xpi";
    address.autocomplete = "off";
    const fromAddress = doc.createElement("button");
    fromAddress.textContent = "Install from an address";
    fromAddress.addEventListener("click", () => {
      if (address.value.trim()) {
        this.#attempt(() =>
          installCopyFromUrl(address.value.trim(), this.#userContextId, {
            prompt: info => this.#ask(info),
          })
        );
      }
    });
    const install = doc.createElement("div");
    install.className = "extension-install";
    install.append(fromFile, address, fromAddress);

    const sections = [heading, ...(rows.length ? rows : [empty]), install];
    const others = await availableFromOtherSpaces(this.#userContextId);
    if (others.length) {
      const otherHeading = doc.createElement("h3");
      otherHeading.textContent = "From your other spaces";
      sections.push(otherHeading);
      for (const { originalId, name: addonName } of others) {
        const row = doc.createElement("div");
        row.className = "extension-row";
        const label = doc.createElement("span");
        label.className = "extension-name";
        label.textContent = addonName;
        const add = doc.createElement("button");
        add.textContent = "Add to this space";
        add.addEventListener("click", () =>
          this.#attempt(() =>
            installStoredCopy(originalId, this.#userContextId, {
              prompt: info => this.#ask(info),
            })
          )
        );
        row.append(label, add);
        sections.push(row);
      }
    }
    this.#list.replaceChildren(...sections);
  }
}

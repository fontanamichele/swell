/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const fileName = download =>
  PathUtils.filename(download.target.path ?? "") || "file";

function reveal(download) {
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(download.target.path);
  file.reveal();
}

function stateOf(download) {
  if (download.succeeded) {
    return "Done";
  }
  if (download.error) {
    return "Failed";
  }
  if (download.canceled) {
    return "Canceled";
  }
  return download.progress ? `${download.progress}%` : "Starting";
}

/**
 * Tells when a download of the active space starts and finishes, and lists
 * that space's downloads. Each download remembers the container it came from
 * (`source.userContextId`); a space never sees another space's downloads,
 * not even their names in a toast.
 */
export class DownloadsPanel {
  #app;
  #list = null;
  #panel;
  #sidebar;
  #rows;
  #toasts = new WeakMap();

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#panel = doc.getElementById("downloads-panel");
    this.#sidebar = doc.getElementById("sidebar");
    this.#rows = doc.getElementById("downloads-list");
  }

  /** Whether the list is showing in the sidebar. */
  get visible() {
    return !this.#panel.hidden;
  }

  async init() {
    this.#list = await this.#app.Downloads.getList(this.#app.Downloads.ALL);
    await this.#list.addView({
      onDownloadAdded: download => {
        if (!download.stopped && this.#inActiveSpace(download)) {
          this.#toasts.set(
            download,
            this.#app.toasts.show({
              text: `Downloading ${fileName(download)}`,
              timeout: 0,
            })
          );
        }
        this.#refresh();
      },
      onDownloadChanged: download => {
        this.#refresh();
        const toast = this.#toasts.get(download);
        if (!toast) {
          return;
        }
        if (download.succeeded) {
          toast.dismiss();
          this.#toasts.delete(download);
          this.#app.toasts.show({
            text: `Downloaded ${fileName(download)}`,
            actions: [{ label: "Show in folder", run: () => reveal(download) }],
          });
        } else if (download.error) {
          toast.dismiss();
          this.#toasts.delete(download);
          this.#app.toasts.show({
            text: `Download of ${fileName(download)} failed`,
          });
        }
      },
      onDownloadRemoved: () => this.#refresh(),
    });
  }

  #inActiveSpace(download) {
    const space = this.#app.space;
    return (
      !!space && (download.source.userContextId ?? 0) == space.userContextId
    );
  }

  /** The downloads of the active space, newest first. */
  async forActiveSpace() {
    const all = await this.#list.getAll();
    return all.filter(d => this.#inActiveSpace(d)).reverse();
  }

  async show() {
    this.#panel.hidden = false;
    this.#sidebar.dataset.view = "downloads";
    await this.#refresh();
  }

  hide() {
    this.#panel.hidden = true;
    delete this.#sidebar.dataset.view;
  }

  toggle() {
    return this.visible ? this.hide() : this.show();
  }

  async #refresh() {
    const doc = this.#app.document;
    const downloads = await this.forActiveSpace();
    if (!downloads.length) {
      const empty = doc.createElement("p");
      empty.className = "downloads-empty";
      empty.textContent = "No downloads in this space";
      this.#rows.replaceChildren(empty);
      return;
    }
    this.#rows.replaceChildren(
      ...downloads.map(download => {
        const row = doc.createElement("div");
        row.className = "download-row";
        const label = doc.createElement("span");
        label.className = "download-name";
        label.textContent = fileName(download);
        const state = doc.createElement("span");
        state.className = "download-state";
        state.textContent = stateOf(download);
        const actions = doc.createElement("div");
        actions.className = "download-actions";
        if (download.succeeded) {
          const show = doc.createElement("button");
          show.textContent = "Show";
          show.title = "Show in folder";
          show.addEventListener("click", () => reveal(download));
          actions.append(show);
        }
        const remove = doc.createElement("button");
        remove.textContent = "Remove";
        remove.addEventListener("click", () => this.#list.remove(download));
        actions.append(remove);
        row.append(label, state, actions);
        return row;
      })
    );
  }
}

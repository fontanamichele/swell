/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

const REPOSITORY_PREF = "swell.update.repository";
const CHANNEL_PREF = "swell.update.channel";

/**
 * Compares two versions of the form `v1.2.3` or `1.2.3` (a pre-release suffix is
 * ignored).
 *
 * @param {string} a
 * @param {string} b
 * @returns {number} Negative when `a` is older than `b`, 0 when equal, positive when newer.
 */
export function compareVersions(a, b) {
  const parts = version =>
    String(version)
      .replace(/^v/i, "")
      .split(/[-+]/)[0]
      .split(".")
      .map(part => parseInt(part, 10) || 0);
  const x = parts(a);
  const y = parts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const difference = (x[i] ?? 0) - (y[i] ?? 0);
    if (difference) {
      return difference;
    }
  }
  return 0;
}

/**
 * Asks GitHub for the newest release of the project and says whether it is newer than
 * `current`. Nothing is sent unless this is called. `releases/latest` leaves out
 * pre-releases, which every alpha is, so the list is read instead.
 *
 * @param {object} options
 * @param {string} options.current The running version.
 * @param {string} options.repository `owner/name` on GitHub.
 * @param {boolean} options.prereleases Whether pre-releases count (the alpha channel).
 * @param {Function} [options.fetchJson] Replaces the request, for tests.
 * @returns {Promise<{available: boolean, version?: string, url?: string, notes?: string}>}
 */
export async function checkForUpdate({
  current,
  repository,
  prereleases,
  fetchJson = async url => {
    const response = await fetch(url, {
      headers: { Accept: "application/vnd.github+json" },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error(`GitHub answered ${response.status}`);
    }
    return response.json();
  },
}) {
  const releases = await fetchJson(
    `https://api.github.com/repos/${repository}/releases?per_page=20`
  );
  const newest = releases
    .filter(release => !release.draft && (prereleases || !release.prerelease))
    .sort((a, b) => compareVersions(b.tag_name, a.tag_name))[0];
  if (!newest || compareVersions(newest.tag_name, current) <= 0) {
    return { available: false };
  }
  return {
    available: true,
    version: newest.tag_name.replace(/^v/i, ""),
    url: newest.html_url,
    notes: (newest.body ?? "").trim().slice(0, 600),
  };
}

/**
 * The build date of the running application, as `2026-10-26 10:38`.
 *
 * @param {string} buildID The application's build id, `YYYYMMDDhhmmss`.
 * @returns {string}
 */
export function buildDate(buildID) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(buildID);
  return m ? `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}` : buildID;
}

/**
 * The About Swell dialog: the version and build, and a manual check for updates.
 */
export class AboutDialog {
  #app;
  #dialog;
  #status;
  #check;
  #download;
  #update = null;

  constructor(app) {
    this.#app = app;
    const doc = app.document;
    this.#dialog = doc.getElementById("about-dialog");
    this.#status = doc.getElementById("about-update-status");
    this.#check = doc.getElementById("about-check");
    this.#download = doc.getElementById("about-download");
    this.#check.addEventListener("click", () => this.#checkNow());
    this.#download.addEventListener("click", () => {
      if (this.#update) {
        this.#app.openUrlInActiveSpace(this.#update.url);
        this.#dialog.close();
      }
    });
    doc
      .getElementById("about-close")
      .addEventListener("click", () => this.#dialog.close());
    for (const link of doc.querySelectorAll("#about-dialog [data-url]")) {
      link.addEventListener("click", event => {
        event.preventDefault();
        this.#app.openUrlInActiveSpace(link.dataset.url);
        this.#dialog.close();
      });
    }
  }

  get version() {
    return AppConstants.MOZ_APP_VERSION_DISPLAY;
  }

  show() {
    const doc = this.#app.document;
    const info = Services.appinfo;
    doc.getElementById("about-version").textContent = `Version ${this.version}`;
    doc.getElementById("about-build").textContent =
      `Build ${buildDate(info.appBuildID)} · Gecko ${info.platformVersion} · ${AppConstants.platform} ${Services.sysinfo.getProperty("arch")}`;
    this.#reset();
    if (!this.#dialog.open) {
      this.#dialog.showModal();
    }
  }

  #reset() {
    this.#update = null;
    this.#status.textContent = "";
    this.#download.hidden = true;
    this.#check.disabled = false;
  }

  async #checkNow() {
    this.#check.disabled = true;
    this.#download.hidden = true;
    this.#status.textContent = "Checking…";
    try {
      const result = await checkForUpdate({
        current: this.version,
        repository: Services.prefs.getStringPref(REPOSITORY_PREF, ""),
        prereleases:
          Services.prefs.getStringPref(CHANNEL_PREF, "alpha") != "stable",
      });
      if (result.available) {
        this.#update = result;
        this.#status.textContent = `Swell ${result.version} is available.`;
        this.#download.hidden = false;
      } else {
        this.#status.textContent = "Swell is up to date.";
      }
    } catch (e) {
      console.error("Swell: the update check failed", e);
      this.#status.textContent =
        "Could not check for updates. Check your connection and try again.";
    }
    this.#check.disabled = false;
  }
}

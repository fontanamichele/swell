/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { checkForUpdate } from "chrome://swell/content/about.mjs";

const { AppConstants } = ChromeUtils.importESModule(
  "resource://gre/modules/AppConstants.sys.mjs"
);

const AUTOCHECK_PREF = "swell.update.autocheck";
const LAST_CHECK_PREF = "swell.update.lastCheck";
const DISMISSED_PREF = "swell.update.dismissed";
const REPOSITORY_PREF = "swell.update.repository";
const CHANNEL_PREF = "swell.update.channel";

const CHECK_INTERVAL_SECONDS = 24 * 60 * 60;
const STARTUP_DELAY_MS = 30 * 1000;

/**
 * Looks for a newer release on GitHub once a day while the application runs, and shows
 * a badge above the spaces when there is one. The manual check in the About dialog goes
 * through the same `check()`.
 */
export class UpdateNotifier {
  #app;
  #row;
  #badge;
  #label;
  #dismiss;
  #fetchJson;
  #delay;
  #update = null;
  #timer = null;

  /**
   * @param {object} app
   * @param {object} [options]
   * @param {Function} [options.fetchJson] Replaces the request, for tests.
   * @param {number} [options.delay] Milliseconds between startup and the check.
   */
  constructor(app, { fetchJson, delay = STARTUP_DELAY_MS } = {}) {
    this.#app = app;
    this.#fetchJson = fetchJson;
    this.#delay = delay;
    const doc = app.document;
    this.#row = doc.getElementById("update-row");
    this.#badge = doc.getElementById("update-badge");
    this.#label = doc.getElementById("update-label");
    this.#dismiss = doc.getElementById("update-dismiss");
    this.#badge.addEventListener("click", () => {
      if (this.#update) {
        this.#app.openUrlInActiveSpace(this.#update.url);
      }
    });
    this.#dismiss.addEventListener("click", () => {
      if (this.#update) {
        Services.prefs.setStringPref(DISMISSED_PREF, this.#update.version);
      }
      this.#show(null);
    });
  }

  get update() {
    return this.#update;
  }

  start() {
    if (this.#timer || !Services.prefs.getBoolPref(AUTOCHECK_PREF, false)) {
      return;
    }
    const last = Services.prefs.getIntPref(LAST_CHECK_PREF, 0);
    const now = Math.floor(Date.now() / 1000);
    const wait =
      Math.max(0, last + CHECK_INTERVAL_SECONDS - now) * 1000 + this.#delay;
    this.#timer = this.#app.document.defaultView.setTimeout(() => {
      this.#timer = null;
      this.#automatic();
    }, wait);
  }

  async #automatic() {
    if (!Services.prefs.getBoolPref(AUTOCHECK_PREF, false)) {
      return;
    }
    try {
      await this.check();
    } catch (e) {
      console.error("Swell: the automatic update check failed", e);
    }
    this.start();
  }

  /**
   * Asks GitHub for the newest release and updates the badge.
   *
   * @param {object} [options]
   * @param {boolean} [options.manual] A request of the user: a release dismissed
   *   earlier is shown again.
   * @returns {Promise<object>} The result of `checkForUpdate`.
   */
  async check({ manual = false } = {}) {
    Services.prefs.setIntPref(LAST_CHECK_PREF, Math.floor(Date.now() / 1000));
    const result = await checkForUpdate({
      current: AppConstants.MOZ_APP_VERSION_DISPLAY,
      repository: Services.prefs.getStringPref(REPOSITORY_PREF, ""),
      prereleases:
        Services.prefs.getStringPref(CHANNEL_PREF, "alpha") != "stable",
      ...(this.#fetchJson && { fetchJson: this.#fetchJson }),
    });
    if (manual) {
      Services.prefs.clearUserPref(DISMISSED_PREF);
    }
    const dismissed = Services.prefs.getStringPref(DISMISSED_PREF, "");
    this.#show(result.available && result.version != dismissed ? result : null);
    return result;
  }

  #show(update) {
    this.#update = update;
    this.#row.hidden = !update;
    if (update) {
      this.#label.textContent = `Swell ${update.version} is available`;
      this.#badge.title = "Open the download page";
    }
  }
}

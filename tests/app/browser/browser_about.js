/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { compareVersions, checkForUpdate, buildDate } =
  ChromeUtils.importESModule("chrome://swell/content/about.mjs");

const release = (tag, extra = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/example/swell/releases/tag/${tag}`,
  body: `Notes of ${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
});

add_task(function test_versions_compare_numbers_not_text() {
  Assert.less(compareVersions("0.9.0", "0.10.0"), 0, "0.9 is older than 0.10");
  Assert.less(compareVersions("v0.49.6", "0.50.0"), 0, "the v is ignored");
  Assert.equal(compareVersions("1.0", "1.0.0"), 0, "missing parts are zero");
  Assert.greater(
    compareVersions("1.2.3", "1.2.2-alpha"),
    0,
    "a suffix is ignored"
  );
});

add_task(function test_the_build_date_is_readable() {
  Assert.equal(buildDate("20261026103845"), "2026-10-26 10:38");
});

add_task(
  async function test_the_check_finds_a_newer_release_and_nothing_else() {
    const asked = [];
    const fetchJson = list => async url => {
      asked.push(url);
      return list;
    };
    const base = { repository: "example/swell", prereleases: true };

    let result = await checkForUpdate({
      ...base,
      current: "0.49.6",
      fetchJson: fetchJson([
        release("v0.49.5", { prerelease: true }),
        release("v0.50.1", { prerelease: true }),
        release("v0.50.0", { prerelease: true }),
        release("v9.0.0", { draft: true }),
      ]),
    });
    Assert.ok(result.available, "a newer pre-release is found");
    Assert.equal(result.version, "0.50.1", "the newest, not the first listed");
    Assert.ok(result.url.endsWith("/v0.50.1"), "with its page");
    Assert.equal(result.notes, "Notes of v0.50.1");
    Assert.equal(
      asked[0],
      "https://api.github.com/repos/example/swell/releases?per_page=20",
      "one request, to the releases of the project"
    );

    result = await checkForUpdate({
      ...base,
      current: "0.50.1",
      fetchJson: fetchJson([release("v0.50.1", { prerelease: true })]),
    });
    Assert.ok(!result.available, "the same version is not an update");

    result = await checkForUpdate({
      ...base,
      prereleases: false,
      current: "0.49.6",
      fetchJson: fetchJson([release("v0.50.1", { prerelease: true })]),
    });
    Assert.ok(!result.available, "the stable channel leaves pre-releases out");

    result = await checkForUpdate({
      ...base,
      current: "0.49.6",
      fetchJson: fetchJson([]),
    });
    Assert.ok(!result.available, "no releases, no update");
  }
);

add_task(async function test_about_shows_the_version_and_build() {
  const { app } = await swellApp();
  app.about.show();
  const dialog = document.getElementById("about-dialog");
  Assert.ok(dialog.open, "About opens");
  Assert.equal(
    document.getElementById("about-version").textContent,
    `Version ${AppConstants.MOZ_APP_VERSION_DISPLAY}`,
    "with the version of the application"
  );
  const build = document.getElementById("about-build").textContent;
  Assert.ok(
    build.includes(buildDate(Services.appinfo.appBuildID)),
    `and the build date: ${build}`
  );
  Assert.ok(
    build.includes(`Gecko ${Services.appinfo.platformVersion}`),
    "and the engine"
  );
  Assert.ok(
    document.getElementById("about-download").hidden,
    "no download yet"
  );
  Assert.ok(
    !!document.querySelector('#main-menubar [data-action="about"]'),
    "the menu has About Swell"
  );
  document.getElementById("about-close").click();
  Assert.ok(!dialog.open, "Close closes it");
});

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Forgets what the engine keeps for the container of a deleted space. The core
// has already dropped the space's tabs, history, logins and zoom; this is the
// rest: site data, permissions, Places visits, form history, address and card
// files, the key of the saved logins, add-on copies and downloads. A container
// id is never given to another space, so anything missed would stay
// unreachable, but it would still be on disk.

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  FormHistory: "resource://gre/modules/FormHistory.sys.mjs",
  PlacesUtils: "resource://gre/modules/PlacesUtils.sys.mjs",
  Downloads: "resource://gre/modules/Downloads.sys.mjs",
  copiesOf: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
  deleteLoginsKey: "moz-src:///swell/app/modules/SwellLoginStorage.sys.mjs",
});

function clearSiteData(userContextId) {
  return new Promise((resolve, reject) => {
    const rv = Services.clearData.deleteDataFromOriginAttributesPattern(
      { userContextId },
      {
        onDataDeleted: code =>
          code ? reject(new Error(`clear data: ${code}`)) : resolve(),
      }
    );
    if (rv) {
      reject(new Error(`clear data: ${rv}`));
    }
  });
}

// Visits made in the container go. A page that was only ever visited there is
// removed whole, so that its address and title do not stay behind; the others
// keep their visits from other containers and get their counts worked out
// again.
async function clearHistory(userContextId) {
  const onlyHere = await lazy.PlacesUtils.withConnectionWrapper(
    "SpaceCleanup: pages only visited in the container",
    async db => {
      const rows = await db.executeCached(
        `SELECT p.url FROM moz_places p
         JOIN moz_historyvisits v ON v.place_id = p.id
         GROUP BY p.id
         HAVING SUM(v.userContextId != :id) = 0`,
        { id: userContextId }
      );
      return rows.map(row => row.getResultByName("url"));
    }
  );
  if (onlyHere.length) {
    await lazy.PlacesUtils.history.remove(onlyHere);
  }
  await lazy.PlacesUtils.withConnectionWrapper(
    "SpaceCleanup: visits of the container",
    async db => {
      await db.executeCached(
        `UPDATE moz_places SET recalc_frecency = 1, recalc_alt_frecency = 1
         WHERE id IN (SELECT place_id FROM moz_historyvisits WHERE userContextId = :id)`,
        { id: userContextId }
      );
      await db.executeCached(
        `UPDATE moz_places SET
           visit_count = (SELECT COUNT(*) FROM moz_historyvisits v
                          WHERE v.place_id = moz_places.id
                            AND v.userContextId != :id
                            AND v.visit_type NOT IN (0, 4, 7, 8, 9)),
           last_visit_date = (SELECT MAX(visit_date) FROM moz_historyvisits v
                              WHERE v.place_id = moz_places.id
                                AND v.userContextId != :id)
         WHERE id IN (SELECT place_id FROM moz_historyvisits WHERE userContextId = :id)`,
        { id: userContextId }
      );
      await db.executeCached(
        "DELETE FROM moz_historyvisits WHERE userContextId = :id",
        { id: userContextId }
      );
    }
  );
}

function clearFormHistory(userContextId) {
  return lazy.FormHistory.update({ op: "remove", userContextId });
}

async function clearAutofill(userContextId) {
  const path = PathUtils.join(
    PathUtils.profileDir,
    `autofill-profiles-${userContextId}.json`
  );
  await IOUtils.remove(path, { ignoreAbsent: true });
  await IOUtils.remove(`${path}.tmp`, { ignoreAbsent: true });
}

async function removeExtensions(userContextId) {
  for (const addon of await lazy.copiesOf(userContextId)) {
    await addon.uninstall();
  }
}

async function clearDownloads(userContextId) {
  const list = await lazy.Downloads.getList(lazy.Downloads.ALL);
  for (const download of await list.getAll()) {
    if ((download.source.userContextId ?? 0) == userContextId) {
      await list.remove(download);
    }
  }
}

/**
 * Forgets everything the engine holds for a container.
 *
 * @param {number} userContextId
 * @returns {Promise<string[]>} What went wrong, one message per step that
 *   failed; the other steps still run.
 */
export async function forgetContainer(userContextId) {
  if (!userContextId) {
    throw new Error("The default container is not a space's");
  }
  const failures = [];
  const steps = {
    "site data": clearSiteData,
    history: clearHistory,
    "form history": clearFormHistory,
    "addresses and cards": clearAutofill,
    "saved password key": lazy.deleteLoginsKey,
    add_ons: removeExtensions,
    downloads: clearDownloads,
  };
  for (const [name, step] of Object.entries(steps)) {
    try {
      await step(userContextId);
    } catch (e) {
      console.error(`Swell: forgetting the ${name} of a space failed`, e);
      failures.push(`${name}: ${e.message ?? e}`);
    }
  }
  return failures;
}

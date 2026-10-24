/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

ChromeUtils.defineESModuleGetters(this, {
  AddonManager: "resource://gre/modules/AddonManager.sys.mjs",
  ExtensionData: "resource://gre/modules/Extension.sys.mjs",
  FileUtils: "resource://gre/modules/FileUtils.sys.mjs",
  ExtensionTestCommon: "resource://testing-common/ExtensionTestCommon.sys.mjs",
  InstallError: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
  copiesOf: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
  deriveCopy: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
  derivedId: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
  installCopy: "moz-src:///swell/app/modules/ExtensionInstaller.sys.mjs",
});

function fixture(id, extra = {}) {
  return ExtensionTestCommon.generateXPI({
    manifest: {
      name: "Fixture",
      version: "1.0",
      browser_specific_settings: {
        gecko: { id, update_url: "https://updates.example/updates.json" },
      },
      ...extra,
    },
  });
}

add_task(async function test_ids_carry_the_container_and_map_back() {
  Assert.equal(derivedId("name@example.org", 3), "name--s3@example.org");
  Assert.equal(
    derivedId("{446900e4-71c2-419f-a6a7-df9c091e268b}", 7),
    "446900e4-71c2-419f-a6a7-df9c091e268b--s7@derived.swell.invalid"
  );
  Assert.throws(
    () => derivedId("a@b.c", 0),
    InstallError,
    "container 0 owns none"
  );
  for (const original of [
    "name@example.org",
    "{446900e4-71c2-419f-a6a7-df9c091e268b}",
  ]) {
    const id = derivedId(original, 12);
    Assert.equal(ExtensionData.boundUserContextIdOf(id), 12);
    Assert.equal(ExtensionData.originalIdOf(id), original, "maps back");
  }
  Assert.equal(ExtensionData.boundUserContextIdOf("plain@example.org"), -1);
  Assert.equal(
    ExtensionData.originalIdOf("plain@example.org"),
    "plain@example.org"
  );
});

add_task(async function test_a_copy_drops_the_signature_and_the_update_url() {
  const xpi = await fixture("orig@swell.test");
  const dir = await IOUtils.createUniqueDirectory(PathUtils.tempDir, "swell-t");
  const outDir = new FileUtils.File(dir);
  const copy = deriveCopy(xpi, 5, outDir);
  Assert.equal(copy.id, "orig--s5@swell.test");
  Assert.equal(copy.originalId, "orig@swell.test");
  const reader = Cc["@mozilla.org/libjar/zip-reader;1"].createInstance(
    Ci.nsIZipReader
  );
  reader.open(copy.file);
  const entries = [...reader.findEntries("*")];
  const input = Cc["@mozilla.org/scriptableinputstream;1"].createInstance(
    Ci.nsIScriptableInputStream
  );
  input.init(reader.getInputStream("manifest.json"));
  const manifest = JSON.parse(input.read(input.available()));
  reader.close();
  Assert.ok(
    !entries.some(name => name.startsWith("META-INF/")),
    "no signature"
  );
  Assert.equal(manifest.browser_specific_settings.gecko.id, copy.id);
  Assert.ok(
    !("update_url" in manifest.browser_specific_settings.gecko),
    "no update address of its own"
  );
  await IOUtils.remove(dir, { recursive: true });
});

add_task(async function test_a_copy_is_installed_for_one_space_only() {
  const { app } = await swellApp();
  const a = await freshSpace(app, "Install A");
  const b = await freshSpace(app, "Install B");
  const xpi = await fixture("installed@swell.test");

  await Assert.rejects(
    installCopy(xpi, a.userContextId),
    InstallError,
    "an add-on not signed by Mozilla is refused"
  );

  let prompted = 0;
  const addon = await installCopy(xpi, a.userContextId, {
    allowUnsigned: true,
    prompt: async () => {
      prompted++;
    },
  });
  Assert.equal(addon.id, `installed--s${a.userContextId}@swell.test`);
  Assert.equal(prompted, 1, "the permissions were put to the user");
  Assert.deepEqual(
    (await copiesOf(a.userContextId)).map(c => c.id),
    [addon.id]
  );
  Assert.deepEqual(await copiesOf(b.userContextId), [], "nothing in space B");

  const other = await installCopy(xpi, b.userContextId, {
    allowUnsigned: true,
  });
  Assert.notEqual(other.id, addon.id, "a copy of its own for space B");
  Assert.equal((await copiesOf(a.userContextId)).length, 1);

  await addon.uninstall();
  await other.uninstall();
  Assert.deepEqual(await copiesOf(a.userContextId), [], "removed");
  Assert.ok(!(await AddonManager.getAddonByID(addon.id)));
});

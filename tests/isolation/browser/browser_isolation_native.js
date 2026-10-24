/* Any copyright is dedicated to the Public Domain.
   http://creativecommons.org/publicdomain/zero/1.0/ */

"use strict";

// Native messaging with derived copies. The echo host only allows the
// original ID, as a real host manifest (for example 1Password's) would.

const ORIGINAL_ID = "fixture@swell.test";
const COPY_IDS = ["fixture--sa@swell.test", "fixture--sb@swell.test"];
const SLUG = AppConstants.platform === "linux" ? "native-messaging-hosts" : "NativeMessagingHosts";

const HOST = `#!/usr/bin/env python3
import json, os, struct, sys
n = struct.unpack("=I", sys.stdin.buffer.read(4))[0]
msg = json.loads(sys.stdin.buffer.read(n))
out = json.dumps({"echo": msg, "pid": os.getpid()}).encode()
sys.stdout.buffer.write(struct.pack("=I", len(out)) + out)
sys.stdout.buffer.flush()
`;

let tmpDir;

add_setup(async function () {
  tmpDir = Services.dirsvc.get("TmpD", Ci.nsIFile);
  tmpDir.append("swell-native");
  tmpDir.createUnique(Ci.nsIFile.DIRECTORY_TYPE, 0o700);
  let hosts = PathUtils.join(tmpDir.path, SLUG);
  await IOUtils.makeDirectory(hosts);
  let script = PathUtils.join(hosts, "swell_echo.py");
  await IOUtils.writeUTF8(script, HOST);
  await IOUtils.setPermissions(script, 0o755);
  await IOUtils.writeJSON(PathUtils.join(hosts, "swell_echo.json"), {
    name: "swell_echo",
    description: "Swell M0 echo host",
    path: script,
    type: "stdio",
    allowed_extensions: [ORIGINAL_ID],
  });
  let provider = {
    getFile(property) {
      return property == "XREUserNativeManifests" ||
        property == "XRESysNativeManifests"
        ? tmpDir.clone()
        : null;
    },
  };
  Services.dirsvc.registerProvider(provider);
  registerCleanupFunction(async () => {
    Services.dirsvc.unregisterProvider(provider);
    await IOUtils.remove(tmpDir.path, { recursive: true });
  });
});

function loadCopy(id) {
  return ExtensionTestUtils.loadExtension({
    useAddonManager: "temporary",
    manifest: {
      browser_specific_settings: { gecko: { id } },
      permissions: ["nativeMessaging"],
    },
    background() {
      browser.test.onMessage.addListener(async () => {
        try {
          let reply = await browser.runtime.sendNativeMessage("swell_echo", {
            hello: browser.runtime.id,
          });
          browser.test.sendMessage("native", { ok: true, reply });
        } catch (e) {
          browser.test.sendMessage("native", { ok: false, error: e.message });
        }
      });
      browser.test.sendMessage("ready");
    },
  });
}

async function tryNative(ids) {
  let exts = ids.map(loadCopy);
  let results = [];
  for (let ext of exts) {
    await ext.startup();
    await ext.awaitMessage("ready");
  }
  for (let ext of exts) {
    ext.sendMessage("go");
    results.push(await ext.awaitMessage("native"));
  }
  for (let ext of exts) {
    await ext.unload();
  }
  return results;
}

add_task(async function test_without_mapping() {
  let [r] = await tryNative([COPY_IDS[0]]);
  info(`OBS|native|a|rejected without id mapping|${r.ok ? "connected" : "rejected"}|${JSON.stringify(r)}`);
  ok(!r.ok, "A derived ID is rejected by a host that lists only the original ID");
});

add_task(async function test_with_mapping_two_copies() {
  await SpecialPowers.pushPrefEnv({
    set: COPY_IDS.map(id => [`swell.spike.originalId.${id}`, ORIGINAL_ID]),
  });
  let results = await tryNative(COPY_IDS);
  info(`OBS|native|a+b|connect with id mapping|${results.every(r => r.ok) ? "connected" : "rejected"}|${JSON.stringify(results)}`);
  ok(results.every(r => r.ok), "Both copies reach the host when mapped back to the original ID");
  isnot(results[0].reply?.pid, results[1].reply?.pid, "Each copy gets its own host process");
  await SpecialPowers.popPrefEnv();
});

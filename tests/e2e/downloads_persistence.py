#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Starts Swell twice on one profile and checks that a finished download is still in
the list, with the container it came from.

Run from the firefox/ directory:
    MOZCONFIG=$PWD/swell/mozconfig ./mach python swell/tests/e2e/downloads_persistence.py
"""

import os
import shutil
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(__file__))
import restart_persistence as rp

MAKE = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  const { core } = await window.SwellApp.ready;
  const src = PathUtils.join(PathUtils.profileDir, "swell-dl-src.txt");
  await IOUtils.writeUTF8(src, "hello");
  const target = PathUtils.join(PathUtils.profileDir, "swell-dl-target.txt");
  const list = await Downloads.getList(Downloads.ALL);
  const d = await Downloads.createDownload({ source: { url: Services.io.newFileURI(await IOUtils.getFile(src)).spec, userContextId: 1 }, target });
  await list.add(d);
  await d.start();
  done({ succeeded: d.succeeded, count: (await list.getAll()).length });
})().catch(e => done("ERR " + e));
"""
CHECK = r"""
const done = arguments[arguments.length - 1];
(async () => {
  const { Downloads } = ChromeUtils.importESModule("resource://gre/modules/Downloads.sys.mjs");
  await window.SwellApp.ready;
  const list = await Downloads.getList(Downloads.ALL);
  const all = await list.getAll();
  done({ count: all.length, ctx: all.map(d => d.source.userContextId), rows: document.getElementById("downloads-list")?.children.length });
})().catch(e => done("ERR " + e));
"""


def main():
    profile = tempfile.mkdtemp(prefix="swell-downloads-")
    failures = []
    try:
        proc, client = rp.launch(profile)
        made = client.execute_async_script(MAKE)
        print("first launch:", made)
        if isinstance(made, str) or not made["succeeded"]:
            failures.append(f"the download did not finish: {made}")
        time.sleep(3)  # the store saves a moment after a change
        rp.quit_app(client, proc)
        if not os.path.exists(os.path.join(profile, "downloads.json")):
            failures.append("downloads.json was not written")

        proc, client = rp.launch(profile)
        state = client.execute_async_script(CHECK)
        print("second launch:", state)
        if isinstance(state, str):
            failures.append(state)
        elif state["count"] != 1 or state["ctx"] != [1]:
            failures.append(
                f"the download did not come back with its container: {state}"
            )
        rp.quit_app(client, proc)
    finally:
        shutil.rmtree(profile, ignore_errors=True)
    if failures:
        print("FAIL:", *failures, sep="\n  ")
        return 1
    print("OK: a finished download survives a restart with its container")
    return 0


if __name__ == "__main__":
    sys.exit(main())

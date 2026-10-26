#!/usr/bin/env python3
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
"""Fails if a tracked source file has no MPL header in its first lines.

usage: tools/check-headers.py   (from anywhere inside the repository)
"""

import re
import subprocess
import sys

EXTENSIONS = re.compile(r"\.(rs|mjs|js|py|sh|css|conf|build|html)$")
SKIP = ("core/target/", "patches/")

root = subprocess.run(
    ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True
).stdout.strip()
files = subprocess.run(
    ["git", "ls-files"], cwd=root, capture_output=True, text=True, check=True
).stdout.split()
missing = []
for name in files:
    if not EXTENSIONS.search(name) or name.startswith(SKIP):
        continue
    with open(f"{root}/{name}", encoding="utf-8", errors="replace") as fh:
        head = "".join(fh.readline() for _ in range(8))
    if "Mozilla Public" not in head and "MPL" not in head:
        missing.append(name)
if missing:
    print("Missing the MPL header:", *missing, sep="\n  ")
    sys.exit(1)
print(f"MPL header present in every source file ({len(files)} tracked files checked)")

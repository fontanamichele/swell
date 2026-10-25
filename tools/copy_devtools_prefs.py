#!/usr/bin/env python3
"""Copies the defaults of the developer tools out of Firefox's own preference file.

usage: copy_devtools_prefs.py

The developer tools take their defaults from browser/app/profile/firefox.js, a
block from "// Toolbox preferences" to the pref "devtools.settings.redesign-enabled",
which Swell does not use. This writes that block to
app/defaults/preferences/devtools.js with its preprocessor lines resolved for
a build that is neither nightly nor official (no define is set). Run it again
after a new Firefox revision, then `./mach lint --fix swell/app` to format it.
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "browser/app/profile/firefox.js"
OUTPUT = ROOT / "swell/app/defaults/preferences/devtools.js"
HEADER = """/* eslint-disable */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The defaults of the developer tools, copied from Firefox's
// browser/app/profile/firefox.js by tools/copy_devtools_prefs.py. Do not edit.

"""


def condition(line):
    """Whether the directive is true with nothing defined, or None if it is not one."""
    m = re.match(r"#\s*(ifdef|ifndef|if)\s*(.*)$", line)
    if not m:
        return None
    kind, rest = m.groups()
    if kind == "ifdef":
        return False
    if kind == "ifndef":
        return True
    names = re.findall(r"defined\((\w+)\)", rest)
    if not names or re.sub(r"defined\(\w+\)|\s|!|&&|\|\|", "", rest):
        sys.exit(f"cannot resolve: {line}")
    if "&&" in rest or "||" in rest or "!" in rest:
        sys.exit(f"cannot resolve: {line}")
    return False


def main():
    lines = SOURCE.read_text().split("\n")
    start = next(
        i for i, l in enumerate(lines) if l.startswith("// Toolbox preferences")
    )
    end = next(
        i
        for i, l in enumerate(lines)
        if 'pref("devtools.settings.redesign-enabled"' in l
    )
    out = []
    stack = []  # whether each open block is being kept
    for line in lines[start : end + 1]:
        stripped = line.strip()
        value = condition(stripped)
        if value is not None:
            stack.append(value)
        elif stripped.startswith("#else"):
            stack[-1] = not stack[-1]
        elif stripped.startswith("#endif"):
            stack.pop()
        elif stripped.startswith("#"):
            sys.exit(f"cannot resolve: {line}")
        elif all(stack):
            # The toolbox is always in a window of its own here (see DevTools.sys.mjs).
            if re.search(r'pref\("devtools\.toolbox\.(host|previousHost)"', line):
                continue
            out.append(line)
    OUTPUT.write_text(HEADER + "\n".join(out) + "\n")
    print(f"copied lines {start + 1}-{end + 1} to {OUTPUT}")


if __name__ == "__main__":
    main()

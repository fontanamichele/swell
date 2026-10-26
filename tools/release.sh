#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# usage: release.sh
# Cuts a release: bumps the version in app/config/version.txt from the conventional commits
# since the last v* tag (breaking -> major, or minor while 0.x; feat -> minor; else patch),
# commits it as "chore(release): vX.Y.Z" and tags it vX.Y.Z-alpha. Nothing is pushed.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/.." && pwd)
cd "$root"

if [ -n "$(git status --porcelain)" ]; then
  echo "error: the working tree is not clean" >&2
  exit 1
fi

last=$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)
range=${last:+$last..HEAD}
subjects=$(git log --format=%s $range)
[ -n "$subjects" ] || { echo "error: no commits since ${last:-the start}" >&2; exit 1; }
bodies=$(git log --format=%B $range)

current=$(cat app/config/version.txt)
kind=patch
echo "$subjects" | grep -q '^feat' && kind=minor
if echo "$subjects" | grep -q '^[a-z]*\(([a-z]*)\)\{0,1\}!:' ||
  echo "$bodies" | grep -q '^BREAKING CHANGE:'; then
  case "$current" in 0.*) kind=minor ;; *) kind=major ;; esac
fi

version=$("$here/bump-version.sh" "$kind")
git add app/config/version.txt
git commit -q -m "chore(release): v$version"
git tag "v$version-alpha"
echo "v$version-alpha ($kind bump from $current); push with: git push origin main v$version-alpha"

#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# usage: install.sh [--uninstall]
# Run from the unpacked Swell tarball. Adds Swell to the application menu of the current
# user: a desktop entry (pointing at this directory, so do not move it afterwards; run the
# script again if you do), the icons, and a "swell" link in ~/.local/bin.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
data=${XDG_DATA_HOME:-$HOME/.local/share}
bin=$HOME/.local/bin
desktop=$data/applications/swell.desktop

if [ "${1:-}" = --uninstall ]; then
  rm -f "$desktop" "$bin/swell"
  for f in "$data"/icons/hicolor/*/apps/swell.png "$data/icons/hicolor/scalable/apps/swell.svg"; do
    rm -f "$f"
  done
  echo "Swell removed from the menu. Your profile is untouched."
  exit 0
fi

[ -x "$here/swell/swell" ] || { echo "install.sh: $here/swell/swell not found" >&2; exit 1; }

mkdir -p "$data/applications" "$bin"
sed "s|@EXEC@|$here/swell/swell|" "$here/swell.desktop.in" > "$desktop"
ln -sf "$here/swell/swell" "$bin/swell"

for size in 16 32 48 64 128 256; do
  dir=$data/icons/hicolor/${size}x${size}/apps
  mkdir -p "$dir"
  cp "$here/icons/default$size.png" "$dir/swell.png"
done
mkdir -p "$data/icons/hicolor/scalable/apps"
cp "$here/icons/swell.svg" "$data/icons/hicolor/scalable/apps/swell.svg"

command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$data/applications" || true
command -v gtk-update-icon-cache >/dev/null 2>&1 && gtk-update-icon-cache -q -t "$data/icons/hicolor" || true
echo "Swell added to the menu. Start it from there or with: $here/swell/swell"

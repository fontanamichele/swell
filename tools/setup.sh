#!/bin/sh
# usage: setup.sh [--checkout] [--no-patches]
#
# Run from a clone of swell that sits at <firefox>/swell. Checks the Firefox tree
# around it, excludes swell/ from its git status, and applies the patch queue.
#
#   --checkout    switch the Firefox tree to the revision in FIREFOX_REV
#                 (fetching it first if needed). Refuses if the tree has changes
#                 outside swell/ and the patch queue.
#   --no-patches  do not apply patches/
#
# To start from nothing:
#   git clone --filter=blob:none https://github.com/mozilla-firefox/firefox firefox
#   git clone <swell-url> firefox/swell && firefox/swell/tools/setup.sh --checkout
set -eu

here=$(cd "$(dirname "$0")" && pwd)
swell=$(cd "$here/.." && pwd)
root=$(cd "$swell/.." && pwd)
checkout=0
patches=1
for arg in "$@"; do
  case "$arg" in
  --checkout) checkout=1 ;;
  --no-patches) patches=0 ;;
  *) echo "unknown option $arg" >&2; exit 2 ;;
  esac
done

if [ "$(git -C "$root" rev-parse --show-toplevel 2>/dev/null)" != "$root" ]; then
  echo "error: $root is not the top of a Firefox git checkout" >&2
  exit 1
fi
if [ ! -f "$root/mach" ] || [ ! -f "$root/browser/config/version.txt" ]; then
  echo "error: $root does not look like a Firefox source tree" >&2
  exit 1
fi

want=$(grep -v '^#' "$swell/FIREFOX_REV" | head -n 1 | tr -d '[:space:]')
have=$(git -C "$root" rev-parse HEAD)

exclude=$(git -C "$root" rev-parse --git-path info/exclude)
case "$exclude" in /*) ;; *) exclude="$root/$exclude" ;; esac
if ! grep -qx 'swell/' "$exclude" 2>/dev/null; then
  mkdir -p "$(dirname "$exclude")"
  echo 'swell/' >> "$exclude"
  echo "added swell/ to $exclude"
fi

resolved=$(git -C "$root" rev-parse --verify --quiet "$want^{commit}" || true)
if [ "$resolved" != "$have" ]; then
  if [ "$checkout" -eq 1 ]; then
    "$here/apply-patches.sh" revert
    if [ -n "$(git -C "$root" status --porcelain --untracked-files=no)" ]; then
      echo "error: Firefox tree has changes outside the patch queue; commit or stash them first" >&2
      exit 1
    fi
    if [ -z "$resolved" ]; then
      git -C "$root" fetch origin "$want"
    fi
    git -C "$root" checkout --detach "$want"
  else
    echo "warning: Firefox is at $have but FIREFOX_REV pins $want (use --checkout)" >&2
  fi
fi

if [ "$patches" -eq 1 ]; then
  "$here/apply-patches.sh" apply
fi

echo "Firefox: $(git -C "$root" rev-parse --short HEAD) ($(cat "$root/browser/config/version.txt"))"
if ! grep -q '^ac_add_options --enable-artifact-builds' "$root/mozconfig" 2>/dev/null; then
  echo "note: no mozconfig with --enable-artifact-builds; see the README for the build"
fi

#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# usage: apply-patches.sh apply|revert|status
# Applies or reverts the patch queue in swell/patches/ on the Firefox tree.
# Safe to re-run: patches that are already applied are skipped on apply, and
# patches that are not applied are skipped on revert.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mode=${1:-}

cd "$root"
applied() { git apply -R --check "$1" >/dev/null 2>&1; }
applicable() { git apply --check "$1" >/dev/null 2>&1; }

case "$mode" in
apply)
  for p in "$here"/../patches/*.patch; do
    name=$(basename "$p")
    if applied "$p"; then
      echo "already applied $name"
    elif applicable "$p"; then
      git apply "$p"
      echo "applied $name"
    else
      echo "cannot apply $name (conflict with the current tree)" >&2
      exit 1
    fi
  done
  ;;
revert)
  for p in $(ls -r "$here"/../patches/*.patch); do
    name=$(basename "$p")
    if applied "$p"; then
      git apply -R "$p"
      echo "reverted $name"
    else
      echo "not applied $name"
    fi
  done
  ;;
status)
  for p in "$here"/../patches/*.patch; do
    name=$(basename "$p")
    if applied "$p"; then
      echo "applied   $name"
    elif applicable "$p"; then
      echo "pending   $name"
    else
      echo "conflict  $name"
    fi
  done
  ;;
*)
  echo "usage: $0 apply|revert|status" >&2
  exit 2
  ;;
esac

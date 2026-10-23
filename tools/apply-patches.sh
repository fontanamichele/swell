#!/bin/sh
# usage: apply-patches.sh apply|revert
# Applies or reverts the local patches in swell/patches/ on the Firefox tree.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
mode=${1:-}

cd "$root"
case "$mode" in
apply)
  for p in "$here"/../patches/*.patch; do
    git apply --check "$p"
    git apply "$p"
    echo "applied $(basename "$p")"
  done
  ;;
revert)
  for p in $(ls -r "$here"/../patches/*.patch); do
    git apply -R --check "$p"
    git apply -R "$p"
    echo "reverted $(basename "$p")"
  done
  ;;
*)
  echo "usage: $0 apply|revert" >&2
  exit 2
  ;;
esac

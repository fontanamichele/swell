#!/usr/bin/env bash
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# Runs the isolation suite (tests/app/isolation) twice and prints one table.
#
#   tools/isolation.sh            run from anywhere; needs a built obj-swell
#
# Run 1 is the real suite: every store must be isolated between two spaces.
# Run 2 repeats it with both "spaces" in one container (swell.test.shareContainer);
# every store must then be reported as shared. A case that stays green in run 2
# does not test anything, and the script fails.
set -uo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
top="$(cd "$here/../.." && pwd)"
cd "$top"
export MOZCONFIG="${MOZCONFIG:-$top/swell/mozconfig}"
mkdir -p artifacts
start=$SECONDS

run() { # run <label> <extra mach args...>
  local label=$1
  shift
  ./mach test swell/tests/app/isolation/browser --headless "$@" >"artifacts/isolation-$label.txt" 2>&1
  echo $? >"artifacts/isolation-$label.status"
  grep -o 'AUDIT|[^|]*|[a-z]*|.*' "artifacts/isolation-$label.txt" | sort -u >"artifacts/isolation-$label.audit"
}

echo "== run 1: spaces are separate"
run real
echo "== run 2: self-test, both spaces share one container"
run shared --setpref swell.test.shareContainer=true

fail=0
printf '\n%-34s %-10s %s\n' STORE REAL SELFTEST
while IFS='|' read -r _ store state _; do
  self=$(grep "^AUDIT|$store|" artifacts/isolation-shared.audit | head -1 | cut -d'|' -f3)
  verdict=""
  if [ "$state" != isolated ]; then
    verdict="  <- SHARED"
    fail=1
  fi
  case "$store" in
    *"(default container)"* | *"(by id)"*) ;; # does not depend on the two spaces
    *)
      if [ "$self" != shared ]; then
        verdict="$verdict  <- self-test did not detect sharing"
        fail=1
      fi
      ;;
  esac
  printf '%-34s %-10s %s%s\n' "$store" "$state" "${self:--}" "$verdict"
done <artifacts/isolation-real.audit

if [ ! -s artifacts/isolation-real.audit ]; then
  echo "no AUDIT rows: the suite did not run"
  fail=1
fi
if [ "$(cat artifacts/isolation-real.status)" != 0 ]; then
  echo "run 1 reported failures (see artifacts/isolation-real.txt)"
  fail=1
fi
if [ "$(cat artifacts/isolation-shared.status)" = 0 ]; then
  echo "run 2 passed: the self-test did not make the suite fail"
  fail=1
fi
echo
echo "runtime: $((SECONDS - start))s"
if [ $fail = 0 ]; then
  echo "OK: every store is isolated and the suite detects sharing"
else
  echo "FAIL"
fi
exit $fail

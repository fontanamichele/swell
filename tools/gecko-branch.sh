#!/bin/sh
# usage: gecko-branch.sh commit | status | fixup <NNNN> | export
#
# Keeps our Gecko edits as real commits on a local branch ("swell") of the Firefox
# clone, one commit per patch in patches/, so `git status` there stays clean. The
# patch files stay the source of truth for CI and releases; `export` regenerates
# them from the commits. Nothing here pushes anywhere.
#
#   commit        turn the patches that are applied (apply-patches.sh) into commits
#   status        list our commits and any uncommitted changes
#   fixup NNNN    amend the commit of patch NNNN with the current uncommitted changes
#   export        rewrite patches/*.patch from the commits
#
# A commit's subject is "<patch name>: <purpose>" and its body is the patch header.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
swell=$(cd "$here/.." && pwd)
root=$(cd "$swell/.." && pwd)
branch=swell
want=$(grep -v '^#' "$swell/FIREFOX_REV" | head -n 1 | tr -d '[:space:]')

cd "$root"

files_of() { grep '^+++ b/' "$1" | sed 's|^+++ b/||'; }
stem_of() { basename "$1" .patch; }
header_of() { sed -e '/^diff --git/,$d' -e '/^--- a\//,$d' "$1" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'; }
committed() { git log --format=%s "$want..HEAD" 2>/dev/null | grep -q "^$1:"; }

case "${1:-}" in
commit)
  current=$(git branch --show-current)
  if [ "$current" != "$branch" ]; then
    git merge-base --is-ancestor "$want" HEAD || { echo "error: HEAD does not descend from $want" >&2; exit 1; }
    if git show-ref --verify --quiet "refs/heads/$branch"; then
      echo "error: branch $branch exists but is not checked out" >&2
      exit 1
    fi
    git switch -q -c "$branch"
  fi
  for p in "$swell"/patches/*.patch; do
    stem=$(stem_of "$p")
    if committed "$stem"; then
      echo "already committed $stem"
      continue
    fi
    if ! git apply -R --check "$p" >/dev/null 2>&1; then
      if git apply --check "$p" >/dev/null 2>&1; then
        git apply "$p"
      else
        echo "error: $stem is neither applied nor applicable" >&2
        exit 1
      fi
    fi
    files=$(files_of "$p")
    for f in $files; do git update-index --no-skip-worktree -- "$f" 2>/dev/null || true; done
    # shellcheck disable=SC2086
    git add -- $files
    purpose=$(header_of "$p" | awk '/^Test:/{exit} /^$/{exit} {printf "%s ", $0}' \
      | sed -e 's/^Purpose: *//' -e 's/  */ /g' -e 's/\. .*$//' -e 's/ *$//' | cut -c1-90)
    { echo "$stem: $purpose"; echo; header_of "$p"; } | git commit -q --no-verify -F -
    echo "committed $stem"
  done
  ;;
status)
  git log --oneline "$want..HEAD"
  echo "uncommitted: $(git status --short --untracked-files=no | wc -l | tr -d ' ') files"
  ;;
fixup)
  prefix=${2:?usage: gecko-branch.sh fixup NNNN}
  sha=$(git log --reverse --format='%H %s' "$want..HEAD" | grep " $prefix" | head -n 1 | cut -d' ' -f1)
  [ -n "$sha" ] || { echo "error: no commit for $prefix" >&2; exit 1; }
  git commit -a -q --no-verify --fixup="$sha"
  GIT_SEQUENCE_EDITOR=true git rebase -q -i --autosquash "$want"
  "$0" export
  ;;
export)
  git log --reverse --format='%H' "$want..HEAD" | while read -r sha; do
    subject=$(git log -1 --format=%s "$sha")
    case "$subject" in
    [0-9][0-9][0-9][0-9]-*:*) ;;
    *) continue ;;
    esac
    stem=${subject%%:*}
    out="$swell/patches/$stem.patch"
    { git log -1 --format=%b "$sha" | sed -e :a -e '/^\n*$/{$d;N;ba' -e '}'; echo; git show --format= --no-color -p "$sha"; } > "$out"
    echo "exported $stem"
  done
  ;;
*)
  echo "usage: $0 commit | status | fixup <NNNN> | export" >&2
  exit 2
  ;;
esac

#!/bin/sh
# usage: gecko-branch.sh commit | status | save <NNNN> <message> | new <NNNN-name> <purpose> <test> <file>... | fixup <NNNN> | export
#
# Keeps our Gecko edits as real commits on a local branch ("swell") of the Firefox
# clone, one commit per patch in patches/, so `git status` there stays clean. The
# patch files stay the source of truth for CI and releases; `export` regenerates
# them from the commits. Nothing here pushes anywhere.
#
#   commit        turn the patches that are applied (apply-patches.sh) into commits
#   status        list our commits and any uncommitted changes
#   save NNNN msg   the everyday command after editing Firefox files that belong to patch
#                   NNNN: fold the edits into its commit, rewrite its patch file, and commit
#                   that file in the swell repository as "patch(firefox): NNNN msg"
#   new NAME purpose test FILE...
#                   make a new patch from those files (NAME is NNNN-short-name), export it
#                   and commit it in the swell repository
#   fixup NNNN    like save, without the swell commit
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
save)
  prefix=${2:?usage: gecko-branch.sh save NNNN message}
  message=${3:?usage: gecko-branch.sh save NNNN message}
  "$0" fixup "$prefix"
  name=$(ls "$swell"/patches | grep "^$prefix" | head -n 1 | sed 's/\.patch$//')
  git -C "$swell" add -- "patches/$name.patch"
  git -C "$swell" commit -q --no-verify -m "patch(firefox): $name $message"
  echo "committed in swell: patch(firefox): $name $message"
  ;;
new)
  name=${2:?usage: gecko-branch.sh new NNNN-name purpose test file...}
  purpose=${3:?missing purpose}
  test_cmd=${4:?missing test}
  shift 4
  [ "$#" -gt 0 ] || { echo "error: name the files of the patch" >&2; exit 1; }
  case "$name" in [0-9][0-9][0-9][0-9]-*) ;; *) echo "error: name must look like NNNN-short-name" >&2; exit 1 ;; esac
  git add -- "$@"
  { echo "$name: $purpose"; echo; echo "Purpose: $purpose"; echo "Test: $test_cmd"; } | git commit -q --no-verify -F -
  "$0" export
  git -C "$swell" add -- "patches/$name.patch"
  git -C "$swell" commit -q --no-verify -m "patch(firefox): $name $purpose"
  echo "committed in swell: patch(firefox): $name $purpose"
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
  echo "usage: $0 commit | status | save <NNNN> <message> | new <NNNN-name> <purpose> <test> <file>... | fixup <NNNN> | export" >&2
  exit 2
  ;;
esac

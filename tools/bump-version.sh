#!/bin/sh
# usage: bump-version.sh major|minor|patch
# Bumps Swell's version in app/config/version.txt, the file the build reads as the
# application version (Gecko's own version stays the engine version). Prints the new version.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
file="$here/../app/config/version.txt"
kind=${1:?usage: bump-version.sh major|minor|patch}
IFS=. read -r major minor patch < "$file"
case "$kind" in
major) major=$((major + 1)); minor=0; patch=0 ;;
minor) minor=$((minor + 1)); patch=0 ;;
patch) patch=$((patch + 1)) ;;
*) echo "error: unknown bump '$kind'" >&2; exit 2 ;;
esac
echo "$major.$minor.$patch" > "$file"
# configure's dependency list is fixed and only knows Firefox's version file: touching it
# (mtime only, git is unaffected) makes the next build reconfigure with the new version.
touch "$here/../../browser/config/version.txt"
echo "$major.$minor.$patch"

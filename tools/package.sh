#!/bin/sh
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# usage: package.sh [--skip-build]
# Builds Swell, stages the application with the package manifest
# (app/installer/package-manifest.in), signs it, and makes a disk image in
# obj-swell/dist/release/ with a checksum.
#
#   MOZCONFIG               defaults to swell/mozconfig
#   SWELL_SIGN_IDENTITY     see sign-mac.sh; unset gives an ad-hoc signature
#   SWELL_NOTARY_PROFILE    a notarytool keychain profile (xcrun notarytool
#                           store-credentials). Set, together with a real identity, the
#                           image is notarized and stapled.
#
# macOS only for now; the Linux tarball and Flatpak come with the Linux step.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
root=$(cd "$here/../.." && pwd)
cd "$root"
export MOZCONFIG=${MOZCONFIG:-$root/swell/mozconfig}

[ "$(uname -s)" = Darwin ] || { echo "package.sh: macOS only for now" >&2; exit 2; }

if [ "${1:-}" != --skip-build ]; then
  ./mach build
fi

version=$(cat swell/app/config/version.txt)
arch=$(uname -m)
objdir=$root/obj-swell
out=$objdir/dist/release
name=Swell-$version-$arch

make -C "$objdir/swell/app/installer" stage-package
staged=$objdir/dist/swell/Swell.app
[ -d "$staged" ] || { echo "package.sh: nothing staged at $staged" >&2; exit 1; }

rm -rf "$out/$name" "$out/$name.dmg"
mkdir -p "$out/$name"
# ditto keeps the bundle's symlinks, permissions and extended attributes.
ditto "$staged" "$out/$name/Swell.app"

"$here/sign-mac.sh" "$out/$name/Swell.app"

ln -s /Applications "$out/$name/Applications"
hdiutil create -volname "Swell $version" -srcfolder "$out/$name" -ov -format UDZO "$out/$name.dmg" >/dev/null
rm -rf "$out/$name"

if [ -n "${SWELL_SIGN_IDENTITY:-}" ]; then
  codesign --force --sign "$SWELL_SIGN_IDENTITY" --timestamp "$out/$name.dmg"
  if [ -n "${SWELL_NOTARY_PROFILE:-}" ]; then
    xcrun notarytool submit "$out/$name.dmg" --keychain-profile "$SWELL_NOTARY_PROFILE" --wait
    xcrun stapler staple "$out/$name.dmg"
  else
    echo "package.sh: signed but not notarized (SWELL_NOTARY_PROFILE is not set)" >&2
  fi
else
  echo "package.sh: ad-hoc signed; set SWELL_SIGN_IDENTITY and SWELL_NOTARY_PROFILE for a release" >&2
fi

(cd "$out" && shasum -a 256 "$name.dmg" > "$name.dmg.sha256")
echo "$out/$name.dmg"

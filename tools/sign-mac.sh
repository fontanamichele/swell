#!/bin/sh
# usage: sign-mac.sh path/to/Swell.app
# Signs a Swell.app inside out with the hardened runtime: the helper apps, then every
# library and executable, then the application.
#
# SWELL_SIGN_IDENTITY  the "Developer ID Application: ..." identity. Unset: an ad-hoc
#                      signature ("-"), which runs on this machine but cannot be notarized.
set -eu

app=${1:?usage: sign-mac.sh path/to/Swell.app}
here=$(cd "$(dirname "$0")" && pwd)
ent="$here/../app/app/macbuild/entitlements"
identity=${SWELL_SIGN_IDENTITY:--}

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

if [ "$identity" = "-" ]; then
  echo "sign-mac: no SWELL_SIGN_IDENTITY, signing ad hoc (not distributable)" >&2
  stamp=
else
  stamp=--timestamp
fi

sign() {
  entitlements=$1
  shift
  if [ -n "$entitlements" ]; then
    codesign --force --sign "$identity" --options runtime $stamp --entitlements "$entitlements" "$@"
  else
    codesign --force --sign "$identity" --options runtime $stamp "$@"
  fi
}

macos="$app/Contents/MacOS"

# The entitlements a helper app is signed with. Ad hoc signatures have no team, so
# the helpers could not load the application's libraries with library validation on;
# a Developer ID signature keeps them to the tighter set.
helper_entitlements() {
  base=$1
  if [ "$identity" != "-" ]; then
    echo "$base"
    return
  fi
  copy="$tmp/$(basename "$base" .plist)-adhoc.plist"
  if [ -n "$base" ]; then
    cp "$base" "$copy"
  else
    cp "$ent/media-plugin-helper.plist" "$copy"
  fi
  if ! grep -q disable-library-validation "$copy"; then
    sed -i '' 's|</dict>|  <key>com.apple.security.cs.disable-library-validation</key>\
  <true/>\
</dict>|' "$copy"
  fi
  plutil -lint "$copy" >&2
  echo "$copy"
}

# Libraries and loose executables first: they are signed on their own.
find "$app/Contents" \( -name '*.dylib' -o -name '*.so' \) -type f | while read -r file; do
  sign "" "$file"
done
for file in "$macos"/XUL; do
  [ -f "$file" ] && sign "" "$file"
done

# Helper apps, each with the entitlements it needs.
for helper in "$macos"/*.app; do
  [ -d "$helper" ] || continue
  case $(basename "$helper") in
  plugin-container.app) sign "$(helper_entitlements "$ent/plugin-container.plist")" "$helper" ;;
  media-plugin-helper.app) sign "$(helper_entitlements "$ent/media-plugin-helper.plist")" "$helper" ;;
  *) sign "$(helper_entitlements "")" "$helper" ;;
  esac
done

sign "$ent/swell.plist" "$app"

codesign --verify --deep --strict --verbose=2 "$app"
echo "signed: $app"

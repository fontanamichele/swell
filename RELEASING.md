# Releasing

Alpha releases are **unsigned** macOS builds made by hand. Beta releases will be signed and
notarized (the same script does it when the Apple credentials are set).

## Making a build

From the Firefox checkout (see the README):

```sh
export MOZCONFIG=$PWD/swell/mozconfig
swell/tools/package.sh                 # build, stage, sign (ad hoc), make the disk image
```

It prints `obj-swell/dist/release/Swell-<version>-<arch>.dmg` and a `.sha256` next to it. For a
signed build set `SWELL_SIGN_IDENTITY` ("Developer ID Application: ...") and
`SWELL_NOTARY_PROFILE` (a `notarytool` keychain profile) first.

Check the build before publishing: copy the app to Applications, open it (right-click, Open),
and run through the manual checks in `docs/` (camera, downloads, print, restart).

## First publication

Settings that live on GitHub, not in the repository, and that the docs rely on:

1. Create the repository as `ivantacca/swell` (the name is used in the README, `site/`, the
   About dialog and `swell.update.repository`).
2. Settings > Code security: turn on **Private vulnerability reporting** (`SECURITY.md`).
3. Settings > Pages > Source: **GitHub Actions** (`.github/workflows/pages.yml`).
4. Push `main`, check that the `ci` workflow is green (the `lint` job has not run on GitHub
   before and may need a setup fix), then publish the first pre-release as described below.

## Publishing

1. Make sure the working tree is committed; the version is `app/config/version.txt`.
2. Tag: `git tag v$(cat app/config/version.txt)` and push the tag.
3. Create the release as a **pre-release** and attach the disk image and its checksum:

   ```sh
   gh release create v<version> --prerelease --title "Swell <version> (alpha)" \
     --notes-file RELEASE_NOTES.md obj-swell/dist/release/Swell-<version>-arm64.dmg*
   ```
4. The download page (`site/`, published by GitHub Pages) links to the latest release. The
   in-app "Check for updates" reads the latest release from GitHub, so a release is also how
   users learn of a new version.

## Release notes

Say what is new, what is known broken, and that the alpha is unsigned (with the Open steps).

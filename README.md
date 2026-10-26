# Swell

A minimal, open-source browser on Gecko with an Arc-style sidebar and **fully isolated spaces
in one window**. Each space keeps its own cookies, site storage, history, saved passwords,
form data, extensions, permissions and downloads, so you can be signed in to two accounts
of the same site side by side, and deleting a space deletes everything it kept.

> **Status: alpha.** macOS (Apple silicon) and Linux, Windows later. It is for
> developers and curious users: expect rough edges, and the macOS build is not signed yet.
> See [Download](#download).

## What it does today

- Spaces with their own identity, a sidebar tree (favorites, pinned tabs and folders, today),
  command bar, tab restore, Cmd+Z to put back a deleted row.
- Isolation across 17 stores, checked by an automated suite (`tools/isolation.sh`).
- Passwords, addresses and cards per space, encrypted with a key per space in the system
  keychain. WebExtensions per space. Camera, microphone and screen sharing per space.
- Downloads per space, find in page, print, spell check (English), zoom per site and space,
  developer tools, import from Arc (`StorableSidebar.json`).
- No telemetry, no crash reporter, and no update is ever installed for you; a daily check for a
  newer release on GitHub can be turned off. See [PRIVACY.md](PRIVACY.md).

Not built yet: sync, a Windows build, history view, Save Page As, translations
(the interface is English), notarized builds.

## Download

Pre-releases are on the [releases page](../../releases). The alpha is **not signed or
notarized**, so macOS will refuse to open it at first: right-click the app, choose **Open**,
then **Open** again (or run `xattr -dr com.apple.quarantine /Applications/Swell.app`). Beta
builds will be signed.

On Linux, unpack `Swell-<version>-<arch>.tar.xz` where you want to keep it and run
`./install.sh` inside it to add Swell to your application menu (`./install.sh --uninstall`
removes the entry). It needs GTK 3 and, to keep saved passwords encrypted, libsecret with a
keyring running.

## How it is built

Swell is its own Gecko application (`app/`), a Rust core (`core/`) that owns all state, and a
small queue of patches to Mozilla's files (`patches/`). It lives **inside a checkout of the
Firefox source**, the way Thunderbird's `comm/` does; `FIREFOX_REV` pins the revision.

```sh
git clone --filter=blob:none https://github.com/mozilla-firefox/firefox firefox
git clone https://github.com/ivantacca/swell firefox/swell
firefox/swell/tools/setup.sh --checkout     # pins Firefox to FIREFOX_REV, applies patches/
cd firefox
export MOZCONFIG=$PWD/swell/mozconfig
./mach bootstrap                            # once
./mach build                                # about 30 minutes the first time, 15-20 GB of disk
./mach run
```

Tests, from `firefox/`:

```sh
(cd swell/core && cargo test --workspace)
./mach test swell/tests/xpcshell
./mach test swell/tests/app/browser --headless
./mach python swell/tests/e2e/restart_persistence.py
tools/isolation.sh                          # the isolation suite, run twice (see its header)
./mach lint swell/app swell/tests
```

`swell/tools/package.sh` makes the macOS disk image; see [RELEASING.md](RELEASING.md).
The design is in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## Support

Swell is free and developed in spare time. If you find it useful, you can
[buy me a coffee](https://buymeacoffee.com/ivantacca).

## Licence

[MPL 2.0](LICENSE). Third-party material and Mozilla trademarks: [NOTICE.md](NOTICE.md).
Swell is not affiliated with Mozilla.

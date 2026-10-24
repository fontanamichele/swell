# Patch queue

Numbered patches applied on top of the Firefox revision pinned in `../FIREFOX_REV`.
Apply with `../tools/apply-patches.sh apply`; revert with `revert`.

Every patch starts with a header (text before the first `diff`/`---` line is ignored by
`git apply`) giving its purpose and the test that covers it.

| Patch | Purpose | Status |
| --- | --- | --- |
| `0000-test-hook.patch` | register `swell/` so `./mach test` finds our tests | local only |
| `0010-mochitest-swell-window.patch` | `mach` and the browser-chrome harness run in Swell (`is_swell`, no `openLinkIn`, no Firefox sidebar/SessionStore cleanup) | M1 |
| `0020-uniffi-core-ffi.patch` | register `core-ffi` in `gkrust-uniffi-components`: path dependency, scaffolding re-export, `config.toml` section, `swell/core` excluded from the root workspace | M1 |
| `0021-uniffi-core-ffi-generated.patch` | output of `./mach uniffi generate` after 0020 (22,000 lines, mechanical; never edit by hand, regenerate on every rebase and on every change to `core-ffi`) | M1 |
| `0030-cocoa-shellservice-include.patch` | `widget/cocoa/nsMenuBarX.mm` includes `nsIShellService.h` only for the browser app | M1, upstreamable |
| `0031-settings-dumps-swell-app.patch` | Remote Settings dump generator accepts `swell/app` and installs into its app dir | M1 |
| `0100-p4-prototype.patch` | M0 spike: bind an extension copy to one container | prototype |

Numbering: `00xx` build and tooling (`0000` is the local top-level `moz.build` hook, `0010` test tooling, `0030` build fixes), `01xx` extensions (P4), `02xx` history (P1),
`03xx` form data (P2), `04xx` logins (P3).

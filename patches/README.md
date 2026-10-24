# Patch queue

Numbered patches applied on top of the Firefox revision pinned in `../FIREFOX_REV`.
Apply with `../tools/apply-patches.sh apply`; revert with `revert`.

## Working on Gecko

The Firefox clone has a local branch `swell` (never pushed to Mozilla) with one commit
per patch, so its `git status` is clean. These files stay the source of truth for CI and
releases; `tools/gecko-branch.sh` keeps both in step:

- Edit the Firefox files as usual and test. Then `tools/gecko-branch.sh fixup NNNN` folds
  the uncommitted edits into patch NNNN's commit and rewrites `patches/NNNN-*.patch`.
  Edit one patch's files at a time.
- A new patch: commit it on `swell` with the subject `NNNN-name: purpose` and the header
  (purpose, test) as the commit body, then `tools/gecko-branch.sh export`.
- Then commit the changed patch files in this repository.
- `tools/gecko-branch.sh status` lists the commits; `commit` turns already-applied
  patches into commits (done by `tools/setup.sh`).
- A new Firefox revision: `git rebase --onto <new> <old> swell` in the clone, edit
  `../FIREFOX_REV`, re-run `./mach uniffi generate` if 0021 conflicts, then `export`.

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

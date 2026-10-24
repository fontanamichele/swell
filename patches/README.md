# Patch queue

Numbered patches applied on top of the Firefox revision pinned in `../FIREFOX_REV`.
Apply with `../tools/apply-patches.sh apply`; revert with `revert`.

## Working on Gecko

The Firefox clone has a local branch `swell` (never pushed to Mozilla) with one commit
per patch, so its `git status` is clean. These files stay the source of truth for CI and
releases; `tools/gecko-branch.sh` keeps both in step:

- Edit the Firefox files as usual and test. Then `tools/gecko-branch.sh save NNNN "<what>"`
  folds the uncommitted edits into patch NNNN's commit, rewrites `patches/NNNN-*.patch` and
  commits it here as `patch(firefox): NNNN-name <what>`. Edit one patch's files at a time.
- A new patch: `tools/gecko-branch.sh new NNNN-name "<purpose>" "<test>" <files...>` does the
  same for a new patch (the header is built from the purpose and the test).
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
| `0200-places-visited-per-container.patch` | `:visited` and visit notifications per container, behind `places.history.isolate_by_user_context` | M2, partly upstreamable |
| `0500-isolate-hsts-cert-overrides.patch` | HSTS and certificate exceptions keyed by container, behind two prefs | M2, upstreamable |

Numbering: `00xx` build and tooling (`0000` is the local top-level `moz.build` hook, `0010` test tooling, `0030` build fixes), `01xx` extensions (P4), `02xx` history (P1),
`03xx` form data (P2), `04xx` logins (P3), `05xx` other per-space security state (HSTS, certificate exceptions).

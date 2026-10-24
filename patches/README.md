# Patch queue

Numbered patches applied on top of the Firefox revision pinned in `../FIREFOX_REV`.
Apply with `../tools/apply-patches.sh apply`; revert with `revert`.

Every patch starts with a header (text before the first `diff`/`---` line is ignored by
`git apply`) giving its purpose and the test that covers it.

| Patch | Purpose | Status |
| --- | --- | --- |
| `0000-test-hook.patch` | register `swell/` so `./mach test` finds our tests | local only |
| `0100-p4-prototype.patch` | M0 spike: bind an extension copy to one container | prototype |

Numbering: `00xx` build and tooling, `01xx` extensions (P4), `02xx` history (P1),
`03xx` form data (P2), `04xx` logins (P3).

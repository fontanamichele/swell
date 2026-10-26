# Contributing

Thanks for looking. Swell is small and opinionated, so please open an issue before a big
change.

## Rules of the project

1. **One concept, one place.** No second bookmarks system, no hidden Firefox UI kept "just in case".
2. **The Rust core owns state.** The UI renders diffs and sends commands; it never persists state.
3. **Every web page is in a space's container** (`userContextId`); context 0 is never used
   for web content. Only the engine bridge creates `<browser>` elements.
4. **Patch Gecko only when unavoidable.** If it can be done in `app/` or `core/`, do it there.
   Each patch is small, documented, tested and, where it can be, upstreamable.
5. **Isolation is tested, not assumed.** A change that touches user state adds or updates a
   case in `tests/app/isolation/`.
6. **Say what you verified.** Check claims against the code; report test results as they are.

## Building and testing

See the README. Run the Rust tests, the xpcshell tests, the browser tests and `./mach lint`
before you send a change (`./mach lint -l eslint -l stylelint -l ruff swell/app swell/tests/app swell/tests/xpcshell swell/tests/e2e swell/tools`); the CI runs the Rust tests and the lint (a full Gecko build is too
big for it).

## Changes to Mozilla's files

Every edit outside `swell/` is a numbered patch in `patches/`, recorded with
`tools/gecko-branch.sh save NNNN "<what>"` (or `new` for a new one); see `patches/README.md`.
Never commit to Mozilla's tree directly.

## Commits

Conventional commits: `type(scope): summary`, with `!` before the colon for a breaking
change. Types: `feat`, `fix`, `perf`, `refactor`, `test`, `docs`, `build`, `chore`, `style`,
`ci`, `patch`. Scopes: `core`, `app`, `tests`, `tools`, `docs`, `firefox`. A hook
(`tools/hooks/commit-msg`, enabled by `tools/setup.sh`) checks the format, and another bumps
the version on each commit.

## Licence of contributions

By contributing you agree that your work is under the MPL 2.0, like the rest of the project.
New source files carry the MPL header (copy it from any file).

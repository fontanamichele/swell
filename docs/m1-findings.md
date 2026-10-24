# M1 findings: skeleton browser

2026-10-24 · base: Firefox `main` 161.0a1 at `f536a878f58f` (`FIREFOX_REV`), macOS arm64, full build (project `swell/app`).
Tests: `swell/tests/`. Patches: `swell/patches/`.

## Result against the exit criteria

| Criterion | Status | Evidence |
| --- | --- | --- |
| `./mach run` opens Swell's window only | **Done** | `browser_smoke_no_firefox_ui.js`: no `TabsToolbar`, `nav-bar`, `gBrowser`; `chrome://browser/content/browser.xhtml` does not resolve. `browser/` is never built. |
| Two spaces, separate logins side by side | **Mechanism verified; real Google logins not run** | `browser_two_spaces.js`, `browser_isolation_storage.js`: each tab has its space's `userContextId`, spaces never share a content process, cookies, localStorage, IndexedDB, Cache API, service workers, HTTP cache and HTTP auth are isolated. Needs you to log in to two Google accounts (see "For you to check"). |
| Pin/unpin/reorder/folders persist across restarts via the core | **Done** | `tests/e2e/restart_persistence.py` starts Swell twice on one profile with a real page; spaces, folder, saved tab and Today row come back, nothing open. Rust, xpcshell and browser-chrome tests cover each command. |
| Command bar opens URLs and searches | **Done** | `browser_command_bar.js` (URL, search, jump to a saved tab, Accel+T/L/W/F/digits, shortcuts with web content focused). |
| Arc `StorableSidebar.json` imports correctly | **Done on a synthetic file; your real file not run** | Importer output equals `tools/arc_sidebar.py`'s on `core-store/tests/fixtures/arc_sidebar_synthetic.json` (oracle test); `browser_import_arc.js` imports it through the UI path. I did not read your Arc data. |
| All tests pass | **Done** | 63 Rust, 3 xpcshell files, 124 browser-chrome subtests in 11 files, 1 end-to-end restart script; ESLint, Prettier, Stylelint, ruff clean on `swell/app` and the new tests. |

## What exists

- `core/` (Rust, 2,996 lines + 1,557 lines of tests): `core-model` (entities, invariants, commands), `core-store` (SQLite, migrations, Arc importer), `core-search` (URL vs search, ranking), `core-ffi` (the UniFFI surface).
- `app/` (3,454 lines JS/CSS/HTML): window document, sidebar (Favorites, Pinned tree, Today, spaces, drag and drop, rename, context menu), command bar, engine bridge, page actor (link and edit menus, middle-click), favicons (Firefox's own `FaviconLoader`, unmodified, so icons are fetched inside the tab's container and kept as data URIs, never in Places), find bar, permission bar, download toasts, Arc import, macOS custom titlebar.
- Six Gecko patches for M1 (`patches/README.md`), all small except the generated one; the M0 prototype is the seventh in the queue.

## Measurements

- First full build, cold sccache, Apple Silicon, 10 cores, 16 GB: about 28 minutes including two fix-and-resume cycles (my estimate was 45 to 90). A build that adds or changes the Rust core and relinks libxul: about 1 minute. Front-end only (`./mach build faster`): seconds.
- Disk: `obj-swell` 15 GB, `obj-uniffi-generate` 5.8 GB (deletable, rebuilt in about 6 minutes), `swell/core/target` 0.7 GB.
- `./mach uniffi generate`: about 6 minutes on first use, about 3 minutes after.
- Not measured: memory per space, startup time. The M0 numbers still apply to content processes: one process per (site x container).

## Where the plan changed

| Plan said | What happened |
| --- | --- |
| Window type `swell:main` | `navigator:browser`. The window mediator, Marionette and the harness all look for it; a custom type needed C++ patches. Nothing in `toolkit/` that checks the type broke. |
| `sidebar.db` and `spaces.db` | One `sidebar.db` holds identities, spaces and nodes: creating a space writes its roots, which must be atomic. History, logins and the rest stay separate files in M2. |
| `TreeDiff { space, ops }`, `OpenTab` suggestion kind | `TreeDiff { ops }` (node ids are global; the window filters), suggestions carry `isOpen` instead of a kind. |
| `CoreListener` as `with_foreign` trait | `callback_interface`: `FireAndForget` is only valid for callback interfaces. |
| The command and event list of the M1 plan | Added `on_tab_opened` (engine-opened tabs: `window.open` needs the browsing context synchronously), `on_favicon`, `close`, and a `node` on `on_open_tab`. |
| `swell/app/app` is the program | Program directory is `swell/app/app` because `config/faster/rules.mk` hard-codes `<app>/app`. App resources live in `dist/bin/app` (not `swell`: it would clash with the executable). |
| Patches 0001, 0010, 0020 | 0000 (kept), 0010 (mach and harness), 0020 + 0021 (UniFFI: hand-written and generated), 0030 and 0031 (hidden `browser/` dependencies). |
| Decision 6: custom titlebar | macOS done (`customtitlebar` attribute, drag strip, room for the traffic lights). Linux keeps the native titlebar: window controls drawn by us are not done. Windows is out of scope. |

## Things the tree does without telling you (all found by failing)

1. **Hidden `browser/` dependencies** of a non-browser app: `widget/cocoa/nsMenuBarX.mm` includes `nsIShellService.h` (patch 0030); `services/settings/dumps/gen_last_modified.py` asserts the app name (0031); `mach mochitest` and the harness special-case Firefox/Thunderbird (0010); `config/faster/rules.mk` assumes `<app>/app`.
2. **Startup notifications.** Marionette, the script preloader and the harness need `browser-delayed-startup-finished`, then `browser-idle-startup-tasks-finished`, from the main window. The preloader asserts if only the second arrives.
3. **Content actors.** Toolkit's actors (find, select popups, autocomplete, popup blocking, media controls) are registered only when something imports `ActorManagerParent`; in Firefox that is `DesktopActorRegistry`. `window.mjs` imports it.
4. **Prefs that live only in `browser/app/profile/firefox.js`** and that toolkit code reads: `browser.link.open_newwindow*` (without them `window.open` opens a second window), `browser.download.useDownloadDir` (without it a modal dialog hangs), `accessibility.typeaheadfind*` (the find bar throws). `defaults/preferences/swell.js` has what M1 needed; more will surface.
5. **Remote `window.open`** goes through `createContentWindowInFrame` / `openURIInFrame` and needs the new `<browser>` element, not a browsing context.
6. **UniFFI**: config sections are keyed by Rust crate name; modules statically imported from a window's `<script type="module">` live in the window's own module map and break `instanceof` on UniFFI types, so the window uses `ChromeUtils.importESModule`; **UniFFI aborts at shutdown if a callback interface is still registered**, so `Core.sys.mjs` calls `close()` on `quit-application`.
7. **A module that fails to load in a content process can crash it**: importing a `moz-src:///` file that was never installed (here `browser/modules/FaviconLoader.sys.mjs`, whose directory is not built) segfaults in `CheckForBrokenChromeURL` instead of throwing. `moz-src` is an installed copy, not the source tree; install files from unbuilt directories through `EXTRA_JS_MODULES` (`swell/app/jsm/moz.build`). Worth reporting upstream.
8. `Element.ownerGlobal` is now `documentGlobal`; `ChromeUtils.defineESModuleGlobals` does not exist; `getComputedStyle` does not expose `-moz-window-dragging`.

## Not done in M1

- **Carried over to M2** (decided with you): camera and microphone prompts (WebRTC: `browser/actors/WebRTCParent` and `webrtcUI` are not built here; geolocation, notifications, persistent storage, MIDI and XR prompts work), and Linux (titlebar and window controls drawn by us; the Rust and JS code is portable but only macOS was run).
- **Restoring open tabs on restart.** Saved tabs and Today rows come back as rows; their pages are not reopened. Deliberate for M1 (see decision 7: closing a Today tab deletes it).
- Per-space download list and history (M2), WebExtension UI APIs (M2 fork of `browser/components/extensions`), l10n (strings are English literals), accessibility pass, devtools launch, printing, session history, spell check, drag-and-drop of links/files into the window, default-browser registration, auto-update.
- Middle-click "background" detection for opening links is keyed by URL (`EngineBridge.#openInBackground`); two simultaneous opens of one URL could swap the flag. Fine for M1; carry the flag through the core event later.
- The M0 isolation tests (`tests/isolation`) still run only in the Firefox-app build (`obj-aarch64-apple-darwin25.6.0`); the storage cases are ported (`browser_isolation_storage.js`). Forms, history, security and extension cases stay parked for M2.

## For you to check by hand

1. `MOZCONFIG=$PWD/swell/mozconfig ./mach run`, then log in to two different Google accounts in two spaces and keep both open (the thing automated tests cannot do).
2. The titlebar on macOS: traffic lights position and dragging the window by the top-left strip. I verified the attribute and CSS, not how it looks.
3. Import your real `StorableSidebar.json` (`...` button, "Import from Arc..."; or `./mach run -- --import-arc <path>`). Tell me what is missing or wrong.
4. Everyday browsing for a while: keyboard shortcuts with the mouse in a page, downloads, site icons, a site you use that asks for camera/microphone (it will not work yet).

## Risks that grew or appeared

- **UniFFI generated patch (0021) is 22,000 lines and conflicts on every rebase** that touches another Rust component; it is mechanical (`./mach uniffi generate`), never hand-edited.
- **Prefs and actors from `browser/` will keep leaking in** as features are added; each is cheap, but the list is long. Consider a test that fails on any `getXPref` of an undefined pref in the Swell window.
- **Memory**: unchanged from M0 (one content process per site and container).
- **WebExtension APIs** are the large M2 cost already noted in the plan; nothing in M1 reduced it.

# M2 findings (running notes)

Base: Firefox `main` 161.0a1.

## Step 0: add-on compatibility with the `0.x` app version

`MOZ_APP_MAXVERSION` becomes `0.*` for a release-looking app version
(`build/moz.configure/init.configure`, `moz_app_maxversion`), but it only
feeds langpacks (`package_langpack.py --max-app-ver`) and `application.ini`
bookkeeping. WebExtension compatibility does not use the application version:
`XPIInstall.sys.mjs` records a WebExtension's `strict_min_version` and
`strict_max_version` against `toolkit@mozilla.org`, which `XPIDatabase.sys.mjs`
compares with the platform version (161.0a1). So Swell's `0.1.x` does not
make add-ons incompatible. Langpacks (not planned) would need the app version
or an override.

## Step 1: idle network and Mozilla services

`tests/e2e/network_silence.py` starts Swell on a fresh profile, logs `nsHttp`
and `nsHostResolver`, leaves it idle and lists every host. A control request
from chrome proves the capture sees requests.

- Before any pref change, 75 s idle on a clean profile: **no request at all**.
  The services the research flagged as inherited (connectivity service, region,
  telemetry, safe browsing) are not started in Swell because their starters
  live in `browser/` (BrowserGlue). The only host in the log is the DoH server
  being configured (`MaybeSetPrivateURI`), not contacted.
- So the pref lockdown in `defaults/preferences/swell.js` is defence in depth:
  it keeps the app silent if one of those services is ever started.
- Remote Settings is allowed on purpose (decision 9). It did not poll in 60 s;
  its first request, when it happens, still has to be captured and reviewed.
- `browser_no_mozilla_services.js` asserts the prefs and that telemetry,
  updater and crash reporter are not compiled in. The test harness points some
  URL prefs at its own `127.0.0.1` server, so the test accepts an empty value or a
  local URL.
- Not covered yet: a capture with a page open (content may use Mozilla hosts,
  e.g. the "Firefox" compat checks), and after 24 h (daily pollers).

## Step 2: isolation suite scaffolding

`tests/app/isolation/browser/` is the Swell suite (the M0 audit in
`tests/isolation` still runs only in the Firefox-app build). `head.js` loads
the window helpers and defines `audit()` and `pair()`. `tools/isolation.sh`
runs it twice and prints a table; the second run sets
`swell.test.shareContainer`, which puts both "spaces" in one container, and
every store must then report as shared, so a case that cannot fail is caught.
Cases so far: cookies, localStorage, IndexedDB, Cache API, service workers,
HTTP cache, HTTP auth, and the notification, geolocation, camera and
microphone permissions. About 23 s on this machine.

Gotcha: mochitest flattens `support-files` into the test directory by file
name, so listing `../browser/head.js` overwrote the suite's own `head.js`.
Files of another directory are served from that directory's URL (`BASE`).
Suite directories must be named `browser/` or ESLint does not give them the
test globals.

## Step 3: shared stores

- **HSTS and certificate exceptions**: patch `0500` adds
  `security.hsts.isolate_by_user_context` and
  `security.cert_override.isolate_by_user_context` (default false; Swell sets
  both). One patch instead of the two the plan numbered (0230/0231), and `05xx`
  instead of `02xx` because `02xx` is reserved for history. Old HSTS entries
  (stored without a container) are not migrated into other containers.
  Running the cases with the prefs off makes both fail, so they test the patch.
- **Downloads**: no patch needed. `DownloadLegacy.sys.mjs` already records
  `source.userContextId` from the document that started the download, so the
  list (More menu, Downloads) and the toasts are filtered by the active
  space. The download list itself is per session; it is not persisted yet.
- **Zoom**: Firefox's `FullZoom` is in `browser/`, so there was no zoom at all.
  Swell now has Accel +, -, 0 (`EngineBridge.zoom`), and the core keeps the
  zoom per identity and host (`site_zoom` table, schema version 2,
  `SwellCore.site_zoom` / `set_site_zoom`; regenerated patch 0021). The engine
  stores zoom as a 32-bit float, so comparisons need a margin.
- The isolation suite now has 17 stores, about 37 s.

## Step 4: history per space

- **How it works.** Places stays the store behind `:visited`: it already tags
  every visit with the container. Patch `0200` (pref
  `places.history.isolate_by_user_context`, default false) makes the parent
  ask once per container for the processes that host it, counts only visits
  with that `userContextId`, and tells only that container's processes about a
  new visit. The container comes from the asking process's remote type, never
  from the request. A control run with the pref off colors the link as
  visited in the other space, so the case tests the patch. Parent-process
  links count as the default container and see nothing.
- **The core keeps its own history** (`core-history`, `history.db`, one row
  per identity and URL with visit count, typed count and last visit) for the
  command bar. Frecency is computed at query time. The command bar shows
  history after tabs, a page that is also a tab appears once, and nothing is
  shown for an empty query. `history_count` and `clear_history` are in the
  surface; there is no view of history across spaces anywhere. Places and the
  core are filled independently from the same navigations; Places is not
  rebuilt from the core yet.
- **Gotcha, same family as M1 finding 7.** Turning recording on crashed the
  main process: `History::VisitURI` imports
  `resource:///modules/BrowserWindowTracker.sys.mjs`, which does not exist in
  Swell, and a missing module crashes instead of throwing
  (`CheckForBrokenChromeURL`). Swell now installs a shim
  (`app/jsm/BrowserWindowTracker.sys.mjs`) that never finds a browser.
- **Latency (the M0 open question).** `browser_visited_latency.js`: a link is
  marked visited about 25 ms after the page loads, with 1,000 visits and also
  with 100,000 visits in the container (the query is idle priority and
  asynchronous; links start unvisited and flip). No per-identity cache in the
  content process is needed.
- A `# if ...` comment line in `StaticPrefList.yaml` is read by the
  preprocessor as a directive (`AMBIGUOUS_COMMENT`); reword such comments.
- `git` hazard in the Firefox clone: `gecko-branch.sh save NNNN` folds every
  uncommitted Firefox edit into patch NNNN, not only that patch's files.
  Save one patch at a time, with nothing else modified. (It happened once with
  0020 and was undone with an interactive rebase.)
- Not done: "delete a space" does not exist yet, so there is nothing to
  clean up on deletion (Places rows would go through
  `PlacesUtils.history.removeVisitsByFilter`); Places expiration and a
  history UI.

## Step 5: form history and autofill

- **Form history** (patch `0210`, pref `browser.formfill.isolate_by_user_context`):
  `moz_formhistory` gets a `userContextId` column (schema 6; rows of older
  versions belong to the default container; a newer database that lacks the
  column gets it when downgraded, which the v999 fixtures of the upstream
  tests need), and lookups, bumps, removals and autocomplete take the
  container into account. The 11 upstream satchel xpcshell tests pass (their
  `CURRENT_SCHEMA` constant is 6 now), plus `test_history_container.js`. The
  first version passed an undefined `userContextId` to the SQL as a named
  parameter, which breaks Firefox's default (pref off) case; a test that
  runs with the pref off would have caught it.
- **M1 gap found: the window had no autocomplete popup.** The toolkit's
  actors were registered but nothing could show a suggestion, so form
  history, saved logins and autofill could never appear. The window has the
  `PopupAutoComplete` panel now and every tab points at it
  (`autocompletepopup`). Lit leaves `window.litPropertyMetadata` behind; the
  test head deletes it.
- **Address and card autofill** (patch `0211`, pref
  `extensions.formautofill.isolate_by_user_context`): `FormAutofillParent`
  serves a page from the storage of its container, kept in
  `autofill-profiles-<id>.json` next to the default file; the "saved field
  names" gate that tells content processes whether autofill is worth
  running is the union over all containers (it names field kinds, not
  values). Firefox starts autofill from a built-in add-on that Swell does not
  have, so `app/modules/Autofill.sys.mjs` registers the actor and calls
  `FormAutofillStatus.init()`. The save prompt (a 1,800-line doorhanger on
  `PopupNotifications` and `browser/` strings) is replaced through a new pref,
  `extensions.formautofill.prompterModuleURI`, by `AutofillPrompter.sys.mjs`
  and a bar in the window (`autofill.mjs`: Save / Update / Save as new /
  Never / Not now). The More menu has "Addresses and cards": list, add, edit
  and remove for the active space. Cards are encrypted with `OSKeyStore`, whose
  single key is shared by all spaces, so only the files isolate, not the
  encryption (tests use `OSKeyStoreTestUtils`). Not done: Firefox's own
  manage dialogs and their l10n, country-specific address forms, passports,
  the Rust autofill store (left off, and its trial-migration prefs too).
- The upstream autofill unit tests live under `browser/extensions/formautofill`,
  which Swell does not build, so 0211 is covered only by the Swell tests
  (save prompt for an address and a card, "Not now", the dialog, and the
  isolation cases for addresses and cards).
- `tools/lint/extra-js-modules` refuses new files in `EXTRA_JS_MODULES`, which
  the `BrowserWindowTracker` stub needs (Places imports it from
  `resource:///modules/`); `mach lint swell/app` reports it. Expected, not
  worth a patch to Mozilla's allowlist.

## Step 6: passwords

- **Keychain decision (spike).** The Rust-crate route (`keyring` with
  `apple-native` and `sync-secret-service`) adds 3 new third-party crates on macOS
  (keyring, security-framework and its -sys) and 9 on Linux (keyring,
  dbus-secret-service, aes, cbc, cipher, block-padding, inout, hkdf, hmac).
  `./mach vendor rust` re-resolved the whole `Cargo.lock` (+800 lines of churn,
  reverted) and then failed `cargo vet` until exemptions are added; the
  vendored sources would live in `third_party/rust` and be redone at every
  rebase. Decision with you: the system keychain holds the key through
  Gecko's own `nsIOSKeyStore` (macOS Keychain, Windows Credential Manager,
  libsecret), with no new crates, and password-manager extensions work per
  space once step 8 lands.
- **How it works.** `core-logins` (`logins.db`, rows keyed by identity) stores
  origin, form action, realm, field names and times in the clear and the user
  name and password as opaque encrypted strings; it has no key. The login
  manager's storage is Swell's (`SwellLoginStorage.sys.mjs`, named by the new
  pref `signon.storageModuleURI`): it encrypts and decrypts in the window process with
  one keychain item per container (`Swell logins <container>`), calls the
  core by container, and applies Firefox's own match rules (copied from
  `storage-json.sys.mjs`). A container no identity owns, including 0, is
  refused. Sync, breach alerts and vulnerable-password checks are not kept.
- **Patch 0220** (`signon.isolate_by_user_context`): `LoginHelper.loginsFor(id)`
  is a per-container view of the login manager (searches carry
  `userContextId`, login objects are tagged through `wrappedJSObject` because
  they are XPCOM wrappers, and the login-saving permission uses a principal
  with the container). `LoginManagerParent` uses it for every read and write
  (about 20 call sites). Two seams: `signon.storageModuleURI` and
  `signon.prompterModuleURI`. "Never save for this site" stays in the
  permission manager, which is synchronous and already keyed by principal.
- **UI.** The save bar of step 5 asks "Save the password for ... on ...?" with
  Save / Update / Never for this site / Not now; the More menu has Passwords
  (list, show, add, edit, remove) for the active space.
- **Test gotchas.** The test profile sets `signon.rememberSignons=false`, and
  `prefs` in a manifest is only allowed in `[DEFAULT]`. Forms are only filled
  in a page that is in front (the document is `hidden` otherwise), so a test
  must select the tab. Tests use keychain items with their own prefix
  (`swell.logins.keyLabelPrefix`) and delete them. The test for the encrypted
  record must not use field names that equal the user name.
- **Not done.** HTTP authentication dialogs: Swell has no tab-modal prompt box,
  so an HTTP 401 cannot ask for credentials at all (an M1 gap, not
  passwords-specific); `LoginManagerAuthPrompter` would need the container
  and a prompt. Linux without libsecret: Gecko silently falls back to a key in
  the NSS database; decision 10 (refuse) needs a probe for the library and is
  part of the Linux step. Deleting a space does not exist yet, so nothing
  removes its keychain item (`deleteLoginsKey` is ready). Import and export of
  logins, password generation, breach alerts.

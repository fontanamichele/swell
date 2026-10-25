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

## Step 7: camera, microphone and screen sharing

- **No Gecko patch.** Firefox's `WebRTCChild.sys.mjs` is used unmodified: it is
  listed in `MOZ_SRC_FILES` as `../../browser/actors/WebRTCChild.sys.mjs`, which
  installs it at `moz-src:///browser/actors/` (a path starting with `/` landed
  under `moz-src:///swell/app/browser/`). A missing or wrongly placed module
  crashes the content process again (M1 finding 7), which is how the first
  attempt failed.
- **Actors.** The window actor must be registered as `WebRTC` and its parent
  class must be called `WebRTCParent` (the loader derives the class name from
  the actor name; the file is `SwellMediaParent.sys.mjs`). A process actor
  (`SwellProcess`, `SwellProcessChild.sys.mjs`) forwards `getUserMedia:request`,
  `PeerConnection:request`, `recording-device-events`,
  `recording-device-stopped` and `recording-window-ended` to `WebRTCChild.observe`,
  as Firefox's `BrowserProcess` does.
- **Parent.** `WebRTCParent` answers `webrtc:Request` from the saved
  `camera` and `microphone` permissions of the page's origin and container
  (isolated by `permissions.isolateBy.userContext`): a saved ALLOW for every
  requested kind is granted without asking, any saved DENY is refused,
  otherwise the window asks. A peer connection is allowed (it needs no
  device); a request from an insecure page is refused. Screens, speakers and
  computer audio are never remembered.
- **UI** (`media.mjs`): a bar with the device pickers (camera, microphone or
  screen), Remember, Allow, Block and Not now, shown for the page in front
  (other tabs wait until selected); a red strip with Stop sharing while the
  page in front shares; the tab row of a sharing tab gets a red dot. Stop
  sharing goes through `webrtc:StopSharing`.
- **Test gotchas.** A call to `getUserMedia` from `SpecialPowers.spawn` has the
  system as its caller and is never asked about; the test page makes the call
  from its own script. The page must keep the stream, or sharing ends. Fake
  devices only count as capturing with `media.navigator.permission.fake`
  (`DeviceListener::CapturingSource`), so without that pref no indicator update
  carries a capture state. The test profile does not set the media prefs.
- **Screen sharing** is checked up to the prompt and the system's answer: in a
  headless run the OS refuses (`NotReadableError`) after the user allows,
  which the test accepts; the indicator and Stop path run only when capture
  starts. A real screen share, macOS Screen Recording permission, camera and
  microphone entitlements in the signed build, and the Linux portal path are
  for a hand check and the packaging and Linux steps. `NSCameraUsageDescription`
  and `NSMicrophoneUsageDescription` are in `Info.plist.in` already.
- **Not done.** Muting the camera or microphone from the window
  (`webrtc:MuteCamera` and the like are wired in the actor, not in the UI), a
  picker that previews a screen or window, speaker selection, and "this
  session only" grants (Allow without Remember is for one request).

## Step 8: extensions per space (in progress)

Done: a tab and window layer for WebExtensions without `browser/` (`app/extensions/`), the `tabs` and `windows` APIs over the engine bridge, content scripts, storage, and installing an add-on per space.

- A copy of an add-on is bound to its space by its id (`name--s<N>@domain`, or `<guid>--s<N>@derived.swell.invalid`). Patch 0100 reads the container from the id. Native hosts and `allowed_extensions` see the original id.
- `ExtensionInstaller.sys.mjs` derives the copy from the package, keeps the original under `<profile>/swell/extension-originals`, and installs through the add-on manager. Copies are unsigned, so `xpinstall.signatures.required` is false; the original's signature is checked first unless `swell.extensions.allowUnsigned` is set.
- Gotcha: installing a stored original for another space copied the file onto itself and emptied it (`getHashForFile` failed with `NS_ERROR_NOT_AVAILABLE`).
- Isolation: `extension copies` is isolated, and the self-test detects sharing by loading the second copy unbound.

- `menus`: `app/extensions/ext-menus.js` turns an add-on's items into plain descriptions that the window's own context menu draws (Firefox builds XUL menus). Several top-level items of one add-on go under a submenu named after it, as in Firefox. Firefox's child script and `menus.json` are installed unmodified. Not done: icons, `viewTypes`, `overrideContext`, `getTargetElement`.
- `browserAction`/`action`: state in the toolkit's `ExtensionActions`, buttons in a row at the top of the sidebar for the add-ons of the active space, popup in a `<browser>` of the space's container hosted in the window. Gotcha: in the non-e10s test harness the popup browser never fires `load`, so only a remote browser waits for its frame loader. The remote path is not covered by the suite.
- The per-tab data of an add-on (`TabContext`) is keyed by native tab now; before it was keyed by an id the toolkit never passed.
- Window controls: `customtitlebar` is on the root in `window.xhtml` for every platform, so the system titlebar is gone before the first show. macOS keeps its traffic lights; Windows and Linux get minimize, maximize/restore and close in a strip across the top (Linux follows the GTK button layout and falls back to the system titlebar without client-side decorations). Only macOS has been run; the Windows and Linux layouts are untested.

Not done yet: `commands`, updating all copies of an add-on, idle unload of persistent backgrounds, a native messaging id test, hiding `contextualIdentities`.

## Spaces: edit, order, delete

- The core can rename a space and change its icon, move it in the list, and delete it (`update_space`, `move_space`, `delete_space`). Deleting takes the space's trees and tabs, and its identity with the favorites, history, logins and zoom unless another space shares it. The last space cannot be deleted.
- A container id is never handed out twice: the next free id is kept in the store (`next_user_context_id`), so a new space cannot see what a deleted one left behind.
- `Store::sync_structure` only upserts, so deletions go through `Store::sync_removals`, which forgets the spaces, identities and nodes the model no longer has. `save_all` is not used for this: its `DELETE FROM identities` cascades into the zoom of every identity.
- `SpaceCleanup.sys.mjs` forgets what the engine keeps for the container: site data and permissions (`deleteDataFromOriginAttributesPattern`), Places visits (a page visited only there is removed whole; the others get their counts recalculated), form history, the `autofill-profiles-<id>.json` file, the key of the saved logins, add-on copies and downloads. `browser_spaces.js` checks each of them against a space that stays.
- UI: right-click on a space for Edit and Delete, drag a space button to reorder, and one dialog with an emoji picker (about 480 emoji in 9 groups, searchable by words) for creating and editing.
- Not covered: the picker has no skin tones, and a deleted space's HSTS entries and certificate exceptions are not checked separately (they are cleared if the clear-data service handles them for the container).

## Navigation controls

A row at the top of the sidebar: back, forward, reload (stop while the page loads), a pill with the page's host (click opens the command bar on its address) and a button that copies the address. The engine bridge already tracked `canGoBack`, `canGoForward` and `loading` per tab and had `goBack`, `goForward`, `reload` and `stop`; this is only the face for them. Not done: the history list on a long press of back/forward, a lock icon for the connection, and editing the address in the pill itself.

## Layout like Arc

- The top row (`#titlebar-left`, as wide as the sidebar) holds the sidebar button and, at its right end, back, forward and reload. The address pill is a row of its own at full width, with the copy button inside it. On Windows and Linux the same row sits in a strip across the window with the window buttons at the other end (placement on Linux follows the GTK layout).
- New tab is the first row of the Today list instead of a footer button.
- The page is a rounded card (10px, 8px margin) on the sidebar's background. With the sidebar hidden on macOS the card starts below the row, which keeps the window buttons and the sidebar button.
- The sidebar is resized by dragging its edge (a double click resets it, 180px to half the window), hidden and shown by the button or the accel key S. Width and state are kept in the XUL store.
- macOS only shows its window buttons if `customtitlebar` is set after the window exists. Putting it on the root in `window.xhtml` hid them, so `window.mjs` sets it for every platform again; the Wayland remark about setting it before first show is not settled.

## macOS window buttons and icons

- With `customtitlebar`, macOS hides its window buttons (`FrameView__closeButtonOrigin` returns a point above the window) unless the page has an element with the `-moz-window-button-box` appearance, which says where they go. Setting the attribute alone, early or late, was never enough: that is why the buttons were missing, and why the M1 note that the attribute and CSS were checked but not the look was right to worry. `#window-buttons-box` in the top row is that element; it takes the size of the three buttons from the theme.
- Button icons are Iconoir (MIT, `app/content/icons/`, licence file included), drawn as CSS masks so that they take the text colour.
- `browser_sidebar_tree.js` failed once in a full run (the context menu item was not found) and passed in the next full run and twice alone; not understood yet.

## Hidden sidebar

With the sidebar hidden its button goes too and the page keeps its margin (on macOS the window buttons stay, over the page's corner). A 6px hot edge at the left of the window brings the sidebar back, sliding in over 200ms with an ease, as a card (10px radius) an 8px margin away from the window's edges, like the page, with its button and arrows, until the pointer has been off it for 300ms; the button then pins it open. The edge is an element of the window, not a mouse listener, because the window does not see the mouse over a page. Not done: revealing the sidebar when the pointer is near the edge but the mouse is dragging something.

## Dragging, window buttons and the shortcut

- The window background is a drag region (`-moz-window-dragging: drag` on the root), and the sidebar, the page, dialogs and every button, input and select are `no-drag`: HTML buttons are not excluded by default (only XUL ones are, in `xul.css`), and later frames cut holes in earlier drag regions. So the margins around the page card, the strip and the empty top row drag the window.
- The macOS window buttons belong to the sidebar: with the sidebar hidden `#window-buttons-box` is `display: none`, an empty rect hides them, and they come back inside the floating card.
- A floating sidebar that the pointer reached through the left edge stays when the pointer leaves the window, so that it can be reached by pushing against the border; it goes 300ms after the pointer has gone from it into the window.
- Accel+S: a tap shows or hides the sidebar when the key comes up, held for 250ms a hidden sidebar floats back until the key (or the accel key; macOS sends no key up for S while Command is down) is released. Dragging, hover at the border and the held key were not tried by hand.

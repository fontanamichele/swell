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

- Window drag regions are built in document order and a later `no-drag` frame cuts a hole in an earlier `drag` one. `#titlebar` comes before `#app`, so a `no-drag` on the whole `#sidebar` cut away the top row of the sidebar. Only the clickable parts of the sidebar (`#lists`, `#favorites`, `#navbar`, the extension buttons, the footer) are `no-drag` now.
- The floating sidebar is back to the full height of the window, flush with its left edge, with only the radius (`--peek-gap` is 0; setting it above 0 gives the card with margins again, but the macOS row then needs its offset back).

- The top row (`#titlebar`) now comes after `#app` in the document. Drag regions are built in document order and the page (`#content`, `no-drag`) lies under a floating sidebar, so the row has to come after it for the sidebar's top part to drag. The floating sidebar's radius is 18px (`--peek-radius`).

- Correction: Gecko's window drag region is the drag areas minus the no-drag areas, whatever their order in the document (`GetWindowDraggingRegion`); the earlier note on document order was wrong. What cancelled the floating sidebar's top row was `#content` (`no-drag`), which spans the whole window while the sidebar is hidden. While the sidebar floats, `#content` is `default` and only a pseudo-element to the right of the sidebar is `no-drag`.

## Tinted, translucent sidebar

- Each space has a tint (`#rrggbb`, set from the space editor's swatches, stored in the core: `spaces.tint`, schema version 3). The window takes the tint of the active space.
- On macOS the window is the system's sidebar material (vibrancy): `body` has the `-moz-sidebar` appearance, which makes a `Sidebar` theme geometry for the whole window and so a native `NSVisualEffectView` behind the page. The theme gives the root the opaque `-moz-mac-window` appearance by default, which would cover it, so `:root` is `appearance: none` here. The tint is mixed over the material (38%). Elsewhere the tint is mixed into the sidebar colour.
- I could only check the style values by test, not how the material looks: the default behind-window blend mode (`widget.macos.sidebar-blend-mode.behind-window`) and whether the page card and its margins sit well on it need a look by eye.

## Closer to Arc

- Favorites are tiles, three to a row, above the lists; with none they take no room and only show as a dashed drop target while a tab is dragged. The tab menu has Add to favorites and Remove from favorites.
- The sections have no headings (a line sets the open tabs apart; the "+" for a new folder shows when the pointer is over the pinned tabs). Rows are 40px with a 12px radius and 14px text; New tab is the first row of the open tabs; the top row is 44px high on macOS and the address pill 38px with a link icon.
- The bottom bar is downloads, the spaces, new space. The old "..." menu is the system menu bar now: a `<menubar>` in window.xhtml (macOS builds the native menus from the first `<menubar>` of the window document; the first menu is the application menu, found by the ids `menu_mac_hide_app`, `menu_FileQuitItem` and so on). It has Swell, File, View and Tools (downloads, add-ons, passwords, addresses and cards, import from Arc). Items have no key equivalents, because the shortcuts are handled by the window and a menu key would handle them twice. No Edit or Window menus yet.
- Not seen by eye: the menu bar, the vibrancy and the new sizes.

- Gecko treats a macOS top-level window as opaque ("always opaque", `toolkit/themes/osx/global/global.css`), so what the document leaves clear is the window's own colour, which covered the sidebar material. Patch 0600 adds a root attribute `macostranslucent` (handled in `ChromeObserver`, as `windowsmica` is for Windows) that makes the window transparent through `SetTransparencyMode`; `window.mjs` sets it on macOS. Whether the window shadow and corners still look right with a transparent window is for a look by eye.

## Details after a first look

- Close buttons are an Iconoir icon in a square, middle click on a tab or favorite closes it, tabs have a 4px gap, icons are 16px (18px in favorites), the page margin is 12px and so is the sidebar padding.
- Accel+D pins the tab in front (from Today) or unpins it.
- The mouse's back and forward buttons: over a page they go through its history (`SwellPageChild` sees the `mouseup`, cancels it so that the engine does not navigate too, and the window navigates the tab in front); over the sidebar they go to the previous and next space (not around the ends). Any change of space, by button, key or mouse, slides the lists in from the side the new space is on (260ms).

- The mouse's back and forward buttons do not reach the DOM as mouse events on macOS: `ChildView otherMouseDown` turns them into a `WidgetCommandEvent` (`Back`/`Forward`, pref `mousebutton.4th.enabled` / `5th`) and swallows the mouse events, so the `mouseup` approach of the last round only passed in tests that sent synthetic events. The window listens for `AppCommand` (as Firefox's browser.js does), which does not say where the pointer is; the window tracks whether it is over the sidebar and its top row (space change) or not (history of the tab in front). The page actor no longer listens for it.
- The page margin and sidebar padding are 10px; tab icons 14px, favorites 15px.

## Pinned tabs keep their page

- A pinned tab or favorite does not follow its navigation: `Model::navigated` leaves the node alone when it is under Pinned or Favorites (Today tabs follow as before), and its icon is only set while it has none. The page it is on is the live tab's: the row of a pinned tab that has gone elsewhere (`isAway`: the same page ignoring "www.", a closing slash and the fragment) shows that page's title after a divider and a button that loads the pinned page again; closed, it is the pinned page, and opening it starts there.
- Correction to the notes on patch 0600: it did not compile until now (`TransparencyMode` needed `widget::`), and I did not look at the exit code of the builds, so the application that was run after it had neither the patch nor the core change of this section (the tests passed because they only checked attributes and the Swell side). Builds are checked by their exit code now. The window is only made transparent when the pref `swell.window.transparent` is set (macOS, default off): the material showed without it, and nobody has looked at the shadow and corners of a transparent window.

- Accel+D on a pinned tab that has gone to another page pins the page it is on (`Model::repin`, `repin_tab`: the node keeps its place and takes the new address and title, and loses its icon until the new page sets one); on its pinned page it unpins, as before.

- The back and forward shortcuts (accel+[ and accel+]) are matched by the physical key (`code`), not the typed character, which is something else on layouts where the brackets are behind Option (Italian, for one). On a Logitech MX Master the thumb buttons produced nothing in Swell, not a mouse button, an `AppCommand` nor a key (checked with temporary on-screen messages, since removed): they are handled by Logitech Options+, which has to be told what to send for Swell. The window handles `AppCommand` and the bracket shortcuts, so either a plain Back/Forward button or a shortcut set to accel+[ and accel+] will work.

- Back and forward from the keyboard: accel+Left and accel+Right (not in a text field of the window, and not with Shift), next to accel+[ and accel+]. They are what a mouse driver such as Logitech Options can be told to send for the thumb buttons, which it does not send as mouse buttons to an application it does not know (see the notes above and the reports in Mozilla bug 1401837 and the Opera and Brave forums). Over the sidebar (and its top row) all four, and the AppCommand, change to the previous and next space instead of going through the history. In a page that has a text field focused the page keeps the arrows.

## The basic Google page

Google, and other sites, choose between their modern and a basic page by the user agent. Swell's was `... Gecko/20100101 Swell/0.1.1`: the engine adds the `Firefox/<version>` token only to Firefox itself, or when `general.useragent.compatMode.firefox` is set, so Swell looked like an unknown browser and Google.com answered with its basic page (90 KB, the `lst` search box, grey buttons) instead of the modern one (about 280 KB). `swell.js` sets the pref now, and the user agent is `... Gecko/20100101 Firefox/161.0 Swell/<version>`; `browser_user_agent.js` checks it. The architecture notes had planned this token and it had never been checked. The version after `Swell/` is the one the build was configured with (0.1.1), not the current one, which is a separate thing to fix.

## The whole emoji set

The picker has the whole emoji set of the data of emojibase 16.0.3 (MIT; names and keywords from Unicode's CLDR): 1,906 emoji in the nine groups of Unicode, with 323 that have skin tones. The data is `emoji-data.json` (122 KB), read when the picker is first opened, with its licence next to it, and it replaces the 480 chosen by hand. A row of six buttons chooses no skin tone or one of the five, which is applied to every emoji that has them (the choice is kept in the XUL store). Searching goes through the words of all of them (the name and its tags). Emoji of the data set that the system's font cannot draw would show as empty squares: nothing hides them, and the ones that come after Emoji 16 are not in the data.

## Atkinson Hyperlegible Next

The window is set in Atkinson Hyperlegible Next (Google Fonts, SIL Open Font License 1.1): the variable font file `app/content/fonts/AtkinsonHyperlegibleNext.ttf` (115 KB, weights 200 to 800) with its licence, loaded by an `@font-face` on a `chrome://` URL, so nothing is fetched from Google. Buttons, inputs and selects inherit it. What has its own font is left alone: the window buttons of Windows (Segoe), the emoji (the system's) and the pages.

Fonts tried and why: Epilogue first (wide; fine coverage), then Asta Sans was checked and not used: the Google Fonts file has only ASCII and Korean, 60 of the 64 Latin-1 letters (every accent of Italian, French, Spanish, German) are missing, so words would switch font in the middle. Atkinson Hyperlegible Next has all of Latin-1 and 93 of 128 Latin Extended-A (not all of Central Europe: some Polish, Czech and Hungarian letters fall back to the system font); it has no Cyrillic or Greek, which also fall back. `browser_icon_centering.js` measures the glyphs of the space buttons, since the padding that centres a letter depends on the font.

## Many pins at once

`core/core-store/examples/pin_links.rs` adds links to the pinned tabs of a space of a profile (`cargo run -p core-store --example pin_links -- <data dir> <space title> < links.tsv`, one `address<TAB>title` per line; Swell must be closed, and the data should be copied first). It was used to put 36 links in a space. A pinned tab takes the title of the page when it is on its own page (the same address, ignoring the fragment, a closing slash, the scheme and "www."), so the titles that were guessed for the pages that would not answer a script are replaced by the real ones when a pin is first opened.

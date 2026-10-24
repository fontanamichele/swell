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

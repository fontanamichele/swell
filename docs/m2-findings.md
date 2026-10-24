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

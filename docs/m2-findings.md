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

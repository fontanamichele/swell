# Privacy

Swell does not collect data about you, and it has no accounts. This page says exactly what
the application does with your information and what it sends over the network. It describes
the alpha.

## What stays on your computer

Everything Swell keeps is in your profile folder: your spaces and their pages, history,
saved passwords, addresses and cards, downloads, cookies and site data, and permissions.
Each space keeps its own, separately from the others.

- **Passwords and cards** are encrypted. The key for each space is kept in your system's
  keychain (macOS Keychain, or the system's secret service on Linux), not in the profile.
- Swell has no sync in the alpha. Nothing leaves your computer for that purpose.

## What Swell sends on its own

Swell has no telemetry and no crash reporter, and it never downloads or installs an update
by itself. An idle profile contacts only Remote Settings and the update check (below), and
that is tested: `tests/e2e/network_silence.py` fails if anything else is contacted. Three
things can reach a server without you doing anything in a page:

1. **Remote Settings** from Mozilla (`firefox.settings.services.mozilla.com`, plus its download and signature servers
   `firefox-settings-attachments.cdn.mozilla.net` and `content-signature-2.cdn.mozilla.net`): a list of
   security data the engine uses, such as certificate revocation and blocklists. The request
   shows your IP address and the engine version to Mozilla, like any web request. It is on by
   default because it protects you. A setting to turn it off, and later a mirror that is not
   Mozilla's, are planned.
2. **The update check** (`api.github.com`): about half a minute after Swell starts, and at
   most once a day, it asks GitHub for the releases of the project and shows a badge above
   your spaces when a newer one exists. It only reads the list; it downloads nothing (the
   badge links to the file made for your system, and you decide whether to open it). GitHub
   sees your IP address and that you run Swell, like any web request. It is on by default in
   the alpha; turn it off with "Check for updates automatically" in Swell > About Swell
   (`swell.update.autocheck`), and no request is made until you press "Check for updates".
3. **Your DNS and the sites you open**, like any browser.

## What Swell sends when you ask

- **Check for updates** (Swell > About Swell) asks GitHub for the latest release of the
  project (`api.github.com`), whether or not the automatic check is on. GitHub sees your IP
  address.
- Searching from the address bar sends what you type to the search engine you have chosen.
- Add-ons you install can do what their permissions allow.

## Delete your data

Deleting a space in Swell removes what it kept for it (its history, passwords, forms, site
data, permissions, downloads and the keychain key). Removing the profile folder removes
everything.

## Questions

Open an issue on the project's repository.

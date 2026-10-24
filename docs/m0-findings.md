# M0 findings: isolation spike

2026-10-24 · base: Firefox `main` 161.0a1 at `f536a878f58f` (pinned in `FIREFOX_REV`; not an ESR), macOS arm64, artifact build.
Raw data: `spikes/m0/audit-results.md`, `spikes/m0/ext-observations.md`, `spikes/m0/measure/results/*.json`.
Tests: `tests/isolation/browser/`. Patches: `patches/0000-test-hook.patch` (local), `patches/0100-p4-prototype.patch`.

## Recommendation

**Go**, with conditions. Per-space extension copies can be made airtight with a JS-only change of about 65 lines for the
cases tested, and no C++ build was needed. The conditions are the open items at the end (restart behaviour, worker
backgrounds, extension UI surfaces, the untested APIs), plus a decision on memory (see Measurements).

If a later check turns up a hole that needs C++ (candidates are listed under P4 size), P4 grows but stays tractable. If the work
is judged too large anyway, the fallback is: **one shared copy of each add-on, with an allowlist of vetted add-ons** (content
blockers and theme-style add-ons that hold no per-site state), and the denylist prefs of `extensions.userContextIsolation`.
Isolation of extension state would then not be offered, and the UI must say so.

## 1. Baseline isolation audit (no engine changes)

`./mach test swell/tests/isolation --headless`: containers A (userContextId 1) and B (2) in one window, same action in each.
42 checks; the 11 failing subtests are exactly the shared stores below.

| Store | Result | Evidence (observation; code) |
| --- | --- | --- |
| cookies | isolated | B has 0 cookies; `netwerk/cookie/CookieKey.h` |
| localStorage | isolated | B reads null; `dom/localstorage/LSObject.cpp`, `dom/quota/PrincipalUtils.cpp` |
| IndexedDB | isolated | B lists no DB; same quota origin |
| Cache API | isolated | B has no cache; `dom/cache/ManagerId.cpp` |
| service workers | isolated | 0 registrations in B; `dom/serviceworkers/ServiceWorkerManager.cpp` |
| HTTP cache | isolated | A refetch hit cache, B refetched; `netwerk/cache2/CacheFileUtils.cpp` |
| HTTP auth | isolated | B sends no `Authorization`, A reuses credentials; `netwerk/protocol/http/nsHttpAuthCache.cpp` |
| **HSTS** | **shared** | secure in A and B; `security/manager/ssl/nsSiteSecurityService.cpp` ("Don't isolate by userContextId"); entries are keyed by the http-scheme partition key |
| **certificate overrides** | **shared** | override in A and B; `security/manager/ssl/nsCertOverrideService.cpp` |
| **permissions, pref off** | **shared** | A=ALLOW B=ALLOW; `extensions/permissions/PermissionManager.cpp`, `permissions.isolateBy.userContext` default false |
| permissions, pref on | isolated | A=ALLOW B=UNKNOWN |
| **permission `cookie`, pref on** | **shared** | forced strip (`kStripOAPermissions`: `cookie`, `https-only-load-insecure`, `ipp-vpn`) |
| storage-access grant, pref on | isolated | A=ALLOW B=UNKNOWN |
| **Places history** | **shared** | page visible profile-wide; the visit row does record `userContextId` (bug 2079759, post-ESR code); `toolkit/components/places/History.cpp` |
| **`:visited` links** | **shared** | link visited in B; `docshell/base/BaseHistory.h` (keyed by URI) |
| **address bar history suggestions** | **shared** | A's page suggested in B; `browser/components/urlbar/UrlbarProviderPlaces.sys.mjs` (switch-to-tab is container-aware) |
| **saved logins** | **shared** | B autofills A's login; `toolkit/components/passwordmgr/LoginManagerParent.sys.mjs`, `nsILoginInfo` has no origin attributes |
| **form history** | **shared** | A's typed value offered for B; `toolkit/components/satchel/FormHistory.sys.mjs` |
| **downloads list** | **shared** | no container filter; `toolkit/components/downloads/Downloads.sys.mjs` |
| **site zoom** | **shared** | B zoom 1.1 after A zoomed; `toolkit/components/contentprefs/ContentPrefService2.sys.mjs` |

Caveats: the login was added through the API (the save prompt was not driven; the autofill lookup in B is the real path);
the downloads check is API-level; form history in B was queried through `FormHistory.getAutoCompleteResults`, not the popup.
**Not behaviourally tested** (code evidence only): address and credit-card autofill (`toolkit/components/formautofill/default/FormAutofillStorage.sys.mjs`,
one profile-wide store, no container concept), bookmarks, favicon store, search engines, session file.
Isolated by origin attributes per source reading and in-tree tests, not retested: client certificates, TLS session cache,
connection pool, DNS cache, Alt-Svc, push, EME/GMP, FedCM. Not investigated: WebAuthn, clipboard.

**Corrections to `ARCHITECTURE.md`:** HSTS is not "config only" (shared, needs work like P1), certificate overrides and site zoom are
also shared and unlisted. `~` is not a legal add-on ID character.

## 2. Extension copies, observed

`tools/derive-extension` (Python, stdlib only) turns an `.xpi` plus a space id into an unsigned copy. Derived IDs:
`local@domain` → `local--s<space>@domain`; `{guid}` → `<guid>--s<space>@derived.swell.invalid`. The ID pattern (`gIDTest` in
`toolkit/mozapps/extensions/internal/XPIInstall.sys.mjs`, also the `ExtensionID` schema) forbids `~`, so `X~S` is notation only.
The tool drops the signature, `update_url` and the recommendation file, reads manifests with `//` comments as Firefox does, and
warns about references to the original ID, managed storage and native messaging.
Unsigned copies install here because this build has `MOZ_REQUIRE_SIGNING: false`; the pref `xpinstall.signatures.required=false` is honoured.
(A release or ESR build of Swell must set that flag off or sign copies itself.)

Add-ons tested (pinned, hashes in `spikes/m0/addons/README.md`): Dark Reader 4.9.133, uBlock Origin 1.75.0, 1Password 8.12.41.1, and
the own fixture (`tests/isolation/browser/browser_isolation_extensions.js`).

Observation matrix, fixture add-on, two copies (a for container 1, b for container 2). "leaks" means the copy saw or ran in another space.
C0 = stock; C1 = `extensions.userContextIsolation.enabled` plus per-copy `.restricted` lists; C2 = the P4 prototype.

| Question | C0 | C1 | C2 |
| --- | --- | --- | --- |
| separate `storage.local` and separate moz-extension UUID per copy | isolated | isolated | isolated |
| content script injected into the other space's tabs | leaks | **leaks** | isolated |
| dynamically registered content script injected | leaks | **leaks** | isolated |
| content script messages reach the background page | leaks | isolated | isolated |
| `tabs.query` sees other space's tabs | leaks | isolated | isolated |
| `tabs.create` into a foreign space | allowed | rejected | rejected |
| `cookies.getAllCookieStores` | leaks | isolated | isolated |
| `cookies.getAll` of other stores | leaks | **leaks** | isolated |
| `cookies.onChanged` for other stores | leaks | **leaks** | isolated |
| `webRequest` events of other spaces | leaks | isolated | isolated |
| container of the background page's own `fetch` | 0 (default) | **0** | the bound container |

The existing denylist (C1) hides tabs, but the content script still runs in every container; only its messages are filtered.

Real add-ons:

| Add-on | Question | C0 | C2 |
| --- | --- | --- | --- |
| Dark Reader (copy `addon--sa@darkreader.org`) | content script marker `data-darkreader-mode` found in | all three containers | container 1 only |
| uBlock Origin | any | **not observed** | **not observed** |
| 1Password | native messaging | **not run**: it would start the real 1Password helper; awaiting your approval | |

Native messaging, own echo host that lists only the original ID `fixture@swell.test`:
a derived ID is rejected ("No such native application", `NativeManifests.sys.mjs` `allowed_extensions.includes(context.extension.id)`);
with the derived→original mapping of the prototype, both copies connect and each gets its own host process (different pids).
Whether the real 1Password desktop app accepts a mapped copy, or two at once, is unknown.

## 3. P4 enforcement points and prototype

| Point | Where decided | Language | Prototype |
| --- | --- | --- | --- |
| content-script injection | C++ `MozDocumentMatcher::Matches` (`WebExtensionPolicy.cpp`) already matches `originAttributesPatterns`; the patterns are fed from JS: manifest scripts in `Extension.sys.mjs`, dynamic ones in `parent/ext-contentScripts.js`, `parent/ext-userScripts.js`, `ExtensionScriptingStore.sys.mjs` | JS-fed, C++ enforced | **works** |
| `tabs` / `windows` visibility | `browser/components/extensions/parent/ext-browser.js` `TabManager.canAccessTab` and `Extension.canAccessContainer` | JS | **works** (allowlist for bound copies) |
| `webRequest` delivery | `webrequest/WebRequest.sys.mjs` `runChannelListener` (JS); `ChannelWrapper.cpp` has no container logic | JS | **works**; `ProxyChannelFilter.sys.mjs` follows the same check |
| `cookies` API scope | `parent/ext-cookies.js` `oaFromDetails`, `onChanged` | JS | **works** (forced to the bound store; foreign stores error) |
| the extension's own requests | background `<browser>` made in `ExtensionParent.sys.mjs` `HiddenExtensionPage.createBrowserElement`; the extension principal has empty origin attributes | JS | **works**: a `usercontextid` attribute on the background browser makes `fetch` carry the bound container's cookie |
| native messaging ID | `NativeManifests.sys.mjs` | JS | **works** (mapping pref) |

Result: **works** for everything above, on an artifact build. No full build was needed, so the gated step 8 was not run.
The existing tests still pass (`browser_ext_tabs_containerIsolation.js`, `browser_ext_webNavigation_containerIsolation.js`,
`browser_ext_tabs_cookieStoreId.js`, and the xpcshell container-isolation tests, with 0 unexpected results), and the extension test
shows no leak in C2 on any probe.

Binding: pref `swell.spike.boundUserContext.<addonId>` (integer). The prototype is deliberately crude. The diff
(`patches/0100-p4-prototype.patch`, 7 files, +65/−7) is at the end of this document.

### Estimated size of the final P4

Prototype: about 65 added lines in 7 JS files. Estimate for the real patch (not measured, from reading the code):
- JS: 300 to 600 lines. Replace the pref with a real `identity` on the extension, hide the other copies from `management`,
  cover the APIs not yet touched (below), and add tests for each.
- C++: 0 to 150 lines, only if we choose to put the identity on `WebExtensionPolicy` (`WebExtensionPolicy.cpp` / `.webidl`, bug 1699481 asks for exactly this)
  and move the checks into `MozDocumentMatcher::Matches` and `ChannelWrapper::Matches`. Not needed for isolation, but it removes the JS/C++ split.
- Tests: about 400 lines of browser-chrome and xpcshell. Rebase cost per ESR: moderate; the code sits in `Extension.sys.mjs`, which changes often.
- Upstreamability: good. It extends the existing `extensions.userContextIsolation` mechanism (a TODO already references bug 1699481).

Not covered by the prototype or the tests, and in scope for P4: `downloads`, `history` (needs P1), `sessions`, `browsingData`,
`contextualIdentities`, `management`, `runtime.sendMessage`/`connect` between copies, `declarativeNetRequest` rules, `windows`,
`menus`, `omnibox`, `devtools`, `notifications`, and popups, options pages and sidebars (what container do they open in?).
Also untested: worker-based backgrounds (`backgroundWorkerScript`), MV3 event pages, `world: MAIN` scripts, `about:blank`/frame cases,
and **restart behaviour** (a cached parsed manifest could keep stale `originAttributesPatterns` if the binding changes after install).
The console showed "Invalid tab ID" errors during C2 runs; they did not fail anything, but should be understood before shipping.

## 4. Measurements

50 measured cold starts (5 per configuration after one discarded warm-up), headless, local page with four container tabs
(containers 1 to 4), 30 s settle, memory summed over all Firefox processes from `ChromeUtils.requestProcInfo()` (resident unique).
Copies are bound to containers 1 to 4. A dead proxy blocked the internet. Another Firefox was running on the machine at the same time.

| Config | Copies | Total MB, median (min–max) | Extension-process MB | MB per copy vs no add-ons |
| --- | --- | --- | --- | --- |
| S0 no add-ons | 0 | 513 (511–515) | 47 | - |
| S1 Dark Reader + uBlock Origin + fixture | 3 | 721 (708–722) | 195 | 69.6 |
| S2 same, four copies each | 12 | 959 (933–1003) | 366 | 37.2 |
| S2 unbound (copies not limited to a container) | 12 | 1016 (978–1056) | 399 | 42.0 |
| Dark Reader ×1 / ×4 | 1 / 4 | 566 / 661 | 75 / 120 | 31.6 per extra copy |
| uBlock Origin ×1 / ×4 | 1 / 4 | 686 / 832 (744–929) | 177 / 281 | 48.8 per extra copy |
| fixture ×1 / ×20 | 1 / 20 | 529 / 601 | 55 / 84 | 3.8 per extra copy |

- All copies run in **one** shared extension process (`dom.ipc.processCount.extension` = 1); the cost sits in that process.
- A first copy costs most (uBlock Origin 173 MB, Dark Reader 53 MB); later copies cost less per copy. A trivial add-on costs about 4 MB per copy.
- Binding copies to one container each saves about 57 MB at 12 copies (fewer content scripts).
- Startup: `sessionRestored` medians were 427 to 490 ms in every configuration (single runs up to 631 ms). Time until all background pages were running: 662 ms with 3 copies,
  752 ms with 12 (attach time of the harness about 560 ms). Extra copies delay that by about 90 ms; the first launch after install takes 0.9 to 2.9 s to reach that point.
  The measurement cannot resolve less than about 100 ms because extensions are mostly started before the harness attaches.
- uBlock Origin ×4 varies by up to 185 MB between runs.

Against the thresholds I proposed (not yet confirmed by you):

| Threshold | Measured | |
| --- | --- | --- |
| 12 copies minus 3 copies ≤ 400 MB | 237 MB | ok |
| average ≤ 30 MB per copy | 37 MB | **over** |
| extra startup ≤ 300 ms | about 90 ms | ok |
| any copy fails to start | 0 | ok |

Reading: the average is dominated by uBlock Origin and Dark Reader. In practice a user installs an add-on in the spaces that need it,
not four copies of everything; 12 heavy copies cost about 450 MB, which is acceptable on a desktop but would need a policy
(install per space on demand, unload idle copies via event pages) before shipping.
Not measured: 1Password (it starts the real helper), warm vs cold OS cache effects, idle unload, a longer settle than 30 s.

## 5. Open items and what is not proven

- **1Password:** run with the real helper only with your approval; the question is whether the app accepts a mapped copy and two at once.
- uBlock Origin was only measured for memory, not observed for isolation.
- Restart, update and uninstall behaviour of bound copies; worker and event-page backgrounds; extension UI surfaces; the APIs listed above.
- ESR: this ran on `main`; the Places `userContextId` column and any other post-ESR code in the audit must be re-checked on the chosen ESR.
- The test hook patch and the prototype patch are still applied in the Firefox tree. `tools/apply-patches.sh revert` removes both.
- Decisions for you: confirm or change the thresholds; whether HSTS, certificate overrides and site zoom become patches (P-numbers) in M2 or are logged; the memory policy for copies.

## Prototype diff

```diff
diff --git a/toolkit/components/extensions/Extension.sys.mjs b/toolkit/components/extensions/Extension.sys.mjs
index 41f7c5f7bf53..c09b05f0673c 100644
--- a/toolkit/components/extensions/Extension.sys.mjs
+++ b/toolkit/components/extensions/Extension.sys.mjs
@@ -1117,6 +1117,18 @@ export class ExtensionData {
     return results;
   }
 
+  // Swell M0 spike: the userContextId this copy is bound to, or -1.
+  get boundUserContextId() {
+    return this.id
+      ? Services.prefs.getIntPref(`swell.spike.boundUserContext.${this.id}`, -1)
+      : -1;
+  }
+
+  get boundOriginAttributesPatterns() {
+    let bound = this.boundUserContextId;
+    return bound >= 0 ? [{ userContextId: bound }] : null;
+  }
+
   readJSON(path) {
     return new Promise((resolve, reject) => {
       let uri = this.rootURI.resolve(`./${path}`);
@@ -2154,6 +2166,7 @@ export class ExtensionData {
           jsPaths: options.js || [],
           cssPaths: options.css || [],
           cssOrigin: options.css_origin,
+          originAttributesPatterns: this.boundOriginAttributesPatterns,
         });
       }
 
@@ -3442,7 +3455,12 @@ export class Extension extends ExtensionData {
 
     this.startupStates = new Set();
     this.state = "Not started";
-    this.userContextIsolation = lazy.userContextIsolation;
+    this.userContextIsolation =
+      lazy.userContextIsolation ||
+      Services.prefs.getIntPref(
+        `swell.spike.boundUserContext.${addonData.id}`,
+        -1
+      ) >= 0;
 
     this.sharedDataKeys = new Set();
 
@@ -3816,6 +3834,10 @@ export class Extension extends ExtensionData {
   // TODO bug 1699481: move this logic to WebExtensionPolicy
   canAccessContainer(userContextId) {
     userContextId = userContextId ?? 0; // firefox-default has userContextId as 0.
+    let bound = this.boundUserContextId;
+    if (bound >= 0) {
+      return userContextId === bound;
+    }
     let defaultRestrictedContainers = JSON.parse(
       lazy.userContextIsolationDefaultRestricted
     );
diff --git a/toolkit/components/extensions/ExtensionParent.sys.mjs b/toolkit/components/extensions/ExtensionParent.sys.mjs
index eb60945996e8..f3f16383d2fc 100644
--- a/toolkit/components/extensions/ExtensionParent.sys.mjs
+++ b/toolkit/components/extensions/ExtensionParent.sys.mjs
@@ -1763,6 +1763,10 @@ class HiddenExtensionPage {
         remote: this.extension.remote ? "true" : null,
         remoteType: this.extension.remoteType,
         initialBrowsingContextGroupId: this.extension.browsingContextGroupId,
+        usercontextid:
+          this.extension.boundUserContextId >= 0
+            ? this.extension.boundUserContextId
+            : null,
       });
     } catch (e) {
       SharedWindow.release();
diff --git a/toolkit/components/extensions/ExtensionScriptingStore.sys.mjs b/toolkit/components/extensions/ExtensionScriptingStore.sys.mjs
index 760407376a6b..a8013c5757a9 100644
--- a/toolkit/components/extensions/ExtensionScriptingStore.sys.mjs
+++ b/toolkit/components/extensions/ExtensionScriptingStore.sys.mjs
@@ -182,7 +182,7 @@ export const makeInternalContentScript = (
       jsPaths,
       matches: options.matches,
       matchOriginAsFallback: options.matchOriginAsFallback || false,
-      originAttributesPatterns: null,
+      originAttributesPatterns: extension.boundOriginAttributesPatterns,
       persistAcrossSessions: options.persistAcrossSessions,
       runAt: options.runAt || "document_idle",
       world: options.world || "ISOLATED",
diff --git a/toolkit/components/extensions/NativeManifests.sys.mjs b/toolkit/components/extensions/NativeManifests.sys.mjs
index 48d7d50cdec3..1a1dd5624981 100644
--- a/toolkit/components/extensions/NativeManifests.sys.mjs
+++ b/toolkit/components/extensions/NativeManifests.sys.mjs
@@ -144,7 +144,12 @@ export var NativeManifests = {
     }
     if (
       manifest.allowed_extensions &&
-      !manifest.allowed_extensions.includes(context.extension.id)
+      !manifest.allowed_extensions.includes(
+        Services.prefs.getStringPref(
+          `swell.spike.originalId.${context.extension.id}`,
+          context.extension.id
+        )
+      )
     ) {
       Cu.reportError(
         `This extension does not have permission to use native manifest ${path}`
diff --git a/toolkit/components/extensions/parent/ext-contentScripts.js b/toolkit/components/extensions/parent/ext-contentScripts.js
index a0778e86d347..23ab929f315b 100644
--- a/toolkit/components/extensions/parent/ext-contentScripts.js
+++ b/toolkit/components/extensions/parent/ext-contentScripts.js
@@ -108,6 +108,11 @@ class ContentScriptParent {
       );
     }
 
+    if (context.extension.boundOriginAttributesPatterns) {
+      options.originAttributesPatterns =
+        context.extension.boundOriginAttributesPatterns;
+    }
+
     const convertCodeToURL = (data, mime) => {
       const blob = new context.cloneScope.Blob(data, { type: mime });
       const blobURL = context.cloneScope.URL.createObjectURL(blob);
diff --git a/toolkit/components/extensions/parent/ext-cookies.js b/toolkit/components/extensions/parent/ext-cookies.js
index c812810cecbb..8b9b6eccc9eb 100644
--- a/toolkit/components/extensions/parent/ext-cookies.js
+++ b/toolkit/components/extensions/parent/ext-cookies.js
@@ -292,8 +292,19 @@ const oaFromDetails = (details, context, allowPattern) => {
 
   let isPrivate = context.incognito;
   let storeId = isPrivate ? PRIVATE_STORE : DEFAULT_STORE;
-  if (details.storeId) {
-    storeId = details.storeId;
+  let requestedStoreId = details.storeId;
+  const bound = context.extension.boundUserContextId;
+  if (bound >= 0) {
+    const boundStoreId = getCookieStoreIdForOriginAttributes({
+      userContextId: bound,
+    });
+    if (requestedStoreId && requestedStoreId != boundStoreId) {
+      throw new ExtensionError(`Cannot access ${requestedStoreId}`);
+    }
+    requestedStoreId = boundStoreId;
+  }
+  if (requestedStoreId) {
+    storeId = requestedStoreId;
     if (isDefaultCookieStoreId(storeId)) {
       isPrivate = false;
     } else if (isPrivateCookieStoreId(storeId)) {
@@ -549,6 +560,11 @@ this.cookies = class extends ExtensionAPIPersistent {
         let notify = (removed, cookie, cause) => {
           cookie.QueryInterface(Ci.nsICookie);
 
+          let bound = this.extension.boundUserContextId;
+          if (bound >= 0 && cookie.originAttributes.userContextId !== bound) {
+            return;
+          }
+
           if (this.extension.allowedOrigins.matchesCookie(cookie)) {
             fire.async({
               removed,
diff --git a/toolkit/components/extensions/parent/ext-userScripts.js b/toolkit/components/extensions/parent/ext-userScripts.js
index cd6c0e511255..b4a4a6b0dc56 100644
--- a/toolkit/components/extensions/parent/ext-userScripts.js
+++ b/toolkit/components/extensions/parent/ext-userScripts.js
@@ -24,7 +24,8 @@ var { ExtensionError } = ExtensionUtils;
  *        JSON API schema file).
  */
 class UserScriptParent {
-  constructor(details) {
+  constructor(details, extension) {
+    this.extension = extension;
     this.scriptId = details.scriptId;
     this.options = this._convertOptions(details);
   }
@@ -69,6 +70,11 @@ class UserScriptParent {
       );
     }
 
+    if (this.extension.boundOriginAttributesPatterns) {
+      options.originAttributesPatterns =
+        this.extension.boundOriginAttributesPatterns;
+    }
+
     return options;
   }
 
@@ -243,7 +249,7 @@ this.userScripts = class extends ExtensionAPI {
             }
           }
 
-          const userScript = new UserScriptParent(details);
+          const userScript = new UserScriptParent(details, context.extension);
           const { scriptId } = userScript;
 
           this.userScriptsMap.set(scriptId, userScript);
```

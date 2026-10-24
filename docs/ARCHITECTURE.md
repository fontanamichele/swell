# Swell — Architecture Spec

Draft v0.1 · 23 Oct 2026

## Goals and non-goals

We are building a minimal, open-source browser on Gecko with an Arc-style sidebar, where each space is a fully isolated account living in the same window. macOS and Linux ship first; Windows follows.

**Goals**

- **One window, many isolated spaces.** Each space has its own cookies, site storage, history, saved passwords and extensions. Switching spaces never leaks state between them. This is non-negotiable.
- **One concept, one place.** Pinned items exist only in the sidebar tree. There is no second bookmarks system, no Firefox toolbar, no duplicate settings.
- **Minimal UI.** Sidebar (Favorites, Pinned, Today), the page, and a command bar. Nothing else is visible by default.
- **Fast shell.** All state and logic live in a Rust core; the window UI only renders it.
- **Firefox add-on compatibility,** per space.
- **Open source** under MPL 2.0, with its own name and branding.

**Non-goals for v1**

- Windows builds (planned after v1; Gecko makes them low-cost).
- Mobile apps.
- AI features, Easels, Boosts and other Arc extras.
- A custom rendering engine. Gecko renders everything; Servo is not a v1 target.

## Reference model: what we learned from Arc

Arc (1.170.0, examined on macOS) is a native Swift app that treats Chromium purely as a renderer behind a small Objective-C bridge. We copy that architecture and its data model, not its code, assets or name.

| Arc finding | Evidence | What we do |
| --- | --- | --- |
| Native shell + engine framework | `MacOS/Arc` (Swift, SwiftUI) links `ArcCore.framework` (Chromium 156) | Rust core + thin UI on top of Gecko |
| Small engine bridge | 67 `Arc*` Obj-C classes imported from ArcCore (`ArcBrowserContext`, `ArcNavigation`, `ArcSessionTab`, …) | One narrow interface between core and engine |
| Feature modules on one state architecture | The Composable Architecture (TCA), about 50 feature bundles | Feature modules in the Rust core, one state store |
| One flat node tree for the sidebar | `StorableSidebar.json`: nodes with `parentID` / `childrenIds`, data = `tab` / `list` / `itemContainer` | Same model, owned by the core |
| Space → profile | Space `profile` = `default` or `custom(directoryBasename)` | Space → isolated identity |
| Two roots per space, Favorites per profile | `pinned` + `unpinned` containers; `topApps(profile)` roots | Same |
| One JSON file per state domain | 29 `Storable*.json` files | Versioned store per domain, written by the core |
| Encrypted sync | Firebase + `FirebaseSyncRemoteEncryptionClient`; per-item `lastChangeDate` / `lastChangedDevice` | End-to-end encrypted sync of the tree |
| Remote site-behavior config | `content.arc.net/web_content_behavior.json` (keep-alive, PiP, title cleanup) | Same pattern, own signed config |

**What we drop:** Arc's three parallel copies of the tree (app, Firebase, CloudKit), legacy-plus-new field pairs (`containerIDs` / `newContainerIDs`), and Favorites that never sync.

### Arc sidebar file format (for the importer)

- Dictionaries are encoded as flat arrays `[key1, value1, key2, value2, …]`.
- Live copy: `sidebar.containers[1]` with `items`, `spaces`, `topAppsContainerIDs`.
  Sync copies: `firebaseSyncState.syncData` (items wrapped as `{value, lastChangeDate, lastChangedDevice}`) and `sidebarSyncState` (CloudKit).
- Node: `{id, parentID, childrenIds, title, createdAt, isUnread, originatingDevice, data}`;
  `data` is one of `tab {savedURL, savedTitle, timeLastActiveAt, savedMuteStatus, …}`, `list {}` (folder, name in `title`), `itemContainer {containerType: spaceItems(spaceID) | topApps(profile)}`.
- Space: `{id, title, customInfo.iconType ({icon} or {emoji_v2, emoji}), profile ({default:true} or {custom:{_0:{directoryBasename, machineID}}}), newContainerIDs: [{unpinned…}, id, {pinned:{}}, id]}`.
- Space order: `firebaseSyncState.syncData.orderedSpaceIDs.value`. Timestamps: seconds since 2001-01-01 UTC.
- A working decoder exists: `tools/arc_sidebar.py`.

## System overview

**The Rust core owns all state; Gecko only renders and isolates.**

```
┌──────────────────────────────┐        ┌──────────────────────────────┐
│ Window UI (HTML, CSS, JS)    │        │ Engine bridge (JS)           │
│ sidebar, command bar, page   │        │ only code that creates tabs  │
└───────┬──────────────▲───────┘        └──────▲──────────────┬────────┘
   commands│        diffs│              open tab│   navigation │ events
┌───────▼──────────────┴────────────────────────┴──────────────▼────────┐
│ Rust core (UniFFI): model · store · history · logins · extensions ·   │
│ search · sync — all state; history/passwords/extensions per identity  │
└───────▲──────────────────────────────────────────────────────────────┘
        │ history + password lookups (P1–P3)          bridge creates tabs ▼
┌───────┴──────────────────────────────────────────────────────────────┐
│ Gecko (Firefox ESR + patches P1–P4)                                   │
│ Space A tabs (userContextId 1) │ Space B tabs (2) │ ext copies X~A,X~B │
│ network + cache partitioned per userContextId                        │
└──────────────────────────────────────────────────────────────────────┘
```

Only the engine bridge creates tabs, and every tab carries its space's `userContextId`, so Gecko keeps each space's network and storage apart while the core keeps everything else apart.

## Data model

Everything in the sidebar is one tree of nodes owned by the Rust core; it is the single source of truth for pinned items, and nothing else in the browser stores bookmarks.

| Entity | Fields | Notes |
| --- | --- | --- |
| `Identity` | `id`, `name`, `gecko_user_context_id`, `profile_dir_key` | One per space. Owns cookies, storage, history, passwords, extensions. |
| `Space` | `id`, `title`, `icon` (`Symbol(name)` or `Emoji(char)`), `theme`, `identity_id`, `pinned_root`, `today_root` | Exactly two roots, no legacy field pairs. |
| `Node` | `id`, `parent_id`, `children: Vec<NodeId>`, `created_at`, `updated_at`, `updated_by_device`, `kind` | Flat map `NodeId → Node`; order lives in `children`. |
| `NodeKind::Tab` | `url`, `title`, `custom_title?`, `icon?`, `last_active_at`, `muted` | A saved tab, pinned or in Today. |
| `NodeKind::Folder` | `title`, `collapsed` | Nests to any depth. |
| `NodeKind::Root` | `Pinned(SpaceId)`, `Today(SpaceId)`, `Favorites(IdentityId)` | Never shown as a row. |
| `Window` | `id`, `active_space`, `open_tabs: Vec<LiveTab>` | Live state; not synced. |

**Invariants** (checked on every write and on load)

- A node's `parent_id` and its parent's `children` always agree.
- Every node reaches exactly one root; no cycles.
- A tab under a space's roots may only be opened in that space's identity. The core enforces this; the UI cannot override it.
- Favorites belong to an identity, not a space, and sync like everything else.

**Persistence**

- One SQLite file per domain in the app profile (`sidebar.db`, `history-<identity>.db`, …): atomic writes, cheap partial updates, crash safety. (M1: identities, spaces and the node tree share `sidebar.db`, because creating a space writes its roots in one transaction.)
- Every record carries a schema `version`; migrations run in the core at startup.
- Timestamps are Unix epoch milliseconds.

## Per-space isolation

Each identity maps to one Gecko `userContextId` (a container). Tabs are only ever created with their space's `userContextId`; the default context 0 is reserved for internal pages and never holds web content.

| User state | Mechanism | Work |
| --- | --- | --- |
| Cookies, localStorage, IndexedDB, cache, service workers, HSTS, HTTP auth | Gecko origin attributes (`userContextId`) partition these natively | Config only |
| Site permissions | Pref `permissions.isolateBy.userContext = true` | Config only |
| History, incl. command bar and `:visited` colouring | Firefox history recording off; per-identity history store in the core; patch the visited-link service (`IHistory`) to ask the core with the document's `userContextId` | Patch P1, small |
| Downloads list | Per-identity list in the core | Ours |
| Form history and address/card autofill | Per-identity stores; patch the lookup to pass `userContextId` | Patch P2, small |
| Saved passwords | Per-identity login store in the core, plugged in as Firefox's login storage; lookups pass the tab's `userContextId` | Patch P3, medium |
| Extensions | One installed copy per space | Patch P4, large — main risk |

**Extensions: one copy per space**

1. Installing add-on `X` in space `S` verifies `X`'s Mozilla signature, then installs a derived copy with ID `X~S`. Each copy has its own background page, storage, settings and permissions.
2. P4 adds an `identity` to each extension's policy. A copy only injects content scripts, sees `webRequest`, `tabs`, `cookies`, `history` and `downloads` events, and lists windows/tabs for its own identity.
3. The copy's own network requests (background `fetch`, XHR) run with its identity's `userContextId`.
4. Updates: the core tracks the original listing and updates every copy together.
5. Native messaging: host manifests list the original ID; the lookup maps `X~S` back to `X` (open question whether desktop apps tolerate several copies).

Isolation is about state, not anonymity: spaces share IP and fingerprint.

## Rust core and its interface

| Crate | Owns |
| --- | --- |
| `core-model` | Entities, invariants, commands, change events |
| `core-store` | SQLite persistence, migrations, Arc importer |
| `core-history` | Per-identity visits, frecency, visited-link lookups |
| `core-logins` | Per-identity passwords, encrypted at rest with a key in the OS keychain |
| `core-extensions` | Per-space extension copies: derive, install, update, map IDs |
| `core-search` | Command-bar ranking |
| `core-sync` | Encrypted sync |
| `core-ffi` | The UniFFI surface; nothing else is exported |

```rust
// Commands: UI → core. Each returns quickly; effects arrive as events.
fn create_space(title: String, icon: Icon) -> SpaceId;
fn switch_space(window: WindowId, space: SpaceId);
fn pin_tab(window: WindowId, tab: LiveTabId, into: NodeId, index: u32);
fn move_node(node: NodeId, new_parent: NodeId, index: u32);
fn query_command_bar(space: SpaceId, text: String) -> Vec<Suggestion>;

// Engine reports: Gecko → core, sent by the engine bridge.
fn on_navigation(tab: LiveTabId, url: String, title: String, transition: Transition);
fn on_tab_closed(tab: LiveTabId);

// Events: core → UI and engine bridge, as small diffs.
trait CoreListener {
    fn on_tree_changed(&self, diff: TreeDiff);
    fn on_open_tab(&self, window: WindowId, user_context_id: u32, url: String);
}
```

- The core never imports Gecko types; it knows identities by `userContextId` only (keeps a future Servo engine possible).
- The engine bridge is the only JS allowed to create web content.
- The core runs on its own thread; the UI receives diffs, never the whole tree.

## Window UI

Our own window document replaces Firefox's `browser.xhtml` instead of hiding parts of it.

- Shows: sidebar (Favorites for the identity, Pinned tree, Today, space switcher), page area, command bar overlay, minimal top line on hover/focus.
- Removed, not hidden: tab strip, nav toolbar, bookmarks toolbar/menu/sidebar/Library, Firefox View, Pocket, Firefox accounts/Sync UI, Firefox's containers UI, `about:logins` (replaced by per-space passwords view).
- Kept, restyled: permission prompts, add-on install prompt, downloads panel (fed by the core), find bar, print, devtools.
- No framework at first (plain modules and DOM). Every interaction is a core command.
- Built as its own Gecko application (`swell/app`, not `browser/`), so Firefox's window code is absent rather than hidden. Its main window has windowtype `navigator:browser` so the engine's window lookups, Marionette and the test harness find it. See `docs/m1-findings.md`.

## Sync and encryption (after MVP)

End-to-end encrypted, self-hostable; per-record LWW with hybrid logical clocks; ordered tree-move log with cycle checks; tombstones until acknowledged; account key from a recovery phrase, one data key per identity; small open-source Rust server.

## Gecko fork strategy

- Our repo lives inside the Firefox tree (like Thunderbird's `comm/`); engine changes are a numbered patch queue on a Firefox ESR tag.
- Rebase once a year onto the new ESR; consider the 4-week train only when the queue is small.
- A change goes in `patches/` only if it can't be done in `app/` or `core/`.
- Artifact builds for UI work; full builds (with `sccache`) once P1–P4 or the core change.
- Release targets: macOS (arm64 + x86-64, signed, notarized), Linux x86-64/arm64 (tarball, Flatpak). Windows after v1.
- MPL 2.0; own name, logo, update server; Mozilla telemetry, Pocket, accounts and studies compiled out.

## Milestones

1. **M0 — Isolation spike.** Two containers in one window; one add-on installed twice as `X~A` and `X~B`. Exit: each copy has its own storage and sees only its own tabs and logins; memory cost measured.
2. **M1 — Skeleton browser.** *(Built; see `docs/m1-findings.md`.)* Own window replaces `browser.xhtml`; Rust core through UniFFI; sidebar tree, spaces, command bar. Exit: browse daily in two spaces with no Firefox UI visible; Arc importer works.
3. **M2 — Full isolation alpha (macOS, Linux).** P1–P3; isolation test suite in CI. Exit: suite passes; signed macOS build and Linux Flatpak.
4. **M3 — Sync.**
5. **M4 — Windows and public beta.**

## Risks and open questions

| Risk | Mitigation |
| --- | --- |
| P4 is bigger than planned | M0 first; hard exit criteria; fallback decided with the owner |
| An unlisted store stays shared | Isolation test suite, run on every patch |
| Patch queue grows | `patches/` rule; measure rebase cost; upstream |
| Memory with spaces × extensions | Measure in M0; unload idle copies |
| Build/CI cost | Artifact builds, `sccache`, prebuilt nightlies |

Open: native messaging with several copies (1Password, Bitwarden); add-ons that check their own ID; synchronous `:visited` lookups vs per-identity cache; branding; sync hosting.

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const {
  SwellCore,
  CoreListener,
  SuggestionKind,
  Transition,
  Icon,
  TreeOp,
  NodeKindView,
  NotFound,
  Invariant,
} = ChromeUtils.importESModule(
  "moz-src:///toolkit/components/uniffi-bindgen-gecko-js/components/generated/RustSwellCore.sys.mjs"
);
const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);

/**
 *
 */
class Recorder extends CoreListener {
  events = [];
  diffs = [];
  opened = [];

  onTreeChanged(diff) {
    this.events.push("tree");
    this.diffs.push(diff);
  }
  onSpacesChanged(spaces) {
    this.events.push(`spaces:${spaces.length}`);
  }
  onActiveSpaceChanged(window, space) {
    this.events.push(`active:${space}`);
  }
  onOpenTab(window, space, userContextId, url, liveTab, node) {
    this.events.push(`open:${liveTab}`);
    this.opened.push({ window, space, userContextId, url, liveTab, node });
  }
  onSelectTab(window, liveTab) {
    this.events.push(`select:${liveTab}`);
  }
  onCloseTab(window, liveTab) {
    this.events.push(`close:${liveTab}`);
  }
}

// Listener callbacks are fire-and-forget, so they arrive on a later tick.
const seen = (recorder, event) =>
  TestUtils.waitForCondition(
    () => recorder.events.includes(event),
    `waiting for ${event}`
  );

async function openCore() {
  const dir = PathUtils.join(
    PathUtils.tempDir,
    `swell-core-${Math.random().toString(36).slice(2)}`
  );
  registerCleanupFunction(() => IOUtils.remove(dir, { recursive: true }));
  const core = SwellCore.open(dir);
  const recorder = new Recorder();
  core.addListener(recorder);
  return { dir, core, recorder };
}

add_task(async function test_first_run_has_one_space_in_a_nonzero_container() {
  const { core } = await openCore();
  const spaces = await core.listSpaces();
  Assert.equal(spaces.length, 1);
  Assert.equal(spaces[0].title, "Personal");
  Assert.notEqual(spaces[0].userContextId, 0, "context 0 is never used");
  Assert.ok(spaces[0].icon instanceof Icon.Symbol);
});

add_task(async function test_open_url_asks_for_a_tab_in_the_spaces_container() {
  const { core, recorder } = await openCore();
  const a = (await core.listSpaces())[0];
  const bId = await core.createSpace("Work", new Icon.Emoji({ glyph: "W" }));
  const b = (await core.listSpaces()).find(s => s.id == bId);
  Assert.notEqual(a.userContextId, b.userContextId);

  await core.openWindow("w1");
  const liveA = await core.openUrl("w1", a.id, "https://a.test/");
  const liveB = await core.openUrl("w1", b.id, "https://b.test/");
  await seen(recorder, `open:${liveB}`);
  const opened = Object.fromEntries(recorder.opened.map(o => [o.liveTab, o]));
  Assert.equal(opened[liveA].userContextId, a.userContextId);
  Assert.equal(opened[liveB].userContextId, b.userContextId);
  Assert.ok(opened[liveA].node, "the event names the node");

  const insert = recorder.diffs[0].ops[0];
  Assert.ok(insert instanceof TreeOp.Inserted, "an insert was reported");
  Assert.ok(insert.node.kind instanceof NodeKindView.Tab);
  Assert.equal(insert.node.kind.url, "https://a.test/");
});

add_task(async function test_errors_are_typed() {
  const { core } = await openCore();
  const a = (await core.listSpaces())[0];
  await Assert.rejects(
    core.spaceTree("nope"),
    e => e instanceof NotFound,
    "unknown space"
  );
  const bId = await core.createSpace("Work", new Icon.Symbol({ name: "x" }));
  await core.openWindow("w1");
  const live = await core.openUrl("w1", a.id, "https://a.test/");
  await core.pinTab("w1", live, a.pinnedRoot, 0);
  const node = (await core.spaceTree(a.id)).children.find(
    c => c.parent == a.pinnedRoot
  ).ids[0];
  await Assert.rejects(
    core.openNode("w1", bId, node),
    e => e instanceof Invariant,
    "a tab cannot open in another identity"
  );
});

add_task(async function test_command_bar_state_and_persistence() {
  const { dir, core } = await openCore();
  const a = (await core.listSpaces())[0];
  await core.openWindow("w1");
  const live = await core.openUrl("w1", a.id, "https://mail.test/");
  await core.onNavigation(live, "https://mail.test/", "Mail", Transition.TYPED);
  await core.pinTab("w1", live, a.pinnedRoot, 0);
  const folder = await core.createFolder(a.pinnedRoot, "Work", 1);
  await core.setCollapsed(folder, true);

  const found = await core.queryCommandBar(a.id, "mail");
  Assert.equal(found[0].kind, SuggestionKind.PINNED);
  Assert.ok(found[0].isOpen);
  Assert.equal(found[1].kind, SuggestionKind.SEARCH);
  const typed = await core.queryCommandBar(a.id, "example.com");
  Assert.equal(typed[0].kind, SuggestionKind.URL);

  const reopened = SwellCore.open(dir);
  const tree = await reopened.spaceTree(a.id);
  const roots = tree.children.find(c => c.parent == a.pinnedRoot).ids;
  Assert.equal(roots.length, 2, "pinned tab and folder survive a reopen");
  Assert.equal(await reopened.lastActiveSpace(), a.id);
});

add_task(async function test_site_zoom_is_per_identity_and_survives_reopen() {
  const dir = await IOUtils.createUniqueDirectory(
    PathUtils.tempDir,
    "swell-zoom"
  );
  let core = SwellCore.open(dir);
  const a = (await core.listSpaces())[0];
  const bId = await core.createSpace("B", new Icon.Symbol({ name: "star" }));
  const b = (await core.listSpaces()).find(space => space.id == bId);
  Assert.notEqual(a.userContextId, b.userContextId);

  Assert.equal(await core.siteZoom(a.id, "example.com"), 1, "default zoom");
  await core.setSiteZoom(a.id, "example.com", 1.5);
  Assert.equal(await core.siteZoom(a.id, "example.com"), 1.5);
  Assert.equal(await core.siteZoom(b.id, "example.com"), 1, "other identity");
  Assert.equal(await core.siteZoom(a.id, "other.test"), 1, "other host");

  await core.setSiteZoom(a.id, "huge.test", 50);
  Assert.equal(await core.siteZoom(a.id, "huge.test"), 5, "limited to 500%");

  core = SwellCore.open(dir);
  Assert.equal(await core.siteZoom(a.id, "example.com"), 1.5, "after reopen");
  await core.setSiteZoom(a.id, "example.com", 1);
  Assert.equal(await core.siteZoom(a.id, "example.com"), 1, "1 forgets it");
  await Assert.rejects(
    core.setSiteZoom("no-such-space", "example.com", 2),
    NotFound
  );
});

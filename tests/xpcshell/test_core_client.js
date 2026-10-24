/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { CoreClient, SwellCore, Icon, Invariant } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/Core.sys.mjs"
);
const { TestUtils } = ChromeUtils.importESModule(
  "resource://testing-common/TestUtils.sys.mjs"
);

function newClient() {
  const dir = PathUtils.join(
    PathUtils.tempDir,
    `swell-client-${Math.random().toString(36).slice(2)}`
  );
  registerCleanupFunction(() => IOUtils.remove(dir, { recursive: true }));
  return new CoreClient(SwellCore.open(dir));
}

add_task(async function test_commands_run_in_the_order_they_were_issued() {
  const client = newClient();
  const [space] = await client.listSpaces();
  // Each folder's index is the number of folders before it, so the core
  // rejects the later calls if they overtake the earlier ones.
  const created = [
    client.createFolder(space.pinnedRoot, "a", 0),
    client.createFolder(space.pinnedRoot, "b", 1),
    client.createFolder(space.pinnedRoot, "c", 2),
  ];
  const ids = await Promise.all(created);
  const tree = await client.spaceTree(space.id);
  const children = tree.children.find(c => c.parent == space.pinnedRoot).ids;
  Assert.deepEqual(children, ids, "folders are in the order they were issued");
});

add_task(async function test_a_failed_command_does_not_stop_the_queue() {
  const client = newClient();
  const [space] = await client.listSpaces();
  const bad = client.createFolder(space.pinnedRoot, "x", 99);
  const good = client.createFolder(space.pinnedRoot, "y", 0);
  await Assert.rejects(bad, e => e instanceof Invariant, "bad index rejected");
  Assert.ok(await good, "the next command still ran");
});

add_task(
  async function test_subscribers_see_tree_changes_and_can_unsubscribe() {
    const client = newClient();
    const [space] = await client.listSpaces();
    const diffs = [];
    const off = client.on("treeChanged", diff => diffs.push(diff));
    await client.createFolder(space.pinnedRoot, "one", 0);
    await TestUtils.waitForCondition(() => diffs.length == 1, "first diff");
    off();
    await client.createFolder(space.pinnedRoot, "two", 1);
    await client.settled();
    await new Promise(resolve => executeSoon(resolve));
    Assert.equal(diffs.length, 1, "no events after unsubscribing");
    Assert.throws(() => client.on("nope", () => {}), /Unknown core event/);
  }
);

add_task(async function test_spaces_changed_reaches_subscribers() {
  const client = newClient();
  const seen = [];
  client.on("spacesChanged", spaces => seen.push(spaces.length));
  await client.createSpace("Work", new Icon.Symbol({ name: "briefcase" }));
  await TestUtils.waitForCondition(() => seen.length == 1, "spaces event");
  Assert.deepEqual(seen, [2]);
});

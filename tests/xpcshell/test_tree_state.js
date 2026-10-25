/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const { NodeKindView, NodeView, TreeOp, TreeDiff, TreeSnapshot, ChildList } =
  ChromeUtils.importESModule("moz-src:///swell/app/modules/Core.sys.mjs");
const { TreeState } = ChromeUtils.importESModule(
  "moz-src:///swell/app/modules/TreeState.sys.mjs"
);

const tab = (id, title = id) =>
  new NodeView({
    id,
    kind: new NodeKindView.Tab({
      url: `https://${id}.test/`,
      title,
      customTitle: null,
      icon: null,
      muted: false,
    }),
    updatedAt: 1,
  });
const folder = (id, collapsed = false) =>
  new NodeView({
    id,
    kind: new NodeKindView.Folder({ title: id, collapsed }),
    updatedAt: 1,
  });
const diff = (...ops) => new TreeDiff({ ops });
const ids = (state, parent) => state.childrenOf(parent);

function sample() {
  // pinned: [f1: [a, b], c]   today: [d]
  const state = new TreeState();
  state.load(
    new TreeSnapshot({
      nodes: [folder("f1"), tab("a"), tab("b"), tab("c"), tab("d")],
      children: [
        new ChildList({ parent: "pinned", ids: ["f1", "c"] }),
        new ChildList({ parent: "f1", ids: ["a", "b"] }),
        new ChildList({ parent: "today", ids: ["d"] }),
      ],
    })
  );
  return state;
}

add_task(function test_load_and_rows() {
  const state = sample();
  Assert.deepEqual(
    state.rows("pinned").map(r => [r.id, r.depth]),
    [
      ["f1", 0],
      ["a", 1],
      ["b", 1],
      ["c", 0],
    ]
  );
  Assert.equal(state.parent("a"), "f1");
  Assert.ok(state.isFolder("f1"));
  Assert.ok(!state.isFolder("a"));
});

add_task(function test_collapsed_folders_hide_their_children() {
  const state = sample();
  state.apply(diff(new TreeOp.Updated({ node: folder("f1", true) })));
  Assert.deepEqual(
    state.rows("pinned").map(r => r.id),
    ["f1", "c"]
  );
});

add_task(function test_diffs_insert_move_remove_update() {
  const state = sample();
  state.apply(
    diff(new TreeOp.Inserted({ node: tab("e"), parent: "today", index: 0 }))
  );
  Assert.deepEqual(ids(state, "today"), ["e", "d"]);

  state.apply(diff(new TreeOp.Moved({ id: "e", parent: "f1", index: 1 })));
  Assert.deepEqual(ids(state, "today"), ["d"]);
  Assert.deepEqual(ids(state, "f1"), ["a", "e", "b"]);
  Assert.equal(state.parent("e"), "f1");

  state.apply(diff(new TreeOp.Removed({ id: "f1" })));
  Assert.deepEqual(ids(state, "pinned"), ["c"]);
  for (const gone of ["f1", "a", "b", "e"]) {
    Assert.equal(
      state.node(gone),
      undefined,
      `${gone} is gone with its folder`
    );
  }

  state.apply(diff(new TreeOp.Updated({ node: tab("c", "Renamed") })));
  Assert.equal(state.node("c").kind.title, "Renamed");
});

add_task(function test_a_new_folder_can_receive_children() {
  const state = sample();
  state.apply(
    diff(
      new TreeOp.Inserted({ node: folder("f2"), parent: "pinned", index: 2 })
    )
  );
  Assert.deepEqual(ids(state, "f2"), []);
  state.apply(diff(new TreeOp.Moved({ id: "d", parent: "f2", index: 0 })));
  Assert.deepEqual(ids(state, "f2"), ["d"]);
});

add_task(function test_drop_targets() {
  const state = sample();
  const tabsOnly = new Set(["today"]);
  const drop = (dragged, target, where) =>
    state.dropTarget({ dragged, target, where, tabsOnly });

  Assert.deepEqual(
    drop("d", "c", "before"),
    { parent: "pinned", index: 1 },
    "pin before c"
  );
  Assert.deepEqual(
    drop("d", "f1", "inside"),
    { parent: "f1", index: 2 },
    "into a folder, at the end"
  );
  Assert.deepEqual(drop("c", "a", "before"), { parent: "f1", index: 0 });

  // Within one list the index is the position after the node is lifted out.
  Assert.deepEqual(drop("f1", "c", "after"), { parent: "pinned", index: 1 });
  Assert.equal(drop("c", "c", "before"), null, "onto itself");
  Assert.equal(drop("f1", "c", "before"), null, "already there");
  Assert.equal(drop("a", "b", "before"), null, "already right before b");
});

add_task(function test_invalid_drops_are_refused() {
  const state = sample();
  const tabsOnly = new Set(["today"]);
  const drop = (dragged, target, where) =>
    state.dropTarget({ dragged, target, where, tabsOnly });
  Assert.equal(
    drop("f1", "a", "before"),
    null,
    "a folder cannot go into itself"
  );
  Assert.equal(drop("f1", "f1", "inside"), null);
  Assert.equal(drop("f1", "d", "after"), null, "Today holds tabs only");
  Assert.equal(drop("c", "a", "inside"), null, "a tab is not a drop container");
  Assert.equal(drop("nope", "c", "before"), null, "unknown node");
});

add_task(function test_dropping_into_an_empty_list() {
  const state = sample();
  state.apply(diff(new TreeOp.Removed({ id: "d" })));
  Assert.deepEqual(
    state.dropTarget({
      dragged: "c",
      target: "today",
      where: "inside",
      tabsOnly: new Set(["today"]),
    }),
    { parent: "today", index: 0 }
  );
});

add_task(function test_a_collapsed_folder_keeps_its_open_pages() {
  const state = sample();
  state.apply(diff(new TreeOp.Updated({ node: folder("f1", true) })));
  const rows = isOpen => state.rows("pinned", isOpen).map(r => [r.id, r.depth]);

  Assert.deepEqual(rows(), [
    ["f1", 0],
    ["c", 0],
  ]);
  Assert.deepEqual(
    rows(id => id == "b"),
    [
      ["f1", 0],
      ["b", 1],
      ["c", 0],
    ],
    "an open page stays under the collapsed folder"
  );

  state.apply(
    diff(
      new TreeOp.Inserted({ node: folder("f2"), parent: "f1", index: 2 }),
      new TreeOp.Inserted({ node: tab("e"), parent: "f2", index: 0 })
    )
  );
  Assert.deepEqual(
    rows(id => id == "a" || id == "e" || id == "f2"),
    [
      ["f1", 0],
      ["a", 1],
      ["e", 1],
      ["c", 0],
    ],
    "pages of nested folders are listed flat, and folders are never open pages"
  );
});

add_task(function test_planning_moves_of_several_nodes() {
  const state = sample();
  const tabsOnly = new Set(["today"]);
  const plan = (dragged, target, where) =>
    state.planMoves({ dragged, target, where, tabsOnly });

  Assert.deepEqual(
    plan(["c", "d"], "a", "before"),
    [
      { id: "c", parent: "f1", index: 0 },
      { id: "d", parent: "f1", index: 1 },
    ],
    "they land before a, in order"
  );
  Assert.deepEqual(
    plan(["c", "d"], "f1", "inside"),
    [
      { id: "c", parent: "f1", index: 2 },
      { id: "d", parent: "f1", index: 3 },
    ],
    "they land at the end of the folder, in order"
  );
  Assert.deepEqual(
    plan(["a", "b"], "c", "after"),
    [
      { id: "a", parent: "pinned", index: 2 },
      { id: "b", parent: "pinned", index: 3 },
    ],
    "they leave a folder together"
  );
  Assert.deepEqual(
    plan(["b"], "f1", "inside"),
    null,
    "already at the end of the folder"
  );
  Assert.equal(plan(["a", "b"], "b", "before"), null, "onto one of them");
  Assert.equal(plan(["a", "f1"], "b", "before"), null, "into a dragged folder");
  Assert.equal(plan(["c", "f1"], "d", "after"), null, "Today holds tabs only");
  Assert.equal(plan([], "c", "before"), null, "nothing to move");
  Assert.equal(plan(["a", "nope"], "c", "before"), null, "unknown node");
});

add_task(function test_describe_gives_plain_objects() {
  const state = sample();
  Assert.deepEqual(state.describe("f1"), {
    kind: "folder",
    id: "f1",
    title: "f1",
    collapsed: false,
  });
  Assert.deepEqual(state.describe("a"), {
    kind: "tab",
    id: "a",
    url: "https://a.test/",
    title: "a",
    icon: null,
  });
  state.apply(
    diff(
      new TreeOp.Updated({
        node: new NodeView({
          id: "a",
          kind: new NodeKindView.Tab({
            url: "https://a.test/",
            title: "A",
            customTitle: "Mine",
            icon: null,
            muted: false,
          }),
          updatedAt: 2,
        }),
      })
    )
  );
  Assert.equal(state.describe("a").title, "Mine", "a custom title wins");
  Assert.equal(state.describe("nope"), null);
});

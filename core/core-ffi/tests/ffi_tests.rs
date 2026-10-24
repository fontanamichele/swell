/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use core_ffi::*;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

#[derive(Default)]
struct Recorder {
    events: Mutex<Vec<String>>,
    diffs: Mutex<Vec<TreeDiff>>,
    opened: Mutex<Vec<(String, u32, String, String)>>,
    nodes: Mutex<Vec<String>>,
}

impl Recorder {
    fn log(&self, event: String) {
        self.events.lock().unwrap().push(event);
    }

    fn events(&self) -> Vec<String> {
        self.events.lock().unwrap().clone()
    }
}

impl CoreListener for Recorder {
    fn on_tree_changed(&self, diff: TreeDiff) {
        self.log(format!("tree:{}", diff.ops.len()));
        self.diffs.lock().unwrap().push(diff);
    }

    fn on_spaces_changed(&self, spaces: Vec<SpaceView>) {
        self.log(format!("spaces:{}", spaces.len()));
    }

    fn on_active_space_changed(&self, _window: String, space: String) {
        self.log(format!("active:{space}"));
    }

    fn on_open_tab(
        &self,
        window: String,
        space: String,
        user_context_id: u32,
        url: String,
        live_tab: String,
        node: String,
    ) {
        self.log(format!("open:{live_tab}"));
        self.opened
            .lock()
            .unwrap()
            .push((window, user_context_id, url, space));
        self.nodes.lock().unwrap().push(node);
    }

    fn on_select_tab(&self, _window: String, live_tab: String) {
        self.log(format!("select:{live_tab}"));
    }

    fn on_close_tab(&self, _window: String, live_tab: String) {
        self.log(format!("close:{live_tab}"));
    }
}

struct Forward(Arc<Recorder>);

impl CoreListener for Forward {
    fn on_tree_changed(&self, diff: TreeDiff) {
        self.0.on_tree_changed(diff)
    }

    fn on_spaces_changed(&self, spaces: Vec<SpaceView>) {
        self.0.on_spaces_changed(spaces)
    }

    fn on_active_space_changed(&self, window: String, space: String) {
        self.0.on_active_space_changed(window, space)
    }

    fn on_open_tab(
        &self,
        window: String,
        space: String,
        user_context_id: u32,
        url: String,
        live_tab: String,
        node: String,
    ) {
        self.0
            .on_open_tab(window, space, user_context_id, url, live_tab, node)
    }

    fn on_select_tab(&self, window: String, live_tab: String) {
        self.0.on_select_tab(window, live_tab)
    }

    fn on_close_tab(&self, window: String, live_tab: String) {
        self.0.on_close_tab(window, live_tab)
    }
}

struct Fixture {
    dir: tempfile::TempDir,
    core: Arc<SwellCore>,
    recorder: Arc<Recorder>,
}

fn open(dir: tempfile::TempDir) -> Fixture {
    let core = SwellCore::open(dir.path().to_string_lossy().into_owned()).unwrap();
    let recorder = Arc::new(Recorder::default());
    core.add_listener(Box::new(Forward(recorder.clone())));
    Fixture {
        dir,
        core,
        recorder,
    }
}

fn fixture() -> Fixture {
    open(tempfile::tempdir().unwrap())
}

fn reopen(f: Fixture) -> Fixture {
    let Fixture { dir, core, .. } = f;
    drop(core);
    open(dir)
}

fn first_space(core: &SwellCore) -> SpaceView {
    core.list_spaces().unwrap().remove(0)
}

fn snapshot_ids(core: &SwellCore, root: &str, space: &str) -> Vec<String> {
    let tree = core.space_tree(space.into()).unwrap();
    tree.children
        .iter()
        .find(|c| c.parent == root)
        .unwrap()
        .ids
        .clone()
}

#[test]
fn first_run_creates_one_personal_space_with_a_nonzero_container() {
    let f = fixture();
    let spaces = f.core.list_spaces().unwrap();
    assert_eq!(spaces.len(), 1);
    assert_eq!(spaces[0].title, "Personal");
    assert_ne!(spaces[0].user_context_id, 0);
    assert_eq!(
        f.core.last_active_space().unwrap().as_deref(),
        Some(spaces[0].id.as_str())
    );
    let f = reopen(f);
    assert_eq!(
        f.core.list_spaces().unwrap(),
        spaces,
        "second run keeps the same space"
    );
}

#[test]
fn two_spaces_have_distinct_containers() {
    let f = fixture();
    let b = f
        .core
        .create_space("Work".into(), Icon::Emoji { glyph: "W".into() })
        .unwrap();
    let spaces = f.core.list_spaces().unwrap();
    assert_eq!(spaces.len(), 2);
    assert_ne!(spaces[0].user_context_id, spaces[1].user_context_id);
    assert_eq!(spaces[1].id, b);
    assert!(f.recorder.events().contains(&"spaces:2".to_owned()));
}

#[test]
fn open_url_asks_the_bridge_for_a_tab_in_the_spaces_container() {
    let f = fixture();
    let a = first_space(&f.core);
    let b_id = f
        .core
        .create_space("Work".into(), Icon::Symbol { name: "x".into() })
        .unwrap();
    let b = f
        .core
        .list_spaces()
        .unwrap()
        .into_iter()
        .find(|s| s.id == b_id)
        .unwrap();
    f.core.open_window("w1".into()).unwrap();
    let live_a = f
        .core
        .open_url("w1".into(), a.id.clone(), "https://a.test/".into())
        .unwrap();
    let live_b = f
        .core
        .open_url("w1".into(), b.id.clone(), "https://b.test/".into())
        .unwrap();
    assert_ne!(live_a, live_b);
    let opened = f.recorder.opened.lock().unwrap().clone();
    assert_eq!(
        opened[0],
        (
            "w1".into(),
            a.user_context_id,
            "https://a.test/".into(),
            a.id.clone()
        )
    );
    let nodes = f.recorder.nodes.lock().unwrap().clone();
    assert_eq!(
        nodes[0],
        snapshot_ids(&f.core, &a.today_root, &a.id)[0],
        "the event names the node"
    );
    assert_eq!(
        opened[1],
        (
            "w1".into(),
            b.user_context_id,
            "https://b.test/".into(),
            b.id.clone()
        )
    );
    assert_ne!(opened[0].1, opened[1].1);
    assert_eq!(snapshot_ids(&f.core, &a.today_root, &a.id).len(), 1);
    assert_eq!(snapshot_ids(&f.core, &b.today_root, &b.id).len(), 1);
}

#[test]
fn navigation_pin_and_close_follow_the_rules_and_persist() {
    let f = fixture();
    let space = first_space(&f.core);
    f.core.open_window("w1".into()).unwrap();
    let live = f
        .core
        .open_url("w1".into(), space.id.clone(), "https://a.test/".into())
        .unwrap();
    f.core
        .on_navigation(
            live.clone(),
            "https://a.test/next".into(),
            "Next".into(),
            Transition::Link,
        )
        .unwrap();
    f.core
        .pin_tab("w1".into(), live.clone(), space.pinned_root.clone(), 0)
        .unwrap();
    assert_eq!(snapshot_ids(&f.core, &space.today_root, &space.id).len(), 0);
    let pinned = snapshot_ids(&f.core, &space.pinned_root, &space.id);
    assert_eq!(pinned.len(), 1);

    f.core.on_tab_closed(live).unwrap();
    assert_eq!(
        snapshot_ids(&f.core, &space.pinned_root, &space.id),
        pinned,
        "a pinned node stays"
    );

    let live2 = f
        .core
        .open_url("w1".into(), space.id.clone(), "https://b.test/".into())
        .unwrap();
    f.core.on_tab_closed(live2).unwrap();
    assert_eq!(
        snapshot_ids(&f.core, &space.today_root, &space.id).len(),
        0,
        "a Today node goes"
    );

    let f = reopen(f);
    let tree = f.core.space_tree(space.id.clone()).unwrap();
    let node = tree.nodes.iter().find(|n| n.id == pinned[0]).unwrap();
    match &node.kind {
        NodeKindView::Tab { url, title, .. } => {
            assert_eq!(url, "https://a.test/next");
            assert_eq!(title, "Next");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn folders_move_rename_collapse_and_removal_closes_open_tabs() {
    let f = fixture();
    let space = first_space(&f.core);
    f.core.open_window("w1".into()).unwrap();
    let folder = f
        .core
        .create_folder(space.pinned_root.clone(), "Work".into(), 0)
        .unwrap();
    f.core
        .rename_node(folder.clone(), "Projects".into())
        .unwrap();
    f.core.set_collapsed(folder.clone(), true).unwrap();
    let live = f
        .core
        .open_url("w1".into(), space.id.clone(), "https://a.test/".into())
        .unwrap();
    f.core
        .pin_tab("w1".into(), live.clone(), folder.clone(), 0)
        .unwrap();
    let tree = f.core.space_tree(space.id.clone()).unwrap();
    assert!(tree.nodes.iter().any(|n| n.id == folder
        && n.kind
            == NodeKindView::Folder {
                title: "Projects".into(),
                collapsed: true
            }));

    f.core.remove_node(folder).unwrap();
    assert!(f.recorder.events().contains(&format!("close:{live}")));
    assert!(f
        .core
        .space_tree(space.id.clone())
        .unwrap()
        .nodes
        .is_empty());
}

#[test]
fn engine_opened_tabs_are_recorded_without_asking_the_bridge_to_open_them() {
    let f = fixture();
    let space = first_space(&f.core);
    f.core.open_window("w1".into()).unwrap();
    let opened = f
        .core
        .on_tab_opened("w1".into(), space.id.clone(), "https://popup.test/".into())
        .unwrap();
    let live = opened.live_tab.clone();
    assert_eq!(
        snapshot_ids(&f.core, &space.today_root, &space.id),
        vec![opened.node.clone()]
    );
    assert!(
        f.recorder.opened.lock().unwrap().is_empty(),
        "no on_open_tab for an engine-opened tab"
    );
    f.core
        .on_favicon(live.clone(), Some("https://popup.test/icon.png".into()))
        .unwrap();
    let node = snapshot_ids(&f.core, &space.today_root, &space.id).remove(0);
    let tree = f.core.space_tree(space.id.clone()).unwrap();
    match &tree.nodes.iter().find(|n| n.id == node).unwrap().kind {
        NodeKindView::Tab { icon, .. } => {
            assert_eq!(icon.as_deref(), Some("https://popup.test/icon.png"))
        }
        other => panic!("{other:?}"),
    }
    f.core.on_favicon(live, None).unwrap();
}

#[test]
fn a_tab_cannot_open_in_another_identity() {
    let f = fixture();
    let a = first_space(&f.core);
    let b_id = f
        .core
        .create_space("Work".into(), Icon::Symbol { name: "x".into() })
        .unwrap();
    f.core.open_window("w1".into()).unwrap();
    let live = f
        .core
        .open_url("w1".into(), a.id.clone(), "https://a.test/".into())
        .unwrap();
    f.core
        .pin_tab("w1".into(), live, a.pinned_root.clone(), 0)
        .unwrap();
    let node = snapshot_ids(&f.core, &a.pinned_root, &a.id).remove(0);
    let err = f.core.open_node("w1".into(), b_id, node).unwrap_err();
    assert!(matches!(err, CoreError::Invariant { .. }), "{err:?}");
}

#[test]
fn opening_an_open_node_selects_it_instead() {
    let f = fixture();
    let space = first_space(&f.core);
    f.core.open_window("w1".into()).unwrap();
    let live = f
        .core
        .open_url("w1".into(), space.id.clone(), "https://a.test/".into())
        .unwrap();
    let node = snapshot_ids(&f.core, &space.today_root, &space.id).remove(0);
    let again = f
        .core
        .open_node("w1".into(), space.id.clone(), node)
        .unwrap();
    assert_eq!(again, live);
    assert!(f.recorder.events().contains(&format!("select:{live}")));
}

#[test]
fn the_command_bar_finds_saved_tabs_and_offers_search() {
    let f = fixture();
    let space = first_space(&f.core);
    f.core.open_window("w1".into()).unwrap();
    let live = f
        .core
        .open_url("w1".into(), space.id.clone(), "https://mail.test/".into())
        .unwrap();
    f.core
        .on_navigation(
            live.clone(),
            "https://mail.test/".into(),
            "Mail".into(),
            Transition::Typed,
        )
        .unwrap();
    f.core
        .pin_tab("w1".into(), live, space.pinned_root.clone(), 0)
        .unwrap();
    let found = f
        .core
        .query_command_bar(space.id.clone(), "mail".into())
        .unwrap();
    assert_eq!(found[0].kind, SuggestionKind::Pinned);
    assert!(found[0].is_open);
    assert_eq!(found[1].kind, SuggestionKind::Search);
    assert!(found[1]
        .url
        .starts_with("https://www.google.com/search?q=mail"));
    let typed = f
        .core
        .query_command_bar(space.id.clone(), "example.com".into())
        .unwrap();
    assert_eq!(typed[0].kind, SuggestionKind::Url);
}

#[test]
fn switching_spaces_is_remembered() {
    let f = fixture();
    let b = f
        .core
        .create_space("Work".into(), Icon::Symbol { name: "x".into() })
        .unwrap();
    f.core.open_window("w1".into()).unwrap();
    f.core.switch_space("w1".into(), b.clone()).unwrap();
    assert!(f.recorder.events().contains(&format!("active:{b}")));
    let f = reopen(f);
    assert_eq!(f.core.last_active_space().unwrap(), Some(b));
}

#[test]
fn closing_stops_events_but_not_commands() {
    let f = fixture();
    let space = first_space(&f.core);
    f.core.open_window("w1".into()).unwrap();
    f.core
        .create_folder(space.pinned_root.clone(), "before".into(), 0)
        .unwrap();
    let seen = f.recorder.events().len();
    assert!(seen > 0);
    f.core.close();
    f.core
        .create_folder(space.pinned_root.clone(), "after".into(), 1)
        .unwrap();
    assert_eq!(f.recorder.events().len(), seen, "no events after close");
    assert_eq!(
        snapshot_ids(&f.core, &space.pinned_root, &space.id).len(),
        2,
        "commands still work"
    );
}

#[test]
fn unknown_ids_are_not_found_errors() {
    let f = fixture();
    assert!(matches!(
        f.core.space_tree("nope".into()),
        Err(CoreError::NotFound { .. })
    ));
    assert!(matches!(
        f.core.open_url(
            "nowindow".into(),
            first_space(&f.core).id,
            "https://a.test/".into()
        ),
        Err(CoreError::NotFound { .. })
    ));
}

#[test]
fn importing_arc_adds_spaces_and_persists() {
    let f = fixture();
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../core-store/tests/fixtures/arc_sidebar_synthetic.json");
    let report = f
        .core
        .import_arc(path.to_string_lossy().into_owned())
        .unwrap();
    assert_eq!(report.spaces, 3);
    assert_eq!(
        f.core.list_spaces().unwrap().len(),
        4,
        "Personal plus the three imported"
    );
    assert!(f.recorder.events().contains(&"spaces:4".to_owned()));
    let f = reopen(f);
    assert_eq!(f.core.list_spaces().unwrap().len(), 4);
    let bad = f
        .core
        .import_arc("/nonexistent/StorableSidebar.json".into());
    assert!(matches!(bad, Err(CoreError::Import { .. })));
}

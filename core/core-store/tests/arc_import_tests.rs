/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use core_model::*;
use core_store::{import_arc_file, import_arc_str, ImportError, Store};
use std::path::PathBuf;
use std::process::Command;

struct TestEnv(u64);

impl Env for TestEnv {
    fn now_ms(&self) -> i64 {
        1
    }

    fn new_id(&mut self) -> String {
        self.0 += 1;
        format!("n{:04}", self.0)
    }
}

fn fixture() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/arc_sidebar_synthetic.json")
}

fn imported() -> (Model, core_store::ImportReport) {
    let mut model = Model::new(Box::new(TestEnv(0)), "dev");
    let report = import_arc_file(&mut model, &fixture()).unwrap();
    (model, report)
}

fn space_by_title(m: &Model, title: &str) -> Space {
    m.spaces().into_iter().find(|s| s.title == title).unwrap()
}

#[test]
fn counts_order_and_warnings() {
    let (m, report) = imported();
    m.validate().unwrap();
    assert_eq!(report.spaces, 3);
    assert_eq!(report.identities, 2);
    assert_eq!(report.folders, 3);
    assert_eq!(report.tabs, 10);
    assert_eq!(report.favorites, 3);
    let titles: Vec<_> = m.spaces().into_iter().map(|s| s.title).collect();
    assert_eq!(
        titles,
        ["Home", "Work", "Client"],
        "orderedSpaceIDs first, the rest after"
    );
    let warnings = report.warnings.join("\n");
    assert_eq!(report.warnings.len(), 4, "{warnings}");
    for expected in ["missing-id", "easel", "s1-t-empty", "s2-f-today"] {
        assert!(
            warnings.contains(expected),
            "no warning mentions {expected}: {warnings}"
        );
    }
}

#[test]
fn spaces_on_one_arc_profile_share_an_identity() {
    let (m, _) = imported();
    let home = space_by_title(&m, "Home");
    let work = space_by_title(&m, "Work");
    let client = space_by_title(&m, "Client");
    assert_eq!(home.identity_id, work.identity_id);
    assert_ne!(home.identity_id, client.identity_id);
    let names: Vec<_> = m.identities().into_iter().map(|i| i.name).collect();
    assert!(names.contains(&"Default".to_owned()) && names.contains(&"Profile 1".to_owned()));
    for identity in m.identities() {
        assert_ne!(identity.gecko_user_context_id, 0);
    }
}

#[test]
fn icons_titles_and_timestamps_are_mapped() {
    let (m, _) = imported();
    assert_eq!(
        space_by_title(&m, "Work").icon,
        Icon::Emoji("\u{1f4bc}".into())
    );
    assert_eq!(
        space_by_title(&m, "Home").icon,
        Icon::Symbol("house".into())
    );
    let tabs: Vec<(Node, TabData)> = m
        .nodes()
        .into_iter()
        .filter_map(|n| match n.kind.clone() {
            NodeKind::Tab(t) => Some((n, t)),
            _ => None,
        })
        .collect();
    let drive = tabs
        .iter()
        .find(|(_, t)| t.url == "https://drive.example.test/")
        .unwrap();
    assert_eq!(drive.1.title, "Drive");
    assert_eq!(drive.1.custom_title.as_deref(), Some("My Drive"));
    let doc = tabs
        .iter()
        .find(|(_, t)| t.url == "https://docs.example.test/a")
        .unwrap();
    assert_eq!(doc.1.custom_title, None);
    assert_eq!(doc.0.created_at, (700_000_000 + 978_307_200) * 1000);
    assert_eq!(doc.1.last_active_at, (700_000_100 + 978_307_200) * 1000);
}

#[test]
fn favorites_follow_their_profile_and_stray_folders_are_flattened() {
    let (m, _) = imported();
    let work = space_by_title(&m, "Work");
    let client = space_by_title(&m, "Client");
    let urls = |root: &NodeId| -> Vec<String> {
        m.children(root)
            .unwrap()
            .iter()
            .map(|id| match &m.node(id).unwrap().kind {
                NodeKind::Tab(t) => t.url.clone(),
                other => panic!("expected a tab, found {other:?}"),
            })
            .collect()
    };
    let default_favorites = m.favorites_root(&work.identity_id).unwrap().id.clone();
    let client_favorites = m.favorites_root(&client.identity_id).unwrap().id.clone();
    assert_eq!(
        urls(&default_favorites),
        ["https://fav1.example.test/", "https://fav2.example.test/"]
    );
    assert_eq!(urls(&client_favorites), ["https://favc.example.test/"]);
    let home = space_by_title(&m, "Home");
    assert_eq!(urls(&home.today_root), ["https://stray.example.test/"]);
}

#[test]
fn an_import_can_be_saved_and_reloaded() {
    let (m, _) = imported();
    let mut store = Store::open_in_memory().unwrap();
    store.save_all(&m).unwrap();
    let loaded = store.load(Box::new(TestEnv(500)), "dev").unwrap();
    assert_eq!(loaded.nodes(), m.nodes());
    assert_eq!(loaded.spaces(), m.spaces());
}

#[test]
fn malformed_input_leaves_the_model_untouched() {
    let mut model = Model::new(Box::new(TestEnv(0)), "dev");
    assert!(matches!(
        import_arc_str(&mut model, "not json"),
        Err(ImportError::Json(_))
    ));
    assert!(matches!(
        import_arc_str(&mut model, "{}"),
        Err(ImportError::Format(_))
    ));
    let no_live = r#"{"sidebar":{"containers":[{"global":{}}]}}"#;
    assert!(matches!(
        import_arc_str(&mut model, no_live),
        Err(ImportError::Format(_))
    ));
    assert!(model.spaces().is_empty());
}

fn render_tree(m: &Model, parent: &NodeId, depth: usize, section: &str, out: &mut Vec<String>) {
    for id in m.children(parent).unwrap() {
        match &m.node(&id).unwrap().kind {
            NodeKind::Folder { title, .. } => {
                out.push(format!("{section}|{depth}|\u{1f4c1} {title}"));
                render_tree(m, &id, depth + 1, section, out);
            }
            NodeKind::Tab(t) => {
                let title = t.custom_title.clone().unwrap_or_else(|| t.title.clone());
                out.push(format!("{section}|{depth}|\u{2022} {title}  <{}>", t.url));
            }
            NodeKind::Root(_) => unreachable!(),
        }
    }
}

fn model_outline(m: &Model) -> Vec<String> {
    let mut out = Vec::new();
    for identity in m.identities() {
        let root = m.favorites_root(&identity.id).unwrap().id.clone();
        render_tree(m, &root, 0, &format!("fav[{}]", identity.name), &mut out);
    }
    for space in m.spaces() {
        render_tree(
            m,
            &space.pinned_root,
            0,
            &format!("space[{}]/Pinned", space.title),
            &mut out,
        );
        render_tree(
            m,
            &space.today_root,
            0,
            &format!("space[{}]/Today", space.title),
            &mut out,
        );
    }
    out
}

/// The outline printed by tools/arc_sidebar.py, reduced to what the importer
/// keeps: no unsupported items, no URL-less tabs, and flat Today/Favorites.
fn python_outline() -> Option<Vec<String>> {
    let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../tools/arc_sidebar.py");
    let output = Command::new("python3")
        .arg("-I")
        .arg(script)
        .arg(fixture())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).unwrap();
    let mut out = Vec::new();
    let mut space = String::new();
    let mut section = String::new();
    for line in text.lines() {
        let trimmed = line.trim_start();
        if line.is_empty() || line.starts_with("== Favorites") {
            continue;
        } else if let Some(rest) = trimmed.strip_prefix("[profile: ") {
            section = format!("fav[{}]", rest.trim_end_matches(']'));
        } else if let Some(rest) = line.strip_prefix("== Space: ") {
            space = rest.split("  (profile ").next().unwrap().to_owned();
        } else if let Some(rest) = trimmed.strip_prefix("-- ") {
            section = format!("space[{space}]/{}", rest.trim_end_matches(" --"));
        } else if trimmed.starts_with("!!") || trimmed.starts_with('?') || trimmed.ends_with("<>") {
            continue;
        } else {
            let flat = section.starts_with("fav[") || section.ends_with("/Today");
            if flat && trimmed.starts_with('\u{1f4c1}') {
                continue;
            }
            let label = trimmed.trim_end_matches("  (local only)");
            let depth = if flat {
                0
            } else {
                (line.len() - trimmed.len() - 4) / 2
            };
            out.push(format!("{section}|{depth}|{label}"));
        }
    }
    Some(out)
}

#[test]
fn matches_the_python_decoder_on_the_fixture() {
    let Some(expected) = python_outline() else {
        eprintln!("python3 unavailable; skipping oracle comparison");
        return;
    };
    let (m, _) = imported();
    let mut actual = model_outline(&m);
    let mut expected = expected;
    actual.sort();
    expected.sort();
    assert_eq!(actual.len(), 16, "10 tabs + 3 folders + 3 favorites");
    assert_eq!(actual, expected);
}

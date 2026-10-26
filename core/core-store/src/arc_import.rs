/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Imports an Arc `StorableSidebar.json` into the model.
//!
//! Arc encodes dictionaries with non-string keys as flat arrays
//! `[k1, v1, k2, v2, ...]`; the live copy of the sidebar is the container that
//! has an `items` key. Spaces on the same Arc profile share one identity.

use core_model::{Icon, IdentityId, Model, ModelError, NodeId, NodeKind, TabData};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::Path;

/// Seconds between the Unix epoch and Arc's reference date, 2001-01-01 UTC.
const APPLE_EPOCH_OFFSET: f64 = 978_307_200.0;
const MAX_DEPTH: usize = 64;

#[derive(Debug, thiserror::Error)]
pub enum ImportError {
    #[error("json: {0}")]
    Json(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("unexpected format: {0}")]
    Format(String),
    #[error("model: {0}")]
    Model(#[from] ModelError),
}

#[derive(Debug, Default, PartialEq, Eq)]
pub struct ImportReport {
    pub identities: usize,
    pub spaces: usize,
    pub folders: usize,
    pub tabs: usize,
    pub favorites: usize,
    pub warnings: Vec<String>,
}

enum Imported {
    Folder {
        title: String,
        created_at: i64,
        children: Vec<Imported>,
    },
    Tab {
        url: String,
        title: String,
        custom_title: Option<String>,
        created_at: i64,
        last_active_at: i64,
    },
}

struct ImportedSpace {
    title: String,
    icon: Icon,
    profile: String,
    pinned: Vec<Imported>,
    today: Vec<Imported>,
}

struct Parsed {
    spaces: Vec<ImportedSpace>,
    favorites: Vec<(String, Vec<Imported>)>,
    warnings: Vec<String>,
}

pub fn import_arc_file(model: &mut Model, path: &Path) -> Result<ImportReport, ImportError> {
    import_arc_str(model, &std::fs::read_to_string(path)?)
}

/// Parses the whole document first, so a malformed file leaves the model untouched.
pub fn import_arc_str(model: &mut Model, json: &str) -> Result<ImportReport, ImportError> {
    let parsed = parse(&serde_json::from_str(json)?)?;
    let mut report = ImportReport {
        warnings: parsed.warnings,
        ..ImportReport::default()
    };
    let mut identities: HashMap<String, IdentityId> = HashMap::new();
    for space in &parsed.spaces {
        let identity = match identities.get(&space.profile) {
            Some(id) => id.clone(),
            None => {
                let id = model.create_identity(&space.profile)?;
                identities.insert(space.profile.clone(), id.clone());
                report.identities += 1;
                id
            }
        };
        let id = model.create_space(&space.title, space.icon.clone(), Some(identity))?;
        report.spaces += 1;
        let (pinned, today) = {
            let created = model.space(&id).expect("space was just created");
            (created.pinned_root.clone(), created.today_root.clone())
        };
        append(
            model,
            &pinned,
            &space.pinned,
            &mut report.folders,
            &mut report.tabs,
        )?;
        append(
            model,
            &today,
            &space.today,
            &mut report.folders,
            &mut report.tabs,
        )?;
    }
    for (profile, tabs) in &parsed.favorites {
        let Some(identity) = identities.get(profile) else {
            report.warnings.push(format!(
                "favorites of profile {profile} skipped: no space uses it"
            ));
            continue;
        };
        let root = model
            .favorites_root(identity)
            .expect("identity has a favorites root")
            .id
            .clone();
        append(
            model,
            &root,
            tabs,
            &mut report.folders,
            &mut report.favorites,
        )?;
    }
    Ok(report)
}

fn append(
    model: &mut Model,
    parent: &NodeId,
    nodes: &[Imported],
    folders: &mut usize,
    tabs: &mut usize,
) -> Result<(), ModelError> {
    for node in nodes {
        match node {
            Imported::Folder {
                title,
                created_at,
                children,
            } => {
                let kind = NodeKind::Folder {
                    title: title.clone(),
                    collapsed: false,
                };
                let id = model.append_imported(parent, kind, *created_at)?;
                *folders += 1;
                append(model, &id, children, folders, tabs)?;
            }
            Imported::Tab {
                url,
                title,
                custom_title,
                created_at,
                last_active_at,
            } => {
                let kind = NodeKind::Tab(TabData {
                    url: url.clone(),
                    title: title.clone(),
                    custom_title: custom_title.clone(),
                    icon: None,
                    last_active_at: *last_active_at,
                    muted: false,
                });
                model.append_imported(parent, kind, *created_at)?;
                *tabs += 1;
            }
        }
    }
    Ok(())
}

fn format_error<T>(what: &str) -> Result<T, ImportError> {
    Err(ImportError::Format(what.to_owned()))
}

/// Pairs up a flat `[k1, v1, k2, v2, ...]` array.
fn pairs(value: &Value) -> Vec<(&Value, &Value)> {
    match value.as_array() {
        Some(list) => list
            .as_chunks::<2>()
            .0
            .iter()
            .map(|pair| (&pair[0], &pair[1]))
            .collect(),
        None => Vec::new(),
    }
}

fn string_keyed(value: &Value) -> HashMap<&str, &Value> {
    pairs(value)
        .into_iter()
        .filter_map(|(key, value)| key.as_str().map(|key| (key, value)))
        .collect()
}

fn apple_to_ms(seconds: Option<f64>) -> i64 {
    seconds.map_or(0, |s| ((s + APPLE_EPOCH_OFFSET) * 1000.0) as i64)
}

fn profile_name(profile: &Value) -> String {
    if profile.get("default").and_then(Value::as_bool) == Some(true) {
        return "Default".to_owned();
    }
    profile
        .pointer("/custom/_0/directoryBasename")
        .and_then(Value::as_str)
        .unwrap_or("?")
        .to_owned()
}

fn icon_of(space: &Value) -> Icon {
    let icon_type = space.pointer("/customInfo/iconType");
    let field = |name: &str| icon_type.and_then(|t| t.get(name));
    if let Some(name) = field("icon").and_then(Value::as_str) {
        return Icon::Symbol(name.to_owned());
    }
    for key in ["emoji_v2", "emoji"] {
        match field(key) {
            Some(Value::String(glyph)) if !glyph.is_empty() => return Icon::Emoji(glyph.clone()),
            Some(Value::Number(code)) => {
                if let Some(glyph) = code
                    .as_u64()
                    .filter(|c| *c != 0)
                    .and_then(|c| char::from_u32(c as u32))
                {
                    return Icon::Emoji(glyph.to_string());
                }
            }
            _ => {}
        }
    }
    Icon::Symbol("space".to_owned())
}

struct Walker<'a> {
    items: HashMap<&'a str, &'a Value>,
    warnings: Vec<String>,
}

impl Walker<'_> {
    /// Converts the children of `container_id`. With `flat` set, folders are
    /// dissolved into their tabs, because Today and Favorites only hold tabs.
    fn children(
        &mut self,
        container_id: &str,
        flat: bool,
        seen: &mut HashSet<String>,
        depth: usize,
    ) -> Vec<Imported> {
        let Some(container) = self.items.get(container_id).copied() else {
            self.warnings
                .push(format!("container {container_id} is missing"));
            return Vec::new();
        };
        if depth > MAX_DEPTH || !seen.insert(container_id.to_owned()) {
            self.warnings
                .push(format!("{container_id} is nested too deeply or cyclic"));
            return Vec::new();
        }
        let ids: Vec<String> = container
            .get("childrenIds")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|v| v.as_str().map(str::to_owned))
                    .collect()
            })
            .unwrap_or_default();
        let mut out = Vec::new();
        for id in ids {
            let Some(item) = self.items.get(id.as_str()).copied() else {
                self.warnings.push(format!("child {id} is missing"));
                continue;
            };
            let title = item
                .get("title")
                .and_then(Value::as_str)
                .filter(|t| !t.is_empty());
            let created_at = apple_to_ms(item.get("createdAt").and_then(Value::as_f64));
            let data = item.get("data");
            if let Some(tab) = data.and_then(|d| d.get("tab")) {
                let url = tab.get("savedURL").and_then(Value::as_str).unwrap_or("");
                if url.is_empty() {
                    self.warnings
                        .push(format!("tab {id} has no URL and was skipped"));
                    continue;
                }
                let saved = tab
                    .get("savedTitle")
                    .and_then(Value::as_str)
                    .filter(|t| !t.is_empty());
                out.push(Imported::Tab {
                    url: url.to_owned(),
                    title: saved.or(title).unwrap_or(url).to_owned(),
                    custom_title: title.filter(|t| Some(*t) != saved).map(str::to_owned),
                    created_at,
                    last_active_at: apple_to_ms(
                        tab.get("timeLastActiveAt").and_then(Value::as_f64),
                    ),
                });
            } else if data.and_then(|d| d.get("list")).is_some() {
                let inner = self.children(&id, flat, seen, depth + 1);
                if flat {
                    self.warnings
                        .push(format!("folder {id} was flattened into its tabs"));
                    out.extend(inner);
                } else {
                    out.push(Imported::Folder {
                        title: title.unwrap_or("Untitled folder").to_owned(),
                        created_at,
                        children: inner,
                    });
                }
            } else {
                let kind = data
                    .and_then(Value::as_object)
                    .and_then(|d| d.keys().next())
                    .map_or("unknown", String::as_str);
                self.warnings.push(format!(
                    "item {id} of kind {kind} is not supported and was skipped"
                ));
            }
        }
        out
    }
}

fn parse(doc: &Value) -> Result<Parsed, ImportError> {
    let Some(containers) = doc.pointer("/sidebar/containers").and_then(Value::as_array) else {
        return format_error("no sidebar.containers");
    };
    let Some(live) = containers.iter().find(|c| c.get("items").is_some()) else {
        return format_error("no container with items");
    };
    let items = string_keyed(&live["items"]);
    let spaces = string_keyed(&live["spaces"]);
    let sync = doc.pointer("/firebaseSyncState/syncData");
    let ordered: Vec<&str> = sync
        .and_then(|s| s.pointer("/orderedSpaceIDs/value"))
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut order: Vec<&str> = ordered
        .iter()
        .copied()
        .filter(|id| spaces.contains_key(id))
        .collect();
    let mut rest: Vec<&str> = pairs(&live["spaces"])
        .into_iter()
        .filter_map(|(key, _)| key.as_str())
        .filter(|id| !order.contains(id))
        .collect();
    order.append(&mut rest);

    let mut walker = Walker {
        items,
        warnings: Vec::new(),
    };
    let mut parsed_spaces = Vec::new();
    for id in order {
        let space = spaces[id];
        let containers = space
            .get("newContainerIDs")
            .or_else(|| space.get("containerIDs"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut imported = ImportedSpace {
            title: space
                .get("title")
                .and_then(Value::as_str)
                .filter(|t| !t.is_empty())
                .unwrap_or("Space")
                .to_owned(),
            icon: icon_of(space),
            profile: profile_name(space.get("profile").unwrap_or(&Value::Null)),
            pinned: Vec::new(),
            today: Vec::new(),
        };
        for pair in containers.as_chunks::<2>().0 {
            let kind = match &pair[0] {
                Value::Object(map) => map.keys().next().map(String::as_str),
                Value::String(name) => Some(name.as_str()),
                _ => None,
            };
            let Some(container_id) = pair[1].as_str() else {
                continue;
            };
            match kind {
                Some("pinned") => {
                    imported.pinned = walker.children(container_id, false, &mut HashSet::new(), 0)
                }
                Some("unpinned") => {
                    imported.today = walker.children(container_id, true, &mut HashSet::new(), 0)
                }
                other => walker.warnings.push(format!(
                    "container {container_id} of kind {other:?} was skipped"
                )),
            }
        }
        parsed_spaces.push(imported);
    }

    let mut favorites = Vec::new();
    for (profile, container) in pairs(&live["topAppsContainerIDs"]) {
        if let Some(container_id) = container.as_str() {
            let tabs = walker.children(container_id, true, &mut HashSet::new(), 0);
            favorites.push((profile_name(profile), tabs));
        }
    }
    Ok(Parsed {
        spaces: parsed_spaces,
        favorites,
        warnings: walker.warnings,
    })
}

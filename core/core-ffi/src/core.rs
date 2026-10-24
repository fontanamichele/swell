/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use crate::types::*;
use core_history::History;
use core_model::{Env, LiveTabId, Model, NodeId, NodeKind, SpaceId, SystemEnv, WindowId};
use core_search::{default_engines, Candidate, CandidateKind};
use core_store::Store;
use std::path::Path;
use std::sync::{Arc, Mutex};

const SUGGESTION_LIMIT: usize = 8;
/// History pages looked up for one command-bar query, before ranking.
const HISTORY_CANDIDATES: usize = 30;
const META_DEVICE: &str = "device_id";
const META_LAST_SPACE: &str = "last_space";

enum Event {
    Tree(TreeDiff),
    Spaces(Vec<SpaceView>),
    ActiveSpace {
        window: String,
        space: String,
    },
    OpenTab {
        window: String,
        space: String,
        user_context_id: u32,
        url: String,
        live_tab: String,
        node: String,
    },
    SelectTab {
        window: String,
        live_tab: String,
    },
    CloseTab {
        window: String,
        live_tab: String,
    },
}

struct Inner {
    model: Model,
    store: Store,
    history: History,
    listeners: Vec<Arc<dyn CoreListener>>,
    /// Set when a write failed; the next write saves everything instead.
    dirty: bool,
}

impl Inner {
    fn persist_ops(&mut self, ops: &[core_model::TreeOp]) -> Result<(), CoreError> {
        let saved = if self.dirty {
            self.store.save_all(&self.model)
        } else {
            self.store.apply(&self.model, ops)
        };
        self.dirty = saved.is_err();
        Ok(saved?)
    }

    fn persist_structure(&mut self) -> Result<(), CoreError> {
        let saved = if self.dirty {
            self.store.save_all(&self.model)
        } else {
            self.store.sync_structure(&self.model)
        };
        self.dirty = saved.is_err();
        Ok(saved?)
    }

    fn space_views(&self) -> Vec<SpaceView> {
        self.model
            .spaces()
            .iter()
            .filter_map(|space| {
                let identity = self.model.identity(&space.identity_id)?;
                let favorites = self.model.favorites_root(&space.identity_id)?;
                Some(SpaceView {
                    id: space.id.0.clone(),
                    title: space.title.clone(),
                    icon: (&space.icon).into(),
                    identity_id: identity.id.0.clone(),
                    user_context_id: identity.gecko_user_context_id,
                    pinned_root: space.pinned_root.0.clone(),
                    today_root: space.today_root.0.clone(),
                    favorites_root: favorites.id.0.clone(),
                })
            })
            .collect()
    }

    /// The identity of the space a live tab belongs to.
    fn identity_of_live_tab(&self, live: &LiveTabId) -> Option<String> {
        let tab = self.model.live_tab(live)?;
        Some(self.model.identity_of_space(&tab.space)?.id.0.clone())
    }

    fn space(&self, id: &str) -> Result<core_model::Space, CoreError> {
        self.model
            .space(&SpaceId::from(id))
            .cloned()
            .ok_or_else(|| CoreError::NotFound {
                what: format!("space {id}"),
            })
    }

    fn user_context_id(&self, space: &core_model::Space) -> u32 {
        self.model
            .identity(&space.identity_id)
            .map_or(0, |identity| identity.gecko_user_context_id)
    }

    fn tree_event(ops: &[core_model::TreeOp], events: &mut Vec<Event>) {
        let ops: Vec<TreeOp> = ops.iter().filter_map(TreeOp::of).collect();
        if !ops.is_empty() {
            events.push(Event::Tree(TreeDiff { ops }));
        }
    }

    /// Roots shown for a space: Pinned, Today and the identity's Favorites.
    fn roots(&self, space: &core_model::Space) -> Vec<(NodeId, CandidateKind)> {
        let mut roots = vec![
            (space.pinned_root.clone(), CandidateKind::Pinned),
            (space.today_root.clone(), CandidateKind::Today),
        ];
        if let Some(favorites) = self.model.favorites_root(&space.identity_id) {
            roots.push((favorites.id.clone(), CandidateKind::Pinned));
        }
        roots
    }

    fn collect(&self, root: &NodeId, snapshot: &mut TreeSnapshot) {
        let ids = self.model.children(root).unwrap_or_default();
        snapshot.children.push(ChildList {
            parent: root.0.clone(),
            ids: ids.iter().map(|id| id.0.clone()).collect(),
        });
        for id in ids {
            let Some(node) = self.model.node(&id) else {
                continue;
            };
            snapshot.nodes.extend(NodeView::of(node));
            if matches!(node.kind, NodeKind::Folder { .. }) {
                self.collect(&id, snapshot);
            }
        }
    }

    fn candidates(&self, root: &NodeId, kind: CandidateKind, out: &mut Vec<Candidate>) {
        let open: Vec<NodeId> = self.model.live_tabs().into_iter().map(|t| t.node).collect();
        let mut stack = vec![root.clone()];
        while let Some(id) = stack.pop() {
            let Some(node) = self.model.node(&id) else {
                continue;
            };
            stack.extend(node.children.iter().cloned());
            if let NodeKind::Tab(tab) = &node.kind {
                out.push(Candidate {
                    id: id.0.clone(),
                    kind,
                    title: tab
                        .custom_title
                        .clone()
                        .unwrap_or_else(|| tab.title.clone()),
                    url: tab.url.clone(),
                    is_open: open.contains(&id),
                    last_active_at: tab.last_active_at,
                    weight: 0,
                });
            }
        }
    }
}

#[derive(uniffi::Object)]
pub struct SwellCore {
    inner: Mutex<Inner>,
}

impl SwellCore {
    /// Runs a command under the lock, then delivers its events with the lock
    /// released so a listener can call back into the core.
    fn run<T>(
        &self,
        command: impl FnOnce(&mut Inner, &mut Vec<Event>) -> Result<T, CoreError>,
    ) -> Result<T, CoreError> {
        let mut events = Vec::new();
        let (result, listeners) = {
            let mut inner = self
                .inner
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let result = command(&mut inner, &mut events);
            (result, inner.listeners.clone())
        };
        for event in &events {
            for listener in &listeners {
                match event {
                    Event::Tree(diff) => listener.on_tree_changed(diff.clone()),
                    Event::Spaces(spaces) => listener.on_spaces_changed(spaces.clone()),
                    Event::ActiveSpace { window, space } => {
                        listener.on_active_space_changed(window.clone(), space.clone())
                    }
                    Event::OpenTab {
                        window,
                        space,
                        user_context_id,
                        url,
                        live_tab,
                        node,
                    } => listener.on_open_tab(
                        window.clone(),
                        space.clone(),
                        *user_context_id,
                        url.clone(),
                        live_tab.clone(),
                        node.clone(),
                    ),
                    Event::SelectTab { window, live_tab } => {
                        listener.on_select_tab(window.clone(), live_tab.clone())
                    }
                    Event::CloseTab { window, live_tab } => {
                        listener.on_close_tab(window.clone(), live_tab.clone())
                    }
                }
            }
        }
        result
    }
}

#[uniffi::export]
impl SwellCore {
    /// Opens (creating on first run) the sidebar database in `dir`. A first
    /// run starts with one space, "Personal".
    #[uniffi::constructor]
    pub fn open(dir: String) -> Result<Arc<Self>, CoreError> {
        let mut store = Store::open(Path::new(&dir))?;
        let history = History::open(Path::new(&dir))?;
        let device = match store.get_meta(META_DEVICE)? {
            Some(device) => device,
            None => {
                let device = SystemEnv.new_id();
                store.set_meta(META_DEVICE, &device)?;
                device
            }
        };
        let mut model = store.load(Box::new(SystemEnv), &device)?;
        if model.spaces().is_empty() {
            let id =
                model.create_space("Personal", core_model::Icon::Symbol("person".into()), None)?;
            store.sync_structure(&model)?;
            store.set_meta(META_LAST_SPACE, id.as_str())?;
        }
        Ok(Arc::new(Self {
            inner: Mutex::new(Inner {
                model,
                store,
                history,
                listeners: Vec::new(),
                dirty: false,
            }),
        }))
    }

    pub fn add_listener(&self, listener: Box<dyn CoreListener>) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.listeners.push(Arc::from(listener));
    }

    /// Drops every listener. The window calls this as the application quits:
    /// UniFFI aborts at shutdown if a callback interface is still registered.
    pub fn close(&self) {
        let mut inner = self
            .inner
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        inner.listeners.clear();
    }

    pub fn list_spaces(&self) -> Result<Vec<SpaceView>, CoreError> {
        self.run(|inner, _| Ok(inner.space_views()))
    }

    /// The space the user last switched to, if it still exists.
    pub fn last_active_space(&self) -> Result<Option<String>, CoreError> {
        self.run(|inner, _| {
            let last = inner.store.get_meta(META_LAST_SPACE)?;
            Ok(last.filter(|id| inner.model.space(&SpaceId::from(id.as_str())).is_some()))
        })
    }

    /// The saved page zoom of `host` in the space's identity; 1.0 when none.
    pub fn site_zoom(&self, space: String, host: String) -> Result<f64, CoreError> {
        self.run(|inner, _| {
            let space = inner.space(&space)?;
            Ok(inner
                .store
                .site_zoom(&space.identity_id.0, &host)?
                .unwrap_or(1.0))
        })
    }

    /// Saves the page zoom of `host` for the space's identity. 1.0 forgets it;
    /// other values are limited to what the engine accepts (0.3 to 5).
    pub fn set_site_zoom(&self, space: String, host: String, factor: f64) -> Result<(), CoreError> {
        self.run(|inner, _| {
            let space = inner.space(&space)?;
            if !factor.is_finite() {
                return Err(CoreError::Invariant {
                    reason: format!("zoom {factor} is not a number"),
                });
            }
            let factor = factor.clamp(0.3, 5.0);
            let saved = if (factor - 1.0).abs() < 1e-9 {
                None
            } else {
                Some(factor)
            };
            Ok(inner
                .store
                .set_site_zoom(&space.identity_id.0, &host, saved)?)
        })
    }

    pub fn space_tree(&self, space: String) -> Result<TreeSnapshot, CoreError> {
        self.run(|inner, _| {
            let space = inner.space(&space)?;
            let mut snapshot = TreeSnapshot {
                nodes: Vec::new(),
                children: Vec::new(),
            };
            for (root, _) in inner.roots(&space) {
                inner.collect(&root, &mut snapshot);
            }
            Ok(snapshot)
        })
    }

    pub fn create_space(&self, title: String, icon: Icon) -> Result<String, CoreError> {
        self.run(|inner, events| {
            let id = inner.model.create_space(&title, icon.into(), None)?;
            events.push(Event::Spaces(inner.space_views()));
            inner.persist_structure()?;
            Ok(id.0)
        })
    }

    pub fn open_window(&self, window: String) -> Result<(), CoreError> {
        self.run(|inner, _| {
            inner.model.open_window(WindowId::from(window));
            Ok(())
        })
    }

    pub fn close_window(&self, window: String) -> Result<(), CoreError> {
        self.run(|inner, _| {
            inner.model.close_window(&WindowId::from(window));
            Ok(())
        })
    }

    pub fn switch_space(&self, window: String, space: String) -> Result<(), CoreError> {
        self.run(|inner, events| {
            inner.model.switch_space(
                &WindowId::from(window.as_str()),
                &SpaceId::from(space.as_str()),
            )?;
            events.push(Event::ActiveSpace {
                window,
                space: space.clone(),
            });
            inner.store.set_meta(META_LAST_SPACE, &space)?;
            Ok(())
        })
    }

    /// Opens a new tab at `url` in the space's Today list and asks the engine
    /// bridge to create it in the space's container. Returns the live tab id.
    pub fn open_url(
        &self,
        window: String,
        space: String,
        url: String,
    ) -> Result<String, CoreError> {
        self.run(|inner, events| {
            let target = inner.space(&space)?;
            let (live, ops) =
                inner
                    .model
                    .open_url(&WindowId::from(window.as_str()), &target.id, &url)?;
            Inner::tree_event(&ops, events);
            let node = inner
                .model
                .live_tab(&live)
                .map(|tab| tab.node.0.clone())
                .unwrap_or_default();
            events.push(Event::OpenTab {
                window,
                space,
                user_context_id: inner.user_context_id(&target),
                url,
                live_tab: live.0.clone(),
                node,
            });
            inner.persist_ops(&ops)?;
            Ok(live.0)
        })
    }

    /// Opens a saved tab, or selects it if it is already open in the window.
    pub fn open_node(
        &self,
        window: String,
        space: String,
        node: String,
    ) -> Result<String, CoreError> {
        self.run(|inner, events| {
            let target = inner.space(&space)?;
            let window_id = WindowId::from(window.as_str());
            let node_id = NodeId::from(node.as_str());
            let existing = inner
                .model
                .live_tabs()
                .into_iter()
                .find(|tab| tab.node == node_id && tab.window == window_id);
            let live = inner.model.open_node(&window_id, &target.id, &node_id)?;
            if existing.is_some() {
                events.push(Event::SelectTab {
                    window,
                    live_tab: live.0.clone(),
                });
            } else {
                let url = match inner.model.node(&node_id).map(|n| &n.kind) {
                    Some(NodeKind::Tab(tab)) => tab.url.clone(),
                    _ => String::new(),
                };
                events.push(Event::OpenTab {
                    window,
                    space,
                    user_context_id: inner.user_context_id(&target),
                    url,
                    live_tab: live.0.clone(),
                    node: node_id.0.clone(),
                });
            }
            Ok(live.0)
        })
    }

    pub fn pin_tab(
        &self,
        window: String,
        live_tab: String,
        into: String,
        index: u32,
    ) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let live = LiveTabId::from(live_tab.as_str());
            match inner.model.live_tab(&live) {
                Some(tab) if tab.window.as_str() == window => {}
                _ => {
                    return Err(CoreError::NotFound {
                        what: format!("live tab {live_tab}"),
                    })
                }
            }
            let ops = inner
                .model
                .pin_live_tab(&live, &NodeId::from(into), index as usize)?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }

    pub fn unpin_node(&self, node: String, space: String) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let ops = inner
                .model
                .unpin_node(&NodeId::from(node), &SpaceId::from(space))?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }

    pub fn move_node(&self, node: String, new_parent: String, index: u32) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let ops = inner.model.move_node(
                &NodeId::from(node),
                &NodeId::from(new_parent),
                index as usize,
            )?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }

    pub fn create_folder(
        &self,
        parent: String,
        title: String,
        index: u32,
    ) -> Result<String, CoreError> {
        self.run(|inner, events| {
            let (id, ops) =
                inner
                    .model
                    .insert_folder(&NodeId::from(parent), index as usize, &title)?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)?;
            Ok(id.0)
        })
    }

    pub fn rename_node(&self, node: String, title: String) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let ops = inner.model.rename_node(&NodeId::from(node), &title)?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }

    pub fn set_collapsed(&self, node: String, collapsed: bool) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let ops = inner.model.set_collapsed(&NodeId::from(node), collapsed)?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }

    /// Removes a node and its subtree; the engine bridge is told to close any
    /// tab that was open on it.
    pub fn remove_node(&self, node: String) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let windows: Vec<(LiveTabId, WindowId)> = inner
                .model
                .live_tabs()
                .into_iter()
                .map(|tab| (tab.id, tab.window))
                .collect();
            let (ops, closed) = inner.model.remove_node(&NodeId::from(node))?;
            Inner::tree_event(&ops, events);
            for live in closed {
                if let Some((_, window)) = windows.iter().find(|(id, _)| *id == live) {
                    events.push(Event::CloseTab {
                        window: window.0.clone(),
                        live_tab: live.0,
                    });
                }
            }
            inner.persist_ops(&ops)
        })
    }

    pub fn query_command_bar(
        &self,
        space: String,
        text: String,
    ) -> Result<Vec<Suggestion>, CoreError> {
        self.run(|inner, _| {
            let space = inner.space(&space)?;
            let mut candidates = Vec::new();
            for (root, kind) in inner.roots(&space) {
                inner.candidates(&root, kind, &mut candidates);
            }
            let tokens: Vec<String> = text.split_whitespace().map(str::to_lowercase).collect();
            if !tokens.is_empty() {
                let now = SystemEnv.now_ms();
                let pages =
                    inner
                        .history
                        .search(&space.identity_id.0, &tokens, HISTORY_CANDIDATES, now)?;
                candidates.extend(pages.into_iter().map(|page| Candidate {
                    id: String::new(),
                    kind: CandidateKind::History,
                    title: page.title,
                    url: page.url,
                    is_open: false,
                    last_active_at: page.last_visit,
                    weight: (page.frecency / 2.0).round() as i32,
                }));
            }
            let engine = &default_engines()[0];
            Ok(
                core_search::suggest(&text, &candidates, engine, SUGGESTION_LIMIT)
                    .into_iter()
                    .map(|s| Suggestion {
                        kind: match s.kind {
                            core_search::SuggestionKind::Pinned => SuggestionKind::Pinned,
                            core_search::SuggestionKind::Today => SuggestionKind::Today,
                            core_search::SuggestionKind::History => SuggestionKind::History,
                            core_search::SuggestionKind::Url => SuggestionKind::Url,
                            core_search::SuggestionKind::Search => SuggestionKind::Search,
                        },
                        title: s.title,
                        url: s.url,
                        node: s.id,
                        is_open: s.is_open,
                    })
                    .collect(),
            )
        })
    }

    pub fn import_arc(&self, path: String) -> Result<ImportReport, CoreError> {
        self.run(|inner, events| {
            let report = core_store::import_arc_file(&mut inner.model, Path::new(&path))?;
            events.push(Event::Spaces(inner.space_views()));
            let saved = inner.store.save_all(&inner.model);
            inner.dirty = saved.is_err();
            saved?;
            Ok(ImportReport {
                identities: report.identities as u32,
                spaces: report.spaces as u32,
                folders: report.folders as u32,
                tabs: report.tabs as u32,
                favorites: report.favorites as u32,
                warnings: report.warnings,
            })
        })
    }

    /// Engine report: the engine opened a tab on its own (`window.open`, a
    /// `target=_blank` link). The core records it in Today, but does not ask
    /// the bridge to open anything. Returns the live tab id.
    pub fn on_tab_opened(
        &self,
        window: String,
        space: String,
        url: String,
    ) -> Result<OpenedTab, CoreError> {
        self.run(|inner, events| {
            let target = inner.space(&space)?;
            let (live, ops) = inner
                .model
                .open_url(&WindowId::from(window), &target.id, &url)?;
            Inner::tree_event(&ops, events);
            let node = inner
                .model
                .live_tab(&live)
                .map(|tab| tab.node.0.clone())
                .unwrap_or_default();
            inner.persist_ops(&ops)?;
            Ok(OpenedTab {
                live_tab: live.0,
                node,
            })
        })
    }

    /// Engine report: a live tab's favicon changed; `None` clears it.
    pub fn on_favicon(&self, live_tab: String, icon: Option<String>) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let ops = inner
                .model
                .set_tab_icon(&LiveTabId::from(live_tab), icon.as_deref())?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }

    /// Engine report: a top-level navigation finished in a live tab.
    pub fn on_navigation(
        &self,
        live_tab: String,
        url: String,
        title: String,
        transition: Transition,
    ) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let live = LiveTabId::from(live_tab);
            let ops = inner.model.navigated(&live, &url, &title)?;
            Inner::tree_event(&ops, events);
            let saved = inner.persist_ops(&ops);
            // History is kept for the tab's identity only, and is best effort:
            // a failure here must not undo the tree change above.
            if let Some(identity) = inner.identity_of_live_tab(&live) {
                let now = SystemEnv.now_ms();
                let _ = match transition {
                    Transition::Typed => inner
                        .history
                        .record_visit(&identity, &url, &title, now, true),
                    Transition::Link | Transition::Redirect => inner
                        .history
                        .record_visit(&identity, &url, &title, now, false),
                    _ => inner.history.set_title(&identity, &url, &title),
                };
            }
            saved
        })
    }

    /// How many pages the space's identity has in its history.
    pub fn history_count(&self, space: String) -> Result<u64, CoreError> {
        self.run(|inner, _| {
            let space = inner.space(&space)?;
            Ok(inner.history.count(&space.identity_id.0)?)
        })
    }

    /// Forgets the history of the space's identity; returns how many pages went.
    pub fn clear_history(&self, space: String) -> Result<u32, CoreError> {
        self.run(|inner, _| {
            let space = inner.space(&space)?;
            Ok(inner.history.clear(&space.identity_id.0)? as u32)
        })
    }

    /// Engine report: the user closed a live tab. A Today tab's node goes with it.
    pub fn on_tab_closed(&self, live_tab: String) -> Result<(), CoreError> {
        self.run(|inner, events| {
            let ops = inner.model.close_live_tab(&LiveTabId::from(live_tab))?;
            Inner::tree_event(&ops, events);
            inner.persist_ops(&ops)
        })
    }
}

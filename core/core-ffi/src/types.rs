/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! The records, enums and errors that cross the FFI, and their conversions
//! from the model. Identifiers are opaque strings; timestamps are Unix epoch
//! milliseconds.

use core_model as model;

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum Icon {
    Symbol { name: String },
    Emoji { glyph: String },
}

impl From<&model::Icon> for Icon {
    fn from(icon: &model::Icon) -> Self {
        match icon {
            model::Icon::Symbol(name) => Icon::Symbol { name: name.clone() },
            model::Icon::Emoji(glyph) => Icon::Emoji {
                glyph: glyph.clone(),
            },
        }
    }
}

impl From<Icon> for model::Icon {
    fn from(icon: Icon) -> Self {
        match icon {
            Icon::Symbol { name } => model::Icon::Symbol(name),
            Icon::Emoji { glyph } => model::Icon::Emoji(glyph),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum Transition {
    Typed,
    Link,
    Reload,
    Back,
    Forward,
    Redirect,
    Other,
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum NodeKindView {
    Tab {
        url: String,
        title: String,
        custom_title: Option<String>,
        icon: Option<String>,
        muted: bool,
    },
    Folder {
        title: String,
        collapsed: bool,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct NodeView {
    pub id: String,
    pub kind: NodeKindView,
    pub updated_at: i64,
}

impl NodeView {
    /// Roots are never shown as rows, so they have no view.
    pub(crate) fn of(node: &model::Node) -> Option<Self> {
        let kind = match &node.kind {
            model::NodeKind::Tab(tab) => NodeKindView::Tab {
                url: tab.url.clone(),
                title: tab.title.clone(),
                custom_title: tab.custom_title.clone(),
                icon: tab.icon.clone(),
                muted: tab.muted,
            },
            model::NodeKind::Folder { title, collapsed } => NodeKindView::Folder {
                title: title.clone(),
                collapsed: *collapsed,
            },
            model::NodeKind::Root(_) => return None,
        };
        Some(Self {
            id: node.id.0.clone(),
            kind,
            updated_at: node.updated_at,
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct SpaceView {
    pub id: String,
    pub title: String,
    pub icon: Icon,
    pub identity_id: String,
    /// The Gecko container of this space; never 0.
    pub user_context_id: u32,
    pub pinned_root: String,
    pub today_root: String,
    pub favorites_root: String,
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct ChildList {
    pub parent: String,
    pub ids: Vec<String>,
}

/// Everything shown for one space: its Pinned and Today trees and the
/// Favorites of its identity. `children` also lists the roots.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct TreeSnapshot {
    pub nodes: Vec<NodeView>,
    pub children: Vec<ChildList>,
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum TreeOp {
    Inserted {
        node: NodeView,
        parent: String,
        index: u32,
    },
    Removed {
        id: String,
    },
    Moved {
        id: String,
        parent: String,
        index: u32,
    },
    Updated {
        node: NodeView,
    },
}

impl TreeOp {
    pub(crate) fn of(op: &model::TreeOp) -> Option<Self> {
        Some(match op {
            model::TreeOp::Inserted {
                node,
                parent,
                index,
            } => TreeOp::Inserted {
                node: NodeView::of(node)?,
                parent: parent.0.clone(),
                index: *index,
            },
            model::TreeOp::Removed { id } => TreeOp::Removed { id: id.0.clone() },
            model::TreeOp::Moved { id, parent, index } => TreeOp::Moved {
                id: id.0.clone(),
                parent: parent.0.clone(),
                index: *index,
            },
            model::TreeOp::Updated { node } => TreeOp::Updated {
                node: NodeView::of(node)?,
            },
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct TreeDiff {
    pub ops: Vec<TreeOp>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, uniffi::Enum)]
pub enum SuggestionKind {
    Pinned,
    Today,
    Url,
    Search,
}

#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct Suggestion {
    pub kind: SuggestionKind,
    pub title: String,
    pub url: String,
    pub node: Option<String>,
    pub is_open: bool,
}

/// A tab the engine opened on its own, and the node recording it.
#[derive(Clone, Debug, PartialEq, Eq, uniffi::Record)]
pub struct OpenedTab {
    pub live_tab: String,
    pub node: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, uniffi::Record)]
pub struct ImportReport {
    pub identities: u32,
    pub spaces: u32,
    pub folders: u32,
    pub tabs: u32,
    pub favorites: u32,
    pub warnings: Vec<String>,
}

#[derive(Debug, thiserror::Error, uniffi::Error)]
pub enum CoreError {
    #[error("invariant: {reason}")]
    Invariant { reason: String },
    #[error("not found: {what}")]
    NotFound { what: String },
    #[error("storage: {reason}")]
    Storage { reason: String },
    #[error("import: {reason}")]
    Import { reason: String },
}

impl From<model::ModelError> for CoreError {
    fn from(error: model::ModelError) -> Self {
        match error {
            model::ModelError::NotFound(what) => CoreError::NotFound { what },
            model::ModelError::Invariant(reason) => CoreError::Invariant { reason },
        }
    }
}

impl From<core_store::StoreError> for CoreError {
    fn from(error: core_store::StoreError) -> Self {
        match error {
            core_store::StoreError::Model(inner) => inner.into(),
            other => CoreError::Storage {
                reason: other.to_string(),
            },
        }
    }
}

impl From<core_store::ImportError> for CoreError {
    fn from(error: core_store::ImportError) -> Self {
        match error {
            core_store::ImportError::Model(inner) => inner.into(),
            other => CoreError::Import {
                reason: other.to_string(),
            },
        }
    }
}

/// Events from the core to the window UI and the engine bridge. Callbacks run
/// on the JS main thread and never block the core.
#[uniffi::export(callback_interface)]
pub trait CoreListener: Send + Sync {
    fn on_tree_changed(&self, diff: TreeDiff);
    fn on_spaces_changed(&self, spaces: Vec<SpaceView>);
    fn on_active_space_changed(&self, window: String, space: String);
    /// The engine bridge must create a tab bound to `user_context_id`.
    fn on_open_tab(
        &self,
        window: String,
        space: String,
        user_context_id: u32,
        url: String,
        live_tab: String,
        node: String,
    );
    fn on_select_tab(&self, window: String, live_tab: String);
    fn on_close_tab(&self, window: String, live_tab: String);
}

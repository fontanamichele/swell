/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Persistence for the sidebar domain: identities, spaces and the node tree
//! live in one SQLite file so that creating a space and its roots is atomic.

mod arc_import;
mod error;
mod store;

pub use arc_import::{import_arc_file, import_arc_str, ImportError, ImportReport};
pub use error::{Result, StoreError};
pub use store::Store;

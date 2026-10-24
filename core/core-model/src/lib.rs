/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Swell's data model: identities, spaces and the single node tree behind the
//! sidebar, with the invariants enforced on every write.

mod diff;
mod entities;
mod error;
mod ids;
mod model;

pub use diff::TreeOp;
pub use entities::*;
pub use error::{ModelError, Result};
pub use ids::*;
pub use model::Model;

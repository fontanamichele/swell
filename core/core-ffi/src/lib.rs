/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! The only crate exported to JS. Gecko links it into `gkrust-uniffi-components`
//! and generates the bindings; see `swell/patches/0020-*`.

mod core;
mod types;

pub use crate::core::SwellCore;
pub use crate::types::*;

uniffi::setup_scaffolding!("swell_core");

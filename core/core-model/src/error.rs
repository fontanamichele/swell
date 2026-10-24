/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum ModelError {
    #[error("not found: {0}")]
    NotFound(String),
    #[error("invariant: {0}")]
    Invariant(String),
}

pub type Result<T> = std::result::Result<T, ModelError>;

pub(crate) fn invariant<T>(reason: impl Into<String>) -> Result<T> {
    Err(ModelError::Invariant(reason.into()))
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Command-bar logic: decide whether typed text is a URL or a search, rank the
//! space's open and saved tabs against it, and assemble the suggestion list.
//! History is not a source yet (M2).

mod classify;
mod rank;

pub use classify::{classify, default_engines, Classified, SearchEngine};
pub use rank::{rank, suggest, Candidate, CandidateKind, Ranked, Suggestion, SuggestionKind};

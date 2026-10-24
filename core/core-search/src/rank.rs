/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use crate::classify::{classify, Classified, SearchEngine};

/// A match at least this good goes ahead of the "search for ..." entry.
const STRONG: i32 = 100;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CandidateKind {
    Pinned,
    Today,
    /// A page from the identity's history; not a node of the tree.
    History,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Candidate {
    pub id: String,
    pub kind: CandidateKind,
    pub title: String,
    pub url: String,
    pub is_open: bool,
    pub last_active_at: i64,
    /// Added to the score of a match; history candidates carry their frecency.
    pub weight: i32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Ranked {
    pub candidate: Candidate,
    pub score: i32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SuggestionKind {
    Pinned,
    Today,
    History,
    Url,
    Search,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suggestion {
    pub kind: SuggestionKind,
    pub title: String,
    pub url: String,
    pub id: Option<String>,
    pub is_open: bool,
}

fn host_of(url: &str) -> &str {
    let rest = url.split_once("://").map_or(url, |(_, rest)| rest);
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    host.strip_prefix("www.").unwrap_or(host)
}

fn token_score(token: &str, title: &str, url: &str) -> Option<i32> {
    let host = host_of(url);
    let mut best: Option<i32> = None;
    let mut offer = |score: i32| best = Some(best.map_or(score, |b| b.max(score)));
    if title.starts_with(token) {
        offer(100);
    } else if title
        .split(|c: char| !c.is_alphanumeric())
        .any(|word| word.starts_with(token))
    {
        offer(60);
    } else if title.contains(token) {
        offer(30);
    }
    if host.starts_with(token) {
        offer(80);
    } else if host.contains(token) {
        offer(40);
    } else if url.contains(token) {
        offer(10);
    }
    best
}

/// Candidates whose title or URL contains every word of `query`, best first.
/// An empty query lists the open tabs, most recently active first.
pub fn rank(query: &str, candidates: &[Candidate], limit: usize) -> Vec<Ranked> {
    let tokens: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    // A page that is also a saved or open tab is offered once, as the tab.
    let tab_urls: std::collections::HashSet<&str> = candidates
        .iter()
        .filter(|c| c.kind != CandidateKind::History)
        .map(|c| c.url.as_str())
        .collect();
    let mut ranked: Vec<Ranked> = candidates
        .iter()
        .filter_map(|candidate| {
            if candidate.kind == CandidateKind::History
                && (tokens.is_empty() || tab_urls.contains(candidate.url.as_str()))
            {
                return None;
            }
            let mut score = 0;
            if tokens.is_empty() {
                if !candidate.is_open {
                    return None;
                }
            } else {
                let title = candidate.title.to_lowercase();
                let url = candidate.url.to_lowercase();
                for token in &tokens {
                    score += token_score(token, &title, &url)?;
                }
                score += match candidate.kind {
                    CandidateKind::Pinned => 40,
                    CandidateKind::Today => 20,
                    CandidateKind::History => 0,
                };
                score += candidate.weight;
                if candidate.is_open {
                    score += 25;
                }
            }
            Some(Ranked {
                candidate: candidate.clone(),
                score,
            })
        })
        .collect();
    ranked.sort_by(|a, b| {
        b.score
            .cmp(&a.score)
            .then(b.candidate.last_active_at.cmp(&a.candidate.last_active_at))
            .then_with(|| a.candidate.title.cmp(&b.candidate.title))
    });
    ranked.truncate(limit);
    ranked
}

fn from_ranked(ranked: &Ranked) -> Suggestion {
    let candidate = &ranked.candidate;
    Suggestion {
        kind: match candidate.kind {
            CandidateKind::Pinned => SuggestionKind::Pinned,
            CandidateKind::Today => SuggestionKind::Today,
            CandidateKind::History => SuggestionKind::History,
        },
        title: candidate.title.clone(),
        url: candidate.url.clone(),
        id: (candidate.kind != CandidateKind::History).then(|| candidate.id.clone()),
        is_open: candidate.is_open,
    }
}

fn url_entry(url: &str) -> Suggestion {
    Suggestion {
        kind: SuggestionKind::Url,
        title: url.to_owned(),
        url: url.to_owned(),
        id: None,
        is_open: false,
    }
}

fn search_entry(engine: &SearchEngine, query: &str) -> Suggestion {
    Suggestion {
        kind: SuggestionKind::Search,
        title: format!("Search {} for \"{query}\"", engine.name),
        url: engine.search_url(query),
        id: None,
        is_open: false,
    }
}

/// The command bar's list for `text`; the first entry is what Enter does.
pub fn suggest(
    text: &str,
    candidates: &[Candidate],
    engine: &SearchEngine,
    limit: usize,
) -> Vec<Suggestion> {
    let ranked = rank(text, candidates, limit);
    let (strong, rest): (Vec<&Ranked>, Vec<&Ranked>) =
        ranked.iter().partition(|r| r.score >= STRONG);
    let mut out: Vec<Suggestion> = Vec::new();
    match classify(text) {
        Classified::Url { url } => {
            out.push(url_entry(&url));
            out.extend(ranked.iter().map(from_ranked));
            out.push(search_entry(engine, text.trim()));
        }
        Classified::Search { query } if query.is_empty() => {
            out.extend(ranked.iter().map(from_ranked));
        }
        Classified::Search { query } => {
            out.extend(strong.into_iter().map(from_ranked));
            out.push(search_entry(engine, &query));
            out.extend(rest.into_iter().map(from_ranked));
        }
        Classified::Ambiguous { url, query } => {
            out.extend(strong.into_iter().map(from_ranked));
            out.push(url_entry(&url));
            out.push(search_entry(engine, &query));
            out.extend(rest.into_iter().map(from_ranked));
        }
    }
    out.truncate(limit);
    out
}

/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use core_search::*;

fn url(text: &str) -> String {
    match classify(text) {
        Classified::Url { url, .. } => url,
        other => panic!("{text:?} classified as {other:?}"),
    }
}

fn is_search(text: &str) -> bool {
    matches!(classify(text), Classified::Search { .. })
}

#[test]
fn explicit_urls_are_urls() {
    assert_eq!(
        url("https://example.com/a?b=1"),
        "https://example.com/a?b=1"
    );
    assert_eq!(url("  http://example.com  "), "http://example.com");
    assert_eq!(url("file:///tmp/x.html"), "file:///tmp/x.html");
    assert_eq!(url("about:blank"), "about:blank");
}

#[test]
fn bare_hosts_get_a_scheme() {
    assert_eq!(url("example.com"), "https://example.com");
    assert_eq!(url("www.example.org/path"), "https://www.example.org/path");
    assert_eq!(url("sub.example.co.uk"), "https://sub.example.co.uk");
    assert_eq!(url("example.com:8443/x"), "https://example.com:8443/x");
}

#[test]
fn local_and_numeric_hosts_use_http() {
    assert_eq!(url("localhost"), "http://localhost");
    assert_eq!(url("localhost:3000/app"), "http://localhost:3000/app");
    assert_eq!(url("127.0.0.1:8080"), "http://127.0.0.1:8080");
    assert_eq!(url("192.168.1.1/admin"), "http://192.168.1.1/admin");
}

#[test]
fn words_and_sentences_are_searches() {
    assert!(is_search("rust lifetimes"));
    assert!(is_search("hello"));
    assert!(is_search("what is example.com"));
    assert!(is_search("weather in rome"));
    assert!(is_search(""));
}

#[test]
fn dangerous_schemes_are_never_urls() {
    assert!(is_search("javascript:alert(1)"));
    assert!(is_search("data:text/html,hi"));
}

#[test]
fn unknown_tlds_are_ambiguous() {
    match classify("node.js") {
        Classified::Ambiguous { url, query } => {
            assert_eq!(url, "https://node.js");
            assert_eq!(query, "node.js");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn search_urls_are_percent_encoded() {
    let google = &default_engines()[0];
    assert_eq!(google.name, "Google");
    assert_eq!(
        google.search_url("rust & c++ \u{e9}"),
        "https://www.google.com/search?q=rust+%26+c%2B%2B+%C3%A9"
    );
}

fn cand(
    id: &str,
    kind: CandidateKind,
    title: &str,
    url: &str,
    open: bool,
    active: i64,
) -> Candidate {
    Candidate {
        id: id.into(),
        kind,
        title: title.into(),
        url: url.into(),
        is_open: open,
        last_active_at: active,
        weight: 0,
    }
}

fn pool() -> Vec<Candidate> {
    vec![
        cand(
            "mail",
            CandidateKind::Pinned,
            "Gmail",
            "https://mail.google.com/",
            false,
            10,
        ),
        cand(
            "gh",
            CandidateKind::Pinned,
            "GitHub",
            "https://github.com/",
            true,
            20,
        ),
        cand(
            "news",
            CandidateKind::Today,
            "Hacker News",
            "https://news.ycombinator.com/",
            true,
            30,
        ),
        cand(
            "docs",
            CandidateKind::Today,
            "Rust Docs",
            "https://doc.rust-lang.org/",
            false,
            40,
        ),
    ]
}

fn ids(r: &[Ranked]) -> Vec<&str> {
    r.iter().map(|r| r.candidate.id.as_str()).collect()
}

#[test]
fn every_token_must_match_title_or_url() {
    let p = pool();
    assert_eq!(ids(&rank("rust docs", &p, 10)), ["docs"]);
    assert_eq!(ids(&rank("RUST", &p, 10)), ["docs"]);
    assert!(rank("nomatch", &p, 10).is_empty());
}

#[test]
fn prefix_beats_substring_and_pinned_beats_today() {
    let p = pool();
    let r = rank("g", &p, 10);
    assert_eq!(
        ids(&r)[..2],
        ["gh", "mail"],
        "title prefix first: {:?}",
        ids(&r)
    );
}

#[test]
fn host_matches_count() {
    let p = pool();
    assert_eq!(ids(&rank("ycombinator", &p, 10)), ["news"]);
    assert_eq!(ids(&rank("github.com", &p, 10)), ["gh"]);
}

#[test]
fn an_empty_query_lists_open_tabs_most_recent_first() {
    let p = pool();
    assert_eq!(ids(&rank("", &p, 10)), ["news", "gh"]);
}

#[test]
fn the_limit_is_respected() {
    let p = pool();
    assert_eq!(rank("", &p, 1).len(), 1);
}

#[test]
fn an_explicit_url_comes_first_then_matches_then_search() {
    let google = &default_engines()[0];
    let s = suggest("https://github.com/rust", &pool(), google, 8);
    assert_eq!(s[0].kind, SuggestionKind::Url);
    assert_eq!(s[0].url, "https://github.com/rust");
    assert_eq!(s.last().unwrap().kind, SuggestionKind::Search);
}

#[test]
fn a_strong_match_beats_the_search_entry() {
    let google = &default_engines()[0];
    let s = suggest("gmail", &pool(), google, 8);
    assert_eq!(s[0].kind, SuggestionKind::Pinned);
    assert_eq!(s[0].id.as_deref(), Some("mail"));
    assert_eq!(s[1].kind, SuggestionKind::Search);
    assert_eq!(s[1].url, "https://www.google.com/search?q=gmail");
}

#[test]
fn without_matches_a_search_is_offered_first() {
    let google = &default_engines()[0];
    let s = suggest("rust lifetimes explained", &[], google, 8);
    assert_eq!(s.len(), 1);
    assert_eq!(s[0].kind, SuggestionKind::Search);
}

#[test]
fn a_bare_host_is_offered_as_url_first() {
    let google = &default_engines()[0];
    let s = suggest("example.com", &pool(), google, 8);
    assert_eq!(s[0].kind, SuggestionKind::Url);
    assert_eq!(s[0].url, "https://example.com");
}

#[test]
fn suggestions_respect_the_limit() {
    let google = &default_engines()[0];
    assert_eq!(suggest("", &pool(), google, 1).len(), 1);
}

fn history(url: &str, title: &str, weight: i32) -> Candidate {
    Candidate {
        id: String::new(),
        kind: CandidateKind::History,
        title: title.into(),
        url: url.into(),
        is_open: false,
        last_active_at: 0,
        weight,
    }
}

#[test]
fn history_fills_in_after_tabs_and_is_deduplicated() {
    let mut pool = pool();
    pool.push(history("https://github.com/", "GitHub", 30));
    pool.push(history("https://github.blog/", "The GitHub Blog", 5));
    let s = suggest("github", &pool, &default_engines()[0], 10);
    let kinds: Vec<_> = s.iter().map(|s| s.kind).collect();
    assert_eq!(s[0].kind, SuggestionKind::Pinned, "the tab comes first");
    assert_eq!(
        kinds
            .iter()
            .filter(|k| **k == SuggestionKind::History)
            .count(),
        1,
        "a page that is also a tab is not listed twice"
    );
    let blog = s
        .iter()
        .find(|s| s.kind == SuggestionKind::History)
        .unwrap();
    assert_eq!(blog.url, "https://github.blog/");
    assert_eq!(blog.id, None, "history has no node");
}

#[test]
fn history_weight_orders_history_and_empty_queries_skip_it() {
    let pool = vec![
        history("https://a.test/page", "page", 3),
        history("https://b.test/page", "page", 25),
    ];
    let ranked = rank("page", &pool, 10);
    assert_eq!(ranked[0].candidate.url, "https://b.test/page");
    assert!(rank("", &pool, 10).is_empty(), "no history without a query");
}

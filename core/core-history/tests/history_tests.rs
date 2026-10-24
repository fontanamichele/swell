/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use core_history::History;

const DAY: i64 = 86_400_000;
const NOW: i64 = 1_000 * DAY;

fn tokens(text: &str) -> Vec<String> {
    text.split_whitespace().map(str::to_lowercase).collect()
}

#[test]
fn identities_never_see_each_others_pages() {
    let history = History::open_in_memory().unwrap();
    history
        .record_visit("a", "https://bank.test/", "Bank", NOW, true)
        .unwrap();
    history
        .record_visit("b", "https://news.test/", "News", NOW, false)
        .unwrap();
    let a = history.search("a", &[], 10, NOW).unwrap();
    assert_eq!(a.len(), 1);
    assert_eq!(a[0].url, "https://bank.test/");
    assert!(history
        .search("b", &tokens("bank"), 10, NOW)
        .unwrap()
        .is_empty());
    assert_eq!(history.count("a").unwrap(), 1);
    assert_eq!(history.count("b").unwrap(), 1);
    assert_eq!(history.count("c").unwrap(), 0);
}

#[test]
fn only_web_pages_are_recorded() {
    let history = History::open_in_memory().unwrap();
    for url in [
        "about:blank",
        "chrome://swell/content/window.xhtml",
        "file:///etc/passwd",
        "view-source:https://a.test/",
        "data:text/html,hi",
    ] {
        history.record_visit("a", url, "x", NOW, false).unwrap();
    }
    history
        .record_visit(
            "a",
            &format!("https://a.test/{}", "x".repeat(3000)),
            "long",
            NOW,
            false,
        )
        .unwrap();
    assert_eq!(history.count("a").unwrap(), 0);
    history
        .record_visit("a", "http://plain.test/", "p", NOW, false)
        .unwrap();
    assert_eq!(history.count("a").unwrap(), 1);
}

#[test]
fn repeat_visits_count_and_titles_update() {
    let history = History::open_in_memory().unwrap();
    history
        .record_visit("a", "https://x.test/", "", NOW - DAY, false)
        .unwrap();
    history
        .record_visit("a", "https://x.test/", "X", NOW, true)
        .unwrap();
    history
        .record_visit("a", "https://x.test/", "", NOW - 5 * DAY, false)
        .unwrap();
    let entry = &history.search("a", &[], 10, NOW).unwrap()[0];
    assert_eq!(entry.visit_count, 3);
    assert_eq!(entry.typed_count, 1);
    assert_eq!(entry.title, "X", "an empty title keeps the known one");
    assert_eq!(
        entry.last_visit, NOW,
        "an older visit does not move last_visit back"
    );
    history
        .set_title("a", "https://x.test/", "X renamed")
        .unwrap();
    history
        .set_title("a", "https://unknown.test/", "ignored")
        .unwrap();
    assert_eq!(
        history.search("a", &[], 10, NOW).unwrap()[0].title,
        "X renamed"
    );
    assert_eq!(history.count("a").unwrap(), 1);
}

#[test]
fn search_needs_every_token_and_treats_wildcards_literally() {
    let history = History::open_in_memory().unwrap();
    history
        .record_visit(
            "a",
            "https://docs.test/rust/book",
            "The Rust Book",
            NOW,
            false,
        )
        .unwrap();
    history
        .record_visit("a", "https://docs.test/go/tour", "A Tour of Go", NOW, false)
        .unwrap();
    history
        .record_visit("a", "https://pct.test/100%_sure", "100% sure", NOW, false)
        .unwrap();
    assert_eq!(
        history
            .search("a", &tokens("rust book"), 10, NOW)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        history.search("a", &tokens("docs"), 10, NOW).unwrap().len(),
        2
    );
    assert!(history
        .search("a", &tokens("rust tour"), 10, NOW)
        .unwrap()
        .is_empty());
    assert_eq!(history.search("a", &tokens("%"), 10, NOW).unwrap().len(), 1);
    assert_eq!(history.search("a", &tokens("_"), 10, NOW).unwrap().len(), 1);
}

#[test]
fn frecency_prefers_frequent_typed_and_recent_pages() {
    let history = History::open_in_memory().unwrap();
    history
        .record_visit("a", "https://old.test/", "old", NOW - 200 * DAY, false)
        .unwrap();
    for _ in 0..5 {
        history
            .record_visit("a", "https://often.test/", "often", NOW - DAY, false)
            .unwrap();
    }
    history
        .record_visit("a", "https://typed.test/", "typed", NOW, true)
        .unwrap();
    history
        .record_visit("a", "https://new.test/", "new", NOW, false)
        .unwrap();
    let urls: Vec<String> = history
        .search("a", &[], 10, NOW)
        .unwrap()
        .into_iter()
        .map(|e| e.url)
        .collect();
    assert_eq!(
        urls,
        [
            "https://often.test/",
            "https://typed.test/",
            "https://new.test/",
            "https://old.test/"
        ]
    );
    assert_eq!(history.search("a", &[], 2, NOW).unwrap().len(), 2);
}

#[test]
fn clear_and_remove_only_touch_one_identity() {
    let history = History::open_in_memory().unwrap();
    for identity in ["a", "b"] {
        history
            .record_visit(identity, "https://x.test/", "x", NOW, false)
            .unwrap();
        history
            .record_visit(identity, "https://y.test/", "y", NOW, false)
            .unwrap();
    }
    history.remove_url("a", "https://x.test/").unwrap();
    assert_eq!(history.count("a").unwrap(), 1);
    assert_eq!(history.count("b").unwrap(), 2);
    assert_eq!(history.clear("a").unwrap(), 1);
    assert_eq!(history.count("a").unwrap(), 0);
    assert_eq!(history.count("b").unwrap(), 2);
}

#[test]
fn survives_reopening_and_refuses_a_newer_schema() {
    let dir = tempfile::tempdir().unwrap();
    {
        let history = History::open(dir.path()).unwrap();
        assert_eq!(history.schema_version().unwrap(), 1);
        history
            .record_visit("a", "https://x.test/", "x", NOW, false)
            .unwrap();
    }
    assert_eq!(History::open(dir.path()).unwrap().count("a").unwrap(), 1);
    let conn = rusqlite::Connection::open(dir.path().join("history.db")).unwrap();
    conn.pragma_update(None, "user_version", 99).unwrap();
    drop(conn);
    assert!(History::open(dir.path()).is_err());
}

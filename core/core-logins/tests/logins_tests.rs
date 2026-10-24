/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

use core_logins::{Login, Logins, LoginsError};

fn login(guid: &str, origin: &str, created: i64) -> Login {
    Login {
        guid: guid.into(),
        origin: origin.into(),
        form_action_origin: Some(origin.into()),
        http_realm: None,
        username_field: "user".into(),
        password_field: "pass".into(),
        encrypted_username: format!("enc-user-{guid}"),
        encrypted_password: format!("enc-pass-{guid}"),
        time_created: created,
        time_last_used: created,
        time_password_changed: created,
        times_used: 1,
    }
}

#[test]
fn identities_never_see_each_others_logins() {
    let logins = Logins::open_in_memory().unwrap();
    logins
        .add("a", &login("g1", "https://bank.test", 1))
        .unwrap();
    logins
        .add("b", &login("g2", "https://bank.test", 2))
        .unwrap();
    assert_eq!(logins.all("a").unwrap().len(), 1);
    assert_eq!(logins.all("a").unwrap()[0].guid, "g1");
    assert_eq!(logins.all("b").unwrap()[0].guid, "g2");
    assert!(logins.all("c").unwrap().is_empty());
    assert!(
        logins.get("a", "g2").unwrap().is_none(),
        "a guid of b is unknown to a"
    );
    let origins = vec!["https://bank.test".to_string()];
    assert_eq!(logins.for_origins("a", &origins).unwrap().len(), 1);
    assert_eq!(logins.count("b").unwrap(), 1);
}

#[test]
fn the_same_guid_may_exist_in_two_identities_but_not_twice_in_one() {
    let logins = Logins::open_in_memory().unwrap();
    logins
        .add("a", &login("same", "https://x.test", 1))
        .unwrap();
    logins
        .add("b", &login("same", "https://x.test", 1))
        .unwrap();
    assert!(matches!(
        logins.add("a", &login("same", "https://y.test", 1)),
        Err(LoginsError::Duplicate(_))
    ));
}

#[test]
fn update_remove_and_use_only_touch_their_identity() {
    let logins = Logins::open_in_memory().unwrap();
    logins.add("a", &login("g", "https://x.test", 1)).unwrap();
    logins.add("b", &login("g", "https://x.test", 1)).unwrap();
    let mut changed = login("g", "https://x.test", 1);
    changed.encrypted_password = "new".into();
    logins.update("a", &changed).unwrap();
    assert_eq!(
        logins.get("a", "g").unwrap().unwrap().encrypted_password,
        "new"
    );
    assert_eq!(
        logins.get("b", "g").unwrap().unwrap().encrypted_password,
        "enc-pass-g"
    );
    logins.record_use("a", "g", 50).unwrap();
    let used = logins.get("a", "g").unwrap().unwrap();
    assert_eq!((used.times_used, used.time_last_used), (2, 50));
    assert_eq!(logins.get("b", "g").unwrap().unwrap().times_used, 1);
    logins.remove("a", "g").unwrap();
    assert!(logins.get("a", "g").unwrap().is_none());
    assert!(logins.get("b", "g").unwrap().is_some());
    assert!(matches!(
        logins.remove("a", "g"),
        Err(LoginsError::NotFound(_))
    ));
    assert!(matches!(
        logins.update("a", &changed),
        Err(LoginsError::NotFound(_))
    ));
    assert!(matches!(
        logins.record_use("a", "g", 1),
        Err(LoginsError::NotFound(_))
    ));
}

#[test]
fn http_auth_logins_keep_a_realm_and_no_form_action() {
    let logins = Logins::open_in_memory().unwrap();
    let mut auth = login("auth", "https://intranet.test", 1);
    auth.form_action_origin = None;
    auth.http_realm = Some("Staff only".into());
    logins.add("a", &auth).unwrap();
    assert_eq!(logins.get("a", "auth").unwrap().unwrap(), auth);
}

#[test]
fn clear_forgets_one_identity_only() {
    let logins = Logins::open_in_memory().unwrap();
    for id in ["a", "b"] {
        logins.add(id, &login("g", "https://x.test", 1)).unwrap();
    }
    assert_eq!(logins.clear("a").unwrap(), 1);
    assert_eq!(logins.count("a").unwrap(), 0);
    assert_eq!(logins.count("b").unwrap(), 1);
}

#[test]
fn survives_reopening_and_refuses_a_newer_schema() {
    let dir = tempfile::tempdir().unwrap();
    {
        let logins = Logins::open(dir.path()).unwrap();
        assert_eq!(logins.schema_version().unwrap(), 1);
        logins.add("a", &login("g", "https://x.test", 1)).unwrap();
    }
    assert_eq!(Logins::open(dir.path()).unwrap().count("a").unwrap(), 1);
    let conn = rusqlite::Connection::open(dir.path().join("logins.db")).unwrap();
    conn.pragma_update(None, "user_version", 99).unwrap();
    drop(conn);
    assert!(Logins::open(dir.path()).is_err());
}

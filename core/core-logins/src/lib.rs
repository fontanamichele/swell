/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Saved logins, one set per identity. Every call names the identity and
//! never sees another's rows. The user name and password are opaque,
//! already encrypted strings: this crate has no key and does no crypto (the
//! window encrypts with a key of the identity that the system keychain
//! holds). Origins, field names and times are plain, like in Firefox's own
//! store, so logins can be found without decrypting everything. "Never save
//! for this site" is kept by the engine's permission manager, not here.

use rusqlite::{params, Connection, OptionalExtension, Row};
use std::path::Path;

const DB_FILE: &str = "logins.db";

const MIGRATIONS: &[&str] = &["
    CREATE TABLE logins (
        identity_id TEXT NOT NULL,
        guid TEXT NOT NULL,
        origin TEXT NOT NULL,
        form_action_origin TEXT,
        http_realm TEXT,
        username_field TEXT NOT NULL DEFAULT '',
        password_field TEXT NOT NULL DEFAULT '',
        encrypted_username TEXT NOT NULL,
        encrypted_password TEXT NOT NULL,
        time_created INTEGER NOT NULL,
        time_last_used INTEGER NOT NULL,
        time_password_changed INTEGER NOT NULL,
        times_used INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (identity_id, guid)
    ) WITHOUT ROWID;
    CREATE INDEX logins_by_origin ON logins(identity_id, origin);
"];

#[derive(Debug, thiserror::Error)]
pub enum LoginsError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("schema: {0}")]
    Schema(String),
    #[error("login {0} does not exist")]
    NotFound(String),
    #[error("login {0} exists already")]
    Duplicate(String),
}

pub type Result<T> = std::result::Result<T, LoginsError>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Login {
    pub guid: String,
    pub origin: String,
    /// `None` for a login of an HTTP authentication realm.
    pub form_action_origin: Option<String>,
    /// `None` for a login of a form.
    pub http_realm: Option<String>,
    pub username_field: String,
    pub password_field: String,
    pub encrypted_username: String,
    pub encrypted_password: String,
    pub time_created: i64,
    pub time_last_used: i64,
    pub time_password_changed: i64,
    pub times_used: u32,
}

pub struct Logins {
    conn: Connection,
}

const COLUMNS: &str = "guid, origin, form_action_origin, http_realm, username_field,
    password_field, encrypted_username, encrypted_password, time_created,
    time_last_used, time_password_changed, times_used";

fn from_row(row: &Row) -> rusqlite::Result<Login> {
    Ok(Login {
        guid: row.get(0)?,
        origin: row.get(1)?,
        form_action_origin: row.get(2)?,
        http_realm: row.get(3)?,
        username_field: row.get(4)?,
        password_field: row.get(5)?,
        encrypted_username: row.get(6)?,
        encrypted_password: row.get(7)?,
        time_created: row.get(8)?,
        time_last_used: row.get(9)?,
        time_password_changed: row.get(10)?,
        times_used: row.get(11)?,
    })
}

impl Logins {
    /// Opens (creating if needed) `logins.db` under `dir`.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        Self::from_connection(Connection::open(dir.join(DB_FILE))?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        let logins = Self { conn };
        logins.migrate()?;
        Ok(logins)
    }

    pub fn schema_version(&self) -> Result<usize> {
        let version: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |row| row.get(0))?;
        Ok(version as usize)
    }

    fn migrate(&self) -> Result<()> {
        let current = self.schema_version()?;
        if current > MIGRATIONS.len() {
            return Err(LoginsError::Schema(format!(
                "database is version {current}, this build understands up to {}",
                MIGRATIONS.len()
            )));
        }
        for (index, sql) in MIGRATIONS.iter().enumerate().skip(current) {
            let tx = self.conn.unchecked_transaction()?;
            tx.execute_batch(sql)?;
            tx.pragma_update(None, "user_version", (index + 1) as i64)?;
            tx.commit()?;
        }
        Ok(())
    }

    pub fn add(&self, identity: &str, login: &Login) -> Result<()> {
        if self.get(identity, &login.guid)?.is_some() {
            return Err(LoginsError::Duplicate(login.guid.clone()));
        }
        self.conn.execute(
            &format!(
                "INSERT INTO logins (identity_id, {COLUMNS})
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)"
            ),
            params![
                identity,
                login.guid,
                login.origin,
                login.form_action_origin,
                login.http_realm,
                login.username_field,
                login.password_field,
                login.encrypted_username,
                login.encrypted_password,
                login.time_created,
                login.time_last_used,
                login.time_password_changed,
                login.times_used,
            ],
        )?;
        Ok(())
    }

    /// Replaces the stored login with the same guid.
    pub fn update(&self, identity: &str, login: &Login) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE logins SET origin = ?3, form_action_origin = ?4, http_realm = ?5,
               username_field = ?6, password_field = ?7, encrypted_username = ?8,
               encrypted_password = ?9, time_created = ?10, time_last_used = ?11,
               time_password_changed = ?12, times_used = ?13
             WHERE identity_id = ?1 AND guid = ?2",
            params![
                identity,
                login.guid,
                login.origin,
                login.form_action_origin,
                login.http_realm,
                login.username_field,
                login.password_field,
                login.encrypted_username,
                login.encrypted_password,
                login.time_created,
                login.time_last_used,
                login.time_password_changed,
                login.times_used,
            ],
        )?;
        if changed == 0 {
            return Err(LoginsError::NotFound(login.guid.clone()));
        }
        Ok(())
    }

    pub fn get(&self, identity: &str, guid: &str) -> Result<Option<Login>> {
        Ok(self
            .conn
            .query_row(
                &format!("SELECT {COLUMNS} FROM logins WHERE identity_id = ?1 AND guid = ?2"),
                params![identity, guid],
                from_row,
            )
            .optional()?)
    }

    /// Every login of the identity, oldest first.
    pub fn all(&self, identity: &str) -> Result<Vec<Login>> {
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM logins WHERE identity_id = ?1
             ORDER BY time_created, guid"
        ))?;
        let rows = stmt.query_map(params![identity], from_row)?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }

    /// The identity's logins whose origin is one of `origins`.
    pub fn for_origins(&self, identity: &str, origins: &[String]) -> Result<Vec<Login>> {
        let mut found = Vec::new();
        let mut stmt = self.conn.prepare(&format!(
            "SELECT {COLUMNS} FROM logins WHERE identity_id = ?1 AND origin = ?2
             ORDER BY time_created, guid"
        ))?;
        for origin in origins {
            let rows = stmt.query_map(params![identity, origin], from_row)?;
            for row in rows {
                found.push(row?);
            }
        }
        Ok(found)
    }

    pub fn count(&self, identity: &str) -> Result<u64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM logins WHERE identity_id = ?1",
            params![identity],
            |row| row.get::<_, i64>(0),
        )? as u64)
    }

    pub fn remove(&self, identity: &str, guid: &str) -> Result<()> {
        let changed = self.conn.execute(
            "DELETE FROM logins WHERE identity_id = ?1 AND guid = ?2",
            params![identity, guid],
        )?;
        if changed == 0 {
            return Err(LoginsError::NotFound(guid.to_owned()));
        }
        Ok(())
    }

    /// Forgets every login of one identity.
    pub fn clear(&self, identity: &str) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM logins WHERE identity_id = ?1",
            params![identity],
        )?)
    }

    pub fn record_use(&self, identity: &str, guid: &str, at_ms: i64) -> Result<()> {
        let changed = self.conn.execute(
            "UPDATE logins SET times_used = times_used + 1, time_last_used = ?3
             WHERE identity_id = ?1 AND guid = ?2",
            params![identity, guid, at_ms],
        )?;
        if changed == 0 {
            return Err(LoginsError::NotFound(guid.to_owned()));
        }
        Ok(())
    }
}

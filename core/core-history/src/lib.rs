/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

//! Browsing history. Every page is stored for one identity (the container of
//! its space); a lookup always names the identity and never sees another's
//! rows. Nothing here lists history across identities.

use rusqlite::{params, Connection, OptionalExtension};
use std::path::Path;

const DB_FILE: &str = "history.db";
const MAX_URL_LENGTH: usize = 2048;
const MAX_TITLE_LENGTH: usize = 512;
/// Rows read from SQL before ranking by frecency.
const SCAN_LIMIT: i64 = 400;

const MIGRATIONS: &[&str] = &["
    CREATE TABLE pages (
        identity_id TEXT NOT NULL,
        url TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        visit_count INTEGER NOT NULL DEFAULT 0,
        typed_count INTEGER NOT NULL DEFAULT 0,
        last_visit INTEGER NOT NULL,
        PRIMARY KEY (identity_id, url)
    ) WITHOUT ROWID;
    CREATE INDEX pages_by_recency ON pages(identity_id, last_visit DESC);
"];

#[derive(Debug, thiserror::Error)]
pub enum HistoryError {
    #[error("sqlite: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("schema: {0}")]
    Schema(String),
}

pub type Result<T> = std::result::Result<T, HistoryError>;

#[derive(Clone, Debug, PartialEq)]
pub struct HistoryEntry {
    pub url: String,
    pub title: String,
    pub visit_count: u32,
    pub typed_count: u32,
    pub last_visit: i64,
    pub frecency: f64,
}

pub struct History {
    conn: Connection,
}

/// Only web pages are history; error pages, `about:` and the like are not.
fn storable(url: &str) -> bool {
    (url.starts_with("https://") || url.starts_with("http://")) && url.len() <= MAX_URL_LENGTH
}

fn truncate(text: &str, max: usize) -> &str {
    match text.char_indices().nth(max) {
        Some((end, _)) => &text[..end],
        None => text,
    }
}

/// Visits count more the more recent they are, typed ones three times as much.
fn frecency(visit_count: u32, typed_count: u32, last_visit: i64, now_ms: i64) -> f64 {
    const DAY: i64 = 86_400_000;
    let age = (now_ms - last_visit).max(0);
    let recency = match age {
        a if a < 4 * DAY => 1.0,
        a if a < 14 * DAY => 0.7,
        a if a < 31 * DAY => 0.5,
        a if a < 90 * DAY => 0.3,
        _ => 0.1,
    };
    (f64::from(visit_count.min(20)) + 3.0 * f64::from(typed_count.min(10))) * recency
}

fn like_pattern(token: &str) -> String {
    let mut pattern = String::from("%");
    for c in token.chars() {
        if matches!(c, '%' | '_' | '\\') {
            pattern.push('\\');
        }
        pattern.push(c);
    }
    pattern.push('%');
    pattern
}

impl History {
    /// Opens (creating if needed) `history.db` under `dir`.
    pub fn open(dir: &Path) -> Result<Self> {
        std::fs::create_dir_all(dir)?;
        Self::from_connection(Connection::open(dir.join(DB_FILE))?)
    }

    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;
        let history = Self { conn };
        history.migrate()?;
        Ok(history)
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
            return Err(HistoryError::Schema(format!(
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

    /// A visit of `url` in `identity`. Pages that are not http(s) are ignored.
    pub fn record_visit(
        &self,
        identity: &str,
        url: &str,
        title: &str,
        at_ms: i64,
        typed: bool,
    ) -> Result<()> {
        if !storable(url) {
            return Ok(());
        }
        self.conn.execute(
            "INSERT INTO pages (identity_id, url, title, visit_count, typed_count, last_visit)
             VALUES (?1, ?2, ?3, 1, ?4, ?5)
             ON CONFLICT (identity_id, url) DO UPDATE SET
               title = CASE WHEN excluded.title <> '' THEN excluded.title ELSE pages.title END,
               visit_count = pages.visit_count + 1,
               typed_count = pages.typed_count + excluded.typed_count,
               last_visit = MAX(pages.last_visit, excluded.last_visit)",
            params![
                identity,
                url,
                truncate(title, MAX_TITLE_LENGTH),
                i64::from(typed),
                at_ms
            ],
        )?;
        Ok(())
    }

    /// Updates the title of an already recorded page; unknown pages are ignored.
    pub fn set_title(&self, identity: &str, url: &str, title: &str) -> Result<()> {
        if title.is_empty() {
            return Ok(());
        }
        self.conn.execute(
            "UPDATE pages SET title = ?3 WHERE identity_id = ?1 AND url = ?2",
            params![identity, url, truncate(title, MAX_TITLE_LENGTH)],
        )?;
        Ok(())
    }

    /// Pages of `identity` whose title or URL contains every token, best first.
    pub fn search(
        &self,
        identity: &str,
        tokens: &[String],
        limit: usize,
        now_ms: i64,
    ) -> Result<Vec<HistoryEntry>> {
        let mut sql = String::from(
            "SELECT url, title, visit_count, typed_count, last_visit FROM pages
             WHERE identity_id = ?1",
        );
        let mut values: Vec<String> = vec![identity.to_owned()];
        for token in tokens {
            values.push(like_pattern(token));
            let n = values.len();
            sql.push_str(&format!(
                " AND (title LIKE ?{n} ESCAPE '\\' OR url LIKE ?{n} ESCAPE '\\')"
            ));
        }
        sql.push_str(&format!(" ORDER BY last_visit DESC LIMIT {SCAN_LIMIT}"));
        let mut stmt = self.conn.prepare(&sql)?;
        let mut entries = stmt
            .query_map(rusqlite::params_from_iter(values.iter()), |row| {
                let visit_count: u32 = row.get(2)?;
                let typed_count: u32 = row.get(3)?;
                let last_visit: i64 = row.get(4)?;
                Ok(HistoryEntry {
                    url: row.get(0)?,
                    title: row.get(1)?,
                    visit_count,
                    typed_count,
                    last_visit,
                    frecency: frecency(visit_count, typed_count, last_visit, now_ms),
                })
            })?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        entries.sort_by(|a, b| {
            b.frecency
                .total_cmp(&a.frecency)
                .then(b.last_visit.cmp(&a.last_visit))
                .then_with(|| a.url.cmp(&b.url))
        });
        entries.truncate(limit);
        Ok(entries)
    }

    pub fn count(&self, identity: &str) -> Result<u64> {
        Ok(self.conn.query_row(
            "SELECT COUNT(*) FROM pages WHERE identity_id = ?1",
            params![identity],
            |row| row.get::<_, i64>(0),
        )? as u64)
    }

    pub fn visit_count(&self, identity: &str, url: &str) -> Result<Option<u32>> {
        Ok(self
            .conn
            .query_row(
                "SELECT visit_count FROM pages WHERE identity_id = ?1 AND url = ?2",
                params![identity, url],
                |row| row.get(0),
            )
            .optional()?)
    }

    pub fn remove_url(&self, identity: &str, url: &str) -> Result<()> {
        self.conn.execute(
            "DELETE FROM pages WHERE identity_id = ?1 AND url = ?2",
            params![identity, url],
        )?;
        Ok(())
    }

    /// Forgets everything of one identity; returns how many pages went.
    pub fn clear(&self, identity: &str) -> Result<usize> {
        Ok(self.conn.execute(
            "DELETE FROM pages WHERE identity_id = ?1",
            params![identity],
        )?)
    }
}

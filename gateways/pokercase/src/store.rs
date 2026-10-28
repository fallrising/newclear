use std::path::Path;
use std::sync::{Arc, Mutex};

use anyhow::{Context, Result};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::secrets::{self, SecretBox, StoredKind};

#[derive(Clone)]
pub struct Store {
    conn: Arc<Mutex<Connection>>,
    secrets: Arc<SecretBox>,
}

const KEY_CHECK_PLAINTEXT: &str = "thinrouter-key-check";

/// Column order shared by the connection SELECT statements and row decoder.
type ConnectionSqlRow = (
    String,
    String,
    String,
    String,
    Option<String>,
    i64,
    bool,
    Option<f64>,
    Option<f64>,
    String,
    String,
    String,
);

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OAuthCreds {
    pub provider: String,
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
    pub meta: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionRow {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key: String,
    pub default_model: Option<String>,
    pub priority: i64,
    pub enabled: bool,
    /// USD per 1M input tokens (optional, for cost estimate).
    pub input_price_per_m: Option<f64>,
    /// USD per 1M output tokens.
    pub output_price_per_m: Option<f64>,
    /// `api_key` | `oauth_import`
    pub auth_type: String,
    pub oauth: Option<OAuthCreds>,
    pub created_at: String,
    pub updated_at: String,
}

impl ConnectionRow {
    /// Bearer token for upstream Authorization header.
    pub fn bearer_token(&self) -> &str {
        if self.auth_type == "oauth_import" {
            if let Some(o) = &self.oauth {
                if !o.access_token.is_empty() {
                    return o.access_token.as_str();
                }
            }
        }
        self.api_key.as_str()
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectionPublic {
    pub id: String,
    pub name: String,
    pub base_url: String,
    pub api_key_masked: String,
    pub default_model: Option<String>,
    pub priority: i64,
    pub enabled: bool,
    pub input_price_per_m: Option<f64>,
    pub output_price_per_m: Option<f64>,
    pub auth_type: String,
    pub provider: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

impl From<ConnectionRow> for ConnectionPublic {
    fn from(c: ConnectionRow) -> Self {
        let provider = c.oauth.as_ref().map(|o| o.provider.clone());
        let masked = if c.auth_type == "oauth_import" {
            c.oauth
                .as_ref()
                .map(|o| mask_secret(&o.access_token))
                .unwrap_or_else(|| "oauth".into())
        } else {
            mask_secret(&c.api_key)
        };
        Self {
            id: c.id,
            name: c.name,
            base_url: c.base_url,
            api_key_masked: masked,
            default_model: c.default_model,
            priority: c.priority,
            enabled: c.enabled,
            input_price_per_m: c.input_price_per_m,
            output_price_per_m: c.output_price_per_m,
            auth_type: c.auth_type,
            provider,
            created_at: c.created_at,
            updated_at: c.updated_at,
        }
    }
}

/// Coverage of non-null stored estimates, not a billing/provenance guarantee.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CostCoverageStatus {
    NoData,
    Unknown,
    Partial,
    Complete,
    Unavailable,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageCostSummary {
    pub known_sum: Option<f64>,
    pub known_count: i64,
    pub unknown_count: i64,
    pub total_count: i64,
    pub coverage: Option<f64>,
    pub status: CostCoverageStatus,
    pub basis: String,
}

impl UsageCostSummary {
    pub fn from_observations(sum: Option<f64>, known_count: i64, total_count: i64) -> Self {
        let known_sum = sum.filter(|v| v.is_finite());
        let status = if total_count == 0 {
            CostCoverageStatus::NoData
        } else if known_count == 0 {
            CostCoverageStatus::Unknown
        } else if known_sum.is_none() {
            CostCoverageStatus::Unavailable
        } else if known_count == total_count {
            CostCoverageStatus::Complete
        } else {
            CostCoverageStatus::Partial
        };
        Self {
            known_sum,
            known_count,
            unknown_count: total_count - known_count,
            total_count,
            coverage: (total_count > 0).then(|| known_count as f64 / total_count as f64),
            status,
            basis: "stored_estimate_usd".into(),
        }
    }

    pub fn complete_total(&self) -> Option<f64> {
        match self.status {
            CostCoverageStatus::Complete => self.known_sum,
            _ => None,
        }
    }
}

impl std::fmt::Display for UsageCostSummary {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let rows = format!("{}/{} rows", self.known_count, self.total_count);
        match (&self.status, self.known_sum) {
            (CostCoverageStatus::NoData, _) => write!(f, "est. cost: no data (0 rows)"),
            (CostCoverageStatus::Unknown, _) => write!(f, "est. cost: unknown ({rows})"),
            (CostCoverageStatus::Partial, Some(v)) => write!(f, "partial est. ${v:.6} ({rows})"),
            (CostCoverageStatus::Complete, Some(v)) => write!(f, "est. total ${v:.6} ({rows})"),
            _ => write!(f, "est. cost: unavailable ({rows})"),
        }
    }
}

fn query_cost_summary(conn: &Connection) -> Result<UsageCostSummary> {
    Ok(conn.query_row(
        "SELECT SUM(estimated_cost_usd), COUNT(estimated_cost_usd), COUNT(*) FROM usage_events",
        [],
        |r| {
            Ok(UsageCostSummary::from_observations(
                r.get(0)?,
                r.get(1)?,
                r.get(2)?,
            ))
        },
    )?)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageDayRow {
    pub day: String,
    pub requests: i64,
    pub ok: i64,
    pub errors: i64,
    pub incomplete: i64,
    /// Includes reservations that have not been finalized.
    pub unknown: i64,
    pub headers_200: i64,
    pub pending: i64,
    pub prompt_tokens: i64,
    pub completion_tokens: i64,
    pub estimated_cost_usd: Option<f64>,
    pub cost_summary: UsageCostSummary,
    pub avg_latency_ms: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteRow {
    pub id: String,
    pub public_model: String,
    pub strategy: String,
    pub created_at: String,
    pub targets: Vec<RouteTarget>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteTarget {
    pub connection_id: String,
    pub connection_name: Option<String>,
    pub model_override: Option<String>,
    pub position: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiKeyRow {
    pub id: String,
    pub name: String,
    pub key_prefix: String,
    pub enabled: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UsageEvent {
    pub id: i64,
    pub ts: String,
    pub public_model: Option<String>,
    pub connection_id: Option<String>,
    pub status: Option<i64>,
    pub latency_ms: Option<i64>,
    pub error: Option<String>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
    pub request_id: Option<String>,
    pub attempt_id: Option<String>,
    pub upstream_model: Option<String>,
    pub finalized_at: Option<String>,
    pub headers_ms: Option<i64>,
    pub first_output_ms: Option<i64>,
    pub total_observed_ms: Option<i64>,
    pub outcome: String,
    pub usage_status: String,
    pub usage_source: String,
}

/// Observations from one owned stream attempt; no upstream text is accepted.
#[derive(Debug, Clone)]
pub struct StreamFinalization {
    pub outcome: &'static str,
    pub usage_status: &'static str,
    pub error: Option<&'static str>,
    pub prompt_tokens: Option<i64>,
    pub completion_tokens: Option<i64>,
    pub estimated_cost_usd: Option<f64>,
    pub first_output_ms: Option<i64>,
    pub total_observed_ms: i64,
}

impl Default for StreamFinalization {
    fn default() -> Self {
        Self {
            outcome: "unknown",
            usage_status: "missing",
            error: None,
            prompt_tokens: None,
            completion_tokens: None,
            estimated_cost_usd: None,
            first_output_ms: None,
            total_observed_ms: 0,
        }
    }
}

impl StreamFinalization {
    fn validate(&self) -> Result<()> {
        let valid_outcome = matches!(
            self.outcome,
            "succeeded"
                | "failed"
                | "cancelled"
                | "timeout"
                | "interrupted"
                | "incomplete"
                | "unknown"
        );
        let valid_usage = matches!(
            self.usage_status,
            "complete" | "partial" | "missing" | "invalid" | "unknown"
        );
        let valid_error = matches!(
            self.error,
            None | Some(
                "upstream_attempt_failed"
                    | "upstream_http_error"
                    | "upstream_transport_error"
                    | "stream_error"
                    | "stream_incomplete"
                    | "stream_cancelled"
                    | "stream_timeout"
                    | "stream_interrupted"
                    | "stream_observer_limit"
                    | "stream_observer_invalid"
                    | "stream_invalid_usage"
                    | "stream_conversion_failed"
            )
        );
        let counts_valid = self.prompt_tokens.is_none_or(|v| v >= 0)
            && self.completion_tokens.is_none_or(|v| v >= 0);
        let both_counts = self.prompt_tokens.is_some() && self.completion_tokens.is_some();
        let no_counts = self.prompt_tokens.is_none() && self.completion_tokens.is_none();
        let quality_valid = match self.usage_status {
            "complete" => both_counts,
            // A cancelled tail can leave both counters observed but not complete.
            "partial" => !no_counts,
            "missing" | "unknown" => no_counts,
            _ => true,
        };
        let cost_valid = self.estimated_cost_usd.is_none_or(|v| {
            v.is_finite() && v >= 0.0 && self.usage_status == "complete" && both_counts
        });
        let time_valid = self.total_observed_ms >= 0
            && self
                .first_output_ms
                .is_none_or(|v| v >= 0 && v <= self.total_observed_ms);
        anyhow::ensure!(
            valid_outcome
                && valid_usage
                && valid_error
                && counts_valid
                && quality_valid
                && cost_valid
                && time_valid,
            "invalid_stream_finalization"
        );
        Ok(())
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedTarget {
    pub connection: ConnectionRow,
    pub upstream_model: String,
}

impl Store {
    /// Open the database. Secrets are encrypted with an Argon2id key derived from
    /// `secrets_key`, or with the random key file `secrets.key` beside the database.
    pub fn open(path: &Path, secrets_key: Option<String>) -> Result<Self> {
        let conn =
            Connection::open(path).with_context(|| format!("open sqlite {}", path.display()))?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA foreign_keys = ON;
            ",
        )?;
        migrate_schema(&conn)?;
        let source = if secrets_key.is_some() {
            "passphrase"
        } else {
            "key_file"
        };
        let secrets = match secrets_key.as_deref() {
            Some(pass) => {
                let salt = match meta_get(&conn, "kdf_salt")? {
                    Some(hex_salt) => hex::decode(hex_salt).context("corrupt kdf_salt")?,
                    None => {
                        let salt = secrets::random_salt();
                        meta_set(&conn, "kdf_salt", &hex::encode(salt))?;
                        salt.to_vec()
                    }
                };
                SecretBox::from_passphrase(pass, &salt)?
            }
            None => {
                let dir = path.parent().unwrap_or_else(|| Path::new("."));
                SecretBox::from_key_file(&dir.join("secrets.key"))?
            }
        };
        if let Some(check) = meta_get(&conn, "key_check")? {
            let ok = secrets
                .decrypt(&check)
                .is_ok_and(|v| v == KEY_CHECK_PLAINTEXT);
            if !ok {
                let used = meta_get(&conn, "key_source")?.unwrap_or_default();
                anyhow::bail!(
                    "secrets key does not match this database (it was encrypted with: {used}); \
                     pass the same --secrets-key, or keep the original secrets.key file"
                );
            }
        }
        migrate_secrets(&conn, &secrets)?;
        // The claude and cursor providers run their local CLIs; stored Claude / Cursor
        // tokens are never used again, so they are not kept.
        let cleared = conn.execute(
            "UPDATE oauth_credentials SET access_token = '', refresh_token = NULL, expires_at = NULL
             WHERE provider IN ('claude', 'cc', 'anthropic', 'claude_code', 'cursor', 'cu')
               AND (access_token != '' OR refresh_token IS NOT NULL)",
            [],
        )?;
        if cleared > 0 {
            tracing::info!(
                cleared,
                "removed stored Claude/Cursor tokens (now answered by their CLIs)"
            );
        }
        // The codex (ChatGPT backend-api) provider was removed in favour of siwc. Its rows
        // would otherwise be forwarded as an unknown provider with the old token, so they
        // are disabled and their tokens dropped; sign in with `login-siwc` instead.
        let retired = conn.execute(
            "UPDATE connections SET enabled = 0 WHERE enabled = 1 AND id IN (
                 SELECT connection_id FROM oauth_credentials
                 WHERE provider IN ('codex', 'cx', 'openai_codex', 'chatgpt_codex'))",
            [],
        )?;
        conn.execute(
            "UPDATE oauth_credentials SET access_token = '', refresh_token = NULL, expires_at = NULL
             WHERE provider IN ('codex', 'cx', 'openai_codex', 'chatgpt_codex')
               AND (access_token != '' OR refresh_token IS NOT NULL)",
            [],
        )?;
        // Grok logins imported from ~/.grok/auth.json are borrowed (borrowed.rs): their
        // rotating refresh token belongs to the Grok CLI, so no copy is kept.
        conn.execute(
            "UPDATE oauth_credentials SET refresh_token = NULL
             WHERE provider = 'grok' AND refresh_token IS NOT NULL
               AND meta LIKE '%.grok/auth.json%'",
            [],
        )?;
        if retired > 0 {
            tracing::warn!(
                retired,
                "disabled codex connections (provider removed; use login-siwc)"
            );
        }
        if meta_get(&conn, "key_check")?.is_none() {
            meta_set(&conn, "key_check", &secrets.encrypt(KEY_CHECK_PLAINTEXT))?;
            meta_set(&conn, "key_source", source)?;
        }
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            secrets: Arc::new(secrets),
        })
    }
}

fn meta_get(conn: &Connection, key: &str) -> Result<Option<String>> {
    Ok(conn
        .query_row("SELECT value FROM meta WHERE key = ?1", params![key], |r| {
            r.get(0)
        })
        .optional()?)
}

fn meta_set(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

/// Re-encrypt plaintext and `enc:v1:` secrets as v2 in one transaction.
fn migrate_secrets(conn: &Connection, secrets: &SecretBox) -> Result<()> {
    let columns: [(&str, &str, &str); 3] = [
        ("connections", "id", "api_key"),
        ("oauth_credentials", "connection_id", "access_token"),
        ("oauth_credentials", "connection_id", "refresh_token"),
    ];
    let tx = conn.unchecked_transaction()?;
    let mut migrated = 0usize;
    for (table, id_col, col) in columns {
        let rows: Vec<(String, String)> = {
            let mut stmt = tx.prepare(&format!(
                "SELECT {id_col}, {col} FROM {table} WHERE {col} IS NOT NULL"
            ))?;
            let mapped = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?;
            mapped.collect::<rusqlite::Result<_>>()?
        };
        for (id, stored) in rows {
            let plain = match secrets::classify(&stored) {
                StoredKind::Empty | StoredKind::V2 => continue,
                StoredKind::V1 => secrets.decrypt_legacy_v1(&stored)?,
                StoredKind::Plaintext => stored,
            };
            tx.execute(
                &format!("UPDATE {table} SET {col} = ?1 WHERE {id_col} = ?2"),
                params![secrets.encrypt(&plain), id],
            )?;
            migrated += 1;
        }
    }
    tx.commit()?;
    if migrated > 0 {
        tracing::info!(migrated, "re-encrypted stored secrets as enc:v2");
    }
    Ok(())
}

fn migrate_schema(conn: &Connection) -> Result<()> {
    // Schema inspection and all additive changes commit together. Existing rows
    // retain their values and receive only unknown provenance defaults.
    let tx = conn.unchecked_transaction()?;
    tx.execute_batch(
        r#"
            CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            -- Saved Claude Code sessions of idle runs that were ended, for --resume.
            -- Only hashes of the conversation are kept, never its text.
            CREATE TABLE IF NOT EXISTS claude_shelf (
                session_id TEXT PRIMARY KEY,
                signature TEXT NOT NULL,
                known TEXT NOT NULL,
                saved_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                base_url TEXT NOT NULL,
                api_key TEXT NOT NULL,
                default_model TEXT,
                priority INTEGER NOT NULL DEFAULT 100,
                enabled INTEGER NOT NULL DEFAULT 1,
                input_price_per_m REAL,
                output_price_per_m REAL,
                auth_type TEXT NOT NULL DEFAULT 'api_key',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS routes (
                id TEXT PRIMARY KEY,
                public_model TEXT NOT NULL UNIQUE,
                strategy TEXT NOT NULL DEFAULT 'fallback',
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS route_targets (
                route_id TEXT NOT NULL,
                connection_id TEXT NOT NULL,
                model_override TEXT,
                position INTEGER NOT NULL,
                PRIMARY KEY (route_id, position),
                FOREIGN KEY (route_id) REFERENCES routes(id) ON DELETE CASCADE,
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS api_keys (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                key_hash TEXT NOT NULL UNIQUE,
                key_prefix TEXT NOT NULL,
                enabled INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS usage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts TEXT NOT NULL,
                public_model TEXT,
                connection_id TEXT,
                status INTEGER,
                latency_ms INTEGER,
                error TEXT
            );

            CREATE TABLE IF NOT EXISTS oauth_credentials (
                connection_id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                access_token TEXT NOT NULL,
                refresh_token TEXT,
                expires_at TEXT,
                meta TEXT,
                FOREIGN KEY (connection_id) REFERENCES connections(id) ON DELETE CASCADE
            );
            "#,
    )?;
    for (table, additions) in [
        (
            "connections",
            &[
                ("input_price_per_m", "REAL"),
                ("output_price_per_m", "REAL"),
                ("auth_type", "TEXT NOT NULL DEFAULT 'api_key'"),
            ][..],
        ),
        (
            "usage_events",
            &[
                ("prompt_tokens", "INTEGER"),
                ("completion_tokens", "INTEGER"),
                ("estimated_cost_usd", "REAL"),
                ("request_id", "TEXT"),
                ("attempt_id", "TEXT"),
                ("upstream_model", "TEXT"),
                ("finalized_at", "TEXT"),
                ("headers_ms", "INTEGER"),
                ("first_output_ms", "INTEGER"),
                ("total_observed_ms", "INTEGER"),
                ("outcome", "TEXT NOT NULL DEFAULT 'unknown'"),
                ("usage_status", "TEXT NOT NULL DEFAULT 'unknown'"),
                ("usage_source", "TEXT NOT NULL DEFAULT 'unknown'"),
            ][..],
        ),
    ] {
        let columns: Vec<String> = tx
            .prepare(&format!("PRAGMA table_info({table})"))?
            .query_map([], |row| row.get(1))?
            .collect::<rusqlite::Result<_>>()?;
        for (name, definition) in additions {
            if !columns.iter().any(|column| column == name) {
                tx.execute(
                    &format!("ALTER TABLE {table} ADD COLUMN {name} {definition}"),
                    [],
                )?;
            }
        }
    }
    tx.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS usage_events_attempt_id ON usage_events(attempt_id)",
        [],
    )?;
    tx.commit()?;
    Ok(())
}

impl Store {
    fn dec_key(&self, stored: &str) -> Result<String> {
        if stored.is_empty() {
            return Ok(String::new());
        }
        self.secrets.decrypt(stored)
    }

    fn enc_key(&self, plain: &str) -> String {
        self.secrets.encrypt(plain)
    }

    #[allow(clippy::too_many_arguments)]
    fn map_connection_row(
        &self,
        id: String,
        name: String,
        base_url: String,
        api_key: String,
        default_model: Option<String>,
        priority: i64,
        enabled: bool,
        input_price_per_m: Option<f64>,
        output_price_per_m: Option<f64>,
        auth_type: String,
        created_at: String,
        updated_at: String,
        oauth: Option<OAuthCreds>,
    ) -> Result<ConnectionRow> {
        let oauth = match oauth {
            Some(mut o) => {
                o.access_token = self.dec_key(&o.access_token)?;
                if let Some(r) = o.refresh_token.take() {
                    o.refresh_token = Some(self.dec_key(&r)?);
                }
                Some(o)
            }
            None => None,
        };
        Ok(ConnectionRow {
            api_key: self
                .dec_key(&api_key)
                .with_context(|| format!("connection {name}"))?,
            id,
            name,
            base_url,
            default_model,
            priority,
            enabled,
            input_price_per_m,
            output_price_per_m,
            auth_type,
            oauth,
            created_at,
            updated_at,
        })
    }

    fn load_oauth_locked(conn: &Connection, connection_id: &str) -> Result<Option<OAuthCreds>> {
        conn.query_row(
            "SELECT provider, access_token, refresh_token, expires_at, meta
             FROM oauth_credentials WHERE connection_id = ?1",
            params![connection_id],
            |row| {
                Ok(OAuthCreds {
                    provider: row.get(0)?,
                    access_token: row.get(1)?,
                    refresh_token: row.get(2)?,
                    expires_at: row.get(3)?,
                    meta: row.get(4)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    fn row_tuple(row: &rusqlite::Row<'_>) -> rusqlite::Result<ConnectionSqlRow> {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, i64>(5)?,
            row.get::<_, i64>(6)? != 0,
            row.get::<_, Option<f64>>(7)?,
            row.get::<_, Option<f64>>(8)?,
            row.get::<_, Option<String>>(9)?
                .unwrap_or_else(|| "api_key".into()),
            row.get::<_, String>(10)?,
            row.get::<_, String>(11)?,
        ))
    }

    pub fn list_connections(&self) -> Result<Vec<ConnectionRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, base_url, api_key, default_model, priority, enabled,
                    input_price_per_m, output_price_per_m, auth_type, created_at, updated_at
             FROM connections ORDER BY priority ASC, name ASC",
        )?;
        let rows = stmt.query_map([], Self::row_tuple)?;
        let mut out = Vec::new();
        for r in rows {
            let (id, name, base_url, api_key, dm, pr, en, ip, op, at, ca, ua) = r?;
            let oauth = Self::load_oauth_locked(&conn, &id)?;
            out.push(self.map_connection_row(
                id, name, base_url, api_key, dm, pr, en, ip, op, at, ca, ua, oauth,
            )?);
        }
        Ok(out)
    }

    pub fn get_connection(&self, id: &str) -> Result<Option<ConnectionRow>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, name, base_url, api_key, default_model, priority, enabled,
                        input_price_per_m, output_price_per_m, auth_type, created_at, updated_at
                 FROM connections WHERE id = ?1",
                params![id],
                Self::row_tuple,
            )
            .optional()?;
        let Some((id, name, base_url, api_key, dm, pr, en, ip, op, at, ca, ua)) = row else {
            return Ok(None);
        };
        let oauth = Self::load_oauth_locked(&conn, &id)?;
        Ok(Some(self.map_connection_row(
            id, name, base_url, api_key, dm, pr, en, ip, op, at, ca, ua, oauth,
        )?))
    }

    pub fn get_connection_by_name(&self, name: &str) -> Result<Option<ConnectionRow>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, name, base_url, api_key, default_model, priority, enabled,
                        input_price_per_m, output_price_per_m, auth_type, created_at, updated_at
                 FROM connections WHERE name = ?1",
                params![name],
                Self::row_tuple,
            )
            .optional()?;
        let Some((id, name, base_url, api_key, dm, pr, en, ip, op, at, ca, ua)) = row else {
            return Ok(None);
        };
        let oauth = Self::load_oauth_locked(&conn, &id)?;
        Ok(Some(self.map_connection_row(
            id, name, base_url, api_key, dm, pr, en, ip, op, at, ca, ua, oauth,
        )?))
    }

    #[allow(clippy::too_many_arguments)]
    pub fn upsert_connection(
        &self,
        id: Option<String>,
        name: &str,
        base_url: &str,
        api_key: &str,
        default_model: Option<&str>,
        priority: i64,
        enabled: bool,
        input_price_per_m: Option<f64>,
        output_price_per_m: Option<f64>,
    ) -> Result<ConnectionRow> {
        let now = Utc::now().to_rfc3339();
        let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let stored_key = if api_key.is_empty() {
            String::new()
        } else {
            self.enc_key(api_key)
        };
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO connections (id, name, base_url, api_key, default_model, priority, enabled,
                                      input_price_per_m, output_price_per_m, auth_type, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'api_key', ?10, ?10)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               base_url = excluded.base_url,
               api_key = CASE WHEN excluded.api_key = '' THEN connections.api_key ELSE excluded.api_key END,
               default_model = excluded.default_model,
               priority = excluded.priority,
               enabled = excluded.enabled,
               input_price_per_m = excluded.input_price_per_m,
               output_price_per_m = excluded.output_price_per_m,
               updated_at = excluded.updated_at",
            params![
                id,
                name,
                base_url.trim_end_matches('/'),
                stored_key,
                default_model,
                priority,
                enabled as i64,
                input_price_per_m,
                output_price_per_m,
                now
            ],
        )?;
        drop(conn);
        self.get_connection(&id)?
            .context("connection missing after upsert")
    }

    pub fn update_oauth_meta(&self, connection_id: &str, meta: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE oauth_credentials SET meta = ?1 WHERE connection_id = ?2",
            params![meta, connection_id],
        )?;
        Ok(())
    }

    pub fn update_oauth_tokens(
        &self,
        connection_id: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        expires_at: Option<&str>,
    ) -> Result<()> {
        let enc_access = if access_token.is_empty() {
            String::new()
        } else {
            self.enc_key(access_token)
        };
        let enc_refresh = refresh_token
            .filter(|s| !s.is_empty())
            .map(|s| self.enc_key(s));
        let conn = self.conn.lock().unwrap();
        if let Some(ref rt) = enc_refresh {
            conn.execute(
                "UPDATE oauth_credentials SET access_token = ?1, refresh_token = ?2,
                 expires_at = COALESCE(?3, expires_at) WHERE connection_id = ?4",
                params![enc_access, rt, expires_at, connection_id],
            )?;
        } else {
            conn.execute(
                "UPDATE oauth_credentials SET access_token = ?1,
                 expires_at = COALESCE(?2, expires_at) WHERE connection_id = ?3",
                params![enc_access, expires_at, connection_id],
            )?;
        }
        Ok(())
    }

    /// Create/update a connection backed by imported OAuth/session tokens (no API key).
    #[allow(clippy::too_many_arguments)]
    pub fn upsert_oauth_connection(
        &self,
        id: Option<String>,
        name: &str,
        base_url: &str,
        provider: &str,
        access_token: &str,
        refresh_token: Option<&str>,
        expires_at: Option<&str>,
        meta: Option<&str>,
        default_model: Option<&str>,
        priority: i64,
        enabled: bool,
    ) -> Result<ConnectionRow> {
        // Empty access_token allowed for free providers (e.g. opencode uses Bearer public).
        let now = Utc::now().to_rfc3339();
        // Prefer explicit id, else existing connection with same name, else new.
        let id = if let Some(id) = id {
            id
        } else if let Some(existing) = self.get_connection_by_name(name)? {
            existing.id
        } else {
            Uuid::new_v4().to_string()
        };
        let enc_access = if access_token.trim().is_empty() {
            String::new()
        } else {
            self.enc_key(access_token)
        };
        let enc_refresh = refresh_token
            .filter(|s| !s.is_empty())
            .map(|s| self.enc_key(s));
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO connections (id, name, base_url, api_key, default_model, priority, enabled,
                                      input_price_per_m, output_price_per_m, auth_type, created_at, updated_at)
             VALUES (?1, ?2, ?3, '', ?4, ?5, ?6, NULL, NULL, 'oauth_import', ?7, ?7)
             ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               base_url = excluded.base_url,
               default_model = excluded.default_model,
               priority = excluded.priority,
               enabled = excluded.enabled,
               auth_type = 'oauth_import',
               updated_at = excluded.updated_at",
            params![
                id,
                name,
                base_url.trim_end_matches('/'),
                default_model,
                priority,
                enabled as i64,
                now
            ],
        )?;
        tx.execute(
            "INSERT INTO oauth_credentials (connection_id, provider, access_token, refresh_token, expires_at, meta)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(connection_id) DO UPDATE SET
               provider = excluded.provider,
               access_token = excluded.access_token,
               refresh_token = COALESCE(excluded.refresh_token, oauth_credentials.refresh_token),
               expires_at = excluded.expires_at,
               meta = excluded.meta",
            params![
                id,
                provider,
                enc_access,
                enc_refresh,
                expires_at,
                meta
            ],
        )?;
        tx.commit()?;
        drop(conn);
        self.get_connection(&id)?
            .context("oauth connection missing after upsert")
    }

    pub fn delete_connection(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let _ = conn.execute(
            "DELETE FROM oauth_credentials WHERE connection_id = ?1",
            params![id],
        );
        let n = conn.execute("DELETE FROM connections WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    pub fn list_routes(&self) -> Result<Vec<RouteRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, public_model, strategy, created_at FROM routes ORDER BY public_model",
        )?;
        let route_iter = stmt.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })?;
        let mut routes = Vec::new();
        for r in route_iter {
            let (id, public_model, strategy, created_at) = r?;
            let targets = Self::load_targets_locked(&conn, &id)?;
            routes.push(RouteRow {
                id,
                public_model,
                strategy,
                created_at,
                targets,
            });
        }
        Ok(routes)
    }

    fn load_targets_locked(conn: &Connection, route_id: &str) -> Result<Vec<RouteTarget>> {
        let mut stmt = conn.prepare(
            "SELECT rt.connection_id, c.name, rt.model_override, rt.position
             FROM route_targets rt
             LEFT JOIN connections c ON c.id = rt.connection_id
             WHERE rt.route_id = ?1
             ORDER BY rt.position ASC",
        )?;
        let rows = stmt.query_map(params![route_id], |row| {
            Ok(RouteTarget {
                connection_id: row.get(0)?,
                connection_name: row.get(1)?,
                model_override: row.get(2)?,
                position: row.get(3)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn get_route(&self, id: &str) -> Result<Option<RouteRow>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, public_model, strategy, created_at FROM routes WHERE id = ?1",
                params![id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, public_model, strategy, created_at)) = row else {
            return Ok(None);
        };
        let targets = Self::load_targets_locked(&conn, &id)?;
        Ok(Some(RouteRow {
            id,
            public_model,
            strategy,
            created_at,
            targets,
        }))
    }

    pub fn get_route_by_public_model(&self, public_model: &str) -> Result<Option<RouteRow>> {
        let conn = self.conn.lock().unwrap();
        let row = conn
            .query_row(
                "SELECT id, public_model, strategy, created_at FROM routes WHERE public_model = ?1",
                params![public_model],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()?;
        let Some((id, public_model, strategy, created_at)) = row else {
            return Ok(None);
        };
        let targets = Self::load_targets_locked(&conn, &id)?;
        Ok(Some(RouteRow {
            id,
            public_model,
            strategy,
            created_at,
            targets,
        }))
    }

    pub fn upsert_route(
        &self,
        id: Option<String>,
        public_model: &str,
        strategy: &str,
        targets: &[(String, Option<String>)],
    ) -> Result<RouteRow> {
        let now = Utc::now().to_rfc3339();
        // Prefer existing id for public_model when creating without id
        let id = if let Some(id) = id {
            id
        } else if let Some(existing) = self.get_route_by_public_model(public_model)? {
            existing.id
        } else {
            Uuid::new_v4().to_string()
        };
        let conn = self.conn.lock().unwrap();
        let tx = conn.unchecked_transaction()?;
        tx.execute(
            "INSERT INTO routes (id, public_model, strategy, created_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET
               public_model = excluded.public_model,
               strategy = excluded.strategy",
            params![id, public_model, strategy, now],
        )?;
        tx.execute("DELETE FROM route_targets WHERE route_id = ?1", params![id])?;
        for (pos, (connection_id, model_override)) in targets.iter().enumerate() {
            tx.execute(
                "INSERT INTO route_targets (route_id, connection_id, model_override, position)
                 VALUES (?1, ?2, ?3, ?4)",
                params![id, connection_id, model_override, pos as i64],
            )?;
        }
        tx.commit()?;
        drop(conn);
        self.get_route(&id)?.context("route missing after upsert")
    }

    pub fn delete_route(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM routes WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    pub fn create_api_key(&self, name: &str) -> Result<(ApiKeyRow, String)> {
        let raw = format!("tr-{}", Uuid::new_v4());
        let hash = hash_key(&raw);
        let prefix = raw.chars().take(10).collect::<String>();
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO api_keys (id, name, key_hash, key_prefix, enabled, created_at)
             VALUES (?1, ?2, ?3, ?4, 1, ?5)",
            params![id, name, hash, prefix, now],
        )?;
        Ok((
            ApiKeyRow {
                id,
                name: name.to_string(),
                key_prefix: prefix,
                enabled: true,
                created_at: now,
            },
            raw,
        ))
    }

    pub fn list_api_keys(&self) -> Result<Vec<ApiKeyRow>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, key_prefix, enabled, created_at FROM api_keys ORDER BY created_at DESC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(ApiKeyRow {
                id: row.get(0)?,
                name: row.get(1)?,
                key_prefix: row.get(2)?,
                enabled: row.get::<_, i64>(3)? != 0,
                created_at: row.get(4)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn set_api_key_enabled(&self, id: &str, enabled: bool) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute(
            "UPDATE api_keys SET enabled = ?1 WHERE id = ?2",
            params![enabled as i64, id],
        )?;
        Ok(n > 0)
    }

    pub fn delete_api_key(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let n = conn.execute("DELETE FROM api_keys WHERE id = ?1", params![id])?;
        Ok(n > 0)
    }

    /// Returns true only for an enabled key. Empty/disabled stores fail closed.
    pub fn verify_api_key(&self, raw: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        let hash = hash_key(raw);
        let found: Option<i64> = conn
            .query_row(
                "SELECT 1 FROM api_keys WHERE key_hash = ?1 AND enabled = 1",
                params![hash],
                |r| r.get(0),
            )
            .optional()?;
        Ok(found.is_some())
    }

    /// Disabled keys still close the explicit, local bootstrap exception.
    /// Keep a saved Claude Code session for its conversation's next turn. `known` is
    /// the per-message hashes of the conversation it has; at most `max` are kept.
    pub fn shelf_put(
        &self,
        session_id: &str,
        signature: &str,
        known: &[String],
        max: usize,
    ) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO claude_shelf (session_id, signature, known, saved_at)
             VALUES (?1, ?2, ?3, ?4)",
            params![
                session_id,
                signature,
                serde_json::to_string(known)?,
                Utc::now().timestamp()
            ],
        )?;
        let mut stmt = conn.prepare(
            "SELECT session_id FROM claude_shelf ORDER BY saved_at DESC, rowid DESC LIMIT -1 OFFSET ?1",
        )?;
        let over: Vec<String> = stmt
            .query_map(params![max as i64], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        for sid in &over {
            conn.execute(
                "DELETE FROM claude_shelf WHERE session_id = ?1",
                params![sid],
            )?;
        }
        Ok(over)
    }

    /// Take the saved session whose conversation `convo` (per-message hashes) goes on
    /// from: same signature, its known messages a strict prefix. Returns (session, how
    /// many messages it has). The longest match wins.
    pub fn shelf_take(&self, signature: &str, convo: &[String]) -> Result<Option<(String, usize)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt =
            conn.prepare("SELECT session_id, known FROM claude_shelf WHERE signature = ?1")?;
        let rows: Vec<(String, String)> = stmt
            .query_map(params![signature], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<rusqlite::Result<_>>()?;
        let best = rows
            .into_iter()
            .filter_map(|(sid, known)| {
                let known: Vec<String> = serde_json::from_str(&known).ok()?;
                (known.len() < convo.len() && convo[..known.len()] == known[..])
                    .then_some((sid, known.len()))
            })
            .max_by_key(|(_, n)| *n);
        if let Some((sid, _)) = &best {
            conn.execute(
                "DELETE FROM claude_shelf WHERE session_id = ?1",
                params![sid],
            )?;
        }
        Ok(best)
    }

    /// Remove and return saved sessions older than `max_age_secs`.
    pub fn shelf_expire(&self, max_age_secs: i64) -> Result<Vec<String>> {
        let cutoff = Utc::now().timestamp() - max_age_secs;
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT session_id FROM claude_shelf WHERE saved_at < ?1")?;
        let old: Vec<String> = stmt
            .query_map(params![cutoff], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        conn.execute(
            "DELETE FROM claude_shelf WHERE saved_at < ?1",
            params![cutoff],
        )?;
        Ok(old)
    }

    /// Session ids on the shelf.
    pub fn shelf_ids(&self) -> Result<Vec<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT session_id FROM claude_shelf")?;
        let ids = stmt
            .query_map([], |r| r.get(0))?
            .collect::<rusqlite::Result<_>>()?;
        Ok(ids)
    }

    pub fn has_api_keys(&self) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        Ok(conn.query_row("SELECT EXISTS(SELECT 1 FROM api_keys)", [], |r| r.get(0))?)
    }

    /// Reserve before dispatch. Opening the database never recovers live attempts.
    pub fn begin_stream_attempt(
        &self,
        request_id: &str,
        public_model: &str,
        connection_id: &str,
        upstream_model: &str,
    ) -> Result<String> {
        let attempt_id = Uuid::new_v4().to_string();
        self.conn.lock().unwrap().execute(
            "INSERT INTO usage_events (ts, request_id, attempt_id, public_model,
                                       connection_id, upstream_model, usage_status, usage_source)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'missing', 'openai_chat_v1')",
            params![
                Utc::now().to_rfc3339(),
                request_id,
                attempt_id,
                public_model,
                connection_id,
                upstream_model,
            ],
        )?;
        Ok(attempt_id)
    }

    /// Persist only an actual upstream HTTP status, while the attempt is pending.
    pub fn observe_stream_headers(
        &self,
        attempt_id: &str,
        status: i64,
        headers_ms: i64,
    ) -> Result<()> {
        anyhow::ensure!(
            (100..=599).contains(&status) && headers_ms >= 0,
            "invalid_stream_headers"
        );
        self.conn.lock().unwrap().execute(
            "UPDATE usage_events SET status = ?2, headers_ms = ?3, latency_ms = ?3
             WHERE attempt_id = ?1 AND finalized_at IS NULL",
            params![attempt_id, status, headers_ms],
        )?;
        Ok(())
    }

    /// The first terminal observation wins; later callbacks cannot alter totals.
    pub fn finalize_stream_attempt(
        &self,
        attempt_id: &str,
        finalization: &StreamFinalization,
    ) -> Result<bool> {
        finalization.validate()?;
        let changed = self.conn.lock().unwrap().execute(
            "UPDATE usage_events
             SET finalized_at = ?2, outcome = ?3, usage_status = ?4, error = ?5,
                 prompt_tokens = ?6, completion_tokens = ?7, estimated_cost_usd = ?8,
                 first_output_ms = ?9, total_observed_ms = ?10
             WHERE attempt_id = ?1 AND finalized_at IS NULL",
            params![
                attempt_id,
                Utc::now().to_rfc3339(),
                finalization.outcome,
                finalization.usage_status,
                finalization.error,
                finalization.prompt_tokens,
                finalization.completion_tokens,
                finalization.estimated_cost_usd,
                finalization.first_output_ms,
                finalization.total_observed_ms,
            ],
        )?;
        Ok(changed == 1)
    }

    /// Startup owner calls this only while holding the exclusive server lock.
    /// No monotonic observation survives a restart, so tokens/cost/times stay null.
    pub fn recover_stream_attempts(&self) -> Result<usize> {
        Ok(self.conn.lock().unwrap().execute(
            "UPDATE usage_events
             SET finalized_at = ?1, outcome = 'interrupted', usage_status = 'missing',
                 error = 'stream_interrupted', prompt_tokens = NULL, completion_tokens = NULL,
                 estimated_cost_usd = NULL, first_output_ms = NULL, total_observed_ms = NULL
             WHERE attempt_id IS NOT NULL AND finalized_at IS NULL",
            params![Utc::now().to_rfc3339()],
        )?)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn log_usage(
        &self,
        public_model: Option<&str>,
        connection_id: Option<&str>,
        status: Option<i64>,
        latency_ms: Option<i64>,
        error: Option<&str>,
        prompt_tokens: Option<i64>,
        completion_tokens: Option<i64>,
        estimated_cost_usd: Option<f64>,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO usage_events (ts, public_model, connection_id, status, latency_ms, error,
                                       prompt_tokens, completion_tokens, estimated_cost_usd)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                Utc::now().to_rfc3339(),
                public_model,
                connection_id,
                status,
                latency_ms,
                error,
                prompt_tokens,
                completion_tokens,
                estimated_cost_usd,
            ],
        )?;
        Ok(())
    }

    pub fn recent_usage(&self, limit: i64) -> Result<Vec<UsageEvent>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, ts, public_model, connection_id, status, latency_ms, error,
                    prompt_tokens, completion_tokens, estimated_cost_usd,
                    request_id, attempt_id, upstream_model, finalized_at, headers_ms,
                    first_output_ms, total_observed_ms, outcome, usage_status, usage_source
             FROM usage_events ORDER BY id DESC LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![limit], |row| {
            Ok(UsageEvent {
                id: row.get(0)?,
                ts: row.get(1)?,
                public_model: row.get(2)?,
                connection_id: row.get(3)?,
                status: row.get(4)?,
                latency_ms: row.get(5)?,
                error: row.get(6)?,
                prompt_tokens: row.get(7)?,
                completion_tokens: row.get(8)?,
                estimated_cost_usd: row.get(9)?,
                request_id: row.get(10)?,
                attempt_id: row.get(11)?,
                upstream_model: row.get(12)?,
                finalized_at: row.get(13)?,
                headers_ms: row.get(14)?,
                first_output_ms: row.get(15)?,
                total_observed_ms: row.get(16)?,
                outcome: row.get(17)?,
                usage_status: row.get(18)?,
                usage_source: row.get(19)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    pub fn usage_cost_total(&self) -> Result<UsageCostSummary> {
        query_cost_summary(&self.conn.lock().unwrap())
    }

    /// Daily aggregates (most recent `days` day buckets by RFC3339 date prefix).
    pub fn usage_by_day(&self, days: i64) -> Result<Vec<UsageDayRow>> {
        let days = days.clamp(1, 366);
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT substr(ts, 1, 10) AS day,
                    COUNT(*) AS requests,
                    SUM(CASE WHEN outcome = 'succeeded' THEN 1 ELSE 0 END) AS ok,
                    SUM(CASE WHEN outcome IN ('failed', 'cancelled', 'timeout', 'interrupted') THEN 1 ELSE 0 END) AS errors,
                    COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0),
                    SUM(estimated_cost_usd),
                    COALESCE(AVG(latency_ms), 0),
                    COUNT(estimated_cost_usd),
                    SUM(CASE WHEN outcome = 'incomplete' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN outcome = 'unknown' THEN 1 ELSE 0 END),
                    SUM(CASE WHEN status = 200 THEN 1 ELSE 0 END),
                    SUM(CASE WHEN attempt_id IS NOT NULL AND finalized_at IS NULL THEN 1 ELSE 0 END)
             FROM usage_events
             GROUP BY day
             ORDER BY day DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![days], |row| {
            let cost_summary =
                UsageCostSummary::from_observations(row.get(6)?, row.get(8)?, row.get(1)?);
            Ok(UsageDayRow {
                day: row.get(0)?,
                requests: row.get(1)?,
                ok: row.get(2)?,
                errors: row.get(3)?,
                incomplete: row.get(9)?,
                unknown: row.get(10)?,
                headers_200: row.get(11)?,
                pending: row.get(12)?,
                prompt_tokens: row.get(4)?,
                completion_tokens: row.get(5)?,
                estimated_cost_usd: cost_summary.complete_total(),
                cost_summary,
                avg_latency_ms: row.get(7)?,
            })
        })?;
        let mut out = Vec::new();
        for r in rows {
            out.push(r?);
        }
        Ok(out)
    }

    /// CSV export of recent usage events.
    pub fn usage_csv(&self, limit: i64) -> Result<String> {
        let events = self.recent_usage(limit)?;
        let mut out = String::from(
            "id,ts,public_model,connection_id,status,latency_ms,prompt_tokens,completion_tokens,estimated_cost_usd,error,request_id,attempt_id,upstream_model,finalized_at,headers_ms,first_output_ms,total_observed_ms,outcome,usage_status,usage_source\n",
        );
        for e in events {
            let err = e
                .error
                .unwrap_or_default()
                .replace('"', "'")
                .replace('\n', " ");
            out.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},\"{}\",{},{},{},{},{},{},{},{},{},{}\n",
                e.id,
                e.ts,
                e.public_model.unwrap_or_default(),
                e.connection_id.unwrap_or_default(),
                e.status.map(|s| s.to_string()).unwrap_or_default(),
                e.latency_ms.map(|s| s.to_string()).unwrap_or_default(),
                e.prompt_tokens.map(|s| s.to_string()).unwrap_or_default(),
                e.completion_tokens
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                e.estimated_cost_usd
                    .map(|s| s.to_string())
                    .unwrap_or_default(),
                err,
                csv_field(e.request_id.as_deref().unwrap_or_default()),
                csv_field(e.attempt_id.as_deref().unwrap_or_default()),
                csv_field(e.upstream_model.as_deref().unwrap_or_default()),
                csv_field(e.finalized_at.as_deref().unwrap_or_default()),
                e.headers_ms.map(|v| v.to_string()).unwrap_or_default(),
                e.first_output_ms.map(|v| v.to_string()).unwrap_or_default(),
                e.total_observed_ms
                    .map(|v| v.to_string())
                    .unwrap_or_default(),
                e.outcome,
                e.usage_status,
                e.usage_source,
            ));
        }
        Ok(out)
    }

    pub fn stats(&self) -> Result<serde_json::Value> {
        let conn = self.conn.lock().unwrap();
        let connections: i64 =
            conn.query_row("SELECT COUNT(*) FROM connections", [], |r| r.get(0))?;
        let routes: i64 = conn.query_row("SELECT COUNT(*) FROM routes", [], |r| r.get(0))?;
        let keys: i64 = conn.query_row("SELECT COUNT(*) FROM api_keys", [], |r| r.get(0))?;
        let cost_summary = query_cost_summary(&conn)?;
        Ok(serde_json::json!({
            "connections": connections,
            "routes": routes,
            "api_keys": keys,
            "usage_events": cost_summary.total_count,
            "estimated_cost_usd": cost_summary.complete_total(),
            "cost_summary": cost_summary,
        }))
    }
}

fn csv_field(value: &str) -> String {
    if value.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", value.replace('"', "\"\""))
    } else {
        value.to_owned()
    }
}

pub fn hash_key(raw: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn mask_secret(s: &str) -> String {
    if s.len() <= 8 {
        return "****".into();
    }
    format!("{}…{}", &s[..4], &s[s.len() - 4..])
}

#[cfg(test)]
mod auth_tests {
    use super::*;

    #[test]
    fn empty_key_store_denies_paid_upstream_authorization() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("auth.db"), None).unwrap();
        assert!(!store.verify_api_key("").unwrap());
        assert!(!store.verify_api_key("invalid").unwrap());
    }

    #[test]
    fn disabling_last_key_does_not_reopen_authorization() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("auth.db"), None).unwrap();
        let (row, raw) = store.create_api_key("client").unwrap();
        assert!(store.has_api_keys().unwrap());
        assert!(store.verify_api_key(&raw).unwrap());
        assert!(!store.verify_api_key("invalid").unwrap());
        assert!(!store.verify_api_key("").unwrap());
        assert!(store.set_api_key_enabled(&row.id, false).unwrap());
        assert!(store.has_api_keys().unwrap());
        assert!(!store.verify_api_key(&raw).unwrap());
        assert!(!store.verify_api_key("invalid").unwrap());
        assert!(!store.verify_api_key("").unwrap());
        assert!(store.set_api_key_enabled(&row.id, true).unwrap());
        assert!(store.verify_api_key(&raw).unwrap());
    }

    #[test]
    fn bootstrap_counts_disabled_keys_as_configured() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("auth.db"), None).unwrap();
        assert!(!store.has_api_keys().unwrap());
        let (row, _) = store.create_api_key("client").unwrap();
        assert!(store.set_api_key_enabled(&row.id, false).unwrap());
        assert!(store.has_api_keys().unwrap());
        assert!(store.delete_api_key(&row.id).unwrap());
        assert!(!store.has_api_keys().unwrap());
        assert!(!store.verify_api_key("").unwrap());
    }
}

#[cfg(test)]
mod secret_storage_tests {
    use super::*;

    fn raw_column(path: &Path, sql: &str) -> String {
        Connection::open(path)
            .unwrap()
            .query_row(sql, [], |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn plaintext_rows_are_migrated_and_key_mismatch_refuses_to_open() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("t.db");
        {
            let store = Store::open(&db, None).unwrap();
            store
                .upsert_connection(
                    None,
                    "c",
                    "http://x/v1",
                    "sk-123",
                    None,
                    100,
                    true,
                    None,
                    None,
                )
                .unwrap();
            store
                .upsert_oauth_connection(
                    None,
                    "o",
                    "https://api.openai.com/v1",
                    "siwc",
                    "at-456",
                    Some("rt-789"),
                    None,
                    None,
                    None,
                    100,
                    true,
                )
                .unwrap();
        }
        assert!(
            raw_column(&db, "SELECT api_key FROM connections WHERE name='c'")
                .starts_with("enc:v2:")
        );
        // Simulate rows written by an older, plaintext-by-default build.
        let conn = Connection::open(&db).unwrap();
        conn.execute("UPDATE connections SET api_key='sk-123' WHERE name='c'", [])
            .unwrap();
        conn.execute(
            "UPDATE oauth_credentials SET access_token='at-456', refresh_token='rt-789'",
            [],
        )
        .unwrap();
        drop(conn);

        let store = Store::open(&db, None).unwrap();
        for sql in [
            "SELECT api_key FROM connections WHERE name='c'",
            "SELECT access_token FROM oauth_credentials",
            "SELECT refresh_token FROM oauth_credentials",
        ] {
            assert!(raw_column(&db, sql).starts_with("enc:v2:"), "{sql}");
        }
        let c = store.get_connection_by_name("c").unwrap().unwrap();
        assert_eq!(c.api_key, "sk-123");
        let o = store.get_connection_by_name("o").unwrap().unwrap();
        let oauth = o.oauth.unwrap();
        assert_eq!(oauth.access_token, "at-456");
        assert_eq!(oauth.refresh_token.as_deref(), Some("rt-789"));
        drop(store);

        let err = Store::open(&db, Some("other-passphrase".into()))
            .err()
            .unwrap()
            .to_string();
        assert!(err.contains("does not match"), "{err}");
        assert!(!err.contains("sk-123") && !err.contains("at-456"));
    }

    #[test]
    fn codex_rows_are_retired() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("t.db");
        {
            let store = Store::open(&db, None).unwrap();
            store
                .upsert_oauth_connection(
                    None,
                    "old",
                    "https://chatgpt.com/backend-api/codex/responses",
                    "siwc",
                    "at",
                    Some("rt"),
                    None,
                    None,
                    None,
                    100,
                    true,
                )
                .unwrap();
        }
        // Rows written by an older build that still had the codex provider.
        Connection::open(&db)
            .unwrap()
            .execute("UPDATE oauth_credentials SET provider = 'codex'", [])
            .unwrap();
        let store = Store::open(&db, None).unwrap();
        let c = store.get_connection_by_name("old").unwrap().unwrap();
        assert!(!c.enabled);
        let o = c.oauth.unwrap();
        assert_eq!(o.access_token, "");
        assert!(o.refresh_token.is_none());
    }

    #[test]
    fn claude_shelf_matches_conversation_prefixes() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db"), None).unwrap();
        let h = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        store.shelf_put("s1", "sig", &h(&["a", "b"]), 64).unwrap();
        store
            .shelf_put("s2", "sig", &h(&["a", "b", "c", "d"]), 64)
            .unwrap();
        // other settings, edited history, nothing new: no match
        assert!(store
            .shelf_take("other", &h(&["a", "b", "c"]))
            .unwrap()
            .is_none());
        assert!(store
            .shelf_take("sig", &h(&["a", "x", "c"]))
            .unwrap()
            .is_none());
        assert!(store.shelf_take("sig", &h(&["a", "b"])).unwrap().is_none());
        // longest prefix wins and is taken off the shelf
        assert_eq!(
            store
                .shelf_take("sig", &h(&["a", "b", "c", "d", "e"]))
                .unwrap(),
            Some(("s2".into(), 4))
        );
        assert_eq!(store.shelf_ids().unwrap(), vec!["s1".to_string()]);
        // capacity: the oldest are pushed out
        let out = store.shelf_put("s3", "sig", &h(&["z"]), 1).unwrap();
        assert_eq!(out, vec!["s1".to_string()]);
        assert_eq!(store.shelf_expire(-1).unwrap(), vec!["s3".to_string()]);
        assert!(store.shelf_ids().unwrap().is_empty());
    }
}

#[cfg(test)]
mod stream_store_tests {
    use super::*;

    fn reserved(store: &Store) -> String {
        store
            .begin_stream_attempt("generated-request", "public", "connection", "upstream")
            .unwrap()
    }

    fn complete() -> StreamFinalization {
        StreamFinalization {
            outcome: "succeeded",
            usage_status: "complete",
            prompt_tokens: Some(5),
            completion_tokens: Some(3),
            estimated_cost_usd: Some(2.0),
            first_output_ms: Some(15),
            total_observed_ms: 30,
            ..Default::default()
        }
    }

    #[test]
    fn historical_http_200_does_not_claim_terminal_success() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        store
            .log_usage(None, None, Some(200), Some(10), None, None, None, None)
            .unwrap();
        let daily = store.usage_by_day(1).unwrap();
        assert_eq!(
            daily[0].ok, 0,
            "HTTP headers do not establish a terminal outcome"
        );
        assert_eq!((daily[0].unknown, daily[0].headers_200), (1, 1));
        assert_eq!((daily[0].errors, daily[0].pending), (0, 0));
    }

    #[test]
    fn additive_migration_preserves_legacy_values_and_is_repeatable() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("synthetic.db");
        let conn = Connection::open(&db).unwrap();
        conn.execute_batch(
            "CREATE TABLE usage_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT NOT NULL,
                public_model TEXT, connection_id TEXT, status INTEGER, latency_ms INTEGER,
                error TEXT, prompt_tokens INTEGER, completion_tokens INTEGER, estimated_cost_usd REAL
             );
             INSERT INTO usage_events VALUES
                (42, '2025-01-02T03:04:05Z', 'public', 'connection', 200, 17, 'old-error', 0, 7, 1.25);",
        )
        .unwrap();
        drop(conn);
        for _ in 0..2 {
            let store = Store::open(&db, None).unwrap();
            let event = store.recent_usage(1).unwrap().pop().unwrap();
            assert_eq!(event.id, 42);
            assert_eq!(event.ts, "2025-01-02T03:04:05Z");
            assert_eq!(event.public_model.as_deref(), Some("public"));
            assert_eq!(event.connection_id.as_deref(), Some("connection"));
            assert_eq!((event.status, event.latency_ms), (Some(200), Some(17)));
            assert_eq!(event.error.as_deref(), Some("old-error"));
            assert_eq!(
                (event.prompt_tokens, event.completion_tokens),
                (Some(0), Some(7))
            );
            assert_eq!(event.estimated_cost_usd, Some(1.25));
            assert_eq!(event.outcome, "unknown");
            assert_eq!(event.usage_status, "unknown");
            assert_eq!(event.usage_source, "unknown");
            assert!(event.request_id.is_none() && event.attempt_id.is_none());
            assert!(event.finalized_at.is_none() && event.upstream_model.is_none());
            assert!(event.headers_ms.is_none() && event.first_output_ms.is_none());
            assert!(event.total_observed_ms.is_none());
        }
        let store = Store::open(&db, None).unwrap();
        reserved(&store);
        assert_eq!(store.recent_usage(1).unwrap()[0].id, 43);
    }

    #[test]
    fn migration_constraint_failure_is_visible_and_rolls_back_added_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE usage_events (
                id INTEGER PRIMARY KEY, ts TEXT NOT NULL, public_model TEXT,
                connection_id TEXT, status INTEGER, latency_ms INTEGER, error TEXT, attempt_id TEXT
             );
             INSERT INTO usage_events(id,ts,attempt_id) VALUES (1,'old','duplicate'),(2,'old','duplicate');",
        )
        .unwrap();
        assert!(migrate_schema(&conn).is_err());
        let columns: Vec<String> = conn
            .prepare("PRAGMA table_info(usage_events)")
            .unwrap()
            .query_map([], |row| row.get(1))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert!(!columns.iter().any(|c| c == "outcome"));
        assert_eq!(
            conn.query_row("SELECT COUNT(*) FROM usage_events", [], |r| r
                .get::<_, i64>(0))
                .unwrap(),
            2
        );
    }

    #[test]
    fn reservation_finalization_and_late_callbacks_preserve_one_row_and_totals() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let attempt = reserved(&store);
        assert!(Uuid::parse_str(&attempt).is_ok());
        let pending = store.recent_usage(10).unwrap().pop().unwrap();
        assert_eq!(pending.request_id.as_deref(), Some("generated-request"));
        assert_eq!(pending.upstream_model.as_deref(), Some("upstream"));
        assert_eq!(pending.usage_source, "openai_chat_v1");
        assert_eq!(pending.usage_status, "missing");
        assert_eq!(pending.outcome, "unknown");
        assert!(pending.status.is_none() && pending.finalized_at.is_none());
        store.observe_stream_headers(&attempt, 200, 10).unwrap();
        assert!(store
            .finalize_stream_attempt(&attempt, &complete())
            .unwrap());
        let before = serde_json::to_value(store.recent_usage(10).unwrap()).unwrap();
        let before_daily = serde_json::to_value(store.usage_by_day(1).unwrap()).unwrap();
        assert!(!store
            .finalize_stream_attempt(
                &attempt,
                &StreamFinalization {
                    outcome: "failed",
                    error: Some("stream_error"),
                    ..Default::default()
                }
            )
            .unwrap());
        store.observe_stream_headers(&attempt, 502, 999).unwrap();
        assert_eq!(store.recover_stream_attempts().unwrap(), 0);
        assert_eq!(
            serde_json::to_value(store.recent_usage(10).unwrap()).unwrap(),
            before
        );
        assert_eq!(
            serde_json::to_value(store.usage_by_day(1).unwrap()).unwrap(),
            before_daily
        );
        let event = &before[0];
        assert_eq!(event["status"], 200);
        assert_eq!(event["headers_ms"], 10);
        assert_eq!(event["latency_ms"], 10);
        assert_eq!(event["first_output_ms"], 15);
        assert_eq!(event["total_observed_ms"], 30);
        assert_eq!(event["prompt_tokens"], 5);
        assert_eq!(event["completion_tokens"], 3);
        assert_eq!(store.usage_cost_total().unwrap().known_sum, Some(2.0));
    }

    #[test]
    fn only_explicit_recovery_settles_pending_rows_once_without_invented_observations() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("synthetic.db");
        let store = Store::open(&db, None).unwrap();
        let before_headers = reserved(&store);
        let after_headers = reserved(&store);
        store
            .observe_stream_headers(&after_headers, 200, 8)
            .unwrap();
        store
            .log_usage(None, None, Some(200), Some(4), None, Some(2), None, None)
            .unwrap();
        let reopened = Store::open(&db, None).unwrap();
        assert_eq!(reopened.usage_by_day(1).unwrap()[0].pending, 2);
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 2);
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 0);
        assert!(!store
            .finalize_stream_attempt(&before_headers, &complete())
            .unwrap());
        let rows = store.recent_usage(10).unwrap();
        assert_eq!(rows[0].outcome, "unknown");
        assert_eq!(rows[0].prompt_tokens, Some(2));
        for row in &rows[1..] {
            assert_eq!(row.outcome, "interrupted");
            assert_eq!(row.usage_status, "missing");
            assert_eq!(row.error.as_deref(), Some("stream_interrupted"));
            assert!(row.finalized_at.is_some());
            assert!(row.prompt_tokens.is_none() && row.completion_tokens.is_none());
            assert!(row.estimated_cost_usd.is_none() && row.first_output_ms.is_none());
            assert!(row.total_observed_ms.is_none());
        }
        assert_eq!((rows[1].status, rows[1].headers_ms), (Some(200), Some(8)));
        assert_eq!((rows[2].status, rows[2].headers_ms), (None, None));
        let daily = reopened.usage_by_day(1).unwrap();
        assert_eq!(
            (daily[0].errors, daily[0].unknown, daily[0].pending),
            (2, 1, 0)
        );
    }

    #[test]
    fn outcomes_usage_nulls_and_csv_remain_consistent() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        store
            .log_usage(None, None, Some(200), Some(1), None, None, None, None)
            .unwrap();
        reserved(&store);
        for outcome in [
            "succeeded",
            "failed",
            "cancelled",
            "timeout",
            "interrupted",
            "incomplete",
        ] {
            let attempt = reserved(&store);
            store.observe_stream_headers(&attempt, 200, 0).unwrap();
            let mut finalization = StreamFinalization {
                outcome,
                ..Default::default()
            };
            if outcome == "succeeded" {
                finalization.usage_status = "complete";
                finalization.prompt_tokens = Some(0);
                finalization.completion_tokens = Some(0);
                finalization.estimated_cost_usd = Some(0.0);
                finalization.first_output_ms = Some(0);
            } else if outcome == "incomplete" {
                finalization.usage_status = "partial";
                finalization.prompt_tokens = Some(7);
            }
            assert!(store
                .finalize_stream_attempt(&attempt, &finalization)
                .unwrap());
        }
        let daily = store.usage_by_day(1).unwrap();
        let d = &daily[0];
        assert_eq!(
            (
                d.requests,
                d.ok,
                d.errors,
                d.incomplete,
                d.unknown,
                d.pending,
                d.headers_200
            ),
            (8, 1, 4, 1, 2, 1, 7)
        );
        assert_eq!((d.prompt_tokens, d.completion_tokens), (7, 0));
        assert_eq!(
            (d.cost_summary.known_count, d.cost_summary.unknown_count),
            (1, 7)
        );
        assert_eq!(d.cost_summary.known_sum, Some(0.0));
        assert!(d.estimated_cost_usd.is_none());
        let csv = store.usage_csv(10).unwrap();
        let lines: Vec<_> = csv.lines().collect();
        assert_eq!(lines.len(), 9);
        assert!(lines[0].starts_with("id,ts,public_model,connection_id,status,latency_ms,prompt_tokens,completion_tokens,estimated_cost_usd,error,"));
        assert!(lines[0].ends_with("request_id,attempt_id,upstream_model,finalized_at,headers_ms,first_output_ms,total_observed_ms,outcome,usage_status,usage_source"));
        let success: Vec<_> = lines[6].split(',').collect();
        assert_eq!(&success[4..10], &["200", "0", "0", "0", "0", "\"\""]);
        assert_eq!(
            &success[14..],
            &["0", "0", "0", "succeeded", "complete", "openai_chat_v1"]
        );
        let legacy: Vec<_> = lines[8].split(',').collect();
        assert_eq!(&legacy[6..9], &["", "", ""]);
        assert_eq!(&legacy[10..17], &["", "", "", "", "", "", ""]);
        assert_eq!(&legacy[17..], &["unknown", "unknown", "unknown"]);
        assert_eq!(csv_field("model,\"quoted\""), "\"model,\"\"quoted\"\"\"");
    }

    #[test]
    fn invalid_finalizations_are_rejected_without_mutation() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let attempt = reserved(&store);
        let before = serde_json::to_value(store.recent_usage(1).unwrap()).unwrap();
        let invalid = [
            StreamFinalization {
                outcome: "invented",
                ..complete()
            },
            StreamFinalization {
                usage_status: "invented",
                ..complete()
            },
            StreamFinalization {
                error: Some("raw upstream error"),
                ..complete()
            },
            StreamFinalization {
                prompt_tokens: Some(-1),
                ..complete()
            },
            StreamFinalization {
                completion_tokens: None,
                ..complete()
            },
            StreamFinalization {
                usage_status: "missing",
                ..complete()
            },
            StreamFinalization {
                usage_status: "partial",
                ..complete()
            },
            StreamFinalization {
                estimated_cost_usd: Some(f64::NAN),
                ..complete()
            },
            StreamFinalization {
                estimated_cost_usd: Some(f64::INFINITY),
                ..complete()
            },
            StreamFinalization {
                estimated_cost_usd: Some(-1.0),
                ..complete()
            },
            StreamFinalization {
                total_observed_ms: -1,
                ..complete()
            },
            StreamFinalization {
                first_output_ms: Some(-1),
                ..complete()
            },
            StreamFinalization {
                first_output_ms: Some(31),
                ..complete()
            },
        ];
        for finalization in invalid {
            assert_eq!(
                store
                    .finalize_stream_attempt(&attempt, &finalization)
                    .unwrap_err()
                    .to_string(),
                "invalid_stream_finalization"
            );
        }
        assert!(store.observe_stream_headers(&attempt, 200, -1).is_err());
        assert!(store.observe_stream_headers(&attempt, 0, 0).is_err());
        assert_eq!(
            serde_json::to_value(store.recent_usage(1).unwrap()).unwrap(),
            before
        );
        assert!(store
            .finalize_stream_attempt(
                &attempt,
                &StreamFinalization {
                    outcome: "incomplete",
                    usage_status: "invalid",
                    prompt_tokens: Some(5),
                    error: Some("stream_observer_invalid"),
                    ..Default::default()
                }
            )
            .unwrap());
    }

    #[test]
    fn storage_failures_propagate_and_leave_pending_attempt_recoverable() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let attempt = reserved(&store);
        store
            .conn
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only = ON")
            .unwrap();
        assert!(store
            .begin_stream_attempt("request", "public", "connection", "upstream")
            .is_err());
        assert!(store.observe_stream_headers(&attempt, 200, 10).is_err());
        assert!(store
            .finalize_stream_attempt(&attempt, &complete())
            .is_err());
        assert!(store.recover_stream_attempts().is_err());
        let rows = store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].finalized_at.is_none() && rows[0].status.is_none());
        store
            .conn
            .lock()
            .unwrap()
            .execute_batch("PRAGMA query_only = OFF")
            .unwrap();
        assert_eq!(store.recover_stream_attempts().unwrap(), 1);
    }

    #[test]
    fn unique_attempt_constraint_rejects_duplicate_identity() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let attempt = reserved(&store);
        assert!(store
            .conn
            .lock()
            .unwrap()
            .execute(
                "INSERT INTO usage_events(ts,attempt_id) VALUES('synthetic',?1)",
                params![attempt],
            )
            .is_err());
        assert_eq!(store.recent_usage(10).unwrap().len(), 1);
    }

    #[test]
    fn cancelled_usage_tail_retains_both_counters_as_partial_without_cost() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let attempt = reserved(&store);
        assert!(store
            .finalize_stream_attempt(
                &attempt,
                &StreamFinalization {
                    usage_status: "partial",
                    estimated_cost_usd: None,
                    error: Some("stream_cancelled"),
                    ..complete()
                }
            )
            .unwrap());
        let event = store.recent_usage(1).unwrap().pop().unwrap();
        assert_eq!(event.outcome, "succeeded");
        assert_eq!(event.usage_status, "partial");
        assert_eq!(
            (event.prompt_tokens, event.completion_tokens),
            (Some(5), Some(3))
        );
        assert!(event.estimated_cost_usd.is_none());
        assert_eq!(
            store.usage_by_day(1).unwrap()[0].cost_summary.unknown_count,
            1
        );
    }

    #[test]
    fn rendered_recent_rows_preserve_unknown_tokens_and_explicit_zero() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        reserved(&store);
        let zero = reserved(&store);
        store.observe_stream_headers(&zero, 200, 0).unwrap();
        store
            .finalize_stream_attempt(
                &zero,
                &StreamFinalization {
                    outcome: "succeeded",
                    usage_status: "complete",
                    prompt_tokens: Some(0),
                    completion_tokens: Some(0),
                    estimated_cost_usd: Some(0.0),
                    first_output_ms: Some(0),
                    ..Default::default()
                },
            )
            .unwrap();
        let partial = reserved(&store);
        store.observe_stream_headers(&partial, 200, 0).unwrap();
        store
            .finalize_stream_attempt(
                &partial,
                &StreamFinalization {
                    outcome: "failed",
                    usage_status: "partial",
                    prompt_tokens: Some(5),
                    error: Some("stream_error"),
                    ..Default::default()
                },
            )
            .unwrap();
        let mut env = minijinja::Environment::new();
        env.add_template(
            "cost_summary",
            include_str!("../templates/cost_summary.html"),
        )
        .unwrap();
        env.add_template("usage", include_str!("../templates/usage.html"))
            .unwrap();
        let html = env.get_template("usage").unwrap().render(minijinja::context! {
            title => "Usage", admin_protected => false, csrf => "synthetic",
            cost_total => store.usage_cost_total().unwrap(), daily => store.usage_by_day(1).unwrap(),
            events => store.recent_usage(10).unwrap(),
        }).unwrap();
        let recent = html.split("<h2>Recent events</h2>").nth(1).unwrap();
        assert!(recent.contains("<td>unknown (pending)</td>"));
        assert!(recent.contains("<td>failed</td>"));
        assert!(recent.contains("<td class=\"mono\">—/—</td>"));
        assert!(recent.contains("<td class=\"mono\">0/0</td>"));
        assert!(recent.contains("<td class=\"mono\">5/—</td>"));
        assert!(!recent.contains("<td class=\"mono\">5/0</td>"));
        assert!(recent.contains("<td>0 ms / 0 ms / 0 ms</td>"));
        assert!(recent.contains("<td>0 ms / — / 0 ms</td>"));
        assert!(html.contains("Unknown (includes pending)"));
        assert!(html.contains("HTTP 200 headers"));
    }
}

#[cfg(test)]
mod cost_coverage_tests {
    use super::*;
    #[test]
    fn cc1_nonfinite_aggregate_stays_unavailable_without_rewriting_rows() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        for _ in 0..2 {
            store
                .log_usage(
                    None,
                    None,
                    Some(200),
                    None,
                    None,
                    None,
                    None,
                    Some(f64::MAX),
                )
                .unwrap();
        }
        let s = store.usage_cost_total().unwrap();
        assert!(matches!(s.status, CostCoverageStatus::Unavailable));
        assert_eq!(
            (
                s.known_sum,
                s.known_count,
                s.unknown_count,
                s.total_count,
                s.coverage,
                s.complete_total()
            ),
            (None, 2, 0, 2, Some(1.0), None)
        );
        let stats = store.stats().unwrap();
        assert!(stats["estimated_cost_usd"].is_null());
        assert_eq!(stats["cost_summary"]["status"], "unavailable");
        let days = store.usage_by_day(1).unwrap();
        assert_eq!(days.len(), 1);
        assert!(days[0].estimated_cost_usd.is_none());
        assert!(matches!(
            days[0].cost_summary.status,
            CostCoverageStatus::Unavailable
        ));
        let rows = store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.estimated_cost_usd == Some(f64::MAX)));
    }
}

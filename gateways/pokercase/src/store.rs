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
    conn.execute_batch(
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
    // Additive columns for older DBs
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN input_price_per_m REAL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN output_price_per_m REAL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE connections ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'api_key'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE usage_events ADD COLUMN prompt_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE usage_events ADD COLUMN completion_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE usage_events ADD COLUMN estimated_cost_usd REAL",
        [],
    );
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
                    prompt_tokens, completion_tokens, estimated_cost_usd
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
                    SUM(CASE WHEN status = 200 THEN 1 ELSE 0 END) AS ok,
                    SUM(CASE WHEN status IS NULL OR status != 200 THEN 1 ELSE 0 END) AS errors,
                    COALESCE(SUM(prompt_tokens), 0),
                    COALESCE(SUM(completion_tokens), 0),
                    SUM(estimated_cost_usd),
                    COALESCE(AVG(latency_ms), 0),
                    COUNT(estimated_cost_usd)
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
            "id,ts,public_model,connection_id,status,latency_ms,prompt_tokens,completion_tokens,estimated_cost_usd,error\n",
        );
        for e in events {
            let err = e
                .error
                .unwrap_or_default()
                .replace('"', "'")
                .replace('\n', " ");
            out.push_str(&format!(
                "{},{},{},{},{},{},{},{},{},\"{}\"\n",
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
                err
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

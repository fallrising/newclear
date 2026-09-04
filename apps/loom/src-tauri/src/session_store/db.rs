//! Low-level connection management + schema for the `sessions` table.
//!
//! Schema is concept-driven (see `schema/sqlite.md`); this module is the
//! authoritative DDL. State changes that adjust the table shape have to go
//! through this file so it stays the one place to grep when porting B1.7
//! (boot recovery) and B2/B3 (which read sessions for cross-track context).

use loom_contracts::{SessionId, SessionMeta, SessionState};
use rusqlite::{params, Connection, OptionalExtension};

use super::error::{StoreError, StoreResult};

/// CREATE statement run on every connection open. Idempotent.
const SCHEMA_SQL: &str = "\
CREATE TABLE IF NOT EXISTS sessions (
    id               TEXT    PRIMARY KEY,
    cwd              TEXT    NOT NULL,
    cmd              TEXT,
    shell            TEXT    NOT NULL,
    state            TEXT    NOT NULL CHECK (state IN ('spawning','active','detached','exited','tombstone')),
    exit_code        INTEGER,
    tombstone_reason TEXT,
    last_activity_ms INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_state         ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions(last_activity_ms);
";

pub fn init_connection(conn: &Connection) -> rusqlite::Result<()> {
    // WAL ⇒ readers don't block the single writer (TDD §3.1).
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.execute_batch(SCHEMA_SQL)?;
    Ok(())
}

pub fn encode_state(state: &SessionState) -> (&'static str, Option<i32>, Option<String>) {
    match state {
        SessionState::Spawning => ("spawning", None, None),
        SessionState::Active => ("active", None, None),
        SessionState::Detached => ("detached", None, None),
        SessionState::Exited { code } => ("exited", *code, None),
        SessionState::Tombstone { reason } => ("tombstone", None, Some(reason.clone())),
    }
}

pub fn decode_state(
    tag: &str,
    exit_code: Option<i32>,
    tombstone_reason: Option<String>,
) -> StoreResult<SessionState> {
    Ok(match tag {
        "spawning" => SessionState::Spawning,
        "active" => SessionState::Active,
        "detached" => SessionState::Detached,
        "exited" => SessionState::Exited { code: exit_code },
        "tombstone" => SessionState::Tombstone {
            reason: tombstone_reason.unwrap_or_default(),
        },
        other => return Err(StoreError::InvalidStateTag(other.to_string())),
    })
}

pub fn insert(conn: &Connection, meta: &SessionMeta) -> StoreResult<()> {
    let (state_tag, exit_code, tombstone_reason) = encode_state(&meta.state);
    let last = i64::try_from(meta.last_activity_ms).unwrap_or(i64::MAX);
    conn.execute(
        "INSERT INTO sessions (id, cwd, cmd, shell, state, exit_code, tombstone_reason, last_activity_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            meta.id.0,
            meta.cwd,
            meta.cmd,
            meta.shell,
            state_tag,
            exit_code,
            tombstone_reason,
            last,
        ],
    )?;
    Ok(())
}

pub fn update_state(conn: &Connection, sid: &SessionId, state: &SessionState) -> StoreResult<()> {
    let (state_tag, exit_code, tombstone_reason) = encode_state(state);
    let n = conn.execute(
        "UPDATE sessions
            SET state = ?1, exit_code = ?2, tombstone_reason = ?3
          WHERE id = ?4",
        params![state_tag, exit_code, tombstone_reason, sid.0],
    )?;
    if n == 0 {
        return Err(StoreError::NotFound(sid.clone()));
    }
    Ok(())
}

pub fn update_last_activity(conn: &Connection, sid: &SessionId, ms: u64) -> StoreResult<()> {
    let n = conn.execute(
        "UPDATE sessions SET last_activity_ms = ?1 WHERE id = ?2",
        params![i64::try_from(ms).unwrap_or(i64::MAX), sid.0],
    )?;
    if n == 0 {
        return Err(StoreError::NotFound(sid.clone()));
    }
    Ok(())
}

pub fn delete(conn: &Connection, sid: &SessionId) -> StoreResult<()> {
    let n = conn.execute("DELETE FROM sessions WHERE id = ?1", params![sid.0])?;
    if n == 0 {
        return Err(StoreError::NotFound(sid.clone()));
    }
    Ok(())
}

pub fn get(conn: &Connection, sid: &SessionId) -> StoreResult<Option<SessionMeta>> {
    let row = conn
        .query_row(
            "SELECT id, cwd, cmd, shell, state, exit_code, tombstone_reason, last_activity_ms
               FROM sessions
              WHERE id = ?1",
            params![sid.0],
            row_to_meta,
        )
        .optional()?;
    row.transpose()
}

pub fn list(conn: &Connection) -> StoreResult<Vec<SessionMeta>> {
    let mut stmt = conn.prepare(
        "SELECT id, cwd, cmd, shell, state, exit_code, tombstone_reason, last_activity_ms
           FROM sessions
       ORDER BY last_activity_ms DESC",
    )?;
    let rows: Result<Vec<StoreResult<SessionMeta>>, rusqlite::Error> =
        stmt.query_map([], row_to_meta)?.collect();
    rows?.into_iter().collect()
}

#[allow(clippy::needless_pass_by_value)]
fn row_to_meta(row: &rusqlite::Row<'_>) -> rusqlite::Result<StoreResult<SessionMeta>> {
    let id: String = row.get(0)?;
    let cwd: String = row.get(1)?;
    let cmd: Option<String> = row.get(2)?;
    let shell: String = row.get(3)?;
    let state_tag: String = row.get(4)?;
    let exit_code: Option<i32> = row.get(5)?;
    let tombstone_reason: Option<String> = row.get(6)?;
    let last_activity_ms_i: i64 = row.get(7)?;
    Ok(
        decode_state(&state_tag, exit_code, tombstone_reason).map(|state| SessionMeta {
            id: SessionId(id),
            cwd,
            cmd,
            shell,
            state,
            last_activity_ms: u64::try_from(last_activity_ms_i).unwrap_or(0),
        }),
    )
}

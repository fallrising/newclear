use crate::*;
use rusqlite::{Connection, TransactionBehavior};
use sha2::{Digest, Sha256};
#[derive(Clone, Copy)]
struct Migration<'a> {
    version: i64,
    sql: &'a str,
    checksum: &'a str,
}
const SQL: &str = include_str!("001.sql");
const REGISTRY: &[Migration] = &[Migration {
    version: 1,
    sql: SQL,
    checksum: "bb8b30ad3d83769af6bdcd2e8b6563266298787fd2074d29a965291daed66415",
}];
fn digest(sql: &str) -> String {
    use std::fmt::Write;
    Sha256::digest(sql.as_bytes())
        .iter()
        .fold(String::new(), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}
fn migration_error() -> DbError {
    DbError::new(ErrorCode::Migration)
}
fn validate(registry: &[Migration]) -> Result<()> {
    for (i, m) in registry.iter().enumerate() {
        if m.version != i64::try_from(i + 1).map_err(|_| migration_error())?
            || digest(m.sql) != m.checksum
        {
            return Err(migration_error());
        }
    }
    Ok(())
}
pub(crate) fn run(conn: &mut Connection, now: i64) -> Result<()> {
    run_registry(conn, REGISTRY, now)
}
fn run_registry(conn: &mut Connection, registry: &[Migration], now: i64) -> Result<()> {
    let started = std::time::Instant::now();
    validate(registry)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let metadata:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')",[],|r|r.get(0))?;
    if !metadata {
        let count: i64 = tx.query_row(
            "SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'",
            [],
            |r| r.get(0),
        )?;
        if count != 0 {
            return Err(migration_error());
        }
    }
    tx.execute_batch("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,checksum TEXT NOT NULL,applied_at INTEGER NOT NULL)")?;
    let applied: Vec<(i64, String)> = tx
        .prepare("SELECT version,checksum FROM schema_migrations ORDER BY version")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    if applied.is_empty() {
        let count:i64=tx.query_row("SELECT count(*) FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>'schema_migrations'",[],|r|r.get(0))?;
        if count != 0 {
            return Err(migration_error());
        }
    }
    if applied.len() > registry.len() {
        return Err(migration_error());
    }
    for (i, (v, checksum)) in applied.iter().enumerate() {
        if *v != registry[i].version || checksum != registry[i].checksum {
            return Err(migration_error());
        }
    }
    for m in &registry[applied.len()..] {
        tx.execute_batch(m.sql).map_err(|_| migration_error())?;
        tx.execute(
            "INSERT INTO schema_migrations(version,checksum,applied_at) VALUES(?1,?2,?3)",
            rusqlite::params![m.version, m.checksum, now],
        )
        .map_err(|_| migration_error())?;
    }
    tx.commit()?;
    eprintln!(
        "{{\"operation\":\"migration\",\"duration_us\":{},\"result\":\"ok\"}}",
        started.elapsed().as_micros()
    );
    Ok(())
}
#[cfg(test)]
mod tests;

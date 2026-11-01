use crate::*;
use rusqlite::Connection;
use std::time::{Duration, Instant};
pub(crate) fn open(path: &std::path::Path) -> Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch(
        "PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=ON;",
    )?;
    // SQLite can reject a journal-mode lock upgrade immediately despite its busy
    // handler. Retry only that startup transition, with a bounded, non-spinning wait.
    let start = Instant::now();
    let budget = Duration::from_secs(5);
    let mut retries = 0_u32;
    let mode: String = loop {
        if start.elapsed() >= budget {
            return Err(DbError::new(ErrorCode::Busy));
        }
        conn.busy_timeout(budget.saturating_sub(start.elapsed()))?;
        match conn.query_row("PRAGMA journal_mode=WAL", [], |r| r.get(0)) {
            Ok(mode) => break mode,
            Err(e) => {
                let e = DbError::from(e);
                if e.code != ErrorCode::Busy || start.elapsed() >= budget {
                    eprintln!(
                        "{{\"operation\":\"journal_mode\",\"retries\":{retries},\"duration_us\":{},\"result\":\"error\"}}",
                        start.elapsed().as_micros()
                    );
                    return Err(e);
                }
                retries += 1;
                std::thread::sleep(
                    Duration::from_millis(10).min(budget.saturating_sub(start.elapsed())),
                );
            }
        }
    };
    if retries > 0 {
        eprintln!(
            "{{\"operation\":\"journal_mode\",\"retries\":{retries},\"duration_us\":{},\"result\":\"ok\"}}",
            start.elapsed().as_micros()
        );
    }
    conn.busy_timeout(budget)?;
    conn.execute_batch("PRAGMA synchronous=NORMAL;")?;
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    let sync: i64 = conn.query_row("PRAGMA synchronous", [], |r| r.get(0))?;
    let busy: i64 = conn.query_row("PRAGMA busy_timeout", [], |r| r.get(0))?;
    let recursive: i64 = conn.query_row("PRAGMA recursive_triggers", [], |r| r.get(0))?;
    if recursive != 1
        || fk != 1
        || !matches!(mode.as_str(), "wal" | "memory")
        || sync != 1
        || busy != 5000
    {
        return Err(types::internal());
    }
    Ok(conn)
}

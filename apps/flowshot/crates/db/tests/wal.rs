#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
use std::{
    sync::{Arc, Barrier, mpsc},
    time::{Duration, Instant},
};
#[test]
fn committed_data_survives_restart() {
    let path = common::path("restart");
    let db = DbRuntime::open(&path).unwrap();
    let (d, a, c, r) = common::fixture(&db);
    db.shutdown().unwrap();
    drop(db);
    let db = DbRuntime::open(&path).unwrap();
    db.read(|q| {
        assert_eq!(q.document(d.id)?, d);
        assert_eq!(q.annotation(a.id)?, a);
        assert_eq!(q.comment(c.id)?, c);
        assert_eq!(q.comment(r.id)?, r);
        Ok(())
    })
    .unwrap();
    let raw = rusqlite::Connection::open(&path).unwrap();
    assert_eq!(
        raw.query_row::<String, _, _>("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap(),
        "wal"
    );
    assert_eq!(
        raw.query_row::<i64, _, _>("SELECT count(*) FROM pragma_foreign_key_check", [], |r| r
            .get(0))
            .unwrap(),
        0
    );
}
#[test]
fn busy_timeout_is_bounded_and_wal_readers_keep_committed_view() {
    let path = common::path("busy");
    let db = Arc::new(DbRuntime::open(&path).unwrap());
    let w = db
        .transaction(|tx| tx.create_workspace("committed".into()))
        .unwrap();
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute_batch("BEGIN IMMEDIATE; UPDATE workspaces SET name='uncommitted'")
        .unwrap();
    assert_eq!(db.read(|q| q.workspace(w.id)).unwrap().name, "committed");
    let now = Instant::now();
    let (finished, result) = mpsc::sync_channel(1);
    let writer = Arc::clone(&db);
    let job = std::thread::spawn(move || {
        let outcome = writer.transaction(|tx| tx.create_workspace("busy".into()));
        let _ = finished.send(outcome);
    });
    // SQLite's timeout counts accumulated busy-handler sleep, not scheduler or
    // filesystem delays. This is a hang watchdog, not a product latency budget.
    let outcome = result.recv_timeout(Duration::from_secs(30));
    let elapsed = now.elapsed();
    // Release the external lock before any assertion/teardown. On watchdog
    // failure the helper retains its Arc, so dropping this test's owner cannot
    // block in DbRuntime::shutdown while the helper is still waiting.
    raw.execute_batch("ROLLBACK").unwrap();
    let outcome = outcome.expect("busy request exceeded the test hang watchdog");
    job.join().unwrap();
    assert_eq!(outcome.unwrap_err().code, ErrorCode::Busy);
    eprintln!(
        "{{\"test\":\"busy_timeout\",\"elapsed_us\":{}}}",
        elapsed.as_micros()
    );
    assert!(elapsed >= Duration::from_millis(4800));
    assert!(
        db.transaction(|tx| tx.create_workspace("after busy".into()))
            .is_ok()
    );
}
#[test]
fn concurrent_startup_applies_once() {
    let path = common::path("startup");
    let barrier = Arc::new(Barrier::new(4));
    let joins: Vec<_> = (0..4)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                DbRuntime::open(&path).unwrap()
            })
        })
        .collect();
    let runtimes: Vec<_> = joins.into_iter().map(|j| j.join().unwrap()).collect();
    assert_eq!(runtimes.len(), 4);
    let c = rusqlite::Connection::open(path).unwrap();
    assert_eq!(
        c.query_row::<i64, _, _>("SELECT count(*) FROM schema_migrations", [], |r| r.get(0))
            .unwrap(),
        1
    );
}

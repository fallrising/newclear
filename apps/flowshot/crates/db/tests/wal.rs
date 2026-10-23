#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
use std::{
    sync::{Arc, Barrier},
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
    let db = DbRuntime::open(&path).unwrap();
    let w = db
        .transaction(|tx| tx.create_workspace("committed".into()))
        .unwrap();
    let raw = rusqlite::Connection::open(&path).unwrap();
    raw.execute_batch("BEGIN IMMEDIATE; UPDATE workspaces SET name='uncommitted'")
        .unwrap();
    assert_eq!(db.read(|q| q.workspace(w.id)).unwrap().name, "committed");
    let now = Instant::now();
    assert_eq!(
        db.transaction(|tx| tx.create_workspace("busy".into()))
            .unwrap_err()
            .code,
        ErrorCode::Busy
    );
    assert!(now.elapsed() >= Duration::from_millis(4800));
    assert!(now.elapsed() < Duration::from_secs(8));
    raw.execute_batch("ROLLBACK").unwrap();
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

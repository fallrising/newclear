#![allow(clippy::wildcard_imports)]
mod common;
use flowshot_db::*;
use std::sync::{Arc, mpsc};
#[test]
fn bounded_queue_order_shutdown_and_join() {
    let db = Arc::new(
        DbRuntime::with_config(
            std::path::Path::new(":memory:"),
            Config {
                write_capacity: 1,
                read_connections: 1,
            },
            Arc::new(common::FixedClock(1234)),
            Arc::new(ProductionIds),
        )
        .unwrap(),
    );
    let (start_tx, start_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let first = db
        .submit(move |tx| {
            start_tx.send(()).unwrap();
            release_rx.recv().unwrap();
            tx.create_workspace("first".into())
        })
        .unwrap();
    start_rx.recv().unwrap();
    let second = db
        .submit(|tx| tx.create_workspace("second".into()))
        .unwrap();
    assert_eq!(
        db.submit(|_| Ok(())).err().unwrap().code,
        ErrorCode::Overload
    );
    let shutdown_db = db.clone();
    let (shutdown_started, shutdown_wait) = mpsc::channel();
    let join = std::thread::spawn(move || {
        shutdown_started.send(()).unwrap();
        shutdown_db.shutdown().unwrap();
    });
    shutdown_wait.recv().unwrap();
    release_tx.send(()).unwrap();
    assert_eq!(first.wait().unwrap().name, "first");
    assert_eq!(second.wait().unwrap().name, "second");
    join.join().unwrap();
    assert_eq!(
        db.transaction(|_| Ok(())).unwrap_err().code,
        ErrorCode::Closed
    );
    assert_eq!(db.read(|_| Ok(())).unwrap_err().code, ErrorCode::Closed);
    db.shutdown().unwrap();
}
struct ProductionIds;
impl IdSource for ProductionIds {
    fn next(&self) -> uuid::Uuid {
        uuid::Uuid::now_v7()
    }
}
#[test]
fn closure_error_and_panic_roll_back_and_actor_survives() {
    let db = common::open();
    let (txid, rxid) = mpsc::channel();
    assert_eq!(
        db.transaction(move |tx| {
            let w = tx.create_workspace("sensitive rollback".into())?;
            txid.send(w.id).unwrap();
            Err::<(), _>(DbError::new(ErrorCode::Validation))
        })
        .unwrap_err()
        .code,
        ErrorCode::Validation
    );
    let id = rxid.recv().unwrap();
    assert_eq!(
        db.read(|r| r.workspace(id)).unwrap_err().code,
        ErrorCode::NotFound
    );
    let (txid, rxid) = mpsc::channel();
    assert_eq!(
        db.transaction(move |tx| {
            let w = tx.create_workspace("sensitive panic".into())?;
            txid.send(w.id).unwrap();
            panic!("actor panic boundary");
            #[allow(unreachable_code)]
            Ok(())
        })
        .unwrap_err()
        .code,
        ErrorCode::Internal
    );
    let id = rxid.recv().unwrap();
    assert_eq!(
        db.read(|r| r.workspace(id)).unwrap_err().code,
        ErrorCode::NotFound
    );
    assert!(
        db.transaction(|tx| tx.create_workspace("survived".into()))
            .is_ok()
    );
}
#[test]
fn read_pool_is_bounded_and_restored_after_panics() {
    use std::sync::{
        Barrier,
        atomic::{AtomicUsize, Ordering},
    };
    let db = Arc::new(common::open());
    let active = Arc::new(AtomicUsize::new(0));
    let max = Arc::new(AtomicUsize::new(0));
    let barrier = Arc::new(Barrier::new(2));
    let mut joins = Vec::new();
    for _ in 0..8 {
        let (db, active, max, barrier) = (db.clone(), active.clone(), max.clone(), barrier.clone());
        joins.push(std::thread::spawn(move || {
            db.read(|_| {
                let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                max.fetch_max(count, Ordering::SeqCst);
                barrier.wait();
                active.fetch_sub(1, Ordering::SeqCst);
                Ok(())
            })
            .unwrap();
        }));
    }
    for join in joins {
        join.join().unwrap();
    }
    assert_eq!(max.load(Ordering::SeqCst), 2);
    let err = db.read::<()>(|_| panic!("reader panic"));
    assert_eq!(err.unwrap_err().code, ErrorCode::Internal);
    assert!(db.read(|_| Ok(())).is_ok());
}
#[test]
fn writer_reentry_and_completion_wait_reject_before_blocking() {
    let db = Arc::new(common::open());
    let nested = db.clone();
    let (send, recv) = mpsc::channel::<Completion<()>>();
    let first = db
        .submit(move |_| {
            assert_eq!(
                nested.transaction(|_| Ok(())).unwrap_err().code,
                ErrorCode::Internal
            );
            assert_eq!(nested.shutdown().unwrap_err().code, ErrorCode::Internal);
            assert_eq!(
                nested.read(|_| Ok(())).unwrap_err().code,
                ErrorCode::Internal
            );
            let completion = recv.recv().unwrap();
            assert_eq!(completion.wait().unwrap_err().code, ErrorCode::Internal);
            Ok(())
        })
        .unwrap();
    let second = db.submit(|_| Ok(())).unwrap();
    send.send(second).unwrap();
    first.wait().unwrap();
    assert!(db.transaction(|_| Ok(())).is_ok());
}
#[test]
fn reader_reentry_and_self_shutdown_reject() {
    let db = common::open();
    db.read(|_| {
        assert_eq!(db.shutdown().unwrap_err().code, ErrorCode::Internal);
        assert_eq!(db.read(|_| Ok(())).unwrap_err().code, ErrorCode::Internal);
        Ok(())
    })
    .unwrap();
}
#[test]
fn panic_payload_is_not_logged() {
    if std::env::var_os("FLOWSHOT_REDACTION_PROBE").is_some() {
        return;
    }
    let output = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "panic_redaction_probe", "--nocapture"])
        .env("FLOWSHOT_REDACTION_PROBE", "1")
        .output()
        .unwrap();
    assert!(output.status.success());
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!text.contains("SECRET-BODY-MUST-NOT-LOG"));
}
#[test]
fn panic_redaction_probe() {
    if std::env::var_os("FLOWSHOT_REDACTION_PROBE").is_none() {
        return;
    }
    let db = common::open();
    assert_eq!(
        db.transaction::<()>(|_| panic!("SECRET-BODY-MUST-NOT-LOG"))
            .unwrap_err()
            .code,
        ErrorCode::Internal
    );
}

//! Exercises the same service installed by desktop setup, using disk SQLite and real PTYs.
use loom_contracts::{Origin, SessionId, SessionMeta, SessionState};
use loom_core::{
    pty::{SpawnConfig, VecBatchSink, VecEventSink},
    session_store::{HistorySink, SessionRuntime, SessionStore},
};
use std::{
    path::Path,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};
use tempfile::TempDir;

#[derive(Default)]
struct Notifications(AtomicUsize);
impl HistorySink for Notifications {
    fn changed(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}
async fn boot(path: &Path) -> Arc<SessionRuntime> {
    SessionRuntime::open(
        path.to_path_buf(),
        VecBatchSink::shared(),
        VecEventSink::shared(),
        Arc::new(Notifications::default()),
    )
    .await
}
fn config(path: &Path, cmd: &str) -> SpawnConfig {
    SpawnConfig {
        cwd: path.into(),
        cmd: Some(cmd.into()),
        shell: "/bin/sh".into(),
        cols: 80,
        rows: 24,
    }
}
async fn wait_exit(runtime: &SessionRuntime, id: &SessionId) {
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if matches!(
                runtime.meta(id).await.unwrap().state,
                SessionState::Exited { .. }
            ) {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("exit must be recorded");
}
async fn seed(path: &Path, id: &str, state: SessionState, cwd: &Path, cmd: &str) {
    std::fs::create_dir_all(path.join(".loom")).unwrap();
    let store = SessionStore::open(path.join(".loom/sessions.db"))
        .await
        .unwrap();
    store
        .insert(SessionMeta {
            id: SessionId(id.into()),
            cwd: cwd.to_string_lossy().into(),
            cmd: Some(cmd.into()),
            shell: "/bin/sh".into(),
            state,
            last_activity_ms: 123,
        })
        .await
        .unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn fast_exit_is_durable_and_subscribe_detach_never_resurrect_it() {
    let dir = TempDir::new().unwrap();
    let runtime = boot(dir.path()).await;
    assert!(runtime.history().await.persistent);
    for _ in 0..12 {
        let id = runtime
            .spawn(&Origin::User, config(dir.path(), "exit 7"))
            .await
            .unwrap();
        wait_exit(&runtime, &id).await;
        runtime.subscribe(&id).await.unwrap();
        runtime.detach(&id).await.unwrap();
        assert_eq!(
            runtime.meta(&id).await.unwrap().state,
            SessionState::Exited { code: Some(7) }
        );
    }
    runtime.shutdown().await;
    drop(runtime);
    let reopened = boot(dir.path()).await;
    let history = reopened.history().await;
    assert!(history.persistent);
    assert_eq!(history.sessions.len(), 12);
    assert!(history
        .sessions
        .iter()
        .all(|s| s.state == SessionState::Exited { code: Some(7) }));
    assert!(history.live_session_ids.is_empty());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn lifecycle_restart_forget_and_activity() {
    let dir = TempDir::new().unwrap();
    let runtime = boot(dir.path()).await;
    let id = runtime
        .spawn(&Origin::User, config(dir.path(), "exec cat"))
        .await
        .unwrap();
    let created = runtime.meta(&id).await.unwrap().last_activity_ms;
    assert!(runtime.forget(&Origin::User, &id).await.is_err());
    assert!(runtime
        .restart(&Origin::User, &id, None, None)
        .await
        .is_err());
    runtime.subscribe(&id).await.unwrap();
    runtime.detach(&id).await.unwrap();
    assert_eq!(
        runtime.meta(&id).await.unwrap().state,
        SessionState::Detached
    );
    tokio::time::sleep(Duration::from_millis(2)).await;
    runtime
        .write_stdin(&Origin::User, &id, b"hello\n")
        .await
        .unwrap();
    assert!(runtime.meta(&id).await.unwrap().last_activity_ms > created);
    runtime.kill(&Origin::User, &id).await.unwrap();
    assert!(runtime.history().await.live_session_ids.is_empty());
    let restarted = runtime
        .restart(&Origin::User, &id, Some(100), Some(40))
        .await
        .unwrap();
    assert_ne!(id, restarted);
    let old = runtime.meta(&id).await.unwrap();
    let new = runtime.meta(&restarted).await.unwrap();
    assert_eq!((old.cwd, old.cmd, old.shell), (new.cwd, new.cmd, new.shell));
    runtime.forget(&Origin::User, &id).await.unwrap();
    assert!(runtime.meta(&id).await.is_none());
    runtime.shutdown().await;
}

#[tokio::test]
async fn recovery_is_idempotent_and_failed_restart_preserves_history() {
    let dir = TempDir::new().unwrap();
    for (id, state) in [
        ("a", SessionState::Active),
        ("d", SessionState::Detached),
        ("s", SessionState::Spawning),
        ("e", SessionState::Exited { code: Some(3) }),
    ] {
        seed(
            dir.path(),
            id,
            state,
            &dir.path().join("missing"),
            "touch must-not-run",
        )
        .await;
    }
    let runtime = boot(dir.path()).await;
    let before = runtime.history().await;
    assert_eq!(
        before
            .sessions
            .iter()
            .filter(|m| matches!(m.state, SessionState::Tombstone { .. }))
            .count(),
        3
    );
    assert!(runtime
        .restart(&Origin::User, &SessionId("a".into()), None, None)
        .await
        .is_err());
    assert_eq!(runtime.history().await.sessions.len(), 4);
    assert!(!dir.path().join("must-not-run").exists());
    drop(runtime);
    let reopened = boot(dir.path()).await;
    assert_eq!(
        serde_json::to_value(before.sessions).unwrap(),
        serde_json::to_value(reopened.history().await.sessions).unwrap()
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn contending_runtime_cannot_reconcile_owner_and_release_allows_reopen() {
    let dir = TempDir::new().unwrap();
    let owner = boot(dir.path()).await;
    let id = owner
        .spawn(&Origin::User, config(dir.path(), "exec cat"))
        .await
        .unwrap();
    let contender = boot(dir.path()).await;
    let history = contender.history().await;
    assert!(!history.persistent);
    assert!(history.warning.unwrap().contains("history"));
    let disk = SessionStore::open(dir.path().join(".loom/sessions.db"))
        .await
        .unwrap();
    assert_eq!(
        disk.get(id.clone()).await.unwrap().unwrap().state,
        SessionState::Active
    );
    owner.shutdown().await;
    drop(owner);
    drop(contender);
    let next = boot(dir.path()).await;
    assert!(next.history().await.persistent);
    assert!(matches!(
        next.meta(&id).await.unwrap().state,
        SessionState::Exited { .. }
    ));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn corrupt_database_is_preserved_and_memory_history_remains_usable() {
    let dir = TempDir::new().unwrap();
    std::fs::create_dir(dir.path().join(".loom")).unwrap();
    let path = dir.path().join(".loom/sessions.db");
    std::fs::write(&path, b"not a database").unwrap();
    let runtime = boot(dir.path()).await;
    assert!(!runtime.history().await.persistent);
    assert!(runtime.history().await.warning.is_some());
    let id = runtime
        .spawn(&Origin::User, config(dir.path(), "exit 0"))
        .await
        .unwrap();
    wait_exit(&runtime, &id).await;
    assert_eq!(std::fs::read(path).unwrap(), b"not a database");
    runtime.shutdown().await;
}

#[cfg(unix)]
#[tokio::test]
async fn refuses_symlink_database_and_companions_without_modifying_targets() {
    for name in [
        ".loom",
        ".loom/sessions.db",
        ".loom/sessions.db-wal",
        ".loom/sessions.db-shm",
        ".loom/sessions.db-journal",
        ".loom/sessions.guard.db",
        ".loom/sessions.guard.db-journal",
        ".loom/sessions.guard.db-wal",
        ".loom/sessions.guard.db-shm",
    ] {
        let dir = TempDir::new().unwrap();
        let outside = TempDir::new().unwrap();
        if name != ".loom" {
            std::fs::create_dir(dir.path().join(".loom")).unwrap();
        }
        std::os::unix::fs::symlink(outside.path(), dir.path().join(name)).unwrap();
        let runtime = boot(dir.path()).await;
        assert!(!runtime.history().await.persistent, "accepted {name}");
        assert!(outside.path().read_dir().unwrap().next().is_none());
    }
}

#[tokio::test]
async fn unusable_directory_falls_back_visibly() {
    let dir = TempDir::new().unwrap();
    std::fs::write(dir.path().join(".loom"), b"keep me").unwrap();
    let runtime = boot(dir.path()).await;
    assert!(!runtime.history().await.persistent);
    assert!(runtime.history().await.warning.is_some());
    assert_eq!(std::fs::read(dir.path().join(".loom")).unwrap(), b"keep me");
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn persistence_failure_degrades_visibly_and_keeps_current_memory_metadata() {
    let dir = TempDir::new().unwrap();
    let notifications = Arc::new(Notifications::default());
    let events = VecEventSink::shared();
    let runtime = SessionRuntime::open(
        dir.path().into(),
        VecBatchSink::shared(),
        events.clone(),
        notifications.clone(),
    )
    .await;
    let db = rusqlite::Connection::open(dir.path().join(".loom/sessions.db")).unwrap();
    db.execute_batch("CREATE TRIGGER reject_insert BEFORE INSERT ON sessions BEGIN SELECT RAISE(FAIL, 'test write failure'); END;").unwrap();
    let id = runtime
        .spawn(&Origin::User, config(dir.path(), "exec cat"))
        .await
        .unwrap();
    let history = runtime.history().await;
    assert!(!history.persistent);
    assert!(history.warning.unwrap().contains("test write failure"));
    assert_eq!(history.sessions.len(), 1);
    runtime.kill(&Origin::User, &id).await.unwrap();
    assert!(matches!(
        runtime.meta(&id).await.unwrap().state,
        SessionState::Exited { .. }
    ));
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if events.snapshot().iter().any(|e| matches!(e, loom_contracts::Event::PtyExited { session_id, .. } if session_id == &id)) { break; }
            tokio::task::yield_now().await;
        }
    }).await.expect("kill/removal must not suppress exit event");
    assert!(notifications.0.load(Ordering::SeqCst) >= 2);
}

#[tokio::test]
async fn late_read_failure_is_visible_and_preserves_last_snapshot() {
    let dir = TempDir::new().unwrap();
    seed(
        dir.path(),
        "saved",
        SessionState::Exited { code: Some(0) },
        dir.path(),
        "exit 0",
    )
    .await;
    let runtime = boot(dir.path()).await;
    let db = rusqlite::Connection::open(dir.path().join(".loom/sessions.db")).unwrap();
    db.execute_batch("DROP TABLE sessions").unwrap();
    let history = runtime.history().await;
    assert!(!history.persistent);
    assert!(history.warning.is_some());
    assert_eq!(history.sessions.len(), 1);
}

// Separate process: no Rust destructor runs when the parent kills this helper.
#[test]
fn ownership_process_helper() {
    let Ok(vault) = std::env::var("LOOM_TEST_OWNERSHIP_VAULT") else {
        return;
    };
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let runtime = boot(Path::new(&vault)).await;
        assert!(runtime.history().await.persistent);
        std::fs::write(Path::new(&vault).join("ready"), b"ready").unwrap();
        std::future::pending::<()>().await;
        drop(runtime);
    });
}

#[tokio::test]
async fn process_termination_releases_guard_and_next_boot_recovers() {
    let dir = TempDir::new().unwrap();
    let mut child = std::process::Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "ownership_process_helper", "--nocapture"])
        .env("LOOM_TEST_OWNERSHIP_VAULT", dir.path())
        .spawn()
        .unwrap();
    let ready = tokio::time::timeout(Duration::from_secs(10), async {
        while !dir.path().join("ready").exists() {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await;
    if ready.is_err() {
        let _ = child.kill();
        let _ = child.wait();
        panic!("owner helper did not boot");
    }
    let blocked = boot(dir.path()).await;
    assert!(!blocked.history().await.persistent);
    // Simulate metadata written by the live owner immediately before abrupt termination.
    seed(
        dir.path(),
        "interrupted",
        SessionState::Active,
        dir.path(),
        "touch must-not-run",
    )
    .await;
    child.kill().unwrap();
    child.wait().unwrap();
    let recovered = boot(dir.path()).await;
    assert!(recovered.history().await.persistent);
    assert!(matches!(
        recovered
            .meta(&SessionId("interrupted".into()))
            .await
            .unwrap()
            .state,
        SessionState::Tombstone { .. }
    ));
    assert!(!dir.path().join("must-not-run").exists());
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn failed_spawn_leaves_no_history_and_shutdown_rejects_new_children() {
    let dir = TempDir::new().unwrap();
    let runtime = boot(dir.path()).await;
    let mut invalid = config(dir.path(), "exit 0");
    invalid.shell = "/missing/loom-test-shell".into();
    assert!(runtime.spawn(&Origin::User, invalid).await.is_err());
    assert!(runtime.history().await.sessions.is_empty());
    runtime.shutdown().await;
    assert!(runtime
        .spawn(&Origin::User, config(dir.path(), "exit 0"))
        .await
        .is_err());
    assert!(runtime.history().await.sessions.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn read_only_vault_falls_back_for_unprivileged_processes() {
    use std::os::unix::fs::PermissionsExt;
    let dir = TempDir::new().unwrap();
    let metadata = dir.path().join(".loom");
    std::fs::create_dir(&metadata).unwrap();
    std::fs::set_permissions(&metadata, std::fs::Permissions::from_mode(0o500)).unwrap();
    // Root can write despite mode bits. The deterministic file-at-directory
    // failure above still tests error fallback in privileged test containers.
    let cannot_write = std::fs::write(metadata.join("probe"), b"probe").is_err();
    let runtime = boot(dir.path()).await;
    if cannot_write {
        assert!(!runtime.history().await.persistent);
    }
    std::fs::set_permissions(&metadata, std::fs::Permissions::from_mode(0o700)).unwrap();
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn natural_exit_is_actionable_without_app_restart_and_cleanup_is_idempotent() {
    let dir = TempDir::new().unwrap();
    let runtime = boot(dir.path()).await;
    let id = runtime
        .spawn(&Origin::User, config(dir.path(), "exit 0"))
        .await
        .unwrap();
    wait_exit(&runtime, &id).await;
    assert!(!runtime.history().await.live_session_ids.contains(&id));
    let next = runtime
        .restart(&Origin::User, &id, None, None)
        .await
        .unwrap();
    assert_ne!(id, next);
    assert!(runtime.meta(&id).await.is_some());
    // A canceled attachment may clean up the old ID after its manager entry
    // was consumed by another explicit history action.
    runtime.kill(&Origin::User, &id).await.unwrap();
    runtime.kill(&Origin::User, &id).await.unwrap();
    runtime.forget(&Origin::User, &id).await.unwrap();
    assert!(runtime.meta(&id).await.is_none());
    runtime.kill(&Origin::User, &id).await.unwrap();
    wait_exit(&runtime, &next).await;
    runtime.forget(&Origin::User, &next).await.unwrap();
    assert!(runtime.history().await.sessions.is_empty());
    runtime.shutdown().await;
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn relative_spawn_directory_is_stored_as_absolute_for_future_restart() {
    let dir = TempDir::new().unwrap();
    let runtime = boot(dir.path()).await;
    let expected = std::env::current_dir().unwrap();
    let id = runtime
        .spawn(&Origin::User, config(Path::new("."), "exit 0"))
        .await
        .unwrap();
    wait_exit(&runtime, &id).await;
    let original = runtime.meta(&id).await.unwrap();
    assert!(Path::new(&original.cwd).is_absolute());
    assert_eq!(
        std::fs::canonicalize(&original.cwd).unwrap(),
        std::fs::canonicalize(expected).unwrap()
    );
    let next = runtime
        .restart(&Origin::User, &id, None, None)
        .await
        .unwrap();
    assert_eq!(runtime.meta(&next).await.unwrap().cwd, original.cwd);
    runtime.shutdown().await;
}

//! B1.7 integration: persisted "alive" rows from a previous run get
//! marked tombstoned on boot, and `restart_from_tombstone` spawns a new
//! Active session from the same cwd/cmd/shell.

use loom_contracts::{Origin, SessionId, SessionMeta, SessionState};
use loom_core::pty::{PtyManager, VecBatchSink, VecEventSink};
use loom_core::session_store::{recover_on_boot, restart_from_tombstone, SessionStore};

fn meta(id: &str, state: SessionState, cwd: &str, cmd: Option<&str>) -> SessionMeta {
    SessionMeta {
        id: SessionId(id.into()),
        cwd: cwd.into(),
        cmd: cmd.map(str::to_string),
        shell: "/bin/sh".into(),
        state,
        last_activity_ms: 1_700_000_000_000,
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn recover_tombstones_every_claimed_alive_row() {
    let store = SessionStore::open_in_memory().await.unwrap();

    // Three rows: one of each "claimed alive" tag, plus an already-tombstoned
    // row that recover must leave alone.
    store
        .insert(meta(
            "a-spawning",
            SessionState::Spawning,
            "/tmp",
            Some("a"),
        ))
        .await
        .unwrap();
    store
        .insert(meta("a-active", SessionState::Active, "/tmp", Some("a")))
        .await
        .unwrap();
    store
        .insert(meta(
            "a-detached",
            SessionState::Detached,
            "/tmp",
            Some("a"),
        ))
        .await
        .unwrap();
    store
        .insert(meta(
            "already-dead",
            SessionState::Tombstone {
                reason: "left over".into(),
            },
            "/tmp",
            None,
        ))
        .await
        .unwrap();
    store
        .insert(meta(
            "natural-exit",
            SessionState::Exited { code: Some(0) },
            "/tmp",
            None,
        ))
        .await
        .unwrap();

    let tombstoned = recover_on_boot(&store).await;
    assert_eq!(tombstoned.len(), 3, "must tombstone the three alive rows");

    // Verify each formerly-alive row is now a tombstone.
    for id in ["a-spawning", "a-active", "a-detached"] {
        let m = store.get(SessionId(id.into())).await.unwrap().unwrap();
        assert!(matches!(m.state, SessionState::Tombstone { .. }), "{id}");
    }
    // Verify the already-dead and exited rows weren't touched.
    let still_dead = store
        .get(SessionId("already-dead".into()))
        .await
        .unwrap()
        .unwrap();
    match still_dead.state {
        SessionState::Tombstone { reason } => assert_eq!(reason, "left over"),
        other => panic!("already-dead row was overwritten: {other:?}"),
    }
    let exited = store
        .get(SessionId("natural-exit".into()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(exited.state, SessionState::Exited { code: Some(0) });
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_from_tombstone_spawns_fresh_session() {
    let store = SessionStore::open_in_memory().await.unwrap();
    let manager = PtyManager::new(VecBatchSink::shared(), VecEventSink::shared());

    let cwd = std::env::temp_dir().to_string_lossy().to_string();
    store
        .insert(meta(
            "old",
            SessionState::Tombstone {
                reason: "previous run died".into(),
            },
            &cwd,
            Some("true"),
        ))
        .await
        .unwrap();

    let new_sid = restart_from_tombstone(&manager, &store, &Origin::User, &SessionId("old".into()))
        .await
        .expect("restart succeeds");

    // Manager now tracks the fresh session.
    assert!(manager.list_sessions().contains(&new_sid));

    // The new row is persisted as Active with the original cwd/cmd.
    let new_meta = store.get(new_sid.clone()).await.unwrap().unwrap();
    assert_eq!(new_meta.state, SessionState::Active);
    assert_eq!(new_meta.cmd.as_deref(), Some("true"));
    assert_eq!(new_meta.cwd, cwd);

    // The original tombstone row is preserved.
    let old = store.get(SessionId("old".into())).await.unwrap().unwrap();
    assert!(matches!(old.state, SessionState::Tombstone { .. }));

    let _ = manager.kill(&Origin::User, &new_sid);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn restart_from_unknown_id_returns_not_found_without_crash() {
    let store = SessionStore::open_in_memory().await.unwrap();
    let manager = PtyManager::new(VecBatchSink::shared(), VecEventSink::shared());

    let err = restart_from_tombstone(&manager, &store, &Origin::User, &SessionId("ghost".into()))
        .await
        .expect_err("expected NotFound");

    assert!(
        format!("{err}").to_lowercase().contains("not found"),
        "wrong error: {err}",
    );
}

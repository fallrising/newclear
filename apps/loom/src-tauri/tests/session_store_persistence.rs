//! B1.6 integration: on-disk persistence really survives close + reopen.
//! Also exercises the corruption fallback path documented in plan §0 answer 3.

use std::fs;

use loom_contracts::{SessionId, SessionMeta, SessionState};
use loom_core::session_store::SessionStore;
use tempfile::TempDir;

fn meta(id: &str, state: SessionState) -> SessionMeta {
    SessionMeta {
        id: SessionId(id.into()),
        cwd: "/Users/me/work/loom".into(),
        cmd: Some("claude code".into()),
        shell: "/bin/zsh".into(),
        state,
        last_activity_ms: 1_700_000_000_000,
    }
}

#[tokio::test]
async fn persist_close_reopen_returns_same_rows() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("sessions.db");

    {
        let store = SessionStore::open(db_path.clone()).await.unwrap();
        store
            .insert(meta("alpha", SessionState::Active))
            .await
            .unwrap();
        store
            .insert(meta(
                "beta",
                SessionState::Tombstone {
                    reason: "left over from a previous run".into(),
                },
            ))
            .await
            .unwrap();
        // Drop store ⇒ connection closes.
    }

    let store2 = SessionStore::open(db_path.clone()).await.unwrap();
    let rows = store2.list().await.unwrap();
    assert_eq!(rows.len(), 2);

    let alpha = store2
        .get(SessionId("alpha".into()))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(alpha.state, SessionState::Active);
    assert_eq!(alpha.cmd.as_deref(), Some("claude code"));

    let beta = store2.get(SessionId("beta".into())).await.unwrap().unwrap();
    assert!(matches!(beta.state, SessionState::Tombstone { .. }));
}

#[tokio::test]
async fn corruption_falls_back_to_in_memory_without_crashing() {
    let dir = TempDir::new().unwrap();
    let db_path = dir.path().join("sessions.db");

    // Write garbage that is not a valid SQLite header.
    fs::write(&db_path, b"this is definitely not a sqlite file").unwrap();

    let (store, fellback) = SessionStore::open_or_fallback(db_path).await.unwrap();
    assert!(fellback, "corrupt file must trigger the fallback path");

    // The fallback store is fully functional, just empty.
    assert_eq!(store.list().await.unwrap().len(), 0);
    store
        .insert(meta("post-fallback", SessionState::Active))
        .await
        .unwrap();
    assert_eq!(store.list().await.unwrap().len(), 1);
}

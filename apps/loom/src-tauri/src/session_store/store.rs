//! High-level async API. All operations wrap the sync rusqlite calls in
//! `tokio::task::spawn_blocking` so the IPC runtime stays responsive even
//! if the DB is slow (large `list`, fsync after `update_state`, etc.).
//!
//! Lock model: a single `parking_lot::Mutex` around the `Connection`
//! serializes writes (TDD §3.1 single-writer pattern). The mutex is held
//! only inside the spawn_blocking closure — never across an `.await`.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use parking_lot::Mutex;
use rusqlite::Connection;

use loom_contracts::{SessionId, SessionMeta, SessionState};

use super::db;
#[cfg(test)]
use super::error::StoreError;
use super::error::StoreResult;

#[derive(Clone)]
pub struct SessionStore {
    db: Arc<Mutex<Connection>>,
}

impl SessionStore {
    /// Open the on-disk store at `path`. Creates the file + schema if absent.
    pub async fn open(path: PathBuf) -> StoreResult<Self> {
        let conn = tokio::task::spawn_blocking(move || -> StoreResult<Connection> {
            let conn = Connection::open(&path)?;
            db::init_connection(&conn)?;
            Ok(conn)
        })
        .await??;
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
        })
    }

    /// Open the on-disk store, falling back to an in-memory store if the
    /// real file is unreadable / corrupt (§7.1 / B1 plan §0 question 3:
    /// "never crash on DB corruption, drop history instead"). Returns
    /// the store and a boolean: `true` if the fallback was taken.
    pub async fn open_or_fallback(path: PathBuf) -> StoreResult<(Self, bool)> {
        match Self::open(path).await {
            Ok(s) => Ok((s, false)),
            Err(e) => {
                tracing::warn!(error = %e, "session store unreadable; using in-memory fallback");
                let s = Self::open_in_memory().await?;
                Ok((s, true))
            }
        }
    }

    /// In-memory store. Used by tests and by the corruption fallback.
    pub async fn open_in_memory() -> StoreResult<Self> {
        let conn = tokio::task::spawn_blocking(|| -> StoreResult<Connection> {
            let conn = Connection::open_in_memory()?;
            db::init_connection(&conn)?;
            Ok(conn)
        })
        .await??;
        Ok(Self {
            db: Arc::new(Mutex::new(conn)),
        })
    }

    pub async fn insert(&self, meta: SessionMeta) -> StoreResult<()> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || db::insert(&db.lock(), &meta)).await?
    }

    pub async fn update_state(&self, sid: SessionId, state: SessionState) -> StoreResult<()> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || db::update_state(&db.lock(), &sid, &state)).await?
    }

    pub async fn touch(&self, sid: SessionId) -> StoreResult<()> {
        let ms = unix_now_ms();
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || db::update_last_activity(&db.lock(), &sid, ms)).await?
    }

    pub async fn delete(&self, sid: SessionId) -> StoreResult<()> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || db::delete(&db.lock(), &sid)).await?
    }

    pub async fn get(&self, sid: SessionId) -> StoreResult<Option<SessionMeta>> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || db::get(&db.lock(), &sid)).await?
    }

    pub async fn list(&self) -> StoreResult<Vec<SessionMeta>> {
        let db = self.db.clone();
        tokio::task::spawn_blocking(move || db::list(&db.lock())).await?
    }
}

pub fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| u64::try_from(d.as_millis()).unwrap_or(u64::MAX))
}

#[cfg(test)]
mod tests {
    use super::*;
    use loom_contracts::SessionMeta;
    use pretty_assertions::assert_eq;

    fn meta(id: &str, state: SessionState) -> SessionMeta {
        SessionMeta {
            id: SessionId(id.into()),
            cwd: "/tmp".into(),
            cmd: Some("echo hi".into()),
            shell: "/bin/sh".into(),
            state,
            last_activity_ms: 1_700_000_000_000,
        }
    }

    #[tokio::test]
    async fn round_trip_active_session() {
        let store = SessionStore::open_in_memory().await.unwrap();
        let m = meta("s1", SessionState::Active);
        store.insert(m.clone()).await.unwrap();
        let got = store.get(SessionId("s1".into())).await.unwrap().unwrap();
        assert_eq!(got.id, m.id);
        assert_eq!(got.state, SessionState::Active);
        assert_eq!(got.cwd, "/tmp");
    }

    #[tokio::test]
    async fn round_trip_exited_carries_code() {
        let store = SessionStore::open_in_memory().await.unwrap();
        store
            .insert(meta("s2", SessionState::Exited { code: Some(137) }))
            .await
            .unwrap();
        let got = store.get(SessionId("s2".into())).await.unwrap().unwrap();
        assert_eq!(got.state, SessionState::Exited { code: Some(137) });
    }

    #[tokio::test]
    async fn round_trip_tombstone_carries_reason() {
        let store = SessionStore::open_in_memory().await.unwrap();
        store
            .insert(meta(
                "s3",
                SessionState::Tombstone {
                    reason: "process gone on boot".into(),
                },
            ))
            .await
            .unwrap();
        let got = store.get(SessionId("s3".into())).await.unwrap().unwrap();
        assert_eq!(
            got.state,
            SessionState::Tombstone {
                reason: "process gone on boot".into(),
            }
        );
    }

    #[tokio::test]
    async fn update_state_changes_what_get_returns() {
        let store = SessionStore::open_in_memory().await.unwrap();
        store
            .insert(meta("s4", SessionState::Spawning))
            .await
            .unwrap();
        store
            .update_state(
                SessionId("s4".into()),
                SessionState::Exited { code: Some(0) },
            )
            .await
            .unwrap();
        let got = store.get(SessionId("s4".into())).await.unwrap().unwrap();
        assert_eq!(got.state, SessionState::Exited { code: Some(0) });
    }

    #[tokio::test]
    async fn list_orders_by_last_activity_desc() {
        let store = SessionStore::open_in_memory().await.unwrap();
        let mut a = meta("a", SessionState::Active);
        a.last_activity_ms = 100;
        let mut b = meta("b", SessionState::Active);
        b.last_activity_ms = 300;
        let mut c = meta("c", SessionState::Active);
        c.last_activity_ms = 200;
        store.insert(a).await.unwrap();
        store.insert(b).await.unwrap();
        store.insert(c).await.unwrap();

        let rows = store.list().await.unwrap();
        let ids: Vec<&str> = rows.iter().map(|r| r.id.0.as_str()).collect();
        assert_eq!(ids, vec!["b", "c", "a"]);
    }

    #[tokio::test]
    async fn update_state_on_missing_id_returns_not_found() {
        let store = SessionStore::open_in_memory().await.unwrap();
        let err = store
            .update_state(SessionId("ghost".into()), SessionState::Active)
            .await
            .unwrap_err();
        assert!(matches!(err, StoreError::NotFound(_)));
    }

    #[tokio::test]
    async fn touch_updates_last_activity() {
        let store = SessionStore::open_in_memory().await.unwrap();
        let mut m = meta("t1", SessionState::Active);
        m.last_activity_ms = 100;
        store.insert(m).await.unwrap();
        store.touch(SessionId("t1".into())).await.unwrap();
        let got = store.get(SessionId("t1".into())).await.unwrap().unwrap();
        assert!(got.last_activity_ms > 100);
    }
}

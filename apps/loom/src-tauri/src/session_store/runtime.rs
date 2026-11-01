//! Desktop session lifecycle. One async lock orders PTY transitions and their
//! SQLite writes; the memory snapshot survives storage failure. Exit observers
//! acquire the same lock, so even an instant exit follows the initial insert.
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};

use loom_contracts::{Origin, SessionId, SessionMeta, SessionState, StreamId};
use rusqlite::Connection;
use serde::Serialize;
use tokio::sync::Mutex;

use super::{unix_now_ms, SessionStore};
use crate::{
    fs::{DocumentService, EchoGuard},
    pty::{BatchSink, EventSink, LocalState, PtyManager, SpawnConfig},
};

pub trait HistorySink: Send + Sync {
    fn changed(&self);
}

#[derive(Clone, Serialize)]
pub struct SessionHistory {
    pub sessions: Vec<SessionMeta>,
    pub live_session_ids: Vec<SessionId>,
    pub persistent: bool,
    pub warning: Option<String>,
}

pub struct SessionRuntime {
    manager: PtyManager,
    state: Mutex<RuntimeState>,
    notifications: Arc<dyn HistorySink>,
    exit_observers: parking_lot::Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

struct RuntimeState {
    store: Option<SessionStore>,
    // A RESERVED lock on a separate DB is OS-released on process death. Never
    // release it merely because history writes degrade: this runtime still owns PTYs.
    _ownership: Option<Connection>,
    sessions: HashMap<SessionId, SessionMeta>,
    warning: Option<String>,
    stopped: bool,
}

impl RuntimeState {
    fn degrade(&mut self, error: impl std::fmt::Display) {
        let warning = format!("Session history will not survive restart: {error}");
        tracing::warn!(%warning);
        self.warning = Some(warning);
        self.store = None;
    }

    async fn save(&mut self, meta: SessionMeta) {
        if let Some(store) = &self.store {
            if let Err(error) = store.save(meta.clone()).await {
                self.degrade(error);
            }
        }
        self.sessions.insert(meta.id.clone(), meta);
    }
}

impl SessionRuntime {
    /// Boot fully before publishing this service to IPC. Errors preserve the
    /// original files and produce an explicit, usable in-memory history.
    pub async fn open(
        vault: PathBuf,
        batches: Arc<dyn BatchSink>,
        events: Arc<dyn EventSink>,
        notifications: Arc<dyn HistorySink>,
    ) -> Arc<Self> {
        let mut state = RuntimeState {
            store: None,
            _ownership: None,
            sessions: HashMap::new(),
            warning: None,
            stopped: false,
        };
        let prepared = tokio::task::spawn_blocking(move || prepare_store(vault)).await;
        match prepared {
            Ok(Ok((path, ownership))) => {
                state._ownership = Some(ownership);
                match SessionStore::open(path).await {
                    Ok(store) => match store.list().await {
                        Ok(rows) => {
                            state.store = Some(store);
                            for mut meta in rows {
                                if matches!(
                                    meta.state,
                                    SessionState::Spawning
                                        | SessionState::Active
                                        | SessionState::Detached
                                ) {
                                    meta.state = SessionState::Tombstone {
                                        reason: "process not found after app restart".into(),
                                    };
                                    state.save(meta).await;
                                } else {
                                    state.sessions.insert(meta.id.clone(), meta);
                                }
                            }
                        }
                        Err(error) => state.degrade(error),
                    },
                    Err(error) => state.degrade(error),
                }
            }
            Ok(Err(error)) => state.degrade(error),
            Err(error) => state.degrade(error),
        }
        Arc::new(Self {
            manager: PtyManager::new(batches, events),
            state: Mutex::new(state),
            notifications,
            exit_observers: parking_lot::Mutex::new(Vec::new()),
        })
    }

    pub async fn history(&self) -> SessionHistory {
        let mut state = self.state.lock().await;
        // Probe reads too: a failed database must not continue advertising durability.
        if let Some(store) = &state.store {
            if let Err(error) = store.list().await {
                state.degrade(error);
                self.notifications.changed();
            }
        }
        let mut sessions: Vec<_> = state.sessions.values().cloned().collect();
        sessions.sort_by(|a, b| {
            b.last_activity_ms
                .cmp(&a.last_activity_ms)
                .then_with(|| a.id.0.cmp(&b.id.0))
        });
        SessionHistory {
            sessions,
            // Exited entries retain replay buffers until an explicit history
            // action/close consumes them; they are no longer live processes.
            live_session_ids: self
                .manager
                .list_sessions()
                .into_iter()
                .filter(|id| self.is_running(id))
                .collect(),
            persistent: state.store.is_some(),
            warning: state.warning.clone(),
        }
    }

    pub async fn meta(&self, id: &SessionId) -> Option<SessionMeta> {
        self.state.lock().await.sessions.get(id).cloned()
    }

    fn is_running(&self, id: &SessionId) -> bool {
        self.manager
            .get_session(id)
            .is_some_and(|session| matches!(session.local_state(), LocalState::Running))
    }

    pub fn list_sessions(&self) -> Vec<SessionId> {
        self.manager.list_sessions()
    }

    pub async fn spawn(
        self: &Arc<Self>,
        origin: &Origin,
        config: SpawnConfig,
    ) -> Result<SessionId, String> {
        let mut state = self.state.lock().await;
        self.spawn_locked(&mut state, origin, config).await
    }

    async fn spawn_locked(
        self: &Arc<Self>,
        state: &mut RuntimeState,
        origin: &Origin,
        mut config: SpawnConfig,
    ) -> Result<SessionId, String> {
        if state.stopped {
            return Err("session runtime is shutting down".into());
        }
        if config.cwd.is_relative() {
            config.cwd = std::env::current_dir()
                .map_err(|e| e.to_string())?
                .join(&config.cwd);
        }
        // portable-pty may otherwise substitute a default cwd on some platforms.
        if !config.cwd.is_dir() {
            return Err(format!(
                "working directory is unavailable: {}",
                config.cwd.display()
            ));
        }
        let id = self
            .manager
            .spawn(origin, config.clone())
            .map_err(|e| e.to_string())?;
        let session = self
            .manager
            .get_session(&id)
            .expect("newly inserted session");
        state
            .save(SessionMeta {
                id: id.clone(),
                cwd: config.cwd.to_string_lossy().into_owned(),
                cmd: config.cmd,
                shell: config.shell,
                state: SessionState::Active,
                last_activity_ms: unix_now_ms(),
            })
            .await;
        let weak = Arc::downgrade(self);
        let exited_id = id.clone();
        let observer = tokio::spawn(async move {
            let code = session.wait_for_exit().await;
            if let Some(runtime) = weak.upgrade() {
                let mut state = runtime.state.lock().await;
                // A completed kill/forget may already have consumed this event.
                if let Some(mut meta) = state.sessions.get(&exited_id).cloned() {
                    if !matches!(meta.state, SessionState::Exited { .. }) {
                        meta.state = SessionState::Exited { code };
                        meta.last_activity_ms = unix_now_ms();
                        state.save(meta).await;
                        runtime.notifications.changed();
                    }
                }
            }
        });
        self.exit_observers.lock().push(observer);
        self.notifications.changed();
        Ok(id)
    }

    pub async fn restart(
        self: &Arc<Self>,
        origin: &Origin,
        id: &SessionId,
        cols: Option<u16>,
        rows: Option<u16>,
    ) -> Result<SessionId, String> {
        let mut state = self.state.lock().await;
        if self.is_running(id) {
            return Err("cannot restart a running session".into());
        }
        let old = state
            .sessions
            .get(id)
            .ok_or("session history was not found")?;
        if !matches!(
            old.state,
            SessionState::Exited { .. } | SessionState::Tombstone { .. }
        ) {
            return Err("session is not restartable".into());
        }
        let config = SpawnConfig {
            cwd: PathBuf::from(&old.cwd),
            cmd: old.cmd.clone(),
            shell: old.shell.clone(),
            cols: cols.unwrap_or(120),
            rows: rows.unwrap_or(30),
        };
        let restarted = self.spawn_locked(&mut state, origin, config).await?;
        // Preserve the original replay buffer on restart failure; consume it
        // only after the replacement exists. The old metadata remains history.
        if self.manager.get_session(id).is_some() {
            self.manager.remove(id).map_err(|e| e.to_string())?;
        }
        Ok(restarted)
    }

    pub async fn forget(&self, origin: &Origin, id: &SessionId) -> Result<(), String> {
        let mut state = self.state.lock().await;
        if self.is_running(id) {
            return Err("cannot forget a running session".into());
        }
        if !state.sessions.contains_key(id) {
            return Ok(());
        }
        tracing::info!(?origin, ?id, "forget session history");
        if let Some(store) = &state.store {
            if let Err(error) = store.delete(id.clone()).await {
                let message = error.to_string();
                state.degrade(&message);
                self.notifications.changed();
                return Err(message);
            }
        }
        if self.manager.get_session(id).is_some() {
            self.manager.remove(id).map_err(|e| e.to_string())?;
        }
        state.sessions.remove(id);
        self.notifications.changed();
        Ok(())
    }

    async fn record_current(
        &self,
        state: &mut RuntimeState,
        id: &SessionId,
        running: Option<SessionState>,
    ) {
        if let Some(mut meta) = state.sessions.get(id).cloned() {
            if let Some(session) = self.manager.get_session(id) {
                match session.local_state() {
                    LocalState::Exited { code } => meta.state = SessionState::Exited { code },
                    LocalState::Running => {
                        if !matches!(meta.state, SessionState::Exited { .. }) {
                            if let Some(next) = running {
                                meta.state = next;
                            }
                        }
                    }
                }
            }
            meta.last_activity_ms = unix_now_ms();
            state.save(meta).await;
            self.notifications.changed();
        }
    }

    pub async fn subscribe(&self, id: &SessionId) -> Result<StreamId, String> {
        let mut state = self.state.lock().await;
        let stream = self.manager.subscribe(id).map_err(|e| e.to_string())?;
        self.record_current(&mut state, id, Some(SessionState::Active))
            .await;
        Ok(stream)
    }

    pub async fn detach(&self, id: &SessionId) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.manager.detach(id).map_err(|e| e.to_string())?;
        self.record_current(&mut state, id, Some(SessionState::Detached))
            .await;
        Ok(())
    }

    pub async fn write_stdin(
        &self,
        origin: &Origin,
        id: &SessionId,
        bytes: &[u8],
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.manager
            .write_stdin(origin, id, bytes)
            .map_err(|e| e.to_string())?;
        self.record_current(&mut state, id, None).await;
        Ok(())
    }

    pub async fn resize(
        &self,
        origin: &Origin,
        id: &SessionId,
        cols: u16,
        rows: u16,
    ) -> Result<(), String> {
        let mut state = self.state.lock().await;
        self.manager
            .resize(origin, id, cols, rows)
            .map_err(|e| e.to_string())?;
        self.record_current(&mut state, id, None).await;
        Ok(())
    }

    pub async fn kill(&self, origin: &Origin, id: &SessionId) -> Result<(), String> {
        let mut state = self.state.lock().await;
        // Closing/canceled attachment cleanup may arrive after a history
        // action has already consumed an exited entry. Nothing remains to kill.
        if self.manager.get_session(id).is_none() {
            return Ok(());
        }
        self.manager.kill(origin, id).map_err(|e| e.to_string())?;
        let session = self.manager.get_session(id).ok_or("session not found")?;
        tokio::time::timeout(Duration::from_secs(3), session.wait_for_exit())
            .await
            .map_err(|_| "timed out waiting for terminal exit")?;
        self.record_current(&mut state, id, None).await;
        self.manager.remove(id).map_err(|e| e.to_string())?;
        self.notifications.changed();
        Ok(())
    }

    pub fn scrollback(&self, id: &SessionId, cap: usize) -> Result<String, String> {
        self.manager.scrollback(id, cap).map_err(|e| e.to_string())
    }

    pub async fn shutdown(&self) {
        self.state.lock().await.stopped = true;
        // Signal every child first; a slow exit must not defer killing the rest.
        for id in self.manager.list_sessions() {
            let _ = self.manager.kill(&Origin::User, &id);
        }
        for id in self.manager.list_sessions() {
            if let Err(error) = self.kill(&Origin::User, &id).await {
                tracing::warn!(%error, "terminal shutdown incomplete");
            }
        }
        let observers = std::mem::take(&mut *self.exit_observers.lock());
        for mut observer in observers {
            if tokio::time::timeout(Duration::from_secs(3), &mut observer)
                .await
                .is_err()
            {
                observer.abort();
            }
        }
    }
}

fn prepare_store(vault: PathBuf) -> Result<(PathBuf, Connection), String> {
    let paths = DocumentService::new(vault, Arc::new(EchoGuard::new()));
    let directory = paths
        .resolve_path(std::path::Path::new(".loom"))
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
    for name in ["sessions.db", "sessions.guard.db"] {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            paths
                .resolve_path(&PathBuf::from(format!(".loom/{name}{suffix}")))
                .map_err(|e| e.to_string())?;
        }
    }
    let guard = Connection::open(directory.join("sessions.guard.db")).map_err(|e| e.to_string())?;
    guard
        .busy_timeout(Duration::ZERO)
        .map_err(|e| e.to_string())?;
    guard
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| format!("another app may own this vault's session history: {e}"))?;
    Ok((directory.join("sessions.db"), guard))
}

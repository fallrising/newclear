//! Boot-time reconciliation between the persisted `sessions` table and
//! the live PTY world.
//!
//! MVP semantics (§7.1, B1 plan §0): the GUI process is the only place
//! PTYs live (no `loom-daemon` yet), so every row that claims to be alive
//! on boot is in fact dead. We **mark them tombstoned** and expose
//! `restart_from_tombstone` so the UI's "restart this terminal" button can
//! spawn a fresh PTY with the same cwd / cmd / shell. The original
//! tombstone row is preserved as history.
//!
//! When the daemon split arrives (decision A in TDD §10), `recover_on_boot`
//! becomes the place where we actually try to re-attach to live PTYs over
//! the socket — until then, this stays a graceful-degrade shim.

use std::path::PathBuf;

use loom_contracts::{Origin, SessionId, SessionMeta, SessionState};

use crate::pty::{PtyError, PtyManager, PtyResult, SpawnConfig};

use super::store::{unix_now_ms, SessionStore};

/// Run reconciliation. Returns the IDs newly marked tombstoned, in
/// last-activity-DESC order (so the UI naturally shows recent ones first).
/// Failures to update individual rows are logged but never crash the boot.
pub async fn recover_on_boot(store: &SessionStore) -> Vec<SessionId> {
    let sessions = match store.list().await {
        Ok(s) => s,
        Err(e) => {
            tracing::warn!(error = %e, "list sessions failed on recovery; skipping");
            return Vec::new();
        }
    };

    let mut tombstoned = Vec::new();
    for meta in sessions {
        if !is_claimed_alive(&meta.state) {
            continue;
        }
        let new_state = SessionState::Tombstone {
            reason: "process not found after app restart".into(),
        };
        match store.update_state(meta.id.clone(), new_state).await {
            Ok(()) => tombstoned.push(meta.id),
            Err(e) => {
                tracing::warn!(sid = ?meta.id, error = %e, "could not mark tombstone");
            }
        }
    }
    tombstoned
}

/// Spawn a fresh PTY using the cwd / cmd / shell from a tombstone row, and
/// persist the new session as an Active row. The original tombstone row is
/// untouched.
pub async fn restart_from_tombstone(
    manager: &PtyManager,
    store: &SessionStore,
    origin: &Origin,
    tombstoned_sid: &SessionId,
) -> PtyResult<SessionId> {
    let meta = store
        .get(tombstoned_sid.clone())
        .await
        .map_err(|e| PtyError::Io(tombstoned_sid.clone(), e.to_string()))?
        .ok_or_else(|| PtyError::NotFound(tombstoned_sid.clone()))?;

    let config = SpawnConfig {
        cwd: PathBuf::from(&meta.cwd),
        cmd: meta.cmd.clone(),
        shell: meta.shell.clone(),
        cols: 80,
        rows: 24,
    };
    let new_sid = manager.spawn(origin, config)?;

    let new_meta = SessionMeta {
        id: new_sid.clone(),
        cwd: meta.cwd,
        cmd: meta.cmd,
        shell: meta.shell,
        state: SessionState::Active,
        last_activity_ms: unix_now_ms(),
    };
    if let Err(e) = store.insert(new_meta).await {
        tracing::warn!(sid = ?new_sid, error = %e, "could not persist restarted session row");
    }

    Ok(new_sid)
}

fn is_claimed_alive(state: &SessionState) -> bool {
    matches!(
        state,
        SessionState::Spawning | SessionState::Active | SessionState::Detached
    )
}

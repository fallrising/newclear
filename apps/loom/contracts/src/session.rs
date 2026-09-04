//! Session metadata persisted in SQLite (§4.2 `sessions`). Main data with
//! graceful-degrade semantics: app boot reads this, tries to re-attach each
//! row, and falls back to a `Tombstone` state on failure (§7.1).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::SessionId;

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct SessionMeta {
    pub id: SessionId,
    pub cwd: String,
    pub cmd: Option<String>,
    pub shell: String,
    pub state: SessionState,
    pub last_activity_ms: u64,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SessionState {
    Spawning,
    Active,
    Detached,
    Exited {
        code: Option<i32>,
    },
    /// §7.1: re-attach failed. Carries enough metadata for the one-click
    /// restart button (handled by C1/E0, not core).
    Tombstone {
        reason: String,
    },
}

//! Canvas nodes. Three kinds: Document, Terminal, Tombstone.
//! Tombstone carries enough data to one-click restart the original (§7.1).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::{NodeId, SessionId};

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum NodeKind {
    Document {
        path: String,
    },
    Terminal {
        session_id: SessionId,
    },
    Tombstone {
        reason: String,
        was: TombstoneSubject,
    },
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum TombstoneSubject {
    Document {
        path: String,
    },
    Terminal {
        cwd: String,
        cmd: Option<String>,
        shell: Option<String>,
    },
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct Node {
    pub id: NodeId,
    pub kind: NodeKind,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    pub group: Option<String>,
}

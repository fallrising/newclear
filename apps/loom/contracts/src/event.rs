//! Events (Rust → TS, push). Fixed enum for core events plus a `PluginEvent`
//! variant carrying the D-11 namespaced topic shape `plugin:<id>:<topic>`.
//! A0 only reserves the shape; D1 implements the actual bus.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::{EdgeId, NodeId, PluginId, SessionId};

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Event {
    FsChanged {
        path: String,
        change: FsChangeKind,
    },
    AgentStatus {
        session_id: SessionId,
        status: AgentStatusKind,
    },
    PtyExited {
        session_id: SessionId,
        exit_code: Option<i32>,
    },
    NodeChanged {
        node_id: NodeId,
    },
    EdgeChanged {
        edge_id: EdgeId,
    },
    /// D-11. v1 producer: app-internal agent via plugin MCP tool. Future:
    /// daemon HTTP ingress (origin: Remote) — bus consumer side stays unchanged.
    PluginEvent {
        plugin_id: PluginId,
        topic: String,
        #[ts(type = "unknown")]
        payload: serde_json::Value,
    },
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum FsChangeKind {
    Created,
    Modified,
    Deleted,
    Renamed { from: String },
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AgentStatusKind {
    Idle,
    Busy { task: Option<String> },
    Error { message: String },
}

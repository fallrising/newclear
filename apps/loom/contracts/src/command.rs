//! IPC commands (TS → Rust, request/response).
//!
//! Split into two enums so the read/write distinction is structural,
//! not a convention. Read commands are default-allowed (B3); every
//! `WriteCommand` variant explicitly carries `origin: Origin` (D-3)
//! and flows through the approve gate (B3 / §7.4).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::edge::EdgeKind;
use crate::ids::{EdgeId, NodeId, SessionId};
use crate::node::NodeKind;
use crate::origin::Origin;

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WriteCommand {
    // ── PTY lifecycle (D-1, D-5) ──────────────────────────────────────────
    SpawnPty {
        origin: Origin,
        cwd: String,
        cmd: Option<String>,
        shell: Option<String>,
    },
    KillPty {
        origin: Origin,
        session_id: SessionId,
    },
    ResizePty {
        origin: Origin,
        session_id: SessionId,
        cols: u16,
        rows: u16,
    },

    // ── PTY view subscription, decoupled from lifecycle (D-5) ─────────────
    AttachSessionView {
        origin: Origin,
        session_id: SessionId,
    },
    DetachSessionView {
        origin: Origin,
        session_id: SessionId,
    },

    // ── Filesystem writes (B2 territory; A0 only fixes the shape) ─────────
    /// `expected_hash` is the on-disk hash the caller saw last. If set and
    /// the file has since changed, the write fails so the conflict UI can
    /// surface (§7.2). `None` means unconditional overwrite.
    WriteDocument {
        origin: Origin,
        path: String,
        content: String,
        expected_hash: Option<String>,
    },

    // ── Canvas writes (C3/E0 territory) ───────────────────────────────────
    CreateNode {
        origin: Origin,
        node_kind: NodeKind,
        x: f64,
        y: f64,
    },
    UpdateNodePosition {
        origin: Origin,
        node_id: NodeId,
        x: f64,
        y: f64,
    },
    DeleteNode {
        origin: Origin,
        node_id: NodeId,
    },
    CreateEdge {
        origin: Origin,
        from: NodeId,
        to: NodeId,
        edge_kind: EdgeKind,
    },
    DeleteEdge {
        origin: Origin,
        edge_id: EdgeId,
    },

    // ── MCP tools that change state (B3 territory) ────────────────────────
    /// D-8: default `target` resolves to caller's own terminal via the
    /// per-node capability token; explicit `target` overrides that default.
    InjectCommand {
        origin: Origin,
        target: SessionId,
        command: String,
    },
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ReadCommand {
    OpenFile {
        path: String,
    },
    ReadDocument {
        path: String,
    },
    ListNodes,
    ListEdges,
    GetTerminalOutput {
        session_id: SessionId,
        last_n_lines: Option<usize>,
    },
}

//! Bidirectional / streaming IPC.
//!
//! D-2: PTY output is batched per-frame (~16–33 ms) and pushed via `PtyBatch`.
//! When the backend ring buffer is full it drops old frames (terminal semantics:
//! the newest output is what matters); `dropped_old` tells the frontend how many.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::{SessionId, StreamId};

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct PtyBatch {
    pub stream_id: StreamId,
    pub session_id: SessionId,
    pub frames: Vec<String>,
    pub dropped_old: u32,
}

/// AI completion stream (§3.2). Cancellable mid-stream by the frontend.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiChunk {
    Start {
        stream_id: StreamId,
    },
    Text {
        stream_id: StreamId,
        delta: String,
    },
    Done {
        stream_id: StreamId,
    },
    Error {
        stream_id: StreamId,
        message: String,
    },
    Cancelled {
        stream_id: StreamId,
    },
}

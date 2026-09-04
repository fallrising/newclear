//! Production sinks that forward backend events to the Tauri webview.
//!
//! `PtyBatch` lands on the JS `pty:io` channel; `Event` (PtyExited,
//! FsChanged, …) lands on `loom:event`. The frontend (`src/ipc.ts`)
//! subscribes via `listen()` and routes from there.
//!
//! Emit failures (window closed mid-emit) are logged at `warn` and
//! swallowed — the runtime should keep producing frames even if the
//! webview is temporarily unreachable.

use tauri::{AppHandle, Emitter};

use loom_contracts::{Event, PtyBatch};

use crate::pty::{BatchSink, EventSink};

pub const PTY_IO_EVENT: &str = "pty:io";
pub const LOOM_EVENT: &str = "loom:event";

pub struct TauriBatchSink {
    app: AppHandle,
}

impl TauriBatchSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl BatchSink for TauriBatchSink {
    fn emit(&self, batch: PtyBatch) {
        if let Err(e) = self.app.emit(PTY_IO_EVENT, &batch) {
            tracing::warn!(error = %e, "failed to emit pty:io");
        }
    }
}

pub struct TauriEventSink {
    app: AppHandle,
}

impl TauriEventSink {
    #[must_use]
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: Event) {
        if let Err(e) = self.app.emit(LOOM_EVENT, &event) {
            tracing::warn!(error = %e, "failed to emit loom:event");
        }
    }
}

//! Output sinks for the PTY subsystem.
//!
//! Two traits, two production targets:
//!
//! - `BatchSink::emit(PtyBatch)` — frames flowing out of the batcher.
//!   Production: a Tauri `AppHandle::emit("pty_io", batch)` wrapper (wired
//!   by E0). Tests use `VecBatchSink`.
//! - `EventSink::emit(Event)` — non-stream events (PtyExited today).
//!   Production: same Tauri handle; tests use `VecEventSink`.
//!
//! Both sinks are **sync** because the production implementation just
//! queues an IPC message; making them async would only complicate the
//! caller without buying anything. Implementations must be fast; the
//! `PtyManager` holds its internal lock across `emit` to keep subscribe
//! semantics simple (the initial replay is emitted synchronously).

use std::sync::Arc;

use parking_lot::Mutex;

use loom_contracts::{Event, PtyBatch};

pub trait BatchSink: Send + Sync {
    fn emit(&self, batch: PtyBatch);
}

pub trait EventSink: Send + Sync {
    fn emit(&self, event: Event);
}

/// Collects every `PtyBatch` in memory. For tests and offline dev only.
#[derive(Default)]
pub struct VecBatchSink {
    inner: Mutex<Vec<PtyBatch>>,
}

impl VecBatchSink {
    #[must_use]
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn take(&self) -> Vec<PtyBatch> {
        std::mem::take(&mut *self.inner.lock())
    }

    pub fn snapshot(&self) -> Vec<PtyBatch> {
        self.inner.lock().clone()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().is_empty()
    }
}

impl BatchSink for VecBatchSink {
    fn emit(&self, batch: PtyBatch) {
        self.inner.lock().push(batch);
    }
}

#[derive(Default)]
pub struct VecEventSink {
    inner: Mutex<Vec<Event>>,
}

impl VecEventSink {
    #[must_use]
    pub fn shared() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn take(&self) -> Vec<Event> {
        std::mem::take(&mut *self.inner.lock())
    }

    pub fn snapshot(&self) -> Vec<Event> {
        self.inner.lock().clone()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().is_empty()
    }
}

impl EventSink for VecEventSink {
    fn emit(&self, event: Event) {
        self.inner.lock().push(event);
    }
}

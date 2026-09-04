//! PTY manager. Owns spawn/kill/resize, the per-PTY ring buffer (D-2),
//! the reader task, and the frame batcher (D-5: PTY lifecycle decoupled
//! from frontend view subscription).
//!
//! This module is B1 territory. See `plans/B1-plan.md`.

pub mod batcher;
pub mod error;
pub mod manager;
pub mod ring_buffer;
pub mod session;
pub mod sinks;

pub use batcher::DEFAULT_BATCH_INTERVAL;
pub use error::{PtyError, PtyResult};
pub use manager::PtyManager;
pub use ring_buffer::{Frame, RingBuffer, RingPoll, DEFAULT_RING_CAP, RING_CAP_ENV_VAR};
pub use session::{LocalState, PtySession, SpawnConfig};
pub use sinks::{BatchSink, EventSink, VecBatchSink, VecEventSink};

//! Filesystem layer: vault watching, echo-loop guard (D-7), and the
//! `.md`-as-source-of-truth document service. B2 territory.
//!
//! See `plans/B2-plan.md`.

pub mod atomic_write;
pub mod document;
pub mod echo_guard;
pub mod error;
pub mod watcher;

pub use document::{ConflictStatus, DocumentService, DocumentSnapshot, WriteOutcome};
pub use echo_guard::{EchoGuard, DEFAULT_ECHO_TTL};
pub use error::{FsError, FsResult};
pub use watcher::{
    FsWatcher, DEFAULT_DEBOUNCE_MS, DEFAULT_RECONCILE_INTERVAL, FS_DEBOUNCE_ENV_VAR,
};

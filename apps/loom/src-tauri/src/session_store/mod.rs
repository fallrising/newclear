//! Session metadata persistence (SQLite). B1 territory.
//!
//! See `schema/sqlite.md` and `schema/source-of-truth.md`: `sessions` is
//! **main data with graceful degrade** — on DB corruption the desktop preserves the original file and uses
//! explicitly degraded in-memory metadata rather than refusing to boot.

pub mod db;
pub mod error;
pub mod recover;
pub mod store;

pub use error::{StoreError, StoreResult};
pub use recover::{recover_on_boot, restart_from_tombstone};
pub use store::{unix_now_ms, SessionStore};

pub mod runtime;
pub use runtime::{HistorySink, SessionHistory, SessionRuntime};

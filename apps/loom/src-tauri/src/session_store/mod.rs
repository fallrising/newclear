//! Session metadata persistence (SQLite). B1 territory.
//!
//! See `schema/sqlite.md` and `schema/source-of-truth.md`: `sessions` is
//! **main data with graceful degrade** — on DB corruption we drop history
//! rather than refuse to boot (B1 plan §0 answer 3).

pub mod db;
pub mod error;
pub mod recover;
pub mod store;

pub use error::{StoreError, StoreResult};
pub use recover::{recover_on_boot, restart_from_tombstone};
pub use store::{unix_now_ms, SessionStore};

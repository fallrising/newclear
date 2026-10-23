//! Blocking `SQLite` boundary. Call `Completion::wait`, `read`, and `transaction` only
//! on blocking threads (Tauri async callers use `spawn_blocking`). `submit` never
//! waits for the writer. Production startup calls `DbRuntime::open` before UI setup.
#![allow(
    clippy::missing_errors_doc,
    clippy::must_use_candidate,
    clippy::module_name_repetitions,
    clippy::wildcard_imports
)]
mod connection;
mod executor;
mod migrations;
mod repository;
mod transaction;
mod types;
pub use executor::{Completion, Config, DbRuntime};
pub use repository::{Repository, normalize_tag};
pub use transaction::Transaction;
pub use types::*;

/// Distinct domain IDs cannot be substituted at repository methods.
/// ```compile_fail
/// use flowshot_db::{Repository, TagId};
/// fn wrong(repo: &Repository<'_>, tag: TagId) { let _ = repo.document(tag); }
/// ```
const _: () = ();

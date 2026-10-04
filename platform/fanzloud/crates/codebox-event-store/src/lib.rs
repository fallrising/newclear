//! SQLite persistence for versioned Codebox domain events.

mod codec;
mod error;
mod path;
mod snapshot;
mod sqlite;

pub use error::{
    CorruptStoreStage, DatabasePathErrorKind, EventStoreError, InvalidEventHistoryReason,
    InvalidSnapshotReason, SnapshotCacheReason, SnapshotConflictReason, StorageErrorKind,
    StorageOperation,
};
pub use sqlite::{
    MAX_APPEND_EVENTS, MAX_EVENT_PAYLOAD_BYTES, MAX_REPLAY_EVENTS, SQLITE_BUSY_TIMEOUT,
    SqliteEventStore,
};

pub use snapshot::{MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_PREFIX_EVENTS, SessionSnapshot};

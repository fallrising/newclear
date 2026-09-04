//! Errors from the persistence layer. Distinct from `PtyError` so callers
//! can branch on "DB is busted" vs "session not running".

use loom_contracts::SessionId;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("sqlite error: {0}")]
    Sql(#[from] rusqlite::Error),

    #[error("blocking task panicked: {0}")]
    TaskJoin(#[from] tokio::task::JoinError),

    #[error("unknown session state tag in database: {0:?}")]
    InvalidStateTag(String),

    #[error("session {0:?} not found in store")]
    NotFound(SessionId),
}

pub type StoreResult<T> = Result<T, StoreError>;

//! Errors surfaced by the fs layer. Split by concern so callers (and
//! eventually B3's gate) can branch precisely.

use std::path::PathBuf;

#[derive(Debug, thiserror::Error)]
pub enum FsError {
    #[error("path {0:?} is not inside the configured vault root")]
    PathOutsideVault(PathBuf),

    #[error("document {0:?} not found in vault")]
    NotFound(PathBuf),

    #[error("write to {path:?} rejected: on-disk content changed since the caller last read it")]
    Conflict {
        path: PathBuf,
        current_disk_hash: String,
    },

    #[error("io error on {path:?}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("notify error: {0}")]
    Notify(#[from] notify::Error),

    #[error("blocking task panicked: {0}")]
    TaskJoin(#[from] tokio::task::JoinError),
}

pub type FsResult<T> = Result<T, FsError>;

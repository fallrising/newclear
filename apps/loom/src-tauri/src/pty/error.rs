//! Errors surfaced by the PTY layer. Distinct from `tokio::io::Error` so the
//! caller can branch on "spawn failed" vs "already-exited write" vs IO.

use loom_contracts::SessionId;

#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("failed to open PTY: {0}")]
    Open(String),

    #[error("failed to spawn child for session {0:?}: {1}")]
    Spawn(SessionId, String),

    #[error("session {0:?} not found")]
    NotFound(SessionId),

    #[error("session {0:?} has already exited")]
    AlreadyExited(SessionId),

    #[error("IO error on session {0:?}: {1}")]
    Io(SessionId, String),
}

pub type PtyResult<T> = Result<T, PtyError>;

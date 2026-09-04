//! Single PTY session. Owns the master fd, the spawned child's killer, the
//! ring buffer that captures output, and the long-running reader / waiter
//! tasks that pump bytes into the buffer and detect process exit.
//!
//! The session is decoupled from any frontend view (D-5). The reader runs
//! as soon as the session is alive; subscribers come and go via the
//! `PtyManager` (B1.5) without affecting this layer.
//!
//! Encoding: PTY output is UTF-8-lossy-decoded per `read()` chunk. Multibyte
//! sequences that span a chunk boundary are replaced with U+FFFD on the
//! first chunk and silently garbled on the second. This is acceptable for
//! ANSI-heavy terminal output (ANSI is pure ASCII); a partial-sequence
//! decoder is a known future improvement and does not affect P0 correctness.

use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::Arc;

use parking_lot::Mutex;
use portable_pty::{native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtySize};
use tokio::sync::{mpsc, watch};

use loom_contracts::SessionId;

use super::error::{PtyError, PtyResult};
use super::ring_buffer::RingBuffer;

/// Per-session state observable to the rest of the backend. Mirrors a subset
/// of `contracts::SessionState` but stays internal — the contract type adds
/// timestamps and tombstones, which are persistence concerns owned by
/// `session_store/` (B1.6).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalState {
    Running,
    Exited { code: Option<i32> },
}

/// Inputs to `PtySession::spawn`. Plain struct so the call sites are
/// self-documenting and so we don't churn the contract types between
/// the user/Ai/Plugin origins (all four arrive here normalized).
#[derive(Debug, Clone)]
pub struct SpawnConfig {
    pub cwd: PathBuf,
    /// `None` ⇒ launch the shell interactively. `Some(cmd)` ⇒ run via
    /// `sh -c "<cmd>"` so users can pass arbitrary command strings.
    pub cmd: Option<String>,
    pub shell: String,
    pub cols: u16,
    pub rows: u16,
}

impl SpawnConfig {
    /// Reasonable defaults for unit tests and ad-hoc spawns.
    #[must_use]
    pub fn for_shell(cwd: PathBuf, shell: impl Into<String>) -> Self {
        Self {
            cwd,
            cmd: None,
            shell: shell.into(),
            cols: 80,
            rows: 24,
        }
    }
}

/// One alive (or exited-but-buffer-still-intact) PTY session.
///
/// `Send + Sync` because every contained piece is `Send + Sync` under the
/// parking-lot mutexes. Intended to be wrapped in `Arc<PtySession>` by the
/// `PtyManager`.
pub struct PtySession {
    id: SessionId,
    spawn_info: SpawnConfig,
    ring: Arc<RingBuffer>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    writer: Mutex<Box<dyn Write + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
    state_rx: watch::Receiver<LocalState>,
}

impl PtySession {
    /// Spawn a new PTY and child process. The reader and waiter tasks are
    /// started immediately; the returned session is already producing
    /// frames into the ring buffer.
    pub fn spawn(id: SessionId, config: SpawnConfig) -> PtyResult<Self> {
        Self::spawn_with_ring(id, config, Arc::new(RingBuffer::with_default_cap()))
    }

    /// Same as `spawn`, but with an explicitly-constructed ring buffer.
    /// Tests use this to inject a small cap and exercise the drop-old path.
    pub fn spawn_with_ring(
        id: SessionId,
        config: SpawnConfig,
        ring: Arc<RingBuffer>,
    ) -> PtyResult<Self> {
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Open(e.to_string()))?;

        let mut cmd_builder = if let Some(cmd) = &config.cmd {
            // Run the user command via the configured shell so shell-specific
            // syntax (zsh globs, bash arrays) works. All POSIX shells we ship
            // support `-c <string>`.
            let mut b = CommandBuilder::new(&config.shell);
            b.arg("-c");
            b.arg(cmd);
            b
        } else {
            CommandBuilder::new(&config.shell)
        };
        cmd_builder.cwd(&config.cwd);

        let child: Box<dyn Child + Send + Sync> = pair
            .slave
            .spawn_command(cmd_builder)
            .map_err(|e| PtyError::Spawn(id.clone(), e.to_string()))?;

        // Slave fd is owned by the child after spawn; drop our handle so
        // EOF propagates correctly when the child exits.
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::Io(id.clone(), e.to_string()))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::Io(id.clone(), e.to_string()))?;
        let killer = child.clone_killer();

        let (state_tx, state_rx) = watch::channel(LocalState::Running);

        // The blocking reader pushes raw bytes; the async pusher decodes and
        // appends to the ring. The split keeps the blocking-pool thread off
        // any async machinery.
        let (byte_tx, byte_rx) = mpsc::channel::<Vec<u8>>(64);
        spawn_blocking_reader(id.clone(), reader, byte_tx);
        spawn_async_pusher(byte_rx, ring.clone());
        spawn_child_waiter(id.clone(), child, state_tx);

        Ok(Self {
            id,
            spawn_info: config,
            ring,
            master: Mutex::new(pair.master),
            writer: Mutex::new(writer),
            killer: Mutex::new(killer),
            state_rx,
        })
    }

    #[must_use]
    pub fn id(&self) -> &SessionId {
        &self.id
    }

    #[must_use]
    pub fn spawn_info(&self) -> &SpawnConfig {
        &self.spawn_info
    }

    /// Hand the ring buffer back so the batcher (B1.4) can poll it.
    #[must_use]
    pub fn ring(&self) -> Arc<RingBuffer> {
        self.ring.clone()
    }

    /// Current local state. Cheap (no blocking).
    #[must_use]
    pub fn local_state(&self) -> LocalState {
        self.state_rx.borrow().clone()
    }

    /// Resize the PTY. Returns `AlreadyExited` if the child is gone.
    pub fn resize(&self, cols: u16, rows: u16) -> PtyResult<()> {
        if let LocalState::Exited { .. } = self.local_state() {
            return Err(PtyError::AlreadyExited(self.id.clone()));
        }
        self.master
            .lock()
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::Io(self.id.clone(), e.to_string()))
    }

    /// Write bytes to the PTY's stdin (i.e. inject keystrokes / a command).
    /// `inject_command` (B3) ultimately routes here.
    pub fn write_stdin(&self, bytes: &[u8]) -> PtyResult<()> {
        if let LocalState::Exited { .. } = self.local_state() {
            return Err(PtyError::AlreadyExited(self.id.clone()));
        }
        let mut w = self.writer.lock();
        w.write_all(bytes)
            .and_then(|()| w.flush())
            .map_err(|e| PtyError::Io(self.id.clone(), e.to_string()))
    }

    /// Send SIGKILL (or platform equivalent) to the child. Idempotent:
    /// returns `Ok(())` if the child is already gone.
    pub fn kill(&self) -> PtyResult<()> {
        if let LocalState::Exited { .. } = self.local_state() {
            return Ok(());
        }
        self.killer
            .lock()
            .kill()
            .map_err(|e| PtyError::Io(self.id.clone(), e.to_string()))
    }

    /// Await child exit. Returns the exit code (`None` if unavailable on
    /// this platform / signal-killed). Multiple concurrent waiters all see
    /// the same exit.
    pub async fn wait_for_exit(&self) -> Option<i32> {
        let mut rx = self.state_rx.clone();
        let result = rx
            .wait_for(|s| matches!(s, LocalState::Exited { .. }))
            .await;
        match result {
            Ok(guard) => match &*guard {
                LocalState::Exited { code } => *code,
                LocalState::Running => None,
            },
            // Sender dropped (should not happen while session is alive) —
            // treat as "already exited with unknown code".
            Err(_) => None,
        }
    }
}

fn spawn_blocking_reader(
    sid: SessionId,
    mut reader: Box<dyn Read + Send>,
    tx: mpsc::Sender<Vec<u8>>,
) {
    tokio::task::spawn_blocking(move || {
        let mut buf = vec![0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => {
                    tracing::debug!(?sid, "pty reader EOF");
                    break;
                }
                Ok(n) => {
                    if tx.blocking_send(buf[..n].to_vec()).is_err() {
                        // Downstream pusher dropped (session shutting down).
                        break;
                    }
                }
                Err(e) => {
                    tracing::debug!(?sid, error = %e, "pty reader error; closing");
                    break;
                }
            }
        }
    });
}

fn spawn_async_pusher(mut rx: mpsc::Receiver<Vec<u8>>, ring: Arc<RingBuffer>) {
    tokio::spawn(async move {
        while let Some(bytes) = rx.recv().await {
            let text = String::from_utf8_lossy(&bytes).into_owned();
            ring.push(text);
        }
    });
}

fn spawn_child_waiter(
    sid: SessionId,
    mut child: Box<dyn Child + Send + Sync>,
    state_tx: watch::Sender<LocalState>,
) {
    tokio::task::spawn_blocking(move || {
        let code = match child.wait() {
            Ok(status) => i32::try_from(status.exit_code()).ok(),
            Err(e) => {
                tracing::warn!(?sid, error = %e, "child wait failed");
                None
            }
        };
        // Best-effort: if all receivers are gone the session was dropped
        // before exit landed — that's fine, no one cares about the code.
        let _ = state_tx.send(LocalState::Exited { code });
    });
}

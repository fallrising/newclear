//! Top-level PTY manager. Owns the live `PtySession` set and the per-session
//! view subscription (D-5). Outside callers — IPC handlers, integration tests
//! — interact only with this type; the underlying `PtySession`, `RingBuffer`,
//! and batcher tasks are implementation detail.
//!
//! Concurrency: a single `parking_lot::Mutex<HashMap<...>>` serializes
//! lookups and writes. Lock-held operations are all non-blocking — including
//! the initial replay emit, because `BatchSink::emit` is contracted to be
//! fast (sync queue push). Tokio tasks (reader / waiter / batcher / exit
//! watcher) run outside the lock.

use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use parking_lot::Mutex;
use tokio::task::JoinHandle;

use loom_contracts::{Event, Origin, SessionId, StreamId};

use super::batcher::{emit_initial_replay, run_batcher_loop, DEFAULT_BATCH_INTERVAL};
use super::error::{PtyError, PtyResult};
use super::session::{PtySession, SpawnConfig};
use super::sinks::{BatchSink, EventSink};

pub struct PtyManager {
    sessions: Mutex<HashMap<SessionId, SessionEntry>>,
    batch_sink: Arc<dyn BatchSink>,
    event_sink: Arc<dyn EventSink>,
    batch_interval: Duration,
}

struct SessionEntry {
    session: Arc<PtySession>,
    subscription: Option<Subscription>,
    exit_watcher: JoinHandle<()>,
}

struct Subscription {
    stream_id: StreamId,
    join: JoinHandle<()>,
}

impl PtyManager {
    #[must_use]
    pub fn new(batch_sink: Arc<dyn BatchSink>, event_sink: Arc<dyn EventSink>) -> Self {
        Self::with_interval(batch_sink, event_sink, DEFAULT_BATCH_INTERVAL)
    }

    #[must_use]
    pub fn with_interval(
        batch_sink: Arc<dyn BatchSink>,
        event_sink: Arc<dyn EventSink>,
        batch_interval: Duration,
    ) -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            batch_sink,
            event_sink,
            batch_interval,
        }
    }

    /// Spawn a new PTY session. The reader and waiter tasks start
    /// immediately; the session is **not** subscribed until `subscribe`
    /// is called — output piles into the ring buffer in the meantime.
    pub fn spawn(&self, origin: &Origin, config: SpawnConfig) -> PtyResult<SessionId> {
        let sid = fresh_session_id();
        tracing::info!(
            ?origin,
            sid = ?sid,
            cwd = ?config.cwd,
            cmd = ?config.cmd,
            "spawn pty session",
        );
        let session = Arc::new(PtySession::spawn(sid.clone(), config)?);
        let exit_watcher =
            spawn_exit_watcher(sid.clone(), session.clone(), self.event_sink.clone());

        self.sessions.lock().insert(
            sid.clone(),
            SessionEntry {
                session,
                subscription: None,
                exit_watcher,
            },
        );
        Ok(sid)
    }

    pub fn kill(&self, origin: &Origin, sid: &SessionId) -> PtyResult<()> {
        tracing::info!(?origin, sid = ?sid, "kill pty session");
        let session = self
            .get_session(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;
        session.kill()
    }

    pub fn resize(&self, origin: &Origin, sid: &SessionId, cols: u16, rows: u16) -> PtyResult<()> {
        tracing::debug!(?origin, sid = ?sid, cols, rows, "resize pty");
        let session = self
            .get_session(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;
        session.resize(cols, rows)
    }

    pub fn write_stdin(&self, origin: &Origin, sid: &SessionId, bytes: &[u8]) -> PtyResult<()> {
        tracing::debug!(?origin, sid = ?sid, n = bytes.len(), "write stdin");
        let session = self
            .get_session(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;
        session.write_stdin(bytes)
    }

    /// Subscribe a view to this session. Emits the initial replay batch
    /// **synchronously** before returning, so the caller can rely on the
    /// `BatchSink` having at least one batch (if the ring is non-empty)
    /// by the time the returned `StreamId` is in hand.
    ///
    /// Re-subscribing while already subscribed cancels the prior batcher
    /// task and issues a fresh `StreamId`.
    pub fn subscribe(&self, sid: &SessionId) -> PtyResult<StreamId> {
        let mut sessions = self.sessions.lock();
        let entry = sessions
            .get_mut(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;

        if let Some(old) = entry.subscription.take() {
            tracing::debug!(sid = ?sid, "replacing existing subscription");
            old.join.abort();
        }

        let stream_id = fresh_stream_id();
        let ring = entry.session.ring();
        let (start_last_seen, start_dropped) =
            emit_initial_replay(&stream_id, sid, &ring, &*self.batch_sink);

        let join = tokio::spawn(run_batcher_loop(
            stream_id.clone(),
            sid.clone(),
            ring,
            self.batch_sink.clone(),
            self.batch_interval,
            start_last_seen,
            start_dropped,
        ));

        entry.subscription = Some(Subscription {
            stream_id: stream_id.clone(),
            join,
        });
        Ok(stream_id)
    }

    /// Stop emitting batches for this session. The PTY keeps running and the
    /// ring buffer keeps filling; re-`subscribe()` to resume (with a new
    /// `StreamId` and a fresh replay of whatever's in the ring now).
    pub fn detach(&self, sid: &SessionId) -> PtyResult<()> {
        let mut sessions = self.sessions.lock();
        let entry = sessions
            .get_mut(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;
        if let Some(old) = entry.subscription.take() {
            tracing::debug!(sid = ?sid, "detach");
            old.join.abort();
        }
        Ok(())
    }

    /// Forget about this session. Aborts the subscription (if any), the
    /// exit-watcher task, and best-effort kills the underlying child.
    pub fn remove(&self, sid: &SessionId) -> PtyResult<()> {
        let entry = self
            .sessions
            .lock()
            .remove(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;
        if let Some(sub) = entry.subscription {
            sub.join.abort();
        }
        entry.exit_watcher.abort();
        let _ = entry.session.kill();
        Ok(())
    }

    pub fn list_sessions(&self) -> Vec<SessionId> {
        self.sessions.lock().keys().cloned().collect()
    }

    pub fn get_session(&self, sid: &SessionId) -> Option<Arc<PtySession>> {
        self.sessions.lock().get(sid).map(|e| e.session.clone())
    }

    /// Concatenated scrollback for a session. Returns the tail of the
    /// ring buffer's frames, truncated from the head to at most
    /// `max_chars` chars. Used to ship terminal output as AI context.
    pub fn scrollback(&self, sid: &SessionId, max_chars: usize) -> PtyResult<String> {
        let session = self
            .get_session(sid)
            .ok_or_else(|| PtyError::NotFound(sid.clone()))?;
        Ok(scrollback_from_frames(session.ring().snapshot(), max_chars))
    }

    /// Current `StreamId` of the active subscription, if any. Useful in
    /// tests to assert "this manager has emitted under this stream id".
    pub fn current_stream(&self, sid: &SessionId) -> Option<StreamId> {
        self.sessions
            .lock()
            .get(sid)
            .and_then(|e| e.subscription.as_ref().map(|s| s.stream_id.clone()))
    }
}

/// Concat the ring's frames and truncate the head to `max_chars` chars
/// along a UTF-8 boundary. Extracted for unit tests — the network of
/// PtySession + spawn_blocking makes the full path painful to fake.
fn scrollback_from_frames(frames: Vec<super::ring_buffer::Frame>, max_chars: usize) -> String {
    let mut combined = String::with_capacity(frames.iter().map(|f| f.text.len()).sum());
    for f in frames {
        combined.push_str(&f.text);
    }
    if combined.len() > max_chars {
        let cut = combined.len() - max_chars;
        let mut idx = cut;
        while idx < combined.len() && !combined.is_char_boundary(idx) {
            idx += 1;
        }
        combined = combined[idx..].to_string();
    }
    combined
}

fn spawn_exit_watcher(
    sid: SessionId,
    session: Arc<PtySession>,
    event_sink: Arc<dyn EventSink>,
) -> JoinHandle<()> {
    tokio::spawn(async move {
        let code = session.wait_for_exit().await;
        tracing::info!(sid = ?sid, code, "pty exited");
        event_sink.emit(Event::PtyExited {
            session_id: sid,
            exit_code: code,
        });
    })
}

fn fresh_session_id() -> SessionId {
    SessionId(format!("s-{}", uuid::Uuid::now_v7()))
}

fn fresh_stream_id() -> StreamId {
    StreamId(format!("strm-{}", uuid::Uuid::now_v7()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::ring_buffer::Frame;

    fn frame(seq: u64, text: &str) -> Frame {
        Frame {
            seq,
            text: text.into(),
        }
    }

    #[test]
    fn scrollback_concats_frames_in_order() {
        let frames = vec![frame(0, "alpha "), frame(1, "beta "), frame(2, "gamma")];
        assert_eq!(scrollback_from_frames(frames, 999), "alpha beta gamma");
    }

    #[test]
    fn scrollback_truncates_head_to_max_chars() {
        let frames = vec![frame(0, "0123456789"), frame(1, "abcdef")];
        // Total 16; keep last 6.
        assert_eq!(scrollback_from_frames(frames, 6), "abcdef");
    }

    #[test]
    fn scrollback_keeps_utf8_boundary() {
        // "ñ" is 2 bytes (0xC3 0xB1). Asking for 1 char on "aañ" (4 bytes)
        // would land mid-codepoint; we widen forward to the next boundary.
        let frames = vec![frame(0, "aañ")];
        let out = scrollback_from_frames(frames, 1);
        // Result must be valid UTF-8 and strictly shorter than the input.
        assert!(out.len() <= 2);
        assert!(out.chars().count() <= 2);
    }
}

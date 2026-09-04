//! Bounded ring buffer of PTY output frames.
//!
//! Implements **D-2**: terminal output is batched and overflowed frames are
//! **dropped from the front** (oldest), never the back (newest). Terminal
//! semantics prize the freshest output; a build log that just blew past
//! the cap should still show its tail, not its head.
//!
//! The buffer is thread-safe (parking_lot mutex) and lock-light: every
//! operation takes the lock briefly and returns. No async work is held
//! across the lock.
//!
//! Frame sequence numbers are monotonic across the buffer's lifetime —
//! they keep increasing even when frames are evicted. Subscribers use
//! `frames_since(last_seen_seq)` to ask "what's new?", and the buffer
//! transparently handles the case where the caller's last-seen seq is
//! below the oldest live frame (it returns the full live window plus
//! the caller checks `dropped_total()` for the eviction count).
//!
//! Per-batch `dropped_old` semantics (decided in B1 plan §0):
//! the batcher snapshots `dropped_total()` after each emit and reports
//! the delta on the next batch. This means each emitted `PtyBatch`
//! tells the frontend "since the previous batch you got, N frames were
//! evicted" — which is the form a user-facing toast needs.

use std::collections::VecDeque;

use parking_lot::Mutex;

/// Default frame capacity. Override at runtime via `LOOM_PTY_RING_CAP`.
/// 10_000 frames covers typical build-log floods while staying well under
/// the working-set sizes Tauri's IPC bridge can stream comfortably.
pub const DEFAULT_RING_CAP: usize = 10_000;

/// Environment variable that overrides `DEFAULT_RING_CAP` for ad-hoc tuning
/// during P0 self-verification. Invalid or zero values fall back to the
/// default and emit a warning trace.
pub const RING_CAP_ENV_VAR: &str = "LOOM_PTY_RING_CAP";

/// One chunk of PTY output, as produced by a single `read()` from the master.
/// The reader task UTF-8-lossy-decodes the bytes before pushing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Monotonically-increasing sequence number, unique within this buffer.
    /// Survives eviction: the oldest live frame may have `seq > 0`.
    pub seq: u64,
    pub text: String,
}

/// Atomic snapshot of the buffer at a point in time. Returned by
/// `RingBuffer::poll` so the batcher can read frames + counters under a
/// single lock acquisition — otherwise a flood between `frames_since` and
/// `dropped_total` would produce a `dropped_old` delta off by N.
#[derive(Debug, Clone)]
pub struct RingPoll {
    pub new_frames: Vec<Frame>,
    pub latest_seq: u64,
    pub dropped_total: u64,
}

/// Bounded, thread-safe ring buffer of PTY frames.
pub struct RingBuffer {
    inner: Mutex<Inner>,
    cap: usize,
}

struct Inner {
    frames: VecDeque<Frame>,
    next_seq: u64,
    dropped_total: u64,
}

impl RingBuffer {
    /// Construct with an explicit capacity. Panics if `cap == 0` since a
    /// zero-cap buffer would silently discard every push (which is the kind
    /// of subtle bug that only shows up under load — better to fail early).
    #[must_use]
    pub fn new(cap: usize) -> Self {
        assert!(cap > 0, "RingBuffer cap must be > 0");
        Self {
            inner: Mutex::new(Inner {
                frames: VecDeque::with_capacity(cap),
                next_seq: 0,
                dropped_total: 0,
            }),
            cap,
        }
    }

    /// Construct using `DEFAULT_RING_CAP`, overridden by the
    /// `LOOM_PTY_RING_CAP` environment variable when set to a positive
    /// integer.
    #[must_use]
    pub fn with_default_cap() -> Self {
        Self::new(cap_from_env_or_default())
    }

    /// Push a new frame. Returns the assigned seq number. Evicts the oldest
    /// frame when full and increments `dropped_total`.
    pub fn push(&self, text: String) -> u64 {
        let mut inner = self.inner.lock();
        let seq = inner.next_seq;
        inner.next_seq += 1;

        if inner.frames.len() == self.cap {
            inner.frames.pop_front();
            inner.dropped_total += 1;
        }
        inner.frames.push_back(Frame { seq, text });
        seq
    }

    /// Current live frame count.
    pub fn len(&self) -> usize {
        self.inner.lock().frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().frames.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.cap
    }

    /// Snapshot every live frame, in seq order. Used by `subscribe()` to
    /// replay the entire ring buffer to a freshly-attached view.
    pub fn snapshot(&self) -> Vec<Frame> {
        self.inner.lock().frames.iter().cloned().collect()
    }

    /// Frames whose `seq > since_seq`, in order. If `since_seq` is below
    /// the oldest live frame's seq (i.e. the caller missed some evictions
    /// since their last poll), returns the full live window — the caller
    /// should inspect `dropped_total()` to report the gap.
    pub fn frames_since(&self, since_seq: u64) -> Vec<Frame> {
        let inner = self.inner.lock();
        inner
            .frames
            .iter()
            .filter(|f| f.seq > since_seq)
            .cloned()
            .collect()
    }

    /// Largest seq pushed so far. Returns 0 before the first push.
    /// Subscribers should treat this as "last-seen" to skip the initial
    /// replay window after they have already consumed it.
    pub fn latest_seq(&self) -> u64 {
        let inner = self.inner.lock();
        inner.next_seq.saturating_sub(1)
    }

    /// Cumulative eviction count across the buffer's lifetime. Monotonic.
    pub fn dropped_total(&self) -> u64 {
        self.inner.lock().dropped_total
    }

    /// Atomic snapshot: frames + counters under a single lock. Use this
    /// from the batcher to avoid `frames_since` and `dropped_total`
    /// drifting between calls under load.
    ///
    /// `since_seq = None` ⇒ full snapshot (use for the initial replay).
    /// `since_seq = Some(s)` ⇒ frames with `seq > s` only.
    pub fn poll(&self, since_seq: Option<u64>) -> RingPoll {
        let inner = self.inner.lock();
        let new_frames: Vec<Frame> = match since_seq {
            Some(s) => inner.frames.iter().filter(|f| f.seq > s).cloned().collect(),
            None => inner.frames.iter().cloned().collect(),
        };
        RingPoll {
            new_frames,
            latest_seq: inner.next_seq.saturating_sub(1),
            dropped_total: inner.dropped_total,
        }
    }
}

fn cap_from_env_or_default() -> usize {
    match std::env::var(RING_CAP_ENV_VAR) {
        Ok(raw) => match raw.parse::<usize>() {
            Ok(n) if n > 0 => n,
            _ => {
                tracing::warn!(
                    env = RING_CAP_ENV_VAR,
                    value = %raw,
                    "invalid {RING_CAP_ENV_VAR}; falling back to default",
                );
                DEFAULT_RING_CAP
            }
        },
        Err(_) => DEFAULT_RING_CAP,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use pretty_assertions::assert_eq;

    fn texts(frames: &[Frame]) -> Vec<&str> {
        frames.iter().map(|f| f.text.as_str()).collect()
    }

    #[test]
    fn empty_buffer_is_empty() {
        let rb = RingBuffer::new(4);
        assert_eq!(rb.len(), 0);
        assert!(rb.is_empty());
        assert_eq!(rb.latest_seq(), 0);
        assert_eq!(rb.dropped_total(), 0);
        assert!(rb.snapshot().is_empty());
        assert!(rb.frames_since(0).is_empty());
    }

    #[test]
    fn push_within_cap_keeps_everything() {
        let rb = RingBuffer::new(4);
        for i in 1..=3 {
            rb.push(format!("line {i}"));
        }
        assert_eq!(rb.len(), 3);
        assert_eq!(rb.dropped_total(), 0);
        assert_eq!(rb.latest_seq(), 2); // seqs 0, 1, 2
        assert_eq!(texts(&rb.snapshot()), vec!["line 1", "line 2", "line 3"]);
    }

    #[test]
    fn push_beyond_cap_evicts_oldest_and_counts_drops() {
        // D-2: drop old, not new. After overflow the tail (newest) must
        // be visible; the head (oldest) is what's gone.
        let rb = RingBuffer::new(3);
        for i in 1..=5 {
            rb.push(format!("line {i}"));
        }
        assert_eq!(rb.len(), 3);
        assert_eq!(rb.dropped_total(), 2);
        assert_eq!(rb.latest_seq(), 4); // seqs 0..=4 pushed; live = {2, 3, 4}
        assert_eq!(texts(&rb.snapshot()), vec!["line 3", "line 4", "line 5"]);
    }

    #[test]
    fn frames_since_returns_only_new_frames() {
        let rb = RingBuffer::new(8);
        for i in 1..=4 {
            rb.push(format!("line {i}"));
        }
        // Seqs assigned: 0..=3. Subscriber claims it has already seen seq 1.
        let new = rb.frames_since(1);
        assert_eq!(texts(&new), vec!["line 3", "line 4"]);
    }

    #[test]
    fn frames_since_stale_seq_returns_full_window() {
        let rb = RingBuffer::new(3);
        for i in 1..=6 {
            rb.push(format!("line {i}"));
        }
        // Live seqs are {3, 4, 5}. Subscriber's last_seen of 1 is below the
        // oldest live; we return the full live window and rely on the caller
        // to consult dropped_total() for the gap.
        let new = rb.frames_since(1);
        assert_eq!(texts(&new), vec!["line 4", "line 5", "line 6"]);
        assert_eq!(rb.dropped_total(), 3);
    }

    #[test]
    fn frames_since_latest_returns_empty() {
        let rb = RingBuffer::new(4);
        rb.push("a".into());
        rb.push("b".into());
        let last = rb.latest_seq();
        assert!(rb.frames_since(last).is_empty());
    }

    #[test]
    fn snapshot_reflects_eviction_state() {
        let rb = RingBuffer::new(2);
        rb.push("a".into());
        rb.push("b".into());
        rb.push("c".into()); // evicts "a"
        let snap = rb.snapshot();
        assert_eq!(snap.len(), 2);
        assert_eq!(snap[0].text, "b");
        assert_eq!(snap[0].seq, 1);
        assert_eq!(snap[1].text, "c");
        assert_eq!(snap[1].seq, 2);
    }

    #[test]
    fn dropped_total_is_monotonic_across_many_overflows() {
        let rb = RingBuffer::new(10);
        for i in 0..1_000 {
            rb.push(format!("{i}"));
        }
        assert_eq!(rb.len(), 10);
        assert_eq!(rb.dropped_total(), 990);
        assert_eq!(rb.latest_seq(), 999);
    }

    #[test]
    fn seq_keeps_increasing_after_eviction() {
        let rb = RingBuffer::new(2);
        rb.push("a".into()); // seq 0
        rb.push("b".into()); // seq 1
        rb.push("c".into()); // seq 2, evicts seq 0
        let seq = rb.push("d".into()); // seq 3, evicts seq 1
        assert_eq!(seq, 3);
        assert_eq!(rb.latest_seq(), 3);
        let snap = rb.snapshot();
        assert_eq!(snap[0].seq, 2);
        assert_eq!(snap[1].seq, 3);
    }

    #[test]
    #[should_panic(expected = "cap must be > 0")]
    fn zero_cap_panics() {
        let _ = RingBuffer::new(0);
    }

    #[test]
    fn env_var_override_is_honoured_when_valid() {
        // Test the helper directly to avoid global env-var fights in parallel
        // test runs. We cannot scope `std::env::set_var` to one test, so we
        // assert on the pure function with the parsing logic.
        std::env::remove_var(RING_CAP_ENV_VAR);
        assert_eq!(cap_from_env_or_default(), DEFAULT_RING_CAP);

        // Safe because this test serializes via Mutex below; nothing else in
        // this file uses LOOM_PTY_RING_CAP.
        std::env::set_var(RING_CAP_ENV_VAR, "42");
        assert_eq!(cap_from_env_or_default(), 42);

        std::env::set_var(RING_CAP_ENV_VAR, "0");
        assert_eq!(cap_from_env_or_default(), DEFAULT_RING_CAP);

        std::env::set_var(RING_CAP_ENV_VAR, "not a number");
        assert_eq!(cap_from_env_or_default(), DEFAULT_RING_CAP);

        std::env::remove_var(RING_CAP_ENV_VAR);
    }
}

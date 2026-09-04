//! Frame batcher. One task per active subscription, ticking at a configurable
//! cadence (default ~20ms — comfortably inside D-2's 16–33 ms frame budget).
//!
//! Per-batch `dropped_old` semantics (B1 plan §0): each emitted batch
//! reports frames evicted from the ring buffer **since the previous batch
//! on this stream**. The initial replay batch is always `dropped_old = 0` —
//! a fresh stream has no "previous batch" to delta against.
//!
//! Cancellation: the manager holds the `JoinHandle` and calls `abort()`
//! on detach. The batcher has no async-Drop-critical state so abort-mid-tick
//! is safe (sink emits are sync mutex pushes).

use std::sync::Arc;
use std::time::Duration;

use tokio::time::MissedTickBehavior;

use loom_contracts::{PtyBatch, SessionId, StreamId};

use super::ring_buffer::RingBuffer;
use super::sinks::BatchSink;

/// Default ticking interval. Frontends running at 60 Hz see one batch
/// per render frame; build-log floods get pre-aggregated rather than each
/// line crossing the IPC boundary.
pub const DEFAULT_BATCH_INTERVAL: Duration = Duration::from_millis(20);

/// Emit one immediate replay batch (full ring contents at this instant),
/// then return the seq + dropped counters for the tick loop to start from.
///
/// Returns `last_seen = None` if the ring was empty at subscribe time —
/// the tick loop will then pick up `seq = 0` (the very first frame) on its
/// next poll instead of silently filtering it out. The previous shape
/// `last_seen = 0` lost the first frame whenever `subscribe` raced ahead
/// of the reader, which is the common case (spawn followed by an
/// immediate subscribe before the child has had time to write).
pub(crate) fn emit_initial_replay(
    stream_id: &StreamId,
    session_id: &SessionId,
    ring: &RingBuffer,
    sink: &dyn BatchSink,
) -> (Option<u64>, u64) {
    let poll = ring.poll(None);
    let last_seen = if poll.new_frames.is_empty() {
        None
    } else {
        Some(poll.latest_seq)
    };
    if !poll.new_frames.is_empty() {
        sink.emit(PtyBatch {
            stream_id: stream_id.clone(),
            session_id: session_id.clone(),
            frames: poll.new_frames.into_iter().map(|f| f.text).collect(),
            // First batch on this stream: no previous batch to delta against.
            dropped_old: 0,
        });
    }
    (last_seen, poll.dropped_total)
}

/// Tick loop body. Runs until aborted by the manager. `start_last_seen`
/// and `start_dropped` should come from `emit_initial_replay`.
pub(crate) async fn run_batcher_loop(
    stream_id: StreamId,
    session_id: SessionId,
    ring: Arc<RingBuffer>,
    sink: Arc<dyn BatchSink>,
    interval: Duration,
    mut last_seen: Option<u64>,
    mut last_observed_dropped: u64,
) {
    let mut ticker = tokio::time::interval(interval);
    // If the runtime stalls (debugger, heavy GC), skip missed ticks instead
    // of bursting — terminals don't replay history, only freshness matters.
    ticker.set_missed_tick_behavior(MissedTickBehavior::Skip);
    // Consume the immediate first tick that tokio's interval emits.
    ticker.tick().await;

    loop {
        ticker.tick().await;
        let poll = ring.poll(last_seen);
        let delta_dropped = poll.dropped_total.saturating_sub(last_observed_dropped);
        if poll.new_frames.is_empty() && delta_dropped == 0 {
            continue;
        }
        let dropped_old = u32::try_from(delta_dropped).unwrap_or(u32::MAX);
        let had_frames = !poll.new_frames.is_empty();
        let batch = PtyBatch {
            stream_id: stream_id.clone(),
            session_id: session_id.clone(),
            frames: poll.new_frames.into_iter().map(|f| f.text).collect(),
            dropped_old,
        };
        sink.emit(batch);
        if had_frames {
            last_seen = Some(poll.latest_seq);
        }
        last_observed_dropped = poll.dropped_total;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pty::sinks::VecBatchSink;
    use pretty_assertions::assert_eq;

    fn ids() -> (StreamId, SessionId) {
        (StreamId("strm-1".into()), SessionId("s-1".into()))
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn initial_replay_dropped_old_is_zero_even_after_eviction() {
        let ring = RingBuffer::new(2);
        ring.push("a".into());
        ring.push("b".into());
        ring.push("c".into()); // evicts "a"; dropped_total = 1
        assert_eq!(ring.dropped_total(), 1);

        let sink = VecBatchSink::shared();
        let (sid, session_id) = ids();
        let (last_seen, dropped) = emit_initial_replay(&sid, &session_id, &ring, sink.as_ref());

        let batches = sink.snapshot();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].frames, vec!["b".to_string(), "c".to_string()]);
        // First batch: no "previous batch" delta exists.
        assert_eq!(batches[0].dropped_old, 0);
        assert_eq!(last_seen, Some(2));
        assert_eq!(dropped, 1);
    }

    #[tokio::test(flavor = "current_thread", start_paused = true)]
    async fn empty_ring_yields_no_initial_batch() {
        let ring = RingBuffer::new(4);
        let sink = VecBatchSink::shared();
        let (sid, session_id) = ids();
        let (last_seen, dropped) = emit_initial_replay(&sid, &session_id, &ring, sink.as_ref());
        assert!(sink.is_empty());
        // None ⇒ tick loop will pick up seq=0 on its first poll.
        assert_eq!(last_seen, None);
        assert_eq!(dropped, 0);
    }

    // Regression: subscribe-before-first-push must not lose seq=0.
    // Previously the tick loop started from `last_seen_seq = 0` and filtered
    // `seq > 0`, dropping the very first frame whenever a fast spawn+subscribe
    // beat the reader to the ring.
    #[tokio::test(flavor = "current_thread")]
    async fn subscribe_before_first_push_still_delivers_seq_zero() {
        let ring = Arc::new(RingBuffer::new(8));
        let sink = VecBatchSink::shared();
        let (sid, session_id) = ids();

        // Empty ring at subscribe time.
        let (last_seen, start_dropped) =
            emit_initial_replay(&sid, &session_id, &ring, sink.as_ref());
        assert_eq!(last_seen, None);
        assert!(sink.is_empty());

        let interval = Duration::from_millis(5);
        let task = tokio::spawn(run_batcher_loop(
            sid.clone(),
            session_id.clone(),
            ring.clone(),
            sink.clone(),
            interval,
            last_seen,
            start_dropped,
        ));

        // Push *after* subscribe — these are seqs 0 and 1.
        tokio::time::sleep(Duration::from_millis(2)).await;
        ring.push("first".into());
        ring.push("second".into());
        tokio::time::sleep(Duration::from_millis(30)).await;

        task.abort();
        let _ = task.await;

        let combined: Vec<String> = sink
            .snapshot()
            .iter()
            .flat_map(|b| b.frames.iter().cloned())
            .collect();
        assert_eq!(
            combined,
            vec!["first".to_string(), "second".to_string()],
            "seq=0 must not be lost when subscribe wins the race against the reader",
        );
    }

    // Uses real time rather than paused-virtual to avoid the trap where
    // `tokio::time::interval`'s base is captured at the batcher's first
    // poll — which lands AFTER any `advance` the test issued, making the
    // tick clock effectively start from the advanced point.
    #[tokio::test(flavor = "current_thread")]
    async fn tick_loop_emits_per_batch_delta_drops() {
        let ring = Arc::new(RingBuffer::new(3));
        let sink = VecBatchSink::shared();
        let (sid, session_id) = ids();

        // Seed pre-subscribe so the loop starts from a known position.
        ring.push("a".into());
        let (start_last_seen, start_dropped) =
            emit_initial_replay(&sid, &session_id, &ring, sink.as_ref());
        sink.take(); // discard replay; we're testing the delta loop now.

        let interval = Duration::from_millis(5);
        let task = tokio::spawn(run_batcher_loop(
            sid.clone(),
            session_id.clone(),
            ring.clone(),
            sink.clone(),
            interval,
            start_last_seen,
            start_dropped,
        ));

        // Give the batcher a moment to initialize and reach its first
        // waiting tick.await.
        tokio::time::sleep(Duration::from_millis(2)).await;

        // Push enough to evict — cap=3, already had "a"; push b,c,d,e ⇒
        // live = c,d,e; dropped_total = 2 (a and b both evicted).
        ring.push("b".into());
        ring.push("c".into());
        ring.push("d".into());
        ring.push("e".into());

        // Allow several tick periods to elapse.
        tokio::time::sleep(Duration::from_millis(30)).await;

        task.abort();
        let _ = task.await; // swallow the abort error

        let batches = sink.snapshot();
        assert!(
            !batches.is_empty(),
            "expected at least one tick batch after pushes",
        );
        // Combined frames across batches should equal what survived eviction
        // (c, d, e).
        let combined: Vec<String> = batches
            .iter()
            .flat_map(|b| b.frames.iter().cloned())
            .collect();
        assert_eq!(
            combined,
            vec!["c".to_string(), "d".to_string(), "e".to_string()]
        );
        // Per-batch deltas summed equal the eviction delta we caused (2).
        let total_dropped: u64 = batches.iter().map(|b| u64::from(b.dropped_old)).sum();
        assert_eq!(total_dropped, 2);
    }
}

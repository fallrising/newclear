//! B1.4 + B1.5 integration: PtyManager subscribe / detach / re-subscribe
//! against real PTYs and real sinks. Verifies the wiring promised by the
//! plan: initial replay is synchronous, batcher emits while PTY runs,
//! detach stops emissions, re-subscribe replays current ring + new stream.

use std::time::Duration;

use loom_contracts::{Event, Origin};
use loom_core::pty::{PtyManager, SpawnConfig, VecBatchSink, VecEventSink, DEFAULT_BATCH_INTERVAL};

fn shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
}

fn manager_and_sinks() -> (
    PtyManager,
    std::sync::Arc<VecBatchSink>,
    std::sync::Arc<VecEventSink>,
) {
    let batch = VecBatchSink::shared();
    let events = VecEventSink::shared();
    let mgr = PtyManager::with_interval(batch.clone(), events.clone(), Duration::from_millis(10));
    (mgr, batch, events)
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_then_subscribe_emits_replay_with_dropped_old_zero() {
    let (mgr, batches, _events) = manager_and_sinks();
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        cmd: Some("printf 'hello-world\\n'".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };
    let sid = mgr.spawn(&Origin::User, config).expect("spawn");

    // Let the child print and the reader drain.
    tokio::time::sleep(Duration::from_millis(150)).await;

    // First subscribe — replay batch should land synchronously.
    let stream_id = mgr.subscribe(&sid).expect("subscribe");
    assert_eq!(mgr.current_stream(&sid).as_ref(), Some(&stream_id));

    let snap = batches.snapshot();
    assert!(!snap.is_empty(), "expected at least the replay batch");
    let first = &snap[0];
    assert_eq!(first.stream_id, stream_id);
    assert_eq!(first.session_id, sid);
    assert_eq!(first.dropped_old, 0, "initial replay must zero dropped_old");
    let combined: String = first.frames.iter().cloned().collect();
    assert!(
        combined.contains("hello-world"),
        "replay missing PTY output, got {combined:?}",
    );

    mgr.detach(&sid).expect("detach");
    let _ = mgr.kill(&Origin::User, &sid);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn detach_stops_emissions_resubscribe_starts_a_fresh_stream() {
    let (mgr, batches, _events) = manager_and_sinks();
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        // Slow trickle so we can detach mid-stream.
        cmd: Some("for i in 1 2 3 4 5; do printf 'line %d\\n' $i; sleep 0.05; done".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };
    let sid = mgr.spawn(&Origin::User, config).expect("spawn");
    tokio::time::sleep(Duration::from_millis(30)).await;

    let stream_a = mgr.subscribe(&sid).expect("subscribe A");
    tokio::time::sleep(Duration::from_millis(120)).await;
    let count_before_detach = batches.len();
    assert!(
        count_before_detach >= 1,
        "expected at least one batch under stream A"
    );

    mgr.detach(&sid).expect("detach");
    let count_after_detach = batches.len();

    // Give the script time to produce more output while we're detached.
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert_eq!(
        batches.len(),
        count_after_detach,
        "no new batches should be emitted while detached",
    );

    // Resubscribe: fresh stream id, and replay should include the lines
    // produced during detach (still in the ring).
    let stream_b = mgr.subscribe(&sid).expect("subscribe B");
    assert_ne!(stream_a, stream_b, "re-subscribe must mint a new stream");

    let snap = batches.snapshot();
    let stream_b_batches: Vec<_> = snap.iter().filter(|b| b.stream_id == stream_b).collect();
    assert!(!stream_b_batches.is_empty(), "B should have a replay batch");
    let combined_b: String = stream_b_batches
        .iter()
        .flat_map(|b| b.frames.iter().cloned())
        .collect();
    assert!(
        combined_b.contains("line 5") || combined_b.contains("line 4"),
        "B's replay should include lines produced during detach, got {combined_b:?}",
    );
    assert_eq!(stream_b_batches[0].dropped_old, 0);

    mgr.detach(&sid).expect("detach again");
    let _ = mgr.kill(&Origin::User, &sid);
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn pty_exited_event_emitted_when_child_exits() {
    let (mgr, _batches, events) = manager_and_sinks();
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        cmd: Some("true".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };
    let sid = mgr.spawn(&Origin::User, config).expect("spawn");

    // Poll the event sink for up to ~2s for the PtyExited event.
    let deadline = std::time::Instant::now() + Duration::from_secs(2);
    loop {
        if events
            .snapshot()
            .iter()
            .any(|e| matches!(e, Event::PtyExited { session_id, .. } if session_id == &sid))
        {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "never observed PtyExited for {sid:?}; events: {:?}",
            events.snapshot(),
        );
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn flood_pushes_through_batcher_with_dropped_old_under_pressure() {
    // Hit a small ring cap so we exercise the drop-old reporting.
    std::env::set_var(loom_core::pty::RING_CAP_ENV_VAR, "32");
    let (mgr, batches, _events) = manager_and_sinks();

    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        // 1000 lines fast — well above the ring cap of 32.
        cmd: Some("i=1; while [ $i -le 1000 ]; do printf 'line %d\\n' $i; i=$((i+1)); done".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };
    let sid = mgr.spawn(&Origin::User, config).expect("spawn");
    let _stream = mgr.subscribe(&sid).expect("subscribe");

    // Wait for the script to finish and the batcher to flush.
    tokio::time::sleep(Duration::from_millis(600)).await;

    let snap = batches.snapshot();
    assert!(!snap.is_empty(), "expected batches under flood");
    let combined: String = snap.iter().flat_map(|b| b.frames.iter().cloned()).collect();
    // Tail must be visible (drop-old, not drop-new — D-2 requirement).
    assert!(
        combined.contains("line 1000"),
        "tail (line 1000) must survive the flood"
    );

    let total_dropped: u64 = snap.iter().map(|b| u64::from(b.dropped_old)).sum();
    assert!(total_dropped > 0, "drop reporting should fire under flood");

    mgr.detach(&sid).expect("detach");
    let _ = mgr.kill(&Origin::User, &sid);
    std::env::remove_var(loom_core::pty::RING_CAP_ENV_VAR);

    let _ = DEFAULT_BATCH_INTERVAL; // touch the re-export so it stays public
}

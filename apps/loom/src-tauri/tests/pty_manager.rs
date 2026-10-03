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
    let (mgr, batches, _events) = manager_and_sinks();
    let mut config = SpawnConfig::for_shell(std::env::temp_dir(), shell());
    config.cmd = Some("exec cat".into());
    let sid = mgr.spawn(&Origin::User, config).expect("spawn");
    let ring = mgr.get_session(&sid).unwrap().ring();
    let _stream = mgr.subscribe(&sid).expect("subscribe");

    // Ring capacity counts reader frames, not output lines. A native read may
    // coalesce 1000 lines into fewer than 32 frames, so line count cannot force
    // pressure. Inject known frames into this real session's ring instead of
    // changing process-global environment or assuming OS read boundaries.
    let frame_count = ring.capacity() + 32;
    for index in 0..frame_count {
        ring.push(format!("line {index}\n"));
    }
    assert_eq!(ring.dropped_total(), 32, "pressure was actually induced");
    let tail = format!("line {}\n", frame_count - 1);
    tokio::time::timeout(Duration::from_secs(3), async {
        loop {
            let snap = batches.snapshot();
            let total_dropped: u64 = snap.iter().map(|b| u64::from(b.dropped_old)).sum();
            let contains_tail = snap
                .iter()
                .flat_map(|b| &b.frames)
                .any(|frame| frame.contains(&tail));
            if total_dropped == 32 && contains_tail {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("batcher must report exact evictions and preserve the newest frame");
    mgr.detach(&sid).expect("detach");
    mgr.remove(&sid).expect("remove");
    let _ = DEFAULT_BATCH_INTERVAL; // touch the re-export so it stays public
}

/// Hold an emit *inside* the sink while another thread detaches. Aborting the
/// async task alone cannot stop synchronous work already executing on a worker.
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn detach_waits_for_an_in_flight_emission_before_returning() {
    use loom_contracts::PtyBatch;
    use loom_core::pty::BatchSink;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    };

    struct HeldSink {
        entered: mpsc::Sender<()>,
        release: Mutex<mpsc::Receiver<()>>,
        completed: AtomicBool,
    }
    impl BatchSink for HeldSink {
        fn emit(&self, _batch: PtyBatch) {
            self.entered.send(()).unwrap();
            self.release
                .lock()
                .unwrap()
                .recv_timeout(Duration::from_secs(3))
                .unwrap();
            self.completed.store(true, Ordering::SeqCst);
        }
    }
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let sink = Arc::new(HeldSink {
        entered: entered_tx,
        release: Mutex::new(release_rx),
        completed: AtomicBool::new(false),
    });
    let manager = Arc::new(PtyManager::with_interval(
        sink.clone(),
        VecEventSink::shared(),
        Duration::from_millis(1),
    ));
    let mut config = SpawnConfig::for_shell(std::env::temp_dir(), shell());
    config.cmd = Some("exec cat".into());
    let sid = manager.spawn(&Origin::User, config).unwrap();
    manager.subscribe(&sid).unwrap();
    manager
        .get_session(&sid)
        .unwrap()
        .ring()
        .push("controlled frame".into());
    entered_rx
        .recv_timeout(Duration::from_secs(3))
        .expect("batch is executing inside sink");
    let (started_tx, started_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let detaching = manager.clone();
    let detached_id = sid.clone();
    let observed = sink.clone();
    let thread = std::thread::spawn(move || {
        started_tx.send(()).unwrap();
        detaching.detach(&detached_id).unwrap();
        done_tx
            .send(observed.completed.load(Ordering::SeqCst))
            .unwrap();
    });
    started_rx.recv_timeout(Duration::from_secs(3)).unwrap();
    // This timeout deliberately tests that detach stays blocked on the held
    // emit; it is not a sleep to let an asynchronous abort eventually settle.
    let premature = done_rx.recv_timeout(Duration::from_millis(100)).ok();
    release_tx.send(()).unwrap();
    let completed_before_detach =
        premature.unwrap_or_else(|| done_rx.recv_timeout(Duration::from_secs(3)).unwrap());
    thread.join().unwrap();
    manager.remove(&sid).unwrap();
    assert!(
        completed_before_detach,
        "detach returned while its sink emit was still in flight"
    );
}

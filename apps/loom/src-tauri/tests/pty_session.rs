//! B1.3 integration: real PTY spawn → output ends up in the ring buffer,
//! exit is detected, kill works on a long-running process.

use std::time::Duration;

use loom_contracts::SessionId;
use loom_core::pty::{LocalState, PtySession, SpawnConfig};

fn shell() -> String {
    std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn spawn_runs_and_captures_echo_output() {
    let sid = SessionId("test-echo".into());
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        cmd: Some("echo hello-from-pty".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };

    let session = PtySession::spawn(sid, config).expect("spawn ok");

    let exit_code = tokio::time::timeout(Duration::from_secs(5), session.wait_for_exit())
        .await
        .expect("echo exits within 5s");

    assert_eq!(exit_code, Some(0));

    // Wait for the async pusher to drain anything left in the mpsc.
    tokio::time::sleep(Duration::from_millis(200)).await;

    let combined: String = session
        .ring()
        .snapshot()
        .into_iter()
        .map(|f| f.text)
        .collect();
    assert!(
        combined.contains("hello-from-pty"),
        "expected captured output to include 'hello-from-pty', got {combined:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn kill_terminates_long_running_session() {
    let sid = SessionId("test-kill".into());
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        cmd: Some("sleep 30".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };

    let session = PtySession::spawn(sid, config).expect("spawn ok");
    // Give the child a moment to actually exec.
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert!(matches!(session.local_state(), LocalState::Running));

    session.kill().expect("kill ok");

    tokio::time::timeout(Duration::from_secs(3), session.wait_for_exit())
        .await
        .expect("session exits promptly after kill");

    assert!(matches!(session.local_state(), LocalState::Exited { .. }));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn write_stdin_round_trip_via_cat() {
    // `cat` echoes stdin to stdout. Inject a line, expect to see it back.
    let sid = SessionId("test-cat".into());
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        cmd: Some("cat".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };
    let session = PtySession::spawn(sid, config).expect("spawn ok");
    tokio::time::sleep(Duration::from_millis(100)).await;

    session
        .write_stdin(b"round-trip-line\n")
        .expect("write stdin");
    tokio::time::sleep(Duration::from_millis(200)).await;

    session.kill().expect("kill cat");
    tokio::time::timeout(Duration::from_secs(2), session.wait_for_exit())
        .await
        .expect("exits after kill");

    let combined: String = session
        .ring()
        .snapshot()
        .into_iter()
        .map(|f| f.text)
        .collect();
    assert!(
        combined.contains("round-trip-line"),
        "expected echoed stdin in ring, got {combined:?}",
    );
}

#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn already_exited_session_rejects_resize_and_stdin() {
    let sid = SessionId("test-post-exit".into());
    let config = SpawnConfig {
        cwd: std::env::temp_dir(),
        cmd: Some("true".into()),
        shell: shell(),
        cols: 80,
        rows: 24,
    };
    let session = PtySession::spawn(sid, config).expect("spawn ok");

    tokio::time::timeout(Duration::from_secs(2), session.wait_for_exit())
        .await
        .expect("`true` exits");
    tokio::time::sleep(Duration::from_millis(50)).await;

    let resize_err = session
        .resize(100, 30)
        .expect_err("post-exit resize errors");
    assert!(
        format!("{resize_err}").contains("already exited"),
        "wrong error: {resize_err}",
    );

    let stdin_err = session
        .write_stdin(b"too late\n")
        .expect_err("post-exit stdin errors");
    assert!(format!("{stdin_err}").contains("already exited"));

    // kill on a dead session is idempotent.
    session.kill().expect("kill on dead session is ok");
}

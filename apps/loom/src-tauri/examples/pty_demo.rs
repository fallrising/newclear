//! Run a shell command through B1's full path: PTY spawn → reader task →
//! ring buffer → batcher → BatchSink. Each emitted batch is printed to
//! stdout so you can see the batching/eviction/replay behaviour live.
//!
//! Usage:
//!   cargo run --example pty_demo
//!     # default: trickle 5 lines with sleeps
//!
//!   cargo run --example pty_demo -- 'ls -la'
//!   cargo run --example pty_demo -- 'cargo --version'
//!
//!   # Watch drop-old in action:
//!   LOOM_PTY_RING_CAP=8 cargo run --example pty_demo -- 'seq 1 500'
//!
//!   # See the batcher coalesce a flood:
//!   cargo run --example pty_demo -- 'for i in $(seq 1 200); do echo line $i; done'
//!
//! Ctrl-C aborts the child and waits for the exit event before unwinding.

use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;
use tokio::sync::mpsc;

use loom_contracts::{Event, Origin, PtyBatch};
use loom_core::pty::{BatchSink, EventSink, PtyManager, SpawnConfig};

struct PrintingBatchSink {
    start: Instant,
}

impl BatchSink for PrintingBatchSink {
    fn emit(&self, batch: PtyBatch) {
        let dt_ms = self.start.elapsed().as_secs_f64() * 1000.0;
        println!(
            "[+{:>7.1}ms] batch stream={} session={}  frames={}  dropped_old={}",
            dt_ms,
            batch.stream_id.0,
            batch.session_id.0,
            batch.frames.len(),
            batch.dropped_old,
        );
        for (i, frame) in batch.frames.iter().enumerate() {
            // Render the bytes so ANSI / CR / LF show as escapes rather
            // than driving your terminal.
            print!("    [{i:>2}] ");
            for ch in frame.chars() {
                match ch {
                    '\n' => print!("\\n"),
                    '\r' => print!("\\r"),
                    '\t' => print!("\\t"),
                    c if c.is_control() => print!("\\x{:02x}", c as u32),
                    c => print!("{c}"),
                }
            }
            println!();
        }
    }
}

struct ExitSignal {
    tx: Mutex<Option<mpsc::UnboundedSender<Option<i32>>>>,
}

impl EventSink for ExitSignal {
    fn emit(&self, event: Event) {
        let Event::PtyExited { exit_code, .. } = event else {
            return;
        };
        if let Some(tx) = self.tx.lock().take() {
            let _ = tx.send(exit_code);
        }
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let cmd = if argv.is_empty() {
        "for i in 1 2 3 4 5; do echo line $i; sleep 0.3; done".to_string()
    } else {
        argv.join(" ")
    };
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());

    println!("== Loom B1 pty_demo ==");
    println!("  shell : {shell}");
    println!("  cmd   : {cmd}");
    println!(
        "  ring  : LOOM_PTY_RING_CAP = {}",
        std::env::var("LOOM_PTY_RING_CAP").unwrap_or_else(|_| "(default 10000)".into())
    );
    println!();

    let start = Instant::now();
    let batch_sink: Arc<dyn BatchSink> = Arc::new(PrintingBatchSink { start });

    let (exit_tx, mut exit_rx) = mpsc::unbounded_channel();
    let event_sink: Arc<dyn EventSink> = Arc::new(ExitSignal {
        tx: Mutex::new(Some(exit_tx)),
    });

    let mgr = PtyManager::new(batch_sink, event_sink);

    let sid = mgr.spawn(
        &Origin::User,
        SpawnConfig {
            cwd: std::env::current_dir()?,
            cmd: Some(cmd),
            shell,
            cols: 120,
            rows: 30,
        },
    )?;
    println!(
        "[+{:>7.1}ms] spawned session_id = {}",
        start.elapsed().as_secs_f64() * 1000.0,
        sid.0
    );

    let stream = mgr.subscribe(&sid)?;
    println!(
        "[+{:>7.1}ms] subscribed stream_id = {}",
        start.elapsed().as_secs_f64() * 1000.0,
        stream.0
    );
    println!();

    // Race PTY exit against Ctrl-C.
    let exit_code = tokio::select! {
        code = exit_rx.recv() => code.flatten(),
        _ = tokio::signal::ctrl_c() => {
            println!();
            println!("[ctrl-c] killing pty");
            let _ = mgr.kill(&Origin::User, &sid);
            exit_rx.recv().await.flatten()
        }
    };

    // Let any final batch land.
    tokio::time::sleep(std::time::Duration::from_millis(80)).await;

    println!();
    println!(
        "[+{:>7.1}ms] PtyExited code = {:?}",
        start.elapsed().as_secs_f64() * 1000.0,
        exit_code,
    );
    Ok(())
}

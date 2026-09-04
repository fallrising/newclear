//! Watch a directory and print every FsChanged event the watcher emits,
//! plus the result of `check_conflict` whenever a watched document has
//! an editor state attached. Demonstrates B2's full pipeline: notify v8
//! → debounce → echo-loop guard → EventSink.
//!
//! Usage:
//!
//!   # Default: watch a temp vault and write through DocumentService
//!   cargo run --example fs_demo
//!
//!   # Watch a specific directory (no self-writes from the demo)
//!   cargo run --example fs_demo -- /path/to/some/vault
//!
//! Try in another shell while the demo is running:
//!
//!   echo "external edit" >> /path/to/vault/note.md
//!   mv /path/to/vault/note.md /path/to/vault/renamed.md
//!
//! Ctrl-C to stop.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Instant;

use parking_lot::Mutex;

use loom_contracts::{Event, FsChangeKind, Origin};
use loom_core::fs::{DocumentService, EchoGuard, FsWatcher};
use loom_core::pty::EventSink;

struct PrintingEventSink {
    start: Instant,
    seen: Mutex<u64>,
}

impl EventSink for PrintingEventSink {
    fn emit(&self, event: Event) {
        let mut n = self.seen.lock();
        *n += 1;
        let i = *n;
        drop(n);

        let dt_ms = self.start.elapsed().as_secs_f64() * 1000.0;
        match event {
            Event::FsChanged { path, change } => {
                let kind = match change {
                    FsChangeKind::Created => "Created    ".to_string(),
                    FsChangeKind::Modified => "Modified   ".to_string(),
                    FsChangeKind::Deleted => "Deleted    ".to_string(),
                    FsChangeKind::Renamed { from } => format!("Renamed←{from} "),
                };
                println!("[+{dt_ms:>7.1}ms] #{i:>3} {kind}  {path}");
            }
            other => {
                println!("[+{dt_ms:>7.1}ms] #{i:>3} {other:?}");
            }
        }
    }
}

#[tokio::main(flavor = "multi_thread", worker_threads = 2)]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let argv: Vec<String> = std::env::args().skip(1).collect();
    let (vault_root, is_owned_temp) = if let Some(p) = argv.first() {
        (PathBuf::from(p), false)
    } else {
        let dir = tempfile::TempDir::new()?;
        // Leak the TempDir so it survives the demo; we'll print where it is.
        let path = dir.keep();
        (path, true)
    };
    let vault_root = vault_root
        .canonicalize()
        .unwrap_or_else(|_| vault_root.clone());

    println!("== Loom B2 fs_demo ==");
    println!("  vault       : {}", vault_root.display());
    println!(
        "  debounce    : {}",
        std::env::var(loom_core::fs::FS_DEBOUNCE_ENV_VAR)
            .unwrap_or_else(|_| format!("(default {} ms)", loom_core::fs::DEFAULT_DEBOUNCE_MS))
    );
    println!("  reconcile   : every 60 s (default)");
    println!();

    let start = Instant::now();
    let echo = Arc::new(EchoGuard::new());
    let sink: Arc<dyn EventSink> = Arc::new(PrintingEventSink {
        start,
        seen: Mutex::new(0),
    });

    let _watcher = FsWatcher::start(vault_root.clone(), echo.clone(), sink)?;
    let svc = DocumentService::new(vault_root.clone(), echo);

    // If we owned the temp directory, do a small scripted demo so the
    // user immediately sees something: a self-write (suppressed) followed
    // by an external write (surfaced).
    if is_owned_temp {
        tokio::time::sleep(std::time::Duration::from_millis(80)).await;

        let path = vault_root.join("demo.md");
        println!("[demo] DocumentService write \"first version\" (echo-suppressed)");
        svc.write_document(
            &Origin::User,
            std::path::Path::new("demo.md"),
            b"first version\n",
            None,
        )?;

        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        println!("[demo] std::fs::write \"external edit\" (should surface as Modified)");
        std::fs::write(&path, b"external edit\n")?;

        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        println!("[demo] mark_dirty + std::fs::write again");
        svc.mark_open(std::path::Path::new("demo.md"), "00");
        svc.mark_dirty(std::path::Path::new("demo.md"));
        std::fs::write(&path, b"clobbered while editor was dirty\n")?;

        tokio::time::sleep(std::time::Duration::from_millis(400)).await;

        let conflict = svc.check_conflict(std::path::Path::new("demo.md"));
        println!("[demo] check_conflict(demo.md) = {conflict:?}");

        println!();
        println!("[demo] now waiting for external changes — try in another shell:");
        println!("        echo \"hi\" >> {}", path.display());
        println!(
            "        mv {} {}",
            path.display(),
            vault_root.join("renamed.md").display()
        );
    } else {
        println!("[ready] watching … (Ctrl-C to stop)");
    }

    tokio::signal::ctrl_c().await?;
    println!();
    println!("[ctrl-c] stopping");
    Ok(())
}

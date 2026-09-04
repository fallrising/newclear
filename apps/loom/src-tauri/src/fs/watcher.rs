//! Filesystem watcher with debouncing, echo-loop filtering, and a periodic
//! reconciliation scan that backstops missed FSEvents.
//!
//! Topology:
//!
//!   notify::RecommendedWatcher
//!         │  raw events (high frequency, possibly duplicated by path)
//!         ▼
//!   std::sync::mpsc → tokio task (debouncer)
//!         │  100 ms windows; dedupe by path, keep latest kind
//!         ▼
//!   echo-loop filter (hash on-disk bytes, drop self-write echoes — D-7)
//!         │
//!         ▼
//!   EventSink::emit(Event::FsChanged)
//!
//! A separate task scans the vault every `reconcile_interval` (default
//! 60 s) and emits synthetic `Created` / `Deleted` events for any paths
//! whose presence changed without a corresponding watcher event. macOS
//! FSEvents occasionally coalesces events under rename storms; this is
//! the §9 graceful-degrade backstop.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use tokio::sync::mpsc;

use loom_contracts::{Event, FsChangeKind};

use super::document::canonicalize_lenient;
use super::echo_guard::EchoGuard;
use super::error::FsResult;
use crate::pty::EventSink;

pub const DEFAULT_DEBOUNCE_MS: u64 = 100;
pub const FS_DEBOUNCE_ENV_VAR: &str = "LOOM_FS_DEBOUNCE_MS";
pub const DEFAULT_RECONCILE_INTERVAL: Duration = Duration::from_secs(60);

/// Limit on how much of a file we'll hash when checking for echo. The
/// guard only registers hashes of bytes we're about to write, and we
/// almost always do whole-file writes, so this matches the registered
/// payload exactly. Files larger than this skip the hash check and flow
/// through as regular events.
const MAX_HASH_BYTES: u64 = 32 * 1024 * 1024; // 32 MiB

/// One running watcher. Drop the value to stop the watcher and its
/// background tasks; all spawned tokio tasks are aborted on drop.
pub struct FsWatcher {
    vault_root: PathBuf,
    echo_guard: Arc<EchoGuard>,
    // Held to keep the watcher alive; mpsc sender lives inside.
    _watcher: Mutex<RecommendedWatcher>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
}

impl FsWatcher {
    /// Start watching `vault_root` recursively. Emits `Event::FsChanged`
    /// to `event_sink` after debouncing and echo-loop filtering.
    pub fn start(
        vault_root: impl AsRef<Path>,
        echo_guard: Arc<EchoGuard>,
        event_sink: Arc<dyn EventSink>,
    ) -> FsResult<Self> {
        Self::start_with(
            vault_root,
            echo_guard,
            event_sink,
            Duration::from_millis(debounce_ms_from_env()),
            DEFAULT_RECONCILE_INTERVAL,
        )
    }

    /// Same as `start`, but with explicit timings. Tests use this to run
    /// debouncing and reconcile much faster.
    pub fn start_with(
        vault_root: impl AsRef<Path>,
        echo_guard: Arc<EchoGuard>,
        event_sink: Arc<dyn EventSink>,
        debounce: Duration,
        reconcile_interval: Duration,
    ) -> FsResult<Self> {
        // Canonicalize so emitted paths match what `DocumentService` stored
        // when registering self-writes (otherwise `/var/folders/X` vs
        // `/private/var/folders/X` makes every echo lookup miss on macOS).
        let vault_root = canonicalize_lenient(vault_root.as_ref());
        if !vault_root.exists() {
            tracing::warn!(
                vault = ?vault_root,
                "vault root does not exist at startup; watcher will start anyway",
            );
        }

        let (raw_tx, raw_rx) = std::sync::mpsc::channel::<notify::Result<notify::Event>>();

        let mut watcher = RecommendedWatcher::new(raw_tx, Config::default())?;
        watcher.watch(&vault_root, RecursiveMode::Recursive)?;

        // Bridge std::sync::mpsc → tokio::sync::mpsc so the debouncer can
        // await it. notify's own thread does the blocking recv.
        let (tokio_tx, tokio_rx) = mpsc::unbounded_channel();
        std::thread::Builder::new()
            .name("loom-fs-bridge".into())
            .spawn(move || {
                while let Ok(ev) = raw_rx.recv() {
                    if tokio_tx.send(ev).is_err() {
                        break;
                    }
                }
            })
            .expect("spawn fs bridge thread");

        let debouncer_task = tokio::spawn(run_debouncer(
            tokio_rx,
            debounce,
            event_sink.clone(),
            echo_guard.clone(),
        ));
        let reconcile_task = tokio::spawn(run_reconcile(
            vault_root.clone(),
            reconcile_interval,
            event_sink,
            echo_guard.clone(),
        ));

        Ok(Self {
            vault_root,
            echo_guard,
            _watcher: Mutex::new(watcher),
            tasks: Mutex::new(vec![debouncer_task, reconcile_task]),
        })
    }

    #[must_use]
    pub fn vault_root(&self) -> &Path {
        &self.vault_root
    }

    #[must_use]
    pub fn echo_guard(&self) -> Arc<EchoGuard> {
        self.echo_guard.clone()
    }
}

impl Drop for FsWatcher {
    fn drop(&mut self) {
        for task in self.tasks.lock().drain(..) {
            task.abort();
        }
    }
}

fn debounce_ms_from_env() -> u64 {
    match std::env::var(FS_DEBOUNCE_ENV_VAR) {
        Ok(raw) => match raw.parse::<u64>() {
            Ok(n) if n > 0 => n,
            _ => {
                tracing::warn!(env = FS_DEBOUNCE_ENV_VAR, value = %raw, "invalid; using default");
                DEFAULT_DEBOUNCE_MS
            }
        },
        Err(_) => DEFAULT_DEBOUNCE_MS,
    }
}

#[derive(Debug, Clone)]
enum PendingChange {
    Created,
    Modified,
    Deleted,
    Renamed { from: PathBuf },
}

impl PendingChange {
    fn into_kind(self) -> FsChangeKind {
        match self {
            Self::Created => FsChangeKind::Created,
            Self::Modified => FsChangeKind::Modified,
            Self::Deleted => FsChangeKind::Deleted,
            Self::Renamed { from } => FsChangeKind::Renamed {
                from: from.to_string_lossy().into_owned(),
            },
        }
    }
}

async fn run_debouncer(
    mut rx: mpsc::UnboundedReceiver<notify::Result<notify::Event>>,
    debounce: Duration,
    sink: Arc<dyn EventSink>,
    echo: Arc<EchoGuard>,
) {
    // PathBuf → latest pending change. Rename overrides Modified; Delete
    // overrides everything; Create stays Create unless a later Delete
    // arrives. Dedupe is "last write wins, with Delete being absorbing."
    let mut pending: HashMap<PathBuf, PendingChange> = HashMap::new();
    let mut deadline: Option<tokio::time::Instant> = None;

    loop {
        let next_step = match deadline {
            Some(d) => tokio::time::timeout_at(d, rx.recv()).await,
            None => Ok(rx.recv().await),
        };

        match next_step {
            Ok(Some(Ok(ev))) => {
                ingest_event(&mut pending, ev);
                deadline.get_or_insert_with(|| tokio::time::Instant::now() + debounce);
            }
            Ok(Some(Err(e))) => {
                tracing::warn!(error = %e, "notify watcher error");
            }
            Ok(None) => {
                // Bridge thread closed → no more events ever; drain whatever's
                // pending and exit.
                flush(&mut pending, &sink, &echo);
                break;
            }
            Err(_) => {
                // Debounce deadline reached without further events.
                flush(&mut pending, &sink, &echo);
                deadline = None;
            }
        }
    }
}

fn ingest_event(pending: &mut HashMap<PathBuf, PendingChange>, ev: notify::Event) {
    let change = match ev.kind {
        EventKind::Create(_) => PendingChange::Created,
        EventKind::Modify(notify::event::ModifyKind::Name(rename)) => {
            ingest_rename(pending, ev.paths, rename);
            return;
        }
        EventKind::Modify(_) => PendingChange::Modified,
        EventKind::Remove(_) => PendingChange::Deleted,
        // Access / Any: nothing the document layer cares about.
        EventKind::Access(_) | EventKind::Any | EventKind::Other => return,
    };
    for path in ev.paths {
        merge_pending(pending, path, change.clone());
    }
}

fn ingest_rename(
    pending: &mut HashMap<PathBuf, PendingChange>,
    paths: Vec<PathBuf>,
    kind: notify::event::RenameMode,
) {
    use notify::event::RenameMode;
    match kind {
        RenameMode::Both if paths.len() == 2 => {
            let from = paths[0].clone();
            let to = paths[1].clone();
            merge_pending(pending, to, PendingChange::Renamed { from });
        }
        RenameMode::From => {
            for p in paths {
                merge_pending(pending, p, PendingChange::Deleted);
            }
        }
        RenameMode::To => {
            for p in paths {
                merge_pending(pending, p, PendingChange::Created);
            }
        }
        _ => {
            for p in paths {
                merge_pending(pending, p, PendingChange::Modified);
            }
        }
    }
}

fn merge_pending(
    pending: &mut HashMap<PathBuf, PendingChange>,
    path: PathBuf,
    change: PendingChange,
) {
    use PendingChange::{Created, Deleted, Modified, Renamed};
    let next = match (pending.get(&path), &change) {
        // Delete absorbs everything else for the same path.
        (_, Deleted) => Deleted,
        // A later Created after a Deleted (recreate) collapses to Modified
        // — the consumer hadn't yet learned the file was gone, so the net
        // effect is "the bytes changed."
        (Some(Deleted), Created) => Modified,
        // Renamed wins over Modified/Created (more information).
        (Some(Created | Modified), Renamed { from }) => Renamed { from: from.clone() },
        // Otherwise, latest wins.
        _ => change,
    };
    pending.insert(path, next);
}

fn flush(
    pending: &mut HashMap<PathBuf, PendingChange>,
    sink: &Arc<dyn EventSink>,
    echo: &EchoGuard,
) {
    for (path, change) in pending.drain() {
        let kind = change.into_kind();
        if !should_emit(&path, &kind, echo) {
            continue;
        }
        sink.emit(Event::FsChanged {
            path: path.to_string_lossy().into_owned(),
            change: kind,
        });
    }
}

/// Shared filtering used by both the notify-driven debouncer and the
/// periodic reconcile scan. The two pipelines must apply the same rules
/// or one will leak self-write echoes the other already suppressed.
fn should_emit(path: &Path, kind: &FsChangeKind, echo: &EchoGuard) -> bool {
    if is_hidden(path) {
        return false;
    }
    // Created / Modified events on a path with a live self-write
    // registration are echoes of our own write — drop them. Delete and
    // Rename are never echoes (the guard only knows about content), so
    // they always flow.
    if matches!(kind, FsChangeKind::Created | FsChangeKind::Modified)
        && is_self_write_echo(path, echo)
    {
        tracing::trace!(?path, "echo-loop event suppressed");
        return false;
    }
    true
}

fn is_hidden(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .is_some_and(|n| n.starts_with('.'))
}

fn is_self_write_echo(path: &Path, echo: &EchoGuard) -> bool {
    let Ok(meta) = std::fs::metadata(path) else {
        return false;
    };
    if meta.len() > MAX_HASH_BYTES {
        return false;
    }
    let Ok(bytes) = std::fs::read(path) else {
        return false;
    };
    echo.should_ignore_event(path, &bytes)
}

async fn run_reconcile(
    vault_root: PathBuf,
    interval: Duration,
    sink: Arc<dyn EventSink>,
    echo: Arc<EchoGuard>,
) {
    let mut last_seen: HashSet<PathBuf> = scan(&vault_root);
    let mut ticker = tokio::time::interval(interval);
    ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    ticker.tick().await; // consume immediate first tick

    loop {
        ticker.tick().await;
        let current = scan(&vault_root);

        for new_path in current.difference(&last_seen) {
            if !should_emit(new_path, &FsChangeKind::Created, &echo) {
                continue;
            }
            tracing::debug!(?new_path, "reconcile: backfilling Created");
            sink.emit(Event::FsChanged {
                path: new_path.to_string_lossy().into_owned(),
                change: FsChangeKind::Created,
            });
        }
        for missing_path in last_seen.difference(&current) {
            if !should_emit(missing_path, &FsChangeKind::Deleted, &echo) {
                continue;
            }
            tracing::debug!(?missing_path, "reconcile: backfilling Deleted");
            sink.emit(Event::FsChanged {
                path: missing_path.to_string_lossy().into_owned(),
                change: FsChangeKind::Deleted,
            });
        }
        last_seen = current;
    }
}

fn scan(root: &Path) -> HashSet<PathBuf> {
    let mut stack = vec![root.to_path_buf()];
    let mut out = HashSet::new();
    while let Some(dir) = stack.pop() {
        let Ok(rd) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in rd.flatten() {
            let path = entry.path();
            match entry.file_type() {
                Ok(ft) if ft.is_dir() => stack.push(path),
                Ok(ft) if ft.is_file() => {
                    out.insert(path);
                }
                _ => {}
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_pending_delete_absorbs_create() {
        let mut p = HashMap::new();
        merge_pending(&mut p, "/a".into(), PendingChange::Created);
        merge_pending(&mut p, "/a".into(), PendingChange::Deleted);
        assert!(matches!(
            p.get(Path::new("/a")).unwrap(),
            PendingChange::Deleted
        ));
    }

    #[test]
    fn merge_pending_delete_then_create_becomes_modified() {
        // Consumer hadn't seen Deleted yet — collapse the two into Modified
        // (the only observable effect is that the bytes changed).
        let mut p = HashMap::new();
        merge_pending(&mut p, "/a".into(), PendingChange::Deleted);
        merge_pending(&mut p, "/a".into(), PendingChange::Created);
        assert!(matches!(
            p.get(Path::new("/a")).unwrap(),
            PendingChange::Modified
        ));
    }

    #[test]
    fn merge_pending_rename_beats_modified() {
        let mut p = HashMap::new();
        merge_pending(&mut p, "/b".into(), PendingChange::Modified);
        merge_pending(
            &mut p,
            "/b".into(),
            PendingChange::Renamed {
                from: "/old".into(),
            },
        );
        match p.get(Path::new("/b")).unwrap() {
            PendingChange::Renamed { from } => assert_eq!(from, Path::new("/old")),
            other => panic!("unexpected: {other:?}"),
        }
    }

    #[test]
    fn scan_collects_files_recursively() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::write(dir.path().join("a.md"), b"a").unwrap();
        std::fs::create_dir_all(dir.path().join("sub")).unwrap();
        std::fs::write(dir.path().join("sub/b.md"), b"b").unwrap();
        let s = scan(dir.path());
        assert_eq!(s.len(), 2);
        assert!(s.contains(&dir.path().join("a.md")));
        assert!(s.contains(&dir.path().join("sub/b.md")));
    }
}

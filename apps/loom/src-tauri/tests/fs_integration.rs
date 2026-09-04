//! B2 integration: real tempdir vault, real notify watcher, real disk I/O.
//! Each test maps to one or more acceptance items in 03-acceptance §B2.
//!
//! These tests use short debounce windows so they finish quickly, but they
//! must still tolerate FSEvents' inherent jitter — a few hundred milliseconds
//! of wall time per assertion is normal.

use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use loom_contracts::{Event, FsChangeKind, Origin};
use loom_core::fs::{ConflictStatus, DocumentService, EchoGuard, FsWatcher, WriteOutcome};
use loom_core::pty::VecEventSink;

const DEBOUNCE: Duration = Duration::from_millis(40);
const RECONCILE: Duration = Duration::from_millis(80);
const SETTLE: Duration = Duration::from_millis(250);

struct Rig {
    _dir: tempfile::TempDir,
    /// Canonicalized vault root (matches what `DocumentService` and the
    /// watcher both store internally and what FSEvents reports back).
    root: std::path::PathBuf,
    svc: Arc<DocumentService>,
    sink: Arc<VecEventSink>,
    _watcher: FsWatcher,
}

fn rig() -> Rig {
    let dir = tempfile::TempDir::new().unwrap();
    let root = dir
        .path()
        .canonicalize()
        .unwrap_or_else(|_| dir.path().into());
    let guard = Arc::new(EchoGuard::new());
    let sink = VecEventSink::shared();
    let svc = Arc::new(DocumentService::new(root.clone(), guard.clone()));
    let watcher = FsWatcher::start_with(root.clone(), guard, sink.clone(), DEBOUNCE, RECONCILE)
        .expect("start watcher");
    // Give the watcher a tick to subscribe to the dir.
    std::thread::sleep(Duration::from_millis(60));
    Rig {
        _dir: dir,
        root,
        svc,
        sink,
        _watcher: watcher,
    }
}

fn fs_changed(events: &[Event], path: &Path) -> Option<FsChangeKind> {
    let target = path.to_string_lossy().into_owned();
    events.iter().rev().find_map(|e| match e {
        Event::FsChanged { path: p, change } if p == &target => Some(change.clone()),
        _ => None,
    })
}

fn count_fs_changed(events: &[Event], path: &Path) -> usize {
    let target = path.to_string_lossy().into_owned();
    events
        .iter()
        .filter(|e| matches!(e, Event::FsChanged { path: p, .. } if p == &target))
        .count()
}

// B2-1: self-write must NOT show up as a watcher event the consumer sees.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b2_1_self_write_does_not_trigger_reload() {
    let rig = rig();
    let path = rig.root.join("self.md");

    let res = rig
        .svc
        .write_document(&Origin::User, Path::new("self.md"), b"bytes from app", None)
        .unwrap();
    assert!(matches!(res, WriteOutcome::Written { .. }));

    tokio::time::sleep(SETTLE).await;

    assert_eq!(
        count_fs_changed(&rig.sink.snapshot(), &path),
        0,
        "self-write must be swallowed by the echo guard; events seen: {:?}",
        rig.sink.snapshot(),
    );
}

// B2-2: a genuine external write must surface as `Modified`.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b2_2_external_change_emits_modified() {
    let rig = rig();
    let path = rig.root.join("ext.md");
    // Seed the file so subsequent writes are Modified, not Created.
    std::fs::write(&path, b"v1").unwrap();
    tokio::time::sleep(SETTLE).await;
    rig.sink.take();

    std::fs::write(&path, b"v2 from elsewhere").unwrap();
    tokio::time::sleep(SETTLE).await;

    let kind = fs_changed(&rig.sink.snapshot(), &path)
        .unwrap_or_else(|| panic!("no FsChanged for {path:?}; saw {:?}", rig.sink.snapshot()));
    assert!(
        matches!(kind, FsChangeKind::Modified | FsChangeKind::Created),
        "expected Modified-like event, got {kind:?}",
    );
}

// B2-3: external change while editor is dirty must be reported as a
// conflict via DocumentService::check_conflict — NOT auto-applied.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b2_3_external_with_unsaved_is_a_conflict() {
    let rig = rig();
    let path = rig.root.join("dirty.md");
    std::fs::write(&path, b"original").unwrap();
    tokio::time::sleep(SETTLE).await;
    rig.sink.take();

    let snap = rig.svc.read_document(Path::new("dirty.md")).unwrap();
    rig.svc.mark_open(Path::new("dirty.md"), &snap.on_disk_hash);
    rig.svc.mark_dirty(Path::new("dirty.md"));

    // External editor (Obsidian, sed, …) clobbers the file behind our back.
    std::fs::write(&path, b"clobbered externally").unwrap();
    tokio::time::sleep(SETTLE).await;

    // Watcher event must have fired so the frontend knows to investigate.
    assert!(
        fs_changed(&rig.sink.snapshot(), &path).is_some(),
        "expected a watcher event so the frontend knows to call check_conflict()",
    );
    // Backend says: yes, this would silently overwrite work.
    assert_eq!(
        rig.svc.check_conflict(Path::new("dirty.md")),
        ConflictStatus::Conflict,
    );
    // And the bytes the external writer left are still on disk (no
    // auto-reload / no auto-write happened from the backend's side).
    let disk = std::fs::read(&path).unwrap();
    assert_eq!(&disk, b"clobbered externally");
}

// B2-4: per acceptance, the goal of debounce + reconcile is "no events
// lost leading to inconsistent state." We assert that every final path
// produced by a 10×5 rename storm is observable in the event stream —
// the reconcile scan backstops anything notify itself coalesced away.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b2_4_rename_storm_state_converges() {
    let rig = rig();

    let mut final_names = Vec::new();
    for i in 0..10 {
        let initial = rig.root.join(format!("file{i}_v0.md"));
        std::fs::write(&initial, format!("file {i}").as_bytes()).unwrap();
        let mut current = initial;
        for v in 1..=5 {
            let next = rig.root.join(format!("file{i}_v{v}.md"));
            std::fs::rename(&current, &next).unwrap();
            current = next;
        }
        final_names.push(current);
    }

    // Wait for at least one reconcile tick + settle window so anything
    // notify dropped under the storm gets backfilled.
    tokio::time::sleep(RECONCILE * 2 + SETTLE).await;
    let after = rig.sink.snapshot();
    for final_path in &final_names {
        let target = final_path.to_string_lossy().into_owned();
        let saw_any = after
            .iter()
            .any(|e| matches!(e, Event::FsChanged { path: p, .. } if p == &target));
        assert!(
            saw_any,
            "final path {final_path:?} never surfaced through notify or reconcile",
        );
    }
}

// B2-5: the file system is the source of truth for .md content. Whatever
// the service writes must equal what `std::fs::read` returns byte-for-byte
// — no caching, no reformatting.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn b2_5_md_content_is_byte_exact_from_filesystem() {
    let rig = rig();
    let bytes: Vec<u8> = (0u8..=255).cycle().take(8192).collect();

    rig.svc
        .write_document(&Origin::User, Path::new("binary.md"), &bytes, None)
        .unwrap();

    let disk = std::fs::read(rig.root.join("binary.md")).unwrap();
    assert_eq!(disk, bytes, "service must round-trip arbitrary bytes");

    // The read API returns whatever's on disk, even after a fresh service:
    // there is no in-memory cache to fall back to.
    let svc2 = DocumentService::new(rig.root.clone(), Arc::new(EchoGuard::new()));
    let snap = svc2.read_document(Path::new("binary.md")).unwrap();
    assert!(!snap.content.is_empty());
    assert_eq!(snap.on_disk_hash, blake3::hash(&bytes).to_hex().to_string());
}

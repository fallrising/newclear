use std::path::Path;
use std::sync::{Arc, Barrier};
use std::time::Duration;

use loom_contracts::Origin;
use loom_core::fs::{
    ConflictStatus, DocumentService, DocumentSnapshot, EchoGuard, FsResult, WriteOutcome,
};
use tempfile::TempDir;

fn service() -> (TempDir, DocumentService, Arc<EchoGuard>) {
    let dir = TempDir::new().unwrap();
    let guard = Arc::new(EchoGuard::with_ttl(Duration::from_secs(30)));
    let svc = DocumentService::new(dir.path(), guard.clone());
    (dir, svc, guard)
}

fn create(svc: &DocumentService, path: &Path, content: &str) -> FsResult<DocumentSnapshot> {
    svc.create_document(&Origin::User, path, content)
}

fn assert_no_temps(dir: &Path) {
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        assert!(!entry.file_name().to_string_lossy().contains(".tmp."));
    }
}

#[test]
fn creates_empty_and_nested_documents_with_submitted_snapshot_and_echo() {
    let (_dir, svc, guard) = service();
    for (path, content) in [
        ("empty.md", ""),
        ("nested/deep/note.md", "submitted café 📝\n"),
    ] {
        let snapshot = create(&svc, Path::new(path), content).unwrap();
        assert_eq!(snapshot.path, svc.vault_root().join(path));
        assert_eq!(snapshot.content, content);
        assert_eq!(
            snapshot.on_disk_hash,
            blake3::hash(content.as_bytes()).to_hex().to_string()
        );
        assert_eq!(std::fs::read(&snapshot.path).unwrap(), content.as_bytes());
        assert!(guard.should_ignore_event(&snapshot.path, content.as_bytes()));
        assert_no_temps(snapshot.path.parent().unwrap());
    }
}

#[test]
fn existing_destination_is_preserved_and_failure_keeps_editor_dirty() {
    let (_dir, svc, guard) = service();
    let path = Path::new("note.md");
    svc.mark_open(path, "old-hash");
    svc.mark_dirty(path);
    std::fs::write(svc.vault_root().join(path), "external winner").unwrap();
    let result = create(&svc, path, "unsaved edits");
    assert!(result.is_err(), "create replaced an existing document");
    assert!(result.unwrap_err().to_string().contains("already exists"));
    assert_eq!(
        std::fs::read_to_string(svc.vault_root().join(path)).unwrap(),
        "external winner"
    );
    assert_eq!(svc.check_conflict(path), ConflictStatus::Conflict);
    assert!(!guard.should_ignore_event(&svc.vault_root().join(path), b"unsaved edits"));
    assert_no_temps(svc.vault_root());
}

#[test]
fn concurrent_creators_publish_exactly_one_complete_winner() {
    for round in 0..20 {
        let (_dir, svc, guard) = service();
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|label| {
                let svc = svc.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let content = format!("{label}-{round}\n").repeat(8192);
                    barrier.wait();
                    (
                        content.clone(),
                        create(&svc, Path::new("racing.md"), &content),
                    )
                })
            })
            .collect();
        barrier.wait();
        let outcomes: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let winners: Vec<_> = outcomes
            .iter()
            .filter(|(_, result)| result.is_ok())
            .collect();
        assert_eq!(winners.len(), 1, "expected exactly one create to succeed");
        let (content, snapshot) = winners[0];
        let snapshot = snapshot.as_ref().unwrap();
        assert_eq!(snapshot.content, *content);
        assert_eq!(std::fs::read_to_string(&snapshot.path).unwrap(), *content);
        assert_eq!(
            snapshot.on_disk_hash,
            blake3::hash(content.as_bytes()).to_hex().to_string()
        );
        assert!(guard.should_ignore_event(&snapshot.path, content.as_bytes()));
        assert_no_temps(svc.vault_root());
    }
}

#[test]
fn independent_services_still_have_one_winner_without_a_shared_lock() {
    for _ in 0..20 {
        let dir = TempDir::new().unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let handles: Vec<_> = ["first", "second"]
            .into_iter()
            .map(|label| {
                let svc = DocumentService::new(dir.path(), Arc::new(EchoGuard::new()));
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    let content = label.repeat(65536);
                    barrier.wait();
                    (
                        content.clone(),
                        create(&svc, Path::new("racing.md"), &content),
                    )
                })
            })
            .collect();
        barrier.wait();
        let outcomes: Vec<_> = handles.into_iter().map(|h| h.join().unwrap()).collect();
        let winners: Vec<_> = outcomes
            .iter()
            .filter(|(_, result)| result.is_ok())
            .collect();
        assert_eq!(winners.len(), 1);
        let (content, snapshot) = winners[0];
        let snapshot = snapshot.as_ref().unwrap();
        assert_eq!(snapshot.content, *content);
        assert_eq!(std::fs::read_to_string(&snapshot.path).unwrap(), *content);
        assert_no_temps(dir.path());
    }
}

#[test]
fn failed_directory_and_parent_file_destinations_leave_no_temps_or_echo() {
    let (_dir, svc, guard) = service();
    std::fs::create_dir(svc.vault_root().join("directory.md")).unwrap();
    std::fs::write(svc.vault_root().join("parent"), "preserve").unwrap();
    for path in ["directory.md", "parent/child.md"] {
        assert!(create(&svc, Path::new(path), "pending").is_err());
        assert!(!guard.should_ignore_event(&svc.vault_root().join(path), b"pending"));
    }
    assert!(svc.vault_root().join("directory.md").is_dir());
    assert_eq!(
        std::fs::read_to_string(svc.vault_root().join("parent")).unwrap(),
        "preserve"
    );
    assert_no_temps(svc.vault_root());
}

#[cfg(target_os = "linux")]
#[test]
fn staging_failure_forgets_attempted_echo_and_preserves_dirty_editor() {
    let (_dir, svc, guard) = service();
    // The destination fits Linux NAME_MAX, while its staging filename does
    // not. This fails after echo registration but before publication.
    let name = format!("{}.md", "a".repeat(250));
    let path = Path::new(&name);
    svc.mark_open(path, "old-hash");
    svc.mark_dirty(path);
    assert!(create(&svc, path, "pending").is_err());
    assert!(!guard.should_ignore_event(&svc.vault_root().join(path), b"pending"));
    assert_eq!(svc.check_conflict(path), ConflictStatus::Conflict);
    assert!(!svc.vault_root().join(path).exists());
    assert_no_temps(svc.vault_root());
}

#[test]
fn creation_success_updates_existing_editor_and_preserves_normal_saves() {
    let (_dir, svc, _guard) = service();
    let path = Path::new("note.md");
    svc.mark_open(path, "old-hash");
    svc.mark_dirty(path);
    let snapshot = create(&svc, path, "created").unwrap();
    std::fs::write(&snapshot.path, "external").unwrap();
    assert_eq!(svc.check_conflict(path), ConflictStatus::NoConflict);
    svc.mark_dirty(path);
    assert_eq!(svc.check_conflict(path), ConflictStatus::Conflict);
    assert!(matches!(
        svc.write_document(&Origin::User, path, b"refuse", Some(&snapshot.on_disk_hash))
            .unwrap(),
        WriteOutcome::Conflict { .. }
    ));
    let current = svc.read_document(path).unwrap();
    assert!(matches!(
        svc.write_document(&Origin::User, path, b"keep", Some(&current.on_disk_hash))
            .unwrap(),
        WriteOutcome::Written { .. }
    ));
    assert!(matches!(
        svc.write_document(&Origin::User, path, b"normal save", None)
            .unwrap(),
        WriteOutcome::Written { .. }
    ));
    assert_eq!(
        std::fs::read_to_string(&snapshot.path).unwrap(),
        "normal save"
    );
}

#[test]
fn rejects_paths_outside_vault() {
    let (_dir, svc, _guard) = service();
    let outside = TempDir::new().unwrap();
    let target = outside.path().join("outside.md");
    assert!(create(&svc, &target, "escape").is_err());
    assert!(create(&svc, Path::new("../escape.md"), "escape").is_err());
    assert!(!target.exists());
}

#[cfg(unix)]
#[test]
fn rejects_symlink_targets_and_ancestors_including_dangling_targets() {
    use std::os::unix::fs::symlink;
    let (_dir, svc, _guard) = service();
    let outside = TempDir::new().unwrap();
    let target = outside.path().join("existing.md");
    std::fs::write(&target, "preserve").unwrap();
    symlink(&target, svc.vault_root().join("link.md")).unwrap();
    symlink(
        outside.path().join("absent.md"),
        svc.vault_root().join("dangling.md"),
    )
    .unwrap();
    symlink(outside.path(), svc.vault_root().join("linked")).unwrap();
    for path in [
        "link.md",
        "dangling.md",
        "linked/new.md",
        "linked/../new.md",
    ] {
        assert!(create(&svc, Path::new(path), "clobber").is_err());
    }
    assert_eq!(std::fs::read_to_string(&target).unwrap(), "preserve");
    assert!(!outside.path().join("absent.md").exists());
    assert!(!outside.path().join("new.md").exists());
}

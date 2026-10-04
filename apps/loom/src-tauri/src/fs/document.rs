//! High-level document I/O. The `.md` content on disk is the single
//! source of truth (TDD §4.1); this service is the only path that reads
//! and writes it. Anything that needs the bytes for AI context (B4) or
//! an editor snapshot (C2 via IPC) goes through here.
//!
//! The service is intentionally thin: no caching, no parsing, no
//! frontmatter awareness. It owns three pieces:
//!
//!   1. `read_document` — hash-and-return the file contents.
//!   2. `write_document` — atomic save with optional optimistic-concurrency
//!      via `expected_hash`; registers an echo-guard entry first (D-7).
//!   3. editor state — a tiny per-path record of "last hash the editor
//!      saw" + "has unsaved changes," used by `check_conflict` so the
//!      frontend can decide whether a `FsChanged::Modified` is a real
//!      external edit that would overwrite work (§7.2 / B2-3).

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use parking_lot::Mutex;

use loom_contracts::Origin;

use super::atomic_write::{atomic_create, atomic_write};
use super::echo_guard::EchoGuard;
use super::error::{FsError, FsResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentSnapshot {
    /// Absolute, normalized identity shared with watcher events.
    pub path: PathBuf,
    pub content: String,
    /// Hex-encoded blake3 of the bytes that produced `content`.
    pub on_disk_hash: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WriteOutcome {
    Written { new_hash: String },
    Conflict { current_disk_hash: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConflictStatus {
    /// No live editor state for this path; nothing to compare against.
    Unknown,
    /// Editor has unsaved changes, but disk still matches what they last saw.
    NoConflict,
    /// Editor has unsaved changes and the on-disk bytes have changed
    /// since they were opened — a reload would silently overwrite them.
    Conflict,
}

#[derive(Debug, Clone)]
struct EditorState {
    last_seen_hash: String,
    dirty: bool,
}

#[derive(Clone)]
pub struct DocumentService {
    vault_root: PathBuf,
    echo_guard: Arc<EchoGuard>,
    editors: Arc<Mutex<HashMap<PathBuf, EditorState>>>,
    // Serialize publications and echo registration across service clones.
    publication: Arc<Mutex<()>>,
}

impl DocumentService {
    /// `vault_root` is canonicalized at construction so it matches the
    /// paths FSEvents reports (macOS resolves `/var/folders/X` to
    /// `/private/var/folders/X` before delivering watcher events; a raw
    /// vault_root would cause every echo-guard lookup to miss).
    #[must_use]
    pub fn new(vault_root: impl AsRef<Path>, echo_guard: Arc<EchoGuard>) -> Self {
        let vault_root = canonicalize_lenient(vault_root.as_ref());
        Self {
            vault_root,
            echo_guard,
            editors: Arc::new(Mutex::new(HashMap::new())),
            publication: Arc::new(Mutex::new(())),
        }
    }

    #[must_use]
    pub fn vault_root(&self) -> &Path {
        &self.vault_root
    }

    /// Synchronously read a document. Caller is responsible for not
    /// blocking the runtime; the async wrappers in the public IPC layer
    /// will hop to `spawn_blocking`.
    pub fn read_document(&self, path: &Path) -> FsResult<DocumentSnapshot> {
        let abs = self.resolve_path(path)?;
        let bytes = std::fs::read(&abs).map_err(|e| match e.kind() {
            std::io::ErrorKind::NotFound => FsError::NotFound(abs.clone()),
            _ => FsError::Io {
                path: abs.clone(),
                source: e,
            },
        })?;
        let on_disk_hash = hash_hex(&bytes);
        let content = String::from_utf8_lossy(&bytes).into_owned();
        Ok(DocumentSnapshot {
            path: abs,
            content,
            on_disk_hash,
        })
    }

    /// Atomically write a document. If `expected_hash` is `Some`, the
    /// write only proceeds when the file on disk currently hashes to
    /// that value — otherwise it returns `WriteOutcome::Conflict` and
    /// makes no changes. This is the backend half of optimistic locking
    /// for the editor.
    ///
    /// On success the echo-loop guard is registered with the written
    /// bytes *before* the rename, so the FSEvents notification that
    /// follows will be suppressed (D-7).
    pub fn write_document(
        &self,
        origin: &Origin,
        path: &Path,
        content: &[u8],
        expected_hash: Option<&str>,
    ) -> FsResult<WriteOutcome> {
        let _publication = self.publication.lock();
        let abs = self.resolve_path(path)?;
        tracing::info!(?origin, path = ?abs, len = content.len(), "write_document");

        if let Some(expected) = expected_hash {
            let existing = match std::fs::read(&abs) {
                Ok(bytes) => bytes,
                // An absent target has no current content hash. Preserve the
                // existing conflict DTO: an empty hash means deletion, never
                // permission to recreate without an explicit no-hash write.
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                    return Ok(WriteOutcome::Conflict {
                        current_disk_hash: String::new(),
                    });
                }
                Err(source) => return Err(FsError::Io { path: abs, source }),
            };
            let current = hash_hex(&existing);
            if current != expected {
                return Ok(WriteOutcome::Conflict {
                    current_disk_hash: current,
                });
            }
        }

        // Register echo guard BEFORE the rename so the notify event,
        // which can race the rename completion, finds a live entry.
        self.echo_guard.register_self_write(&abs, content);
        if let Err(e) = atomic_write(&abs, content) {
            // Clean up the guard so a later genuine external edit isn't
            // mistaken for our failed-write echo.
            self.echo_guard.forget(&abs);
            return Err(e);
        }

        let new_hash = hash_hex(content);
        self.update_editor_after_save(&abs, &new_hash);
        Ok(WriteOutcome::Written { new_hash })
    }

    /// Create a missing document without replacing any destination entry.
    /// Acknowledge the submitted bytes directly: a later external write must
    /// never become the version the editor believes it just published.
    pub fn create_document(
        &self,
        origin: &Origin,
        path: &Path,
        content: &str,
    ) -> FsResult<DocumentSnapshot> {
        let _publication = self.publication.lock();
        let abs = self.resolve_path(path)?;
        tracing::info!(?origin, path = ?abs, len = content.len(), "create_document");
        // Avoid disturbing a successful prior create's echo registration.
        // This is only a preflight; hard_link below closes the creation race.
        match std::fs::symlink_metadata(&abs) {
            Ok(_) => return Err(FsError::AlreadyExists(abs)),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(source) => return Err(FsError::Io { path: abs, source }),
        }
        self.echo_guard
            .register_self_write(&abs, content.as_bytes());
        if let Err(error) = atomic_create(&abs, content.as_bytes()) {
            self.echo_guard.forget(&abs);
            return Err(error);
        }
        let on_disk_hash = hash_hex(content.as_bytes());
        self.update_editor_after_save(&abs, &on_disk_hash);
        Ok(DocumentSnapshot {
            path: abs,
            content: content.to_owned(),
            on_disk_hash,
        })
    }

    // ── editor state ──────────────────────────────────────────────────

    /// Editor opened the document — remember the on-disk hash the user
    /// is looking at. Idempotent; calling twice with different hashes
    /// just replaces the record.
    pub fn mark_open(&self, path: &Path, on_disk_hash: &str) {
        let Ok(abs) = self.resolve_path(path) else {
            return;
        };
        self.editors.lock().insert(
            abs,
            EditorState {
                last_seen_hash: on_disk_hash.to_string(),
                dirty: false,
            },
        );
    }

    pub fn mark_dirty(&self, path: &Path) {
        if let Ok(abs) = self.resolve_path(path) {
            if let Some(s) = self.editors.lock().get_mut(&abs) {
                s.dirty = true;
            }
        }
    }

    pub fn mark_clean(&self, path: &Path) {
        if let Ok(abs) = self.resolve_path(path) {
            if let Some(s) = self.editors.lock().get_mut(&abs) {
                s.dirty = false;
            }
        }
    }

    pub fn mark_closed(&self, path: &Path) {
        if let Ok(abs) = self.resolve_path(path) {
            self.editors.lock().remove(&abs);
        }
    }

    /// Backend half of B2-3. Returns whether the on-disk bytes have
    /// drifted from what the editor last saw *and* the editor has
    /// unsaved work — in which case auto-reload would silently overwrite
    /// the user. The frontend uses this to decide whether to surface
    /// "reload / keep" to the user.
    pub fn check_conflict(&self, path: &Path) -> ConflictStatus {
        let Ok(abs) = self.resolve_path(path) else {
            return ConflictStatus::Unknown;
        };
        let Some(editor) = self.editors.lock().get(&abs).cloned() else {
            return ConflictStatus::Unknown;
        };
        if !editor.dirty {
            return ConflictStatus::NoConflict;
        }
        let Ok(bytes) = std::fs::read(&abs) else {
            // File deleted externally while editor was dirty — that's a
            // conflict too (the user's about to save into a gap).
            return ConflictStatus::Conflict;
        };
        let current = hash_hex(&bytes);
        if current == editor.last_seen_hash {
            ConflictStatus::NoConflict
        } else {
            ConflictStatus::Conflict
        }
    }

    // ── internals ─────────────────────────────────────────────────────

    fn update_editor_after_save(&self, abs: &Path, new_hash: &str) {
        if let Some(s) = self.editors.lock().get_mut(abs) {
            s.last_seen_hash = new_hash.to_string();
            s.dirty = false;
        }
    }

    /// Resolve `path` to an absolute path inside the vault root. Accepts
    /// either an absolute path that lives under `vault_root`, or a path
    /// relative to it. Rejects anything that resolves outside the root and
    /// every existing symlink component, including ones followed by `..`.
    /// This preflight is not race-safe against concurrent path replacement.
    pub fn resolve_path(&self, path: &Path) -> FsResult<PathBuf> {
        let candidate = if path.is_absolute() {
            path.to_path_buf()
        } else {
            self.vault_root.join(path)
        };

        let normalized = normalize(&candidate);
        let root_normalized = normalize(&self.vault_root);
        if !normalized.starts_with(&root_normalized) {
            return Err(FsError::PathOutsideVault(candidate));
        }
        // Inspect the original components before returning the lexical
        // identity: normalization must not erase a symlink in `link/../a`.
        let relative = candidate
            .strip_prefix(&root_normalized)
            .map_err(|_| FsError::PathOutsideVault(candidate.clone()))?;
        let mut component_path = root_normalized.clone();
        for component in relative.components() {
            match component {
                std::path::Component::ParentDir => {
                    component_path.pop();
                }
                std::path::Component::CurDir => continue,
                other => component_path.push(other.as_os_str()),
            }
            if !component_path.starts_with(&root_normalized) {
                return Err(FsError::PathOutsideVault(candidate));
            }
            match std::fs::symlink_metadata(&component_path) {
                Ok(meta) if meta.file_type().is_symlink() => {
                    return Err(FsError::SymlinkUnsupported(component_path));
                }
                Ok(_) => {}
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
                Err(source) => {
                    return Err(FsError::Io {
                        path: component_path,
                        source,
                    })
                }
            }
        }
        Ok(normalized)
    }
}

fn hash_hex(bytes: &[u8]) -> String {
    let h = blake3::hash(bytes);
    h.to_hex().to_string()
}

/// Canonicalize the existing ancestor and append any not-yet-created tail.
/// A relative missing vault must still produce an absolute identity; trusted
/// root aliases retain platform canonicalization (e.g. macOS `/var/folders`).
pub(crate) fn canonicalize_lenient(p: &Path) -> PathBuf {
    let absolute = if p.is_absolute() {
        p.to_path_buf()
    } else {
        std::env::current_dir().map_or_else(|_| p.to_path_buf(), |cwd| cwd.join(p))
    };
    let absolute = normalize(&absolute);
    let mut ancestor = absolute.as_path();
    let mut tail = Vec::new();
    loop {
        if let Ok(mut canonical) = ancestor.canonicalize() {
            for component in tail.into_iter().rev() {
                canonical.push(component);
            }
            return canonical;
        }
        let Some(name) = ancestor.file_name() else {
            return absolute;
        };
        tail.push(name.to_os_string());
        let Some(parent) = ancestor.parent() else {
            return absolute;
        };
        ancestor = parent;
    }
}

/// Lexical normalization (no I/O, no symlink resolution). Resolves `.`
/// and `..` against the input. We deliberately do *not* `canonicalize`
/// — the destination may not exist yet for a write.
fn normalize(p: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in p.components() {
        use std::path::Component;
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn svc() -> (TempDir, DocumentService) {
        let dir = TempDir::new().unwrap();
        let guard = Arc::new(EchoGuard::new());
        let svc = DocumentService::new(dir.path(), guard);
        (dir, svc)
    }

    #[test]
    fn read_returns_content_and_hash() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"hello").unwrap();
        let snap = s.read_document(Path::new("a.md")).unwrap();
        assert_eq!(snap.path, s.vault_root().join("a.md"));
        assert_eq!(snap.content, "hello");
        assert_eq!(snap.on_disk_hash, hash_hex(b"hello"));
    }

    #[test]
    fn relative_and_absolute_reads_share_canonical_identity() {
        let (_d, s) = svc();
        std::fs::create_dir(s.vault_root().join("sub")).unwrap();
        std::fs::write(s.vault_root().join("sub/a.md"), b"hello").unwrap();
        let relative = s.read_document(Path::new("./sub/../sub/a.md")).unwrap();
        let absolute = s.read_document(&s.vault_root().join("sub/a.md")).unwrap();
        assert_eq!(relative, absolute);
        assert!(relative.path.is_absolute());
    }

    #[test]
    fn relative_missing_vault_root_keeps_absolute_document_identity() {
        let dir = tempfile::tempdir_in(".").unwrap();
        let relative_root = PathBuf::from(dir.path().file_name().unwrap()).join("new-vault");
        assert!(!relative_root.is_absolute());
        let svc = DocumentService::new(relative_root, Arc::new(EchoGuard::new()));
        svc.write_document(&Origin::User, Path::new("a.md"), b"new", None)
            .unwrap();
        let snap = svc.read_document(Path::new("a.md")).unwrap();
        assert!(
            snap.path.is_absolute(),
            "canonical identity must be absolute even for a newly created vault"
        );
        assert_eq!(
            snap.path,
            svc.vault_root().join("a.md").canonicalize().unwrap()
        );
    }

    #[test]
    fn read_missing_file_returns_not_found() {
        let (_d, s) = svc();
        match s.read_document(Path::new("ghost.md")).unwrap_err() {
            FsError::NotFound(_) => {}
            other => panic!("wrong error: {other:?}"),
        }
    }

    #[test]
    fn write_registers_echo_guard_before_writing() {
        let (_d, s) = svc();
        let path = Path::new("note.md");
        let res = s
            .write_document(&Origin::User, path, b"first version", None)
            .unwrap();
        assert!(matches!(res, WriteOutcome::Written { .. }));

        // The on-disk bytes match the guard's stored hash.
        let abs = s.resolve_path(path).unwrap();
        let bytes = std::fs::read(&abs).unwrap();
        assert!(
            s.echo_guard.should_ignore_event(&abs, &bytes),
            "self-write must be detectable as echo right after writing",
        );
    }

    #[test]
    fn write_with_correct_expected_hash_succeeds() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("note.md"), b"old").unwrap();
        let expected = hash_hex(b"old");
        let res = s
            .write_document(&Origin::User, Path::new("note.md"), b"new", Some(&expected))
            .unwrap();
        assert!(matches!(res, WriteOutcome::Written { .. }));
        assert_eq!(
            std::fs::read(s.vault_root().join("note.md")).unwrap(),
            b"new"
        );
    }

    #[test]
    fn write_with_stale_expected_hash_returns_conflict() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("note.md"), b"current").unwrap();
        let stale = hash_hex(b"what i thought was there");
        let res = s
            .write_document(&Origin::User, Path::new("note.md"), b"new", Some(&stale))
            .unwrap();
        match res {
            WriteOutcome::Conflict { current_disk_hash } => {
                assert_eq!(current_disk_hash, hash_hex(b"current"));
            }
            WriteOutcome::Written { .. } => panic!("expected Conflict, got Written"),
        }
        // Disk content untouched.
        assert_eq!(
            std::fs::read(s.vault_root().join("note.md")).unwrap(),
            b"current"
        );
    }

    #[test]
    fn expected_hash_rejects_deleted_document_without_recreating_it() {
        let (_d, s) = svc();
        let path = s.vault_root().join("deleted.md");
        std::fs::write(&path, b"old").unwrap();
        let expected = s
            .read_document(Path::new("deleted.md"))
            .unwrap()
            .on_disk_hash;
        std::fs::remove_file(&path).unwrap();
        assert!(matches!(
            s.write_document(&Origin::User, Path::new("deleted.md"), b"new", Some(&expected)),
            Ok(WriteOutcome::Conflict { current_disk_hash }) if current_disk_hash.is_empty()
        ));
        assert!(
            !path.exists(),
            "optimistic save must not recreate a deleted document"
        );
    }

    #[test]
    fn expected_hash_reports_read_io_failure_before_writing() {
        let (_d, s) = svc();
        let blocker = s.vault_root().join("blocked");
        std::fs::write(&blocker, b"not a directory").unwrap();
        let path = blocker.join("note.md");
        let result = s.write_document(
            &Origin::User,
            Path::new("blocked/note.md"),
            b"new",
            Some("old"),
        );
        assert!(matches!(result, Err(FsError::Io { path: error_path, .. }) if error_path == path));
        let entries = std::fs::read_dir(s.vault_root()).unwrap().count();
        assert_eq!(
            entries, 1,
            "failed precondition must not leave a temporary write"
        );
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_documents_and_existing_parent_components() {
        use std::os::unix::fs::symlink;
        let (_d, s) = svc();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("secret.md"), b"outside").unwrap();
        symlink(
            outside.path().join("secret.md"),
            s.vault_root().join("link.md"),
        )
        .unwrap();
        symlink(outside.path(), s.vault_root().join("linked")).unwrap();
        for path in [
            "link.md",
            "linked/secret.md",
            "linked/new.md",
            "linked/../new.md",
            "missing/../linked/new.md",
        ] {
            assert!(
                s.read_document(Path::new(path)).is_err(),
                "read followed symlink: {path}"
            );
            assert!(
                s.write_document(&Origin::User, Path::new(path), b"clobber", None)
                    .is_err(),
                "write followed symlink: {path}"
            );
        }
        assert_eq!(
            std::fs::read(outside.path().join("secret.md")).unwrap(),
            b"outside"
        );
        assert!(!outside.path().join("new.md").exists());
    }

    #[cfg(unix)]
    #[test]
    fn rejects_canvas_sidecar_below_symlinked_loom_directory() {
        use std::os::unix::fs::symlink;
        let (_d, s) = svc();
        let outside = TempDir::new().unwrap();
        std::fs::write(outside.path().join("canvas.json"), b"original").unwrap();
        symlink(outside.path(), s.vault_root().join(".loom")).unwrap();
        let path = Path::new(".loom/canvas.json");
        assert!(s.read_document(path).is_err());
        assert!(s
            .write_document(&Origin::User, path, b"clobber", None)
            .is_err());
        assert_eq!(
            std::fs::read(outside.path().join("canvas.json")).unwrap(),
            b"original"
        );
    }

    #[test]
    fn path_outside_vault_is_rejected() {
        let (_d, s) = svc();
        let outside = PathBuf::from("../escape.md");
        match s.read_document(&outside) {
            Err(FsError::PathOutsideVault(_)) => {}
            other => panic!("expected PathOutsideVault, got {other:?}"),
        }
    }

    #[test]
    fn check_conflict_returns_unknown_when_no_editor_state() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"x").unwrap();
        assert_eq!(s.check_conflict(Path::new("a.md")), ConflictStatus::Unknown);
    }

    #[test]
    fn check_conflict_clean_editor_is_not_a_conflict() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"x").unwrap();
        s.mark_open(Path::new("a.md"), &hash_hex(b"x"));
        // Disk drifted but editor isn't dirty → safe to reload.
        std::fs::write(s.vault_root().join("a.md"), b"y").unwrap();
        assert_eq!(
            s.check_conflict(Path::new("a.md")),
            ConflictStatus::NoConflict
        );
    }

    #[test]
    fn check_conflict_dirty_editor_and_drifted_disk_is_conflict() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"x").unwrap();
        s.mark_open(Path::new("a.md"), &hash_hex(b"x"));
        s.mark_dirty(Path::new("a.md"));
        std::fs::write(s.vault_root().join("a.md"), b"y").unwrap();
        assert_eq!(
            s.check_conflict(Path::new("a.md")),
            ConflictStatus::Conflict
        );
    }

    #[test]
    fn check_conflict_dirty_editor_but_disk_unchanged_is_not_a_conflict() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"x").unwrap();
        s.mark_open(Path::new("a.md"), &hash_hex(b"x"));
        s.mark_dirty(Path::new("a.md"));
        // Disk same as last-seen.
        assert_eq!(
            s.check_conflict(Path::new("a.md")),
            ConflictStatus::NoConflict
        );
    }

    #[test]
    fn write_clears_dirty_state() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"x").unwrap();
        s.mark_open(Path::new("a.md"), &hash_hex(b"x"));
        s.mark_dirty(Path::new("a.md"));

        s.write_document(&Origin::User, Path::new("a.md"), b"new", None)
            .unwrap();
        assert_eq!(
            s.check_conflict(Path::new("a.md")),
            ConflictStatus::NoConflict
        );
    }

    #[test]
    fn mark_closed_drops_editor_state() {
        let (_d, s) = svc();
        std::fs::write(s.vault_root().join("a.md"), b"x").unwrap();
        s.mark_open(Path::new("a.md"), &hash_hex(b"x"));
        s.mark_closed(Path::new("a.md"));
        assert_eq!(s.check_conflict(Path::new("a.md")), ConflictStatus::Unknown);
    }
}

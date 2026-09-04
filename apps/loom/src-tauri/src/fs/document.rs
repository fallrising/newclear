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

use super::atomic_write::atomic_write;
use super::echo_guard::EchoGuard;
use super::error::{FsError, FsResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentSnapshot {
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
        let abs = self.absolute(path)?;
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
        let abs = self.absolute(path)?;
        tracing::info!(?origin, path = ?abs, len = content.len(), "write_document");

        if let Some(expected) = expected_hash {
            if let Ok(existing) = std::fs::read(&abs) {
                let current = hash_hex(&existing);
                if current != expected {
                    return Ok(WriteOutcome::Conflict {
                        current_disk_hash: current,
                    });
                }
            }
            // If the file doesn't exist yet and the caller expected a
            // hash, the write still proceeds — they may be creating it
            // for the first time and `expected_hash` was their stand-in
            // for "I haven't seen it." A stricter mode can come later.
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

    // ── editor state ──────────────────────────────────────────────────

    /// Editor opened the document — remember the on-disk hash the user
    /// is looking at. Idempotent; calling twice with different hashes
    /// just replaces the record.
    pub fn mark_open(&self, path: &Path, on_disk_hash: &str) {
        let Ok(abs) = self.absolute(path) else {
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
        if let Ok(abs) = self.absolute(path) {
            if let Some(s) = self.editors.lock().get_mut(&abs) {
                s.dirty = true;
            }
        }
    }

    pub fn mark_clean(&self, path: &Path) {
        if let Ok(abs) = self.absolute(path) {
            if let Some(s) = self.editors.lock().get_mut(&abs) {
                s.dirty = false;
            }
        }
    }

    pub fn mark_closed(&self, path: &Path) {
        if let Ok(abs) = self.absolute(path) {
            self.editors.lock().remove(&abs);
        }
    }

    /// Backend half of B2-3. Returns whether the on-disk bytes have
    /// drifted from what the editor last saw *and* the editor has
    /// unsaved work — in which case auto-reload would silently overwrite
    /// the user. The frontend uses this to decide whether to surface
    /// "reload / keep" to the user.
    pub fn check_conflict(&self, path: &Path) -> ConflictStatus {
        let Ok(abs) = self.absolute(path) else {
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
    /// relative to it. Rejects anything that resolves outside the root.
    fn absolute(&self, path: &Path) -> FsResult<PathBuf> {
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
        Ok(normalized)
    }
}

fn hash_hex(bytes: &[u8]) -> String {
    let h = blake3::hash(bytes);
    h.to_hex().to_string()
}

/// Try `canonicalize`; fall back to the input if the path doesn't exist.
/// Used at constructor time so the vault root matches FSEvents-canonical
/// paths even on macOS where `/var/folders/X` → `/private/var/folders/X`.
pub(crate) fn canonicalize_lenient(p: &Path) -> PathBuf {
    p.canonicalize().unwrap_or_else(|_| p.to_path_buf())
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
        assert_eq!(snap.content, "hello");
        assert_eq!(snap.on_disk_hash, hash_hex(b"hello"));
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
        let abs = s.absolute(path).unwrap();
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

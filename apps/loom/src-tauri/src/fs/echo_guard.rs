//! D-7 echo-loop guard.
//!
//! Whenever the app writes a `.md`, two things happen on a Mac:
//!   1. The bytes hit disk.
//!   2. FSEvents fires a `Modified` event for that path some time later
//!      (usually < 100 ms, sometimes much more).
//!
//! Step 2 would normally tell `DocumentService` "the document changed,
//! reload it" — which is exactly what we want for *external* edits but
//! catastrophic for *our own*: it would race the editor's in-flight save
//! and silently re-overwrite the editor buffer. D-7's mitigation:
//!
//! Before writing, register `(path, blake3(bytes))` with a short TTL.
//! When the watcher event arrives, hash the on-disk bytes and look up
//! the path: if the hash matches a live registration, **drop the event**.
//! If it doesn't (the user has since modified the file externally, or
//! someone wrote different content with the same path), the event flows
//! through and the conflict detection further down the pipeline handles
//! it.
//!
//! The guard is content-addressed (not just path-addressed) precisely so
//! it doesn't swallow an external write that happens to land inside the
//! ignore window.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use parking_lot::Mutex;

/// Default TTL for a registered self-write. macOS FSEvents normally
/// delivers within ~100 ms; 500 ms is generous but still short enough
/// that a real external edit landing inside the window can't reasonably
/// produce the same hash.
pub const DEFAULT_ECHO_TTL: Duration = Duration::from_millis(500);

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ContentHash([u8; 32]);

impl ContentHash {
    fn of(bytes: &[u8]) -> Self {
        let h = blake3::hash(bytes);
        Self(*h.as_bytes())
    }
}

struct Entry {
    hash: ContentHash,
    expires_at: Instant,
}

pub struct EchoGuard {
    entries: Mutex<HashMap<PathBuf, Entry>>,
    ttl: Duration,
}

impl EchoGuard {
    #[must_use]
    pub fn new() -> Self {
        Self::with_ttl(DEFAULT_ECHO_TTL)
    }

    #[must_use]
    pub fn with_ttl(ttl: Duration) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            ttl,
        }
    }

    /// Register a self-write *before* the actual write hits disk. Caller
    /// passes the bytes they're about to write; the guard remembers
    /// `blake3(bytes)` for the configured TTL.
    pub fn register_self_write(&self, path: &Path, bytes: &[u8]) {
        let hash = ContentHash::of(bytes);
        let expires_at = Instant::now() + self.ttl;
        let mut entries = self.entries.lock();
        sweep_expired(&mut entries);
        entries.insert(path.to_path_buf(), Entry { hash, expires_at });
    }

    /// Should the watcher event for `path` (with the given on-disk bytes)
    /// be **dropped** as a self-write echo?
    ///
    /// Returns `true` iff there's a live registration whose hash matches.
    /// Matches do **not** consume the registration; one self-write can
    /// produce multiple observable events on macOS (Created + Modified +
    /// possibly more), and a periodic reconcile scan may re-detect the
    /// same file later — both need to find the same live entry. TTL
    /// (default 500 ms) is the only mechanism that drops the entry, and
    /// is short enough that a true external write with the same bytes is
    /// vanishingly unlikely to slip into the window.
    pub fn should_ignore_event(&self, path: &Path, on_disk_bytes: &[u8]) -> bool {
        let hash = ContentHash::of(on_disk_bytes);
        let mut entries = self.entries.lock();
        sweep_expired(&mut entries);
        entries.get(path).is_some_and(|entry| entry.hash == hash)
    }

    /// Drop the registration for `path` without checking. Useful when a
    /// write fails after registration and the caller wants to make sure
    /// a stale entry doesn't suppress the next real event.
    pub fn forget(&self, path: &Path) {
        self.entries.lock().remove(path);
    }

    /// Current count of live (un-expired) registrations. Test hook only.
    #[cfg(test)]
    pub fn live_count(&self) -> usize {
        let mut entries = self.entries.lock();
        sweep_expired(&mut entries);
        entries.len()
    }
}

impl Default for EchoGuard {
    fn default() -> Self {
        Self::new()
    }
}

fn sweep_expired(entries: &mut HashMap<PathBuf, Entry>) {
    let now = Instant::now();
    entries.retain(|_, e| e.expires_at > now);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread::sleep;

    fn p(s: &str) -> PathBuf {
        PathBuf::from(s)
    }

    #[test]
    fn matching_hash_within_ttl_is_ignored() {
        let g = EchoGuard::new();
        g.register_self_write(&p("/v/a.md"), b"hello");
        assert!(g.should_ignore_event(&p("/v/a.md"), b"hello"));
    }

    #[test]
    fn matching_hash_is_repeatable_within_ttl() {
        // macOS produces multiple events for one rename-based write
        // (Created + Modified, sometimes more), and reconcile may detect
        // the same file later — every check inside the TTL must continue
        // to suppress. Only the TTL clears the entry.
        let g = EchoGuard::new();
        g.register_self_write(&p("/v/a.md"), b"hello");
        assert!(g.should_ignore_event(&p("/v/a.md"), b"hello"));
        assert!(g.should_ignore_event(&p("/v/a.md"), b"hello"));
        assert!(g.should_ignore_event(&p("/v/a.md"), b"hello"));
    }

    #[test]
    fn different_content_is_not_ignored() {
        // External writer happens to clobber inside the window with
        // different bytes — that is a real external edit, not echo.
        let g = EchoGuard::new();
        g.register_self_write(&p("/v/a.md"), b"hello");
        assert!(!g.should_ignore_event(&p("/v/a.md"), b"hello, world"));
        // Our genuine self-write echo still matches within the TTL.
        assert!(g.should_ignore_event(&p("/v/a.md"), b"hello"));
    }

    #[test]
    fn different_path_is_not_ignored() {
        let g = EchoGuard::new();
        g.register_self_write(&p("/v/a.md"), b"hello");
        assert!(!g.should_ignore_event(&p("/v/b.md"), b"hello"));
    }

    #[test]
    fn expired_registration_is_not_ignored() {
        let g = EchoGuard::with_ttl(Duration::from_millis(10));
        g.register_self_write(&p("/v/a.md"), b"hello");
        sleep(Duration::from_millis(30));
        assert!(!g.should_ignore_event(&p("/v/a.md"), b"hello"));
        assert_eq!(
            g.live_count(),
            0,
            "expired entries are swept on next access"
        );
    }

    #[test]
    fn forget_drops_registration() {
        let g = EchoGuard::new();
        g.register_self_write(&p("/v/a.md"), b"hello");
        g.forget(&p("/v/a.md"));
        assert!(!g.should_ignore_event(&p("/v/a.md"), b"hello"));
    }

    #[test]
    fn re_register_replaces_previous_hash() {
        // Save twice in quick succession with different content. Only the
        // most recent hash should match.
        let g = EchoGuard::new();
        g.register_self_write(&p("/v/a.md"), b"first");
        g.register_self_write(&p("/v/a.md"), b"second");
        assert!(!g.should_ignore_event(&p("/v/a.md"), b"first"));
        assert!(g.should_ignore_event(&p("/v/a.md"), b"second"));
    }

    #[test]
    fn live_count_reflects_inserts_and_expiry() {
        let g = EchoGuard::with_ttl(Duration::from_millis(20));
        g.register_self_write(&p("/v/a.md"), b"a");
        g.register_self_write(&p("/v/b.md"), b"b");
        assert_eq!(g.live_count(), 2);
        sleep(Duration::from_millis(40));
        assert_eq!(g.live_count(), 0);
    }
}

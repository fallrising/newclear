//! Crash-safe write of a `.md` document. The pattern:
//!
//!   1. Write the new bytes to `<name>.tmp.<rand>` in the same directory.
//!   2. `fsync` the temp file so its bytes are durable.
//!   3. Atomically `rename` over the destination for saves, or create a
//!      hard link for create-only publication. On POSIX rename is a
//!      single inode swap; readers see either the old or the new file,
//!      never a half-written one.
//!
//! Implementation detail: stays sync. The caller (`DocumentService`) wraps
//! it in `spawn_blocking` so the async runtime stays responsive even when
//! fsync stalls.

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::Path;

use super::error::{FsError, FsResult};

/// Replace the destination atomically (ordinary saves).
pub fn atomic_write(path: &Path, bytes: &[u8]) -> FsResult<()> {
    atomic_publish(path, bytes, false)
}

/// Publish complete bytes only if no destination entry exists. Hard-link
/// creation is the atomic no-replace operation; unsupported filesystems fail
/// without any overwrite fallback.
pub fn atomic_create(path: &Path, bytes: &[u8]) -> FsResult<()> {
    atomic_publish(path, bytes, true)
}

/// Own a temporary name only after create_new succeeds. Every exit (including
/// write/fsync/publication failure) removes it; a UUID collision is never ours.
struct TempPath(std::path::PathBuf);

impl Drop for TempPath {
    fn drop(&mut self) {
        if let Err(error) = std::fs::remove_file(&self.0) {
            if error.kind() != std::io::ErrorKind::NotFound {
                tracing::warn!(path = ?self.0, %error, "temporary document cleanup failed");
            }
        }
    }
}

fn atomic_publish(path: &Path, bytes: &[u8], create_only: bool) -> FsResult<()> {
    let dir = path.parent().ok_or_else(|| FsError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent directory"),
    })?;
    std::fs::create_dir_all(dir).map_err(|source| FsError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let tmp_path = dir.join(format!(
        ".{}.tmp.{}",
        path.file_name()
            .map_or_else(|| "doc".into(), |s| s.to_string_lossy().into_owned()),
        uuid::Uuid::now_v7(),
    ));
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp_path)
        .map_err(|source| FsError::Io {
            path: tmp_path.clone(),
            source,
        })?;
    let temp = TempPath(tmp_path);
    let written = file.write_all(bytes).and_then(|()| file.sync_all());
    // Close before cleanup or publication, including on write/fsync error.
    drop(file);
    written.map_err(|source| FsError::Io {
        path: temp.0.clone(),
        source,
    })?;

    if create_only {
        std::fs::hard_link(&temp.0, path).map_err(|source| {
            if source.kind() == std::io::ErrorKind::AlreadyExists {
                FsError::AlreadyExists(path.to_path_buf())
            } else {
                FsError::Io {
                    path: path.to_path_buf(),
                    source,
                }
            }
        })?;
    } else {
        std::fs::rename(&temp.0, path).map_err(|source| FsError::Io {
            path: path.to_path_buf(),
            source,
        })?;
    }
    drop(temp);
    // Best-effort durability for both publication and temporary-name removal.
    if let Ok(dir_handle) = File::open(dir) {
        let _ = dir_handle.sync_all();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn create_collision_cleans_temporary_file_and_preserves_destination() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, b"external winner").unwrap();
        assert!(matches!(
            atomic_create(&path, b"unsaved edits"),
            Err(FsError::AlreadyExists(_))
        ));
        assert_eq!(std::fs::read(&path).unwrap(), b"external winner");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn create_directory_collision_cleans_temporary_file() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("directory.md");
        std::fs::create_dir(&path).unwrap();
        assert!(atomic_create(&path, b"unsaved edits").is_err());
        assert!(path.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn temporary_owner_cleans_up_when_staging_returns_an_error() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join(".note.md.tmp.test");
        let stage = || -> std::io::Result<()> {
            std::fs::write(&path, b"partially staged")?;
            let _temp = TempPath(path.clone());
            Err(std::io::Error::other("injected staging failure"))
        };
        assert!(stage().is_err());
        assert!(!path.exists());
    }

    #[test]
    fn writes_bytes_to_path() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        atomic_write(&path, b"hello world").unwrap();
        let read_back = std::fs::read(&path).unwrap();
        assert_eq!(read_back, b"hello world");
    }

    #[test]
    fn overwrites_existing_file_atomically() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("note.md");
        std::fs::write(&path, b"old contents").unwrap();
        atomic_write(&path, b"new contents").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new contents");
        // No leftover temp files.
        let leftovers: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().contains(".tmp."))
            .collect();
        assert!(leftovers.is_empty(), "temp files leaked: {leftovers:?}");
    }

    #[test]
    fn creates_parent_directories_if_missing() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("subdir/nested/note.md");
        atomic_write(&path, b"deep").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"deep");
    }
}

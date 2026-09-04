//! Crash-safe write of a `.md` document. The pattern:
//!
//!   1. Write the new bytes to `<name>.tmp.<rand>` in the same directory.
//!   2. `fsync` the temp file so its bytes are durable.
//!   3. Atomically `rename` over the destination — on POSIX this is a
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

pub fn atomic_write(path: &Path, bytes: &[u8]) -> FsResult<()> {
    let dir = path.parent().ok_or_else(|| FsError::Io {
        path: path.to_path_buf(),
        source: std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent directory"),
    })?;
    if !dir.exists() {
        std::fs::create_dir_all(dir).map_err(|e| FsError::Io {
            path: dir.to_path_buf(),
            source: e,
        })?;
    }

    let tmp_path = dir.join(format!(
        ".{}.tmp.{}",
        path.file_name()
            .map_or_else(|| "doc".into(), |s| s.to_string_lossy().into_owned()),
        uuid::Uuid::now_v7(),
    ));

    // Write + fsync the temp file. Drop the handle before rename so Windows
    // (future) doesn't refuse the rename due to an open file.
    {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp_path)
            .map_err(|e| FsError::Io {
                path: tmp_path.clone(),
                source: e,
            })?;
        file.write_all(bytes).map_err(|e| FsError::Io {
            path: tmp_path.clone(),
            source: e,
        })?;
        file.sync_all().map_err(|e| FsError::Io {
            path: tmp_path.clone(),
            source: e,
        })?;
    }

    std::fs::rename(&tmp_path, path).map_err(|e| {
        // Best-effort cleanup of the orphaned temp file; ignore failures —
        // the caller already has a real error to surface.
        let _ = std::fs::remove_file(&tmp_path);
        FsError::Io {
            path: path.to_path_buf(),
            source: e,
        }
    })?;

    // fsync the directory entry so the rename itself is durable on macOS.
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

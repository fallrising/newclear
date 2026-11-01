use super::*;
use std::{fs, io::Write, os::unix::fs::symlink};
fn temp() -> std::path::PathBuf {
    let path = std::env::temp_dir().join(format!("guard-{}", uuid::Uuid::now_v7()));
    fs::create_dir(&path).unwrap();
    // System temp paths may contain aliases (for example macOS /var).
    // Match the canonical root supplied by production workspace admission.
    fs::canonicalize(path).unwrap()
}
#[test]
fn no_follow_rejects_static_and_intermediate_swaps() {
    let root = temp();
    let outside = temp();
    fs::create_dir(root.join("nested")).unwrap();
    fs::write(root.join("nested/note.md"), "allowed").unwrap();
    fs::write(outside.join("note.md"), "OUTSIDE-SECRET").unwrap();
    let guard = Guard::open(&root).unwrap();
    let result = guard.read_with_hook(
        "nested/note.md",
        100,
        AppErrorCode::DocumentTooLarge,
        |attempt, phase| {
            if attempt == 0 && phase == ReadPhase::BeforeFinalOpen {
                fs::rename(root.join("nested"), root.join("held")).unwrap();
                symlink(&outside, root.join("nested")).unwrap();
            }
        },
    );
    assert!(result.is_err());
    assert_eq!(
        guard
            .read("nested/note.md", 100, AppErrorCode::DocumentTooLarge)
            .err()
            .unwrap()
            .code,
        AppErrorCode::SymlinkForbidden
    );
}
#[test]
fn final_swap_never_returns_outside_bytes() {
    let root = temp();
    let outside = temp();
    fs::write(root.join("note.md"), "allowed").unwrap();
    fs::write(outside.join("secret.md"), "OUTSIDE-SECRET").unwrap();
    let guard = Guard::open(&root).unwrap();
    let result = guard.read_with_hook(
        "note.md",
        100,
        AppErrorCode::DocumentTooLarge,
        |attempt, phase| {
            if attempt == 0 && phase == ReadPhase::AfterRead {
                fs::rename(root.join("note.md"), root.join("old.md")).unwrap();
                symlink(outside.join("secret.md"), root.join("note.md")).unwrap();
            }
        },
    );
    assert!(result.is_err());
}
#[test]
fn instability_retries_only_twice_and_growth_is_bounded() {
    let root = temp();
    fs::write(root.join("note.md"), "a").unwrap();
    let guard = Guard::open(&root).unwrap();
    let mut reads = 0;
    let result = guard.read_with_hook(
        "note.md",
        100,
        AppErrorCode::DocumentTooLarge,
        |_, phase| {
            if phase == ReadPhase::AfterRead {
                reads += 1;
                let mut file = std::fs::OpenOptions::new()
                    .append(true)
                    .open(root.join("note.md"))
                    .unwrap();
                file.write_all(b"x").unwrap();
            }
        },
    );
    assert!(result.err().unwrap().retryable);
    assert_eq!(reads, 3);
    let result = guard.read_with_hook("note.md", 10, AppErrorCode::DocumentTooLarge, |_, phase| {
        if phase == ReadPhase::AfterRead {
            fs::write(root.join("note.md"), [0_u8; 11]).unwrap();
        }
    });
    assert_eq!(result.err().unwrap().code, AppErrorCode::DocumentTooLarge);
}
#[test]
fn nonregular_fifo_rejected_without_blocking() {
    let root = temp();
    let guard = Guard::open(&root).unwrap();
    assert!(
        std::process::Command::new("mkfifo")
            .args(["-m", "600"])
            .arg(root.join("pipe"))
            .status()
            .unwrap()
            .success()
    );
    assert_eq!(
        guard
            .read("pipe", 100, AppErrorCode::DocumentTooLarge)
            .err()
            .unwrap()
            .code,
        AppErrorCode::UnsupportedMediaType
    );
}

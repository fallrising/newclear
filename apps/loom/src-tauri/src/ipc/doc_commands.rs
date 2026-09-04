//! Tauri commands fronting B2's `DocumentService`.
//!
//! Shape mirrors `DocumentService` 1:1; only the JSON-friendly DTOs and
//! the path-string→PathBuf conversion live here. Conflict resolution is
//! NOT done here — the UI calls `doc_check_conflict` after seeing a
//! `FsChanged::Modified` and decides what to do (B2-3 / plan §6 option A).

// Tauri's `#[command]` macro deserializes owned args directly.
#![allow(clippy::needless_pass_by_value)]

use std::path::{Path, PathBuf};
use std::sync::Arc;

use tauri::State;

use loom_contracts::Origin;

use crate::fs::{ConflictStatus, DocumentService, FsError, WriteOutcome};

/// State the C2 frontend reaches into. Held alongside the PTY `AppState`
/// in `lib.rs::run`; both are managed in the same Tauri app.
pub struct DocAppState {
    pub svc: Arc<DocumentService>,
    pub vault_root: PathBuf,
}

#[derive(serde::Serialize)]
pub struct DocSnapshotDto {
    pub content: String,
    pub on_disk_hash: String,
}

#[derive(serde::Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum WriteOutcomeDto {
    Written { new_hash: String },
    Conflict { current_disk_hash: String },
}

impl From<WriteOutcome> for WriteOutcomeDto {
    fn from(value: WriteOutcome) -> Self {
        match value {
            WriteOutcome::Written { new_hash } => Self::Written { new_hash },
            WriteOutcome::Conflict { current_disk_hash } => Self::Conflict { current_disk_hash },
        }
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictStatusDto {
    Unknown,
    NoConflict,
    Conflict,
}

impl From<ConflictStatus> for ConflictStatusDto {
    fn from(value: ConflictStatus) -> Self {
        match value {
            ConflictStatus::Unknown => Self::Unknown,
            ConflictStatus::NoConflict => Self::NoConflict,
            ConflictStatus::Conflict => Self::Conflict,
        }
    }
}

#[tauri::command]
pub fn vault_root(state: State<'_, DocAppState>) -> String {
    state.vault_root.to_string_lossy().into_owned()
}

#[tauri::command]
pub fn doc_read(state: State<'_, DocAppState>, path: String) -> Result<DocSnapshotDto, String> {
    state
        .svc
        .read_document(Path::new(&path))
        .map(|snap| DocSnapshotDto {
            content: snap.content,
            on_disk_hash: snap.on_disk_hash,
        })
        .map_err(fs_err_string)
}

#[tauri::command]
pub fn doc_write(
    state: State<'_, DocAppState>,
    origin: Origin,
    path: String,
    content: String,
    expected_hash: Option<String>,
) -> Result<WriteOutcomeDto, String> {
    state
        .svc
        .write_document(
            &origin,
            Path::new(&path),
            content.as_bytes(),
            expected_hash.as_deref(),
        )
        .map(Into::into)
        .map_err(fs_err_string)
}

#[tauri::command]
pub fn doc_open(state: State<'_, DocAppState>, path: String, on_disk_hash: String) {
    state.svc.mark_open(Path::new(&path), &on_disk_hash);
}

#[tauri::command]
pub fn doc_close(state: State<'_, DocAppState>, path: String) {
    state.svc.mark_closed(Path::new(&path));
}

#[tauri::command]
pub fn doc_mark_dirty(state: State<'_, DocAppState>, path: String) {
    state.svc.mark_dirty(Path::new(&path));
}

#[tauri::command]
pub fn doc_mark_clean(state: State<'_, DocAppState>, path: String) {
    state.svc.mark_clean(Path::new(&path));
}

#[tauri::command]
pub fn doc_check_conflict(state: State<'_, DocAppState>, path: String) -> ConflictStatusDto {
    state.svc.check_conflict(Path::new(&path)).into()
}

// ── Canvas sidecar (.loom/canvas.json) ──────────────────────────────────
//
// D-4 sidecar: layout + edges are the *main* data on disk; SQLite is
// downstream cache. The frontend owns the JSON schema (it knows
// react-flow's node/edge shape best); the backend just streams strings
// to and from the right path under the vault. The fs_watcher's
// resulting FsChanged events for `.loom/canvas.json` are ignored by
// the current frontend listeners (path mismatch) — no echo guard
// registration needed here.

const CANVAS_RELATIVE_PATH: &str = ".loom/canvas.json";

#[tauri::command]
pub fn canvas_read(state: State<'_, DocAppState>) -> Result<Option<String>, String> {
    let path = state.vault_root.join(CANVAS_RELATIVE_PATH);
    match std::fs::read_to_string(&path) {
        Ok(s) => Ok(Some(s)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("read {}: {}", path.display(), e)),
    }
}

#[tauri::command]
pub fn canvas_write(state: State<'_, DocAppState>, content: String) -> Result<(), String> {
    let path = state.vault_root.join(CANVAS_RELATIVE_PATH);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("create {}: {}", parent.display(), e))?;
    }
    crate::fs::atomic_write::atomic_write(&path, content.as_bytes()).map_err(fs_err_string)
}

fn fs_err_string(e: FsError) -> String {
    e.to_string()
}

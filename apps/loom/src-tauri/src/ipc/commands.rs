//! Tauri command surface.
//!
//! Every state-changing command takes `origin: Origin` from the caller —
//! today the frontend only ever sends `Origin::User`, but the contract
//! discipline (D-3) is kept so plugins / remote ingress can plug in
//! without an envelope change.
//!
//! Reads (`list_sessions`) take no origin.

// Tauri's `#[command]` macro deserializes JSON args directly into the fn's
// parameters, so they must be owned. clippy::needless_pass_by_value would
// fire on every command otherwise.
#![allow(clippy::needless_pass_by_value)]

use std::path::PathBuf;
use std::sync::Arc;

use tauri::{Manager, State};

use crate::pty::{LocalState, PtyError, PtyManager, SpawnConfig};
use loom_contracts::{Origin, SessionId, SessionMeta, StreamId};

/// State stashed by `run()` and pulled into every command.
pub struct AppState {
    pub pty: Arc<PtyManager>,
}

// pty_spawn and pty_subscribe are `async fn` so Tauri awaits them on the
// global async runtime (which `run()` configures to be a tokio runtime).
// That is the runtime context PtySession's internal `tokio::spawn` /
// `tokio::task::spawn_blocking` calls require; calling them from a plain
// sync command panics with "no reactor running."
#[tauri::command]
pub async fn pty_spawn(
    state: State<'_, AppState>,
    origin: Origin,
    cwd: String,
    cmd: Option<String>,
    shell: Option<String>,
    cols: Option<u16>,
    rows: Option<u16>,
) -> Result<SessionId, String> {
    let shell =
        shell.unwrap_or_else(|| std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into()));
    let config = SpawnConfig {
        cwd: PathBuf::from(cwd),
        cmd,
        shell,
        cols: cols.unwrap_or(120),
        rows: rows.unwrap_or(30),
    };
    state
        .pty
        .spawn(&origin, config)
        .map_err(|e: PtyError| e.to_string())
}

#[tauri::command]
pub fn pty_kill(
    state: State<'_, AppState>,
    origin: Origin,
    session_id: SessionId,
) -> Result<(), String> {
    state
        .pty
        .kill(&origin, &session_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(
    state: State<'_, AppState>,
    origin: Origin,
    session_id: SessionId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state
        .pty
        .resize(&origin, &session_id, cols, rows)
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_write_stdin(
    state: State<'_, AppState>,
    origin: Origin,
    session_id: SessionId,
    data: String,
) -> Result<(), String> {
    state
        .pty
        .write_stdin(&origin, &session_id, data.as_bytes())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn pty_subscribe(
    state: State<'_, AppState>,
    session_id: SessionId,
) -> Result<StreamId, String> {
    state.pty.subscribe(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_detach(state: State<'_, AppState>, session_id: SessionId) -> Result<(), String> {
    state.pty.detach(&session_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_list_sessions(state: State<'_, AppState>) -> Vec<SessionId> {
    state.pty.list_sessions()
}

/// Default cwd for the spawn dialog. Vertical slice convenience.
#[tauri::command]
pub fn home_dir() -> String {
    std::env::var("HOME").unwrap_or_else(|_| "/".into())
}

/// Returns metadata for a session if it exists. The vertical slice's UI
/// uses this to pull live cwd/cmd/state for the header. Persistence is
/// not consulted here; this is purely the in-memory manager view.
#[tauri::command]
pub fn pty_session_meta(state: State<'_, AppState>, session_id: SessionId) -> Option<SessionMeta> {
    let pty = state.pty.get_session(&session_id)?;
    let info = pty.spawn_info().clone();
    Some(SessionMeta {
        id: session_id,
        cwd: info.cwd.to_string_lossy().into_owned(),
        cmd: info.cmd,
        shell: info.shell,
        state: match pty.local_state() {
            LocalState::Running => loom_contracts::SessionState::Active,
            LocalState::Exited { code } => loom_contracts::SessionState::Exited { code },
        },
        last_activity_ms: 0,
    })
}

const DEFAULT_SCROLLBACK_CHARS: u32 = 8_000;

#[tauri::command]
pub fn pty_scrollback(
    state: State<'_, AppState>,
    session_id: SessionId,
    max_chars: Option<u32>,
) -> Result<String, String> {
    let cap = max_chars.unwrap_or(DEFAULT_SCROLLBACK_CHARS) as usize;
    state
        .pty
        .scrollback(&session_id, cap)
        .map_err(|e| e.to_string())
}

// `tauri::generate_handler!` produces a closure whose type only the macro
// site can express, so the actual `invoke_handler(generate_handler![…])`
// call lives in `lib.rs::run()` next to the builder. The individual
// `#[tauri::command]` fns above are what that macro names.

/// Convenience: stash `AppState` on the running app (called from `run()`).
pub fn manage(app: &tauri::AppHandle, state: AppState) {
    app.manage(state);
}

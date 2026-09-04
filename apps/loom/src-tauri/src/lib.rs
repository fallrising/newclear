//! `loom-core` — backend runtime for Loom. Shared by all B-tracks.
//!
//! Each B-track owns one or more module subtrees declared below. The rule
//! for editing this file is **append-only**: a track adds its own `pub mod
//! xxx;` line and never touches another track's line. See `README.md` for
//! the full coordination rule.

// B1 (P0 risk #1 — re-attach fidelity)
pub mod pty;
pub mod session_store;

// B2 (P0 risk #2 — fs echo-loop / save-doesn't-overwrite)
pub mod fs;

// B4 (AI bridge — Anthropic streaming completion)
pub mod ai;

// V (vertical slice): Tauri shell wiring B1/B2 to a real window.
pub mod ipc;

// B3 appends `pub mod mcp;` and `pub mod gate;`.
// D1 appends `pub mod plugin;`.

use std::sync::Arc;

/// Entry point invoked by `src/main.rs`. Initializes tracing, the
/// `PtyManager` with Tauri-backed sinks, and starts the desktop shell.
pub fn run() {
    init_tracing();

    // PtySession internally calls `tokio::task::spawn_blocking` and
    // `tokio::spawn`. Tauri commands run on Tauri's async runtime by
    // default, which isn't tokio — so we install a multi-threaded tokio
    // runtime as Tauri's runtime up-front. The runtime is intentionally
    // leaked: it must outlive the entire app.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("build tokio runtime");
    let tokio_handle = rt.handle().clone();
    tauri::async_runtime::set(rt.handle().clone());
    std::mem::forget(rt);

    tauri::Builder::default()
        .setup(move |app| {
            use tauri::Manager;
            // FsWatcher::start spawns tokio tasks; setup runs on Tauri's
            // own thread which is outside any tokio context. Enter the
            // global tokio runtime for the duration of setup so the spawns
            // find their reactor.
            let _guard = tokio_handle.enter();

            let handle = app.handle().clone();
            let batch_sink = Arc::new(ipc::TauriBatchSink::new(handle.clone()));
            let event_sink = Arc::new(ipc::TauriEventSink::new(handle.clone()));
            let pty = Arc::new(pty::PtyManager::new(batch_sink, event_sink.clone()));
            handle.manage(ipc::commands::AppState { pty });

            // C2 surface needs B2 wired up: a vault root, the document
            // service, and a watcher that pushes FsChanged to the same
            // event sink the frontend already listens on (`loom:event`).
            let vault_root = resolve_vault_root();
            ensure_vault_dir(&vault_root);
            let echo_guard = Arc::new(fs::EchoGuard::new());
            let doc_svc = Arc::new(fs::DocumentService::new(
                vault_root.clone(),
                echo_guard.clone(),
            ));
            match fs::FsWatcher::start(vault_root.clone(), echo_guard, event_sink) {
                Ok(watcher) => {
                    // Keep the watcher alive for the app's lifetime — its
                    // Drop aborts the debouncer + reconcile tasks.
                    handle.manage(WatcherHandle(watcher));
                }
                Err(e) => {
                    tracing::warn!(error = %e, "fs watcher failed to start; doc surface still usable but no fs_changed events");
                }
            }
            handle.manage(ipc::doc_commands::DocAppState {
                svc: doc_svc,
                vault_root,
            });
            handle.manage(ipc::ai_commands::AiAppState {
                svc: Arc::new(ai::AiService::new()),
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            ipc::commands::pty_spawn,
            ipc::commands::pty_kill,
            ipc::commands::pty_resize,
            ipc::commands::pty_write_stdin,
            ipc::commands::pty_subscribe,
            ipc::commands::pty_detach,
            ipc::commands::pty_list_sessions,
            ipc::commands::pty_session_meta,
            ipc::commands::pty_scrollback,
            ipc::commands::home_dir,
            ipc::doc_commands::vault_root,
            ipc::doc_commands::doc_read,
            ipc::doc_commands::doc_write,
            ipc::doc_commands::doc_open,
            ipc::doc_commands::doc_close,
            ipc::doc_commands::doc_mark_dirty,
            ipc::doc_commands::doc_mark_clean,
            ipc::doc_commands::doc_check_conflict,
            ipc::doc_commands::canvas_read,
            ipc::doc_commands::canvas_write,
            ipc::ai_commands::ai_status,
            ipc::ai_commands::ai_ask,
            ipc::ai_commands::ai_cancel,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Loom");
}

/// Wrap the watcher so we can `manage` it (Tauri requires `Send + Sync`).
/// We never read it back; the wrapper just keeps the watcher alive.
struct WatcherHandle(#[allow(dead_code)] fs::FsWatcher);

const VAULT_ENV: &str = "LOOM_VAULT";

fn resolve_vault_root() -> std::path::PathBuf {
    if let Ok(raw) = std::env::var(VAULT_ENV) {
        if !raw.is_empty() {
            return std::path::PathBuf::from(raw);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/".into());
    std::path::PathBuf::from(home).join("loom-vault")
}

fn ensure_vault_dir(p: &std::path::Path) {
    if let Err(e) = std::fs::create_dir_all(p) {
        tracing::warn!(path = ?p, error = %e, "could not create vault dir; reads/writes will surface errors at use time");
    }
}

fn init_tracing() {
    use tracing_subscriber::EnvFilter;
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let _ = tracing_subscriber::fmt().with_env_filter(filter).try_init();
}

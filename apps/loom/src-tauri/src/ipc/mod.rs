//! Tauri IPC surface — Loom's vertical slice.
//!
//! This is the only place that knows about `tauri::AppHandle` from the
//! backend's side. It exists to keep the rest of `loom-core` (pty, fs,
//! session_store, …) free of UI framework imports — those modules can
//! still be exercised by integration tests and by the CLI examples
//! without ever pulling in webview machinery.

pub mod ai_commands;
pub mod commands;
pub mod doc_commands;
pub mod sinks;

pub use sinks::{TauriBatchSink, TauriEventSink};

//! Tauri commands fronting the AI bridge.
//!
//! Streaming model: each completion emits `AiChunk` events on the
//! `ai:event` channel (started → text* → done | error | cancelled).
//! The frontend listens for matching `request_id` to assemble a stream.

#![allow(clippy::needless_pass_by_value)]

use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};

use crate::ai::provider::PinnedContext;
use crate::ai::{AiChunk, AiRequestId, AiService, AiStatus};

pub const AI_EVENT: &str = "ai:event";

pub struct AiAppState {
    pub svc: Arc<AiService>,
}

#[tauri::command]
pub fn ai_status(_state: State<'_, AiAppState>) -> AiStatus {
    AiService::status()
}

#[tauri::command]
pub async fn ai_ask(
    app: AppHandle,
    state: State<'_, AiAppState>,
    prompt: String,
    context_doc: Option<String>,
    pinned_context: Option<Vec<PinnedContext>>,
) -> Result<AiRequestId, String> {
    let request_id = format!("ai-{}", uuid::Uuid::now_v7());
    let svc = state.svc.clone();
    let app_handle = app.clone();
    let req_for_task = request_id.clone();
    let pinned = pinned_context.unwrap_or_default();
    tokio::spawn(async move {
        let app_for_emit = app_handle.clone();
        let req_for_terminal = req_for_task.clone();
        let result = svc
            .run(req_for_task, prompt, context_doc, pinned, move |chunk| {
                if let Err(e) = app_for_emit.emit(AI_EVENT, &chunk) {
                    tracing::warn!(error = %e, "ai chunk emit failed");
                }
            })
            .await;
        if let Err(e) = result {
            let msg = e.to_string();
            let terminal = match e {
                crate::ai::AiError::Cancelled(_) => AiChunk::Cancelled {
                    request_id: req_for_terminal,
                },
                _ => AiChunk::Error {
                    request_id: req_for_terminal,
                    message: msg,
                },
            };
            if let Err(e) = app_handle.emit(AI_EVENT, &terminal) {
                tracing::warn!(error = %e, "ai terminal emit failed");
            }
        }
    });
    Ok(request_id)
}

#[tauri::command]
pub fn ai_cancel(state: State<'_, AiAppState>, request_id: String) -> bool {
    state.svc.cancel(&request_id)
}

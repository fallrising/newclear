use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use axum::body::Body;
use axum::http::{HeaderMap, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use bytes::Bytes;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::Value;
use tokio::time::{timeout, Duration};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use crate::claude::{self, StreamTranslateState};
use crate::cooldown::{cooldown_secs_for_status, CooldownMap};
use crate::error::{AppError, AppResult};
use crate::prompt_cache;
use crate::providers::{self, UpstreamFormat};
use crate::responses;
use crate::store::{ResolvedTarget, Store};
use crate::token_saver;
use serde_json::json;

#[derive(Clone)]
pub struct ProxyState {
    pub http: Client,
    pub store: Store,
    pub cooldown: CooldownMap,
    /// Global counter for round-robin start offsets.
    pub rr_counter: Arc<AtomicU64>,
    pub sse_stall_secs: u64,
    pub token_saver: bool,
    pub token_saver_max_chars: usize,
    /// Operator-only `provider=url` upstream overrides (see `providers::base_url_allowed`).
    pub provider_base_overrides: Vec<(String, String)>,
    /// Local Claude Code CLI runs for the `claude` provider.
    pub claude_code: crate::claude_code::ClaudeCode,
    /// Local Cursor Agent CLI runs for the `cursor` provider.
    pub cursor_cli: crate::cursor_cli::CursorCli,
}

/// Which protocol the client speaks (for converting Claude Code output).
#[derive(Clone, Copy)]
enum ClientProto {
    Chat,
    Anthropic,
    Responses,
}

enum ClaudeOutcome {
    Stream(crate::claude_code::ClaudeRun, StreamMode),
    Done(Response),
}

/// Targets answered by a local CLI (Claude Code, Cursor Agent) instead of HTTP.
fn is_cli_target(target: &ResolvedTarget) -> bool {
    cli_format(target).is_some()
}

fn cli_format(target: &ResolvedTarget) -> Option<UpstreamFormat> {
    provider_id_for(target)
        .as_deref()
        .and_then(providers::resolve)
        .map(|p| p.format)
        .filter(|f| matches!(f, UpstreamFormat::ClaudeCode | UpstreamFormat::CursorCli))
}

/// Mark cooldown and log a failed attempt. Diagnostic text belongs to the caller response,
/// never the usage ledger: upstream/CLI bodies may contain credentials or request content.
fn record_failure(
    state: &ProxyState,
    public_model: &str,
    target: &ResolvedTarget,
    e: &UpstreamAttemptError,
    start: Instant,
) {
    let secs = cooldown_secs_for_status(e.status);
    if secs > 0 {
        state.cooldown.mark(&target.connection.id, secs);
    }
    let _ = state.store.log_usage(
        Some(public_model),
        Some(&target.connection.id),
        Some(e.status as i64),
        Some(start.elapsed().as_millis() as i64),
        Some("upstream_attempt_failed"),
        None,
        None,
        None,
    );
}

/// One target answered by a local CLI (Claude Code or Cursor Agent). `chat_body` is the request in
/// chat-completions form (every client protocol is converted to it first).
#[allow(
    clippy::too_many_arguments,
    reason = "Mirrors the HTTP forward path's explicit request context"
)]
async fn cli_attempt(
    state: &ProxyState,
    target: &ResolvedTarget,
    chat_body: &Bytes,
    public_model: &str,
    stream: bool,
    proto: ClientProto,
    cancel: &CancellationToken,
    start: Instant,
) -> Result<ClaudeOutcome, UpstreamAttemptError> {
    let chat: Value = serde_json::from_slice(chat_body).map_err(|e| UpstreamAttemptError {
        status: 400,
        body: format!("invalid JSON body: {e}"),
        retryable: false,
    })?;
    let run = match cli_format(target) {
        Some(UpstreamFormat::CursorCli) => {
            crate::cursor_cli::start(&state.cursor_cli, &target.upstream_model, &chat, cancel)
                .await?
        }
        _ => {
            crate::claude_code::start(&state.claude_code, &target.upstream_model, &chat, cancel)
                .await?
        }
    };
    state.cooldown.clear(&target.connection.id);
    let latency = start.elapsed().as_millis() as i64;
    if stream {
        let _ = state.store.log_usage(
            Some(public_model),
            Some(&target.connection.id),
            Some(200),
            Some(latency),
            None,
            None,
            None,
            None,
        );
        let mode = match proto {
            ClientProto::Anthropic => StreamMode::Passthrough,
            ClientProto::Chat => StreamMode::AnthropicToChat(public_model.to_string()),
            ClientProto::Responses => StreamMode::AnthropicToResponses(public_model.to_string()),
        };
        return Ok(ClaudeOutcome::Stream(run, mode));
    }
    let to_attempt = |e: AppError| UpstreamAttemptError {
        status: e.status_code().as_u16(),
        body: match e {
            AppError::Upstream { body, .. } => body,
            other => other.to_string(),
        },
        retryable: false,
    };
    let anthropic = run.collect(public_model).await.map_err(to_attempt)?;
    let chat_out = claude::anthropic_to_openai_response(&anthropic).map_err(to_attempt)?;
    let (pt, ct) = extract_usage_tokens(&chat_out);
    let _ = state.store.log_usage(
        Some(public_model),
        Some(&target.connection.id),
        Some(200),
        Some(latency),
        None,
        pt,
        ct,
        None,
    );
    let body = match proto {
        ClientProto::Anthropic => anthropic,
        ClientProto::Chat => chat_out,
        ClientProto::Responses => {
            responses::chat_to_responses(&chat_out, public_model).map_err(to_attempt)?
        }
    };
    Ok(ClaudeOutcome::Done(json_bytes_response(
        StatusCode::OK,
        body,
    )))
}

#[derive(Debug)]
pub struct UpstreamAttemptError {
    pub status: u16,
    pub body: String,
    pub retryable: bool,
}

pub fn is_retryable_status(status: u16) -> bool {
    matches!(status, 401 | 402 | 403 | 408 | 429) || (500..600).contains(&status)
}

/// Rewrite JSON body: set `model` to upstream model name.
pub fn rewrite_model(body: &Bytes, upstream_model: &str) -> AppResult<Bytes> {
    let mut v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON body: {e}")))?;
    let obj = v
        .as_object_mut()
        .ok_or_else(|| AppError::BadRequest("body must be a JSON object".into()))?;
    obj.insert("model".into(), Value::String(upstream_model.to_string()));
    Ok(Bytes::from(serde_json::to_vec(&v)?))
}

pub fn extract_model_and_stream(body: &Bytes) -> AppResult<(String, bool)> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON body: {e}")))?;
    let model = v
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let stream = v.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
    if model.is_empty() {
        return Err(AppError::BadRequest("model is required".into()));
    }
    Ok((model, stream))
}

/// How to interpret the upstream HTTP body for the client surface.
#[derive(Debug, Clone, Copy)]
pub enum UpstreamBodyKind {
    /// Already OpenAI chat completions JSON / SSE.
    OpenAiChat,
    /// Upstream spoke Responses; convert to chat for chat clients.
    OpenAiResponses,
    /// Antigravity generateContent envelope.
    Antigravity,
}

pub struct ForwardOk {
    pub response: reqwest::Response,
    pub body_kind: UpstreamBodyKind,
    /// Upstream forced streaming while client asked non-stream — reassemble body.
    pub reassemble_stream: bool,
}

fn provider_id_for(target: &ResolvedTarget) -> Option<String> {
    target
        .connection
        .oauth
        .as_ref()
        .map(|o| o.provider.clone())
        .filter(|s| !s.is_empty())
}

/// Forward a chat-shaped request. `native_responses` is the client's original
/// Responses body; Responses upstreams receive it (items intact) instead of `body`.
#[allow(
    clippy::too_many_arguments,
    reason = "Optional accounting ownership follows the existing forwarding and OAuth retry boundary"
)]
async fn forward_chat_completions_inner(
    state: &ProxyState,
    target: &ResolvedTarget,
    body: Bytes,
    native_responses: Option<&Bytes>,
    stream: bool,
    cancel: &CancellationToken,
    allow_401_refresh: bool,
    mut attempt: Option<&mut crate::stream_usage::StreamAttempt>,
) -> Result<ForwardOk, UpstreamAttemptError> {
    // Refresh OAuth if near expiry (best-effort).
    let borrowed = crate::borrowed::source(&target.connection);
    let target = {
        let mut t = target.clone();
        if let Some(path) = &borrowed {
            // Re-read the CLI's file on every attempt; never refresh it ourselves.
            if let Err(e) = crate::borrowed::apply(&mut t.connection, path) {
                return Err(UpstreamAttemptError {
                    status: 401,
                    body: e.to_string(),
                    retryable: true,
                });
            }
        } else if allow_401_refresh && t.connection.auth_type == "oauth_import" {
            if let Ok(fresh) =
                crate::oauth_refresh::ensure_fresh(&state.store, t.connection.clone()).await
            {
                t.connection = fresh;
            }
        }
        t
    };
    let target = &target;

    let provider_key = provider_id_for(target);
    let profile = provider_key.as_deref().and_then(providers::resolve);

    if let Some(p) = profile {
        // Rows written before the allowlist existed are checked again here.
        if !providers::base_url_allowed(
            p,
            &target.connection.base_url,
            &state.provider_base_overrides,
        ) {
            return Err(UpstreamAttemptError {
                status: 500,
                body: format!(
                    "connection '{}' has a base_url not allowed for provider '{}'; fix it in the admin UI",
                    target.connection.name, p.id
                ),
                retryable: false,
            });
        }
        if p.format == UpstreamFormat::Stub {
            return Err(UpstreamAttemptError {
                status: 501,
                body: format!(
                    "provider '{}' is partial/stub — token import works, full executor not wired yet. See docs/PROVIDERS.md",
                    p.id
                ),
                retryable: false,
            });
        }
    }

    let client_stream = stream;
    let mut cache_key: Option<String> = None;
    let (url, wire_body, body_kind, extra_headers, auth, upstream_stream, reassemble) =
        if let Some(p) = profile {
            let url = providers::build_upstream_url(p, &target.connection.base_url);
            let prepared = match rewrite_model(&body, &target.upstream_model) {
                Ok(b) => b,
                Err(e) => {
                    return Err(UpstreamAttemptError {
                        status: 400,
                        body: e.to_string(),
                        retryable: false,
                    });
                }
            };
            let force = p.force_stream && !client_stream;
            let prepared = if force {
                force_json_stream_true(&prepared).unwrap_or(prepared)
            } else {
                prepared
            };
            let (wire, kind) = match p.format {
                UpstreamFormat::OpenAiChat => (prepared, UpstreamBodyKind::OpenAiChat),
                UpstreamFormat::OpenAiResponses => {
                    let converted = match native_responses {
                        Some(native) => {
                            responses::prepare_native_request(native, &target.upstream_model, force)
                        }
                        None => responses::chat_to_responses_request(&prepared),
                    };
                    let converted = match converted {
                        Ok(b) if p.id == "siwc" => crate::siwc::sanitize_request(&b),
                        other => other,
                    };
                    match converted {
                        Ok(b) => {
                            let b = if force {
                                force_json_stream_true(&b).unwrap_or(b)
                            } else {
                                b
                            };
                            let b = if p.id == "siwc" {
                                let (b, key) = prompt_cache::ensure_prompt_cache_key(&b);
                                cache_key = key;
                                b
                            } else {
                                b
                            };
                            (b, UpstreamBodyKind::OpenAiResponses)
                        }
                        Err(e) => {
                            return Err(UpstreamAttemptError {
                                status: 400,
                                body: e.to_string(),
                                retryable: false,
                            });
                        }
                    }
                }
                UpstreamFormat::Antigravity => {
                    // Resolve project from meta or loadCodeAssist.
                    let project = resolve_agy_project(state, target).await.map_err(|e| {
                        UpstreamAttemptError {
                            status: 502,
                            body: e.to_string(),
                            retryable: true,
                        }
                    })?;
                    match crate::agy::chat_to_agy_request(
                        &prepared,
                        &project,
                        &target.upstream_model,
                    ) {
                        Ok(b) => (b, UpstreamBodyKind::Antigravity),
                        Err(e) => {
                            return Err(UpstreamAttemptError {
                                status: 400,
                                body: e.to_string(),
                                retryable: false,
                            });
                        }
                    }
                }
                UpstreamFormat::CursorCli | UpstreamFormat::ClaudeCode => {
                    return Err(UpstreamAttemptError {
                        status: 500,
                        body: "cursor / claude code paths are handled before the HTTP forward"
                            .into(),
                        retryable: false,
                    });
                }
                UpstreamFormat::Stub => unreachable!(),
            };
            let auth = providers::authorization_header(p, target.connection.bearer_token());
            (
                url,
                wire,
                kind,
                p.extra_headers,
                auth,
                client_stream || force,
                force,
            )
        } else {
            let base = target.connection.base_url.trim_end_matches('/');
            let url = if base.ends_with("/chat/completions") {
                base.to_string()
            } else {
                format!("{base}/chat/completions")
            };
            let wire = match rewrite_model(&body, &target.upstream_model) {
                Ok(b) => b,
                Err(e) => {
                    return Err(UpstreamAttemptError {
                        status: 400,
                        body: e.to_string(),
                        retryable: false,
                    });
                }
            };
            let auth = Some(format!("Bearer {}", target.connection.bearer_token()));
            (
                url,
                wire,
                UpstreamBodyKind::OpenAiChat,
                &[][..],
                auth,
                client_stream,
                false,
            )
        };

    debug!(
        url = %url,
        connection = %target.connection.name,
        auth_type = %target.connection.auth_type,
        provider = provider_key.as_deref().unwrap_or("-"),
        model = %target.upstream_model,
        stream,
        "forwarding chat completions"
    );

    let mut req = state
        .http
        .post(&url)
        .header("content-type", "application/json")
        .body(wire_body);

    if let Some(a) = auth {
        req = req.header("authorization", a);
    }
    for (k, v) in extra_headers {
        if v.is_empty() {
            continue;
        }
        req = req.header(*k, *v);
    }
    if let Some(key) = &cache_key {
        for (k, v) in prompt_cache::session_headers(key) {
            req = req.header(k, v);
        }
    }
    // OpenCode Go requires x-opencode-session for routing (see opencode.ai/docs/go).
    if provider_key.as_deref() == Some("opencode") && target.connection.base_url.contains("/zen/go")
    {
        req = req
            .header("x-opencode-session", uuid::Uuid::new_v4().to_string())
            .header("User-Agent", "thinrouter/0.1");
    }
    if upstream_stream {
        req = req.header("accept", "text/event-stream");
    }

    let send_fut = req.send();
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            return Err(UpstreamAttemptError {
                status: 499,
                body: "client disconnected".into(),
                retryable: false,
            });
        }
        r = send_fut => r,
    };

    match result {
        Ok(resp) => {
            let status = resp.status().as_u16();
            if let Some(a) = attempt.as_mut() {
                a.headers(status);
            }
            if status == 200 {
                Ok(ForwardOk {
                    response: resp,
                    body_kind,
                    reassemble_stream: reassemble,
                })
            } else if status == 401 && borrowed.is_some() {
                let body_txt = read_diagnostic_cancel(resp, cancel).await?;
                let mut reread = target.clone();
                let changed = borrowed
                    .as_deref()
                    .and_then(|p| crate::borrowed::apply(&mut reread.connection, p).ok())
                    .is_some_and(|_| {
                        reread.connection.bearer_token() != target.connection.bearer_token()
                    });
                if changed && allow_401_refresh {
                    // The CLI refreshed its file since we read it: retry once.
                    return Box::pin(forward_chat_completions_inner(
                        state,
                        target,
                        body,
                        native_responses,
                        stream,
                        cancel,
                        false,
                        None,
                    ))
                    .await;
                }
                Err(UpstreamAttemptError {
                    status,
                    body: format!("{body_txt} ({})", crate::borrowed::GROK_HINT),
                    retryable: true,
                })
            } else if status == 401
                && allow_401_refresh
                && target.connection.auth_type == "oauth_import"
            {
                let body_txt = read_diagnostic_cancel(resp, cancel).await?;
                if let Ok(fresh) =
                    crate::oauth_refresh::refresh_connection(&state.store, &target.connection).await
                {
                    let mut retry_target = target.clone();
                    retry_target.connection = fresh;
                    return Box::pin(forward_chat_completions_inner(
                        state,
                        &retry_target,
                        body,
                        native_responses,
                        stream,
                        cancel,
                        false,
                        None,
                    ))
                    .await;
                }
                Err(UpstreamAttemptError {
                    status,
                    body: body_txt,
                    retryable: is_retryable_status(status),
                })
            } else {
                let body = read_diagnostic_cancel(resp, cancel).await?;
                Err(UpstreamAttemptError {
                    status,
                    body,
                    retryable: is_retryable_status(status),
                })
            }
        }
        Err(e) => {
            if let Some(a) = attempt.as_mut() {
                if e.is_timeout() {
                    a.stop("timeout", "upstream_attempt_failed");
                } else {
                    a.stop("failed", "upstream_attempt_failed");
                }
            }
            Err(UpstreamAttemptError {
                status: 502,
                body: format!("upstream request failed: {e}"),
                retryable: true,
            })
        }
    }
}

fn force_json_stream_true(body: &Bytes) -> AppResult<Bytes> {
    let mut v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON: {e}")))?;
    if let Some(obj) = v.as_object_mut() {
        obj.insert("stream".into(), Value::Bool(true));
    }
    Ok(Bytes::from(serde_json::to_vec(&v)?))
}

fn convert_upstream_to_chat(bytes: Bytes, kind: UpstreamBodyKind, model: &str) -> AppResult<Bytes> {
    match kind {
        UpstreamBodyKind::OpenAiChat => Ok(bytes),
        UpstreamBodyKind::OpenAiResponses => responses::responses_body_to_chat(&bytes),
        UpstreamBodyKind::Antigravity => crate::agy::agy_to_chat_response(&bytes, model),
    }
}

async fn resolve_agy_project(state: &ProxyState, target: &ResolvedTarget) -> AppResult<String> {
    if let Some(meta) = target
        .connection
        .oauth
        .as_ref()
        .and_then(|o| o.meta.as_deref())
    {
        if let Ok(v) = serde_json::from_str::<Value>(meta) {
            if let Some(p) = v.get("project").and_then(|p| p.as_str()) {
                if !p.is_empty() {
                    return Ok(p.to_string());
                }
            }
        }
    }
    let token = target.connection.bearer_token();
    let project = crate::agy::fetch_project_id(token).await?;
    // Persist project into meta for next call
    if let Some(oauth) = &target.connection.oauth {
        let mut meta_v: Value = oauth
            .meta
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_else(|| json!({}));
        if let Some(obj) = meta_v.as_object_mut() {
            obj.insert("project".into(), Value::String(project.clone()));
        }
        let _ = state
            .store
            .update_oauth_meta(&target.connection.id, &meta_v.to_string());
    }
    Ok(project)
}

/// Order targets: skip cooled; apply round-robin rotation when strategy is round_robin.
pub fn order_targets(
    targets: Vec<ResolvedTarget>,
    strategy: &str,
    cooldown: &CooldownMap,
    rr_counter: &AtomicU64,
) -> Vec<ResolvedTarget> {
    let mut active: Vec<ResolvedTarget> = Vec::new();
    let mut cooled: Vec<ResolvedTarget> = Vec::new();
    for t in targets {
        if cooldown.is_cooled(&t.connection.id) {
            cooled.push(t);
        } else {
            active.push(t);
        }
    }
    let mut ordered = if active.is_empty() { cooled } else { active };

    if strategy.eq_ignore_ascii_case("round_robin") && ordered.len() > 1 {
        let n = ordered.len() as u64;
        let start = (rr_counter.fetch_add(1, Ordering::Relaxed) % n) as usize;
        ordered.rotate_left(start);
    }
    ordered
}

fn prepare_body(state: &ProxyState, body: Bytes) -> AppResult<Bytes> {
    token_saver::maybe_rewrite(&body, state.token_saver, state.token_saver_max_chars)
}

/// Handle chat with ordered fallback. Stream fallback only before first byte committed.
///
/// `cancel_guard` is disarmed automatically before returning an SSE body so the stream
/// is not aborted when the HTTP handler completes.
#[allow(
    clippy::too_many_arguments,
    reason = "Preserve the existing proxy handler interface and explicit cancellation ownership across streaming responses"
)]
pub async fn handle_chat_with_fallback(
    state: &ProxyState,
    public_model: &str,
    body: Bytes,
    stream: bool,
    targets: Vec<ResolvedTarget>,
    strategy: &str,
    cancel: CancellationToken,
    cancel_guard: crate::cancel::CancelOnDrop,
) -> AppResult<Response> {
    let body = prepare_body(state, body)?;
    let request_id = uuid::Uuid::new_v4().to_string();
    let targets = order_targets(targets, strategy, &state.cooldown, &state.rr_counter);
    let mut last_err: Option<UpstreamAttemptError> = None;

    for (idx, target) in targets.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(AppError::BadRequest("client disconnected".into()));
        }
        let start = Instant::now();

        if is_cli_target(target) {
            match cli_attempt(
                state,
                target,
                &body,
                public_model,
                stream,
                ClientProto::Chat,
                &cancel,
                start,
            )
            .await
            {
                Ok(ClaudeOutcome::Done(resp)) => return Ok(resp),
                Ok(ClaudeOutcome::Stream(run, mode)) => {
                    cancel_guard.disarm();
                    return stream_body(run.into_stream(), state.sse_stall_secs, mode).await;
                }
                Err(e) => {
                    record_failure(state, public_model, target, &e, start);
                    if e.retryable && idx + 1 < targets.len() {
                        last_err = Some(e);
                        continue;
                    }
                    return Err(AppError::Upstream {
                        status: e.status,
                        body: e.body,
                    });
                }
            }
        }
        let mut attempt =
            begin_http_stream_attempt(state, &request_id, public_model, target, &body, stream)?;
        match forward_chat_completions_inner(
            state,
            target,
            body.clone(),
            None,
            stream,
            &cancel,
            true,
            attempt.as_mut(),
        )
        .await
        {
            Ok(fwd) => {
                let latency = start.elapsed().as_millis() as i64;
                state.cooldown.clear(&target.connection.id);
                if stream && !fwd.reassemble_stream {
                    if attempt.is_none() {
                        let _ = state.store.log_usage(
                            Some(public_model),
                            Some(&target.connection.id),
                            Some(200),
                            Some(latency),
                            None,
                            None,
                            None,
                            None,
                        );
                    }
                    cancel_guard.disarm();
                    let mode = match fwd.body_kind {
                        UpstreamBodyKind::OpenAiResponses => {
                            StreamMode::ResponsesToChat(public_model.to_string())
                        }
                        _ => StreamMode::Passthrough,
                    };
                    return stream_body_observed(
                        fwd.response.bytes_stream(),
                        state.sse_stall_secs,
                        mode,
                        attempt,
                    )
                    .await;
                } else {
                    let kind = fwd.body_kind;
                    let bytes = read_forward_body(fwd, &cancel, false).await?;
                    let (pt, ct) = extract_upstream_usage(&bytes, kind);
                    let bytes = convert_upstream_to_chat(bytes, kind, &target.upstream_model)?;
                    let cost = estimate_cost(
                        pt,
                        ct,
                        target.connection.input_price_per_m,
                        target.connection.output_price_per_m,
                    );
                    let _ = state.store.log_usage(
                        Some(public_model),
                        Some(&target.connection.id),
                        Some(200),
                        Some(latency),
                        None,
                        pt,
                        ct,
                        cost,
                    );
                    return Ok(json_bytes_response(StatusCode::OK, bytes));
                }
            }
            Err(e) => {
                warn!(
                    connection = %target.connection.name,
                    status = e.status,
                    retryable = e.retryable,
                    "upstream attempt failed"
                );
                if let Some(a) = attempt.as_mut() {
                    if e.status == 499 {
                        a.stop("cancelled", "stream_cancelled");
                    } else {
                        a.stop("failed", "upstream_attempt_failed");
                    }
                    let secs = cooldown_secs_for_status(e.status);
                    if secs > 0 {
                        state.cooldown.mark(&target.connection.id, secs);
                    }
                } else {
                    record_failure(state, public_model, target, &e, start);
                }
                if e.retryable && idx + 1 < targets.len() {
                    last_err = Some(e);
                    continue;
                }
                return Err(AppError::Upstream {
                    status: e.status,
                    body: e.body,
                });
            }
        }
    }

    let e = last_err.unwrap_or(UpstreamAttemptError {
        status: 503,
        body: "no upstream targets".into(),
        retryable: false,
    });
    Err(AppError::Upstream {
        status: e.status,
        body: e.body,
    })
}

fn begin_http_stream_attempt(
    state: &ProxyState,
    request_id: &str,
    public_model: &str,
    target: &ResolvedTarget,
    body: &[u8],
    stream: bool,
) -> AppResult<Option<crate::stream_usage::StreamAttempt>> {
    if stream
        && target.connection.auth_type == "api_key"
        && provider_id_for(target).is_none()
        && crate::borrowed::source(&target.connection).is_none()
    {
        crate::stream_usage::StreamAttempt::begin(
            &state.store,
            request_id,
            public_model,
            target,
            body,
        )
        .map(Some)
    } else {
        Ok(None)
    }
}

/// Anthropic-native path: translate request → OpenAI forward → translate response.
#[allow(
    clippy::too_many_arguments,
    reason = "Preserve the existing proxy handler interface and explicit cancellation ownership across streaming responses"
)]
pub async fn handle_anthropic_messages(
    state: &ProxyState,
    public_model: &str,
    body: Bytes,
    stream: bool,
    targets: Vec<ResolvedTarget>,
    strategy: &str,
    cancel: CancellationToken,
    cancel_guard: crate::cancel::CancelOnDrop,
) -> AppResult<Response> {
    let body = prepare_body(state, body)?;
    let oai_body = claude::anthropic_to_openai(&body)?;
    let targets = order_targets(targets, strategy, &state.cooldown, &state.rr_counter);
    let mut last_err: Option<UpstreamAttemptError> = None;
    let request_id = uuid::Uuid::new_v4().to_string();

    for (idx, target) in targets.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(AppError::BadRequest("client disconnected".into()));
        }
        let start = Instant::now();
        if is_cli_target(target) {
            match cli_attempt(
                state,
                target,
                &oai_body,
                public_model,
                stream,
                ClientProto::Anthropic,
                &cancel,
                start,
            )
            .await
            {
                Ok(ClaudeOutcome::Done(resp)) => return Ok(resp),
                Ok(ClaudeOutcome::Stream(run, mode)) => {
                    cancel_guard.disarm();
                    return stream_body(run.into_stream(), state.sse_stall_secs, mode).await;
                }
                Err(e) => {
                    record_failure(state, public_model, target, &e, start);
                    if e.retryable && idx + 1 < targets.len() {
                        last_err = Some(e);
                        continue;
                    }
                    return Err(AppError::Upstream {
                        status: e.status,
                        body: e.body,
                    });
                }
            }
        }
        let mut attempt =
            begin_http_stream_attempt(state, &request_id, public_model, target, &oai_body, stream)?;
        match forward_chat_completions_inner(
            state,
            target,
            oai_body.clone(),
            None,
            stream,
            &cancel,
            true,
            attempt.as_mut(),
        )
        .await
        {
            Ok(fwd) => {
                let latency = start.elapsed().as_millis() as i64;
                state.cooldown.clear(&target.connection.id);
                if stream {
                    if attempt.is_none() {
                        let _ = state.store.log_usage(
                            Some(public_model),
                            Some(&target.connection.id),
                            Some(200),
                            Some(latency),
                            None,
                            None,
                            None,
                            None,
                        );
                    }
                    cancel_guard.disarm();
                    let mode = match fwd.body_kind {
                        UpstreamBodyKind::OpenAiChat => {
                            StreamMode::ChatToAnthropic(public_model.to_string())
                        }
                        UpstreamBodyKind::OpenAiResponses => {
                            StreamMode::ResponsesToAnthropic(public_model.to_string())
                        }
                        _ => StreamMode::Passthrough,
                    };
                    return stream_body_observed(
                        fwd.response.bytes_stream(),
                        state.sse_stall_secs,
                        mode,
                        attempt,
                    )
                    .await;
                } else {
                    let kind = fwd.body_kind;
                    let bytes = read_forward_body(fwd, &cancel, false).await?;
                    let (pt, ct) = extract_upstream_usage(&bytes, kind);
                    let chat = convert_upstream_to_chat(bytes, kind, &target.upstream_model)?;
                    let cost = estimate_cost(
                        pt,
                        ct,
                        target.connection.input_price_per_m,
                        target.connection.output_price_per_m,
                    );
                    let _ = state.store.log_usage(
                        Some(public_model),
                        Some(&target.connection.id),
                        Some(200),
                        Some(latency),
                        None,
                        pt,
                        ct,
                        cost,
                    );
                    let anth = claude::openai_to_anthropic(&chat, public_model)?;
                    return Ok(json_bytes_response(StatusCode::OK, anth));
                }
            }
            Err(e) => {
                if let Some(a) = attempt.as_mut() {
                    if e.status == 499 {
                        a.stop("cancelled", "stream_cancelled");
                    } else {
                        a.stop("failed", "upstream_attempt_failed");
                    }
                    let secs = cooldown_secs_for_status(e.status);
                    if secs > 0 {
                        state.cooldown.mark(&target.connection.id, secs);
                    }
                } else {
                    record_failure(state, public_model, target, &e, start);
                }
                if e.retryable && idx + 1 < targets.len() {
                    last_err = Some(e);
                    continue;
                }
                return Err(AppError::Upstream {
                    status: e.status,
                    body: e.body,
                });
            }
        }
    }

    let e = last_err.unwrap_or(UpstreamAttemptError {
        status: 503,
        body: "no upstream targets".into(),
        retryable: false,
    });
    Err(AppError::Upstream {
        status: e.status,
        body: e.body,
    })
}

/// OpenAI Responses API path.
#[allow(
    clippy::too_many_arguments,
    reason = "Preserve the existing proxy handler interface and explicit cancellation ownership across streaming responses"
)]
pub async fn handle_responses(
    state: &ProxyState,
    public_model: &str,
    body: Bytes,
    stream: bool,
    targets: Vec<ResolvedTarget>,
    strategy: &str,
    cancel: CancellationToken,
    cancel_guard: crate::cancel::CancelOnDrop,
) -> AppResult<Response> {
    let body = prepare_body(state, body)?;
    let chat_body = responses::responses_to_chat(&body)?;
    let allow_background = serde_json::from_slice::<Value>(&body)?["background"] == true;
    let targets = order_targets(targets, strategy, &state.cooldown, &state.rr_counter);
    let mut last_err: Option<UpstreamAttemptError> = None;
    let request_id = uuid::Uuid::new_v4().to_string();

    for (idx, target) in targets.iter().enumerate() {
        if cancel.is_cancelled() {
            return Err(AppError::BadRequest("client disconnected".into()));
        }
        let start = Instant::now();
        if is_cli_target(target) {
            match cli_attempt(
                state,
                target,
                &chat_body,
                public_model,
                stream,
                ClientProto::Responses,
                &cancel,
                start,
            )
            .await
            {
                Ok(ClaudeOutcome::Done(resp)) => return Ok(resp),
                Ok(ClaudeOutcome::Stream(run, mode)) => {
                    cancel_guard.disarm();
                    return stream_body(run.into_stream(), state.sse_stall_secs, mode).await;
                }
                Err(e) => {
                    record_failure(state, public_model, target, &e, start);
                    if e.retryable && idx + 1 < targets.len() {
                        last_err = Some(e);
                        continue;
                    }
                    return Err(AppError::Upstream {
                        status: e.status,
                        body: e.body,
                    });
                }
            }
        }
        let mut attempt = begin_http_stream_attempt(
            state,
            &request_id,
            public_model,
            target,
            &chat_body,
            stream,
        )?;
        match forward_chat_completions_inner(
            state,
            target,
            chat_body.clone(),
            Some(&body),
            stream,
            &cancel,
            true,
            attempt.as_mut(),
        )
        .await
        {
            Ok(fwd) => {
                let latency = start.elapsed().as_millis() as i64;
                state.cooldown.clear(&target.connection.id);
                if stream {
                    if attempt.is_none() {
                        let _ = state.store.log_usage(
                            Some(public_model),
                            Some(&target.connection.id),
                            Some(200),
                            Some(latency),
                            None,
                            None,
                            None,
                            None,
                        );
                    }
                    cancel_guard.disarm();
                    let mode = match fwd.body_kind {
                        UpstreamBodyKind::OpenAiChat => {
                            StreamMode::ChatToResponses(public_model.to_string())
                        }
                        // Preserve native frames, while requiring a valid terminal.
                        UpstreamBodyKind::OpenAiResponses => StreamMode::NativeResponses,
                        _ => StreamMode::Passthrough,
                    };
                    return stream_body_observed(
                        fwd.response.bytes_stream(),
                        state.sse_stall_secs,
                        mode,
                        attempt,
                    )
                    .await;
                } else {
                    let kind = fwd.body_kind;
                    let bytes = read_forward_body(fwd, &cancel, allow_background).await?;
                    let (pt, ct) = extract_upstream_usage(&bytes, kind);
                    // If upstream already returned Responses, pass through; else wrap chat.
                    let out = match kind {
                        UpstreamBodyKind::OpenAiResponses => bytes,
                        other => {
                            let chat =
                                convert_upstream_to_chat(bytes, other, &target.upstream_model)?;
                            responses::chat_to_responses(&chat, public_model)?
                        }
                    };
                    let cost = estimate_cost(
                        pt,
                        ct,
                        target.connection.input_price_per_m,
                        target.connection.output_price_per_m,
                    );
                    let _ = state.store.log_usage(
                        Some(public_model),
                        Some(&target.connection.id),
                        Some(200),
                        Some(latency),
                        None,
                        pt,
                        ct,
                        cost,
                    );
                    return Ok(json_bytes_response(StatusCode::OK, out));
                }
            }
            Err(e) => {
                if let Some(a) = attempt.as_mut() {
                    if e.status == 499 {
                        a.stop("cancelled", "stream_cancelled");
                    } else {
                        a.stop("failed", "upstream_attempt_failed");
                    }
                    let secs = cooldown_secs_for_status(e.status);
                    if secs > 0 {
                        state.cooldown.mark(&target.connection.id, secs);
                    }
                } else {
                    record_failure(state, public_model, target, &e, start);
                }
                if e.retryable && idx + 1 < targets.len() {
                    last_err = Some(e);
                    continue;
                }
                return Err(AppError::Upstream {
                    status: e.status,
                    body: e.body,
                });
            }
        }
    }

    let e = last_err.unwrap_or(UpstreamAttemptError {
        status: 503,
        body: "no upstream targets".into(),
        retryable: false,
    });
    Err(AppError::Upstream {
        status: e.status,
        body: e.body,
    })
}

async fn read_diagnostic_cancel(
    resp: reqwest::Response,
    cancel: &CancellationToken,
) -> Result<String, UpstreamAttemptError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(UpstreamAttemptError {
            status: 499,
            body: "client disconnected".into(),
            retryable: false,
        }),
        body = crate::collection::diagnostic_text(resp) => Ok(body),
    }
}

async fn read_bytes_cancel(
    resp: reqwest::Response,
    cancel: &CancellationToken,
) -> AppResult<Bytes> {
    crate::collection::body(resp.bytes_stream(), cancel).await
}

/// Read a non-stream upstream body; a forced-stream Responses transcript is folded
/// back into one Responses JSON body.
async fn read_forward_body(
    fwd: ForwardOk,
    cancel: &CancellationToken,
    allow_background: bool,
) -> AppResult<Bytes> {
    let reassemble = fwd.reassemble_stream;
    let kind = fwd.body_kind;
    let bytes = read_bytes_cancel(fwd.response, cancel).await?;
    if !matches!(kind, UpstreamBodyKind::OpenAiResponses) {
        return Ok(bytes);
    }
    if reassemble {
        return responses::reassemble_sse(&String::from_utf8_lossy(&bytes));
    }
    responses::validate_json_response(&bytes, allow_background)?;
    Ok(bytes)
}

/// Chat (`prompt_tokens`) or Responses (`input_tokens`) usage.
fn extract_usage_tokens(bytes: &Bytes) -> (Option<i64>, Option<i64>) {
    let Ok(v) = serde_json::from_slice::<Value>(bytes) else {
        return (None, None);
    };
    let pt = v
        .pointer("/usage/prompt_tokens")
        .or_else(|| v.pointer("/usage/input_tokens"))
        .and_then(|n| n.as_i64());
    let ct = v
        .pointer("/usage/completion_tokens")
        .or_else(|| v.pointer("/usage/output_tokens"))
        .and_then(|n| n.as_i64());
    (pt, ct)
}

/// Read accounting from the upstream representation before client converters can
/// synthesize zero defaults. Counts are observations, not inferred from totals.
fn extract_upstream_usage(bytes: &Bytes, kind: UpstreamBodyKind) -> (Option<i64>, Option<i64>) {
    let Ok(v) = serde_json::from_slice::<Value>(bytes) else {
        return (None, None);
    };
    let (usage, input, output) = match kind {
        UpstreamBodyKind::OpenAiChat => (v.get("usage"), "prompt_tokens", "completion_tokens"),
        UpstreamBodyKind::OpenAiResponses => (v.get("usage"), "input_tokens", "output_tokens"),
        UpstreamBodyKind::Antigravity => (
            v.pointer("/response/usageMetadata")
                .or_else(|| v.get("usageMetadata")),
            "promptTokenCount",
            "candidatesTokenCount",
        ),
    };
    let count = |field| {
        usage
            .and_then(|u| u.get(field))
            .and_then(Value::as_i64)
            .filter(|n| *n >= 0)
    };
    (count(input), count(output))
}

pub fn estimate_cost(
    prompt_tokens: Option<i64>,
    completion_tokens: Option<i64>,
    input_price_per_m: Option<f64>,
    output_price_per_m: Option<f64>,
) -> Option<f64> {
    let pt = prompt_tokens?;
    let ct = completion_tokens?;
    let ip = input_price_per_m?;
    let op = output_price_per_m?;
    if pt < 0 || ct < 0 || !ip.is_finite() || !op.is_finite() || ip < 0.0 || op < 0.0 {
        return None;
    }
    let cost = (pt as f64 * ip + ct as f64 * op) / 1_000_000.0;
    cost.is_finite().then_some(cost)
}

fn json_bytes_response(status: StatusCode, bytes: Bytes) -> Response {
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("application/json"),
    );
    (status, headers, bytes).into_response()
}

enum StreamMode {
    Passthrough,
    NativeResponses,
    /// Chat chunks → Anthropic events (model name for message_start).
    ChatToAnthropic(String),
    /// Chat chunks → Responses events.
    ChatToResponses(String),
    /// Responses events → chat chunks.
    ResponsesToChat(String),
    /// Responses events → chat chunks → Anthropic events.
    ResponsesToAnthropic(String),
    /// Anthropic events → chat chunks.
    AnthropicToChat(String),
    /// Anthropic events → chat chunks → Responses events.
    AnthropicToResponses(String),
}

// Includes the field prefix and optional CR, but excludes the LF delimiter.
const MAX_CONVERTED_LINE_BYTES: usize = 16 * 1024 * 1024;

/// Re-encodes one upstream SSE `data:` payload at a time into client SSE records.
trait SseConvert: Send {
    /// A final output was produced, not merely a finish reason received.
    fn is_done(&self) -> bool;
    fn is_failed(&self) -> bool {
        false
    }
    fn on_data(&mut self, data: &str) -> Vec<String>;
    /// Every supported source format accepts this fixed error envelope.
    /// Unlike EOF/stall, an input-limit violation cannot finalize a finish reason.
    fn on_input_limit(&mut self) -> Vec<String> {
        self.on_data(
            &serde_json::json!({"type": "error", "error": {
                "type": "api_error", "message": crate::error::INPUT_LIMIT_STREAM_MESSAGE
            }})
            .to_string(),
        )
    }
    /// Upstream ended (with or without a terminal event).
    fn on_end(&mut self) -> Vec<String>;
    /// Idle deadline elapsed; preserve any already parsed terminal.
    fn on_stall(&mut self) -> Vec<String>;
    /// Read failed; never render arbitrary source errors.
    fn on_read_error(&mut self) -> Vec<String>;
}

struct ChatToAnthropic(StreamTranslateState);

impl SseConvert for ChatToAnthropic {
    fn is_failed(&self) -> bool {
        self.0.is_failed()
    }
    fn is_done(&self) -> bool {
        self.0.message_stop_sent
    }

    fn on_data(&mut self, data: &str) -> Vec<String> {
        claude::openai_sse_chunk_to_anthropic(data, &mut self.0)
    }
    fn on_end(&mut self) -> Vec<String> {
        self.0.on_end()
    }
    fn on_stall(&mut self) -> Vec<String> {
        self.0.on_stall()
    }
    fn on_read_error(&mut self) -> Vec<String> {
        self.0.on_read_error()
    }
}

impl SseConvert for responses::ChatToResponsesStream {
    fn is_failed(&self) -> bool {
        self.is_failed()
    }
    fn is_done(&self) -> bool {
        responses::ChatToResponsesStream::is_done(self)
    }

    fn on_data(&mut self, data: &str) -> Vec<String> {
        responses::ChatToResponsesStream::on_data(self, data)
    }
    fn on_end(&mut self) -> Vec<String> {
        responses::ChatToResponsesStream::on_end(self)
    }
    fn on_stall(&mut self) -> Vec<String> {
        responses::ChatToResponsesStream::on_stall(self)
    }
    fn on_read_error(&mut self) -> Vec<String> {
        responses::ChatToResponsesStream::on_read_error(self)
    }
}

impl SseConvert for responses::ResponsesToChatStream {
    fn is_done(&self) -> bool {
        responses::ResponsesToChatStream::is_done(self)
    }

    fn on_data(&mut self, data: &str) -> Vec<String> {
        responses::ResponsesToChatStream::on_data(self, data)
    }
    fn on_end(&mut self) -> Vec<String> {
        responses::ResponsesToChatStream::on_end(self)
    }
    fn on_stall(&mut self) -> Vec<String> {
        responses::ResponsesToChatStream::on_stall(self)
    }
    fn on_read_error(&mut self) -> Vec<String> {
        responses::ResponsesToChatStream::on_read_error(self)
    }
}

impl SseConvert for claude::AnthropicToChatStream {
    fn is_done(&self) -> bool {
        claude::AnthropicToChatStream::is_done(self)
    }

    fn on_data(&mut self, data: &str) -> Vec<String> {
        claude::AnthropicToChatStream::on_data(self, data)
    }
    fn on_end(&mut self) -> Vec<String> {
        claude::AnthropicToChatStream::on_end(self)
    }
    fn on_stall(&mut self) -> Vec<String> {
        claude::AnthropicToChatStream::on_stall(self)
    }
    fn on_read_error(&mut self) -> Vec<String> {
        claude::AnthropicToChatStream::on_read_error(self)
    }
}

/// Two converters in series; the first emits `data: ...` records.
struct Chain<A, B>(A, B);

impl<A: SseConvert, B: SseConvert> Chain<A, B> {
    fn feed(&mut self, records: Vec<String>) -> Vec<String> {
        let mut out = Vec::new();
        for record in records {
            if self.1.is_done() {
                break;
            }
            if let Some(data) = record.strip_prefix("data: ") {
                out.extend(self.1.on_data(data));
            }
        }
        out
    }
}

impl<A: SseConvert, B: SseConvert> SseConvert for Chain<A, B> {
    fn is_done(&self) -> bool {
        // The final stage can fail on its own budget before the source stage finishes.
        self.1.is_done()
    }

    fn on_data(&mut self, data: &str) -> Vec<String> {
        let mid = self.0.on_data(data);
        self.feed(mid)
    }
    fn on_end(&mut self) -> Vec<String> {
        let mid = self.0.on_end();
        let mut out = self.feed(mid);
        out.extend(self.1.on_end());
        out
    }
    fn on_stall(&mut self) -> Vec<String> {
        let mid = self.0.on_stall();
        let mut out = self.feed(mid);
        out.extend(self.1.on_end());
        out
    }
    fn on_read_error(&mut self) -> Vec<String> {
        let mid = self.0.on_read_error();
        let mut out = self.feed(mid);
        out.extend(self.1.on_end());
        out
    }
}

fn converter(mode: StreamMode) -> Option<Box<dyn SseConvert>> {
    Some(match mode {
        StreamMode::Passthrough | StreamMode::NativeResponses => return None,
        StreamMode::ChatToAnthropic(m) => Box::new(ChatToAnthropic(StreamTranslateState::new(m))),
        StreamMode::ChatToResponses(m) => Box::new(responses::ChatToResponsesStream::new(m)),
        StreamMode::ResponsesToChat(m) => Box::new(responses::ResponsesToChatStream::new(m)),
        StreamMode::ResponsesToAnthropic(m) => Box::new(Chain(
            responses::ResponsesToChatStream::new(m.clone()),
            ChatToAnthropic(StreamTranslateState::new(m)),
        )),
        StreamMode::AnthropicToChat(m) => Box::new(claude::AnthropicToChatStream::new(m)),
        StreamMode::AnthropicToResponses(m) => Box::new(Chain(
            claude::AnthropicToChatStream::new(m.clone()),
            responses::ChatToResponsesStream::new(m),
        )),
    })
}

/// SSE body from any byte stream (HTTP upstream or a Claude Code run).
async fn stream_body<S, E>(upstream: S, stall_secs: u64, mode: StreamMode) -> AppResult<Response>
where
    S: futures_util::Stream<Item = Result<Bytes, E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    stream_body_observed(upstream, stall_secs, mode, None).await
}

async fn stream_body_observed<S, E>(
    upstream: S,
    stall_secs: u64,
    mode: StreamMode,
    mut attempt: Option<crate::stream_usage::StreamAttempt>,
) -> AppResult<Response>
where
    S: futures_util::Stream<Item = Result<Bytes, E>> + Send + 'static,
    E: std::fmt::Display + Send + 'static,
{
    let status = StatusCode::OK;
    let stall = Duration::from_secs(stall_secs.max(5));
    let mut upstream = Box::pin(upstream);
    let mut native = matches!(mode, StreamMode::NativeResponses)
        .then(crate::native_responses::NativeResponses::default);
    let mut conv = converter(mode);

    let byte_stream = async_stream::stream! {
        // Bytes until the last newline (SSE lines may split across chunks, even
        // inside a UTF-8 sequence).
        let mut buf: Vec<u8> = Vec::new();
        loop {
            match timeout(stall, upstream.next()).await {
                Ok(Some(Ok(chunk))) => {
                    if conv.is_none() {
                        if let Some(a) = attempt.as_mut() { a.push(&chunk); }
                    }
                    if let Some(native) = native.as_mut() {
                        let out = native.push(&chunk);
                        if native.done {
                            drop(upstream);
                            if !out.is_empty() { yield Ok::<Bytes, std::io::Error>(Bytes::from(out)); }
                            break;
                        }
                        if !out.is_empty() { yield Ok::<Bytes, std::io::Error>(Bytes::from(out)); }
                        continue;
                    }
                    let Some(conv) = conv.as_mut() else {
                        yield Ok::<Bytes, std::io::Error>(chunk);
                        continue;
                    };
                    let mut out = String::new();
                    for part in chunk.split_inclusive(|b| *b == b'\n') {
                        let line = part.strip_suffix(b"\n");
                        let content = line.unwrap_or(part);
                        if content.len() > MAX_CONVERTED_LINE_BYTES - buf.len() {
                            // Discard retained input, never decode or echo the offending line.
                            buf = Vec::new();
                            for rec in conv.on_input_limit() {
                                out.push_str(&rec);
                                out.push_str("\n\n");
                            }
                            break;
                        }
                        // Avoid geometric growth beyond the specified retained-line bound.
                        if buf.capacity() - buf.len() < content.len() {
                            let capacity = (buf.capacity().saturating_mul(2))
                                .max(buf.len() + content.len()).min(MAX_CONVERTED_LINE_BYTES);
                            buf.reserve_exact(capacity - buf.len());
                        }
                        buf.extend_from_slice(content);
                        if let Some(a) = attempt.as_mut() { a.observe_converted(part); }
                        if line.is_some() {
                            let decoded = String::from_utf8_lossy(&buf);
                            let decoded = decoded.strip_suffix('\r').unwrap_or(&decoded);
                            if let Some(data) = decoded.strip_prefix("data:") {
                                for rec in conv.on_data(data.strip_prefix(' ').unwrap_or(data)) {
                                    out.push_str(&rec);
                                    out.push_str("\n\n");
                                }
                            }
                            buf.clear();
                        }
                        if conv.is_done() { break; }
                    }
                    if conv.is_done() {
                        if let Some(a) = attempt.as_mut() { a.converted_terminal(conv.is_failed()); }
                        drop(upstream);
                        if !out.is_empty() { yield Ok(Bytes::from(out)); }
                        break;
                    }
                    if !out.is_empty() {
                        yield Ok(Bytes::from(out));
                    }
                }
                Ok(Some(Err(error))) => {
                    if let Some(a) = attempt.as_mut() { a.stop("failed", "upstream_transport_error"); }
                    // Error values can contain URLs/credentials and own resources.
                    drop(error);
                    let out = if let Some(native) = native.as_mut() {
                        Some(native.read_error())
                    } else {
                        conv.as_mut().map(|conv| {
                            conv.on_read_error().into_iter().map(|r| r + "\n\n").collect::<String>().into_bytes()
                        })
                    };
                    drop(upstream);
                    match out {
                        Some(out) if !out.is_empty() => yield Ok(Bytes::from(out)),
                        Some(_) => {},
                        None => yield Err(std::io::Error::other(crate::error::READ_FAILED_STREAM_MESSAGE)),
                    }
                    break;
                }
                Ok(None) => {
                    drop(upstream);
                    if let Some(native) = native.as_mut() {
                        let out = native.end();
                        if !out.is_empty() { yield Ok(Bytes::from(out)); }
                    }
                    if let Some(conv) = conv.as_mut() {
                        let mut out = String::new();
                        if let Some(data) = String::from_utf8_lossy(&buf).trim_end().strip_prefix("data:") {
                            for rec in conv.on_data(data.strip_prefix(' ').unwrap_or(data)) {
                                out.push_str(&rec);
                                out.push_str("\n\n");
                            }
                        }
                        for rec in conv.on_end() {
                            out.push_str(&rec);
                            out.push_str("\n\n");
                        }
                        if let Some(a) = attempt.as_mut() {
                            if conv.is_failed() { a.converted_terminal(true); } else { a.eof(); }
                        }
                        if !out.is_empty() {
                            yield Ok(Bytes::from(out));
                        }
                    } else if let Some(a) = attempt.as_mut() { a.eof(); }
                    break;
                }
                Err(_) => {
                    if let Some(out) = native.as_mut().and_then(|n| n.finish_cr_terminal()) {
                        drop(upstream);
                        yield Ok(Bytes::from(out));
                        break;
                    }
                    if let Some(a) = attempt.as_mut() { a.stop("timeout", "stream_timeout"); }
                    warn!("SSE stall timeout");
                    let out = if let Some(native) = native.as_mut() {
                        Some(native.stall())
                    } else {
                        conv.as_mut().map(|conv| {
                            conv.on_stall().into_iter().map(|r| r + "\n\n").collect::<String>().into_bytes()
                        })
                    };
                    // Release the source before yielding: the client may never poll again.
                    drop(upstream);
                    match out {
                        Some(out) if !out.is_empty() => yield Ok(Bytes::from(out)),
                        Some(_) => {},
                        None => yield Err(std::io::Error::new(std::io::ErrorKind::TimedOut,
                            format!("SSE stall: no data for {}s", stall.as_secs()))),
                    }
                    break;
                }
            }
        }
    };

    let body = Body::from_stream(byte_stream);
    let mut headers = HeaderMap::new();
    headers.insert(
        axum::http::header::CONTENT_TYPE,
        HeaderValue::from_static("text/event-stream"),
    );
    headers.insert(
        axum::http::header::CACHE_CONTROL,
        HeaderValue::from_static("no-cache"),
    );
    headers.insert(
        axum::http::header::CONNECTION,
        HeaderValue::from_static("keep-alive"),
    );
    Ok((status, headers, body).into_response())
}

#[cfg(test)]
mod settlement_ownership_tests {
    use super::*;
    use serde_json::json;

    fn attempt(store: &Store) -> crate::stream_usage::StreamAttempt {
        let connection = serde_json::from_value(json!({
            "id":"synthetic","name":"synthetic","base_url":"http://127.0.0.1:1/v1",
            "api_key":"synthetic","default_model":null,"priority":0,"enabled":true,
            "input_price_per_m":1.0,"output_price_per_m":1.0,"auth_type":"api_key","oauth":null,
            "created_at":"synthetic","updated_at":"synthetic"
        }))
        .unwrap();
        crate::stream_usage::StreamAttempt::begin(
            store,
            "generated-test-request",
            "synthetic",
            &ResolvedTarget {
                connection,
                upstream_model: "synthetic".into(),
            },
            b"{}",
        )
        .unwrap()
    }

    fn pc2_modes() -> Vec<StreamMode> {
        vec![
            StreamMode::ChatToAnthropic("m".into()),
            StreamMode::ChatToResponses("m".into()),
        ]
    }

    #[tokio::test]
    async fn pc2_converter_failure_does_not_observe_later_success_in_same_chunk() {
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let mut a = attempt(&store);
            a.headers(200);
            let wire = b"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"error\":{\"message\":\"synthetic\"}}\n\ndata: {\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":8}}\n\ndata: [DONE]\n\n";
            let source =
                futures_util::stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from_static(wire))]);
            let response = stream_body_observed(source, 5, mode, Some(a))
                .await
                .unwrap();
            let output = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            assert!(String::from_utf8_lossy(&output).contains("error"));
            let row = store.recent_usage(1).unwrap().remove(0);
            assert_eq!(
                row.outcome, "failed",
                "converter rejected before later usage/DONE"
            );
            assert!(row.prompt_tokens.is_none() && row.completion_tokens.is_none());
            assert!(row.estimated_cost_usd.is_none());
            assert!(row.finalized_at.is_some());
        }
    }

    #[tokio::test]
    async fn pc2_terminal_line_settles_and_releases_before_final_output() {
        struct Witness(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Witness {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let mut a = attempt(&store);
            a.headers(200);
            let released = Arc::new(std::sync::atomic::AtomicBool::new(false));
            let witness = Witness(released.clone());
            let source = async_stream::stream! {
                let _witness = witness;
                yield Ok::<_,std::io::Error>(Bytes::from_static(b"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n\ndata: [DONE]\n"));
                std::future::pending::<()>().await;
            };
            let response = stream_body_observed(source, 5, mode, Some(a))
                .await
                .unwrap();
            let mut body = response.into_body().into_data_stream();
            assert!(body.next().await.unwrap().is_ok());
            assert!(released.load(Ordering::SeqCst));
            let before = serde_json::to_value(store.recent_usage(1).unwrap()).unwrap();
            assert!(
                before[0]["finalized_at"].is_string(),
                "settle before final output without another poll"
            );
            assert_eq!(before[0]["outcome"], "succeeded");
            assert_eq!(before[0]["usage_status"], "complete");
            assert_eq!(before[0]["prompt_tokens"], 5);
            drop(body);
            assert_eq!(
                serde_json::to_value(store.recent_usage(1).unwrap()).unwrap(),
                before
            );
        }
    }

    #[tokio::test]
    async fn pc2_conversion_and_observer_limits_stay_independent() {
        let finish =
            "data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n";
        let tail =
            "data: {\"usage\":{\"prompt_tokens\":9,\"completion_tokens\":8}}\n\ndata: [DONE]\n\n";
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = attempt(&store);
            let wire = format!(
                "data: {}\n\n{finish}{tail}",
                json!({"choices":[{"index":0,"delta":{"content":"x".repeat(70*1024)}}]})
            );
            let source =
                futures_util::stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(wire))]);
            let response = stream_body_observed(source, 5, mode, Some(a))
                .await
                .unwrap();
            let out = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            assert!(!String::from_utf8_lossy(&out).contains("event: error"));
            let row = store.recent_usage(1).unwrap().remove(0);
            assert_eq!(row.outcome, "unknown");
            assert_eq!(row.usage_status, "invalid");
            assert_eq!(row.error.as_deref(), Some("stream_observer_limit"));
        }
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = attempt(&store);
            let wire = format!(
                "{finish}data: {}\n\n{tail}",
                "x".repeat(MAX_CONVERTED_LINE_BYTES)
            );
            let source =
                futures_util::stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(wire))]);
            let response = stream_body_observed(source, 5, mode, Some(a))
                .await
                .unwrap();
            let out = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            assert!(
                String::from_utf8_lossy(&out).contains(crate::error::INPUT_LIMIT_STREAM_MESSAGE)
            );
            let row = store.recent_usage(1).unwrap().remove(0);
            assert_eq!(row.outcome, "failed");
            assert!(row.prompt_tokens.is_none());
            assert_eq!(row.error.as_deref(), Some("stream_conversion_failed"));
        }
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = attempt(&store);
        let mut wire = finish.to_string();
        for index in 0..2049 {
            wire += &format!(
                "data: {}\n\n",
                json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":index,"id":"synthetic","function":{"name":"add","arguments":""}}]}}]})
            );
        }
        wire += tail;
        let source = futures_util::stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(wire))]);
        let response =
            stream_body_observed(source, 5, StreamMode::ChatToResponses("m".into()), Some(a))
                .await
                .unwrap();
        let out = axum::body::to_bytes(response.into_body(), 4 << 20)
            .await
            .unwrap();
        assert!(String::from_utf8_lossy(&out).contains(crate::error::STATE_LIMIT_STREAM_MESSAGE));
        let row = store.recent_usage(1).unwrap().remove(0);
        assert_eq!(row.outcome, "failed");
        assert!(row.prompt_tokens.is_none());
        assert_eq!(row.error.as_deref(), Some("stream_conversion_failed"));
    }

    #[tokio::test]
    async fn pc2_converted_terminal_uses_existing_trim_semantics() {
        for ending in [" \t\r\n", "\u{2003}\n", " \t"] {
            for mode in pc2_modes() {
                let dir = tempfile::tempdir().unwrap();
                let store = Store::open(&dir.path().join("db"), None).unwrap();
                let a = attempt(&store);
                let wire = format!("data: {{\"choices\":[{{\"index\":0,\"delta\":{{}},\"finish_reason\":\"stop\"}}]}}\n\ndata: {{\"usage\":{{\"prompt_tokens\":5,\"completion_tokens\":3}}}}\n\ndata: [DONE]{ending}");
                let source =
                    futures_util::stream::iter(vec![Ok::<_, std::io::Error>(Bytes::from(wire))]);
                let response = stream_body_observed(source, 5, mode, Some(a))
                    .await
                    .unwrap();
                let output = axum::body::to_bytes(response.into_body(), 1 << 20)
                    .await
                    .unwrap();
                assert!(!String::from_utf8_lossy(&output).contains("error"));
                let row = store.recent_usage(1).unwrap().remove(0);
                assert_eq!(row.outcome, "succeeded");
                assert_eq!(
                    row.usage_status, "complete",
                    "accepted converter terminal {ending:?}"
                );
                assert_eq!(row.prompt_tokens, Some(5));
                assert_eq!(row.completion_tokens, Some(3));
                assert!(row.error.is_none() && row.estimated_cost_usd.is_some());
            }
        }
    }

    #[tokio::test]
    async fn pc2_consumed_finish_line_survives_read_error_before_blank_delimiter() {
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = attempt(&store);
            let wire = b"data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"synthetic\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n";
            let source = futures_util::stream::iter(vec![
                Ok(Bytes::from_static(wire)),
                Err(std::io::Error::other("synthetic read error")),
            ]);
            let response = stream_body_observed(source, 5, mode, Some(a))
                .await
                .unwrap();
            let output = axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            assert!(!String::from_utf8_lossy(&output).contains("event: error"));
            let row = store.recent_usage(1).unwrap().remove(0);
            assert_eq!(
                row.outcome, "succeeded",
                "converter consumed content finish before read error"
            );
            assert_eq!(row.usage_status, "partial", "transport did not finish");
            assert_eq!(row.prompt_tokens, Some(5));
            assert_eq!(row.completion_tokens, Some(3));
            assert!(row.first_output_ms.is_some());
            assert_eq!(row.error.as_deref(), Some("upstream_transport_error"));
            assert!(row.estimated_cost_usd.is_none());
        }
    }

    #[tokio::test]
    async fn pc2_fragmented_and_eof_tails_and_pc3_never_polled_conversion() {
        let wire="data: {\"choices\":[{\"index\":0,\"delta\":{\"content\":\"synthetic\"},\"finish_reason\":\"stop\"}]}\n\ndata: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}";
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = attempt(&store);
            let chunks: Vec<_> = wire
                .bytes()
                .map(|b| Ok::<_, std::io::Error>(Bytes::from(vec![b])))
                .collect();
            let response =
                stream_body_observed(futures_util::stream::iter(chunks), 5, mode, Some(a))
                    .await
                    .unwrap();
            axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap();
            let row = store.recent_usage(1).unwrap().remove(0);
            assert_eq!(row.outcome, "succeeded");
            assert_eq!(row.usage_status, "complete");
            assert_eq!(row.prompt_tokens, Some(5));
            assert_eq!(row.completion_tokens, Some(3));
        }
        for mode in pc2_modes() {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = attempt(&store);
            let response = stream_body_observed(
                futures_util::stream::pending::<Result<Bytes, std::io::Error>>(),
                5,
                mode,
                Some(a),
            )
            .await
            .unwrap();
            drop(response);
            let row = store.recent_usage(1).unwrap().remove(0);
            assert_eq!(row.outcome, "cancelled");
            assert!(row.status.is_none() && row.finalized_at.is_some());
        }
    }

    #[tokio::test]
    async fn ss3_never_polled_body_and_terminal_then_drop_finalize_once() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = attempt(&store);
        let input = futures_util::stream::pending::<Result<Bytes, std::io::Error>>();
        let response = stream_body_observed(input, 5, StreamMode::Passthrough, Some(a))
            .await
            .unwrap();
        drop(response);
        let row = store.recent_usage(1).unwrap().remove(0);
        assert_eq!(row.outcome, "cancelled");
        assert!(row.status.is_none());
        assert!(row.finalized_at.is_some());

        let mut a = attempt(&store);
        a.headers(200);
        a.push(b"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n\ndata: [DONE]\n\n");
        let before = serde_json::to_value(store.recent_usage(1).unwrap()).unwrap();
        drop(a);
        assert_eq!(
            serde_json::to_value(store.recent_usage(1).unwrap()).unwrap(),
            before
        );
        assert_eq!(before[0]["outcome"], "succeeded");
        assert_eq!(before[0]["prompt_tokens"], 5);
    }

    #[tokio::test]
    async fn ss2_limit_observation_preserves_all_wire_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let mut a = attempt(&store);
        a.headers(200);
        let wire = Bytes::from(vec![b'x'; 65538]);
        let source = futures_util::stream::iter(vec![Ok::<_, std::io::Error>(wire.clone())]);
        let response = stream_body_observed(source, 5, StreamMode::Passthrough, Some(a))
            .await
            .unwrap();
        assert_eq!(
            axum::body::to_bytes(response.into_body(), 1 << 20)
                .await
                .unwrap(),
            wire
        );
        let row = store.recent_usage(1).unwrap().remove(0);
        assert_eq!(row.outcome, "unknown");
        assert_eq!(row.usage_status, "invalid");
        assert_eq!(row.error.as_deref(), Some("stream_observer_limit"));
    }

    #[tokio::test]
    async fn ss3_read_error_and_content_finish_drop_keep_observed_truth() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let mut a = attempt(&store);
        a.headers(200);
        let source = futures_util::stream::iter(vec![Err::<Bytes, _>(std::io::Error::other(
            "synthetic-canary-secret",
        ))]);
        let response = stream_body_observed(source, 5, StreamMode::Passthrough, Some(a))
            .await
            .unwrap();
        assert!(axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .is_err());
        let row = store.recent_usage(1).unwrap().remove(0);
        assert_eq!(row.outcome, "failed");
        assert_eq!(row.status, Some(200));
        assert_eq!(row.error.as_deref(), Some("upstream_transport_error"));
        let mut a = attempt(&store);
        a.headers(200);
        a.push(b"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":5,\"completion_tokens\":3}}\n\n");
        drop(a);
        let row = store.recent_usage(1).unwrap().remove(0);
        assert_eq!(row.outcome, "succeeded");
        assert_eq!(row.usage_status, "partial");
        assert!(row.estimated_cost_usd.is_none());
        assert_eq!(row.error.as_deref(), Some("stream_cancelled"));
        let mut a = attempt(&store);
        a.headers(200);
        a.push(b"data: {\"choices\":[{\"index\":0,\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":-1}}\n\n");
        drop(a);
        let row = store.recent_usage(1).unwrap().remove(0);
        assert_eq!(row.outcome, "succeeded");
        assert_eq!(row.usage_status, "invalid");
        assert_eq!(
            row.error.as_deref(),
            Some("stream_cancelled"),
            "local stop remains observable with invalid usage"
        );
    }
}

#[cfg(test)]
mod stream_completion_tests {
    use super::*;
    use serde_json::json;

    fn modes() -> Vec<(StreamMode, &'static str, &'static str)> {
        vec![
            (StreamMode::ChatToResponses("m".into()), "chat", "responses"),
            (StreamMode::ChatToAnthropic("m".into()), "chat", "messages"),
            (StreamMode::ResponsesToChat("m".into()), "responses", "chat"),
            (
                StreamMode::ResponsesToAnthropic("m".into()),
                "responses",
                "messages",
            ),
            (StreamMode::AnthropicToChat("m".into()), "messages", "chat"),
            (
                StreamMode::AnthropicToResponses("m".into()),
                "messages",
                "responses",
            ),
        ]
    }

    fn partial(source: &str) -> Vec<Value> {
        match source {
            "chat" => vec![
                json!({"choices":[{"delta":{"content":"片段"}}]}),
                json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"lookup","arguments":"{"}}]}}]}),
            ],
            "responses" => vec![
                json!({"type":"response.output_text.delta","delta":"片段"}),
                json!({"type":"response.output_item.added","output_index":1,"item":{"type":"function_call","id":"fc1","call_id":"c1","name":"lookup"}}),
                json!({"type":"response.function_call_arguments.delta","item_id":"fc1","delta":"{"}),
            ],
            _ => vec![
                json!({"type":"message_start","message":{"id":"msg1","usage":{"input_tokens":3}}}),
                json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"片段"}}),
                json!({"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"c1","name":"lookup"}}),
                json!({"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{"}}),
            ],
        }
    }

    async fn converted(mode: StreamMode, values: &[Value]) -> String {
        let text: String = values.iter().map(|v| format!("data: {v}\n\n")).collect();
        // Exercise the actual body adapter with arbitrary boundaries, including UTF-8 splits.
        let chunks: Vec<Result<Bytes, std::io::Error>> = text
            .as_bytes()
            .chunks(7)
            .map(|b| Ok(Bytes::copy_from_slice(b)))
            .collect();
        let response = stream_body(futures_util::stream::iter(chunks), 5, mode)
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = axum::body::to_bytes(response.into_body(), 1 << 20)
            .await
            .unwrap();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    struct DropWitness(std::sync::Arc<std::sync::atomic::AtomicBool>);
    impl Drop for DropWitness {
        fn drop(&mut self) {
            self.0.store(true, std::sync::atomic::Ordering::SeqCst);
        }
    }

    struct RetainedSource {
        chunks: std::collections::VecDeque<Bytes>,
        eof: bool,
        _witness: DropWitness,
    }
    impl futures_util::Stream for RetainedSource {
        type Item = Result<Bytes, std::io::Error>;
        fn poll_next(
            mut self: std::pin::Pin<&mut Self>,
            _: &mut std::task::Context<'_>,
        ) -> std::task::Poll<Option<Self::Item>> {
            if let Some(chunk) = self.chunks.pop_front() {
                std::task::Poll::Ready(Some(Ok(chunk)))
            } else if self.eof {
                // Deliberately retain the owned resource after returning EOF.
                std::task::Poll::Ready(None)
            } else {
                std::task::Poll::Pending
            }
        }
    }

    fn terminal_records(source: &str, outcome: &str) -> String {
        let mut values = partial(source);
        match source {
            "chat" => {
                if outcome == "failure" {
                    values.push(json!({"error":{"type":"api_error","message":"fixture failure"}}));
                } else {
                    values.push(json!({"choices":[{"delta":{},"finish_reason":if outcome=="incomplete" {"length"} else {"stop"}}]}));
                    values.push(json!({"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":23,"total_tokens":40}}));
                }
            }
            "responses" => {
                let status = match outcome {
                    "failure" => "failed",
                    "incomplete" => "incomplete",
                    _ => "completed",
                };
                let mut v = json!({"type":format!("response.{status}"),"response":{"status":status,"output":[],"usage":{"input_tokens":17,"output_tokens":23}}});
                if outcome == "failure" {
                    v["response"]["error"] = json!({"message":"fixture failure"});
                }
                if outcome == "incomplete" {
                    v["response"]["incomplete_details"] = json!({"reason":"max_output_tokens"});
                }
                values.push(v);
            }
            _ => {
                if outcome == "failure" {
                    values.push(json!({"type":"error","error":{"type":"api_error","message":"fixture failure"}}));
                } else {
                    values.push(json!({"type":"message_delta","delta":{"stop_reason":if outcome=="incomplete" {"max_tokens"} else {"end_turn"}},"usage":{"input_tokens":17,"output_tokens":23}}));
                    values.push(json!({"type":"message_stop"}));
                }
            }
        }
        let mut text: String = values.iter().map(|v| format!("data: {v}\n\n")).collect();
        if source == "chat" && outcome != "failure" {
            text.push_str("data: [DONE]\n\n");
        }
        text
    }

    fn final_frame(text: &str, target: &str) -> bool {
        text.lines()
            .filter_map(|line| line.strip_prefix("data: "))
            .any(|data| {
                if data == "[DONE]" {
                    return target == "chat";
                }
                let Ok(v) = serde_json::from_str::<Value>(data) else {
                    return false;
                };
                matches!(
                    v["type"].as_str(),
                    Some(
                        "message_stop"
                            | "response.completed"
                            | "response.incomplete"
                            | "response.failed"
                            | "error"
                    )
                )
            })
    }

    #[tokio::test]
    async fn rs3_retained_text_limit_closes_direct_and_downstream_chain() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for mode in [
            StreamMode::ChatToResponses("m".into()),
            StreamMode::AnthropicToResponses("m".into()),
        ] {
            let chat = matches!(mode, StreamMode::ChatToResponses(_));
            let mut chunks = std::collections::VecDeque::new();
            for _ in 0..17 {
                let text = "x".repeat(1024 * 1024);
                let value = if chat {
                    json!({"choices":[{"delta":{"content":text}}]})
                } else {
                    json!({"type":"content_block_delta","delta":{"text":text}})
                };
                chunks.push_back(Bytes::from(format!("data: {value}\n\n")));
            }
            let dropped = Arc::new(AtomicBool::new(false));
            let input = RetainedSource {
                chunks,
                eof: false,
                _witness: DropWitness(dropped.clone()),
            };
            let mut body = stream_body(input, 60, mode).await.unwrap().into_body();
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let frame = body
                        .frame()
                        .await
                        .expect("state limit failure")
                        .unwrap()
                        .into_data()
                        .unwrap();
                    let text = std::str::from_utf8(&frame).unwrap();
                    assert!(!text.contains("response.completed"));
                    if text.contains("upstream converter state limit exceeded") {
                        assert!(
                            dropped.load(Ordering::SeqCst),
                            "source retained after downstream failure"
                        );
                        assert!(
                            !text.contains(&"x".repeat(100)),
                            "failure replays retained payload"
                        );
                        break;
                    }
                }
            })
            .await
            .expect("limit failure without upstream EOF or idle timeout");
            assert!(body.frame().await.is_none());
        }
    }

    #[tokio::test]
    async fn rs3_default_entry_limits_release_all_retaining_routes() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for (mode, source, _) in modes() {
            if matches!(mode, StreamMode::ChatToAnthropic(_)) {
                continue;
            }
            let dropped = Arc::new(AtomicBool::new(false));
            let mut chunks = std::collections::VecDeque::new();
            for i in 0..4097 {
                let value = match source {
                    "chat" => json!({"choices":[{"delta":{"tool_calls":[{"index":i}]}}]}),
                    "responses" => {
                        json!({"type":"response.output_item.added","output_index":i,"item":{"type":"function_call","id":format!("i{i}")}})
                    }
                    _ => {
                        json!({"type":"content_block_start","index":i,"content_block":{"type":"tool_use","id":"c","name":"f"}})
                    }
                };
                chunks.push_back(Bytes::from(format!("data: {value}\n\n")));
            }
            let input = RetainedSource {
                chunks,
                eof: false,
                _witness: DropWitness(dropped.clone()),
            };
            let mut body = stream_body(input, 60, mode).await.unwrap().into_body();
            tokio::time::timeout(Duration::from_secs(5), async {
                loop {
                    let frame = body.frame().await.unwrap().unwrap().into_data().unwrap();
                    let text = std::str::from_utf8(&frame).unwrap();
                    if text.contains("upstream converter state limit exceeded") {
                        assert!(dropped.load(Ordering::SeqCst));
                        assert!(!text.contains("response.completed"));
                        assert!(!text.contains("message_stop"));
                        break;
                    }
                }
            })
            .await
            .expect("entry limits terminate without EOF");
            assert!(body.frame().await.is_none());
        }
    }

    #[tokio::test]
    async fn rs2_nonretaining_text_routes_allow_more_than_payload_budget() {
        for (mode, source, target) in modes() {
            if matches!(
                mode,
                StreamMode::ChatToResponses(_) | StreamMode::AnthropicToResponses(_)
            ) {
                continue;
            }
            let mut chunks = Vec::new();
            for _ in 0..17 {
                let text = "x".repeat(1024 * 1024);
                let value = match source {
                    "chat" => json!({"choices":[{"delta":{"content":text}}]}),
                    "responses" => json!({"type":"response.output_text.delta","delta":text}),
                    _ => json!({"type":"content_block_delta","delta":{"text":text}}),
                };
                chunks.push(Ok::<_, std::io::Error>(Bytes::from(format!(
                    "data: {value}\n\n"
                ))));
            }
            chunks.push(Ok(Bytes::from(terminal_records(source, "success"))));
            let body = stream_body(futures_util::stream::iter(chunks), 60, mode)
                .await
                .unwrap()
                .into_body();
            let out = axum::body::to_bytes(body, 24 * 1024 * 1024).await.unwrap();
            let text = std::str::from_utf8(&out).unwrap();
            assert!(!text.contains("upstream converter state limit exceeded"));
            assert!(final_frame(text, target));
            assert!(text.len() > 16 * 1024 * 1024);
        }
    }

    const INPUT_LIMIT: usize = 16 * 1024 * 1024;
    const LIMIT_MESSAGE: &str = "upstream stream line exceeds 16 MiB";

    #[tokio::test]
    async fn ib1_oversized_lines_fail_and_release_before_final_output() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for phase in ["empty", "partial", "finish", "comment"] {
            for shape in ["whole", "fragmented", "newline"] {
                for (mode, source, target) in modes() {
                    if phase == "finish" && source != "chat" {
                        continue;
                    }
                    let mut prefix = if phase == "empty" || phase == "comment" {
                        String::new()
                    } else {
                        partial(source)
                            .iter()
                            .map(|v| format!("data: {v}\n\n"))
                            .collect()
                    };
                    if phase == "finish" {
                        prefix.push_str(
                            "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
                        );
                    }
                    let mut oversized = if phase == "comment" {
                        b": PRIVATE_INPUT".to_vec()
                    } else {
                        b"data: PRIVATE_INPUT".to_vec()
                    };
                    oversized.resize(INPUT_LIMIT + 1, b'x');
                    if shape == "newline" {
                        oversized.push(b'\n');
                    }
                    let mut chunks = std::collections::VecDeque::new();
                    chunks.push_back(Bytes::from(prefix));
                    chunks.extend(
                        oversized
                            .chunks(if shape == "fragmented" {
                                65537
                            } else {
                                oversized.len()
                            })
                            .map(Bytes::copy_from_slice),
                    );
                    let dropped = Arc::new(AtomicBool::new(false));
                    let input = RetainedSource {
                        chunks,
                        eof: false,
                        _witness: DropWitness(dropped.clone()),
                    };
                    let mut body = stream_body(input, 60, mode).await.unwrap().into_body();
                    let mut all = String::new();
                    tokio::time::timeout(Duration::from_secs(2), async {
                        loop {
                            let frame = body
                                .frame()
                                .await
                                .expect("failure frame")
                                .unwrap()
                                .into_data()
                                .unwrap();
                            let text = String::from_utf8(frame.to_vec()).unwrap();
                            let failed = text.contains(LIMIT_MESSAGE);
                            all.push_str(&text);
                            if failed {
                                assert!(
                                    dropped.load(Ordering::SeqCst),
                                    "source held at failure: {source}/{target}/{phase}/{shape}"
                                );
                                break;
                            }
                        }
                    })
                    .await
                    .expect("oversized line must fail without waiting for source EOF or stall");
                    assert!(!all.contains("PRIVATE_INPUT"));
                    assert!(!all.contains("response.completed"));
                    assert!(!all.contains("message_stop"));
                    assert!(!all.contains("\"finish_reason\":\"stop\""));
                    assert!(body.frame().await.is_none());
                }
            }
        }
    }

    #[tokio::test]
    async fn ib2_exact_boundary_lines_keep_lf_crlf_and_eof_semantics() {
        for (ending, fragmented, below) in [
            ("\n", false, true),
            ("\n", false, false),
            ("\n", true, false),
            ("\r\n", false, false),
            ("\r\n", true, false),
            ("", false, false),
            ("", true, false),
        ] {
            for (mode, source, target) in modes() {
                let terminal = match source {
                    "chat" => "data: [DONE]",
                    "responses" => "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[]}}",
                    _ => "data: {\"type\":\"message_stop\"}",
                };
                let mut raw = terminal.as_bytes().to_vec();
                // CR is content for the byte bound, LF is only a delimiter.
                raw.resize(
                    INPUT_LIMIT - usize::from(below) - usize::from(ending == "\r\n"),
                    b' ',
                );
                raw.extend_from_slice(ending.as_bytes());
                let chunks: Vec<_> = raw
                    .chunks(if fragmented { 65537 } else { raw.len() })
                    .map(|b| Ok::<_, std::io::Error>(Bytes::copy_from_slice(b)))
                    .collect();
                let body = stream_body(futures_util::stream::iter(chunks), 60, mode)
                    .await
                    .unwrap()
                    .into_body();
                let out = axum::body::to_bytes(body, 1 << 20).await.unwrap();
                let text = std::str::from_utf8(&out).unwrap();
                assert!(final_frame(text, target), "{source}/{target}/{ending:?}");
                assert!(!text.contains(LIMIT_MESSAGE));
                assert!(!text.contains("api_error"));
            }
        }
    }

    #[tokio::test]
    async fn ib2_large_chunks_are_processed_per_line_and_terminal_wins() {
        for (mode, source, target) in modes() {
            let mut raw = Vec::new();
            // Two individually bounded comments already exceed the chunk-size limit.
            for _ in 0..2 {
                raw.push(b':');
                raw.extend(std::iter::repeat_n(b'c', INPUT_LIMIT / 2));
                raw.push(b'\n');
            }
            raw.extend_from_slice(terminal_records(source, "success").as_bytes());
            raw.extend(std::iter::repeat_n(b'x', INPUT_LIMIT + 1));
            let input = futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from(raw))]);
            let body = stream_body(input, 60, mode).await.unwrap().into_body();
            let out = axum::body::to_bytes(body, 1 << 20).await.unwrap();
            let text = std::str::from_utf8(&out).unwrap();
            assert!(text.contains("片段"));
            assert!(final_frame(text, target));
            assert!(!text.contains(LIMIT_MESSAGE));
            assert!(!text.contains("api_error"));
        }
    }

    #[tokio::test]
    async fn ib2_utf8_and_crlf_may_split_at_every_byte() {
        for (mode, source, target) in modes() {
            let raw = terminal_records(source, "success").replace('\n', "\r\n");
            let chunks: Vec<_> = raw
                .bytes()
                .map(|b| Ok::<_, std::io::Error>(Bytes::from(vec![b])))
                .collect();
            let body = stream_body(futures_util::stream::iter(chunks), 60, mode)
                .await
                .unwrap()
                .into_body();
            let out = axum::body::to_bytes(body, 1 << 20).await.unwrap();
            let text = std::str::from_utf8(&out).unwrap();
            assert!(text.contains("片段"));
            assert!(!text.contains('�'));
            assert!(final_frame(text, target));
            assert!(!text.contains("api_error"));
        }
    }

    #[tokio::test]
    async fn ib3_opaque_large_line_stays_byte_exact() {
        let raw = Bytes::from(vec![b'x'; INPUT_LIMIT + 1]);
        let input = futures_util::stream::iter([Ok::<_, std::io::Error>(raw.clone())]);
        let body = stream_body(input, 60, StreamMode::Passthrough)
            .await
            .unwrap()
            .into_body();
        assert_eq!(
            axum::body::to_bytes(body, INPUT_LIMIT + 2).await.unwrap(),
            raw
        );
    }

    #[tokio::test]
    async fn tr1_terminal_releases_source_before_final_frame_without_next_poll() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for outcome in ["success", "incomplete", "failure"] {
            for fragmented in [false, true] {
                let mut cases = vec![(StreamMode::NativeResponses, "responses", "responses")];
                cases.extend(modes());
                for (mode, source, target) in cases {
                    let dropped = Arc::new(AtomicBool::new(false));
                    let raw=terminal_records(source,outcome)+"data: {\"type\":\"response.output_text.delta\",\"delta\":\"AFTER_TERMINAL\"}\n\n";
                    let chunks = raw
                        .as_bytes()
                        .chunks(if fragmented { 1 } else { raw.len() })
                        .map(Bytes::copy_from_slice)
                        .collect();
                    let input = RetainedSource {
                        chunks,
                        eof: false,
                        _witness: DropWitness(dropped.clone()),
                    };
                    let mut body = stream_body(input, 60, mode).await.unwrap().into_body();
                    let mut all = String::new();
                    tokio::time::timeout(Duration::from_secs(1), async {
                        loop {
                            let bytes = body
                                .frame()
                                .await
                                .expect("final frame")
                                .unwrap()
                                .into_data()
                                .unwrap();
                            let chunk = String::from_utf8(bytes.to_vec()).unwrap();
                            let final_seen = final_frame(&chunk, target);
                            all.push_str(&chunk);
                            if final_seen {
                                assert!(
                                    dropped.load(Ordering::SeqCst),
                                    "{source}->{target}/{outcome}: source still held at terminal"
                                );
                                break;
                            }
                        }
                    })
                    .await
                    .expect("terminal does not wait for idle timeout or EOF");
                    assert!(!all.contains("AFTER_TERMINAL"));
                    assert!(body.frame().await.is_none());
                }
            }
        }
    }

    #[tokio::test]
    async fn tr2_eof_releases_retained_source_before_final_output() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for phase in 0..3 {
            let mut cases = modes();
            cases.push((StreamMode::NativeResponses, "responses", "responses"));
            for (mode, source, target) in cases {
                let dropped = Arc::new(AtomicBool::new(false));
                let mut text = if phase == 0 {
                    String::new()
                } else {
                    partial(source)
                        .iter()
                        .map(|v| format!("data: {v}\n\n"))
                        .collect()
                };
                if phase == 2 {
                    let terminal = match source {
                        "chat" => json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
                        "responses" => {
                            json!({"type":"response.completed","response":{"status":"completed","output":[]}})
                        }
                        _ => json!({"type":"message_stop"}),
                    };
                    text.push_str(&format!("data: {terminal}"));
                }
                let chunks = if text.is_empty() {
                    Default::default()
                } else {
                    [Bytes::from(text)].into()
                };
                let input = RetainedSource {
                    chunks,
                    eof: true,
                    _witness: DropWitness(dropped.clone()),
                };
                let mut body = stream_body(input, 60, mode).await.unwrap().into_body();
                let mut final_seen = false;
                while let Some(frame) = body.frame().await {
                    let chunk =
                        String::from_utf8(frame.unwrap().into_data().unwrap().to_vec()).unwrap();
                    if final_frame(&chunk, target) {
                        assert!(
                            dropped.load(Ordering::SeqCst),
                            "{source}->{target}/phase{phase}: EOF source still held"
                        );
                        final_seen = true;
                    }
                }
                assert!(final_seen);
                assert!(dropped.load(Ordering::SeqCst));
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn tr3_finish_reason_preserves_usage_tail_until_done_eof_or_stall() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for end in ["done", "eof", "stall"] {
            for (mode, target) in [
                (StreamMode::ChatToAnthropic("m".into()), "messages"),
                (StreamMode::ChatToResponses("m".into()), "responses"),
            ] {
                let dropped = Arc::new(AtomicBool::new(false));
                let first = format!(
                    "data: {}\n\ndata: {}\n\n",
                    json!({"choices":[{"delta":{"content":"piece"}}]}),
                    json!({"choices":[{"delta":{},"finish_reason":"stop"}]})
                );
                let mut tail = format!(
                    "data: {}\n\n",
                    json!({"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":23,"total_tokens":40}})
                );
                if end == "done" {
                    tail.push_str("data: [DONE]\n\n");
                }
                let input = RetainedSource {
                    chunks: [Bytes::from(first), Bytes::from(tail)].into(),
                    eof: end == "eof",
                    _witness: DropWitness(dropped.clone()),
                };
                let mut body = stream_body(input, 5, mode).await.unwrap().into_body();
                let first = body.frame().await.unwrap().unwrap().into_data().unwrap();
                assert!(String::from_utf8_lossy(&first).contains("piece"));
                assert!(
                    !dropped.load(Ordering::SeqCst),
                    "finish_reason alone must retain source for usage"
                );
                let mut all = String::from_utf8(first.to_vec()).unwrap();
                while let Some(frame) = body.frame().await {
                    let text =
                        String::from_utf8(frame.unwrap().into_data().unwrap().to_vec()).unwrap();
                    if final_frame(&text, target) {
                        assert!(dropped.load(Ordering::SeqCst));
                    }
                    all.push_str(&text);
                }
                assert!(all.contains("\"input_tokens\":17"));
                assert!(all.contains("\"output_tokens\":23"));
                assert!(!all.contains("upstream stream stalled"));
            }
        }
    }

    #[tokio::test]
    async fn tr3_opaque_terminal_bytes_remain_passthrough_until_eof() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        let dropped = Arc::new(AtomicBool::new(false));
        let raw = Bytes::from_static(b"data: [DONE]\n\ndata: opaque-tail\n\n");
        let input = RetainedSource {
            chunks: [raw.clone()].into(),
            eof: true,
            _witness: DropWitness(dropped.clone()),
        };
        let mut body = stream_body(input, 5, StreamMode::Passthrough)
            .await
            .unwrap()
            .into_body();
        assert_eq!(
            body.frame().await.unwrap().unwrap().into_data().unwrap(),
            raw
        );
        assert!(!dropped.load(Ordering::SeqCst));
        assert!(body.frame().await.is_none());
        assert!(dropped.load(Ordering::SeqCst));
    }

    const READ_ERROR_SENTINEL: &str = "https://private.invalid/?token=SENSITIVE_READ_SENTINEL";

    struct ReadErrorWitness {
        formatted: std::sync::Arc<std::sync::atomic::AtomicBool>,
        _dropped: DropWitness,
    }
    impl std::fmt::Display for ReadErrorWitness {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            self.formatted
                .store(true, std::sync::atomic::Ordering::SeqCst);
            f.write_str(READ_ERROR_SENTINEL)
        }
    }
    async fn read_error_cases(passthrough: bool) {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for phase in 0..3 {
            let cases = if passthrough {
                vec![(StreamMode::Passthrough, "chat", "opaque")]
            } else {
                let mut cases = modes();
                cases.push((StreamMode::NativeResponses, "responses", "responses"));
                cases
            };
            for (mode, source, target) in cases {
                let source_dropped = Arc::new(AtomicBool::new(false));
                let error_dropped = Arc::new(AtomicBool::new(false));
                let formatted = Arc::new(AtomicBool::new(false));
                let source_guard = DropWitness(source_dropped.clone());
                let error = ReadErrorWitness {
                    formatted: formatted.clone(),
                    _dropped: DropWitness(error_dropped.clone()),
                };
                let mut text: String = if phase == 0 {
                    String::new()
                } else {
                    partial(source)
                        .iter()
                        .map(|v| format!("data: {v}\n\n"))
                        .collect()
                };
                if phase == 2 {
                    text.push_str("data: {\"secret\":\"UNFINISHED_SENTINEL");
                }
                let input = async_stream::stream! {
                    let _guard = source_guard;
                    if !text.is_empty() { yield Ok(Bytes::from(text)); }
                    yield Err(error);
                    std::future::pending::<()>().await;
                };
                let mut body = stream_body(input, 5, mode).await.unwrap().into_body();
                let mut all = String::new();
                let mut failed = false;
                while let Some(frame) = body.frame().await {
                    match frame {
                        Ok(frame) => {
                            if let Ok(bytes) = frame.into_data() {
                                let text = String::from_utf8(bytes.to_vec()).unwrap();
                                if text.contains("upstream stream read failed") {
                                    assert!(
                                        source_dropped.load(Ordering::SeqCst),
                                        "source before final frame"
                                    );
                                    assert!(
                                        error_dropped.load(Ordering::SeqCst),
                                        "error before final frame"
                                    );
                                    failed = true;
                                }
                                all.push_str(&text);
                            }
                        }
                        Err(error) => {
                            assert!(
                                passthrough,
                                "{source}->{target}: protocol error expected, got {error}"
                            );
                            assert!(error.to_string().contains("upstream stream read failed"));
                            assert!(!error.to_string().contains(READ_ERROR_SENTINEL));
                            assert!(source_dropped.load(Ordering::SeqCst));
                            assert!(error_dropped.load(Ordering::SeqCst));
                            failed = true;
                        }
                    }
                }
                assert!(failed);
                assert!(
                    !formatted.load(Ordering::SeqCst),
                    "source error must not be formatted"
                );
                assert!(!all.contains(READ_ERROR_SENTINEL));
                if !passthrough {
                    assert!(!all.contains("UNFINISHED_SENTINEL"));
                    assert!(!all.contains("response.completed"));
                    assert!(!all.contains("message_stop"));
                    assert!(!all.contains("\"finish_reason\":\"stop\""));
                }
            }
        }
    }

    #[tokio::test]
    async fn io1_io2_read_errors_are_protocol_failures_and_release_before_yield() {
        read_error_cases(false).await;
    }

    #[tokio::test]
    async fn io2_passthrough_read_errors_are_redacted_and_release_before_yield() {
        read_error_cases(true).await;
    }

    #[tokio::test(start_paused = true)]
    async fn st1_st2_stalls_emit_errors_and_release_before_final_frame() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for phase in 0..3 {
            let mut cases = modes();
            cases.push((StreamMode::NativeResponses, "responses", "responses"));
            for (mode, source, target) in cases {
                let dropped = Arc::new(AtomicBool::new(false));
                let witness = DropWitness(dropped.clone());
                let mut text = if phase == 0 {
                    String::new()
                } else {
                    partial(source)
                        .iter()
                        .map(|v| format!("data: {v}\n\n"))
                        .collect()
                };
                if phase == 2 {
                    text.push_str("data: {\"secret\":\"unfinished");
                }
                let input = async_stream::stream! {
                    let _witness = witness;
                    if !text.is_empty() { yield Ok::<_, std::io::Error>(Bytes::from(text)); }
                    std::future::pending::<()>().await;
                };
                let mut body = stream_body(input, 1, mode).await.unwrap().into_body();
                let mut all = String::new();
                let mut saw_error = false;
                while let Some(frame) = body.frame().await {
                    let frame = frame.expect("stall is a protocol error, not a broken HTTP body");
                    if let Ok(bytes) = frame.into_data() {
                        let chunk = String::from_utf8(bytes.to_vec()).unwrap();
                        if chunk.contains("upstream stream stalled") {
                            assert!(dropped.load(Ordering::SeqCst), "release before final yield");
                            saw_error = true;
                        }
                        all.push_str(&chunk);
                    }
                }
                assert!(saw_error, "{source}->{target},phase{phase}: {all}");
                assert!(!all.contains("unfinished"));
                assert!(!all.contains("response.completed"));
                assert!(!all.contains("message_stop"));
                assert!(!all.contains("\"finish_reason\":\"stop\""));
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn st2_idle_timeout_clamps_and_resets_on_each_chunk() {
        use http_body_util::BodyExt;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for configured in [1, 7] {
            let dropped = Arc::new(AtomicBool::new(false));
            let witness = DropWitness(dropped.clone());
            let input = async_stream::stream! {
                let _witness = witness;
                for _ in 0..2 {
                    tokio::time::sleep(Duration::from_secs(4)).await;
                    yield Ok::<_, std::io::Error>(Bytes::from_static(b": heartbeat\n\n"));
                }
                std::future::pending::<()>().await;
            };
            let start = tokio::time::Instant::now();
            let mut body = stream_body(input, configured, StreamMode::Passthrough)
                .await
                .unwrap()
                .into_body();
            for seconds in [4, 8] {
                assert!(body.frame().await.unwrap().unwrap().is_data());
                assert_eq!(start.elapsed(), Duration::from_secs(seconds));
                assert!(!dropped.load(Ordering::SeqCst));
            }
            let error = body.frame().await.unwrap().unwrap_err();
            assert!(error
                .to_string()
                .contains(&format!("no data for {}s", configured.max(5))));
            assert_eq!(start.elapsed(), Duration::from_secs(8 + configured.max(5)));
            assert!(
                dropped.load(Ordering::SeqCst),
                "source dropped before yielding error"
            );
            assert!(body.frame().await.is_none());
        }
    }

    async fn known_terminals_survive_interruption(read_error: bool) {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        for with_tools in [false, true] {
            for outcome in ["success", "incomplete", "failure"] {
                let mut cases = modes();
                cases.push((StreamMode::NativeResponses, "responses", "responses"));
                for (mode, source, target) in cases {
                    let mut values = partial(source);
                    if !with_tools {
                        values.truncate(if source == "messages" { 2 } else { 1 });
                    }
                    match source {
                    "chat" => values.push(if outcome == "failure" {
                        json!({"error":{"type":"api_error","message":"fixture failure"}})
                    } else {
                        json!({"choices":[{"delta":{},"finish_reason":if outcome=="incomplete" {"length"} else {"stop"}}]})
                    }),
                    "responses" => {
                        let status = match outcome { "failure"=>"failed", "incomplete"=>"incomplete", _=>"completed" };
                        let mut terminal = json!({"type":format!("response.{status}"),"response":{"status":status,"output":[]}});
                        if outcome == "failure" { terminal["response"]["error"] = json!({"message":"fixture failure"}); }
                        if outcome == "incomplete" { terminal["response"]["incomplete_details"] = json!({"reason":"max_output_tokens"}); }
                        values.push(terminal);
                    },
                    _ => {
                        if outcome == "failure" {
                            values.push(json!({"type":"error","error":{"type":"api_error","message":"fixture failure"}}));
                        } else {
                            values.push(json!({"type":"message_delta","delta":{"stop_reason":if outcome=="incomplete" {"max_tokens"} else {"end_turn"}}}));
                            values.push(json!({"type":"message_stop"}));
                        }
                    }
                }
                    let text: String = values.iter().map(|v| format!("data: {v}\n\n")).collect();
                    let dropped = Arc::new(AtomicBool::new(false));
                    let witness = DropWitness(dropped.clone());
                    let input = async_stream::stream! {
                        let _witness = witness;
                        yield Ok::<_, std::io::Error>(Bytes::from(text));
                        if read_error { yield Err(std::io::Error::other(READ_ERROR_SENTINEL)); }
                        std::future::pending::<()>().await;
                    };
                    let response = stream_body(input, 5, mode).await.unwrap();
                    let text = String::from_utf8(
                        axum::body::to_bytes(response.into_body(), 1 << 20)
                            .await
                            .unwrap()
                            .to_vec(),
                    )
                    .unwrap();
                    assert!(
                        !text.contains("upstream stream stalled"),
                        "{source}->{target}/{outcome}: {text}"
                    );
                    assert!(!text.contains("upstream stream read failed"));
                    assert!(!text.contains(READ_ERROR_SENTINEL));
                    if outcome == "failure" {
                        assert!(text.contains("fixture failure"));
                    } else {
                        let terminal = match (target, outcome) {
                            ("chat", _) if with_tools && source == "responses" => {
                                "\"finish_reason\":\"tool_calls\""
                            }
                            ("messages", _) if with_tools && source == "responses" => "tool_use",
                            ("chat", "success") if with_tools => "\"finish_reason\":\"tool_calls\"",
                            ("responses", "incomplete") => "response.incomplete",
                            ("responses", _) => "response.completed",
                            ("messages", "incomplete") => "max_tokens",
                            ("messages", _) => "end_turn",
                            (_, "incomplete") => "\"finish_reason\":\"length\"",
                            _ => "\"finish_reason\":\"stop\"",
                        };
                        assert!(
                            text.contains(terminal),
                            "{source}->{target}/{outcome}: {text}"
                        );
                    }
                    assert!(dropped.load(Ordering::SeqCst));
                }
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn st3_known_terminals_survive_idle_upstream_without_timeout_error() {
        known_terminals_survive_interruption(false).await;
    }

    #[tokio::test(start_paused = true)]
    async fn io3_known_terminals_survive_read_errors() {
        known_terminals_survive_interruption(true).await;
    }

    #[tokio::test]
    async fn io3_native_delimited_cr_terminals_survive_but_fragments_fail() {
        for status in ["completed", "incomplete", "failed"] {
            for ending in ["\n\n", "\r\n\r\n", "\r\r", "\n", "\r\n", "\r"] {
                let terminal = format!("data: {{\"type\":\"response.{status}\",\"response\":{{\"status\":\"{status}\"}}}}{ending}");
                let expected = terminal.clone();
                let dropped = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
                let witness = DropWitness(dropped.clone());
                let input = async_stream::stream! {
                    let _witness = witness;
                    yield Ok::<_, std::io::Error>(Bytes::from(terminal));
                    yield Err(std::io::Error::other(READ_ERROR_SENTINEL));
                    std::future::pending::<()>().await;
                };
                let response = stream_body(input, 5, StreamMode::NativeResponses)
                    .await
                    .unwrap();
                let text = String::from_utf8(
                    axum::body::to_bytes(response.into_body(), 4096)
                        .await
                        .unwrap()
                        .to_vec(),
                )
                .unwrap();
                if ["\n\n", "\r\n\r\n", "\r\r"].contains(&ending) {
                    assert_eq!(text, expected);
                } else {
                    assert!(text.contains("upstream_stream_read_error"));
                    assert!(text.contains("upstream stream read failed"));
                    assert!(!text.contains(&format!("response.{status}")));
                }
                assert!(!text.contains(READ_ERROR_SENTINEL));
                assert!(dropped.load(std::sync::atomic::Ordering::SeqCst));
            }
        }
    }

    #[tokio::test]
    async fn nr2_native_terminal_closes_without_waiting_for_upstream_eof() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        struct OnDrop(Arc<AtomicBool>);
        impl Drop for OnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let dropped = Arc::new(AtomicBool::new(false));
        let marker = OnDrop(dropped.clone());
        let terminal =
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n";
        let upstream = async_stream::stream! {
            let _marker = marker;
            yield Ok::<Bytes, std::io::Error>(Bytes::from_static(terminal.as_bytes()));
            std::future::pending::<()>().await;
        };
        let response = stream_body(upstream, 5, StreamMode::NativeResponses)
            .await
            .unwrap();
        let bytes = tokio::time::timeout(
            Duration::from_secs(1),
            axum::body::to_bytes(response.into_body(), 4096),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(bytes.as_ref(), terminal.as_bytes());
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn nr3_cr_terminal_survives_idle_upstream() {
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };
        struct OnDrop(Arc<AtomicBool>);
        impl Drop for OnDrop {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let dropped = Arc::new(AtomicBool::new(false));
        let marker = OnDrop(dropped.clone());
        let terminal =
            "data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\r\r";
        let upstream = async_stream::stream! {
            let _marker = marker;
            yield Ok::<Bytes, std::io::Error>(Bytes::from_static(terminal.as_bytes()));
            std::future::pending::<()>().await;
        };
        let response = stream_body(upstream, 5, StreamMode::NativeResponses)
            .await
            .unwrap();
        let bytes = tokio::time::timeout(
            Duration::from_secs(6),
            axum::body::to_bytes(response.into_body(), 4096),
        )
        .await
        .unwrap()
        .unwrap();
        assert_eq!(bytes.as_ref(), terminal.as_bytes());
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn sc1_premature_eof_in_all_converters_and_chains_is_failure() {
        for empty in [false, true] {
            for (mode, source, target) in modes() {
                let values = if empty { Vec::new() } else { partial(source) };
                let text = converted(mode, &values).await;
                let events: Vec<Value> = text
                    .lines()
                    .filter_map(|l| l.strip_prefix("data: "))
                    .filter_map(|d| serde_json::from_str(d).ok())
                    .collect();
                assert!(
                    events
                        .iter()
                        .any(|v| v.get("error").is_some() || v["type"] == "error"),
                    "{source}->{target}, empty={empty}: {text}"
                );
                assert!(!text.contains("response.completed"), "{text}");
                assert!(!text.contains("message_stop"), "{text}");
                assert!(
                    !text.contains("response.function_call_arguments.done"),
                    "{text}"
                );
                assert!(
                    !events.iter().any(|v| v
                        .pointer("/choices/0/finish_reason")
                        .is_some_and(|f| !f.is_null())),
                    "{text}"
                );
                if target == "responses" {
                    assert_eq!(events.last().unwrap()["type"], "response.failed", "{text}");
                }
                if !empty {
                    assert!(text.contains("片段"), "partial UTF-8 text lost: {text}");
                }
            }
        }
    }

    #[test]
    fn sc2_completed_and_limited_streams_remain_terminal() {
        for limited in [false, true] {
            for (mode, source, target) in modes() {
                let mut conv = converter(mode).unwrap();
                let mut out = Vec::new();
                let values = partial(source);
                let count = if source == "messages" { 2 } else { 1 };
                for value in values.iter().take(count) {
                    out.extend(conv.on_data(&value.to_string()));
                }
                let terminals = match source {
                    "chat" => vec![
                        json!({"choices":[{"delta":{},"finish_reason":if limited {"length"} else {"stop"}}],"usage":{"prompt_tokens":3,"completion_tokens":2}}),
                    ],
                    "responses" => vec![
                        json!({"type":if limited {"response.incomplete"} else {"response.completed"},"response":{"status":if limited {"incomplete"} else {"completed"},"incomplete_details":if limited {json!({"reason":"max_output_tokens"})} else {Value::Null},"usage":{"input_tokens":3,"output_tokens":2}}}),
                    ],
                    _ => vec![
                        json!({"type":"message_delta","delta":{"stop_reason":if limited {"max_tokens"} else {"end_turn"}},"usage":{"input_tokens":3,"output_tokens":2}}),
                        json!({"type":"message_stop"}),
                    ],
                };
                for value in terminals {
                    out.extend(conv.on_data(&value.to_string()));
                }
                // Chat intentionally omits [DONE]: a finish_reason is sufficient.
                out.extend(conv.on_end());
                assert!(
                    conv.on_end().is_empty(),
                    "duplicate EOF: {source}->{target}"
                );
                let text = out.join("\n\n");
                assert!(!text.contains("before completion"), "{text}");
                let events: Vec<Value> = text
                    .lines()
                    .filter_map(|l| l.strip_prefix("data: "))
                    .filter_map(|d| serde_json::from_str(d).ok())
                    .collect();
                let last = events.last().unwrap();
                match target {
                    "responses" => {
                        assert_eq!(
                            last["type"],
                            if limited {
                                "response.incomplete"
                            } else {
                                "response.completed"
                            },
                            "{text}"
                        );
                        assert_eq!(last["response"]["usage"]["total_tokens"], 5, "{text}");
                    }
                    "messages" => {
                        assert_eq!(last["type"], "message_stop", "{text}");
                        let delta = events
                            .iter()
                            .find(|v| v["type"] == "message_delta")
                            .unwrap();
                        assert_eq!(
                            delta["delta"]["stop_reason"],
                            if limited { "max_tokens" } else { "end_turn" },
                            "{text}"
                        );
                        assert_eq!(delta["usage"]["output_tokens"], 2, "{text}");
                    }
                    _ => {
                        assert_eq!(
                            last["choices"][0]["finish_reason"],
                            if limited { "length" } else { "stop" },
                            "{text}"
                        );
                        assert_eq!(last["usage"]["total_tokens"], 5, "{text}");
                    }
                }
            }
        }
    }

    #[test]
    fn sc2_explicit_errors_and_responses_done_are_not_success() {
        for (mode, source, target) in modes() {
            let mut conv = converter(mode).unwrap();
            let error = match source {
                "responses" => {
                    json!({"type":"response.failed","response":{"error":{"message":"fixture failure"}}})
                }
                "messages" => json!({"type":"error","error":{"message":"fixture failure"}}),
                _ => json!({"error":{"message":"fixture failure"}}),
            };
            let out = conv.on_data(&error.to_string()).join("\n");
            assert!(out.contains("fixture failure"), "{source}->{target}: {out}");
            assert!(
                conv.on_end().is_empty(),
                "error must stay terminal: {source}->{target}"
            );
            assert!(
                !out.contains("response.completed") && !out.contains("message_stop"),
                "{out}"
            );
        }
        for mode in [
            StreamMode::ResponsesToChat("m".into()),
            StreamMode::ResponsesToAnthropic("m".into()),
        ] {
            let mut conv = converter(mode).unwrap();
            let out = conv.on_data("[DONE]").join("\n");
            assert!(
                out.contains(crate::error::INCOMPLETE_STREAM_MESSAGE),
                "{out}"
            );
            assert!(!out.contains("message_stop"), "{out}");
            assert!(conv
                .on_data(r#"{"type":"response.completed","response":{}}"#)
                .is_empty());
            assert!(conv.on_end().is_empty());
        }
    }
}

#[cfg(test)]
mod diagnostic_tests {
    use super::*;
    use std::sync::atomic::AtomicBool;
    struct Witness(Arc<AtomicBool>);
    impl Drop for Witness {
        fn drop(&mut self) {
            self.0.store(true, Ordering::SeqCst);
        }
    }
    #[tokio::test]
    async fn dg2_diagnostic_cancellation_is_non_retryable_and_drops_source() {
        for pre_cancel in [true, false] {
            let dropped = Arc::new(AtomicBool::new(false));
            let witness = Witness(dropped.clone());
            let source = async_stream::stream! {let _witness=witness;yield Ok::<_,std::io::Error>(Bytes::from_static(b"partial"));std::future::pending::<()>().await;};
            let resp = reqwest::Response::from(
                axum::http::Response::builder()
                    .status(401)
                    .body(reqwest::Body::wrap_stream(source))
                    .unwrap(),
            );
            let cancel = CancellationToken::new();
            if pre_cancel {
                cancel.cancel();
            }
            let future = read_diagnostic_cancel(resp, &cancel);
            tokio::pin!(future);
            if !pre_cancel {
                assert!(futures_util::poll!(&mut future).is_pending());
                cancel.cancel();
            }
            let e = future.await.expect_err("cancellation");
            assert_eq!(e.status, 499);
            assert!(!e.retryable);
            assert_eq!(e.body, "client disconnected");
            assert!(dropped.load(Ordering::SeqCst));
        }
    }
}

#[cfg(test)]
mod cost_completeness_tests {
    use super::*;

    #[test]
    fn ce2_invalid_or_missing_cost_inputs_never_become_estimates() {
        for tokens in [None, Some(-1)] {
            assert_eq!(estimate_cost(tokens, Some(3), Some(1.0), Some(2.0)), None);
            assert_eq!(estimate_cost(Some(2), tokens, Some(1.0), Some(2.0)), None);
        }
        for price in [
            None,
            Some(-1.0),
            Some(f64::NAN),
            Some(f64::INFINITY),
            Some(f64::NEG_INFINITY),
        ] {
            assert_eq!(estimate_cost(Some(2), Some(3), price, Some(2.0)), None);
            assert_eq!(estimate_cost(Some(2), Some(3), Some(1.0), price), None);
        }
        assert_eq!(
            estimate_cost(Some(2), Some(3), Some(f64::MAX), Some(1.0)),
            None
        );
        assert_eq!(
            estimate_cost(Some(2), Some(3), Some(0.0), Some(0.0)),
            Some(0.0)
        );
    }

    #[test]
    fn ce1_raw_usage_preserves_absent_and_invalid_counts_in_all_body_kinds() {
        for (kind, field, pk, ck) in [
            (
                UpstreamBodyKind::OpenAiChat,
                "usage",
                "prompt_tokens",
                "completion_tokens",
            ),
            (
                UpstreamBodyKind::OpenAiResponses,
                "usage",
                "input_tokens",
                "output_tokens",
            ),
            (
                UpstreamBodyKind::Antigravity,
                "usageMetadata",
                "promptTokenCount",
                "candidatesTokenCount",
            ),
        ] {
            for wrapped in [false, true] {
                if wrapped && !matches!(kind, UpstreamBodyKind::Antigravity) {
                    continue;
                }
                for (value, expected) in [
                    (Value::Null, None),
                    (json!(-1), None),
                    (json!(1.5), None),
                    (json!("2"), None),
                    (json!(u64::MAX), None),
                    (json!(0), Some(0)),
                    (json!(2), Some(2)),
                ] {
                    for missing in [pk, ck] {
                        let mut v = json!({field: {pk: 3, ck: 3}});
                        v[field][missing] = value.clone();
                        if wrapped {
                            v = json!({"response":v});
                        }
                        let bytes = Bytes::from(serde_json::to_vec(&v).unwrap());
                        let want = if missing == pk {
                            (expected, Some(3))
                        } else {
                            (Some(3), expected)
                        };
                        assert_eq!(extract_upstream_usage(&bytes, kind), want);
                    }
                }
                let mut v = json!({field: {pk: 3}});
                if wrapped {
                    v = json!({"response":v});
                }
                assert_eq!(
                    extract_upstream_usage(&Bytes::from(v.to_string()), kind),
                    (Some(3), None)
                );
                assert_eq!(
                    extract_upstream_usage(&Bytes::from_static(b"{}"), kind),
                    (None, None)
                );
                assert_eq!(
                    extract_upstream_usage(&Bytes::from_static(b"invalid"), kind),
                    (None, None)
                );
            }
        }
    }
}

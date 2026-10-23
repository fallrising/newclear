use std::net::SocketAddr;
use std::sync::atomic::AtomicU64;
use std::sync::Arc;

use anyhow::Result;
use axum::body::Bytes;
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::{Json, Router};
use serde_json::{json, Value};
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::trace::TraceLayer;
use tracing::info;

use crate::admin;
use crate::cancel::CancelOnDrop;
use crate::claude;
use crate::config::AppConfig;
use crate::cooldown::CooldownMap;
use crate::error::{AppError, AppResult};
use crate::guard::{self, Sessions};
use crate::http_client;
use crate::proxy::{self, ProxyState};
use crate::resolve;
use crate::responses;
use crate::store::Store;
use crate::web;

#[derive(Clone)]
pub struct AppState {
    pub cfg: AppConfig,
    pub store: Store,
    pub proxy: ProxyState,
    pub sessions: Sessions,
}

pub fn build_app(state: AppState) -> Router {
    // One gateway-key gate for both the /v1 and the bare path families.
    let inference = Router::new()
        .route("/chat/completions", post(chat_completions))
        .route("/messages", post(anthropic_messages))
        .route("/responses", post(openai_responses))
        .route("/models", get(list_models))
        .route_layer(middleware::from_fn_with_state(
            state.clone(),
            require_api_key,
        ));

    Router::new()
        .route("/health", get(health))
        // Claude Code MCP helper callback: authorized by the run's own token only.
        .route(crate::claude_mcp::CALLBACK_PATH, post(claude_mcp_callback))
        .nest("/v1", inference.clone())
        .merge(inference)
        .merge(admin::router())
        .merge(web::router())
        .layer(middleware::from_fn_with_state(
            state.clone(),
            guard::request_guard,
        ))
        .layer(RequestBodyLimitLayer::new(10 * 1024 * 1024))
        .layer(TraceLayer::new_for_http())
        .with_state(state)
}

pub async fn run(mut cfg: AppConfig) -> Result<()> {
    let addr = cfg.validate_listener()?;
    if let Some(path) = cfg.ensure_admin_token()? {
        info!(path = %path.display(), "admin token file (read it to log in; never logged)");
    }
    let store = Store::open(&cfg.db_path(), cfg.secrets_key.clone())?;
    let http = http_client::build_http_client()?;

    let state = AppState {
        cfg: cfg.clone(),
        store: store.clone(),
        proxy: ProxyState {
            http,
            store: store.clone(),
            cooldown: CooldownMap::new(),
            rr_counter: Arc::new(AtomicU64::new(0)),
            sse_stall_secs: cfg.sse_stall_secs,
            token_saver: cfg.token_saver,
            token_saver_max_chars: cfg.token_saver_max_chars,
            provider_base_overrides: cfg.provider_base_overrides.clone(),
            claude_code: crate::claude_code::ClaudeCode::new(
                cfg.claude_bin.clone(),
                &cfg.data_dir,
                cfg.claude_max_runs,
            )
            .with_idle(std::time::Duration::from_secs(cfg.claude_idle_secs.max(1)))
            .with_store(store.clone()),
            cursor_cli: crate::cursor_cli::CursorCli::new(
                cfg.cursor_bin.clone(),
                &cfg.data_dir,
                cfg.cursor_max_runs,
            )
            .with_container(
                cfg.cursor_image.clone(),
                cfg.cursor_profile_volume.clone(),
                cfg.cursor_runtime_bin.clone(),
            )
            .accept_account_plugins(cfg.cursor_accept_account_plugins),
        },
        sessions: Sessions::default(),
    };

    let state_callback_base = state.proxy.claude_code.callback_base.clone();
    let claude_runs = state.proxy.claude_code.clone();
    claude_runs.sweep_sessions(true);
    {
        let runs = claude_runs.clone();
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(600)).await;
                runs.sweep_sessions(false);
            }
        });
    }
    let app = build_app(state);

    info!(%addr, data_dir = %cfg.data_dir.display(), "thinrouter listening");
    info!("  proxy     : http://{addr}/v1/chat/completions");
    info!("  claude    : http://{addr}/v1/messages");
    info!("  responses : http://{addr}/v1/responses");
    info!("  admin     : http://{addr}/admin");
    if cfg.token_saver {
        info!(max_chars = cfg.token_saver_max_chars, "token-saver enabled");
    }

    let listener = tokio::net::TcpListener::bind(addr).await?;
    let bound = listener.local_addr()?;
    let host = if bound.ip().is_unspecified() {
        "127.0.0.1".to_string()
    } else {
        match bound.ip() {
            std::net::IpAddr::V6(ip) => format!("[{ip}]"),
            ip => ip.to_string(),
        }
    };
    let _ = state_callback_base.set(format!("http://{host}:{}", bound.port()));
    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<SocketAddr>(),
    )
    .with_graceful_shutdown(shutdown_signal())
    .await?;
    // SIGTERM every live Claude Code run and wait, so none is killed holding its lock.
    claude_runs.shutdown().await;
    Ok(())
}

async fn shutdown_signal() {
    // Ctrl-C, or SIGTERM from systemd / docker stop.
    #[cfg(unix)]
    {
        let mut term =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate()).ok();
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = async {
                match term.as_mut() {
                    Some(t) => { t.recv().await; }
                    None => std::future::pending::<()>().await,
                }
            } => {}
        }
    }
    #[cfg(not(unix))]
    let _ = tokio::signal::ctrl_c().await;
    info!("shutdown signal received");
}

/// The MCP helper of a live Claude Code run asks for a client tool result. The run's
/// secret token comes in a header (never the URL, which request logs may show);
/// proxied requests are refused.
async fn claude_mcp_callback(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(params): Json<Value>,
) -> Response {
    let token = headers
        .get(crate::claude_mcp::TOKEN_HEADER)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if guard::has_forwarding_headers(&headers) || token.is_empty() {
        return AppError::Unauthorized.into_response();
    }
    match state.proxy.claude_code.mcp_call(token, &params).await {
        Some(result) => Json(result).into_response(),
        None => AppError::NotFound("no such Claude Code run".into()).into_response(),
    }
}

async fn health() -> impl IntoResponse {
    Json(json!({"status": "ok", "service": "thinrouter"}))
}

async fn require_api_key(
    State(state): State<AppState>,
    request: Request,
    next: Next,
) -> Result<Response, AppError> {
    let remote = guard::is_remote(guard::peer_addr(&request), request.headers());
    ensure_api_key(&state, request.headers(), remote)?;
    Ok(next.run(request).await)
}

fn extract_api_key(headers: &HeaderMap) -> Option<String> {
    if let Some(v) = headers.get(header::AUTHORIZATION) {
        if let Ok(s) = v.to_str() {
            let s = s.trim();
            if let Some(rest) = s
                .strip_prefix("Bearer ")
                .or_else(|| s.strip_prefix("bearer "))
            {
                return Some(rest.trim().to_string());
            }
        }
    }
    if let Some(v) = headers.get("x-api-key") {
        if let Ok(s) = v.to_str() {
            return Some(s.trim().to_string());
        }
    }
    None
}

async fn chat_completions(State(state): State<AppState>, body: Bytes) -> AppResult<Response> {
    let (guard, cancel) = CancelOnDrop::new();

    let (public_model, stream) = proxy::extract_model_and_stream(&body)?;
    let resolved = resolve::resolve_targets(&state.store, &public_model)?;
    proxy::handle_chat_with_fallback(
        &state.proxy,
        &public_model,
        body,
        stream,
        resolved.targets,
        &resolved.strategy,
        cancel,
        guard,
    )
    .await
}

async fn anthropic_messages(State(state): State<AppState>, body: Bytes) -> AppResult<Response> {
    let (guard, cancel) = CancelOnDrop::new();

    let (public_model, stream) = claude::extract_anthropic_model_stream(&body)?;
    let resolved = resolve::resolve_targets(&state.store, &public_model)?;
    proxy::handle_anthropic_messages(
        &state.proxy,
        &public_model,
        body,
        stream,
        resolved.targets,
        &resolved.strategy,
        cancel,
        guard,
    )
    .await
}

async fn openai_responses(State(state): State<AppState>, body: Bytes) -> AppResult<Response> {
    let (guard, cancel) = CancelOnDrop::new();

    let (public_model, stream) = responses::extract_responses_model_stream(&body)?;
    let resolved = resolve::resolve_targets(&state.store, &public_model)?;
    proxy::handle_responses(
        &state.proxy,
        &public_model,
        body,
        stream,
        resolved.targets,
        &resolved.strategy,
        cancel,
        guard,
    )
    .await
}

/// `remote`: the request came through a proxy/tunnel or from a non-loopback peer.
fn ensure_api_key(state: &AppState, headers: &HeaderMap, remote: bool) -> AppResult<()> {
    let key = extract_api_key(headers);
    match key {
        Some(k) if state.store.verify_api_key(&k)? => Ok(()),
        Some(_) => Err(AppError::Unauthorized),
        None => {
            if !headers.contains_key(header::AUTHORIZATION)
                && !headers.contains_key("x-api-key")
                && state.cfg.allow_keyless_bootstrap
                && state.cfg.loopback_listener()
                && !remote
                && !state.store.has_api_keys()?
            {
                Ok(())
            } else {
                Err(AppError::Unauthorized)
            }
        }
    }
}

async fn list_models(State(state): State<AppState>) -> AppResult<Json<Value>> {
    let mut data = Vec::new();
    for route in state.store.list_routes()? {
        data.push(json!({
            "id": route.public_model,
            "object": "model",
            "owned_by": "thinrouter",
            "kind": "route",
        }));
    }
    for conn in state.store.list_connections()? {
        if !conn.enabled {
            continue;
        }
        if let Some(m) = &conn.default_model {
            data.push(json!({
                "id": format!("{}/{}", conn.name, m),
                "object": "model",
                "owned_by": conn.name,
                "kind": "connection",
            }));
        }
        data.push(json!({
            "id": conn.name,
            "object": "model",
            "owned_by": conn.name,
            "kind": "connection_default",
        }));
    }
    Ok(Json(json!({
        "object": "list",
        "data": data,
    })))
}

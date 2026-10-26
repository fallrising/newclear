//! Refresh OAuth / session tokens for personal subscription providers.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};

use chrono::{Duration, Utc};
use serde::Deserialize;
use tracing::{info, warn};

use crate::error::{AppError, AppResult};
use crate::store::{ConnectionRow, Store};

#[derive(Debug, Clone)]
pub struct RefreshedTokens {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at: Option<String>,
}

/// True if access token should be refreshed (missing expiry, or within lead window).
pub fn needs_refresh(conn: &ConnectionRow, lead_secs: i64) -> bool {
    if crate::borrowed::source(conn).is_some() {
        return false;
    }
    let Some(oauth) = &conn.oauth else {
        return false;
    };
    if oauth.refresh_token.as_deref().unwrap_or("").is_empty() {
        return false;
    }
    let Some(exp) = oauth.expires_at.as_deref() else {
        // No expiry recorded — refresh if access looks empty or always for agy after import.
        return oauth.access_token.is_empty()
            || conn.oauth.as_ref().map(|o| o.provider.as_str()) == Some("agy");
    };
    // Support RFC3339 or unix ms / seconds as string numbers
    if let Ok(ms) = exp.parse::<i64>() {
        let exp_ms = if ms > 1_000_000_000_000 {
            ms
        } else {
            ms * 1000
        };
        let now = Utc::now().timestamp_millis();
        return exp_ms - now < lead_secs * 1000;
    }
    if let Ok(dt) = chrono::DateTime::parse_from_rfc3339(exp) {
        let deadline = Utc::now() + Duration::seconds(lead_secs);
        return dt.with_timezone(&Utc) <= deadline;
    }
    // unparsed expiry → try refresh
    true
}

/// One refresh at a time per connection: refresh tokens rotate, so two concurrent
/// refreshes with the same token would invalidate the session.
fn refresh_lock(connection_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> = OnceLock::new();
    LOCKS
        .get_or_init(Default::default)
        .lock()
        .unwrap()
        .entry(connection_id.to_string())
        .or_default()
        .clone()
}

pub async fn refresh_connection(store: &Store, conn: &ConnectionRow) -> AppResult<ConnectionRow> {
    if crate::borrowed::source(conn).is_some() {
        return Err(AppError::BadRequest(format!(
            "not refreshed: {}",
            crate::borrowed::GROK_HINT
        )));
    }
    let lock = refresh_lock(&conn.id);
    let _guard = lock.lock().await;
    // Re-read under the lock: if another task already rotated the token, use its result.
    let current = store
        .get_connection(&conn.id)
        .map_err(AppError::Internal)?
        .ok_or_else(|| AppError::NotFound("connection not found".into()))?;
    let stale = |c: &ConnectionRow| c.oauth.as_ref().and_then(|o| o.refresh_token.clone());
    if stale(&current) != stale(conn) {
        return Ok(current);
    }
    let conn = &current;
    let oauth = conn
        .oauth
        .as_ref()
        .ok_or_else(|| AppError::BadRequest("not an oauth connection".into()))?;
    let refresh = oauth
        .refresh_token
        .as_deref()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| AppError::BadRequest("no refresh_token stored".into()))?;

    let provider = oauth.provider.as_str();
    info!(connection = %conn.name, provider, "refreshing oauth token");

    let tokens = match provider {
        "siwc" => {
            let client_id = oauth
                .meta
                .as_deref()
                .and_then(|m| serde_json::from_str::<serde_json::Value>(m).ok())
                .and_then(|m| {
                    m.get("client_id")
                        .and_then(|c| c.as_str())
                        .map(str::to_string)
                })
                .ok_or_else(|| {
                    AppError::BadRequest("siwc connection has no client_id; run login-siwc".into())
                })?;
            let http = crate::http_client::build_http_client().map_err(AppError::Internal)?;
            let t = crate::siwc::refresh(&http, crate::siwc::AUTH_BASE, &client_id, refresh)
                .await
                .map_err(|e| AppError::Upstream {
                    status: 401,
                    body: e.to_string(),
                })?;
            RefreshedTokens {
                expires_at: t.expires_at(),
                access_token: t.access_token,
                refresh_token: t.refresh_token,
            }
        }
        "grok" | "xai" | "grok_cli" => refresh_xai(refresh).await?,
        "agy" | "ag" | "antigravity" => refresh_google_antigravity(refresh).await?,
        other => {
            return Err(AppError::BadRequest(format!(
                "refresh not implemented for provider '{other}'"
            )));
        }
    };

    store
        .update_oauth_tokens(
            &conn.id,
            &tokens.access_token,
            tokens.refresh_token.as_deref(),
            tokens.expires_at.as_deref(),
        )
        .map_err(AppError::Internal)?;

    store
        .get_connection(&conn.id)
        .map_err(AppError::Internal)?
        .ok_or_else(|| AppError::NotFound("connection missing after refresh".into()))
}

/// Ensure connection has a fresh access token when possible.
pub async fn ensure_fresh(store: &Store, conn: ConnectionRow) -> AppResult<ConnectionRow> {
    if conn.auth_type != "oauth_import" {
        return Ok(conn);
    }
    if !needs_refresh(&conn, 300) {
        return Ok(conn);
    }
    match refresh_connection(store, &conn).await {
        Ok(c) => Ok(c),
        Err(e) => {
            warn!(
                connection = %conn.name,
                error = %e,
                "oauth refresh failed; continuing with existing token"
            );
            Ok(conn)
        }
    }
}

async fn refresh_failure(resp: reqwest::Response, provider: &str) -> AppError {
    let text = crate::collection::diagnostic_text(resp).await;
    AppError::Upstream {
        status: 401,
        body: format!("{provider} refresh failed: {text}"),
    }
}

async fn refresh_xai(refresh_token: &str) -> AppResult<RefreshedTokens> {
    let client = crate::http_client::build_http_client().map_err(AppError::Internal)?;
    let resp = client
        .post("https://auth.x.ai/oauth2/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(format!(
            "grant_type=refresh_token&refresh_token={}&client_id={}",
            urlencoding_minimal(refresh_token),
            "b1a00492-073a-47ea-816f-4c329264a828"
        ))
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("xai refresh: {e}")))?;
    if !resp.status().is_success() {
        return Err(refresh_failure(resp, "xai/grok").await);
    }
    refresh_success(resp, "xai").await
}

async fn refresh_google_antigravity(refresh_token: &str) -> AppResult<RefreshedTokens> {
    // Do not hardcode Google OAuth client secrets in source (GitHub push protection).
    // Set THINROUTER_AGY_CLIENT_ID + THINROUTER_AGY_CLIENT_SECRET (Antigravity IDE public client).
    let client_id = std::env::var("THINROUTER_AGY_CLIENT_ID").map_err(|_| {
        AppError::BadRequest(
            "agy refresh needs THINROUTER_AGY_CLIENT_ID (see docs/PROVIDERS.md)".into(),
        )
    })?;
    let client_secret = std::env::var("THINROUTER_AGY_CLIENT_SECRET").map_err(|_| {
        AppError::BadRequest(
            "agy refresh needs THINROUTER_AGY_CLIENT_SECRET (see docs/PROVIDERS.md)".into(),
        )
    })?;
    let client = crate::http_client::build_http_client().map_err(AppError::Internal)?;
    let body = format!(
        "grant_type=refresh_token&refresh_token={}&client_id={}&client_secret={}",
        urlencoding_minimal(refresh_token),
        urlencoding_minimal(&client_id),
        urlencoding_minimal(&client_secret),
    );
    let resp = client
        .post("https://oauth2.googleapis.com/token")
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(body)
        .send()
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("google refresh: {e}")))?;
    if !resp.status().is_success() {
        return Err(refresh_failure(resp, "antigravity/google").await);
    }
    refresh_success(resp, "google").await
}

/// Parsing completes before refresh_connection can persist any token fields.
async fn refresh_success(resp: reqwest::Response, provider: &str) -> AppResult<RefreshedTokens> {
    #[derive(Deserialize)]
    struct Tok {
        access_token: String,
        refresh_token: Option<String>,
        expires_in: Option<i64>,
    }
    let bytes = crate::collection::token_body(resp.bytes_stream())
        .await
        .map_err(|e| AppError::Internal(anyhow::anyhow!("{provider} refresh json: {e}")))?;
    let tok: Tok = serde_json::from_slice(&bytes).map_err(|_| {
        AppError::Internal(anyhow::anyhow!(
            "{provider} refresh json: invalid token response"
        ))
    })?;
    Ok(RefreshedTokens {
        access_token: tok.access_token,
        refresh_token: tok.refresh_token,
        expires_at: tok
            .expires_in
            .map(|s| (Utc::now() + Duration::seconds(s)).to_rfc3339()),
    })
}

fn urlencoding_minimal(s: &str) -> String {
    // percent-encode reserved
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn dg3_refresh_failure_preserves_prefix_and_status() {
        use crate::collection::{DIAGNOSTIC_LIMIT_MESSAGE, MAX_DIAGNOSTIC_BYTES};
        for label in ["xai/grok", "antigravity/google"] {
            for bytes in [
                b"denied".to_vec(),
                vec![b'x'; MAX_DIAGNOSTIC_BYTES],
                vec![b'x'; MAX_DIAGNOSTIC_BYTES + 1],
                vec![0xff],
            ] {
                let expected = if bytes.len() > MAX_DIAGNOSTIC_BYTES {
                    DIAGNOSTIC_LIMIT_MESSAGE.into()
                } else {
                    String::from_utf8_lossy(&bytes).into_owned()
                };
                let resp = reqwest::Response::from(
                    axum::http::Response::builder()
                        .status(503)
                        .body(bytes)
                        .unwrap(),
                );
                let e = super::refresh_failure(resp, label).await;
                assert!(
                    matches!(e,crate::error::AppError::Upstream{status:401,body} if body==format!("{label} refresh failed: {expected}"))
                );
            }
            let source = futures_util::stream::iter(vec![
                Ok(bytes::Bytes::from_static(b"partial")),
                Err(std::io::Error::other("PRIVATE_READ")),
            ]);
            let resp = reqwest::Response::from(
                axum::http::Response::builder()
                    .status(400)
                    .body(reqwest::Body::wrap_stream(source))
                    .unwrap(),
            );
            assert!(
                matches!(super::refresh_failure(resp,label).await,crate::error::AppError::Upstream{status:401,body} if body==format!("{label} refresh failed: "))
            );
        }
    }

    #[tokio::test]
    async fn tk2_refresh_success_bounds_fields_and_errors() {
        use crate::collection::{MAX_TOKEN_BYTES, TOKEN_LIMIT_MESSAGE};
        use bytes::Bytes;
        use futures_util::StreamExt;
        for provider in ["xai", "google"] {
            for case in [
                "small", "exact", "over", "optional", "invalid", "utf8", "missing", "read",
            ] {
                let mut bytes=match case {
                    "optional" => br#"{"access_token":"fake-access"}"#.to_vec(),
                    "invalid" => br#"{"access_token":["PRIVATE_TOKEN"]}"#.to_vec(),
                    "utf8" => vec![0xff],
                    "missing" => b"{}".to_vec(),
                    _ => r#"{"access_token":"fake-access","refresh_token":"fake-rotated","expires_in":3600,"extra":"令牌"}"#.as_bytes().to_vec(),
                };
                if case == "exact" || case == "over" {
                    bytes.resize(MAX_TOKEN_BYTES + usize::from(case == "over"), b' ');
                }
                let mut chunks: Vec<Result<Bytes, std::io::Error>> = bytes
                    .chunks(4093)
                    .map(|b| Ok(Bytes::copy_from_slice(b)))
                    .collect();
                if case == "read" {
                    chunks.push(Err(std::io::Error::other("PRIVATE_READ")));
                }
                let source = futures_util::stream::iter(chunks).chain(
                    futures_util::stream::poll_fn(move |_| {
                        if case == "over" {
                            std::task::Poll::Pending
                        } else {
                            std::task::Poll::Ready(None)
                        }
                    }),
                );
                let resp = reqwest::Response::from(
                    axum::http::Response::builder()
                        .status(200)
                        .header("content-length", "1")
                        .body(reqwest::Body::wrap_stream(source))
                        .unwrap(),
                );
                let before = Utc::now();
                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(1),
                    super::refresh_success(resp, provider),
                )
                .await
                .unwrap();
                if matches!(case, "small" | "exact" | "optional") {
                    let tokens = result.unwrap();
                    assert_eq!(tokens.access_token, "fake-access");
                    if case == "optional" {
                        assert!(tokens.refresh_token.is_none());
                        assert!(tokens.expires_at.is_none());
                    } else {
                        assert_eq!(tokens.refresh_token.as_deref(), Some("fake-rotated"));
                        let expiry = chrono::DateTime::parse_from_rfc3339(
                            tokens.expires_at.as_ref().unwrap(),
                        )
                        .unwrap();
                        assert!(expiry >= before + chrono::Duration::seconds(3600));
                        assert!(expiry <= Utc::now() + chrono::Duration::seconds(3600));
                    }
                } else {
                    let e = result.unwrap_err();
                    assert!(matches!(e, crate::error::AppError::Internal(_)));
                    let reason = match case {
                        "over" => TOKEN_LIMIT_MESSAGE,
                        "read" => "token response body read failed",
                        _ => "invalid token response",
                    };
                    assert_eq!(e.to_string(), format!("{provider} refresh json: {reason}"));
                }
            }
        }
    }

    #[test]
    fn tk3_store_preserves_optional_tokens_and_rotates_together() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db"), None).unwrap();
        let conn = store
            .upsert_oauth_connection(
                None,
                "fixture",
                "https://example.invalid",
                "siwc",
                "old-access",
                Some("old-refresh"),
                Some("old-expiry"),
                None,
                None,
                100,
                true,
            )
            .unwrap();
        for (refresh, expiry) in [
            (None, None),
            (Some(""), None),
            (Some("new-refresh"), Some("new-expiry")),
        ] {
            store
                .update_oauth_tokens(&conn.id, "new-access", refresh, expiry)
                .unwrap();
            let oauth = store
                .get_connection(&conn.id)
                .unwrap()
                .unwrap()
                .oauth
                .unwrap();
            assert_eq!(oauth.access_token, "new-access");
            assert_eq!(
                oauth.refresh_token.as_deref(),
                Some(if refresh == Some("new-refresh") {
                    "new-refresh"
                } else {
                    "old-refresh"
                })
            );
            assert_eq!(
                oauth.expires_at.as_deref(),
                Some(expiry.unwrap_or("old-expiry"))
            );
        }
    }

    use super::*;

    #[tokio::test]
    async fn stale_caller_gets_already_rotated_tokens_without_refreshing() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("t.db"), None).unwrap();
        let stale = store
            .upsert_oauth_connection(
                None,
                "s",
                crate::siwc::API_BASE,
                "siwc",
                "at-old",
                Some("rt-old"),
                None,
                Some(r#"{"client_id":"oaiapp_1"}"#),
                None,
                100,
                true,
            )
            .unwrap();
        // Another task rotated the token in the meantime.
        store
            .update_oauth_tokens(&stale.id, "at-new", Some("rt-new"), None)
            .unwrap();
        // No network is reachable from this test; a real refresh would fail.
        let got = refresh_connection(&store, &stale).await.unwrap();
        let o = got.oauth.unwrap();
        assert_eq!(o.access_token, "at-new");
        assert_eq!(o.refresh_token.as_deref(), Some("rt-new"));
    }
}

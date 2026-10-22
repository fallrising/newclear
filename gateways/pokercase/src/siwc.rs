//! Official "Sign in with ChatGPT" plan sharing (SIWC) for open-source / local apps:
//! browser sign-in with dynamic client registration + PKCE, rotating refresh, model list,
//! and the Responses request limits of `https://api.openai.com/v1/responses`.
//!
//! Docs: <https://developers.openai.com/siwc/token-sharing-open-source>.

use std::collections::HashMap;
use std::path::Path;
use std::time::Duration;

use anyhow::{anyhow, bail, Context, Result};
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64URL;
use base64::Engine;
use bytes::Bytes;
use chrono::Utc;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::error::{AppError, AppResult};
use crate::guard::random_hex;

pub const AUTH_BASE: &str = "https://auth.openai.com";
pub const API_BASE: &str = "https://api.openai.com/v1";
const REGISTRATION_CLIENT: &str = "dynamic_agent_client";
const SCOPES: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const REQUIRED_SCOPE: &str = "chatgpt.tokens.use.direct";
const CALLBACK_PATH: &str = "/auth/callback";
const APP_NAME: &str = "thinrouter";
/// Client tools are wrapped in one namespace (top-level function tools are not accepted).
pub const TOOL_NAMESPACE: &str = "client_tools";

/// Request fields the SIWC preview rejects; dropped before forwarding.
const UNSUPPORTED_FIELDS: &[&str] = &[
    "background",
    "conversation",
    "max_output_tokens",
    "max_tool_calls",
    "metadata",
    "moderation",
    "multi_agent",
    "prompt",
    "prompt_cache_retention",
    "safety_identifier",
    "temperature",
    "top_logprobs",
    "top_p",
    "truncation",
    "user",
];

/// Hosted tools the preview does not support; requests using them get a 400.
const UNSUPPORTED_TOOLS: &[&str] = &[
    "image_generation",
    "file_search",
    "code_interpreter",
    "computer_use",
    "computer_use_preview",
    "computer",
    "mcp",
    "tool_search",
    "programmatic_tool_calling",
    "local_shell",
];

/// Apply the SIWC preview rules to an outgoing Responses body:
/// `store:false`, `stream:true`, unsupported fields dropped, system items → developer,
/// function/custom tools grouped in a namespace; unsupported state/tools → 400.
pub fn sanitize_request(body: &Bytes) -> AppResult<Bytes> {
    let mut obj: Map<String, Value> = match serde_json::from_slice(body) {
        Ok(Value::Object(o)) => o,
        _ => return Err(AppError::BadRequest("body must be a JSON object".into())),
    };
    if obj
        .get("previous_response_id")
        .is_some_and(|v| !v.is_null())
    {
        return Err(AppError::BadRequest(
            "siwc: previous_response_id is not supported (store:false); resend the history in input".into(),
        ));
    }
    obj.insert("store".into(), Value::Bool(false));
    obj.insert("stream".into(), Value::Bool(true));
    for k in UNSUPPORTED_FIELDS {
        obj.remove(*k);
    }

    if let Some(Value::Array(items)) = obj.get_mut("input") {
        for item in items.iter_mut() {
            if item.get("role").and_then(|r| r.as_str()) == Some("system") {
                item["role"] = json!("developer");
            }
        }
    }

    if let Some(Value::Array(tools)) = obj.remove("tools") {
        let mut grouped = Vec::new();
        let mut out = Vec::new();
        for t in tools {
            let ty = t.get("type").and_then(|x| x.as_str()).unwrap_or("");
            if UNSUPPORTED_TOOLS.contains(&ty) {
                return Err(AppError::BadRequest(format!(
                    "siwc: tool type '{ty}' is not supported by ChatGPT plan sharing"
                )));
            }
            match ty {
                "function" | "custom" => grouped.push(t),
                _ => out.push(t), // namespaces and web_search pass through
            }
        }
        if !grouped.is_empty() {
            out.push(json!({
                "type": "namespace",
                "name": TOOL_NAMESPACE,
                "description": "Tools provided by the client application.",
                "tools": grouped,
            }));
        }
        if !out.is_empty() {
            obj.insert("tools".into(), Value::Array(out));
        }
    }
    Ok(Bytes::from(serde_json::to_vec(&obj)?))
}

/// Error codes after `response.failed` that mean the plan quota is exhausted/unavailable.
pub fn is_usage_limit_code(code: &str) -> bool {
    matches!(
        code,
        "subscription_sharing_usage_limit_exceeded" | "subscription_sharing_usage_unavailable"
    )
}

// ----- sign-in -----

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn pkce() -> Pkce {
    let verifier = B64URL.encode(hex::decode(random_hex(32)).unwrap());
    let challenge = B64URL.encode(Sha256::digest(verifier.as_bytes()));
    Pkce {
        verifier,
        challenge,
    }
}

fn enc(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn dec(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => match u8::from_str_radix(&s[i + 1..i + 3], 16) {
                Ok(v) => {
                    out.push(v);
                    i += 3;
                    continue;
                }
                Err(_) => out.push(b'%'),
            },
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn form(pairs: &[(&str, &str)]) -> String {
    pairs
        .iter()
        .map(|(k, v)| format!("{}={}", enc(k), enc(v)))
        .collect::<Vec<_>>()
        .join("&")
}

pub fn parse_query(q: &str) -> HashMap<String, String> {
    q.split('&')
        .filter_map(|kv| kv.split_once('='))
        .map(|(k, v)| (dec(k), dec(v)))
        .collect()
}

pub struct AuthorizeParams<'a> {
    pub client_id: Option<&'a str>,
    pub host_id: &'a str,
    pub redirect_uri: &'a str,
    pub state: &'a str,
    pub nonce: &'a str,
    pub challenge: &'a str,
}

pub fn authorize_url(auth_base: &str, p: &AuthorizeParams) -> String {
    let mut q: Vec<(&str, &str)> = vec![
        ("client_id", p.client_id.unwrap_or(REGISTRATION_CLIENT)),
        ("ext_agent_host_id", p.host_id),
        ("response_type", "code"),
        ("redirect_uri", p.redirect_uri),
        ("scope", SCOPES),
        ("resource", API_BASE),
        ("state", p.state),
        ("nonce", p.nonce),
        ("code_challenge_method", "S256"),
        ("code_challenge", p.challenge),
    ];
    if p.client_id.is_none() {
        q.push(("agent_name_hint", APP_NAME));
    }
    format!("{auth_base}/api/accounts/authorize?{}", form(&q))
}

/// Stable opaque host id (`urn:uuid:<v4>`), persisted per data dir.
pub fn host_id(data_dir: &Path) -> Result<String> {
    let path = data_dir.join("siwc-host-id");
    if let Ok(s) = std::fs::read_to_string(&path) {
        let s = s.trim().to_string();
        if !s.is_empty() {
            return Ok(s);
        }
    }
    let id = format!("urn:uuid:{}", uuid::Uuid::new_v4());
    std::fs::write(&path, format!("{id}\n"))
        .with_context(|| format!("write {}", path.display()))?;
    Ok(id)
}

#[derive(Debug, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub id_token: Option<String>,
    pub expires_in: Option<i64>,
    pub scope: Option<String>,
}

impl TokenResponse {
    pub fn expires_at(&self) -> Option<String> {
        self.expires_in
            .map(|s| (Utc::now() + chrono::Duration::seconds(s)).to_rfc3339())
    }
}

/// Token endpoint errors never echo the request (it holds codes / refresh tokens).
async fn token_request(
    http: &reqwest::Client,
    auth_base: &str,
    pairs: &[(&str, &str)],
) -> Result<TokenResponse> {
    let resp = http
        .post(format!("{auth_base}/api/accounts/oauth/token"))
        .header("content-type", "application/x-www-form-urlencoded")
        .header("accept", "application/json")
        .body(form(pairs))
        .send()
        .await
        .map_err(|e| anyhow!("siwc token endpoint unreachable: {}", e.without_url()))?;
    let status = resp.status();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let code = body
            .get("error")
            .and_then(|e| {
                e.as_str()
                    .or_else(|| e.get("code").and_then(|c| c.as_str()))
            })
            .unwrap_or("unknown_error");
        bail!("siwc token endpoint returned {status}: {code}");
    }
    serde_json::from_value(body).context("siwc token response")
}

/// Rotating refresh; the caller must store the new refresh token with the access token.
pub async fn refresh(
    http: &reqwest::Client,
    auth_base: &str,
    client_id: &str,
    refresh_token: &str,
) -> Result<TokenResponse> {
    token_request(
        http,
        auth_base,
        &[
            ("grant_type", "refresh_token"),
            ("client_id", client_id),
            ("refresh_token", refresh_token),
            ("resource", API_BASE),
        ],
    )
    .await
}

/// ID token claims we rely on. The token comes straight from the token endpoint over
/// TLS, so (per OpenID Connect Core 3.1.3.7) TLS server validation stands in for the
/// JWS signature check; issuer, audience, nonce and expiry are still checked.
pub fn check_id_token(
    id_token: &str,
    client_id: &str,
    nonce: &str,
) -> Result<(String, Option<String>)> {
    let payload = id_token.split('.').nth(1).context("malformed id_token")?;
    let claims: Value = serde_json::from_slice(&B64URL.decode(payload.trim_end_matches('='))?)?;
    let iss = claims.get("iss").and_then(|v| v.as_str()).unwrap_or("");
    if iss.trim_end_matches('/') != AUTH_BASE {
        bail!("id_token issuer mismatch");
    }
    let aud_ok = match claims.get("aud") {
        Some(Value::String(a)) => a == client_id,
        Some(Value::Array(a)) => a.iter().any(|x| x.as_str() == Some(client_id)),
        _ => false,
    };
    if !aud_ok {
        bail!("id_token audience does not match the issued client_id");
    }
    if claims.get("nonce").and_then(|v| v.as_str()) != Some(nonce) {
        bail!("id_token nonce mismatch");
    }
    if claims
        .get("exp")
        .and_then(|v| v.as_i64())
        .is_none_or(|exp| exp < Utc::now().timestamp())
    {
        bail!("id_token expired");
    }
    let sub = claims
        .get("sub")
        .and_then(|v| v.as_str())
        .context("id_token without sub")?
        .to_string();
    let email = claims
        .get("email")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    Ok((sub, email))
}

pub struct SignedIn {
    pub client_id: String,
    pub host_id: String,
    pub subject: String,
    pub email: Option<String>,
    pub tokens: TokenResponse,
}

/// Wait for one `GET /auth/callback?...` on the loopback listener.
async fn wait_callback(listener: TcpListener) -> Result<HashMap<String, String>> {
    loop {
        let (mut sock, _) = listener.accept().await?;
        let mut buf = vec![0u8; 16 * 1024];
        let n = sock.read(&mut buf).await?;
        let req = String::from_utf8_lossy(&buf[..n]);
        let target = req
            .lines()
            .next()
            .and_then(|l| l.split_whitespace().nth(1))
            .unwrap_or("");
        let Some(query) = target.strip_prefix(&format!("{CALLBACK_PATH}?")) else {
            let _ = sock
                .write_all(
                    b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                )
                .await;
            continue;
        };
        let params = parse_query(query);
        let msg = "Sign-in received. You can close this tab and return to thinrouter.";
        let _ = sock
            .write_all(
                format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{msg}",
                    msg.len()
                )
                .as_bytes(),
            )
            .await;
        return Ok(params);
    }
}

/// Full browser sign-in. `show_url` receives the authorize URL (it holds no secret).
pub async fn sign_in(
    http: &reqwest::Client,
    auth_base: &str,
    host_id: &str,
    existing_client_id: Option<&str>,
    port: u16,
    timeout: Duration,
    show_url: impl FnOnce(&str),
) -> Result<SignedIn> {
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .with_context(|| format!("bind 127.0.0.1:{port} for the sign-in callback"))?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}{CALLBACK_PATH}");
    let state = random_hex(16);
    let nonce = random_hex(16);
    let pk = pkce();
    show_url(&authorize_url(
        auth_base,
        &AuthorizeParams {
            client_id: existing_client_id,
            host_id,
            redirect_uri: &redirect_uri,
            state: &state,
            nonce: &nonce,
            challenge: &pk.challenge,
        },
    ));

    let params = tokio::time::timeout(timeout, wait_callback(listener))
        .await
        .map_err(|_| anyhow!("timed out waiting for the browser sign-in"))??;
    if params.get("state").map(String::as_str) != Some(state.as_str()) {
        bail!("sign-in state mismatch; start again");
    }
    if let Some(err) = params.get("error") {
        bail!("sign-in was not completed: {err}");
    }
    let client_id = match (existing_client_id, params.get("client_id")) {
        (Some(old), Some(new)) if old != new => bail!("callback returned a different client_id"),
        (Some(old), _) => old.to_string(),
        (None, Some(new)) if new != REGISTRATION_CLIENT => new.clone(),
        (None, _) => bail!("registration incomplete: callback carried no issued client_id"),
    };
    let code = params.get("code").context("callback without code")?;
    let tokens = token_request(
        http,
        auth_base,
        &[
            ("grant_type", "authorization_code"),
            ("client_id", &client_id),
            ("code", code),
            ("code_verifier", &pk.verifier),
            ("redirect_uri", &redirect_uri),
            ("resource", API_BASE),
        ],
    )
    .await?;
    let scopes = tokens.scope.clone().unwrap_or_default();
    if !scopes.split_whitespace().any(|s| s == REQUIRED_SCOPE) {
        bail!("ChatGPT plan usage was not granted (scope {REQUIRED_SCOPE} missing)");
    }
    let (subject, email) = check_id_token(
        tokens
            .id_token
            .as_deref()
            .context("token response without id_token")?,
        &client_id,
        &nonce,
    )?;
    Ok(SignedIn {
        client_id,
        host_id: host_id.to_string(),
        subject,
        email,
        tokens,
    })
}

/// Model slugs listed for the signed-in account (`visibility == "list"`).
pub async fn list_models(
    http: &reqwest::Client,
    api_base: &str,
    access_token: &str,
) -> Result<Vec<String>> {
    let resp = http
        .get(format!("{api_base}/models"))
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| anyhow!("model list request failed: {}", e.without_url()))?;
    if !resp.status().is_success() {
        bail!("model list returned {}", resp.status());
    }
    let v: Value = resp.json().await?;
    Ok(v.get("models")
        .and_then(|m| m.as_array())
        .into_iter()
        .flatten()
        .filter(|m| m.get("visibility").and_then(|v| v.as_str()) == Some("list"))
        .filter_map(|m| m.get("slug").and_then(|s| s.as_str()).map(str::to_string))
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn js(b: &Bytes) -> Value {
        serde_json::from_slice(b).unwrap()
    }

    #[test]
    fn sanitize_applies_preview_rules() {
        let body = Bytes::from(
            json!({
                "model": "m", "stream": false, "store": true, "temperature": 1, "max_output_tokens": 5,
                "metadata": {"a": 1}, "user": "u", "top_p": 0.5, "prompt_cache_key": "k",
                "input": [{"type": "message", "role": "system", "content": "rules"},
                          {"type": "message", "role": "user", "content": "hi"}],
                "tools": [{"type": "function", "name": "f", "parameters": {}}, {"type": "web_search"}]
            })
            .to_string(),
        );
        let v = js(&sanitize_request(&body).unwrap());
        assert_eq!(v["store"], false);
        assert_eq!(v["stream"], true);
        for k in [
            "temperature",
            "max_output_tokens",
            "metadata",
            "user",
            "top_p",
        ] {
            assert!(v.get(k).is_none(), "{k}");
        }
        assert_eq!(v["prompt_cache_key"], "k");
        assert_eq!(v["input"][0]["role"], "developer");
        assert_eq!(v["tools"][0]["type"], "web_search");
        assert_eq!(v["tools"][1]["type"], "namespace");
        assert_eq!(v["tools"][1]["tools"][0]["name"], "f");
    }

    #[test]
    fn sanitize_rejects_unsupported_state_and_tools() {
        for body in [
            json!({"model": "m", "input": [], "previous_response_id": "resp_1"}),
            json!({"model": "m", "input": [], "tools": [{"type": "code_interpreter"}]}),
            json!({"model": "m", "input": [], "tools": [{"type": "tool_search"}]}),
        ] {
            let err = sanitize_request(&Bytes::from(body.to_string())).unwrap_err();
            assert!(matches!(err, AppError::BadRequest(_)), "{body}");
            assert!(err.to_string().contains("siwc"));
        }
    }

    #[test]
    fn authorize_url_registration_vs_reauth() {
        let p = AuthorizeParams {
            client_id: None,
            host_id: "urn:uuid:1",
            redirect_uri: "http://127.0.0.1:1455/auth/callback",
            state: "s",
            nonce: "n",
            challenge: "c",
        };
        let url = authorize_url(AUTH_BASE, &p);
        assert!(url.starts_with("https://auth.openai.com/api/accounts/authorize?"));
        let q = parse_query(url.split_once('?').unwrap().1);
        assert_eq!(q["client_id"], "dynamic_agent_client");
        assert_eq!(q["agent_name_hint"], "thinrouter");
        assert_eq!(q["scope"], SCOPES);
        assert_eq!(q["redirect_uri"], "http://127.0.0.1:1455/auth/callback");
        assert_eq!(q["resource"], API_BASE);
        assert_eq!(q["code_challenge_method"], "S256");
        let url = authorize_url(
            AUTH_BASE,
            &AuthorizeParams {
                client_id: Some("oaiapp_1"),
                ..p
            },
        );
        let q = parse_query(url.split_once('?').unwrap().1);
        assert_eq!(q["client_id"], "oaiapp_1");
        assert!(!q.contains_key("agent_name_hint"));
    }

    #[test]
    fn pkce_challenge_is_s256_of_verifier() {
        let p = pkce();
        assert!(p.verifier.len() >= 43);
        assert_eq!(
            p.challenge,
            B64URL.encode(Sha256::digest(p.verifier.as_bytes()))
        );
    }

    fn id_token(claims: Value) -> String {
        format!(
            "{}.{}.sig",
            B64URL.encode(br#"{"alg":"RS256"}"#),
            B64URL.encode(claims.to_string())
        )
    }

    #[test]
    fn id_token_claims_are_checked() {
        let exp = Utc::now().timestamp() + 600;
        let good = json!({"iss": AUTH_BASE, "aud": "oaiapp_1", "nonce": "n", "exp": exp, "sub": "user-1", "email": "a@b"});
        let (sub, email) = check_id_token(&id_token(good.clone()), "oaiapp_1", "n").unwrap();
        assert_eq!(sub, "user-1");
        assert_eq!(email.as_deref(), Some("a@b"));
        for (k, v) in [
            ("iss", json!("https://evil.example")),
            ("aud", json!("other")),
            ("nonce", json!("x")),
            ("exp", json!(1)),
        ] {
            let mut c = good.clone();
            c[k] = v;
            assert!(
                check_id_token(&id_token(c), "oaiapp_1", "n").is_err(),
                "{k}"
            );
        }
    }

    /// Full sign-in against a local fake auth server and a simulated browser redirect.
    #[tokio::test]
    async fn sign_in_flow_with_registration() {
        use axum::routing::post;
        use axum::Router;
        use std::sync::{Arc, Mutex};
        // (nonce seen by the "browser", last token request body)
        let shared = Arc::new(Mutex::new((String::new(), String::new())));
        let srv = shared.clone();
        let app = Router::new().route(
            "/api/accounts/oauth/token",
            post(move |body: String| {
                let srv = srv.clone();
                async move {
                    let nonce = {
                        let mut g = srv.lock().unwrap();
                        g.1 = body.clone();
                        g.0.clone()
                    };
                    let q = parse_query(&body);
                    let exp = Utc::now().timestamp() + 600;
                    let claims = json!({"iss": AUTH_BASE, "aud": q["client_id"], "nonce": nonce, "exp": exp, "sub": "user-1"});
                    axum::Json(json!({
                        "access_token": "at-1", "refresh_token": "rt-1", "expires_in": 3600,
                        "id_token": id_token(claims),
                        "scope": "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
                    }))
                }
            }),
        );
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let auth_base = format!("http://{}", l.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(l, app).await.unwrap() });

        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let (url_tx, url_rx) = tokio::sync::oneshot::channel::<String>();
        let browser_state = shared.clone();
        let browser = tokio::spawn(async move {
            let url = url_rx.await.unwrap();
            let q = parse_query(url.split_once('?').unwrap().1);
            browser_state.lock().unwrap().0 = q["nonce"].clone();
            let cb = format!(
                "{}?code=CODE&state={}&client_id=oaiapp_new&scope=x",
                q["redirect_uri"], q["state"]
            );
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(cb)
                .send()
                .await
                .unwrap();
            q
        });
        let signed = sign_in(
            &http,
            &auth_base,
            "urn:uuid:h",
            None,
            0,
            Duration::from_secs(5),
            |u| {
                url_tx.send(u.to_string()).unwrap();
            },
        )
        .await
        .unwrap();
        let q = browser.await.unwrap();
        assert_eq!(q["client_id"], "dynamic_agent_client");
        assert_eq!(q["ext_agent_host_id"], "urn:uuid:h");
        assert_eq!(signed.client_id, "oaiapp_new");
        assert_eq!(signed.subject, "user-1");
        assert_eq!(signed.tokens.refresh_token.as_deref(), Some("rt-1"));
        let body = parse_query(&shared.lock().unwrap().1);
        assert_eq!(body["grant_type"], "authorization_code");
        assert_eq!(body["client_id"], "oaiapp_new");
        assert_eq!(body["code"], "CODE");
        assert_eq!(body["redirect_uri"], q["redirect_uri"]);
        assert_eq!(body["resource"], API_BASE);
        assert_eq!(
            B64URL.encode(Sha256::digest(body["code_verifier"].as_bytes())),
            q["code_challenge"]
        );

        // Rotating refresh uses the issued client id and the resource.
        let t = refresh(&http, &auth_base, "oaiapp_new", "rt-1")
            .await
            .unwrap();
        assert_eq!(t.access_token, "at-1");
        let body = parse_query(&shared.lock().unwrap().1);
        assert_eq!(body["grant_type"], "refresh_token");
        assert_eq!(body["client_id"], "oaiapp_new");
        assert_eq!(body["refresh_token"], "rt-1");
        assert!(!body.contains_key("scope"));
    }

    #[tokio::test]
    async fn sign_in_rejects_wrong_state() {
        let http = reqwest::Client::builder().no_proxy().build().unwrap();
        let (tx, rx) = tokio::sync::oneshot::channel::<String>();
        tokio::spawn(async move {
            let url = rx.await.unwrap();
            let q = parse_query(url.split_once('?').unwrap().1);
            let cb = format!(
                "{}?code=C&state=forged&client_id=oaiapp_x",
                q["redirect_uri"]
            );
            let _ = reqwest::Client::builder()
                .no_proxy()
                .build()
                .unwrap()
                .get(cb)
                .send()
                .await;
        });
        let err = sign_in(
            &http,
            "http://127.0.0.1:9",
            "urn:uuid:h",
            None,
            0,
            Duration::from_secs(5),
            |u| {
                tx.send(u.to_string()).unwrap();
            },
        )
        .await
        .err()
        .unwrap()
        .to_string();
        assert!(err.contains("state mismatch"), "{err}");
    }
}

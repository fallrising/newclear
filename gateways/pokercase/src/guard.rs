//! Request guards shared by the admin UI/API and keyless bootstrap:
//! constant-time comparison, remote detection, admin sessions, Host allowlist,
//! Origin check and CSRF tokens.

use std::collections::HashMap;
use std::net::{IpAddr, SocketAddr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use axum::body::Body;
use axum::extract::{ConnectInfo, Request, State};
use axum::http::{header, HeaderMap, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};
use rand::RngCore;
use subtle::ConstantTimeEq;

use crate::config::AppConfig;
use crate::server::AppState;

pub const ADMIN_COOKIE: &str = "tr_admin";
pub const CSRF_HEADER: &str = "x-csrf-token";
const SESSION_TTL: Duration = Duration::from_secs(12 * 3600);
/// Upper bound for buffering an admin form body to read its CSRF field.
const MAX_FORM_BYTES: usize = 1024 * 1024;

/// Headers set by reverse proxies / tunnels (Tailscale Serve, cloudflared, nginx, ...).
/// Any of them marks a request as remote even when the TCP peer is loopback.
const FORWARDING_HEADERS: &[&str] = &[
    "forwarded",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-proto",
    "x-real-ip",
    "true-client-ip",
    "cf-connecting-ip",
    "cf-ray",
    "cdn-loop",
    "via",
    "tailscale-user-login",
    "tailscale-user-name",
    "tailscale-funnel-request",
];

pub fn ct_eq(a: &str, b: &str) -> bool {
    a.as_bytes().ct_eq(b.as_bytes()).into()
}

pub fn has_forwarding_headers(headers: &HeaderMap) -> bool {
    FORWARDING_HEADERS.iter().any(|h| headers.contains_key(*h))
}

/// Remote unless the TCP peer is loopback and no proxy header is present.
/// A missing peer address (no ConnectInfo) fails closed as remote.
pub fn is_remote(peer: Option<SocketAddr>, headers: &HeaderMap) -> bool {
    !peer.is_some_and(|p| p.ip().is_loopback()) || has_forwarding_headers(headers)
}

pub fn peer_addr(req: &Request) -> Option<SocketAddr> {
    req.extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0)
}

pub fn random_hex(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

/// In-memory admin sessions: cookie id → CSRF token. Restart logs everyone out.
#[derive(Clone, Default)]
pub struct Sessions(Arc<Mutex<HashMap<String, (String, Instant)>>>);

impl Sessions {
    /// Returns (session id, csrf token).
    pub fn create(&self) -> (String, String) {
        let id = random_hex(32);
        let csrf = random_hex(32);
        let mut map = self.0.lock().unwrap();
        map.retain(|_, (_, exp)| *exp > Instant::now());
        map.insert(id.clone(), (csrf.clone(), Instant::now() + SESSION_TTL));
        (id, csrf)
    }

    /// CSRF token of a live session.
    pub fn csrf_for(&self, id: &str) -> Option<String> {
        let map = self.0.lock().unwrap();
        map.iter()
            .find(|(k, (_, exp))| ct_eq(k, id) && *exp > Instant::now())
            .map(|(_, (csrf, _))| csrf.clone())
    }

    pub fn remove(&self, id: &str) {
        self.0.lock().unwrap().remove(id);
    }
}

pub fn session_cookie(headers: &HeaderMap) -> Option<String> {
    let cookie = headers.get(header::COOKIE)?.to_str().ok()?;
    cookie.split(';').find_map(|part| {
        part.trim()
            .strip_prefix(ADMIN_COOKIE)
            .and_then(|rest| rest.strip_prefix('='))
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    })
}

/// How an admin request authenticated.
pub enum AdminAuth {
    /// `x-admin-token` header (scripts); not reachable by cross-site forms.
    Header,
    /// Session cookie; state changes need this session's CSRF token.
    Session { csrf: String },
}

pub fn admin_auth(state: &AppState, headers: &HeaderMap) -> Option<AdminAuth> {
    let token = state.cfg.admin_token.as_deref().filter(|t| !t.is_empty())?;
    if let Some(v) = headers.get("x-admin-token").and_then(|v| v.to_str().ok()) {
        if ct_eq(v, token) {
            return Some(AdminAuth::Header);
        }
    }
    let sid = session_cookie(headers)?;
    state
        .sessions
        .csrf_for(&sid)
        .map(|csrf| AdminAuth::Session { csrf })
}

/// `host[:port]` → host, lowercased, brackets kept for IPv6.
fn host_only(host_port: &str) -> String {
    let h = host_port.trim().to_ascii_lowercase();
    if h.starts_with('[') {
        return h.split(']').next().map(|s| format!("{s}]")).unwrap_or(h);
    }
    match h.rsplit_once(':') {
        Some((host, port)) if port.chars().all(|c| c.is_ascii_digit()) => host.to_string(),
        _ => h,
    }
}

/// DNS-rebinding guard: IP literals and `localhost` are always fine (a rebinding
/// attack needs an attacker-controlled name); other names must be configured.
pub fn host_allowed(cfg: &AppConfig, host_header: &str) -> bool {
    let host = host_only(host_header);
    if host.is_empty() {
        return false;
    }
    let bare = host.trim_start_matches('[').trim_end_matches(']');
    if bare.parse::<IpAddr>().is_ok() || host == "localhost" {
        return true;
    }
    host == host_only(&cfg.host) || cfg.allowed_hosts.iter().any(|h| host_only(h) == host)
}

fn origin_matches_host(origin: &str, host_header: &str) -> bool {
    let Some((_, rest)) = origin.split_once("://") else {
        return false;
    };
    let origin_authority = rest.split('/').next().unwrap_or("");
    let strip_default = |a: &str| -> String {
        let a = a.to_ascii_lowercase();
        a.strip_suffix(":443")
            .or_else(|| a.strip_suffix(":80"))
            .unwrap_or(&a)
            .to_string()
    };
    strip_default(origin_authority) == strip_default(host_header)
}

fn reject(status: StatusCode, msg: &str) -> Response {
    (
        status,
        axum::Json(serde_json::json!({
            "error": {"message": msg, "type": "thinrouter_error"}
        })),
    )
        .into_response()
}

fn csrf_from_form(body: &[u8]) -> Option<String> {
    std::str::from_utf8(body).ok()?.split('&').find_map(|pair| {
        pair.strip_prefix("csrf=")
            .map(|v| v.chars().filter(|c| c.is_ascii_hexdigit()).collect())
    })
}

/// Global middleware: Host allowlist for every route; Origin + CSRF for admin writes.
pub async fn request_guard(State(state): State<AppState>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get(header::HOST)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    if !host_allowed(&state.cfg, &host) {
        return reject(
            StatusCode::MISDIRECTED_REQUEST,
            "host not allowed; add it with --allowed-host",
        );
    }

    let path = req.uri().path();
    let is_admin = path == "/admin" || path.starts_with("/admin/");
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    if !is_admin || safe {
        return next.run(req).await;
    }

    // Browser cross-site writes: refuse before touching any handler.
    let headers = req.headers();
    if headers
        .get("sec-fetch-site")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.eq_ignore_ascii_case("cross-site"))
    {
        return reject(StatusCode::FORBIDDEN, "cross-site admin request refused");
    }
    if let Some(origin) = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        if !origin_matches_host(origin, &host) {
            return reject(StatusCode::FORBIDDEN, "origin does not match host");
        }
    }

    // Login has no session yet; logout and every other write need the session CSRF token.
    if path == "/admin/login" {
        return next.run(req).await;
    }
    let csrf = match admin_auth(&state, req.headers()) {
        Some(AdminAuth::Header) | None => return next.run(req).await, // handlers return 401
        Some(AdminAuth::Session { csrf }) => csrf,
    };
    if let Some(v) = req.headers().get(CSRF_HEADER).and_then(|v| v.to_str().ok()) {
        return if ct_eq(v, &csrf) {
            next.run(req).await
        } else {
            reject(StatusCode::FORBIDDEN, "invalid CSRF token")
        };
    }
    let is_form = req
        .headers()
        .get(header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.starts_with("application/x-www-form-urlencoded"));
    if !is_form {
        return reject(StatusCode::FORBIDDEN, "missing CSRF token");
    }
    let (parts, body) = req.into_parts();
    let Ok(bytes) = axum::body::to_bytes(body, MAX_FORM_BYTES).await else {
        return reject(StatusCode::PAYLOAD_TOO_LARGE, "form too large");
    };
    match csrf_from_form(&bytes) {
        Some(v) if ct_eq(&v, &csrf) => {
            next.run(Request::from_parts(parts, Body::from(bytes)))
                .await
        }
        _ => reject(StatusCode::FORBIDDEN, "invalid CSRF token"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(host: &str, allowed: &[&str]) -> AppConfig {
        let dir = tempfile::tempdir().unwrap();
        let mut c = AppConfig::new(
            host.into(),
            20128,
            Some(dir.path().into()),
            None,
            None,
            None,
            None,
            None,
        )
        .unwrap();
        c.allowed_hosts = allowed.iter().map(|s| s.to_string()).collect();
        c
    }

    #[test]
    fn forwarding_headers_mark_loopback_peer_remote() {
        let lo: SocketAddr = "127.0.0.1:5000".parse().unwrap();
        assert!(!is_remote(Some(lo), &HeaderMap::new()));
        assert!(is_remote(None, &HeaderMap::new()));
        assert!(is_remote(
            Some("100.64.0.2:5000".parse().unwrap()),
            &HeaderMap::new()
        ));
        for h in [
            "x-forwarded-for",
            "forwarded",
            "x-real-ip",
            "cf-connecting-ip",
            "tailscale-user-login",
        ] {
            let mut headers = HeaderMap::new();
            headers.insert(h, "1.2.3.4".parse().unwrap());
            assert!(is_remote(Some(lo), &headers), "{h}");
        }
    }

    #[test]
    fn host_allowlist_blocks_rebinding_names() {
        let c = cfg("127.0.0.1", &["box.tail1234.ts.net"]);
        for ok in [
            "127.0.0.1:20128",
            "localhost:20128",
            "[::1]:20128",
            "192.0.2.4",
            "box.tail1234.ts.net",
            "BOX.tail1234.ts.net:443",
        ] {
            assert!(host_allowed(&c, ok), "{ok}");
        }
        for bad in [
            "evil.example",
            "evil.example:20128",
            "",
            "localhost.evil.example",
        ] {
            assert!(!host_allowed(&c, bad), "{bad}");
        }
        // A wildcard is just a name that never matches; the check cannot be turned off.
        let wild = cfg("127.0.0.1", &["*"]);
        assert!(!host_allowed(&wild, "evil.example"));
    }

    #[test]
    fn origin_must_match_host() {
        assert!(origin_matches_host(
            "http://127.0.0.1:20128",
            "127.0.0.1:20128"
        ));
        assert!(origin_matches_host("https://box.ts.net", "box.ts.net:443"));
        assert!(!origin_matches_host(
            "http://evil.example",
            "127.0.0.1:20128"
        ));
        assert!(!origin_matches_host("null", "127.0.0.1:20128"));
    }

    #[test]
    fn sessions_and_csrf_parse() {
        let s = Sessions::default();
        let (id, csrf) = s.create();
        assert_eq!(s.csrf_for(&id).as_deref(), Some(csrf.as_str()));
        assert!(s.csrf_for("nope").is_none());
        s.remove(&id);
        assert!(s.csrf_for(&id).is_none());
        assert_eq!(
            csrf_from_form(b"name=x&csrf=abc123&y=1").as_deref(),
            Some("abc123")
        );
        assert!(csrf_from_form(b"name=x").is_none());
        assert!(ct_eq("abc", "abc") && !ct_eq("abc", "abd") && !ct_eq("abc", "ab"));
    }
}

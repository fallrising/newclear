//! Bounded M1 Web gateway; Agent Platform remains the only execution authority.
//! This composition carries operator cookies/CSRF only, never provider/node credentials.

use std::env;
use std::io::{self, Read, Write};
use std::net::{IpAddr, Ipv4Addr, SocketAddr, TcpStream};
use std::sync::Arc;
use std::time::{Duration, Instant};

use axum::Router;
use axum::body::{Body, to_bytes};
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Method, Response, StatusCode, header};
use thiserror::Error;
use uuid::Uuid;

use crate::P0PublicOrigin;
use codebox_event_store::SubmissionStore;

mod persistence;

const REQUEST_LIMIT: usize = 64 * 1024;
const RESPONSE_LIMIT: usize = 2 * 1024 * 1024;
const HEADER_LIMIT: usize = 16 * 1024;
const TRANSPORT_TIMEOUT: Duration = Duration::from_secs(10);
const FORWARDED: [&str; 5] = [
    "content-type",
    "cookie",
    "origin",
    "x-csrf-token",
    "idempotency-key",
];
const CSP: &str = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

#[cfg(test)]
mod persistence_tests;

/// Redacted gateway errors: external messages never contain upstream bodies or credentials.
#[derive(Debug, Error)]
pub enum IsolatedError {
    /// The administrator did not provide the required private composition.
    #[error("invalid isolated gateway configuration")]
    Configuration,
    /// Local transport could not confirm a complete response; mutations must not be retried.
    #[error("isolated upstream unavailable or outcome uncertain")]
    Transport,
    /// Input does not meet the bounded gateway contract.
    #[error("invalid isolated gateway request")]
    Request,
    /// A bounded body/header limit was exceeded.
    #[error("isolated gateway size limit exceeded")]
    TooLarge,
    /// The upstream response framing/content is unsupported.
    #[error("invalid isolated upstream response")]
    Response,
}

#[derive(Clone)]
struct Config {
    origin: P0PublicOrigin,
    upstream: SocketAddr,
    store: Option<SubmissionStore>,
}

impl Config {
    fn new(origin: &str, upstream: &str) -> Result<Self, IsolatedError> {
        let origin = P0PublicOrigin::try_new(origin).map_err(|_| IsolatedError::Configuration)?;
        let upstream: SocketAddr = upstream.parse().map_err(|_| IsolatedError::Configuration)?;
        if upstream.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) || upstream.port() == 0 {
            return Err(IsolatedError::Configuration);
        }
        Ok(Self {
            origin,
            upstream,
            store: None,
        })
    }
}

/// Serves the explicit isolated mode with existing TLS termination in front.
///
/// Requires `CODEBOX_PUBLIC_ORIGIN` (HTTPS), `CODEBOX_LISTEN_ADDRESS` and
/// `CODEBOX_AGENT_PLATFORM_ADDRESS` (literal `127.0.0.1:port`). No P0 credentials are read.
pub async fn serve() -> Result<(), IsolatedError> {
    let required = |name| env::var(name).map_err(|_| IsolatedError::Configuration);
    let mut config = Config::new(
        &required("CODEBOX_PUBLIC_ORIGIN")?,
        &required("CODEBOX_AGENT_PLATFORM_ADDRESS")?,
    )?;
    let store_path = std::path::PathBuf::from(required("CODEBOX_ISOLATED_STORE")?);
    config.store = Some(
        tokio::task::spawn_blocking(move || SubmissionStore::open(store_path))
            .await
            .map_err(|_| IsolatedError::Configuration)?
            .map_err(|_| IsolatedError::Configuration)?,
    );
    let listen: SocketAddr = required("CODEBOX_LISTEN_ADDRESS")?
        .parse()
        .map_err(|_| IsolatedError::Configuration)?;
    let listener = tokio::net::TcpListener::bind(listen)
        .await
        .map_err(|_| IsolatedError::Transport)?;
    axum::serve(listener, router(config))
        .with_graceful_shutdown(async {
            let _ = tokio::signal::ctrl_c().await;
        })
        .await
        .map_err(|_| IsolatedError::Transport)
}

fn router(config: Config) -> Router {
    Router::new().fallback(handle).with_state(Arc::new(config))
}

fn allowed(method: &Method, path: &str) -> bool {
    if path == "/api/v1/submissions" {
        return method == Method::GET;
    }
    if path == "/api/v1/session" {
        return matches!(*method, Method::GET | Method::POST | Method::DELETE);
    }
    if path == "/api/v1/tasks" {
        return matches!(*method, Method::GET | Method::POST);
    }
    if method == Method::POST && (cancel_target(path) || handoff_target(path)) {
        return true;
    }
    if method != Method::GET {
        return false;
    }
    if matches!(
        path,
        "/api/v1/projects" | "/api/v1/agent-profiles" | "/api/v1/runtime"
    ) {
        return true;
    }
    let Some(run) = path.strip_prefix("/api/v1/runs/") else {
        return false;
    };
    if let Some((identifier, suffix)) = run.split_once("/artifacts") {
        return canonical_uuid(identifier)
            && (suffix.is_empty() || suffix.strip_prefix('/').is_some_and(canonical_uuid));
    }
    let identifier = run.strip_suffix("/result.diff").unwrap_or(run);
    Uuid::parse_str(identifier).is_ok_and(|value| value.to_string() == identifier)
}

fn canonical_uuid(identifier: &str) -> bool {
    Uuid::parse_str(identifier).is_ok_and(|value| value.to_string() == identifier)
}

fn handoff_target(path: &str) -> bool {
    path.strip_prefix("/api/v1/runs/")
        .and_then(|s| s.split_once('/'))
        .is_some_and(|(id, action)| canonical_uuid(id) && matches!(action, "reviews" | "rework"))
}

fn cancel_target(path: &str) -> bool {
    path.strip_prefix("/api/v1/runs/")
        .and_then(|run| run.strip_suffix("/actions"))
        .is_some_and(|identifier| {
            Uuid::parse_str(identifier).is_ok_and(|value| value.to_string() == identifier)
        })
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct CancelRequest {
    action: String,
    expected_state_version: i64,
}

fn valid_cancel(body: &[u8]) -> bool {
    // Struct deserialization also supports JSON sequences; the gateway requires an object.
    body.iter().find(|byte| !byte.is_ascii_whitespace()) == Some(&b'{')
        && serde_json::from_slice::<CancelRequest>(body)
            .is_ok_and(|value| value.action == "cancel" && value.expected_state_version > 0)
}

fn security(response: &mut Response<Body>) {
    for (name, value) in [
        ("cache-control", "no-store"),
        ("x-content-type-options", "nosniff"),
        ("content-security-policy", CSP),
        ("referrer-policy", "no-referrer"),
        ("x-frame-options", "DENY"),
        ("cross-origin-opener-policy", "same-origin"),
        ("cross-origin-resource-policy", "same-origin"),
    ] {
        response.headers_mut().insert(
            HeaderName::from_static(name),
            HeaderValue::from_static(value),
        );
    }
}

fn reply(status: StatusCode, body: impl Into<Body>, content_type: &'static str) -> Response<Body> {
    let mut response = Response::new(body.into());
    *response.status_mut() = status;
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(content_type));
    security(&mut response);
    response
}

fn error(status: StatusCode, code: &'static str) -> Response<Body> {
    reply(
        status,
        serde_json::json!({"error": code}).to_string(),
        "application/json",
    )
}

fn asset(path: &str) -> Option<Response<Body>> {
    let (body, kind): (&'static [u8], &'static str) = match path {
        "/" => (
            include_bytes!("../web/isolated.html"),
            "text/html; charset=utf-8",
        ),
        "/assets/isolated.js" => (
            include_bytes!("../web/isolated.js"),
            "text/javascript; charset=utf-8",
        ),
        "/assets/candidate.js" => (
            include_bytes!("../web/candidate.js"),
            "text/javascript; charset=utf-8",
        ),
        "/assets/p0.css" => (include_bytes!("../web/p0.css"), "text/css; charset=utf-8"),
        "/favicon.ico" => (include_bytes!("../web/favicon.ico"), "image/x-icon"),
        _ => return None,
    };
    Some(reply(StatusCode::OK, Body::from(body), kind))
}

fn request_headers(
    config: &Config,
    method: &Method,
    headers: &HeaderMap,
) -> Result<Option<usize>, IsolatedError> {
    if headers
        .iter()
        .map(|(k, v)| k.as_str().len() + v.as_bytes().len())
        .sum::<usize>()
        > HEADER_LIMIT
    {
        return Err(IsolatedError::TooLarge);
    }
    if headers.contains_key(header::TRANSFER_ENCODING)
        || headers.contains_key(header::CONTENT_ENCODING)
        || headers.contains_key(header::UPGRADE)
        || headers.contains_key(header::TRAILER)
    {
        return Err(IsolatedError::Request);
    }
    for name in FORWARDED
        .into_iter()
        .chain(["content-length", "connection"])
    {
        if headers.get_all(name).iter().count() > 1 {
            return Err(IsolatedError::Request);
        }
    }
    if let Some(connection) = headers.get(header::CONNECTION) {
        let text = connection.to_str().map_err(|_| IsolatedError::Request)?;
        if text.split(',').any(|v| {
            FORWARDED.contains(&v.trim().to_ascii_lowercase().as_str())
                || v.trim().eq_ignore_ascii_case("content-length")
        }) {
            return Err(IsolatedError::Request);
        }
    }
    let origin = headers.get(header::ORIGIN);
    if (method == Method::POST || method == Method::DELETE || origin.is_some())
        && origin.map(HeaderValue::as_bytes) != Some(config.origin.as_str().as_bytes())
    {
        return Err(IsolatedError::Request);
    }
    for name in FORWARDED {
        if let Some(value) = headers.get(name)
            && value.as_bytes().iter().any(u8::is_ascii_control)
        {
            return Err(IsolatedError::Request);
        }
    }
    headers
        .get(header::CONTENT_LENGTH)
        .map(|value| {
            let text = value.to_str().map_err(|_| IsolatedError::Request)?;
            if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
                return Err(IsolatedError::Request);
            }
            let length: usize = text.parse().map_err(|_| IsolatedError::TooLarge)?;
            if length > REQUEST_LIMIT {
                return Err(IsolatedError::TooLarge);
            }
            Ok(length)
        })
        .transpose()
}

async fn handle(State(config): State<Arc<Config>>, request: Request) -> Response<Body> {
    if request.uri().query().is_some() || request.uri().authority().is_some() {
        return error(StatusCode::BAD_REQUEST, "invalid_gateway_target");
    }
    let path = request.uri().path().to_owned();
    if request.method() == Method::GET
        && let Some(response) = asset(&path)
    {
        return response;
    }
    if !allowed(request.method(), &path) {
        return error(StatusCode::NOT_FOUND, "gateway_route_not_found");
    }
    let length = match request_headers(&config, request.method(), request.headers()) {
        Ok(value) => value,
        Err(IsolatedError::TooLarge) => {
            return error(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large");
        }
        Err(_) => return error(StatusCode::BAD_REQUEST, "invalid_gateway_request"),
    };
    let (parts, body) = request.into_parts();
    let body =
        match tokio::time::timeout(Duration::from_secs(5), to_bytes(body, REQUEST_LIMIT)).await {
            Ok(Ok(value)) => value,
            Ok(Err(_)) => return error(StatusCode::PAYLOAD_TOO_LARGE, "request_too_large"),
            Err(_) => return error(StatusCode::REQUEST_TIMEOUT, "request_timeout"),
        };
    if length.is_some_and(|n| n != body.len())
        || (length.is_none() && !body.is_empty())
        || (parts.method == Method::GET && !body.is_empty())
    {
        return error(StatusCode::BAD_REQUEST, "invalid_gateway_framing");
    }
    if cancel_target(&path) && !valid_cancel(&body) {
        return error(StatusCode::BAD_REQUEST, "invalid_cancel_request");
    }
    if path == "/api/v1/submissions"
        || (parts.method == Method::POST && (path == "/api/v1/tasks" || handoff_target(&path)))
        || (parts.method == Method::GET
            && path.starts_with("/api/v1/runs/")
            && canonical_uuid(path.trim_start_matches("/api/v1/runs/")))
    {
        if let Some(store) = config.store.clone() {
            return persistence::handle(
                config,
                store,
                parts.method,
                path,
                parts.headers,
                body.to_vec(),
            )
            .await;
        }
        // Only legacy transport unit fixtures may omit the store. serve() always requires it.
        #[cfg(not(test))]
        return error(StatusCode::SERVICE_UNAVAILABLE, "durable_store_unavailable");
    }
    let mutation = parts.method != Method::GET;
    let upstream = tokio::task::spawn_blocking(move || {
        forward(&config, &parts.method, &path, &parts.headers, &body)
    })
    .await;
    match upstream {
        Ok(Ok(mut response)) => {
            security(&mut response);
            response
        }
        _ => error(
            StatusCode::BAD_GATEWAY,
            if mutation {
                "upstream_outcome_unknown"
            } else {
                "upstream_unavailable"
            },
        ),
    }
}

struct DeadlineStream {
    stream: TcpStream,
    deadline: Instant,
}

impl DeadlineStream {
    fn remaining(&self) -> io::Result<Duration> {
        self.deadline
            .checked_duration_since(Instant::now())
            .filter(|d| !d.is_zero())
            .ok_or_else(|| io::Error::from(io::ErrorKind::TimedOut))
    }
}

impl Read for DeadlineStream {
    fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
        self.stream.set_read_timeout(Some(self.remaining()?))?;
        self.stream.read(buffer)
    }
}

impl Write for DeadlineStream {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.stream.set_write_timeout(Some(self.remaining()?))?;
        self.stream.write(buffer)
    }
    fn flush(&mut self) -> io::Result<()> {
        self.stream.flush()
    }
}

fn forward(
    config: &Config,
    method: &Method,
    path: &str,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<Response<Body>, IsolatedError> {
    let deadline = Instant::now() + TRANSPORT_TIMEOUT;
    let stream = TcpStream::connect_timeout(&config.upstream, Duration::from_secs(2))
        .map_err(|_| IsolatedError::Transport)?;
    let mut stream = DeadlineStream { stream, deadline };
    let mut wire = format!(
        "{method} {path} HTTP/1.1\r\nHost: {}\r\nConnection: close\r\nContent-Length: {}\r\n",
        &config.origin.as_str()[8..],
        body.len()
    )
    .into_bytes();
    for name in FORWARDED {
        if let Some(value) = headers.get(name) {
            wire.extend_from_slice(name.as_bytes());
            wire.extend_from_slice(b": ");
            wire.extend_from_slice(value.as_bytes());
            wire.extend_from_slice(b"\r\n");
        }
    }
    wire.extend_from_slice(b"\r\n");
    wire.extend_from_slice(body);
    stream
        .write_all(&wire)
        .map_err(|_| IsolatedError::Transport)?;
    read_response(&mut stream)
}

fn read_response(reader: &mut impl Read) -> Result<Response<Body>, IsolatedError> {
    let mut raw = Vec::new();
    while !raw.ends_with(b"\r\n\r\n") {
        if raw.len() >= HEADER_LIMIT {
            return Err(IsolatedError::TooLarge);
        }
        let mut byte = [0];
        reader
            .read_exact(&mut byte)
            .map_err(|_| IsolatedError::Transport)?;
        raw.push(byte[0]);
    }
    let text = std::str::from_utf8(&raw).map_err(|_| IsolatedError::Response)?;
    let mut lines = text[..text.len() - 4].split("\r\n");
    let status = lines.next().ok_or(IsolatedError::Response)?;
    if status.bytes().any(|b| b.is_ascii_control()) {
        return Err(IsolatedError::Response);
    }
    let mut fields = status.splitn(3, ' ');
    if !matches!(fields.next(), Some("HTTP/1.1" | "HTTP/1.0")) {
        return Err(IsolatedError::Response);
    }
    let code = fields.next().ok_or(IsolatedError::Response)?;
    if code.len() != 3 {
        return Err(IsolatedError::Response);
    }
    let status = StatusCode::from_bytes(code.as_bytes()).map_err(|_| IsolatedError::Response)?;
    if status.is_informational() || status.is_redirection() {
        return Err(IsolatedError::Response);
    }
    let mut length = None;
    let mut headers = HeaderMap::new();
    for line in lines {
        let (name, value) = line.split_once(':').ok_or(IsolatedError::Response)?;
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| IsolatedError::Response)?;
        let value = HeaderValue::from_str(value.trim()).map_err(|_| IsolatedError::Response)?;
        if name == header::TRANSFER_ENCODING || name == header::CONTENT_ENCODING {
            return Err(IsolatedError::Response);
        }
        if name == header::CONNECTION {
            let value = value.to_str().map_err(|_| IsolatedError::Response)?;
            if value.split(',').any(|part| {
                !part.trim().eq_ignore_ascii_case("close")
                    && !part.trim().eq_ignore_ascii_case("keep-alive")
            }) {
                return Err(IsolatedError::Response);
            }
        }
        if name == header::CONTENT_LENGTH {
            if length.is_some() {
                return Err(IsolatedError::Response);
            }
            let text = value.to_str().map_err(|_| IsolatedError::Response)?;
            if text.is_empty() || !text.bytes().all(|b| b.is_ascii_digit()) {
                return Err(IsolatedError::Response);
            }
            let size = text.parse::<usize>().map_err(|_| IsolatedError::TooLarge)?;
            if size > RESPONSE_LIMIT {
                return Err(IsolatedError::TooLarge);
            }
            length = Some(size);
        } else if name == header::SET_COOKIE {
            headers.append(name, value);
        } else if name == header::CONTENT_TYPE || name == header::CONTENT_DISPOSITION {
            if headers.contains_key(&name) {
                return Err(IsolatedError::Response);
            }
            headers.insert(name, value);
        }
    }
    let length = if status == StatusCode::NO_CONTENT {
        if length.is_some_and(|n| n != 0) {
            return Err(IsolatedError::Response);
        }
        0
    } else {
        length.ok_or(IsolatedError::Response)?
    };
    if length > 0 {
        let kind = headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .ok_or(IsolatedError::Response)?;
        if !matches!(
            kind.split(';').next(),
            Some("application/json" | "text/plain")
        ) {
            return Err(IsolatedError::Response);
        }
    }
    let mut body = vec![0; length];
    reader
        .read_exact(&mut body)
        .map_err(|_| IsolatedError::Transport)?;
    let mut response = Response::new(Body::from(body));
    *response.status_mut() = status;
    *response.headers_mut() = headers;
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn isolated_allowlist_is_exact_and_never_adds_mutations() {
        for path in [
            "/api/v1/session",
            "/api/v1/projects",
            "/api/v1/agent-profiles",
            "/api/v1/runtime",
            "/api/v1/tasks",
            "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001",
            "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/result.diff",
        ] {
            assert!(allowed(&Method::GET, path), "{path}");
        }
        assert!(allowed(&Method::POST, "/api/v1/tasks"));
        assert!(allowed(&Method::DELETE, "/api/v1/session"));
        for path in [
            "/api/v1/projects",
            "/api/v1/agent-profiles",
            "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/cancel",
            "/api/v1/tasks/",
            "/api/v1/tasks?limit=1",
            "/api/v1/%74asks",
            "http://localhost/api/v1/tasks",
        ] {
            assert!(!allowed(&Method::POST, path), "{path}");
        }
    }
    #[test]
    fn c01_artifact_routes_are_canonical_get_only() {
        let root = "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/artifacts";
        for path in [
            root.to_owned(),
            format!("{root}/018ff3ab-1277-7000-8000-000000000002"),
        ] {
            assert!(allowed(&Method::GET, &path));
            for method in [Method::POST, Method::PUT, Method::PATCH, Method::DELETE] {
                assert!(!allowed(&method, &path));
            }
            for bad in [
                format!("{path}/"),
                format!("{path}?limit=1"),
                path.to_uppercase(),
            ] {
                assert!(!allowed(&Method::GET, &bad));
            }
        }
        assert!(!allowed(&Method::GET, &format!("{root}/../../session")));
    }

    #[test]
    fn isolated_cancel_route_is_exact() {
        let path = "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/actions";
        assert!(allowed(&Method::POST, path));
        for method in [Method::GET, Method::PUT, Method::PATCH, Method::DELETE] {
            assert!(!allowed(&method, path));
        }
        for path in [
            "/api/v1/runs/018FF3AB-1277-7000-8000-000000000001/actions",
            "/api/v1/runs/018ff3ab127770008000000000000001/actions",
            "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/actions/",
            "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/actions/retry",
            "/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/%61ctions",
            "/api/v1/runs/invalid/actions",
        ] {
            assert!(!allowed(&Method::POST, path), "{path}");
        }
    }

    #[tokio::test]
    async fn isolated_cancel_invalid_bodies_never_reach_upstream() {
        use tower::ServiceExt;
        let app = router(Config::new("https://operator.invalid", "127.0.0.1:1").expect("config"));
        for body in [
            r#"{"action":"pause","expected_state_version":1}"#,
            r#"{"action":"resume","expected_state_version":1}"#,
            r#"{"action":"approval","expected_state_version":1}"#,
            r#"{"action":"cancel","expected_state_version":0}"#,
            r#"{"action":"cancel","expected_state_version":-1}"#,
            r#"{"action":"cancel","expected_state_version":1.0}"#,
            r#"{"action":"cancel","expected_state_version":1e0}"#,
            r#"{"action":"cancel","expected_state_version":"1"}"#,
            r#"{"action":"cancel","expected_state_version":true}"#,
            r#"{"action":"cancel","expected_state_version":null}"#,
            r#"{"action":"cancel","expected_state_version":9223372036854775808}"#,
            r#"{"action":"cancel","expected_state_version":1,"extra":true}"#,
            r#"{"action":"cancel","action":"cancel","expected_state_version":1}"#,
            r#"{"action":"cancel","expected_state_version":1,"expected_state_version":2}"#,
            r#"{"action":"cancel"}"#,
            r#"{"expected_state_version":1}"#,
            r#"["cancel",1]"#,
            r#"{"action":"cancel","expected_state_version":1} {}"#,
            "",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/actions")
                        .header(header::ORIGIN, "https://operator.invalid")
                        .header(header::CONTENT_TYPE, "application/json")
                        .header(header::CONTENT_LENGTH, body.len())
                        .body(Body::from(body))
                        .expect("request"),
                )
                .await
                .expect("router");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST, "{body}");
        }
    }

    #[tokio::test]
    async fn isolated_cancel_forwards_exact_body_and_operator_authority() {
        use std::net::TcpListener;
        use tower::ServiceExt;
        for body in [
            r#"{"action":"cancel","expected_state_version":1}"#,
            r#"{"expected_state_version":9223372036854775807,"action":"cancel"}"#,
        ] {
            let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
            let address = listener.local_addr().expect("address");
            let thread = std::thread::spawn(move || {
                let (mut socket, _) = listener.accept().expect("accept");
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("timeout");
                let mut wire = Vec::new();
                while !wire.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).expect("header");
                    wire.push(byte[0]);
                }
                let headers = String::from_utf8(wire).expect("headers");
                assert!(headers.starts_with(
                    "POST /api/v1/runs/018ff3ab-1277-7000-8000-000000000001/actions HTTP/1.1\r\n"
                ));
                for field in [
                    "cookie: session=synthetic",
                    "x-csrf-token: synthetic-csrf",
                    "idempotency-key: synthetic-command",
                    "origin: https://operator.invalid",
                ] {
                    assert!(headers.contains(field), "missing {field}");
                }
                let mut received = vec![0; body.len()];
                socket.read_exact(&mut received).expect("body");
                assert_eq!(received, body.as_bytes());
                socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}").expect("response");
            });
            let response = router(
                Config::new("https://operator.invalid", &address.to_string()).expect("config"),
            )
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/runs/018ff3ab-1277-7000-8000-000000000001/actions")
                    .header(header::ORIGIN, "https://operator.invalid")
                    .header(header::CONTENT_TYPE, "application/json")
                    .header(header::CONTENT_LENGTH, body.len())
                    .header(header::COOKIE, "session=synthetic")
                    .header("x-csrf-token", "synthetic-csrf")
                    .header("idempotency-key", "synthetic-command")
                    .body(Body::from(body))
                    .expect("request"),
            )
            .await
            .expect("router");
            assert_eq!(response.status(), StatusCode::OK);
            thread.join().expect("upstream");
        }
    }

    #[test]
    fn isolated_config_requires_https_and_one_literal_loopback() {
        assert!(Config::new("https://operator.invalid", "127.0.0.1:18000").is_ok());
        for address in [
            "localhost:18000",
            "0.0.0.0:18000",
            "127.0.0.2:18000",
            "[::1]:18000",
            "192.0.2.1:18000",
            "127.0.0.1:0",
        ] {
            assert!(Config::new("https://operator.invalid", address).is_err());
        }
        for origin in [
            "http://operator.invalid",
            "https://user@operator.invalid",
            "https://operator.invalid/path",
            "https://operator.invalid?x=1",
        ] {
            assert!(Config::new(origin, "127.0.0.1:18000").is_err());
        }
    }

    #[test]
    fn isolated_request_origin_and_framing_are_checked_before_transport() {
        let config = Config::new("https://operator.invalid", "127.0.0.1:18000").expect("config");
        let mut headers = HeaderMap::new();
        assert!(request_headers(&config, &Method::POST, &headers).is_err());
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://operator.invalid"),
        );
        assert!(request_headers(&config, &Method::POST, &headers).is_ok());
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        headers.append(header::CONTENT_LENGTH, HeaderValue::from_static("0"));
        assert!(request_headers(&config, &Method::POST, &headers).is_err());
        headers.remove(header::CONTENT_LENGTH);
        headers.insert(
            header::TRANSFER_ENCODING,
            HeaderValue::from_static("chunked"),
        );
        assert!(request_headers(&config, &Method::POST, &headers).is_err());
        headers.remove(header::TRANSFER_ENCODING);
        headers.insert(header::CONNECTION, HeaderValue::from_static("Cookie"));
        assert!(request_headers(&config, &Method::POST, &headers).is_err());
        headers.remove(header::CONNECTION);
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from_static("65537"));
        assert!(matches!(
            request_headers(&config, &Method::POST, &headers),
            Err(IsolatedError::TooLarge)
        ));
        headers.remove(header::CONTENT_LENGTH);
        headers.insert(
            header::ORIGIN,
            HeaderValue::from_static("https://evil.invalid"),
        );
        assert!(request_headers(&config, &Method::DELETE, &headers).is_err());
    }

    #[test]
    fn isolated_upstream_redirects_bad_framing_and_large_bodies_refuse() {
        for wire in [
            "HTTP/1.1 302 Found\r\nContent-Length: 0\r\nLocation: https://evil.invalid\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Length: 2\r\n\r\n{}",
            "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n0\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Length: 2097153\r\n\r\n",
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{}",
            "HTTP/1.1 200 OK\r\nContent-Length: 3\r\nContent-Type: application/json\r\n\r\n{}",
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: text/html\r\n\r\n{}",
            "HTTP/1.1 204 No Content\r\nContent-Length: 1\r\n\r\nx",
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: Set-Cookie\r\nSet-Cookie: a=1\r\n\r\n{}",
        ] {
            assert!(read_response(&mut wire.as_bytes()).is_err(), "{wire}");
        }
        let large = format!("HTTP/1.1 200 OK\r\nX-Padding: {}", "x".repeat(HEADER_LIMIT));
        assert!(matches!(
            read_response(&mut large.as_bytes()),
            Err(IsolatedError::TooLarge)
        ));
        assert_eq!(
            read_response(&mut b"HTTP/1.1 204 No Content\r\n\r\n".as_slice())
                .expect("logout")
                .status(),
            StatusCode::NO_CONTENT
        );
    }

    #[tokio::test]
    async fn isolated_real_tcp_forwards_only_operator_headers_and_preserves_cookies() {
        use std::net::TcpListener;
        use tower::ServiceExt;
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let address = listener.local_addr().expect("address");
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept");
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("timeout");
            let mut wire = Vec::new();
            while !wire.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).expect("request");
                wire.push(byte[0]);
            }
            let mut body = [0; 2];
            socket.read_exact(&mut body).expect("body");
            assert_eq!(&body, b"{}");
            let text = String::from_utf8(wire).expect("utf8");
            assert!(text.starts_with("POST /api/v1/tasks HTTP/1.1\r\n"));
            assert!(text.contains("cookie: session=synthetic"));
            assert!(text.contains("origin: https://operator.invalid"));
            assert!(text.contains("x-csrf-token: synthetic-csrf"));
            assert!(text.contains("idempotency-key: synthetic-id"));
            assert!(!text.to_ascii_lowercase().contains("authorization"));
            assert!(!text.contains("connector-secret"));
            socket.write_all(b"HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 2\r\nSet-Cookie: a=1; Secure; HttpOnly\r\nSet-Cookie: b=2; Secure\r\nX-Private: never-forward\r\n\r\n{}").expect("reply");
        });
        let config = Config::new("https://operator.invalid", &address.to_string()).expect("config");
        let request = Request::builder()
            .method(Method::POST)
            .uri("/api/v1/tasks")
            .header(header::ORIGIN, "https://operator.invalid")
            .header(header::CONTENT_TYPE, "application/json")
            .header(header::CONTENT_LENGTH, "2")
            .header(header::COOKIE, "session=synthetic")
            .header("x-csrf-token", "synthetic-csrf")
            .header("idempotency-key", "synthetic-id")
            .header(header::AUTHORIZATION, "connector-secret")
            .body(Body::from("{}"))
            .expect("request");
        let response = router(config).oneshot(request).await.expect("router");
        assert_eq!(response.status(), StatusCode::CREATED);
        assert_eq!(
            response
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .count(),
            2
        );
        assert!(!response.headers().contains_key("x-private"));
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        assert_eq!(
            to_bytes(response.into_body(), 10).await.expect("body"),
            "{}"
        );
        thread.join().expect("upstream");
    }

    #[tokio::test]
    async fn isolated_assets_and_rejected_requests_do_not_reach_upstream() {
        use tower::ServiceExt;
        let config = Config::new("https://operator.invalid", "127.0.0.1:1").expect("config");
        let app = router(config);
        for path in ["/", "/assets/isolated.js", "/assets/p0.css", "/favicon.ico"] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("router");
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["x-content-type-options"], "nosniff");
            assert_eq!(response.headers()[header::CONTENT_SECURITY_POLICY], CSP);
        }
        for path in [
            "/api/v1/tasks?anything=1",
            "http://other.invalid/api/v1/tasks",
        ] {
            let response = app
                .clone()
                .oneshot(
                    Request::builder()
                        .uri(path)
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("router");
            assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        }
        let response = app
            .oneshot(
                Request::builder()
                    .method(Method::POST)
                    .uri("/api/v1/tasks")
                    .header(header::ORIGIN, "https://operator.invalid")
                    .header(header::CONTENT_LENGTH, "65537")
                    .body(Body::empty())
                    .expect("request"),
            )
            .await
            .expect("router");
        assert_eq!(response.status(), StatusCode::PAYLOAD_TOO_LARGE);
    }

    #[tokio::test]
    async fn isolated_lost_mutation_reply_is_unknown_and_never_retried() {
        use std::net::TcpListener;
        use tower::ServiceExt;
        let listener = TcpListener::bind("127.0.0.1:0").expect("listener");
        let address = listener.local_addr().expect("address");
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().expect("accept");
            socket
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("timeout");
            let mut wire = Vec::new();
            while !wire.ends_with(b"\r\n\r\n") {
                let mut byte = [0];
                socket.read_exact(&mut byte).expect("request");
                wire.push(byte[0]);
            }
            socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 10\r\n\r\n{}").expect("partial");
            drop(socket);
            listener.set_nonblocking(true).expect("nonblocking");
            std::thread::sleep(Duration::from_millis(50));
            assert!(matches!(listener.accept(), Err(e) if e.kind() == io::ErrorKind::WouldBlock));
        });
        let response =
            router(Config::new("https://operator.invalid", &address.to_string()).expect("config"))
                .oneshot(
                    Request::builder()
                        .method(Method::POST)
                        .uri("/api/v1/tasks")
                        .header(header::ORIGIN, "https://operator.invalid")
                        .body(Body::empty())
                        .expect("request"),
                )
                .await
                .expect("router");
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            to_bytes(response.into_body(), 100).await.expect("body"),
            r#"{"error":"upstream_outcome_unknown"}"#
        );
        thread.join().expect("upstream");
    }
}

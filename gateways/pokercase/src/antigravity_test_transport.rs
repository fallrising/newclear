//! Test-only, per-instance transport for the complete Antigravity HTTP call tree.
//!
//! The fixture is also the mandatory proxy. Even raw uses of `http()` (such as
//! admin connection probes) cannot bypass it. The fixture must validate requests
//! below and generate responses locally; it must never resolve or forward them.

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::Duration;

use reqwest::{Client, Method, RequestBuilder};

pub(crate) const GENERATE_URL: &str =
    "https://cloudcode-pa.googleapis.com/v1internal:generateContent";
pub(crate) const LOAD_URL: &str = "https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";
pub(crate) const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
pub(crate) const CLIENT_ID: &str = "synthetic-agy-client-id";
pub(crate) const CLIENT_SECRET: &str = "synthetic-agy-client-secret";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum Operation {
    GenerateContent,
    LoadCodeAssist,
    GoogleToken,
}

impl Operation {
    fn path(self) -> &'static str {
        match self {
            Self::GenerateContent => "/v1internal:generateContent",
            Self::LoadCodeAssist => "/v1internal:loadCodeAssist",
            Self::GoogleToken => "/token",
        }
    }
}

#[derive(Clone)]
pub(crate) struct AntigravityTestTransport {
    http: Client,
    base: String,
    authority: String,
}

impl AntigravityTestTransport {
    /// `addr` must come from the fixture's already-bound exact-loopback listener.
    /// There are no optional endpoints and no production fallback.
    pub(crate) fn loopback(addr: SocketAddr) -> Result<Self, String> {
        if addr.ip() != IpAddr::V4(Ipv4Addr::LOCALHOST) || addr.port() == 0 {
            return Err("Antigravity fixture requires bound 127.0.0.1 with nonzero port".into());
        }
        let authority = addr.to_string();
        let base = format!("http://{authority}");
        let http = Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&base).map_err(|e| e.to_string())?)
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .connect_timeout(Duration::from_secs(1))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            http,
            base,
            authority,
        })
    }

    pub(crate) fn http(&self) -> Client {
        self.http.clone()
    }

    pub(crate) fn require_provider(&self, provider: &str) -> Result<(), String> {
        match provider {
            "agy" | "ag" | "antigravity" => Ok(()),
            _ => Err("sealed Antigravity transport rejects unrelated provider".into()),
        }
    }

    pub(crate) fn request(
        &self,
        method: Method,
        logical_url: &str,
    ) -> Result<RequestBuilder, String> {
        if method != Method::POST {
            return Err("sealed Antigravity transport rejects method".into());
        }
        let operation = match logical_url {
            GENERATE_URL => Operation::GenerateContent,
            LOAD_URL => Operation::LoadCodeAssist,
            TOKEN_URL => Operation::GoogleToken,
            _ => return Err("sealed Antigravity transport rejects destination".into()),
        };
        Ok(self
            .http
            .request(method, format!("{}{}", self.base, operation.path())))
    }

    /// Independent fake-side guard, including requests made with a raw client
    /// clone. Exact string matching also rejects URL queries, fragments, userinfo,
    /// alternate authorities, encoding aliases, and redirect destination paths.
    pub(crate) fn validate_fixture_request(
        &self,
        method: &str,
        target: &str,
        host: Option<&str>,
        upgrade: bool,
    ) -> Result<Operation, String> {
        if method != "POST" || upgrade || host != Some(self.authority.as_str()) {
            return Err("fixture rejected method, upgrade or authority".into());
        }
        for operation in [
            Operation::GenerateContent,
            Operation::LoadCodeAssist,
            Operation::GoogleToken,
        ] {
            if target == operation.path() || target == format!("{}{}", self.base, operation.path())
            {
                return Ok(operation);
            }
        }
        Err("fixture rejected destination".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU16, Ordering};
    use std::sync::{Arc, Mutex};

    use axum::extract::{Request, State};
    use axum::http::StatusCode;
    use axum::response::{IntoResponse, Response};

    struct Fixture {
        transport: AntigravityTestTransport,
        observed: Mutex<Vec<Result<Operation, String>>>,
        redirect_status: AtomicU16,
        redirect_url: String,
    }

    async fn endpoint(State(fixture): State<Arc<Fixture>>, request: Request) -> Response {
        let operation = fixture.transport.validate_fixture_request(
            request.method().as_str(),
            &request.uri().to_string(),
            request.headers().get("host").and_then(|v| v.to_str().ok()),
            request.headers().contains_key("upgrade"),
        );
        fixture.observed.lock().unwrap().push(operation.clone());
        let Ok(operation) = operation else {
            return (StatusCode::FORBIDDEN, "fixture refused request").into_response();
        };
        let redirect = fixture.redirect_status.load(Ordering::SeqCst);
        if redirect != 0 {
            return (
                StatusCode::from_u16(redirect).unwrap(),
                [("location", fixture.redirect_url.as_str())],
                "fixture redirect",
            )
                .into_response();
        }
        let body = match operation {
            Operation::GenerateContent => serde_json::json!({"fixture": true}),
            Operation::LoadCodeAssist => {
                serde_json::json!({"cloudaicompanionProject": "synthetic-project"})
            }
            Operation::GoogleToken => serde_json::json!({
                "access_token": "synthetic-fresh",
                "refresh_token": "synthetic-rotated",
                "expires_in": 3600,
            }),
        };
        axum::Json(body).into_response()
    }

    struct AbortOnDrop(tokio::task::JoinHandle<()>);
    impl Drop for AbortOnDrop {
        fn drop(&mut self) {
            self.0.abort();
        }
    }

    fn transport() -> AntigravityTestTransport {
        AntigravityTestTransport::loopback("127.0.0.1:32123".parse().unwrap()).unwrap()
    }

    #[test]
    fn ai_transport_constructor_rejects_unbound_or_nonexact_loopback_addresses() {
        for addr in [
            "127.0.0.1:0",
            "127.0.0.2:32123",
            "0.0.0.0:32123",
            "[::1]:32123",
        ] {
            assert!(AntigravityTestTransport::loopback(addr.parse().unwrap()).is_err());
        }
    }

    #[test]
    fn ai_transport_closed_map_covers_all_three_original_destinations() {
        let transport = transport();
        for (logical, operation) in [
            (GENERATE_URL, Operation::GenerateContent),
            (LOAD_URL, Operation::LoadCodeAssist),
            (TOKEN_URL, Operation::GoogleToken),
        ] {
            let request = transport
                .request(Method::POST, logical)
                .unwrap()
                .build()
                .unwrap();
            assert_eq!(
                request.url().as_str(),
                format!("http://127.0.0.1:32123{}", operation.path())
            );
            assert_eq!(request.method(), Method::POST);
        }
    }

    #[test]
    fn ai_transport_unknown_or_missing_routes_and_methods_fail_before_send() {
        let transport = transport();
        for logical in [
            "".to_owned(),
            "not a URL".to_owned(),
            "http://127.0.0.1:32123/token".to_owned(),
            format!("{GENERATE_URL}?alt=sse"),
            format!("{GENERATE_URL}#fragment"),
            GENERATE_URL.replace("generateContent", "streamGenerateContent"),
            GENERATE_URL.replace("https://", "http://"),
            GENERATE_URL.replace("googleapis.com/", "googleapis.com:443/"),
            GENERATE_URL.replace("https://", "https://synthetic@"),
        ] {
            assert!(transport.request(Method::POST, &logical).is_err());
        }
        for method in [Method::GET, Method::CONNECT, Method::HEAD, Method::PUT] {
            assert!(transport.request(method, GENERATE_URL).is_err());
        }
        for provider in ["", "grok", "siwc", "opencode"] {
            assert!(transport.require_provider(provider).is_err());
        }
    }

    #[test]
    fn ai_transport_fake_guard_is_closed_for_absolute_and_origin_form_requests() {
        let transport = transport();
        for operation in [
            Operation::GenerateContent,
            Operation::LoadCodeAssist,
            Operation::GoogleToken,
        ] {
            for target in [
                operation.path().to_owned(),
                format!("{}{}", transport.base, operation.path()),
            ] {
                assert_eq!(
                    transport
                        .validate_fixture_request("POST", &target, Some("127.0.0.1:32123"), false)
                        .unwrap(),
                    operation
                );
            }
        }
        for (method, target, host, upgrade) in [
            ("CONNECT", "127.0.0.1:32123", Some("127.0.0.1:32123"), false),
            ("GET", "/models", Some("127.0.0.1:32123"), false),
            ("POST", "/unknown", Some("127.0.0.1:32123"), false),
            ("POST", "/token?query", Some("127.0.0.1:32123"), false),
            ("POST", "/token#fragment", Some("127.0.0.1:32123"), false),
            ("POST", "/token", None, false),
            ("POST", "/token", Some("127.0.0.1:32124"), false),
            ("POST", "/token", Some("localhost:32123"), false),
            (
                "POST",
                "http://127.0.0.1:32124/token",
                Some("127.0.0.1:32123"),
                false,
            ),
            ("POST", "/token", Some("127.0.0.1:32123"), true),
        ] {
            assert!(transport
                .validate_fixture_request(method, target, host, upgrade)
                .is_err());
        }
    }

    #[tokio::test]
    async fn ai_transport_unrelated_cli_is_rejected_before_dispatch() {
        use crate::proxy::{
            handle_anthropic_messages, handle_chat_with_fallback, handle_responses,
        };

        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let transport = transport();
        let state = crate::proxy::ProxyState {
            http: transport.http(),
            store: store.clone(),
            cooldown: crate::cooldown::CooldownMap::new(),
            rr_counter: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            sse_stall_secs: 5,
            token_saver: false,
            token_saver_max_chars: 2000,
            provider_base_overrides: Vec::new(),
            claude_code: crate::claude_code::ClaudeCode::new(
                Some(
                    dir.path()
                        .join("must-not-exist-claude")
                        .to_string_lossy()
                        .into_owned(),
                ),
                dir.path(),
                1,
            ),
            cursor_cli: crate::cursor_cli::CursorCli::new(
                Some(
                    dir.path()
                        .join("must-not-exist-cursor")
                        .to_string_lossy()
                        .into_owned(),
                ),
                dir.path(),
                1,
            ),
            refresh_transport: None,
            agy_transport: Some(transport),
        };
        for provider in ["claude", "cursor"] {
            let connection = store
                .upsert_oauth_connection(
                    None,
                    provider,
                    "http://127.0.0.1:32123",
                    provider,
                    "synthetic",
                    None,
                    None,
                    None,
                    None,
                    1,
                    true,
                )
                .unwrap();
            for client in ["chat", "messages", "responses"] {
                let (guard, cancel) = crate::cancel::CancelOnDrop::new();
                let targets = vec![crate::store::ResolvedTarget {
                    connection: connection.clone(),
                    upstream_model: "synthetic".into(),
                }];
                let body = bytes::Bytes::from_static(br#"{"model":"synthetic","messages":[{"role":"user","content":"synthetic"}],"input":"synthetic","max_tokens":1}"#);
                let result = match client {
                    "chat" => {
                        handle_chat_with_fallback(
                            &state,
                            "synthetic",
                            body,
                            false,
                            targets,
                            "ordered",
                            cancel,
                            guard,
                        )
                        .await
                    }
                    "messages" => {
                        handle_anthropic_messages(
                            &state,
                            "synthetic",
                            body,
                            false,
                            targets,
                            "ordered",
                            cancel,
                            guard,
                        )
                        .await
                    }
                    _ => {
                        handle_responses(
                            &state,
                            "synthetic",
                            body,
                            false,
                            targets,
                            "ordered",
                            cancel,
                            guard,
                        )
                        .await
                    }
                };
                assert!(
                    matches!(result, Err(crate::error::AppError::BadRequest(ref message)) if message == "sealed Antigravity transport rejects unrelated provider")
                );
            }
        }
        assert!(store.recent_usage(10).unwrap().is_empty());
    }

    #[tokio::test]
    async fn ai_transport_http_operations_redirects_and_proxy_are_sealed() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        // A second owned loopback listener is the only negative destination. No
        // external host is contacted, including when proving the proxy barrier.
        let sentinel = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let sentinel_addr = sentinel.local_addr().unwrap();
        let transport = AntigravityTestTransport::loopback(addr).unwrap();
        let fixture = Arc::new(Fixture {
            transport: transport.clone(),
            observed: Mutex::new(Vec::new()),
            redirect_status: AtomicU16::new(0),
            redirect_url: format!("http://{sentinel_addr}/must-not-arrive"),
        });
        let app = axum::Router::new()
            .fallback(endpoint)
            .with_state(fixture.clone());
        let shutdown = tokio_util::sync::CancellationToken::new();
        let shutdown_signal = shutdown.clone();
        let mut server = AbortOnDrop(tokio::spawn(async move {
            axum::serve(listener, app)
                .with_graceful_shutdown(shutdown_signal.cancelled_owned())
                .await
                .unwrap();
        }));

        let response = transport
            .request(Method::POST, GENERATE_URL)
            .unwrap()
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.url().as_str(),
            format!("http://{addr}/v1internal:generateContent")
        );
        assert_eq!(
            crate::agy::fetch_project_id_for_test("synthetic-access", &transport)
                .await
                .unwrap(),
            "synthetic-project"
        );

        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let connection = store
            .upsert_oauth_connection(
                None,
                "synthetic",
                "https://cloudcode-pa.googleapis.com",
                "agy",
                "synthetic-old",
                Some("synthetic-refresh"),
                Some("0"),
                None,
                None,
                1,
                true,
            )
            .unwrap();
        let fresh = crate::oauth_refresh::refresh_antigravity_connection_for_test(
            &store,
            &connection,
            &transport,
        )
        .await
        .unwrap();
        assert_eq!(fresh.bearer_token(), "synthetic-fresh");
        assert_eq!(
            *fixture.observed.lock().unwrap(),
            vec![
                Ok(Operation::GenerateContent),
                Ok(Operation::LoadCodeAssist),
                Ok(Operation::GoogleToken),
            ]
        );

        // An installed sealed context never delegates a foreign refresh to its
        // production client, and the older test transport cannot refresh Google.
        let unrelated = store
            .upsert_oauth_connection(
                None,
                "synthetic-unrelated",
                &format!("http://{sentinel_addr}"),
                "grok",
                "synthetic-old",
                Some("synthetic-refresh"),
                Some("0"),
                None,
                None,
                1,
                true,
            )
            .unwrap();
        assert!(
            crate::oauth_refresh::refresh_antigravity_connection_for_test(
                &store, &unrelated, &transport
            )
            .await
            .is_err()
        );
        let older = crate::oauth_refresh::TestTransport::loopback(&format!("http://{addr}"));
        assert!(
            crate::oauth_refresh::refresh_connection_for_test(&store, &fresh, &older)
                .await
                .is_err()
        );
        assert_eq!(fixture.observed.lock().unwrap().len(), 3);

        for status in [301, 302, 307, 308] {
            fixture.redirect_status.store(status, Ordering::SeqCst);
            let response = transport
                .request(Method::POST, GENERATE_URL)
                .unwrap()
                .send()
                .await
                .unwrap();
            assert_eq!(response.status().as_u16(), status);
        }
        fixture.redirect_status.store(0, Ordering::SeqCst);
        assert_eq!(fixture.observed.lock().unwrap().len(), 7);

        let raw = transport.http();
        assert_eq!(
            raw.post(format!("http://{sentinel_addr}/unknown"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        assert!(raw
            .post(format!("https://{sentinel_addr}/token"))
            .send()
            .await
            .is_err());
        assert_eq!(
            raw.get(format!("http://{addr}/models"))
                .send()
                .await
                .unwrap()
                .status(),
            StatusCode::FORBIDDEN
        );
        {
            let observed = fixture.observed.lock().unwrap();
            assert_eq!(observed.len(), 10);
            assert_eq!(observed.iter().filter(|entry| entry.is_err()).count(), 3);
        }
        assert!(
            tokio::time::timeout(Duration::from_millis(50), sentinel.accept())
                .await
                .is_err(),
            "owned sentinel must receive no connection"
        );
        drop(raw);
        drop(transport);
        shutdown.cancel();
        tokio::time::timeout(Duration::from_secs(1), &mut server.0)
            .await
            .unwrap()
            .unwrap();
        assert!(tokio::net::TcpStream::connect(addr).await.is_err());
    }
}

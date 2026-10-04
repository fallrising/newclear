use loom_core::ai::config::{AiSettings, WireProtocol};
use loom_core::ai::provider::ProviderKind;
use loom_core::ai::AiService;

fn resolve(values: &[(&str, &str)]) -> Result<AiSettings, loom_core::ai::AiError> {
    AiSettings::resolve(|name| {
        values
            .iter()
            .find(|(key, _)| *key == name)
            .map(|(_, value)| (*value).to_owned())
    })
}

#[test]
fn legacy_defaults_and_explicit_gateway_configuration() {
    let settings = resolve(&[]).unwrap();
    assert_eq!(settings.provider(), ProviderKind::Anthropic);
    assert_eq!(settings.protocol(), WireProtocol::Messages);
    let status = settings.status();
    assert_eq!(status.model, "claude-sonnet-4-6");
    assert_eq!(
        status.base_url.as_deref(),
        Some("https://api.anthropic.com/v1")
    );
    assert!(!status.key_present);
    for (provider, model, key_env, url) in [
        (
            "openai",
            "gpt-4o-mini",
            "OPENAI_API_KEY",
            "https://api.openai.com/v1",
        ),
        (
            "deepseek",
            "deepseek-chat",
            "DEEPSEEK_API_KEY",
            "https://api.deepseek.com/v1",
        ),
    ] {
        let status = resolve(&[("LOOM_AI_PROVIDER", provider)]).unwrap().status();
        assert_eq!(status.model, model);
        assert_eq!(status.key_env, key_env);
        assert_eq!(status.base_url.as_deref(), Some(url));
        assert_eq!(status.protocol.as_deref(), Some("chat-completions"));
    }
    let settings = resolve(&[
        ("LOOM_AI_PROVIDER", "opencode"),
        ("LOOM_AI_PROTOCOL", "responses"),
        ("LOOM_AI_MODEL", "chosen-model"),
        ("OPENCODE_API_KEY", "secret-value"),
    ])
    .unwrap();
    assert_eq!(settings.provider(), ProviderKind::OpenCode);
    assert_eq!(settings.protocol(), WireProtocol::Responses);
    assert_eq!(
        settings.status().base_url.as_deref(),
        Some("https://opencode.ai/zen/go/v1")
    );
    assert!(settings.status().key_present);
    assert!(!serde_json::to_string(&settings.status())
        .unwrap()
        .contains("secret-value"));
}

#[test]
fn invalid_explicit_configuration_is_never_defaulted_or_echoed() {
    for (name, value) in [
        ("LOOM_AI_PROVIDER", "secret-value"),
        ("LOOM_AI_PROVIDER", ""),
        ("LOOM_AI_PROTOCOL", "secret-value"),
        ("LOOM_AI_PROTOCOL", ""),
        ("LOOM_AI_MODEL", "  "),
        ("LOOM_AI_MAX_TOKENS", ""),
        ("LOOM_AI_MAX_TOKENS", "0"),
        ("LOOM_AI_MAX_TOKENS", "-1"),
        ("LOOM_AI_MAX_TOKENS", "4294967296"),
        ("LOOM_AI_MAX_TOKENS", "secret-value"),
        ("LOOM_AI_API_KEY_ENV", ""),
        ("LOOM_AI_API_KEY_ENV", "secret-value"),
        ("LOOM_AI_API_KEY_ENV", "1KEY"),
    ] {
        let error = resolve(&[(name, value)]).err().expect(name).to_string();
        assert!(error.contains(name), "{error}");
        assert!(!error.contains("secret-value"));
    }
    for values in [
        vec![("LOOM_AI_PROVIDER", "opencode")],
        vec![
            ("LOOM_AI_PROVIDER", "opencode"),
            ("LOOM_AI_PROTOCOL", "messages"),
        ],
    ] {
        assert!(resolve(&values).is_err());
    }
}

#[test]
fn base_url_validation_and_custom_key_selection() {
    for url in [
        "",
        "ftp://localhost/v1",
        "http://example.com/v1",
        "https:///",
        "https:example.com",
        "https://@host/v1",
        "https://user:secret-value@host/v1",
        "https://host/v1?key=secret-value",
        "https://host/v1#secret-value",
        "https://host/v1/messages",
        "https://host/v1/responses/",
        "https://host/v1/chat/completions",
    ] {
        let error = resolve(&[("LOOM_AI_BASE_URL", url)])
            .err()
            .expect(url)
            .to_string();
        assert!(error.contains("LOOM_AI_BASE_URL"));
        assert!(!error.contains("secret-value"));
    }
    for url in [
        "https://gateway.example/zen/v1",
        "http://127.0.0.1:8080/v1",
        "http://localhost:8080/v1",
        "http://[::1]:8080/v1",
    ] {
        let trailing = format!("{url}///");
        let settings = resolve(&[
            ("LOOM_AI_BASE_URL", &trailing),
            ("LOOM_AI_API_KEY_ENV", "CUSTOM_KEY"),
            ("CUSTOM_KEY", "selected-secret"),
            ("ANTHROPIC_API_KEY", "ignored-secret"),
        ])
        .unwrap();
        let status = settings.status();
        assert_eq!(status.base_url.as_deref(), Some(url));
        assert_eq!(status.key_env, "CUSTOM_KEY");
        assert!(status.key_present);
        assert!(!format!("{settings:?}").contains("selected-secret"));
    }
}

#[test]
fn injected_service_uses_validated_status() {
    let service = AiService::with_settings(resolve(&[("ANTHROPIC_API_KEY", "secret")]).unwrap());
    assert!(service.current_status().key_present);
}

use loom_core::ai::provider::PinnedContext;
use loom_core::ai::{AiChunk, AiError};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn server(response: String, count: usize) -> (String, tokio::task::JoinHandle<Vec<String>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/gateway/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let mut requests = vec![];
        for _ in 0..count {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut bytes = vec![];
            let mut buf = [0; 4096];
            loop {
                let n = socket.read(&mut buf).await.unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buf[..n]);
                if let Some(end) = bytes.windows(4).position(|w| w == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                    let length: usize = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .unwrap()
                        .parse()
                        .unwrap();
                    if bytes.len() >= end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(bytes).unwrap());
            socket.write_all(response.as_bytes()).await.unwrap();
        }
        requests
    });
    (base, task)
}

fn response(status: u16, body: &str, extra_headers: &str) -> String {
    format!("HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\n{extra_headers}Connection: close\r\n\r\n{body}", body.len())
}
fn service(base: &str, protocol: &str) -> AiService {
    AiService::with_settings(
        resolve(&[
            ("LOOM_AI_PROVIDER", "opencode"),
            ("LOOM_AI_PROTOCOL", protocol),
            ("LOOM_AI_MODEL", "configured-model"),
            ("LOOM_AI_BASE_URL", base),
            ("LOOM_AI_API_KEY_ENV", "CUSTOM_KEY"),
            ("CUSTOM_KEY", "selected-secret"),
            ("OPENCODE_API_KEY", "ignored-secret"),
            ("LOOM_AI_MAX_TOKENS", "17"),
        ])
        .unwrap(),
    )
}
async fn call(service: &AiService) -> (Result<(), AiError>, Vec<AiChunk>) {
    let events = Arc::new(Mutex::new(vec![]));
    let sink = events.clone();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        service.run(
            "test-request".into(),
            "synthetic prompt".into(),
            Some("active document".into()),
            vec![PinnedContext {
                source: "pinned.md".into(),
                content: "pinned document".into(),
            }],
            move |event| sink.lock().unwrap().push(event),
        ),
    )
    .await
    .expect("bounded service request");
    let events = events.lock().unwrap().clone();
    (result, events)
}
fn header<'a>(request: &'a str, name: &str) -> &'a str {
    request
        .lines()
        .find_map(|line| {
            line.split_once(':')
                .filter(|(key, _)| key.eq_ignore_ascii_case(name))
                .map(|(_, value)| value.trim())
        })
        .unwrap()
}

#[tokio::test]
async fn service_routes_all_protocols_and_preserves_auth_context_budget_and_go_identity() {
    for (protocol, path, sse, auth) in [
        ("chat-completions", "chat/completions", "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}]}\n\ndata: [DONE]\n\n", "authorization"),
        ("messages", "messages", "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\ndata: {\"type\":\"message_stop\"}\n\n", "x-api-key"),
        ("responses", "responses", "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hello\"}\n\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":3,\"output_tokens\":1}}}\n\n", "authorization"),
    ] {
        let (base, task) = server(response(200, sse, ""), 3).await;
        let svc = service(&base, protocol);
        for _ in 0..2 {
            let (result, events) = call(&svc).await;
            result.unwrap();
            assert!(matches!(events.first(), Some(AiChunk::Started { .. })));
            assert!(events.iter().any(|e| matches!(e, AiChunk::Text { delta, .. } if delta == "hello")));
            assert_eq!(events.iter().filter(|e| matches!(e, AiChunk::Done { .. })).count(), 1);
            assert!(!svc.cancel("test-request"));
        }
        call(&service(&base, protocol)).await.0.unwrap();
        let requests = task.await.unwrap();
        assert_eq!(header(&requests[0], "x-opencode-session"), header(&requests[1], "x-opencode-session"));
        assert_ne!(header(&requests[0], "x-opencode-session"), header(&requests[2], "x-opencode-session"));
        for request in requests {
            assert!(request.starts_with(&format!("POST /gateway/v1/{path} HTTP/1.1\r\n")));
            assert_eq!(header(&request, "user-agent"), "loom/0.1.0");
            assert!(uuid::Uuid::parse_str(header(&request, "x-opencode-session")).is_ok());
            assert_eq!(header(&request, auth), if auth == "authorization" { "Bearer selected-secret" } else { "selected-secret" });
            assert!(!request.contains("ignored-secret"));
            let body: serde_json::Value = serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
            assert_eq!(body["model"], "configured-model");
            assert_eq!(body[if protocol == "responses" { "max_output_tokens" } else { "max_tokens" }], 17);
            for text in ["active document", "pinned document", "synthetic prompt"] { assert!(body.to_string().contains(text)); }
            if protocol == "responses" { assert!(body.get("messages").is_none()); assert!(body.get("stream_options").is_none()); }
        }
    }
}

#[tokio::test]
async fn service_redacts_key_from_http_and_sse_failures() {
    for (protocol, status, body) in [
        ("chat-completions", 401, "bad key selected-secret"),
        (
            "chat-completions",
            200,
            "data: {\"error\":{\"message\":\"selected-secret rejected\"}}\n\n",
        ),
        (
            "chat-completions",
            200,
            "data: malformed selected-secret\n\n",
        ),
        (
            "responses",
            200,
            "data: {\"type\":\"error\",\"message\":\"selected-secret rejected\"}\n\n",
        ),
        (
            "messages",
            200,
            "data: {\"type\":\"error\",\"error\":{\"message\":\"selected-secret rejected\"}}\n\n",
        ),
    ] {
        let (base, task) = server(response(status, body, ""), 1).await;
        let (result, events) = call(&service(&base, protocol)).await;
        let error = result.unwrap_err();
        assert!(!error.to_string().contains("selected-secret"));
        assert!(!format!("{error:?}").contains("selected-secret"));
        assert!(!events.iter().any(|e| matches!(e, AiChunk::Done { .. })));
        task.await.unwrap();
    }
}

#[tokio::test]
async fn service_does_not_follow_redirects() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let location = format!(
        "Location: http://{}/stolen\r\n",
        listener.local_addr().unwrap()
    );
    let (base, task) = server(response(307, "moved", &location), 1).await;
    let (result, _) = call(&service(&base, "messages")).await;
    assert!(matches!(result, Err(AiError::Api { status: 307, .. })));
    assert!(
        tokio::time::timeout(Duration::from_millis(100), listener.accept())
            .await
            .is_err()
    );
    task.await.unwrap();
}

#[tokio::test]
async fn service_cancellation_interrupts_all_protocols_and_cleans_up() {
    for protocol in ["messages", "responses", "chat-completions"] {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let svc = Arc::new(service(&base, protocol));
        let runner = svc.clone();
        let task = tokio::spawn(async move { call(&runner).await });
        let (_socket, _) = tokio::time::timeout(Duration::from_secs(1), listener.accept())
            .await
            .unwrap()
            .unwrap();
        assert!(svc.cancel("test-request"));
        let (result, events) = task.await.unwrap();
        assert!(matches!(result, Err(AiError::Cancelled(_))));
        assert!(!events.iter().any(|e| matches!(e, AiChunk::Done { .. })));
        assert!(!svc.cancel("test-request"));
    }
}

#[tokio::test]
async fn missing_key_fails_before_started_or_http() {
    let svc = AiService::with_settings(resolve(&[]).unwrap());
    let (result, events) = call(&svc).await;
    assert!(matches!(result, Err(AiError::MissingApiKey)));
    assert!(events.is_empty());
    assert!(!svc.cancel("test-request"));
}

#[tokio::test]
async fn transport_error_and_status_do_not_echo_key_in_configured_url() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/selected-secret", listener.local_addr().unwrap());
    drop(listener);
    let svc = service(&base, "chat-completions");
    assert!(!serde_json::to_string(&svc.current_status())
        .unwrap()
        .contains("selected-secret"));
    let (result, _) = call(&svc).await;
    let error = result.unwrap_err();
    assert!(!error.to_string().contains("selected-secret"));
    assert!(!format!("{error:?}").contains("selected-secret"));
}

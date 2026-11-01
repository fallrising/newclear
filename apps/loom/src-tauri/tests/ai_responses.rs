//! Responses wire regressions against the public Provider/Streamer seam.
//! Every HTTP call uses loopback; no vendor credentials or paid requests.
use std::time::Duration;

use loom_core::ai::client::Streamer;
use loom_core::ai::error::AiError;
use loom_core::ai::provider::{
    CompletionInput, PinnedContext, PreparedRequest, Provider, ProviderConfig, ProviderKind,
    StreamEvent, Usage,
};
use loom_core::ai::providers::ResponsesProvider;
use serde_json::json;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

fn config() -> ProviderConfig {
    ProviderConfig {
        api_key: "synthetic-key".into(),
        model: "synthetic-model".into(),
        system_prompt: "Follow the user's instructions.".into(),
        max_tokens: 64,
    }
}

fn input() -> CompletionInput {
    CompletionInput {
        prompt: "Explain this code".into(),
        context_doc: Some("active document 中文😀".into()),
        pinned_context: vec![PinnedContext {
            source: "reference.rs".into(),
            content: "pinned document".into(),
        }],
    }
}

fn text(events: &[StreamEvent]) -> String {
    events
        .iter()
        .filter_map(|event| match event {
            StreamEvent::TextDelta(text) => Some(text.as_str()),
            _ => None,
        })
        .collect()
}

fn completed() -> String {
    json!({
        "type": "response.completed",
        "response": {
            "status": "completed",
            "output": [{"content": [{"type": "output_text", "text": "aggregate must not repeat"}]}],
            "usage": {
                "input_tokens": 12,
                "output_tokens": 7,
                "input_tokens_details": {"cached_tokens": 5, "cache_write_tokens": 2},
                "output_tokens_details": {"reasoning_tokens": 2},
                "total_tokens": 19
            }
        }
    })
    .to_string()
}

fn frame(data: &str) -> Vec<u8> {
    format!("data: {data}\n\n").into_bytes()
}

#[test]
fn prepares_responses_body_auth_and_document_context() {
    let prepared = ResponsesProvider.prepare(&config(), &input());
    assert_eq!(ResponsesProvider.kind(), ProviderKind::OpenAi);
    assert_eq!(prepared.url, "https://api.openai.com/v1/responses");
    assert!(prepared
        .headers
        .contains(&("authorization".into(), "Bearer synthetic-key".into())));
    assert!(prepared
        .headers
        .contains(&("content-type".into(), "application/json".into())));
    assert_eq!(
        prepared.body,
        json!({
            "model": "synthetic-model",
            "instructions": "Follow the user's instructions.",
            "input": "<context source=\"reference.rs\">\npinned document\n</context>\n\nThe following is the user's current document:\n\n---\nactive document 中文😀\n---\n\nUser's instruction:\nExplain this code",
            "max_output_tokens": 64,
            "stream": true
        })
    );
}

#[test]
fn empty_active_document_and_multiple_pins_preserve_prompt() {
    let mut req = input();
    req.context_doc = Some(" \n\t ".into());
    req.pinned_context.push(PinnedContext {
        source: "second.md".into(),
        content: "second pin".into(),
    });
    let body = ResponsesProvider.prepare(&config(), &req).body;
    assert_eq!(body["input"], "<context source=\"reference.rs\">\npinned document\n</context>\n\n<context source=\"second.md\">\nsecond pin\n</context>\n\nExplain this code");
    req.context_doc = None;
    req.pinned_context.clear();
    assert_eq!(
        ResponsesProvider.prepare(&config(), &req).body["input"],
        req.prompt
    );
}

#[test]
fn only_text_and_refusal_deltas_emit_visible_text() {
    for event_type in ["response.output_text.delta", "response.refusal.delta"] {
        let events = ResponsesProvider
            .parse_event(&json!({"type": event_type, "delta": "中文😀"}).to_string())
            .unwrap();
        assert_eq!(text(&events), "中文😀");
        assert_eq!(events.len(), 1);
        assert!(ResponsesProvider
            .parse_event(&json!({"type": event_type, "delta": ""}).to_string())
            .unwrap()
            .is_empty());
    }
    for event in [
        json!({"type": "response.output_text.done", "text": "aggregate"}),
        json!({"type": "response.refusal.done", "refusal": "aggregate"}),
        json!({"type": "response.created", "response": {"status": "in_progress", "usage": {"input_tokens": 999, "output_tokens": 999}}}),
        json!({"type": "response.in_progress", "response": {"status": "in_progress"}}),
        json!({"type": "response.reasoning_text.delta", "delta": "hidden reasoning"}),
        json!({"type": "response.function_call_arguments.delta", "delta": "hidden tool"}),
        json!({"type": "future.metadata", "delta": "hidden metadata"}),
    ] {
        assert!(
            ResponsesProvider
                .parse_event(&event.to_string())
                .unwrap()
                .is_empty(),
            "{event}"
        );
    }
}

#[test]
fn completed_emits_final_usage_then_terminal_without_aggregate_text() {
    let events = ResponsesProvider.parse_event(&completed()).unwrap();
    assert_eq!(events.len(), 2);
    let StreamEvent::Usage(usage) = &events[0] else {
        panic!("usage first")
    };
    assert_eq!(
        (
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_input_tokens,
            usage.cache_creation_input_tokens
        ),
        (12, 7, 5, 2)
    );
    assert!(matches!(events[1], StreamEvent::StreamDone));
    for usage in [json!(null), json!({"input_tokens": 3, "output_tokens": 2})] {
        let events = ResponsesProvider.parse_event(&json!({"type": "response.completed", "response": {"status": "completed", "usage": usage}}).to_string()).unwrap();
        assert!(matches!(events.last(), Some(StreamEvent::StreamDone)));
    }
}

#[test]
fn known_errors_and_malformed_events_fail() {
    let failures = [
        json!({"type": "error", "message": "overloaded"}),
        json!({"type": "response.failed", "response": {"status": "failed", "error": {"message": "overloaded", "code": "server_error"}}}),
        json!({"type": "response.incomplete", "response": {"status": "incomplete", "incomplete_details": {"reason": "max_output_tokens"}}}),
    ];
    for event in failures {
        assert!(
            matches!(
                ResponsesProvider.parse_event(&event.to_string()),
                Err(AiError::Stream(_))
            ),
            "{event}"
        );
    }
    let malformed = [
        "{",
        "[]",
        "{}",
        "[DONE]",
        r#"{"type":7}"#,
        r#"{"type":"response.output_text.delta"}"#,
        r#"{"type":"response.refusal.delta","delta":null}"#,
        r#"{"type":"response.output_text.delta","delta":1}"#,
        r#"{"type":"response.output_text.done"}"#,
        r#"{"type":"response.refusal.done"}"#,
        r#"{"type":"response.completed"}"#,
        r#"{"type":"response.completed","response":null}"#,
        r#"{"type":"response.completed","response":{"status":"failed"}}"#,
        r#"{"type":"response.completed","response":{"status":"completed","usage":{}}}"#,
        r#"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":-1,"output_tokens":2}}}"#,
        r#"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":4294967296}}}"#,
        r#"{"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":1,"output_tokens":2,"input_tokens_details":{"cached_tokens":"invalid"}}}}"#,
        r#"{"type":"response.created"}"#,
        r#"{"type":"response.in_progress","response":[]}"#,
        r#"{"type":"error"}"#,
    ];
    for payload in malformed {
        assert!(
            matches!(
                ResponsesProvider.parse_event(payload),
                Err(AiError::Stream(_))
            ),
            "payload {payload}"
        );
    }
}

struct LoopbackResponses {
    url: String,
}
impl Provider for LoopbackResponses {
    fn kind(&self) -> ProviderKind {
        ResponsesProvider.kind()
    }
    fn prepare(&self, cfg: &ProviderConfig, input: &CompletionInput) -> PreparedRequest {
        let mut request = ResponsesProvider.prepare(cfg, input);
        request.url.clone_from(&self.url);
        request
    }
    fn parse_event(&self, data: &str) -> Result<Vec<StreamEvent>, AiError> {
        ResponsesProvider.parse_event(data)
    }
}

async fn server(
    chunks: Vec<Vec<u8>>,
    hold_open: bool,
) -> (Streamer, tokio::task::JoinHandle<Vec<u8>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/responses", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buf = [0; 1024];
        loop {
            let n = socket.read(&mut buf).await.unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buf[..n]);
            if let Some(end) = request.windows(4).position(|w| w == b"\r\n\r\n") {
                let headers = std::str::from_utf8(&request[..end]).unwrap();
                let length: usize = headers
                    .lines()
                    .find_map(|line| {
                        let (name, value) = line.split_once(':')?;
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse().unwrap())
                    })
                    .unwrap();
                if request.len() >= end + 4 + length {
                    break;
                }
            }
        }
        socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n").await.unwrap();
        for chunk in chunks.into_iter().filter(|chunk| !chunk.is_empty()) {
            socket
                .write_all(format!("{:x}\r\n", chunk.len()).as_bytes())
                .await
                .unwrap();
            socket.write_all(&chunk).await.unwrap();
            socket.write_all(b"\r\n").await.unwrap();
        }
        if hold_open {
            std::future::pending::<()>().await;
        }
        socket.write_all(b"0\r\n\r\n").await.unwrap();
        request
    });
    (
        Streamer::new(config(), Box::new(LoopbackResponses { url })),
        task,
    )
}

async fn run(chunks: Vec<Vec<u8>>) -> (Result<Usage, AiError>, Vec<StreamEvent>, Vec<u8>) {
    let (streamer, task) = server(chunks, false).await;
    let mut events = Vec::new();
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        streamer.stream(
            input(),
            CancellationToken::new(),
            "responses-test".into(),
            |event| events.push(event),
        ),
    )
    .await
    .expect("bounded loopback stream");
    (result, events, task.await.unwrap())
}

#[tokio::test]
async fn loopback_preserves_unicode_crlf_multiline_auth_and_final_usage_once() {
    let wire = format!(": comment\r\nevent: response.output_text.delta\r\ndata: {{\r\ndata: \"type\":\"response.output_text.delta\",\"delta\":\"中文😀 café\"}}\r\n\r\ndata: {{\"type\":\"response.refusal.delta\",\"delta\":\" refusal\"}}\r\n\r\ndata: {}\r\n\r\ndata: invalid trailing payload\r\n\r\n", completed());
    // Separate every byte in HTTP framing, including the middle of UTF-8.
    let (result, events, request) = run(wire.bytes().map(|byte| vec![byte]).collect()).await;
    let usage = result.unwrap();
    assert_eq!(text(&events), "中文😀 café refusal");
    assert_eq!(
        (
            usage.input_tokens,
            usage.output_tokens,
            usage.cache_read_input_tokens
        ),
        (12, 7, 5)
    );
    assert_eq!(
        events
            .iter()
            .filter(|ev| matches!(ev, StreamEvent::Usage(_)))
            .count(),
        1
    );
    let request = String::from_utf8(request).unwrap();
    assert!(request.starts_with("POST /responses HTTP/1.1\r\n"));
    assert!(request.contains("authorization: Bearer synthetic-key\r\n"));
    let body: serde_json::Value =
        serde_json::from_str(request.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body, ResponsesProvider.prepare(&config(), &input()).body);
}

#[tokio::test]
async fn completed_finishes_without_http_eof() {
    let (streamer, task) = server(vec![frame(&completed())], true).await;
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        streamer.stream(input(), CancellationToken::new(), "done".into(), |_| {}),
    )
    .await;
    task.abort();
    assert!(matches!(result, Ok(Ok(_))), "{result:?}");
}

#[tokio::test]
async fn eof_malformed_and_provider_failure_never_emit_success_usage() {
    for wire in [
        Vec::new(),
        frame(r#"{"type":"response.output_text.delta","delta":"partial"}"#),
        format!("data: {}\n", completed()).into_bytes(),
        frame(r#"{"type":"response.completed","response":{}}"#),
        frame(r#"{"type":"error","message":"overloaded"}"#),
        frame(
            r#"{"type":"response.failed","response":{"status":"failed","error":{"message":"overloaded"}}}"#,
        ),
        frame(
            r#"{"type":"response.incomplete","response":{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"}}}"#,
        ),
        b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"\xff\"}\n\n".to_vec(),
    ] {
        let (result, events, _) = run(vec![wire.clone()]).await;
        assert!(
            matches!(result, Err(AiError::Stream(_))),
            "{wire:?}: {result:?}"
        );
        assert!(!events
            .iter()
            .any(|event| matches!(event, StreamEvent::Usage(_))));
    }
}

#[tokio::test]
async fn cancellation_interrupts_stalled_response() {
    let (streamer, task) = server(vec![], true).await;
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    let cancel_task = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        trigger.cancel();
    });
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        streamer.stream(input(), cancel, "cancelled-response".into(), |_| {
            panic!("stalled stream has no events")
        }),
    )
    .await;
    task.abort();
    cancel_task.await.unwrap();
    assert!(matches!(result, Ok(Err(AiError::Cancelled(ref id))) if id == "cancelled-response"));
}

#[tokio::test]
async fn cancellation_from_delta_stops_remaining_frames() {
    let mut wire = frame(r#"{"type":"response.output_text.delta","delta":"first"}"#);
    wire.extend(frame(
        r#"{"type":"response.output_text.delta","delta":"second"}"#,
    ));
    wire.extend(frame(&completed()));
    let (streamer, task) = server(vec![wire], false).await;
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    let mut events = Vec::new();
    let result = streamer
        .stream(input(), cancel, "cancelled-response".into(), |event| {
            events.push(event);
            trigger.cancel();
        })
        .await;
    task.await.unwrap();
    assert!(matches!(result, Err(AiError::Cancelled(_))));
    assert_eq!(text(&events), "first");
    assert_eq!(events.len(), 1);
}

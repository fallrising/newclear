use super::*;
use crate::ai::provider::{PreparedRequest, ProviderKind};
use crate::ai::providers::{anthropic::AnthropicProvider, openai::OpenAiProvider};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

// Exercise the real HTTP streamer and real provider parsers, redirecting
// only request construction to a loopback server. No keys or external API.
struct LocalProvider {
    url: String,
    parser: Box<dyn Provider>,
}
impl Provider for LocalProvider {
    fn kind(&self) -> ProviderKind {
        self.parser.kind()
    }
    fn prepare(&self, _: &ProviderConfig, _: &CompletionInput) -> PreparedRequest {
        PreparedRequest {
            url: self.url.clone(),
            headers: vec![],
            body: serde_json::json!({}),
        }
    }
    fn parse_event(&self, data: &str) -> AiResult<Vec<StreamEvent>> {
        self.parser.parse_event(data)
    }
}

async fn server(
    body: Vec<u8>,
    status: u16,
    hold_open: bool,
) -> (String, tokio::task::JoinHandle<()>) {
    server_chunks(vec![body], status, hold_open).await
}

async fn server_chunks(
    chunks: Vec<Vec<u8>>,
    status: u16,
    hold_open: bool,
) -> (String, tokio::task::JoinHandle<()>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut request = Vec::new();
        let mut buf = [0; 1024];
        // The test provider always sends a two-byte JSON object. Drain it
        // before closing the socket so unread input cannot cause a TCP reset.
        while !request
            .windows(4)
            .position(|w| w == b"\r\n\r\n")
            .is_some_and(|end| request.len() >= end + 4 + 2)
        {
            let n = socket.read(&mut buf).await.unwrap();
            assert!(n > 0);
            request.extend_from_slice(&buf[..n]);
        }
        let header = format!("HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n");
        socket.write_all(header.as_bytes()).await.unwrap();
        for body in chunks.into_iter().filter(|body| !body.is_empty()) {
            let chunk_header = format!("{:x}\r\n", body.len());
            socket.write_all(chunk_header.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
            socket.write_all(b"\r\n").await.unwrap();
        }
        if hold_open {
            std::future::pending::<()>().await;
        } else {
            socket.write_all(b"0\r\n\r\n").await.unwrap();
        }
    });
    (url, task)
}

async fn run(body: &[u8], parser: Box<dyn Provider>) -> (AiResult<Usage>, Vec<StreamEvent>) {
    let (url, task) = server(body.to_vec(), 200, false).await;
    let mut events = vec![];
    let result = tokio::time::timeout(
        Duration::from_secs(2),
        streamer(url, parser).stream(input(), CancellationToken::new(), "test".into(), |ev| {
            events.push(ev)
        }),
    )
    .await
    .expect("stream finishes");
    task.await.unwrap();
    (result, events)
}
fn streamer(url: String, parser: Box<dyn Provider>) -> Streamer {
    Streamer::new(
        ProviderConfig {
            api_key: "unused".into(),
            model: "test".into(),
            system_prompt: String::new(),
            max_tokens: 10,
        },
        Box::new(LocalProvider { url, parser }),
    )
}
fn input() -> CompletionInput {
    CompletionInput {
        prompt: "test".into(),
        context_doc: None,
        pinned_context: vec![],
    }
}
fn text(events: &[StreamEvent]) -> String {
    events
        .iter()
        .filter_map(|ev| match ev {
            StreamEvent::TextDelta(s) => Some(s.as_str()),
            _ => None,
        })
        .collect()
}

#[tokio::test]
async fn crlf_and_multiline_sse_preserve_text() {
    let body = "event: message\r\ndata: {\r\ndata: \"choices\":[{\"delta\":{\"content\":\"中文😀\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n";
    let (result, events) = run(body.as_bytes(), Box::new(OpenAiProvider::openai())).await;
    result.unwrap();
    assert_eq!(text(&events), "中文😀");
}

#[tokio::test]
async fn eof_without_terminal_marker_is_an_error() {
    for body in [
        "",
        "data: {\"choices\":[]}\n\n",
        "data: [DONE]\n",
        "data: {",
    ] {
        let (result, events) = run(body.as_bytes(), Box::new(OpenAiProvider::openai())).await;
        assert!(
            matches!(result, Err(AiError::Stream(_))),
            "body {body:?}: {result:?}"
        );
        assert!(!events.iter().any(|ev| matches!(ev, StreamEvent::Usage(_))));
    }
}

#[tokio::test]
async fn terminal_marker_stops_before_trailing_frames() {
    let (result, events) = run(
        b"data: [DONE]\n\ndata: not-json\n\n",
        Box::new(OpenAiProvider::openai()),
    )
    .await;
    result.unwrap();
    assert_eq!(text(&events), "");
}

#[tokio::test]
async fn malformed_utf8_in_sse_is_an_error() {
    let (result, _) = run(
        b"data: {\"choices\":[{\"delta\":{\"content\":\"\xff\"}}]}\n\ndata: [DONE]\n\n",
        Box::new(OpenAiProvider::openai()),
    )
    .await;
    assert!(matches!(result, Err(AiError::Stream(_))));
}

#[tokio::test]
async fn provider_error_events_fail_without_success_usage() {
    for parser in [
        Box::new(OpenAiProvider::openai()) as Box<dyn Provider>,
        Box::new(OpenAiProvider::deepseek()),
        Box::new(AnthropicProvider),
    ] {
        let (result, events) = run(b"data: {\"type\":\"error\",\"error\":{\"message\":\"overloaded\"}}\n\ndata: [DONE]\n\n", parser).await;
        assert!(
            matches!(result, Err(AiError::Stream(ref s)) if s.contains("overloaded")),
            "{result:?}"
        );
        assert!(!events.iter().any(|ev| matches!(ev, StreamEvent::Usage(_))));
    }
}

#[tokio::test]
async fn cancellation_interrupts_a_stalled_success_or_error_body() {
    for status in [200, 503] {
        let (url, task) = server(vec![], status, true).await;
        let cancel = CancellationToken::new();
        let trigger = cancel.clone();
        let cancel_task = tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(100)).await;
            trigger.cancel();
        });
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            streamer(url, Box::new(OpenAiProvider::openai())).stream(
                input(),
                cancel,
                "cancel-test".into(),
                |_| {},
            ),
        )
        .await;
        task.abort();
        cancel_task.await.unwrap();
        assert!(
            matches!(result, Ok(Err(AiError::Cancelled(ref id))) if id == "cancel-test"),
            "status {status}: {result:?}"
        );
    }
}

#[test]
fn sse_data_fields_preserve_spaces_and_empty_lines() {
    assert_eq!(
        decode_frame("data:  leading\ndata:\ndata: trailing \n\n"),
        Some(" leading\n\ntrailing ".into())
    );
    assert_eq!(decode_frame(": keepalive\n\n"), None);
    assert_eq!(decode_frame("data\n\n"), Some(String::new()));
}

#[tokio::test]
async fn anthropic_terminal_event_completes_and_stops() {
    let (result, events) = run(b"data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"hello\"}}\n\ndata: {\"type\":\"message_stop\"}\n\ndata: invalid\n\n", Box::new(AnthropicProvider)).await;
    result.unwrap();
    assert_eq!(text(&events), "hello");
}

fn decode_frame(event: &str) -> Option<String> {
    let mut decoder = SseDecoder::default();
    event.bytes().find_map(|byte| decoder.push(byte).unwrap())
}

#[test]
fn sse_utf8_and_framing_survive_every_chunk_split() {
    for newline in ["\n", "\r\n", "\r"] {
        let wire = format!(": comment{newline}event: message{newline}data: {{\"choices\":[{{\"delta\":{{\"content\":\"中文😀 café\"}}}}]}}{newline}{newline}data: [DONE]{newline}{newline}");
        for split in 0..=wire.len() {
            let mut decoder = SseDecoder::default();
            let mut events = Vec::new();
            let parser = OpenAiProvider::openai();
            for chunk in [&wire.as_bytes()[..split], &wire.as_bytes()[split..]] {
                for &byte in chunk {
                    if let Some(payload) = decoder.push(byte).unwrap() {
                        events.extend(parser.parse_event(&payload).unwrap());
                    }
                }
            }
            assert_eq!(
                text(&events),
                "中文😀 café",
                "newline {newline:?}, split {split}"
            );
            assert!(matches!(events.last(), Some(StreamEvent::StreamDone)));
        }
    }
}

#[tokio::test]
async fn malformed_json_and_incomplete_utf8_at_eof_fail() {
    for body in [b"data: {broken}\n\n".as_slice(), b"data: \xf0\x9f"] {
        let (result, events) = run(body, Box::new(OpenAiProvider::openai())).await;
        assert!(matches!(result, Err(AiError::Stream(_))));
        assert!(!events
            .iter()
            .any(|event| matches!(event, StreamEvent::Usage(_))));
    }
}

#[tokio::test]
async fn terminal_marker_finishes_without_waiting_for_http_eof() {
    let (url, task) = server(b"data: [DONE]\n\n".to_vec(), 200, true).await;
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        streamer(url, Box::new(OpenAiProvider::openai())).stream(
            input(),
            CancellationToken::new(),
            "test".into(),
            |_| {},
        ),
    )
    .await;
    task.abort();
    assert!(matches!(result, Ok(Ok(_))));
}

#[tokio::test]
async fn cancellation_from_delta_stops_remaining_events_in_same_chunk() {
    let (url, task) = server(b"data: {\"choices\":[{\"delta\":{\"content\":\"first\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"second\"}}]}\n\ndata: [DONE]\n\n".to_vec(), 200, false).await;
    let cancel = CancellationToken::new();
    let trigger = cancel.clone();
    let mut events = Vec::new();
    let result = streamer(url, Box::new(OpenAiProvider::openai()))
        .stream(input(), cancel, "test".into(), |ev| {
            events.push(ev);
            trigger.cancel();
        })
        .await;
    task.await.unwrap();
    assert!(matches!(result, Err(AiError::Cancelled(_))));
    assert_eq!(text(&events), "first");
    assert_eq!(events.len(), 1);
}

#[tokio::test]
async fn normal_http_error_preserves_status_and_body() {
    let (url, task) = server(b"temporarily unavailable".to_vec(), 503, false).await;
    let result = streamer(url, Box::new(OpenAiProvider::openai()))
        .stream(input(), CancellationToken::new(), "test".into(), |_| {
            panic!("no events on HTTP error")
        })
        .await;
    task.await.unwrap();
    assert!(
        matches!(result, Err(AiError::Api { status: 503, body }) if body == "temporarily unavailable")
    );
}

#[tokio::test]
async fn one_byte_http_chunks_preserve_provider_text() {
    let cases: Vec<(Box<dyn Provider>, &str)> = vec![
        (Box::new(OpenAiProvider::openai()), "data: {\"choices\":[{\"delta\":{\"content\":\"中文😀\"}}]}\r\n\r\ndata: [DONE]\r\n\r\n"),
        (Box::new(AnthropicProvider), "data: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"中文😀\"}}\n\ndata: {\"type\":\"message_stop\"}\n\n"),
    ];
    for (parser, body) in cases {
        let chunks = body.bytes().map(|byte| vec![byte]).collect();
        let (url, task) = server_chunks(chunks, 200, false).await;
        let mut events = Vec::new();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            streamer(url, parser).stream(
                input(),
                CancellationToken::new(),
                "test".into(),
                |event| events.push(event),
            ),
        )
        .await
        .unwrap();
        result.unwrap();
        task.await.unwrap();
        assert_eq!(text(&events), "中文😀");
    }
}

//! `/v1/responses` streaming in front of an OpenAI chat-format upstream: chunks with
//! text and tool calls become proper Responses events. Local mock upstream only.

use std::time::Duration;

use axum::body::Body;
use axum::extract::Request;
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::routing::post;
use axum::Router;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tokio::net::TcpListener;

/// Streams "Let me check." then a lookup tool call, with usage on the last chunk.
async fn chat_mock(req: Request) -> Response {
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(v["stream"], true);
    assert_eq!(
        v["tools"][0]["function"]["name"], "lookup",
        "tools reach the chat upstream"
    );
    let chunks = [
        json!({"id": "chatcmpl-5", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Let me "}}]}),
        json!({"id": "chatcmpl-5", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"content": "check."}}]}),
        json!({"id": "chatcmpl-5", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_7", "type": "function", "function": {"name": "lookup", "arguments": ""}}]}}]}),
        json!({"id": "chatcmpl-5", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{\"q\":\"x\"}"}}]}}]}),
        json!({"id": "chatcmpl-5", "object": "chat.completion.chunk", "choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 9, "completion_tokens": 4}}),
    ];
    let mut text: String = chunks.iter().map(|c| format!("data: {c}\n\n")).collect();
    text.push_str("data: [DONE]\n\n");
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from(text))
        .unwrap()
}

#[tokio::test]
async fn responses_stream_over_chat_upstream_carries_tool_calls() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream = format!("http://{}/v1", listener.local_addr().unwrap());
    tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().route("/v1/chat/completions", post(chat_mock)),
        )
        .await
        .unwrap()
    });

    let dir = tempfile::tempdir().unwrap();
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let _child = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
        .args([
            "serve",
            "--port",
            &port.to_string(),
            "--data-dir",
            dir.path().to_str().unwrap(),
        ])
        .env_remove("THINROUTER_ADMIN_TOKEN")
        .env_remove("THINROUTER_SECRETS_KEY")
        .env_remove("HTTPS_PROXY")
        .env_remove("HTTP_PROXY")
        .env_remove("ALL_PROXY")
        .kill_on_drop(true)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let base = format!("http://127.0.0.1:{port}");
    let plain = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    for _ in 0..100 {
        if plain
            .get(format!("{base}/health"))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    let admin = std::fs::read_to_string(dir.path().join("admin-token")).unwrap();
    let admin_post = |path: &str, body: Value| {
        plain
            .post(format!("{base}{path}"))
            .header("x-admin-token", admin.trim())
            .json(&body)
            .send()
    };
    assert_eq!(
        admin_post(
            "/admin/api/connections",
            json!({"name": "chat", "base_url": upstream, "api_key": "k", "default_model": "m"}),
        )
        .await
        .unwrap()
        .status(),
        201
    );
    let key: Value = admin_post("/admin/api/keys", json!({"name": "t"}))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();

    let r = plain
        .post(format!("{base}/v1/responses"))
        .bearer_auth(key["secret"].as_str().unwrap())
        .json(&json!({
            "model": "chat", "stream": true, "input": "find x",
            "tools": [{"type": "function", "name": "lookup", "parameters": {"type": "object"}}]
        }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);
    let text = r.text().await.unwrap();
    assert!(!text.contains("[DONE]"), "Responses streams have no [DONE]");
    let events: Vec<Value> = text
        .lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .map(|d| serde_json::from_str(d).unwrap())
        .collect();
    let types: Vec<&str> = events.iter().filter_map(|e| e["type"].as_str()).collect();
    assert_eq!(types.first(), Some(&"response.created"));
    assert_eq!(types.last(), Some(&"response.completed"));
    let args: String = events
        .iter()
        .filter(|e| e["type"] == "response.function_call_arguments.delta")
        .filter_map(|e| e["delta"].as_str())
        .collect();
    assert_eq!(args, "{\"q\":\"x\"}");
    let done = &events.last().unwrap()["response"];
    assert_eq!(done["output"][0]["content"][0]["text"], "Let me check.");
    assert_eq!(done["output"][1]["type"], "function_call");
    assert_eq!(done["output"][1]["call_id"], "call_7");
    assert_eq!(done["output"][1]["name"], "lookup");
    assert_eq!(done["usage"]["input_tokens"], 9);
}

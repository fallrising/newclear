//! Responses-upstream (siwc) end-to-end tests through all three client surfaces.
//! The upstream is a local scripted SSE server; no real credentials or providers.

use std::sync::{Arc, Mutex};
use std::time::Duration;

use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{header, StatusCode};
use axum::response::Response;
use axum::Router;
use http_body_util::BodyExt;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

type Seen = Arc<Mutex<Vec<(Vec<(String, String)>, Value)>>>;

fn sse(events: &[Value]) -> String {
    events
        .iter()
        .map(|e| format!("event: {}\ndata: {e}\n\n", e["type"].as_str().unwrap()))
        .collect()
}

/// Scripted Responses upstream: tools + fresh turn → function call; tool output → answer using it;
/// image → "saw image"; otherwise plain text. Always SSE, like the ChatGPT backend.
async fn responses_mock(State(seen): State<Seen>, req: Request) -> Response {
    let headers = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let expired = req
        .headers()
        .get("authorization")
        .is_some_and(|a| a == "Bearer expired");
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&body).unwrap();
    seen.lock().unwrap().push((headers, v.clone()));
    if expired {
        return Response::builder()
            .status(StatusCode::UNAUTHORIZED)
            .body(Body::from(r#"{"error":{"code":"token_expired"}}"#))
            .unwrap();
    }

    let input = v["input"].as_array().cloned().unwrap_or_default();
    let last = input.last().cloned().unwrap_or(Value::Null);
    let has_image = input.iter().any(|i| {
        i["content"]
            .as_array()
            .is_some_and(|c| c.iter().any(|p| p["type"] == "input_image"))
    });
    let created = json!({"type": "response.created", "response": {"id": "resp_abc", "model": "gpt-mock", "status": "in_progress"}});
    let usage = json!({"input_tokens": 11, "output_tokens": 7, "total_tokens": 18});
    let text_events = |text: &str| -> Vec<Value> {
        let (a, b) = text.split_at(text.len() / 2);
        vec![
            json!({"type": "response.output_item.added", "output_index": 0, "item": {"type": "message", "id": "msg_1", "role": "assistant", "content": []}}),
            json!({"type": "response.output_text.delta", "item_id": "msg_1", "output_index": 0, "content_index": 0, "delta": a}),
            json!({"type": "response.output_text.delta", "item_id": "msg_1", "output_index": 0, "content_index": 0, "delta": b}),
            json!({"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "id": "msg_1", "role": "assistant", "content": [{"type": "output_text", "text": text}]}}),
        ]
    };

    let mut events = vec![created];
    let last_text = last["content"][0]["text"].as_str().unwrap_or("");
    if last_text.starts_with("jr_") {
        return Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(direct_json_fixture(last_text)))
            .unwrap();
    }
    if last_text.starts_with("br_") {
        let completed = json!({"type":"response.completed","response":{"id":"resp_abc","status":"completed","output":[],"usage":usage}});
        let error =
            json!({"type":"error","code":"unknown_fixture_code","message":"PRIVATE-ERROR-CANARY"});
        match last_text {
            "br_empty" => events.clear(),
            "br_partial" | "br_done" => events.push(json!({"type":"response.output_text.delta","delta":"PRIVATE-PARTIAL-CANARY"})),
            "br_item" => events.extend(text_events("PRIVATE-PARTIAL-CANARY")),
            "br_error" | "br_error_then_completed" => {
                events.push(error.clone());
                if last_text.ends_with("then_completed") { events.push(completed.clone()); }
            }
            "br_failed" | "br_failed_then_completed" | "br_quota" => {
                events.push(json!({"type":"response.failed","response":{"status":"failed","error":{"code":if last_text == "br_quota" {"subscription_sharing_usage_limit_exceeded"} else {"unknown_fixture_code"},"message":"PRIVATE-ERROR-CANARY"}}}));
                if last_text.ends_with("then_completed") { events.push(completed.clone()); }
            }
            "br_top_quota" => events.push(json!({"type":"error","code":"subscription_sharing_usage_unavailable","message":"PRIVATE-ERROR-CANARY"})),
            "br_malformed" => events.push(json!({"type":"response.completed","response":[]})),
            "br_conflict" => events.push(json!({"type":"response.completed","response":{"status":"in_progress"}})),
            "br_completed" | "br_incomplete" | "br_completed_late_error" => {
                events.extend(text_events("buffered success"));
                if last_text == "br_incomplete" {
                    events.push(json!({"type":"response.incomplete","response":{"status":"incomplete","output":[],"incomplete_details":{"reason":"max_output_tokens"},"usage":usage}}));
                } else { events.push(completed.clone()); }
                if last_text.ends_with("late_error") { events.push(error.clone()); }
            }
            _ => panic!("unknown fixture {last_text}"),
        }
        let mut raw = sse(&events);
        if last_text == "br_done" {
            raw.push_str("data: [DONE]\n\n");
        }
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/event-stream")
            .body(Body::from(raw))
            .unwrap();
    }
    if last_text == "quota" {
        events.push(json!({"type": "response.failed", "response": {"id": "resp_abc", "status": "failed",
            "error": {"code": "subscription_sharing_usage_limit_exceeded", "message": "plan limit reached"}}}));
        return Response::builder()
            .header(header::CONTENT_TYPE, "text/event-stream")
            .body(Body::from(sse(&events)))
            .unwrap();
    }
    if last["type"] == "function_call_output" {
        events.extend(text_events(&format!(
            "result: {}",
            last["output"].as_str().unwrap_or("")
        )));
    } else if v["tools"].as_array().is_some_and(|t| !t.is_empty()) {
        // SIWC groups client functions in a namespace tool.
        let tool = if v["tools"][0]["type"] == "namespace" {
            &v["tools"][0]["tools"][0]
        } else {
            &v["tools"][0]
        };
        let name = tool["name"].as_str().unwrap_or("missing_name");
        events.push(json!({"type": "response.output_item.added", "output_index": 0, "item": {"type": "reasoning", "id": "rs_1", "summary": []}}));
        events.push(json!({"type": "response.output_item.done", "output_index": 0, "item": {"type": "reasoning", "id": "rs_1", "summary": []}}));
        events.push(json!({"type": "response.output_item.added", "output_index": 1, "item": {"type": "function_call", "id": "fc_1", "call_id": "call_xyz", "name": name, "arguments": ""}}));
        events.push(json!({"type": "response.function_call_arguments.delta", "item_id": "fc_1", "output_index": 1, "delta": "{\"city\":"}));
        events.push(json!({"type": "response.function_call_arguments.delta", "item_id": "fc_1", "output_index": 1, "delta": "\"Taipei\"}"}));
        events.push(json!({"type": "response.function_call_arguments.done", "item_id": "fc_1", "output_index": 1, "arguments": "{\"city\":\"Taipei\"}"}));
        events.push(json!({"type": "response.output_item.done", "output_index": 1, "item": {"type": "function_call", "id": "fc_1", "call_id": "call_xyz", "name": name, "arguments": "{\"city\":\"Taipei\"}"}}));
    } else if has_image {
        events.extend(text_events("saw image"));
    } else {
        events.extend(text_events("hello from upstream"));
    }
    events.push(json!({"type": "response.completed", "response": {"id": "resp_abc", "model": "gpt-mock", "status": "completed", "output": [], "usage": usage}}));

    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from(sse(&events)))
        .unwrap()
}

struct Env {
    base: String,
    client: reqwest::Client,
    seen: Seen,
    _child: tokio::process::Child,
    _dir: TempDir,
}

impl Env {
    async fn start() -> Self {
        Self::start_with("siwc", json!({"client_id": "oaiapp_test"})).await
    }

    async fn start_with(provider: &str, meta: Value) -> Self {
        let seen: Seen = Arc::default();
        let app = Router::new()
            .fallback(responses_mock)
            .with_state(seen.clone());
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });

        let dir = tempfile::tempdir().unwrap();
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
            l.local_addr().unwrap().port()
        };
        let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
        cmd.args([
            "serve",
            "--port",
            &port.to_string(),
            "--data-dir",
            dir.path().to_str().unwrap(),
            "--provider-base-override",
            &format!("siwc={upstream},grok={upstream}"),
        ]);
        for name in [
            "THINROUTER_ADMIN_TOKEN",
            "THINROUTER_SECRETS_KEY",
            "THINROUTER_ALLOW_KEYLESS_BOOTSTRAP",
            "HTTPS_PROXY",
            "https_proxy",
            "HTTP_PROXY",
            "http_proxy",
            "ALL_PROXY",
            "all_proxy",
        ] {
            cmd.env_remove(name);
        }
        let child = cmd
            .kill_on_drop(true)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let plain = reqwest::Client::builder().no_proxy().build().unwrap();
        let mut healthy = false;
        for _ in 0..100 {
            if plain
                .get(format!("{base}/health"))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                healthy = true;
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        assert!(healthy);
        let admin = std::fs::read_to_string(dir.path().join("admin-token")).unwrap();
        let admin = admin.trim();
        let post_admin = |path: &str, body: Value| {
            plain
                .post(format!("{base}{path}"))
                .header("x-admin-token", admin)
                .json(&body)
                .send()
        };
        let r = post_admin(
            "/admin/api/connections/oauth/import",
            json!({
                "name": "cx", "provider": provider, "access_token": "test-access",
                "base_url": format!("{upstream}/v1"),
                "default_model": "gpt-mock", "meta": meta.to_string()
            }),
        )
        .await
        .unwrap();
        assert_eq!(r.status(), 201, "{}", r.text().await.unwrap());
        let key: Value = post_admin("/admin/api/keys", json!({"name": "e2e"}))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            header::AUTHORIZATION,
            format!("Bearer {}", key["secret"].as_str().unwrap())
                .parse()
                .unwrap(),
        );
        let client = reqwest::Client::builder()
            .no_proxy()
            .default_headers(headers)
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        Self {
            base,
            client,
            seen,
            _child: child,
            _dir: dir,
        }
    }

    async fn post(&self, path: &str, body: Value) -> reqwest::Response {
        let r = self
            .client
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "{path}");
        r
    }

    /// Last request body the mock upstream received.
    fn upstream_body(&self) -> Value {
        self.seen.lock().unwrap().last().unwrap().1.clone()
    }

    fn upstream_header(&self, name: &str) -> Option<String> {
        let seen = self.seen.lock().unwrap();
        seen.last()
            .unwrap()
            .0
            .iter()
            .find(|(k, _)| k == name)
            .map(|(_, v)| v.clone())
    }
}

/// `data:` payloads of an SSE body (keeping `[DONE]` as a string).
fn sse_data(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .map(|d| serde_json::from_str(d).unwrap_or_else(|_| Value::String(d.to_string())))
        .collect()
}

/// (event name, data) pairs of an Anthropic SSE body.
fn sse_events(text: &str) -> Vec<(String, Value)> {
    text.split("\n\n")
        .filter(|b| !b.trim().is_empty())
        .map(|b| {
            let mut name = String::new();
            let mut data = Value::Null;
            for l in b.lines() {
                if let Some(n) = l.strip_prefix("event: ") {
                    name = n.to_string();
                } else if let Some(d) = l.strip_prefix("data: ") {
                    data = serde_json::from_str(d).unwrap();
                }
            }
            (name, data)
        })
        .collect()
}

fn weather_tool_chat() -> Value {
    json!([{"type": "function", "function": {"name": "get_weather", "description": "weather", "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}])
}

#[tokio::test]
async fn chat_completions_over_responses_upstream() {
    let env = Env::start().await;

    // Non-stream text: upstream forced to stream, then reassembled.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "temperature": 0.3, "max_tokens": 9, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["choices"][0]["message"]["content"], "hello from upstream");
    assert_eq!(v["choices"][0]["finish_reason"], "stop");
    assert_eq!(v["usage"]["prompt_tokens"], 11);
    let up = env.upstream_body();
    assert_eq!(up["stream"], true);
    assert_eq!(up["store"], false);
    assert_eq!(up["model"], "gpt-mock");
    assert!(up.get("temperature").is_none() && up.get("max_output_tokens").is_none());
    assert_eq!(
        env.upstream_header("authorization").as_deref(),
        Some("Bearer test-access")
    );
    // No Codex client impersonation headers on the official API.
    assert!(!env
        .upstream_header("user-agent")
        .unwrap_or_default()
        .starts_with("codex_cli_rs"));
    assert!(env.upstream_header("originator").is_none());
    assert!(env.upstream_header("chatgpt-account-id").is_none());
    let first_key = up["prompt_cache_key"].as_str().unwrap().to_string();
    assert_eq!(
        env.upstream_header("session-id").as_deref(),
        Some(first_key.as_str())
    );
    assert_eq!(
        env.upstream_header("thread-id").as_deref(),
        Some(first_key.as_str())
    );

    // Stream text → chat.completion.chunk + [DONE].
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "stream": true, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    assert!(r.headers()["content-type"]
        .to_str()
        .unwrap()
        .starts_with("text/event-stream"));
    let chunks = sse_data(&r.text().await.unwrap());
    assert_eq!(chunks.last().unwrap(), "[DONE]");
    let objs: Vec<&Value> = chunks.iter().filter(|c| c.is_object()).collect();
    assert!(objs.iter().all(|c| c["object"] == "chat.completion.chunk"));
    assert_eq!(objs[0]["choices"][0]["delta"]["role"], "assistant");
    let text: String = objs
        .iter()
        .filter_map(|c| c["choices"][0]["delta"]["content"].as_str())
        .collect();
    assert_eq!(text, "hello from upstream");
    assert_eq!(objs.last().unwrap()["choices"][0]["finish_reason"], "stop");
    assert!(
        !chunks.iter().any(|c| c.get("type").is_some()),
        "no raw Responses events"
    );

    // Stream with tools → delta.tool_calls + finish_reason tool_calls.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "stream": true, "tools": weather_tool_chat(), "tool_choice": "auto",
                   "messages": [{"role": "user", "content": "weather?"}]}),
        )
        .await;
    let chunks = sse_data(&r.text().await.unwrap());
    let up = env.upstream_body();
    assert_eq!(up["tools"][0]["type"], "namespace");
    assert_eq!(up["tools"][0]["tools"][0]["name"], "get_weather");
    assert_eq!(up["tools"][0]["tools"][0]["type"], "function");
    let calls: Vec<&Value> = chunks
        .iter()
        .filter_map(|c| c.pointer("/choices/0/delta/tool_calls/0"))
        .collect();
    assert_eq!(calls[0]["id"], "call_xyz");
    assert_eq!(calls[0]["function"]["name"], "get_weather");
    let args: String = calls
        .iter()
        .filter_map(|c| c["function"]["arguments"].as_str())
        .collect();
    assert_eq!(args, "{\"city\":\"Taipei\"}");
    assert!(calls.iter().all(|c| c["index"] == 0));
    let tool_turn_key = env.upstream_body()["prompt_cache_key"].clone();
    let finish: Vec<&Value> = chunks
        .iter()
        .filter_map(|c| c.pointer("/choices/0/finish_reason"))
        .filter(|f| !f.is_null())
        .collect();
    assert_eq!(finish, [&json!("tool_calls")]);
    assert_eq!(chunks.last().unwrap(), "[DONE]");

    // Non-stream with tools.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "tools": weather_tool_chat(), "messages": [{"role": "user", "content": "weather?"}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["choices"][0]["finish_reason"], "tool_calls");
    assert_eq!(
        v["choices"][0]["message"]["tool_calls"][0]["id"],
        "call_xyz"
    );
    assert_eq!(
        v["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
        "{\"city\":\"Taipei\"}"
    );

    // Multi-round tool loop: ids line up, assistant history is output_text.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "stream": true, "tools": weather_tool_chat(), "messages": [
                {"role": "user", "content": "weather?"},
                {"role": "assistant", "content": "checking", "tool_calls": [{"id": "call_xyz", "type": "function", "function": {"name": "get_weather", "arguments": "{\"city\":\"Taipei\"}"}}]},
                {"role": "tool", "tool_call_id": "call_xyz", "content": "sunny"}
            ]}),
        )
        .await;
    let text: String = sse_data(&r.text().await.unwrap())
        .iter()
        .filter_map(|c| {
            c.pointer("/choices/0/delta/content")
                .and_then(|t| t.as_str())
        })
        .collect();
    assert_eq!(text, "result: sunny");
    let input = env.upstream_body()["input"].as_array().unwrap().clone();
    assert_eq!(input[1]["role"], "assistant");
    assert_eq!(input[1]["content"][0]["type"], "output_text");
    assert_eq!(input[2]["type"], "function_call");
    assert_eq!(input[2]["call_id"], "call_xyz");
    assert_eq!(input[3]["type"], "function_call_output");
    assert_eq!(input[3]["call_id"], "call_xyz");
    // Same conversation start → same cache key on the follow-up turn.
    assert_eq!(env.upstream_body()["prompt_cache_key"], tool_turn_key);

    // A client-supplied key is kept and drives the session headers.
    env.post(
        "/v1/chat/completions",
        json!({"model": "cx", "prompt_cache_key": "client-key-1", "messages": [{"role": "user", "content": "hi"}]}),
    )
    .await;
    assert_eq!(env.upstream_body()["prompt_cache_key"], "client-key-1");
    assert_eq!(
        env.upstream_header("session-id").as_deref(),
        Some("client-key-1")
    );

    // Image input survives.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "messages": [{"role": "user", "content": [
                {"type": "text", "text": "what?"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,iVBORw0KGgo="}}
            ]}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["choices"][0]["message"]["content"], "saw image");
    let part = &env.upstream_body()["input"][0]["content"][1];
    assert_eq!(part["type"], "input_image");
    assert_eq!(part["image_url"], "data:image/png;base64,iVBORw0KGgo=");
}

#[tokio::test]
async fn anthropic_messages_over_responses_upstream() {
    let env = Env::start().await;
    let tools = json!([{"name": "get_weather", "description": "weather", "input_schema": {"type": "object", "properties": {"city": {"type": "string"}}}}]);

    // Stream text.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cx", "max_tokens": 64, "stream": true, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let events = sse_events(&r.text().await.unwrap());
    let names: Vec<&str> = events.iter().map(|(n, _)| n.as_str()).collect();
    assert_eq!(
        names,
        [
            "message_start",
            "content_block_start",
            "content_block_delta",
            "content_block_delta",
            "content_block_stop",
            "message_delta",
            "message_stop"
        ]
    );
    let text: String = events
        .iter()
        .filter_map(|(_, d)| d.pointer("/delta/text").and_then(|t| t.as_str()))
        .collect();
    assert_eq!(text, "hello from upstream");
    assert_eq!(events[5].1["delta"]["stop_reason"], "end_turn");

    // Stream tool_use.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cx", "max_tokens": 64, "stream": true, "tools": tools,
                   "messages": [{"role": "user", "content": "weather?"}]}),
        )
        .await;
    let events = sse_events(&r.text().await.unwrap());
    let start = events
        .iter()
        .find(|(n, d)| n == "content_block_start" && d["content_block"]["type"] == "tool_use")
        .unwrap();
    assert_eq!(start.1["content_block"]["id"], "call_xyz");
    assert_eq!(start.1["content_block"]["name"], "get_weather");
    let json_args: String = events
        .iter()
        .filter_map(|(_, d)| d.pointer("/delta/partial_json").and_then(|t| t.as_str()))
        .collect();
    assert_eq!(json_args, "{\"city\":\"Taipei\"}");
    let delta = events.iter().find(|(n, _)| n == "message_delta").unwrap();
    assert_eq!(delta.1["delta"]["stop_reason"], "tool_use");
    assert_eq!(delta.1["usage"]["output_tokens"], 7);
    assert_eq!(events.last().unwrap().0, "message_stop");
    let starts = events
        .iter()
        .filter(|(n, _)| n == "content_block_start")
        .count();
    let stops = events
        .iter()
        .filter(|(n, _)| n == "content_block_stop")
        .count();
    assert_eq!(starts, stops);

    // Non-stream tool_use.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cx", "max_tokens": 64, "tools": tools, "messages": [{"role": "user", "content": "weather?"}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["stop_reason"], "tool_use");
    let tu = v["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["type"] == "tool_use")
        .unwrap();
    assert_eq!(tu["id"], "call_xyz");
    assert_eq!(tu["input"]["city"], "Taipei");

    // Multi-round with tool_result, non-stream.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cx", "max_tokens": 64, "tools": tools, "messages": [
                {"role": "user", "content": "weather?"},
                {"role": "assistant", "content": [{"type": "tool_use", "id": "toolu_01", "name": "get_weather", "input": {"city": "Taipei"}}]},
                {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "toolu_01", "content": "rainy"}]}
            ]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["content"][0]["text"], "result: rainy");
    assert_eq!(v["stop_reason"], "end_turn");
    let input = env.upstream_body()["input"].as_array().unwrap().clone();
    assert_eq!(input[1]["type"], "function_call");
    assert_eq!(input[1]["call_id"], "toolu_01");
    assert_eq!(input[1]["arguments"], "{\"city\":\"Taipei\"}");
    assert_eq!(input[2]["type"], "function_call_output");
    assert_eq!(input[2]["call_id"], "toolu_01");

    // Image block.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cx", "max_tokens": 64, "messages": [{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0KGgo="}},
                {"type": "text", "text": "what?"}
            ]}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["content"][0]["text"], "saw image");
    let part = &env.upstream_body()["input"][0]["content"][0];
    assert_eq!(part["type"], "input_image");
    assert_eq!(part["image_url"], "data:image/png;base64,iVBORw0KGgo=");
}

#[tokio::test]
async fn responses_api_is_forwarded_natively() {
    let env = Env::start().await;
    let tools =
        json!([{"type": "function", "name": "get_weather", "parameters": {"type": "object"}}]);

    // Stream: upstream SSE passes through untouched.
    let r = env
        .post(
            "/v1/responses",
            json!({"model": "cx", "stream": true, "tools": tools, "max_output_tokens": 100, "input": "weather?"}),
        )
        .await;
    let events = sse_data(&r.text().await.unwrap());
    let types: Vec<&str> = events.iter().filter_map(|e| e["type"].as_str()).collect();
    assert!(types.contains(&"response.function_call_arguments.delta"));
    assert!(types.contains(&"response.output_item.done"));
    assert_eq!(*types.last().unwrap(), "response.completed");
    let up = env.upstream_body();
    assert_eq!(
        up["tools"][0]["tools"], tools,
        "function tools grouped in a namespace"
    );
    assert_eq!(up["store"], false);
    assert!(up.get("max_output_tokens").is_none());
    assert_eq!(up["input"][0]["content"][0]["text"], "weather?");

    // Multi-round with reasoning + function_call items: forwarded as-is.
    let history = json!([
        {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "weather?"}]},
        {"type": "reasoning", "id": "rs_1", "summary": [], "encrypted_content": "opaque"},
        {"type": "function_call", "id": "fc_1", "call_id": "call_xyz", "name": "get_weather", "arguments": "{\"city\":\"Taipei\"}"},
        {"type": "function_call_output", "call_id": "call_xyz", "output": "windy"}
    ]);
    let r = env
        .post(
            "/v1/responses",
            json!({"model": "cx", "tools": tools, "include": ["reasoning.encrypted_content"], "input": history}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["object"], "response");
    assert_eq!(v["output"][0]["content"][0]["text"], "result: windy");
    assert_eq!(v["usage"]["input_tokens"], 11);
    let up = env.upstream_body();
    assert_eq!(up["input"], history);
    assert_eq!(up["include"], json!(["reasoning.encrypted_content"]));
    assert_eq!(up["stream"], true);

    // Non-stream tool call: function_call item in output.
    let r = env
        .post(
            "/v1/responses",
            json!({"model": "cx", "tools": tools, "input": "weather?"}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    let fc = v["output"]
        .as_array()
        .unwrap()
        .iter()
        .find(|i| i["type"] == "function_call")
        .unwrap();
    assert_eq!(fc["call_id"], "call_xyz");
    assert_eq!(fc["arguments"], "{\"city\":\"Taipei\"}");

    // Image input.
    let r = env
        .post(
            "/v1/responses",
            json!({"model": "cx", "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": "what?"},
                {"type": "input_image", "image_url": "https://example.com/cat.png"}
            ]}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["output"][0]["content"][0]["text"], "saw image");
}

#[tokio::test]
async fn siwc_provider_applies_preview_limits() {
    let env = Env::start().await;

    // Chat with tools: forced stream, store:false, fields dropped, tools in a namespace.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "temperature": 0.5, "max_tokens": 10, "tools": weather_tool_chat(),
                   "messages": [{"role": "system", "content": "be brief"}, {"role": "user", "content": "weather?"}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(
        v["choices"][0]["message"]["tool_calls"][0]["function"]["name"],
        "get_weather"
    );
    let up = env.upstream_body();
    assert_eq!(up["stream"], true);
    assert_eq!(up["store"], false);
    assert!(up.get("temperature").is_none() && up.get("max_output_tokens").is_none());
    assert_eq!(up["instructions"], "be brief");
    assert_eq!(up["tools"][0]["type"], "namespace");
    assert_eq!(up["tools"][0]["tools"][0]["name"], "get_weather");
    let key = up["prompt_cache_key"].as_str().unwrap().to_string();
    assert_eq!(
        env.upstream_header("session-id").as_deref(),
        Some(key.as_str())
    );

    // Responses: explicit system items become developer items.
    env.post(
        "/v1/responses",
        json!({"model": "cx", "metadata": {"x": 1}, "input": [
            {"type": "message", "role": "system", "content": "rules"},
            {"type": "message", "role": "user", "content": [{"type": "input_text", "text": "hi"}]}
        ]}),
    )
    .await;
    let up = env.upstream_body();
    assert_eq!(up["input"][0]["role"], "developer");
    assert!(up.get("metadata").is_none());

    // Unsupported state / hosted tools: clear 400, nothing sent upstream.
    let before = env.seen.lock().unwrap().len();
    for body in [
        json!({"model": "cx", "previous_response_id": "resp_1", "input": "hi"}),
        json!({"model": "cx", "tools": [{"type": "code_interpreter", "container": {"type": "auto"}}], "input": "hi"}),
    ] {
        let r = env
            .client
            .post(format!("{}/v1/responses", env.base))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 400);
        assert!(r.text().await.unwrap().contains("siwc"));
    }
    assert_eq!(env.seen.lock().unwrap().len(), before);

    // Plan quota exhausted mid-stream: non-stream → 429 with the code; stream → error record.
    let r = env
        .client
        .post(format!("{}/v1/chat/completions", env.base))
        .json(&json!({"model": "cx", "messages": [{"role": "user", "content": "quota"}]}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 429);
    assert!(r
        .text()
        .await
        .unwrap()
        .contains("subscription_sharing_usage_limit_exceeded"));
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "stream": true, "messages": [{"role": "user", "content": "quota"}]}),
        )
        .await;
    let chunks = sse_data(&r.text().await.unwrap());
    assert!(chunks
        .iter()
        .any(|c| c["error"]["code"] == "subscription_sharing_usage_limit_exceeded"));
    assert_eq!(chunks.last().unwrap(), "[DONE]");
}

#[tokio::test]
async fn borrowed_grok_login_is_reread_and_never_refreshed() {
    let home = tempfile::tempdir().unwrap();
    let grok_dir = home.path().join(".grok");
    std::fs::create_dir(&grok_dir).unwrap();
    let auth = grok_dir.join("auth.json");
    let write = |token: &str| {
        std::fs::write(
            &auth,
            json!({"https://auth.x.ai": {"key": token, "refresh_token": "rt-owned-by-cli"}})
                .to_string(),
        )
        .unwrap()
    };
    write("fresh-1");
    let env = Env::start_with("grok", json!({"source": auth.to_str().unwrap()})).await;
    // Grok is not force-streamed and the mock always answers SSE, so ask for a stream.
    let chat =
        json!({"model": "cx", "stream": true, "messages": [{"role": "user", "content": "hi"}]});

    let r = env.post("/v1/chat/completions", chat.clone()).await;
    assert!(r.text().await.unwrap().contains("[DONE]"));
    assert_eq!(
        env.upstream_header("authorization").as_deref(),
        Some("Bearer fresh-1")
    );

    // The Grok CLI refreshed its file: picked up without a restart.
    write("fresh-2");
    env.post("/v1/chat/completions", chat.clone()).await;
    assert_eq!(
        env.upstream_header("authorization").as_deref(),
        Some("Bearer fresh-2")
    );

    // Expired and not refreshed by the CLI: 401 with the hint, no refresh attempt
    // (a refresh would go to auth.x.ai, unreachable from this test).
    write("expired");
    let r = env
        .client
        .post(format!("{}/v1/chat/completions", env.base))
        .json(&chat)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    assert!(r.text().await.unwrap().contains("Grok CLI"));
    // The file is only read: the CLI's rotating refresh token is untouched.
    assert!(std::fs::read_to_string(&auth)
        .unwrap()
        .contains("rt-owned-by-cli"));
}

fn buffered_request(path: &str, scenario: &str) -> Value {
    if path == "/v1/responses" {
        json!({"model":"cx","stream":false,"input":[{"role":"user","content":[{"type":"input_text","text":scenario}]}]})
    } else {
        json!({"model":"cx","stream":false,"max_tokens":50,"messages":[{"role":"user","content":scenario}]})
    }
}

#[tokio::test]
async fn br1_br2_buffered_failures_never_become_success() {
    let env = Env::start().await;
    for scenario in [
        "br_partial",
        "br_empty",
        "br_item",
        "br_done",
        "br_error",
        "br_error_then_completed",
        "br_failed",
        "br_failed_then_completed",
        "br_malformed",
        "br_conflict",
        "br_quota",
        "br_top_quota",
    ] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            let before = env.seen.lock().unwrap().len();
            let r = env
                .client
                .post(format!("{}{path}", env.base))
                .json(&buffered_request(path, scenario))
                .send()
                .await
                .unwrap();
            let status = r.status();
            let text = r.text().await.unwrap();
            assert_eq!(
                status,
                if scenario.ends_with("quota") {
                    429
                } else {
                    502
                },
                "{scenario} {path}: {text}"
            );
            assert!(
                !text.contains("PRIVATE-"),
                "leaked upstream payload: {text}"
            );
            let v: Value = serde_json::from_str(&text).unwrap();
            assert!(
                v.get("error").is_some() && v.get("output").is_none() && v.get("choices").is_none(),
                "{text}"
            );
            if scenario.ends_with("quota") {
                assert!(text.contains("subscription_sharing_usage_"), "{text}");
            }
            assert_eq!(
                env.seen.lock().unwrap().len(),
                before + 1,
                "no hidden retry"
            );
        }
    }
}

#[tokio::test]
async fn br3_buffered_completed_and_incomplete_preserve_output() {
    let env = Env::start().await;
    for scenario in ["br_completed", "br_incomplete", "br_completed_late_error"] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            let r = env.post(path, buffered_request(path, scenario)).await;
            let v: Value = r.json().await.unwrap();
            assert!(v.to_string().contains("buffered success"), "{path}: {v}");
            assert!(!v.to_string().contains("PRIVATE-"), "{v}");
            let incomplete = scenario == "br_incomplete";
            match path {
                "/v1/responses" => {
                    assert_eq!(
                        v["status"],
                        if incomplete {
                            "incomplete"
                        } else {
                            "completed"
                        }
                    );
                    assert_eq!(v["usage"]["total_tokens"], 18);
                    if incomplete {
                        assert_eq!(v["incomplete_details"]["reason"], "max_output_tokens");
                    }
                }
                "/v1/messages" => {
                    assert_eq!(
                        v["stop_reason"],
                        if incomplete { "max_tokens" } else { "end_turn" }
                    );
                    assert_eq!(v["usage"]["output_tokens"], 7);
                }
                _ => {
                    assert_eq!(
                        v["choices"][0]["finish_reason"],
                        if incomplete { "length" } else { "stop" }
                    );
                    assert_eq!(v["usage"]["total_tokens"], 18);
                }
            }
        }
    }
}

#[tokio::test]
async fn nr1_native_eof_emits_error() {
    let env = Env::start().await;
    for fixture in [
        "br_empty",
        "br_partial",
        "br_done",
        "br_item",
        "br_malformed",
        "br_conflict",
    ] {
        let r = env
            .post(
                "/v1/responses",
                json!({"model":"cx", "stream":true, "input":fixture}),
            )
            .await;
        assert_eq!(r.status(), StatusCode::OK);
        let raw = r.text().await.unwrap();
        let events = sse_data(&raw);
        assert_eq!(
            events.last().map(|v| &v["type"]),
            Some(&json!("error")),
            "{fixture}: {raw}"
        );
        assert_eq!(
            events.last().unwrap()["message"],
            "upstream stream ended before completion"
        );
        assert!(!raw.contains("data: [DONE]"));
        assert!(!events.iter().any(|v| v["type"] == "response.completed"));
    }
}

#[tokio::test]
async fn nr2_native_terminals_preserve_output_and_finality() {
    let env = Env::start().await;
    for (fixture, terminal) in [
        ("br_completed", "response.completed"),
        ("br_incomplete", "response.incomplete"),
        ("br_completed_late_error", "response.completed"),
        ("br_error_then_completed", "error"),
        ("br_failed_then_completed", "response.failed"),
    ] {
        let r = env
            .post(
                "/v1/responses",
                json!({"model":"cx", "stream":true, "input":fixture}),
            )
            .await;
        assert_eq!(r.status(), StatusCode::OK);
        let raw = r.text().await.unwrap();
        let events = sse_data(&raw);
        assert_eq!(events.last().unwrap()["type"], terminal, "{fixture}: {raw}");
        assert_eq!(
            events
                .iter()
                .filter(|e| matches!(
                    e["type"].as_str(),
                    Some(
                        "error" | "response.failed" | "response.completed" | "response.incomplete"
                    )
                ))
                .count(),
            1
        );
        assert!(!raw.contains("upstream_stream_incomplete"));
        if terminal == "response.completed" || terminal == "response.incomplete" {
            assert_eq!(
                events.last().unwrap()["response"]["usage"]["input_tokens"],
                11
            );
            assert!(raw.contains("buffered success"));
        } else {
            assert!(
                raw.contains("PRIVATE-ERROR-CANARY"),
                "native upstream errors remain unchanged"
            );
        }
    }
}

fn direct_json_fixture(scenario: &str) -> String {
    let mut v = json!({"id":"resp_json", "object":"response", "model":"gpt-mock", "status":"completed",
        "error":null, "output":[{"type":"message", "role":"assistant", "content":[{"type":"output_text", "text":"direct success"}]}],
        "usage":{"input_tokens":11,"output_tokens":7,"total_tokens":18}, "opaque":{"keep":true}});
    let error = json!({"code":"unknown_fixture_code", "message":"PRIVATE-JSON-CANARY"});
    match scenario {
        "jr_failed" => {
            v["status"] = json!("failed");
            v["error"] = error;
        }
        "jr_error" => v = json!({"error":error}),
        "jr_cancelled" => v["status"] = json!("cancelled"),
        "jr_queued" | "jr_queued_bg" => {
            v["status"] = json!("queued");
            v["background"] = json!(scenario.ends_with("_bg"));
        }
        "jr_in_progress" | "jr_in_progress_bg" => {
            v["status"] = json!("in_progress");
            v["background"] = json!(scenario.ends_with("_bg"));
        }
        "jr_missing_status" => {
            v.as_object_mut().unwrap().remove("status");
        }
        "jr_unknown" => v["status"] = json!("new_unknown_status"),
        "jr_bad_status" => v["status"] = json!(123),
        "jr_bad_json" => return "{PRIVATE-JSON-CANARY".into(),
        "jr_array" => v = json!([]),
        "jr_scalar" => v = json!("PRIVATE-JSON-CANARY"),
        "jr_bad_output" => v["output"] = json!({"text":"PRIVATE-JSON-CANARY"}),
        "jr_missing_output" => {
            v.as_object_mut().unwrap().remove("output");
        }
        "jr_conflict" => {
            v["error"] = json!({"code":"subscription_sharing_usage_limit_exceeded","message":"PRIVATE-JSON-CANARY"})
        }
        "jr_quota" => {
            v["status"] = json!("failed");
            v["error"] = json!({"code":"subscription_sharing_usage_limit_exceeded","message":"PRIVATE-JSON-CANARY"});
        }
        "jr_top_quota" => {
            v = json!({"error":{"code":"subscription_sharing_usage_unavailable","message":"PRIVATE-JSON-CANARY"}})
        }
        "jr_completed" => {}
        "jr_incomplete" => {
            v["status"] = json!("incomplete");
            v["incomplete_details"] = json!({"reason":"max_output_tokens"});
        }
        "jr_tools" => {
            v["output"] = json!([{"type":"function_call","id":"fc_json","call_id":"call_json","name":"lookup","arguments":"{\"city\":\"Taipei\"}"}])
        }
        "jr_empty" => v["output"] = json!([]),
        _ => panic!("unknown JSON fixture {scenario}"),
    }
    format!(" \n{}\n", serde_json::to_string_pretty(&v).unwrap())
}

#[tokio::test]
async fn jr1_direct_json_failures_are_not_success() {
    let env = Env::start_with("grok", json!({})).await;
    for scenario in [
        "jr_failed",
        "jr_error",
        "jr_cancelled",
        "jr_queued",
        "jr_in_progress",
        "jr_queued_bg",
        "jr_in_progress_bg",
        "jr_missing_status",
        "jr_unknown",
        "jr_bad_status",
        "jr_bad_json",
        "jr_array",
        "jr_scalar",
        "jr_bad_output",
        "jr_missing_output",
        "jr_conflict",
        "jr_quota",
        "jr_top_quota",
    ] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            let before = env.seen.lock().unwrap().len();
            let r = env
                .client
                .post(format!("{}{path}", env.base))
                .json(&buffered_request(path, scenario))
                .send()
                .await
                .unwrap();
            let status = r.status();
            let raw = r.text().await.unwrap();
            assert_eq!(
                status,
                if scenario.ends_with("quota") {
                    429
                } else {
                    502
                },
                "{scenario} {path}: {raw}"
            );
            assert!(
                !raw.contains("PRIVATE-")
                    && !raw.contains("direct success")
                    && !raw.contains("unknown_fixture_code"),
                "{raw}"
            );
            let v: Value = serde_json::from_str(&raw).unwrap();
            assert!(
                v.get("error").is_some() && v.get("choices").is_none() && v.get("output").is_none()
            );
            if scenario.ends_with("quota") {
                assert!(raw.contains(if scenario == "jr_quota" {
                    "subscription_sharing_usage_limit_exceeded"
                } else {
                    "subscription_sharing_usage_unavailable"
                }));
            }
            assert_eq!(env.seen.lock().unwrap().len(), before + 1);
            assert_eq!(env.upstream_body()["stream"], false);
        }
    }
}

#[tokio::test]
async fn jr2_valid_json_preserves_native_bytes_and_conversions() {
    let env = Env::start_with("grok", json!({})).await;
    for scenario in ["jr_completed", "jr_incomplete", "jr_tools", "jr_empty"] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            let r = env.post(path, buffered_request(path, scenario)).await;
            let raw = r.text().await.unwrap();
            let v: Value = serde_json::from_str(&raw).unwrap();
            if path == "/v1/responses" {
                assert_eq!(raw, direct_json_fixture(scenario));
            } else if path == "/v1/chat/completions" {
                assert_eq!(v["usage"]["prompt_tokens"], 11);
                assert_eq!(v["usage"]["completion_tokens"], 7);
                assert_eq!(
                    v["choices"][0]["finish_reason"],
                    if scenario == "jr_tools" {
                        "tool_calls"
                    } else if scenario == "jr_incomplete" {
                        "length"
                    } else {
                        "stop"
                    }
                );
                if scenario == "jr_tools" {
                    assert_eq!(
                        v["choices"][0]["message"]["tool_calls"][0]["id"],
                        "call_json"
                    );
                    assert_eq!(
                        v["choices"][0]["message"]["tool_calls"][0]["function"]["arguments"],
                        "{\"city\":\"Taipei\"}"
                    );
                } else {
                    assert_eq!(
                        v["choices"][0]["message"]["content"],
                        if scenario == "jr_empty" {
                            ""
                        } else {
                            "direct success"
                        }
                    );
                }
            } else {
                assert_eq!(v["usage"]["input_tokens"], 11);
                assert_eq!(v["usage"]["output_tokens"], 7);
                assert_eq!(
                    v["stop_reason"],
                    if scenario == "jr_tools" {
                        "tool_use"
                    } else if scenario == "jr_incomplete" {
                        "max_tokens"
                    } else {
                        "end_turn"
                    }
                );
                if scenario == "jr_tools" {
                    assert_eq!(v["content"][0]["name"], "lookup");
                    assert_eq!(v["content"][0]["input"]["city"], "Taipei");
                } else if scenario != "jr_empty" {
                    assert_eq!(v["content"][0]["text"], "direct success");
                }
            }
        }
    }
}

#[tokio::test]
async fn jr3_only_explicit_native_background_can_remain_pending() {
    let env = Env::start_with("grok", json!({})).await;
    for scenario in [
        "jr_queued",
        "jr_in_progress",
        "jr_queued_bg",
        "jr_in_progress_bg",
    ] {
        for background in [true, false] {
            let mut request = buffered_request("/v1/responses", scenario);
            request["background"] = json!(background);
            let r = env
                .client
                .post(format!("{}/v1/responses", env.base))
                .json(&request)
                .send()
                .await
                .unwrap();
            let status = r.status();
            let raw = r.text().await.unwrap();
            assert_eq!(env.upstream_body()["background"], background);
            if background && scenario.ends_with("_bg") {
                assert_eq!(status, 200);
                assert_eq!(raw, direct_json_fixture(scenario));
            } else {
                assert_eq!(status, 502, "{scenario} background={background}: {raw}");
            }
        }
    }
}

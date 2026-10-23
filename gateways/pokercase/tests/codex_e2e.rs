//! Codex (Responses upstream) end-to-end tests through all three client surfaces.
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

/// Scripted Codex: tools + fresh turn → function call; tool output → answer using it;
/// image → "saw image"; otherwise plain text. Always SSE, like the ChatGPT backend.
async fn codex_mock(State(seen): State<Seen>, req: Request) -> Response {
    let headers = req
        .headers()
        .iter()
        .map(|(k, v)| (k.to_string(), v.to_str().unwrap_or("").to_string()))
        .collect();
    let body = req.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&body).unwrap();
    seen.lock().unwrap().push((headers, v.clone()));

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
    if last["type"] == "function_call_output" {
        events.extend(text_events(&format!(
            "result: {}",
            last["output"].as_str().unwrap_or("")
        )));
    } else if v["tools"].as_array().is_some_and(|t| !t.is_empty()) {
        let name = v["tools"][0]["name"].as_str().unwrap_or("missing_name");
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
        events.extend(text_events("hello from codex"));
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
        let seen: Seen = Arc::default();
        let app = Router::new().fallback(codex_mock).with_state(seen.clone());
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
            &format!("codex={upstream}"),
            "--codex-version",
            "9.9.9-test",
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
            "THINROUTER_CODEX_VERSION",
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
                "name": "cx", "provider": "codex", "access_token": "test-access",
                "base_url": format!("{upstream}/backend-api/codex/responses"),
                "default_model": "gpt-mock", "meta": "{\"account_id\":\"acct-1\"}"
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
async fn chat_completions_over_codex() {
    let env = Env::start().await;

    // Non-stream text: upstream forced to stream, then reassembled.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cx", "temperature": 0.3, "max_tokens": 9, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["choices"][0]["message"]["content"], "hello from codex");
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
    assert_eq!(
        env.upstream_header("chatgpt-account-id").as_deref(),
        Some("acct-1")
    );
    assert_eq!(
        env.upstream_header("user-agent").as_deref(),
        Some("codex_cli_rs/9.9.9-test")
    );
    assert_eq!(
        env.upstream_header("originator").as_deref(),
        Some("codex_cli_rs")
    );
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
    assert_eq!(text, "hello from codex");
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
    assert_eq!(up["tools"][0]["name"], "get_weather");
    assert_eq!(up["tools"][0]["type"], "function");
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
async fn anthropic_messages_over_codex() {
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
    assert_eq!(text, "hello from codex");
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
async fn responses_api_is_forwarded_natively_to_codex() {
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
    assert_eq!(up["tools"], tools);
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

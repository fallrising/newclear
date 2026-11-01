//! Converted-stream completion contracts against a local HTTP fake upstream.

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

async fn chat_mock(req: Request) -> Response {
    let bytes = req.into_body().collect().await.unwrap().to_bytes();
    let request: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(request["stream"], true);
    let scenario = request["messages"][0]["content"].as_str().unwrap();
    let mut records = Vec::new();
    if scenario != "empty" {
        records.push(json!({"choices":[{"delta":{"content":"piece"}}]}));
        if scenario.starts_with("tool") {
            records.push(json!({"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"lookup","arguments":if scenario == "tool-finish" {"{}"} else {"{"}}}]}}]}));
        }
    }
    if matches!(scenario, "finish" | "length" | "tool-finish") {
        let reason = match scenario {
            "length" => "length",
            "tool-finish" => "tool_calls",
            _ => "stop",
        };
        records.push(json!({"choices":[{"delta":{},"finish_reason":reason}],"usage":{"prompt_tokens":3,"completion_tokens":2}}));
    }
    let mut body: String = records.iter().map(|v| format!("data: {v}\n\n")).collect();
    if scenario == "done" {
        body.push_str("data: [DONE]\n\n");
    }
    Response::builder()
        .status(StatusCode::OK)
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from(body))
        .unwrap()
}

#[tokio::test]
async fn sc3_http_chat_upstream_completion_contract() {
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

    for scenario in [
        "text",
        "tool",
        "empty",
        "finish",
        "length",
        "tool-finish",
        "done",
    ] {
        for path in ["/v1/messages", "/v1/responses"] {
            let body = if path == "/v1/responses" {
                json!({"model":"chat","stream":true,"input":scenario})
            } else {
                json!({"model":"chat","stream":true,"max_tokens":50,"messages":[{"role":"user","content":scenario}]})
            };
            let response = plain
                .post(format!("{base}{path}"))
                .bearer_auth(key["secret"].as_str().unwrap())
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), 200, "SSE headers already committed");
            let text = response.text().await.unwrap();
            let events: Vec<Value> = text
                .lines()
                .filter_map(|l| l.strip_prefix("data: "))
                .map(|s| serde_json::from_str(s).unwrap())
                .collect();
            let last = events.last().unwrap();
            if matches!(scenario, "text" | "tool" | "empty") {
                assert!(
                    text.contains("upstream stream ended before completion"),
                    "{scenario} {path}: {text}"
                );
                assert!(
                    !text.contains("response.completed") && !text.contains("message_stop"),
                    "{text}"
                );
                assert!(
                    !text.contains("response.function_call_arguments.done"),
                    "{text}"
                );
                assert_eq!(
                    last["type"],
                    if path == "/v1/responses" {
                        "response.failed"
                    } else {
                        "error"
                    }
                );
            } else {
                assert!(!text.contains("before completion"), "{text}");
                if path == "/v1/responses" {
                    assert_eq!(
                        last["type"],
                        if scenario == "length" {
                            "response.incomplete"
                        } else {
                            "response.completed"
                        },
                        "{text}"
                    );
                    if scenario == "tool-finish" {
                        assert_eq!(last["response"]["output"][1]["arguments"], "{}");
                    }
                } else {
                    assert_eq!(last["type"], "message_stop", "{text}");
                    let delta = events
                        .iter()
                        .find(|v| v["type"] == "message_delta")
                        .unwrap();
                    assert_eq!(
                        delta["delta"]["stop_reason"],
                        match scenario {
                            "length" => "max_tokens",
                            "tool-finish" => "tool_use",
                            _ => "end_turn",
                        },
                        "{text}"
                    );
                }
            }
        }
    }
}

//! Terminal-triggered upstream release through real loopback HTTP; no provider calls.
use axum::{
    body::Body,
    extract::{Request, State},
    http::header,
    response::Response,
    Router,
};
use http_body_util::BodyExt;
use serde_json::{json, Value};
use std::time::Duration;
use tokio::{net::TcpListener, sync::mpsc};

#[derive(Debug, PartialEq)]
enum Event {
    Started(usize),
    Dropped(usize),
}
struct OwnedUpstream {
    id: usize,
    events: mpsc::UnboundedSender<Event>,
}
impl Drop for OwnedUpstream {
    fn drop(&mut self) {
        let _ = self.events.send(Event::Dropped(self.id));
    }
}
async fn upstream(State(events): State<mpsc::UnboundedSender<Event>>, req: Request) -> Response {
    let responses = req.uri().path().ends_with("/responses");
    let bytes = req.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    let text = v
        .pointer("/messages/0/content")
        .or_else(|| v.pointer("/input/0/content/0/text"))
        .and_then(Value::as_str)
        .unwrap();
    let (phase, id) = text.split_once(':').unwrap();
    let id = id.parse().unwrap();
    let owned = OwnedUpstream {
        id,
        events: events.clone(),
    };
    events.send(Event::Started(id)).unwrap();
    let status = match phase {
        "failure" => "failed",
        "incomplete" => "incomplete",
        _ => "completed",
    };
    let first = if responses {
        let mut response = json!({"type":format!("response.{status}"),"response":{"status":status,"output":[],"usage":{"input_tokens":17,"output_tokens":23}}});
        if phase == "failure" {
            response["response"]["error"] = json!({"message":"fixture failure"});
        }
        if phase == "incomplete" {
            response["response"]["incomplete_details"] = json!({"reason":"max_output_tokens"});
        }
        format!(
            "data: {}\n\ndata: {response}\n\n",
            json!({"type":"response.output_text.delta","delta":"piece"})
        )
    } else if phase == "failure" {
        format!(
            "data: {}\n\n",
            json!({"error":{"type":"api_error","message":"fixture failure"}})
        )
    } else {
        format!(
            "data: {}\n\ndata: {}\n\ndata: {}\n\ndata: [DONE]\n\n",
            json!({"choices":[{"delta":{"content":"piece"}}]}),
            json!({"choices":[{"delta":{},"finish_reason":if phase=="incomplete" {"length"} else {"stop"}}]}),
            json!({"choices":[],"usage":{"prompt_tokens":17,"completion_tokens":23,"total_tokens":40}})
        )
    };
    let stream = async_stream::stream! {
        let _owned=owned;
        yield Ok::<_,std::io::Error>(bytes::Bytes::from(first));
        std::future::pending::<()>().await;
    };
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from_stream(stream))
        .unwrap()
}
#[tokio::test]
async fn tr3_http_terminals_close_open_upstream_without_waiting_for_eof() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, Router::new().fallback(upstream).with_state(tx))
            .await
            .unwrap()
    });
    struct AbortServer(tokio::task::JoinHandle<()>);
    impl Drop for AbortServer {
        fn drop(&mut self) {
            self.0.abort();
        }
    }
    let _server = AbortServer(server);
    let dir = tempfile::tempdir().unwrap();
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
    cmd.args([
        "serve",
        "--sse-stall-secs",
        "60",
        "--port",
        &port.to_string(),
        "--data-dir",
        dir.path().to_str().unwrap(),
        "--provider-base-override",
        &format!("grok={upstream_base}"),
    ]);
    for key in [
        "THINROUTER_ADMIN_TOKEN",
        "THINROUTER_SECRETS_KEY",
        "THINROUTER_ALLOW_KEYLESS_BOOTSTRAP",
        "HTTPS_PROXY",
        "HTTP_PROXY",
        "ALL_PROXY",
        "https_proxy",
        "http_proxy",
        "all_proxy",
    ] {
        cmd.env_remove(key);
    }
    let _child = cmd
        .kill_on_drop(true)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .spawn()
        .unwrap();
    let base = format!("http://127.0.0.1:{port}");
    let client = reqwest::Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(10))
        .build()
        .unwrap();
    tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            if client
                .get(format!("{base}/health"))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .unwrap();
    let admin = std::fs::read_to_string(dir.path().join("admin-token")).unwrap();
    let post = |path: &str, body: Value| {
        client
            .post(format!("{base}{path}"))
            .header("x-admin-token", admin.trim())
            .json(&body)
            .send()
    };
    assert_eq!(post("/admin/api/connections",json!({"name":"hc","base_url":format!("{upstream_base}/v1"),"api_key":"fake","default_model":"m"})).await.unwrap().status(),201);
    assert_eq!(post("/admin/api/connections/oauth/import",json!({"name":"hr","provider":"grok","access_token":"fake","base_url":format!("{upstream_base}/v1"),"default_model":"m","meta":"{}"})).await.unwrap().status(),201);
    let key: Value = post("/admin/api/keys", json!({"name":"test"}))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let mut jobs = Vec::new();
    let mut id = 0;
    for model in ["hc", "hr"] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            if model == "hc" && path == "/v1/chat/completions" {
                continue;
            }
            for phase in ["success", "incomplete", "failure"] {
                id += 1;
                let text = format!("{phase}:{id}");
                let body = if path == "/v1/responses" {
                    json!({"model":model,"stream":true,"input":text})
                } else {
                    json!({"model":model,"stream":true,"max_tokens":30,"messages":[{"role":"user","content":text}]})
                };
                let request = client
                    .post(format!("{base}{path}"))
                    .bearer_auth(key["secret"].as_str().unwrap())
                    .json(&body);
                jobs.push(async move {
                    let response = request.send().await.unwrap();
                    assert_eq!(response.status(), 200);
                    let text = response
                        .text()
                        .await
                        .expect("terminal body completes normally");
                    assert!(!text.contains("upstream stream stalled"));
                    assert!(!text.contains("upstream stream read failed"));
                    if phase == "failure" {
                        assert!(text.contains("fixture failure"));
                        assert!(!text.contains("response.completed"));
                    } else {
                        assert!(text.contains("piece"));
                        let terminal = match (path, phase) {
                            ("/v1/responses", "incomplete") => "response.incomplete",
                            ("/v1/responses", _) => "response.completed",
                            ("/v1/messages", "incomplete") => "max_tokens",
                            ("/v1/messages", _) => "end_turn",
                            (_, "incomplete") => "\"finish_reason\":\"length\"",
                            _ => "\"finish_reason\":\"stop\"",
                        };
                        assert!(text.contains(terminal), "{model}/{path}/{phase}: {text}");
                        let input = if path == "/v1/chat/completions" {
                            "\"prompt_tokens\":17"
                        } else {
                            "\"input_tokens\":17"
                        };
                        assert!(text.contains(input));
                    }
                });
            }
        }
    }
    tokio::time::timeout(Duration::from_secs(3), futures_util::future::join_all(jobs))
        .await
        .expect("all fifteen replies finish without waiting for source EOF or sixty-second stall");
    let mut starts = std::collections::BTreeSet::new();
    let mut drops = std::collections::BTreeSet::new();
    tokio::time::timeout(Duration::from_secs(3), async {
        while drops.len() < id {
            match rx.recv().await.unwrap() {
                Event::Started(n) => {
                    assert!(starts.insert(n));
                }
                Event::Dropped(n) => {
                    assert!(drops.insert(n));
                }
            }
        }
    })
    .await
    .expect("terminal upstream HTTP bodies released while server body remains pending");
    assert_eq!(starts, (1..=15).collect());
    assert_eq!(drops, starts);
}

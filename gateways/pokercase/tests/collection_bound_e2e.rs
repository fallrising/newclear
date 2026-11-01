//! Non-stream collection bounds through actual chunked HTTP, including forced SSE tails.
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
    let response = json!({"id":"resp_collect","object":"response","model":"m","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"collected"}]}],"usage":{"input_tokens":11,"output_tokens":7}});
    let forced = v["stream"] == true;
    let mut payload = if forced {
        format!(
            "data: {}\n\n",
            json!({"type":"response.completed","response":response})
        )
        .into_bytes()
    } else if responses {
        response.to_string().into_bytes()
    } else {
        json!({"id":"chat_collect","object":"chat.completion","model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"collected"},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":7}}).to_string().into_bytes()
    };
    let oversized = phase == "over";
    if phase != "small" {
        // Tail is counted even after a typed terminal; no parser early return.
        if forced {
            payload.extend_from_slice(b": PRIVATE_TAIL ");
        }
        payload.resize(16 * 1024 * 1024 + usize::from(oversized), b' ');
    }
    let stream = async_stream::stream! {
        let _owned = owned;
        for chunk in payload.chunks(65_537) {
            yield Ok::<_,std::io::Error>(bytes::Bytes::copy_from_slice(chunk));
        }
        if oversized { std::future::pending::<()>().await; }
    };
    Response::builder()
        .header(
            header::CONTENT_TYPE,
            if forced {
                "text/event-stream"
            } else {
                "application/json"
            },
        )
        .body(Body::from_stream(stream))
        .unwrap()
}
#[tokio::test]
async fn bc1_bc3_http_collection_matrix_and_pending_source_release() {
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
        &format!("siwc={upstream_base},grok={upstream_base}"),
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
    assert_eq!(post("/admin/api/connections/oauth/import",json!({"name":"hf","provider":"siwc","access_token":"fake","base_url":format!("{upstream_base}/v1"),"default_model":"m","meta":"{\"client_id\":\"oaiapp_test\"}"})).await.unwrap().status(),201);
    let mut id = 0;
    for model in ["hc", "hr", "hf"] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for phase in ["small", "exact", "over"] {
                id += 1;
                let text = format!("{phase}:{id}");
                let body = if path == "/v1/responses" {
                    json!({"model":model,"stream":false,"input":text})
                } else {
                    json!({"model":model,"stream":false,"max_tokens":30,"messages":[{"role":"user","content":text}]})
                };
                let response = client
                    .post(format!("{base}{path}"))
                    .bearer_auth(key["secret"].as_str().unwrap())
                    .json(&body)
                    .send()
                    .await
                    .unwrap();
                assert_eq!(
                    response.status(),
                    if phase == "over" { 502 } else { 200 },
                    "{model}/{path}/{phase}"
                );
                let raw = response.text().await.unwrap();
                assert!(!raw.contains("PRIVATE_TAIL"));
                if phase == "over" {
                    assert!(
                        raw.contains("upstream response collection limit exceeded"),
                        "{raw}"
                    );
                    assert!(!raw.contains("collected"));
                } else {
                    let value: Value = serde_json::from_str(&raw).unwrap();
                    assert!(raw.contains("collected"));
                    let input = value
                        .pointer("/usage/prompt_tokens")
                        .or_else(|| value.pointer("/usage/input_tokens"));
                    let output = value
                        .pointer("/usage/completion_tokens")
                        .or_else(|| value.pointer("/usage/output_tokens"));
                    assert_eq!(input, Some(&json!(11)));
                    assert_eq!(output, Some(&json!(7)));
                }
                tokio::time::timeout(Duration::from_secs(3), async {
                    assert_eq!(rx.recv().await, Some(Event::Started(id)));
                    assert_eq!(rx.recv().await, Some(Event::Dropped(id)));
                })
                .await
                .expect("source closed after return, including over-limit body waiting forever");
            }
        }
    }
    assert_eq!(id, 27);
}

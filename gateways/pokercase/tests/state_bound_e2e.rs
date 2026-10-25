//! Retained-state limits through loopback HTTP sources which stay open after data.
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
    let phase = phase.to_owned();
    let stream = async_stream::stream! {
        let _owned=owned;
        if responses {
            let first = format!("data: {}\n\n", json!({"type":"response.output_text.delta","delta":"piece"}));
            yield Ok::<_,std::io::Error>(bytes::Bytes::from(first));
            for i in 0..2049 {
                let value = json!({"type":"response.output_item.added","output_index":i,"item":{"type":"function_call","id":format!("i{i}"),"call_id":"c","name":"f"}});
                yield Ok(bytes::Bytes::from(format!("data: {value}\n\n")));
            }
        } else {
            for _ in 0..17 {
                let value = if phase == "text" {
                    json!({"choices":[{"delta":{"content":"x".repeat(1024*1024)}}]})
                } else {
                    json!({"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"x".repeat(1024*1024)}}]}}]})
                };
                yield Ok(bytes::Bytes::from(format!("data: {value}\n\n")));
            }
        }
        std::future::pending::<()>().await;
    };
    Response::builder()
        .header(header::CONTENT_TYPE, "text/event-stream")
        .body(Body::from_stream(stream))
        .unwrap()
}
#[tokio::test]
async fn rs3_http_retained_payload_and_map_limits_close_open_sources() {
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
            if (model == "hc" && path != "/v1/responses")
                || (model == "hr" && path == "/v1/responses")
            {
                continue;
            }
            for phase in if model == "hc" {
                vec!["text", "arguments"]
            } else {
                vec!["entries"]
            } {
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
                        .expect("state limit is a protocol error, not a transport failure");
                    assert!(!text.contains("upstream stream stalled"));
                    assert!(!text.contains("upstream stream read failed"));
                    assert!(
                        text.contains("upstream converter state limit exceeded"),
                        "{model}/{path}/{phase}: {text}"
                    );
                    assert!(!text.contains("PRIVATE_INPUT"));
                    assert!(!text.contains("response.completed"));
                    assert!(!text.contains("message_stop"));
                    assert!(!text.contains("\"finish_reason\":\"stop\""));
                    if model == "hr" {
                        assert!(text.contains("piece"));
                    }
                });
            }
        }
    }
    tokio::time::timeout(
        Duration::from_secs(15),
        futures_util::future::join_all(jobs),
    )
    .await
    .expect("all four replies fail without waiting for source EOF or sixty-second stall");
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
    .expect("retained-state limited HTTP sources released while server body remains pending");
    assert_eq!(starts, (1..=4).collect());
    assert_eq!(drops, starts);
}

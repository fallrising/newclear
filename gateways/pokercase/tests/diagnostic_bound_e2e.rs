//! Non-success diagnostic bounds through actual chunked HTTP.
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
#[derive(Clone)]
struct Fixture {
    events: mpsc::UnboundedSender<Event>,
    auth: std::path::PathBuf,
}
fn write_auth(path: &std::path::Path, key: &str) {
    std::fs::write(
        path,
        json!({"https://auth.x.ai":{"key":key,"refresh_token":"fixture-owned"}}).to_string(),
    )
    .unwrap();
}
async fn upstream(State(fixture): State<Fixture>, req: Request) -> Response {
    let events = fixture.events;
    let healthy = req.uri().path().contains("/ok/");
    let authorization = req
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let bytes = req.into_body().collect().await.unwrap().to_bytes();
    let v: Value = serde_json::from_slice(&bytes).unwrap();
    let text = v
        .pointer("/messages/0/content")
        .or_else(|| v.pointer("/input/0/content/0/text"))
        .and_then(Value::as_str)
        .unwrap();
    let fields: Vec<_> = text.split(':').collect();
    let phase = fields[0];
    let status: u16 = fields[1].parse().unwrap();
    let id = fields[2].parse().unwrap();
    let owned = OwnedUpstream {
        id,
        events: events.clone(),
    };
    events.send(Event::Started(id)).unwrap();
    if healthy || (phase == "rotate" && authorization == "Bearer new") {
        let response = if healthy {
            json!({"id":"chat_ok","model":"m","choices":[{"index":0,"message":{"role":"assistant","content":"recovered"},"finish_reason":"stop"}]})
        } else {
            json!({"id":"resp_ok","status":"completed","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"recovered"}]}]})
        };
        drop(owned);
        return Response::builder()
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(response.to_string()))
            .unwrap();
    }
    if phase == "rotate" {
        write_auth(&fixture.auth, "new");
    }
    if phase == "twice" {
        write_auth(
            &fixture.auth,
            &format!("{}-next", authorization.trim_start_matches("Bearer ")),
        );
    }
    let oversized = matches!(phase, "over" | "borrowed" | "rotate" | "twice");
    let pending = oversized || phase == "silent";
    let mut payload = b"PRIVATE_DIAGNOSTIC".to_vec();
    if phase != "small" && phase != "silent" {
        payload.resize(65536 + usize::from(oversized), b'x');
    }
    let stream = async_stream::stream! {
        let _owned=owned;
        for chunk in payload.chunks(4093) {yield Ok::<_,std::io::Error>(bytes::Bytes::copy_from_slice(chunk));}
        if pending {std::future::pending::<()>().await;}
    };
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, "text/plain")
        .body(Body::from_stream(stream))
        .unwrap()
}
#[tokio::test]
async fn dg1_dg2_http_diagnostics_preserve_status_and_release_open_sources() {
    let (tx, mut rx) = mpsc::unbounded_channel();
    let auth_dir = tempfile::tempdir().unwrap();
    let grok_dir = auth_dir.path().join(".grok");
    std::fs::create_dir(&grok_dir).unwrap();
    let auth = grok_dir.join("auth.json");
    write_auth(&auth, "old");
    let fixture = Fixture {
        events: tx,
        auth: auth.clone(),
    };
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let upstream_base = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new().fallback(upstream).with_state(fixture),
        )
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
        .timeout(Duration::from_secs(2))
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
    assert_eq!(post("/admin/api/connections/oauth/import",json!({"name":"hb","provider":"grok","access_token":"fixture-unused","base_url":format!("{upstream_base}/v1"),"default_model":"m","meta":json!({"source":auth.to_str().unwrap()}).to_string()})).await.unwrap().status(),201);
    let mut id = 0;
    for model in ["hc", "hr", "hf"] {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [false, true] {
                for status in [400, 401, 429, 500] {
                    for phase in ["over", "exact", "small"] {
                        id += 1;
                        let text = format!("{phase}:{status}:{id}");
                        let body = if path == "/v1/responses" {
                            json!({"model":model,"stream":stream,"input":text})
                        } else {
                            json!({"model":model,"stream":stream,"max_tokens":30,"messages":[{"role":"user","content":text}]})
                        };
                        let response = client
                            .post(format!("{base}{path}"))
                            .bearer_auth(key["secret"].as_str().unwrap())
                            .json(&body)
                            .send()
                            .await
                            .expect("bounded diagnostic must not wait for upstream EOF");
                        assert_eq!(response.status(), status, "{model}/{path}/{stream}/{phase}");
                        let raw = response.text().await.unwrap();
                        if phase == "over" {
                            assert!(raw.contains("upstream error body exceeds 64 KiB"), "{raw}");
                            assert!(!raw.contains("PRIVATE_DIAGNOSTIC"));
                        } else {
                            assert!(raw.contains("PRIVATE_DIAGNOSTIC"));
                            assert!(!raw.contains("exceeds 64 KiB"));
                        }
                        tokio::time::timeout(Duration::from_secs(2), async {
                            assert_eq!(rx.recv().await, Some(Event::Started(id)));
                            assert_eq!(rx.recv().await, Some(Event::Dropped(id)));
                        })
                        .await
                        .unwrap();
                    }
                }
            }
        }
    }
    assert_eq!(id, 216);
    // Fresh failing connections avoid prior cooldown affecting fallback selection.
    let healthy:Value=post("/admin/api/connections",json!({"name":"healthy","base_url":format!("{upstream_base}/ok/v1"),"api_key":"fixture","default_model":"m"})).await.unwrap().json().await.unwrap();
    for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
        for status in [400, 401, 429, 500] {
            id += 1;
            let connection:Value=post("/admin/api/connections",json!({"name":format!("bad{id}"),"base_url":format!("{upstream_base}/v1"),"api_key":"fixture","default_model":"m"})).await.unwrap().json().await.unwrap();
            let model = format!("fallback{id}");
            assert_eq!(post("/admin/api/routes",json!({"public_model":model,"strategy":"fallback","targets":[{"connection_id":connection["id"]},{"connection_id":healthy["id"]}]})).await.unwrap().status(),201);
            let text = format!("over:{status}:{id}");
            let body = if path == "/v1/responses" {
                json!({"model":model,"input":text})
            } else {
                json!({"model":model,"max_tokens":30,"messages":[{"role":"user","content":text}]})
            };
            let response = client
                .post(format!("{base}{path}"))
                .bearer_auth(key["secret"].as_str().unwrap())
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), if status == 400 { 400 } else { 200 });
            let raw = response.text().await.unwrap();
            assert!(raw.contains(if status == 400 {
                "upstream error body exceeds 64 KiB"
            } else {
                "recovered"
            }));
            observed_attempts(&mut rx, id, if status == 400 { 1 } else { 2 }).await;
        }
        for phase in ["borrowed", "rotate", "twice"] {
            id += 1;
            write_auth(&auth, "old");
            let text = format!("{phase}:401:{id}");
            let body = if path == "/v1/responses" {
                json!({"model":"hb","input":text})
            } else {
                json!({"model":"hb","max_tokens":30,"messages":[{"role":"user","content":text}]})
            };
            let response = client
                .post(format!("{base}{path}"))
                .bearer_auth(key["secret"].as_str().unwrap())
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), if phase == "rotate" { 200 } else { 401 });
            let raw = response.text().await.unwrap();
            if phase == "rotate" {
                assert!(raw.contains("recovered"));
            } else {
                assert!(raw.contains("upstream error body exceeds 64 KiB"));
                assert!(raw.contains("Grok CLI"));
                assert!(!raw.contains("PRIVATE_DIAGNOSTIC"));
            }
            observed_attempts(&mut rx, id, if phase == "borrowed" { 1 } else { 2 }).await;
            assert!(std::fs::read_to_string(&auth)
                .unwrap()
                .contains("fixture-owned"));
        }
        for model in ["hc", "hr", "hb"] {
            id += 1;
            let text = format!("silent:401:{id}");
            let body = if path == "/v1/responses" {
                json!({"model":model,"input":text})
            } else {
                json!({"model":model,"max_tokens":30,"messages":[{"role":"user","content":text}]})
            };
            let request = client
                .post(format!("{base}{path}"))
                .bearer_auth(key["secret"].as_str().unwrap())
                .json(&body);
            let pending = tokio::spawn(async move { request.send().await });
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), rx.recv())
                    .await
                    .unwrap(),
                Some(Event::Started(id))
            );
            pending.abort();
            let _ = pending.await;
            assert_eq!(
                tokio::time::timeout(Duration::from_secs(2), rx.recv())
                    .await
                    .unwrap(),
                Some(Event::Dropped(id))
            );
        }
    }
    assert_eq!(id, 246);
}

async fn observed_attempts(rx: &mut mpsc::UnboundedReceiver<Event>, id: usize, count: usize) {
    tokio::time::timeout(Duration::from_secs(2), async {
        let (mut starts, mut drops) = (0, 0);
        for _ in 0..count * 2 {
            match rx.recv().await.unwrap() {
                Event::Started(n) => {
                    assert_eq!(n, id);
                    starts += 1;
                }
                Event::Dropped(n) => {
                    assert_eq!(n, id);
                    drops += 1;
                }
            }
        }
        assert_eq!((starts, drops), (count, count));
    })
    .await
    .expect("all owned upstream bodies released");
}

//! D-06 / EP-1–EP-3: real local HTTP/SQLite paths, synthetic data only.
#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::http::StatusCode;
use axum::routing::post;
use axum::Router;
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

const MARKERS: [&str; 5] = [
    "synthetic-token-canary",
    "synthetic-session-canary",
    "synthetic-request-canary",
    "synthetic-tool-canary",
    "synthetic-header-canary",
];
const PATHS: [&str; 3] = ["/v1/chat/completions", "/v1/messages", "/v1/responses"];

struct Upstream {
    url: String,
    calls: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for Upstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn upstream(status: u16, body: String) -> Upstream {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let app = Router::new().route(
        "/v1/chat/completions",
        post(move || {
            let counter = counter.clone();
            let body = body.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                (
                    StatusCode::from_u16(status).unwrap(),
                    [("x-diagnostic", MARKERS[4])],
                    body,
                )
            }
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    Upstream { url, calls, task }
}

struct Gateway {
    base: String,
    client: reqwest::Client,
    child: tokio::process::Child,
    dir: TempDir,
}

impl Gateway {
    async fn start() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let fake = dir.path().join("fake-claude");
        // The fake consumes only this test's synthetic request and never reads credentials.
        std::fs::write(&fake, format!(
            "#!/usr/bin/python3\nimport json,sys\nsys.stdin.readline()\nsys.stderr.write({:?})\nsys.stderr.flush()\nprint(json.dumps({{'type':'result','subtype':'error_during_execution','is_error':True,'result':{:?}}}),flush=True)\n",
            MARKERS.join(" "), MARKERS.join(" ")
        )).unwrap();
        std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o700)).unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("RUST_LOG", "debug")
            .args([
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                &port.to_string(),
                "--data-dir",
                dir.path().to_str().unwrap(),
                "--admin-token",
                "synthetic-admin",
                "--allow-keyless-bootstrap",
                "--claude-mode",
                "print",
                "--claude-bin",
                fake.to_str().unwrap(),
            ])
            .stdout(std::fs::File::create(dir.path().join("stdout")).unwrap())
            .stderr(std::fs::File::create(dir.path().join("stderr")).unwrap())
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        for _ in 0..100 {
            assert!(
                child.try_wait().unwrap().is_none(),
                "synthetic gateway exited before health"
            );
            if client
                .get(format!("{base}/health"))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                return Self {
                    base,
                    client,
                    child,
                    dir,
                };
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("synthetic gateway health deadline exceeded");
    }

    async fn post(&self, path: &str, body: Value) -> Value {
        let response = self
            .client
            .post(format!("{}{path}", self.base))
            .header("x-admin-token", "synthetic-admin")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 201, "synthetic admin setup failed");
        response.json().await.unwrap()
    }

    async fn connection(&self, name: &str, url: &str) -> String {
        self.post(
            "/admin/api/connections",
            json!({
                "name":name,"base_url":url,"api_key":"synthetic-placeholder","default_model":"mock",
            "input_price_per_m":1.0,"output_price_per_m":2.0
            }),
        )
        .await["id"]
            .as_str()
            .unwrap()
            .to_string()
    }

    async fn usage_surface(&self, path: &str) -> String {
        let response = self
            .client
            .get(format!("{}{path}", self.base))
            .header("x-admin-token", "synthetic-admin")
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 200, "usage surface {path}");
        response.text().await.unwrap()
    }

    async fn request(&self, path: &str, model: &str, stream: bool) -> reqwest::Response {
        self.client
            .post(format!("{}{path}", self.base))
            .json(&json!({
                "model":model,"messages":[{"role":"user","content":"synthetic request"}],
                "input":"synthetic request","max_tokens":8,"max_output_tokens":8,"stream":stream
            }))
            .send()
            .await
            .unwrap()
    }

    async fn verify_persistence(&mut self, expected_failures: usize, expected_successes: usize) {
        let db = rusqlite::Connection::open_with_flags(
            self.dir.path().join("thinrouter.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        let errors: Vec<(String, String)> = db
            .prepare("SELECT error, usage_source FROM usage_events WHERE error IS NOT NULL")
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(Result::unwrap)
            .collect();
        assert_eq!(errors.len(), expected_failures);
        let successes: i64 = db
            .query_row(
                "SELECT COUNT(*) FROM usage_events WHERE status=200 AND error IS NULL",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(successes as usize, expected_successes);
        let wrong_nulls: i64 = db.query_row("SELECT COUNT(*) FROM usage_events WHERE status != 200 AND (prompt_tokens IS NOT NULL OR completion_tokens IS NOT NULL OR estimated_cost_usd IS NOT NULL OR latency_ms IS NULL)", [], |r|r.get(0)).unwrap();
        assert_eq!(wrong_nulls, 0);
        let mut surfaces = vec![(
            "sqlite",
            errors
                .iter()
                .map(|(error, _)| error.as_str())
                .collect::<Vec<_>>()
                .join("\n"),
        )];
        for (name, path) in [
            ("json", "/admin/api/usage"),
            ("csv", "/admin/api/usage/export.csv"),
            ("html", "/admin/usage"),
        ] {
            surfaces.push((name, self.usage_surface(path).await));
        }
        self.child.kill().await.unwrap();
        for name in ["stdout", "stderr"] {
            surfaces.push((
                name,
                std::fs::read_to_string(self.dir.path().join(name)).unwrap(),
            ));
        }
        // Report only which surfaces violated the boundary, never diagnostic content.
        let leaked: Vec<_> = surfaces
            .iter()
            .filter(|(_, body)| MARKERS.iter().any(|m| body.contains(m)))
            .map(|(name, _)| *name)
            .collect();
        assert!(
            leaked.is_empty(),
            "EP-1 synthetic marker persisted/exposed in surfaces: {leaked:?}"
        );
        assert!(
            errors.iter().all(|(error, source)| error
                == if source == "claude_code_stream_event_v1" {
                    "stream_error"
                } else {
                    "upstream_attempt_failed"
                }),
            "EP-1 errors must be fixed classification codes"
        );
    }
}

#[tokio::test]
async fn ep1_ep2_http_errors_are_private_and_fallback_preserves_attempts() {
    let mut gw = Gateway::start().await;
    let success_body = json!({"id":"local", "object":"chat.completion", "model":"mock",
        "choices":[{"index":0,"message":{"role":"assistant","content":"local ok"},"finish_reason":"stop"}],
        "usage":{"prompt_tokens":2,"completion_tokens":3,"total_tokens":5}});
    let mut failures = 0;
    let mut successes = 0;
    for (protocol, path) in PATHS.iter().enumerate() {
        for stream in [false, true] {
            for status in [400, 429, 502] {
                let marker = MARKERS.join(" ");
                let error_body = match status {
                    400 => json!({"error":{"message":marker}}).to_string(),
                    429 => format!("非JSON診斷 {marker}\n{}", "長".repeat(800)),
                    _ => format!("{marker} plain text failure"),
                };
                let failed = upstream(status, error_body.clone()).await;
                let healthy_body = if stream {
                    format!(
                        "data: {}\n\ndata: [DONE]\n\n",
                        json!({"id":"local","object":"chat.completion.chunk","model":"mock","choices":[{"index":0,"delta":{"content":"local ok"},"finish_reason":"stop"}]})
                    )
                } else {
                    success_body.to_string()
                };
                let healthy = upstream(200, healthy_body).await;
                let model = format!("case-{protocol}-{stream}-{status}");
                let failed_id = gw.connection(&format!("{model}-bad"), &failed.url).await;
                let good_id = gw.connection(&format!("{model}-good"), &healthy.url).await;
                let mut targets = vec![json!({"connection_id":failed_id})];
                if status != 502 {
                    targets.push(json!({"connection_id":good_id}));
                }
                gw.post(
                    "/admin/api/routes",
                    json!({"public_model":model,"strategy":"fallback","targets":targets}),
                )
                .await;
                let response = gw.request(path, &model, stream).await;
                assert_eq!(
                    response.status().as_u16(),
                    if status == 429 { 200 } else { status }
                );
                let body = response.text().await.unwrap();
                if status == 429 {
                    assert!(
                        body.contains("local ok"),
                        "healthy fallback content missing"
                    );
                    successes += 1;
                } else {
                    let value: Value = serde_json::from_str(&body).unwrap();
                    assert_eq!(value["error"]["type"], "thinrouter_error");
                    assert!(
                        value["error"]["message"]
                            .as_str()
                            .unwrap()
                            .contains(&error_body),
                        "caller error contract changed"
                    );
                }
                assert_eq!(failed.calls.load(Ordering::SeqCst), 1);
                assert_eq!(
                    healthy.calls.load(Ordering::SeqCst),
                    usize::from(status == 429)
                );
                let rows: Value =
                    serde_json::from_str(&gw.usage_surface("/admin/api/usage").await).unwrap();
                let attempts: Vec<_> = rows["data"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|r| r["public_model"] == model)
                    .collect();
                assert_eq!(attempts.len(), if status == 429 { 2 } else { 1 });
                let failed_row = attempts.iter().find(|r| r["status"] == status).unwrap();
                assert_eq!(failed_row["connection_id"], failed_id);
                if status == 429 {
                    let ok = attempts.iter().find(|r| r["status"] == 200).unwrap();
                    assert!(ok["id"].as_i64().unwrap() > failed_row["id"].as_i64().unwrap());
                    assert!(ok["error"].is_null());
                    if !stream {
                        assert_eq!(ok["prompt_tokens"], 2);
                        assert_eq!(ok["completion_tokens"], 3);
                        assert!(
                            (ok["estimated_cost_usd"].as_f64().unwrap() - 0.000008).abs() < 1e-12
                        );
                    } else {
                        assert!(ok["prompt_tokens"].is_null());
                        assert!(ok["completion_tokens"].is_null());
                        assert!(ok["estimated_cost_usd"].is_null());
                    }
                    // An immediate second request must skip the cooled 429 target.
                    let repeated = gw.request(path, &model, stream).await;
                    assert_eq!(repeated.status(), 200);
                    assert!(repeated.text().await.unwrap().contains("local ok"));
                    assert_eq!(failed.calls.load(Ordering::SeqCst), 1);
                    assert_eq!(healthy.calls.load(Ordering::SeqCst), 2);
                    let rows: Value =
                        serde_json::from_str(&gw.usage_surface("/admin/api/usage").await).unwrap();
                    let attempts: Vec<_> = rows["data"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .filter(|r| r["public_model"] == model)
                        .collect();
                    assert_eq!(attempts.len(), 3);
                    assert_eq!(attempts.iter().filter(|r| r["status"] == 429).count(), 1);
                    successes += 1;
                }
                failures += 1;
            }
        }
    }
    gw.verify_persistence(failures, successes).await;
}

#[tokio::test]
async fn ep1_ep2_cli_failure_writer_does_not_persist_result_or_stderr() {
    let mut gw = Gateway::start().await;
    for (protocol, path) in PATHS.iter().enumerate() {
        for stream in [false, true] {
            let model = format!("fake-cli-{protocol}-{stream}");
            gw.post(
                "/admin/api/connections/oauth/import",
                json!({
                    "name":model,"provider":"claude","access_token":"","default_model":"mock"
                }),
            )
            .await;
            let response = gw.request(path, &model, stream).await;
            assert_eq!(response.status(), 502);
            let value: Value = response.json().await.unwrap();
            assert_eq!(value["error"]["type"], "thinrouter_error");
            assert!(
                value["error"]["message"]
                    .as_str()
                    .unwrap()
                    .contains(MARKERS[0]),
                "fake CLI error did not reach caller"
            );
        }
    }
    gw.verify_persistence(6, 0).await;
}

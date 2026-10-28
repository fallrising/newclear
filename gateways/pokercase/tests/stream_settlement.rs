//! SS-1–SS-5: actual loopback gateway, counted synthetic upstream and disposable DB.
use axum::{body::Body, response::IntoResponse, routing::post, Json, Router};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;
use tokio::net::TcpListener;

struct Fixture {
    base: String,
    upstream: String,
    body: Arc<Mutex<String>>,
    calls: Arc<AtomicUsize>,
    mode: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
    child: tokio::process::Child,
    client: reqwest::Client,
    dir: TempDir,
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.task.abort();
    }
}
impl Fixture {
    async fn start() -> Self {
        let body = Arc::new(Mutex::new(String::new()));
        let payload = body.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let mode = Arc::new(AtomicUsize::new(0));
        let upstream_mode = mode.clone();
        let app = Router::new().fallback(post(move |Json(request): Json<Value>| {
            let payload = payload.clone();
            let counter = counter.clone();
            let upstream_mode = upstream_mode.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                if request["model"] == "retry" {
                    return (axum::http::StatusCode::TOO_MANY_REQUESTS, "synthetic-429")
                        .into_response();
                }
                let wire = payload.lock().unwrap().clone();
                if upstream_mode.load(Ordering::SeqCst) == 2 {
                    std::future::pending::<()>().await;
                }
                let hang = upstream_mode.load(Ordering::SeqCst) == 1;
                let stream = async_stream::stream! {
                    yield Ok::<_,std::io::Error>(bytes::Bytes::from(wire));
                    if hang { std::future::pending::<()>().await; }
                };
                (
                    [("content-type", "text/event-stream")],
                    Body::from_stream(stream),
                )
                    .into_response()
            }
        }));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let upstream = format!("http://{}", listener.local_addr().unwrap());
        let task = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let dir = tempfile::tempdir().unwrap();
        let reserve = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = reserve.local_addr().unwrap().port();
        drop(reserve);
        let mut child = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            // Explicit non-forwarding proxy: even a wrong URL reaches only this fake.
            .env("HTTPS_PROXY", &upstream)
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
                "--sse-stall-secs",
                "5",
            ])
            .stdout(std::process::Stdio::null())
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
                    upstream,
                    body,
                    calls,
                    mode,
                    task,
                    child,
                    client,
                    dir,
                };
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("synthetic gateway health timeout");
    }
    async fn post(&self, path: &str, body: Value) -> Value {
        let r = self
            .client
            .post(format!("{}{path}", self.base))
            .header("x-admin-token", "synthetic-admin")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 201, "synthetic setup {path}");
        r.json().await.unwrap()
    }
    async fn surface(&self, path: &str) -> String {
        let r = self
            .client
            .get(format!("{}{path}", self.base))
            .header("x-admin-token", "synthetic-admin")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        r.text().await.unwrap()
    }
    async fn setup(&self) {
        let id = self
            .post(
                "/admin/api/connections",
                json!({"name":"synthetic",
            "base_url":format!("{}/v1", self.upstream),"api_key":"synthetic-key",
            "default_model":"synthetic", "input_price_per_m":1.0,"output_price_per_m":2.0}),
            )
            .await;
        self.post(
            "/admin/api/routes",
            json!({"public_model":"synthetic","strategy":"fallback",
            "targets":[{"connection_id":id["id"],"model_override":"synthetic"}]}),
        )
        .await;
    }
    async fn request(&self) -> String {
        let r = self.client.post(format!("{}/v1/chat/completions",self.base))
            .json(&json!({"model":"synthetic","stream":true,"messages":[{"role":"user","content":"synthetic"}]}))
            .send().await.unwrap();
        assert_eq!(r.status(), 200);
        r.text().await.unwrap()
    }
    fn request_for(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}{path}", self.base))
            .json(&json!({
                "model":"synthetic", "stream":true, "max_tokens":64,
                "messages":[{"role":"user","content":"synthetic"}], "input":"synthetic"
            }))
    }
    async fn rows(&self) -> Vec<Value> {
        let v: Value = serde_json::from_str(&self.surface("/admin/api/usage").await).unwrap();
        v["data"].as_array().unwrap().clone()
    }
    async fn wait_outcome(&self, outcome: &str) -> Value {
        for _ in 0..100 {
            if let Some(row) = self.rows().await.first() {
                if row["outcome"] == outcome {
                    return row.clone();
                }
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("expected synthetic terminal outcome {outcome}");
    }
    async fn restart(&mut self) {
        self.child.kill().await.unwrap();
        self.child.wait().await.unwrap();
        let port = self.base.rsplit(':').next().unwrap();
        self.child = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .env("HTTPS_PROXY", &self.upstream)
            .args([
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                port,
                "--data-dir",
                self.dir.path().to_str().unwrap(),
                "--admin-token",
                "synthetic-admin",
                "--allow-keyless-bootstrap",
                "--sse-stall-secs",
                "5",
            ])
            .stdout(std::process::Stdio::null())
            .stderr(
                std::fs::OpenOptions::new()
                    .append(true)
                    .open(self.dir.path().join("stderr"))
                    .unwrap(),
            )
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        for _ in 0..100 {
            assert!(
                self.child.try_wait().unwrap().is_none(),
                "restarted synthetic gateway exited"
            );
            if self
                .client
                .get(format!("{}/health", self.base))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                return;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("restart health timeout");
    }
}
fn event(v: Value) -> String {
    format!("data: {v}\n\n")
}

#[tokio::test]
async fn ss1_tail_usage_settles_once_without_changing_bytes() {
    let mut f = Fixture::start().await;
    f.setup().await;
    let usage = event(json!({"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}));
    let wire = event(
        json!({"choices":[{"index":0,"delta":{"content":"synthetic"},"finish_reason":"stop"}]}),
    ) + &usage
        + &usage
        + "data: [DONE]\n\nopaque-tail";
    *f.body.lock().unwrap() = wire.clone();
    assert_eq!(f.request().await, wire);
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let rows: Value = serde_json::from_str(&f.surface("/admin/api/usage").await).unwrap();
    assert_eq!(rows["data"].as_array().unwrap().len(), 1);
    let row = &rows["data"][0];
    // Deliberately first: baseline must fail on actual persisted tokens, not a new schema field.
    assert_eq!(row["prompt_tokens"], 5, "SS-1 persisted tail usage");
    assert_eq!(row["completion_tokens"], 3);
    assert_eq!(row["outcome"], "succeeded");
    assert_eq!(row["usage_status"], "complete");
    assert_eq!(row["status"], 200);
    assert!(row["attempt_id"].is_string());
    assert!(row["request_id"].is_string());
    assert!(row["finalized_at"].is_string());
    assert!((row["estimated_cost_usd"].as_f64().unwrap() - 0.000011).abs() < 1e-12);
    let db = rusqlite::Connection::open(f.dir.path().join("thinrouter.db")).unwrap();
    let counts: (i64, i64, i64) = db
        .query_row(
            "SELECT COUNT(*),SUM(prompt_tokens),SUM(completion_tokens) FROM usage_events",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(counts, (1, 5, 3));
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

#[tokio::test]
async fn ss2_ss5_outcomes_and_usage_are_independent_across_surfaces() {
    let mut f = Fixture::start().await;
    f.setup().await;
    let finish = event(json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}));
    let cases = [
        (
            finish.clone(),
            "succeeded",
            "missing",
            Value::Null,
            Value::Null,
        ),
        (
            event(json!({"choices":[{"index":0,"delta":{"content":"synthetic-canary-secret"}}]})),
            "failed",
            "missing",
            Value::Null,
            Value::Null,
        ),
        (
            event(
                json!({"error":{"message":"synthetic-canary-secret"},"usage":{"prompt_tokens":7}}),
            ),
            "failed",
            "partial",
            json!(7),
            Value::Null,
        ),
        (
            finish.clone()
                + &event(json!({"usage":{"prompt_tokens":0,"completion_tokens":0}}))
                + "data: [DONE]\n\n",
            "succeeded",
            "complete",
            json!(0),
            json!(0),
        ),
        (
            finish.clone()
                + &event(json!({"usage":{"prompt_tokens":-1,"completion_tokens":3}}))
                + "data: [DONE]\n\n",
            "succeeded",
            "invalid",
            Value::Null,
            json!(3),
        ),
        (
            event(json!({"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}))
                + "data: [DONE]\n\n",
            "incomplete",
            "missing",
            Value::Null,
            Value::Null,
        ),
    ];
    for (wire, outcome, quality, pt, ct) in &cases {
        *f.body.lock().unwrap() = wire.clone();
        assert_eq!(f.request().await, *wire);
        let row = f.rows().await.remove(0);
        assert_eq!(row["status"], 200);
        assert_eq!(row["outcome"], *outcome);
        assert_eq!(row["usage_status"], *quality);
        assert_eq!(row["prompt_tokens"], *pt);
        assert_eq!(row["completion_tokens"], *ct);
        assert!(row["headers_ms"].as_i64().unwrap() <= row["total_observed_ms"].as_i64().unwrap());
        if *quality != "complete" {
            assert!(row["estimated_cost_usd"].is_null());
        }
    }
    let daily: Value = serde_json::from_str(&f.surface("/admin/api/usage/daily").await).unwrap();
    assert_eq!(daily["data"][0]["headers_200"], 6);
    assert_eq!(daily["data"][0]["ok"], 3);
    assert_eq!(daily["data"][0]["errors"], 2);
    assert_eq!(daily["data"][0]["incomplete"], 1);
    for path in [
        "/admin/api/usage",
        "/admin/usage",
        "/admin/api/usage/export.csv",
    ] {
        let text = f.surface(path).await;
        assert!(!text.contains("synthetic-canary-secret"));
        assert!(text.contains("succeeded"));
        assert!(text.contains("incomplete"));
    }
    let csv = f.surface("/admin/api/usage/export.csv").await;
    assert!(csv.lines().next().unwrap().contains("usage_status"));
    assert!(!std::fs::read_to_string(f.dir.path().join("stderr"))
        .unwrap()
        .contains("synthetic-canary-secret"));
    assert_eq!(f.calls.load(Ordering::SeqCst), cases.len());
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

#[tokio::test]
async fn ss3_cancel_and_stall_preserve_http_headers() {
    let mut f = Fixture::start().await;
    f.setup().await;
    f.mode.store(1, Ordering::SeqCst);
    *f.body.lock().unwrap() =
        event(json!({"choices":[{"index":0,"delta":{"content":"synthetic"}}]}));
    let request = || {
        f.client
            .post(format!("{}/v1/chat/completions", f.base))
            .json(&json!({"model":"synthetic","stream":true,"messages":[]}))
    };
    let mut response = request().send().await.unwrap();
    assert!(response.chunk().await.unwrap().is_some());
    drop(response);
    let row = f.wait_outcome("cancelled").await;
    assert_eq!(row["status"], 200);
    assert!(row["first_output_ms"].is_number());
    assert!(row["estimated_cost_usd"].is_null());
    let response = request().send().await.unwrap();
    assert!(response.text().await.is_err());
    let row = f.wait_outcome("timeout").await;
    assert_eq!(row["status"], 200);
    assert_eq!(row["error"], "stream_timeout");
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

#[tokio::test]
async fn ss4_restart_recovers_pending_without_replay_and_insert_failure_stops_dispatch() {
    let mut f = Fixture::start().await;
    f.setup().await;
    f.mode.store(1, Ordering::SeqCst);
    *f.body.lock().unwrap() =
        event(json!({"choices":[{"index":0,"delta":{"content":"synthetic"}}]}));
    let mut response = f
        .client
        .post(format!("{}/v1/chat/completions", f.base))
        .json(&json!({"model":"synthetic","stream":true,"messages":[]}))
        .send()
        .await
        .unwrap();
    assert!(response.chunk().await.unwrap().is_some());
    let pending = f.rows().await.remove(0);
    assert!(pending["finalized_at"].is_null());
    assert!(pending["attempt_id"].is_string());
    assert_eq!(pending["status"], 200);
    let duplicate = tokio::time::timeout(
        Duration::from_secs(5),
        tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
            .env_clear()
            .env("PATH", "/usr/bin:/bin")
            .args([
                "serve",
                "--host",
                "127.0.0.1",
                "--port",
                "0",
                "--data-dir",
                f.dir.path().to_str().unwrap(),
                "--admin-token",
                "synthetic-admin",
            ])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!duplicate.status.success());
    assert!(String::from_utf8_lossy(&duplicate.stderr).contains("usage_store_in_use"));
    assert!(f.rows().await[0]["finalized_at"].is_null());
    f.restart().await;
    drop(response);
    let recovered = f.rows().await.remove(0);
    assert_eq!(recovered["outcome"], "interrupted");
    assert_eq!(recovered["attempt_id"], pending["attempt_id"]);
    assert!(recovered["total_observed_ms"].is_null());
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    f.restart().await;
    assert_eq!(f.rows().await, vec![recovered]);
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let db = rusqlite::Connection::open(f.dir.path().join("thinrouter.db")).unwrap();
    db.execute_batch("CREATE TRIGGER synthetic_insert_failure BEFORE INSERT ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic-private-diagnostic'); END;").unwrap();
    let r = f
        .client
        .post(format!("{}/v1/chat/completions", f.base))
        .json(&json!({"model":"synthetic","stream":true,"messages":[]}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 503);
    assert!(!r
        .text()
        .await
        .unwrap()
        .contains("synthetic-private-diagnostic"));
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    assert_eq!(f.rows().await.len(), 1);
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

#[tokio::test]
async fn ss4_fallback_has_distinct_attempts_and_shared_request() {
    let mut f = Fixture::start().await;
    let mut ids = Vec::new();
    for name in ["first", "second"] {
        ids.push(f.post("/admin/api/connections",json!({"name":name,"base_url":format!("{}/v1",f.upstream),"api_key":"synthetic-key"})).await["id"].clone());
    }
    f.post("/admin/api/routes",json!({"public_model":"synthetic","strategy":"fallback","targets":[
        {"connection_id":ids[0],"model_override":"retry"},{"connection_id":ids[1],"model_override":"synthetic"}]})).await;
    *f.body.lock().unwrap() =
        event(json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}))
            + "data: [DONE]\n\n";
    f.request().await;
    let rows = f.rows().await;
    assert_eq!(rows.len(), 2);
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    assert_eq!(rows[0]["outcome"], "succeeded");
    assert_eq!(rows[1]["outcome"], "failed");
    assert_eq!(rows[1]["status"], 429);
    assert_eq!(rows[0]["request_id"], rows[1]["request_id"]);
    assert_ne!(rows[0]["attempt_id"], rows[1]["attempt_id"]);
    assert!(rows[1]["first_output_ms"].is_null());
    assert!(rows[1]["estimated_cost_usd"].is_null());
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

#[tokio::test]
async fn ss3_preheaders_cancel_and_ss4_failed_finalize_remain_durable() {
    let mut f = Fixture::start().await;
    f.setup().await;
    f.mode.store(2, Ordering::SeqCst);
    let pending = f
        .client
        .post(format!("{}/v1/chat/completions", f.base))
        .json(&json!({"model":"synthetic","stream":true,"messages":[]}));
    let task = tokio::spawn(async move { pending.send().await });
    for _ in 0..100 {
        if f.calls.load(Ordering::SeqCst) == 1 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let row = f.rows().await.remove(0);
    assert!(row["attempt_id"].is_string());
    assert!(row["status"].is_null());
    assert!(row["finalized_at"].is_null());
    task.abort();
    let _ = task.await;
    let row = f.wait_outcome("cancelled").await;
    assert!(row["status"].is_null());
    f.mode.store(0, Ordering::SeqCst);
    *f.body.lock().unwrap() =
        event(json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}))
            + "data: [DONE]\n\n";
    let db = rusqlite::Connection::open(f.dir.path().join("thinrouter.db")).unwrap();
    db.execute_batch("CREATE TRIGGER synthetic_finalize_failure BEFORE UPDATE OF finalized_at ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic-private-diagnostic'); END;").unwrap();
    f.request().await;
    let row = f.rows().await.remove(0);
    assert!(row["finalized_at"].is_null());
    assert_eq!(row["status"], 200);
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    let stderr = std::fs::read_to_string(f.dir.path().join("stderr")).unwrap();
    assert!(!stderr.contains("synthetic-private-diagnostic"));
    assert_eq!(stderr.matches("usage_finalization_failed").count(), 1);
    db.execute_batch("DROP TRIGGER synthetic_finalize_failure;")
        .unwrap();
    f.restart().await;
    assert_eq!(f.rows().await.remove(0)["outcome"], "interrupted");
    assert_eq!(f.calls.load(Ordering::SeqCst), 2);
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

async fn pc1_tail_usage(path: &str, terminal: &str) {
    let mut f = Fixture::start().await;
    f.setup().await;
    let usage = event(json!({"choices":[],"usage":{"prompt_tokens":5,"completion_tokens":3}}));
    *f.body.lock().unwrap() = event(
        json!({"choices":[{"index":0,"delta":{"content":"synthetic"}}]}),
    ) + &event(
        json!({"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_pc1","type":"function","function":{"name":"add","arguments":"{\"a\":1}"}}]},"finish_reason":"tool_calls"}]}),
    ) + &usage
        + &usage
        + "data: [DONE]\n\n";
    let r = f.request_for(path).send().await.unwrap();
    assert_eq!(r.status(), 200);
    let output = r.text().await.unwrap();
    assert!(output.contains(terminal));
    assert!(output.contains("call_pc1") && output.contains("add"));
    assert_eq!(f.calls.load(Ordering::SeqCst), 1);
    let rows = f.rows().await;
    assert_eq!(rows.len(), 1);
    let row = &rows[0];
    assert_eq!(
        row["prompt_tokens"], 5,
        "PC-1 {path} persisted original upstream tail"
    );
    assert_eq!(row["completion_tokens"], 3);
    assert_eq!(row["outcome"], "succeeded");
    assert_eq!(row["usage_status"], "complete");
    assert!(row["attempt_id"].is_string() && row["request_id"].is_string());
    assert!(row["first_output_ms"].is_number() && row["finalized_at"].is_string());
    assert!((row["estimated_cost_usd"].as_f64().unwrap() - 0.000011).abs() < 1e-12);
    f.child.kill().await.unwrap();
    f.child.wait().await.unwrap();
}

#[tokio::test]
async fn pc1_messages_tail_usage() {
    pc1_tail_usage("/v1/messages", "message_stop").await;
}

#[tokio::test]
async fn pc1_responses_tail_usage() {
    pc1_tail_usage("/v1/responses", "response.completed").await;
}

#[tokio::test]
async fn pc2_converted_outcomes_and_raw_missing_usage() {
    for path in ["/v1/messages", "/v1/responses"] {
        let mut f = Fixture::start().await;
        f.setup().await;
        let finish = event(json!({"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}));
        let cases = [
            (
                finish.clone(),
                "succeeded",
                "missing",
                Value::Null,
                Value::Null,
            ),
            (
                event(json!({"choices":[{"index":0,"delta":{"content":"synthetic"}}]})),
                "failed",
                "missing",
                Value::Null,
                Value::Null,
            ),
            (
                event(json!({"error":{"message":"synthetic"},"usage":{"prompt_tokens":7}})),
                "failed",
                "partial",
                json!(7),
                Value::Null,
            ),
            (
                finish.clone()
                    + &event(json!({"usage":{"prompt_tokens":0,"completion_tokens":0}}))
                    + "data: [DONE]\n\n",
                "succeeded",
                "complete",
                json!(0),
                json!(0),
            ),
            (
                finish
                    + &event(json!({"usage":{"prompt_tokens":-1,"completion_tokens":3}}))
                    + "data: [DONE]\n\n",
                "succeeded",
                "invalid",
                Value::Null,
                json!(3),
            ),
            (
                event(json!({"choices":[{"index":0,"delta":{},"finish_reason":"length"}]}))
                    + "data: [DONE]\n\n",
                "incomplete",
                "missing",
                Value::Null,
                Value::Null,
            ),
        ];
        for (wire, outcome, quality, pt, ct) in &cases {
            *f.body.lock().unwrap() = wire.clone();
            let response = f.request_for(path).send().await.unwrap();
            assert_eq!(response.status(), 200);
            let output = response.text().await.unwrap();
            if *outcome == "failed" {
                assert!(output.contains("error"));
            }
            let row = f.rows().await.remove(0);
            assert_eq!(row["outcome"], *outcome, "{path}");
            assert_eq!(row["usage_status"], *quality, "{path}");
            assert_eq!(row["prompt_tokens"], *pt);
            assert_eq!(row["completion_tokens"], *ct);
            assert!(row["finalized_at"].is_string());
            assert_eq!(row["status"], 200);
            if *quality != "complete" {
                assert!(row["estimated_cost_usd"].is_null());
            }
        }
        let daily: Value =
            serde_json::from_str(&f.surface("/admin/api/usage/daily").await).unwrap();
        assert_eq!(daily["data"][0]["headers_200"], 6);
        assert_eq!(daily["data"][0]["ok"], 3);
        assert_eq!(daily["data"][0]["errors"], 2);
        assert_eq!(daily["data"][0]["incomplete"], 1);
        assert_eq!(f.calls.load(Ordering::SeqCst), 6);
        for surface in ["/admin/usage", "/admin/api/usage/export.csv"] {
            let text = f.surface(surface).await;
            assert!(text.contains("failed") && text.contains("incomplete"));
        }
        f.child.kill().await.unwrap();
        f.child.wait().await.unwrap();
    }
}

#[tokio::test]
async fn pc3_converted_cancel_stall_and_preheaders_cancel() {
    for path in ["/v1/messages", "/v1/responses"] {
        let mut f = Fixture::start().await;
        f.setup().await;
        f.mode.store(1, Ordering::SeqCst);
        *f.body.lock().unwrap() =
            event(json!({"choices":[{"index":0,"delta":{"content":"synthetic"}}]}));
        let mut response = f.request_for(path).send().await.unwrap();
        assert!(response.chunk().await.unwrap().is_some());
        drop(response);
        let row = f.wait_outcome("cancelled").await;
        assert_eq!(row["status"], 200);
        assert!(row["first_output_ms"].is_number());
        assert_eq!(row["error"], "stream_cancelled");
        assert!(row["estimated_cost_usd"].is_null());
        let output = f
            .request_for(path)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        assert!(output.contains("error"));
        let row = f.wait_outcome("timeout").await;
        assert_eq!(row["status"], 200);
        assert_eq!(row["error"], "stream_timeout");
        assert!(row["total_observed_ms"].as_i64().unwrap() >= 5000);
        f.mode.store(2, Ordering::SeqCst);
        let request = f.request_for(path);
        let task = tokio::spawn(async move { request.send().await });
        for _ in 0..100 {
            if f.calls.load(Ordering::SeqCst) == 3 {
                break;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        assert_eq!(f.calls.load(Ordering::SeqCst), 3);
        let pending = f.rows().await.remove(0);
        assert!(pending["attempt_id"].is_string() && pending["finalized_at"].is_null());
        assert!(pending["status"].is_null());
        task.abort();
        let _ = task.await;
        let row = f.wait_outcome("cancelled").await;
        assert_eq!(row["attempt_id"], pending["attempt_id"]);
        assert!(
            row["status"].is_null()
                && row["headers_ms"].is_null()
                && row["first_output_ms"].is_null()
        );
        assert_eq!(f.rows().await.len(), 3);
        f.child.kill().await.unwrap();
        f.child.wait().await.unwrap();
    }
}

#[tokio::test]
async fn pc3_converted_fallback_storage_failures_and_restart_no_replay() {
    for path in ["/v1/messages", "/v1/responses"] {
        let mut f = Fixture::start().await;
        let mut ids = Vec::new();
        for name in ["first", "second"] {
            ids.push(f.post("/admin/api/connections",json!({"name":name,"base_url":format!("{}/v1",f.upstream),"api_key":"synthetic","input_price_per_m":1.0,"output_price_per_m":2.0})).await["id"].clone());
        }
        f.post("/admin/api/routes",json!({"public_model":"synthetic","strategy":"fallback","targets":[{"connection_id":ids[0],"model_override":"retry"},{"connection_id":ids[1],"model_override":"synthetic"}]})).await;
        let complete = event(
            json!({"choices":[{"index":0,"delta":{"content":"synthetic"},"finish_reason":"stop"}]}),
        ) + &event(json!({"usage":{"prompt_tokens":5,"completion_tokens":3}}))
            + "data: [DONE]\n\n";
        *f.body.lock().unwrap() = complete.clone();
        f.request_for(path)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let rows = f.rows().await;
        assert_eq!(rows.len(), 2);
        assert_eq!(f.calls.load(Ordering::SeqCst), 2);
        assert_eq!(rows[0]["outcome"], "succeeded");
        assert_eq!(rows[1]["outcome"], "failed");
        assert_eq!(rows[1]["status"], 429);
        assert_eq!(rows[0]["request_id"], rows[1]["request_id"]);
        assert_ne!(rows[0]["attempt_id"], rows[1]["attempt_id"]);
        for row in &rows {
            assert!(
                row["headers_ms"].as_i64().unwrap() <= row["total_observed_ms"].as_i64().unwrap()
            );
        }
        assert!(rows[1]["first_output_ms"].is_null() && rows[1]["estimated_cost_usd"].is_null());
        // Use one healthy target for crash/storage scenarios, so cooldown expiry is irrelevant.
        let routes: Value = serde_json::from_str(&f.surface("/admin/api/routes").await).unwrap();
        let route = &routes["data"][0];
        let changed=f.client.put(format!("{}/admin/api/routes/{}",f.base,route["id"].as_str().unwrap()))
            .header("x-admin-token","synthetic-admin").json(&json!({"public_model":"synthetic","strategy":"fallback","targets":[{"connection_id":ids[1],"model_override":"synthetic"}]})).send().await.unwrap();
        assert!(changed.status().is_success());
        f.mode.store(1, Ordering::SeqCst);
        *f.body.lock().unwrap() =
            event(json!({"choices":[{"index":0,"delta":{"content":"synthetic"}}]}));
        let mut response = f.request_for(path).send().await.unwrap();
        assert!(response.chunk().await.unwrap().is_some());
        let pending = f.rows().await.remove(0);
        assert!(pending["finalized_at"].is_null());
        f.restart().await;
        drop(response);
        let recovered = f.rows().await.remove(0);
        assert_eq!(recovered["outcome"], "interrupted");
        assert_eq!(recovered["attempt_id"], pending["attempt_id"]);
        assert!(recovered["total_observed_ms"].is_null());
        f.restart().await;
        assert_eq!(f.rows().await.remove(0), recovered);
        assert_eq!(f.calls.load(Ordering::SeqCst), 3);
        let db = rusqlite::Connection::open(f.dir.path().join("thinrouter.db")).unwrap();
        db.execute_batch("CREATE TRIGGER synthetic_insert_failure BEFORE INSERT ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic-private-diagnostic'); END;").unwrap();
        let response = f.request_for(path).send().await.unwrap();
        assert_eq!(response.status(), 503);
        assert!(!response
            .text()
            .await
            .unwrap()
            .contains("synthetic-private-diagnostic"));
        assert_eq!(f.calls.load(Ordering::SeqCst), 3);
        db.execute_batch("DROP TRIGGER synthetic_insert_failure; CREATE TRIGGER synthetic_finalize_failure BEFORE UPDATE OF finalized_at ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic-private-diagnostic'); END;").unwrap();
        f.mode.store(0, Ordering::SeqCst);
        *f.body.lock().unwrap() = complete;
        f.request_for(path)
            .send()
            .await
            .unwrap()
            .text()
            .await
            .unwrap();
        let row = f.rows().await.remove(0);
        assert!(row["finalized_at"].is_null());
        assert_eq!(row["status"], 200);
        assert_eq!(f.calls.load(Ordering::SeqCst), 4);
        db.execute_batch("DROP TRIGGER synthetic_finalize_failure;")
            .unwrap();
        f.restart().await;
        assert_eq!(f.rows().await.remove(0)["outcome"], "interrupted");
        assert_eq!(f.calls.load(Ordering::SeqCst), 4);
        let stderr = std::fs::read_to_string(f.dir.path().join("stderr")).unwrap();
        assert!(!stderr.contains("synthetic-private-diagnostic"));
        assert_eq!(stderr.matches("usage_finalization_failed").count(), 1);
        f.child.kill().await.unwrap();
        f.child.wait().await.unwrap();
    }
}

//! D-05: buffered HTTP accounting uses observed usage, never conversion defaults.
//! Local fake upstreams and disposable databases only; no credential discovery.
use axum::{routing::post, Router};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tempfile::TempDir;
use tokio::net::TcpListener;

const PATHS: [&str; 3] = ["/v1/chat/completions", "/v1/messages", "/v1/responses"];

struct Fixture {
    base: String,
    upstream: String,
    body: Arc<Mutex<String>>,
    calls: Arc<AtomicUsize>,
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
    async fn start(kind: &str) -> Self {
        let body = Arc::new(Mutex::new(String::new()));
        let payload = body.clone();
        let calls = Arc::new(AtomicUsize::new(0));
        let counter = calls.clone();
        let content_type = if kind == "siwc" {
            "text/event-stream"
        } else {
            "application/json"
        };
        let app = Router::new().fallback(post(move || {
            let payload = payload.clone();
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                (
                    [("content-type", content_type)],
                    payload.lock().unwrap().clone(),
                )
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
            // The local fake also acts as the only explicit reqwest proxy; it never forwards.
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
                "--provider-base-override",
                &format!("grok={upstream},siwc={upstream}"),
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
                "synthetic fixture exited before health"
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
                    task,
                    child,
                    client,
                    dir,
                };
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("synthetic fixture health timeout");
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
    async fn connection(
        &self,
        kind: &str,
        model: &str,
        ip: Option<f64>,
        op: Option<f64>,
    ) -> String {
        let body = json!({"name":model,"base_url":format!("{}/v1",self.upstream),"api_key":"synthetic-key","default_model":"mock","input_price_per_m":ip,"output_price_per_m":op});
        if kind == "chat" {
            return self.post("/admin/api/connections", body).await["id"]
                .as_str()
                .unwrap()
                .to_owned();
        }
        let id = self.post("/admin/api/connections/oauth/import", json!({"name":model,"provider":kind,"access_token":"synthetic-token","base_url":format!("{}/v1",self.upstream),"default_model":"mock","meta":"{\"project\":\"synthetic-project\"}"})).await["connection"]["id"].as_str().unwrap().to_owned();
        let r = self
            .client
            .put(format!("{}/admin/api/connections/{id}", self.base))
            .header("x-admin-token", "synthetic-admin")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200, "synthetic price setup");
        id
    }
}

fn response(kind: &str, pt: Option<Value>, ct: Option<Value>) -> String {
    let mut usage = json!({});
    let (pk, ck) = match kind {
        "chat" => ("prompt_tokens", "completion_tokens"),
        _ => ("input_tokens", "output_tokens"),
    };
    if let Some(v) = pt {
        usage[pk] = v;
    }
    if let Some(v) = ct {
        usage[ck] = v;
    }
    let v = match kind {
        "chat" => {
            json!({"id":"synthetic","object":"chat.completion","model":"mock","choices":[{"index":0,"message":{"role":"assistant","content":"synthetic answer"},"finish_reason":"stop"}],"usage":usage})
        }
        _ => {
            json!({"id":"synthetic","object":"response","status":"completed","model":"mock","output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"synthetic answer"}]}],"usage":usage})
        }
    };
    if kind == "siwc" {
        format!(
            "event: response.completed\ndata: {}\n\n",
            json!({"type":"response.completed","response":v})
        )
    } else {
        v.to_string()
    }
}

#[tokio::test]
async fn ce1_ce2_buffered_cost_completeness_survives_protocol_conversion() {
    // Expected values are independently declared; missing is not inferred from a converted reply.
    let cases = [
        (
            "complete",
            Some(json!(2)),
            Some(json!(3)),
            Some(1.0),
            Some(2.0),
            Some(2),
            Some(3),
            Some(0.000008),
        ),
        (
            "missing-output",
            Some(json!(2)),
            None,
            Some(1.0),
            Some(2.0),
            Some(2),
            None,
            None,
        ),
        (
            "missing-input",
            None,
            Some(json!(3)),
            Some(1.0),
            Some(2.0),
            None,
            Some(3),
            None,
        ),
        (
            "missing-both",
            None,
            None,
            Some(1.0),
            Some(2.0),
            None,
            None,
            None,
        ),
        (
            "null-output",
            Some(json!(2)),
            Some(Value::Null),
            Some(1.0),
            Some(2.0),
            Some(2),
            None,
            None,
        ),
        (
            "string-output",
            Some(json!(2)),
            Some(json!("3")),
            Some(1.0),
            Some(2.0),
            Some(2),
            None,
            None,
        ),
        (
            "negative-output",
            Some(json!(2)),
            Some(json!(-1)),
            Some(1.0),
            Some(2.0),
            Some(2),
            None,
            None,
        ),
        (
            "missing-input-rate",
            Some(json!(2)),
            Some(json!(3)),
            None,
            Some(2.0),
            Some(2),
            Some(3),
            None,
        ),
        (
            "missing-output-rate",
            Some(json!(2)),
            Some(json!(3)),
            Some(1.0),
            None,
            Some(2),
            Some(3),
            None,
        ),
        (
            "missing-both-rates",
            Some(json!(2)),
            Some(json!(3)),
            None,
            None,
            Some(2),
            Some(3),
            None,
        ),
        (
            "zero-counts",
            Some(json!(0)),
            Some(json!(0)),
            Some(1.0),
            Some(2.0),
            Some(0),
            Some(0),
            Some(0.0),
        ),
        (
            "zero-rates",
            Some(json!(2)),
            Some(json!(3)),
            Some(0.0),
            Some(0.0),
            Some(2),
            Some(3),
            Some(0.0),
        ),
        (
            "zero-output",
            Some(json!(2)),
            Some(json!(0)),
            Some(1.0),
            Some(2.0),
            Some(2),
            Some(0),
            Some(0.000002),
        ),
        (
            "zero-output-missing-rate",
            Some(json!(2)),
            Some(json!(0)),
            Some(1.0),
            None,
            Some(2),
            Some(0),
            None,
        ),
    ];
    let mut violations = Vec::new();
    for kind in ["chat", "grok", "siwc"] {
        let mut f = Fixture::start(kind).await;
        let db = rusqlite::Connection::open_with_flags(
            f.dir.path().join("thinrouter.db"),
            rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
        )
        .unwrap();
        for (name, pt, ct, ip, op, want_pt, want_ct, cost) in &cases {
            *f.body.lock().unwrap() = response(kind, pt.clone(), ct.clone());
            for (index, path) in PATHS.iter().enumerate() {
                let model = format!("{kind}-{name}-{index}");
                let id = f.connection(kind, &model, *ip, *op).await;
                f.post("/admin/api/routes", json!({"public_model":model,"strategy":"fallback","targets":[{"connection_id":id}]})).await;
                let before = f.calls.load(Ordering::SeqCst);
                let r = f.client.post(format!("{}{path}", f.base)).json(&json!({"model":model,"messages":[{"role":"user","content":"synthetic request"}],"input":"synthetic request","max_tokens":8,"stream":false})).send().await.unwrap();
                assert_eq!(r.status(), 200, "{model} response status");
                assert!(
                    r.text().await.unwrap().contains("synthetic answer"),
                    "{model} caller text"
                );
                assert_eq!(
                    f.calls.load(Ordering::SeqCst),
                    before + 1,
                    "{model} dispatch count"
                );
                let saved: (Option<i64>,Option<i64>,Option<f64>,i64,Option<String>) = db.query_row("SELECT prompt_tokens,completion_tokens,estimated_cost_usd,status,error FROM usage_events WHERE public_model=?1", [&model], |r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?))).unwrap();
                assert_eq!((saved.3, saved.4), (200, None), "{model} status/error");
                if (saved.0, saved.1, saved.2) != (*want_pt, *want_ct, *cost) {
                    violations.push(format!("{model}:sqlite"));
                }
                let rows: Value =
                    serde_json::from_str(&f.surface("/admin/api/usage").await).unwrap();
                let row = rows["data"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|v| v["public_model"] == model)
                    .unwrap();
                if row["prompt_tokens"] != json!(want_pt)
                    || row["completion_tokens"] != json!(want_ct)
                    || row["estimated_cost_usd"] != json!(cost)
                {
                    violations.push(format!("{model}:json"));
                }
                let csv = f.surface("/admin/api/usage/export.csv").await;
                let fields: Vec<_> = csv
                    .lines()
                    .find(|l| l.split(',').nth(2) == Some(&model))
                    .unwrap()
                    .split(',')
                    .collect();
                let expected = [
                    want_pt.map(|v| v.to_string()).unwrap_or_default(),
                    want_ct.map(|v| v.to_string()).unwrap_or_default(),
                    cost.map(|v| v.to_string()).unwrap_or_default(),
                ];
                if fields[6..9] != expected {
                    violations.push(format!("{model}:csv"));
                }
                let html = f.surface("/admin/usage").await;
                let event = html
                    .split("<tr>")
                    .find(|s| s.contains(&format!("<td>{model}</td>")))
                    .unwrap();
                let cell = event
                    .split("<td")
                    .nth(7)
                    .unwrap()
                    .split("</td>")
                    .next()
                    .unwrap();
                if cost.is_none() && !cell.contains('—') || cost.is_some() && !cell.contains('$')
                {
                    violations.push(format!("{model}:html"));
                }
            }
        }
        f.child.kill().await.unwrap();
    }
    assert!(
        violations.is_empty(),
        "CE-1/CE-2 persistence mismatches (synthetic case/surface only): {}",
        violations.join(", ")
    );
}

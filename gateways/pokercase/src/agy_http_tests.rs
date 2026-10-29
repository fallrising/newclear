//! Actual gateway HTTP acceptance with a sealed, non-forwarding Antigravity fixture.
//! This module is test-only. No provider credentials, environment configuration,
//! production refresh entrypoints, or native provider traffic are used here.
use super::*;
use crate::antigravity_test_transport::{AntigravityTestTransport, Operation};
use axum::extract::{Request, State};
use std::collections::VecDeque;
use std::net::SocketAddr;
use std::sync::atomic::AtomicUsize;
use std::sync::Mutex;
use tempfile::TempDir;

const ADMIN: &str = "synthetic-admin";
const OLD: &str = "synthetic-access";
const FRESH: &str = "synthetic-fresh-access";
const PROJECT: &str = "synthetic-project";
const STREAM_BYTES: &[u8] = b"event: synthetic\ndata: {\"fixture\":true}\n\ndata: [DONE]\n\n";

fn op_name(op: Operation) -> &'static str {
    match op {
        Operation::GenerateContent => "inference",
        Operation::LoadCodeAssist => "discovery",
        Operation::GoogleToken => "refresh",
    }
}

enum Reply {
    Json(Value),
    Error(u16),
    Malformed,
    Stream { hold: bool },
}

struct Step {
    operation: Operation,
    access: &'static str,
    stream: bool,
    reply: Reply,
}

impl Step {
    fn inference(reply: Reply) -> Self {
        Self {
            operation: Operation::GenerateContent,
            access: OLD,
            stream: false,
            reply,
        }
    }

    fn refresh(reply: Reply) -> Self {
        Self {
            operation: Operation::GoogleToken,
            access: OLD,
            stream: false,
            reply,
        }
    }

    fn discovery(reply: Reply) -> Self {
        Self {
            operation: Operation::LoadCodeAssist,
            access: OLD,
            stream: false,
            reply,
        }
    }

    fn fresh(mut self) -> Self {
        self.access = FRESH;
        self
    }

    fn streaming(mut self) -> Self {
        self.stream = true;
        self
    }
}

struct Fixture {
    transport: AntigravityTestTransport,
    pending: Mutex<VecDeque<Step>>,
    // Only routing metadata and validation booleans survive request handling.
    records: Mutex<Vec<Value>>,
    unexpected: AtomicUsize,
    active_streams: Arc<AtomicUsize>,
    dropped_streams: Arc<AtomicUsize>,
}

struct StreamOwner {
    active: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}

impl Drop for StreamOwner {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
        self.dropped.fetch_add(1, Ordering::SeqCst);
    }
}

async fn fake_endpoint(State(fake): State<Arc<Fixture>>, request: Request) -> Response {
    let target = request.uri().to_string();
    let method = request.method().as_str().to_string();
    let host = request.headers().get("host").and_then(|h| h.to_str().ok());
    let operation = match fake.transport.validate_fixture_request(
        &method,
        &target,
        host,
        request.headers().contains_key("upgrade"),
    ) {
        Ok(operation) => operation,
        Err(_) => {
            fake.unexpected.fetch_add(1, Ordering::SeqCst);
            return (StatusCode::BAD_REQUEST, "fixture destination denied").into_response();
        }
    };
    let destination = format!("http://{}{}", host.unwrap(), request.uri().path());
    let step = fake.pending.lock().unwrap().pop_front();
    let Some(step) = step else {
        fake.unexpected.fetch_add(1, Ordering::SeqCst);
        return (StatusCode::BAD_REQUEST, "unplanned fixture operation").into_response();
    };
    assert_eq!(op_name(operation), op_name(step.operation));
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let content_type = request
        .headers()
        .get("content-type")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_string();
    let accept_sse = request
        .headers()
        .get("accept")
        .is_some_and(|h| h == "text/event-stream");
    let user_agent_present = request.headers().contains_key("user-agent");
    let bytes = axum::body::to_bytes(request.into_body(), 32 * 1024)
        .await
        .unwrap();
    match operation {
        Operation::GoogleToken => {
            assert!(authorization.is_empty(), "refresh must not use bearer auth");
            assert!(content_type.starts_with("application/x-www-form-urlencoded"));
            assert!(bytes.as_ref() == b"grant_type=refresh_token&refresh_token=synthetic-refresh&client_id=synthetic-agy-client-id&client_secret=synthetic-agy-client-secret", "synthetic refresh form contract");
        }
        Operation::LoadCodeAssist => {
            assert!(authorization == format!("Bearer {}", step.access));
            assert!(user_agent_present);
            assert!(content_type.starts_with("application/json"));
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body, json!({"metadata":{"ideType":"ANTIGRAVITY"}}));
        }
        Operation::GenerateContent => {
            assert!(authorization == format!("Bearer {}", step.access));
            assert!(user_agent_present);
            assert!(content_type.starts_with("application/json"));
            assert_eq!(accept_sse, step.stream);
            let body: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(body["project"], PROJECT);
            assert_eq!(body["model"], "fixture-model");
            assert_eq!(body["userAgent"], "antigravity");
            assert_eq!(body["requestType"], "agent");
            assert_eq!(body["request"]["contents"][0]["role"], "user");
            assert_eq!(
                body["request"]["contents"][0]["parts"][0]["text"],
                "fixture-input"
            );
            assert!(body["requestId"]
                .as_str()
                .is_some_and(|s| s.starts_with("agent/")));
            assert!(body["request"]["sessionId"].is_string());
            assert!(body["request"].get("stream").is_none());
        }
    }
    {
        let mut records = fake.records.lock().unwrap();
        let sequence = records.len() + 1;
        records.push(json!({
            "sequence":sequence, "operation":op_name(operation), "method":method,
            "destination":destination, "synthetic_auth_validated":true,
            "synthetic_body_validated":true, "stream_requested":step.stream
        }));
    }
    match step.reply {
        Reply::Json(body) => axum::Json(body).into_response(),
        Reply::Error(status) => (
            StatusCode::from_u16(status).unwrap(),
            "synthetic upstream failure",
        )
            .into_response(),
        Reply::Malformed => (StatusCode::OK, "{synthetic-malformed").into_response(),
        Reply::Stream { hold } => {
            fake.active_streams.fetch_add(1, Ordering::SeqCst);
            let owner = StreamOwner {
                active: fake.active_streams.clone(),
                dropped: fake.dropped_streams.clone(),
            };
            let stream = async_stream::stream! {
                let _owner = owner;
                yield Ok::<Bytes, std::io::Error>(Bytes::from_static(STREAM_BYTES));
                if hold {
                    std::future::pending::<()>().await;
                }
            };
            (
                [("content-type", "text/event-stream")],
                Body::from_stream(stream),
            )
                .into_response()
        }
    }
}

struct OwnedServer {
    address: SocketAddr,
    stop: Option<tokio::sync::oneshot::Sender<()>>,
    task: Option<tokio::task::JoinHandle<()>>,
}

impl OwnedServer {
    fn start(listener: tokio::net::TcpListener, app: axum::Router) -> Self {
        let address = listener.local_addr().unwrap();
        let (stop, stopped) = tokio::sync::oneshot::channel();
        let task = tokio::spawn(async move {
            axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                let _ = stopped.await;
            })
            .await
            .unwrap();
        });
        Self {
            address,
            stop: Some(stop),
            task: Some(task),
        }
    }

    async fn close(&mut self) {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        if let Some(mut task) = self.task.take() {
            match timeout(Duration::from_secs(3), &mut task).await {
                Ok(joined) => joined.expect("owned HTTP server task failed"),
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    panic!("owned HTTP server did not terminate within three seconds");
                }
            }
        }
        let rebound = tokio::net::TcpListener::bind(self.address)
            .await
            .expect("owned listener must be released");
        drop(rebound);
    }
}

impl Drop for OwnedServer {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

struct Harness {
    dir: TempDir,
    store: Store,
    fixture: Arc<Fixture>,
    fake_server: OwnedServer,
    gateway: OwnedServer,
    client: Client,
    key: String,
    admin_requests: AtomicUsize,
    client_inferences: AtomicUsize,
}

impl Harness {
    async fn gateway(
        dir: &std::path::Path,
        store: Store,
        transport: AntigravityTestTransport,
    ) -> OwnedServer {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cfg = crate::config::AppConfig::new(
            "127.0.0.1".into(),
            port,
            Some(dir.to_owned()),
            Some(ADMIN.into()),
            None,
            Some(5),
            Some(false),
            None,
        )
        .unwrap();
        let proxy = ProxyState {
            http: transport.http(),
            store: store.clone(),
            cooldown: CooldownMap::new(),
            rr_counter: Arc::new(AtomicU64::new(0)),
            sse_stall_secs: 5,
            token_saver: false,
            token_saver_max_chars: 2000,
            provider_base_overrides: Vec::new(),
            claude_code: crate::claude_code::ClaudeCode::new(
                Some("/nonexistent-synthetic-claude".into()),
                dir,
                1,
            ),
            cursor_cli: crate::cursor_cli::CursorCli::new(
                Some("/nonexistent-synthetic-cursor".into()),
                dir,
                1,
            ),
            refresh_transport: None,
            agy_transport: Some(transport),
        };
        OwnedServer::start(
            listener,
            crate::server::build_app(crate::server::AppState {
                cfg,
                store,
                proxy,
                sessions: crate::guard::Sessions::default(),
            }),
        )
    }

    async fn new() -> Self {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("thinrouter.db"), None).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let transport = AntigravityTestTransport::loopback(listener.local_addr().unwrap()).unwrap();
        let fixture = Arc::new(Fixture {
            transport: transport.clone(),
            pending: Mutex::new(VecDeque::new()),
            records: Mutex::new(Vec::new()),
            unexpected: AtomicUsize::new(0),
            active_streams: Arc::new(AtomicUsize::new(0)),
            dropped_streams: Arc::new(AtomicUsize::new(0)),
        });
        let fake_server = OwnedServer::start(
            listener,
            axum::Router::new()
                .fallback(fake_endpoint)
                .with_state(fixture.clone()),
        );
        let gateway = Self::gateway(dir.path(), store.clone(), transport).await;
        let mut harness = Self {
            dir,
            store,
            fixture,
            fake_server,
            gateway,
            client: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(1))
                .timeout(Duration::from_secs(12))
                .build()
                .unwrap(),
            key: String::new(),
            admin_requests: AtomicUsize::new(0),
            client_inferences: AtomicUsize::new(0),
        };
        let key = harness
            .admin_json(
                reqwest::Method::POST,
                "/admin/api/keys",
                Some(json!({"name":"fixture-key"})),
            )
            .await;
        harness.key = key["secret"].as_str().unwrap().to_owned();
        harness
    }

    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.gateway.address)
    }

    async fn admin_json(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Value {
        self.admin_requests.fetch_add(1, Ordering::SeqCst);
        let mut request = self
            .client
            .request(method, self.url(path))
            .header("x-admin-token", ADMIN);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.unwrap();
        assert!(
            response.status().is_success(),
            "synthetic admin HTTP request failed"
        );
        response.json().await.unwrap()
    }

    async fn connection(
        &self,
        name: &str,
        cached: bool,
        refresh: bool,
        proactive: bool,
        priced: bool,
    ) -> String {
        let imported = self.admin_json(reqwest::Method::POST, "/admin/api/connections/oauth/import", Some(json!({
            "name":name, "provider":"agy", "access_token":OLD,
            "refresh_token":refresh.then_some("synthetic-refresh"),
            "expires_at":if proactive {"0"} else {"4102444800"},
            "default_model":"fixture-model", "meta":if cached {json!({"project":PROJECT}).to_string()} else {"{}".into()}
        }))).await;
        let connection = &imported["connection"];
        let id = connection["id"].as_str().unwrap().to_owned();
        if priced {
            self.admin_json(
                reqwest::Method::PUT,
                &format!("/admin/api/connections/{id}"),
                Some(json!({
                    "name":name, "base_url":connection["base_url"], "default_model":"fixture-model",
                    "input_price_per_m":2.0, "output_price_per_m":3.0
                })),
            )
            .await;
        }
        id
    }

    async fn route(&self, name: &str, connections: &[&str]) {
        self.admin_json(reqwest::Method::POST, "/admin/api/routes", Some(json!({
            "public_model":name,"strategy":"fallback",
            "targets":connections.iter().map(|id| json!({"connection_id":id,"model_override":"fixture-model"})).collect::<Vec<_>>()
        }))).await;
    }

    fn plan(&self, steps: Vec<Step>) -> usize {
        let mut pending = self.fixture.pending.lock().unwrap();
        assert!(
            pending.is_empty(),
            "previous fixture operation did not occur"
        );
        pending.extend(steps);
        self.fixture.records.lock().unwrap().len()
    }

    fn completed(&self, start: usize, expected: &[&str]) {
        assert!(
            self.fixture.pending.lock().unwrap().is_empty(),
            "expected operation missing"
        );
        let records = self.fixture.records.lock().unwrap();
        let observed: Vec<_> = records[start..]
            .iter()
            .map(|r| r["operation"].as_str().unwrap())
            .collect();
        assert_eq!(observed, expected);
        assert_eq!(self.fixture.unexpected.load(Ordering::SeqCst), 0);
    }

    async fn request(&self, protocol: usize, model: &str, stream: bool) -> reqwest::Response {
        self.client_inferences.fetch_add(1, Ordering::SeqCst);
        let (path, body) = match protocol {
            0 => (
                "/v1/chat/completions",
                json!({"model":model,"stream":stream,"max_tokens":64,"messages":[{"role":"user","content":"fixture-input"}]}),
            ),
            1 => (
                "/v1/messages",
                json!({"model":model,"stream":stream,"max_tokens":64,"messages":[{"role":"user","content":"fixture-input"}]}),
            ),
            _ => (
                "/v1/responses",
                json!({"model":model,"stream":stream,"max_output_tokens":64,"input":"fixture-input"}),
            ),
        };
        self.client
            .post(self.url(path))
            .bearer_auth(&self.key)
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    async fn success(&self, protocol: usize, model: &str) {
        let response = self.request(protocol, model, false).await;
        assert_eq!(response.status(), StatusCode::OK);
        let body: Value = response.json().await.unwrap();
        let text = match protocol {
            0 => body.pointer("/choices/0/message/content"),
            1 => body.pointer("/content/0/text"),
            _ => body.pointer("/output/0/content/0/text"),
        };
        assert_eq!(text.and_then(Value::as_str), Some("fixture-output"));
    }

    async fn usage(&self, model: &str, expected: (Option<i64>, Option<i64>, Option<f64>)) -> Value {
        let sql = rusqlite::Connection::open(self.dir.path().join("thinrouter.db")).unwrap();
        let stored: (i64, Option<i64>, Option<i64>, Option<f64>) = sql.query_row(
            "SELECT id,prompt_tokens,completion_tokens,estimated_cost_usd FROM usage_events WHERE public_model=?1 ORDER BY id DESC LIMIT 1",
            [model], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?))
        ).unwrap();
        assert_eq!((stored.1, stored.2), (expected.0, expected.1));
        match (stored.3, expected.2) {
            (Some(actual), Some(expected)) => assert!((actual - expected).abs() < 1e-12),
            (actual, expected) => assert_eq!(actual, expected),
        }
        let json = self
            .admin_json(reqwest::Method::GET, "/admin/api/usage", None)
            .await;
        let row = json["data"]
            .as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == stored.0)
            .unwrap();
        assert_eq!(row["prompt_tokens"], json!(stored.1));
        assert_eq!(row["completion_tokens"], json!(stored.2));
        assert_eq!(row["estimated_cost_usd"], json!(stored.3));
        self.admin_requests.fetch_add(1, Ordering::SeqCst);
        let csv_response = self
            .client
            .get(self.url("/admin/api/usage/export.csv"))
            .header("x-admin-token", ADMIN)
            .send()
            .await
            .unwrap();
        assert_eq!(csv_response.status(), StatusCode::OK);
        let csv = csv_response.text().await.unwrap();
        // The compared columns precede arbitrary quoted error fields.
        let columns: Vec<_> = csv
            .lines()
            .skip(1)
            .find(|line| line.starts_with(&format!("{},", stored.0)))
            .unwrap()
            .split(',')
            .collect();
        assert_eq!(
            columns[6],
            stored.1.map(|v| v.to_string()).unwrap_or_default()
        );
        assert_eq!(
            columns[7],
            stored.2.map(|v| v.to_string()).unwrap_or_default()
        );
        assert_eq!(
            columns[8],
            stored.3.map(|v| v.to_string()).unwrap_or_default()
        );
        json!({"case":model,"prompt_tokens":stored.1,"completion_tokens":stored.2,"estimated_cost_usd":stored.3,"surfaces":["sqlite","admin_json","admin_csv"]})
    }

    async fn wait_stream_cleanup(&self, expected_dropped: usize) {
        timeout(Duration::from_secs(3), async {
            loop {
                if self.fixture.active_streams.load(Ordering::SeqCst) == 0
                    && self.fixture.dropped_streams.load(Ordering::SeqCst) == expected_dropped
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("owned upstream response body was not released");
    }

    async fn close(mut self) -> Value {
        assert!(self.fixture.pending.lock().unwrap().is_empty());
        assert_eq!(self.fixture.active_streams.load(Ordering::SeqCst), 0);
        self.gateway.close().await;
        self.fake_server.close().await;
        let path = self.dir.path().to_owned();
        let dropped = self.fixture.dropped_streams.load(Ordering::SeqCst);
        drop(self.client);
        drop(self.fixture);
        drop(self.store);
        self.dir.close().unwrap();
        assert!(!path.exists());
        json!({"gateway_task_joined":true,"fake_task_joined":true,"listeners_rebound":true,"active_streams":0,"dropped_streams":dropped,"temporary_data_removed":true})
    }
}

fn response(usage: Option<Value>, wrapped: bool) -> Value {
    let mut body =
        json!({"candidates":[{"content":{"role":"model","parts":[{"text":"fixture-output"}]}}]});
    if let Some(usage) = usage {
        body["usageMetadata"] = usage;
    }
    if wrapped {
        json!({"response":body})
    } else {
        body
    }
}

fn complete() -> Reply {
    Reply::Json(response(
        Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
        true,
    ))
}

fn token_success() -> Reply {
    Reply::Json(
        json!({"access_token":FRESH,"refresh_token":"synthetic-rotated-refresh","expires_in":3600}),
    )
}

fn stage(fake: &Fixture, name: &str, start: usize, cases: usize) -> Value {
    let records = fake.records.lock().unwrap();
    let selected = &records[start..];
    json!({"stage":name,"status":"passed","cases":cases,
        "inference":selected.iter().filter(|r| r["operation"]=="inference").count(),
        "discovery":selected.iter().filter(|r| r["operation"]=="discovery").count(),
        "refresh":selected.iter().filter(|r| r["operation"]=="refresh").count()})
}

/// This test must only be executed after review of the installed transport seam.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ai_http_acceptance() {
    let mut h = Harness::new().await;
    let mut stages = Vec::new();
    let mut usages = Vec::new();
    let unrelated = h
        .admin_json(
            reqwest::Method::POST,
            "/admin/api/connections",
            Some(json!({
                "name":"unrelated_api_key", "api_key":"synthetic-unrelated",
                "base_url":format!("http://{}/v1", h.fake_server.address)
            })),
        )
        .await;
    h.route("unrelated_api_key", &[unrelated["id"].as_str().unwrap()])
        .await;
    let mark = h.plan(Vec::new());
    assert_eq!(
        h.request(0, "unrelated_api_key", false).await.status(),
        StatusCode::BAD_REQUEST
    );
    h.completed(mark, &[]);
    stages.push(stage(
        &h.fixture,
        "sealed_instance_rejects_unrelated_provider",
        mark,
        1,
    ));
    let start = h.fixture.records.lock().unwrap().len();
    let mut buffered_cases = 0;
    for protocol in 0..3 {
        for (shape, wrapped, usage, expected) in [
            (
                "wrapped_complete",
                true,
                Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
                (Some(11), Some(7), Some(0.000043)),
            ),
            (
                "unwrapped_complete",
                false,
                Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
                (Some(11), Some(7), Some(0.000043)),
            ),
            ("missing", false, None, (None, None, None)),
        ] {
            let name = format!("buffered_{protocol}_{shape}");
            let id = h.connection(&name, true, false, false, true).await;
            h.route(&name, &[&id]).await;
            let mark = h.plan(vec![Step::inference(Reply::Json(response(usage, wrapped)))]);
            h.success(protocol, &name).await;
            h.completed(mark, &["inference"]);
            usages.push(h.usage(&name, expected).await);
            buffered_cases += 1;
        }
    }
    for (name, usage, expected, priced) in [
        (
            "explicit_zero",
            json!({"promptTokenCount":0,"candidatesTokenCount":0}),
            (Some(0), Some(0), Some(0.0)),
            true,
        ),
        (
            "partial_input",
            json!({"promptTokenCount":11}),
            (Some(11), None, None),
            true,
        ),
        (
            "partial_output",
            json!({"candidatesTokenCount":7}),
            (None, Some(7), None),
            true,
        ),
        (
            "invalid_counts",
            json!({"promptTokenCount":-1,"candidatesTokenCount":"7"}),
            (None, None, None),
            true,
        ),
        (
            "overflow_counts",
            json!({"promptTokenCount":u64::MAX,"candidatesTokenCount":null}),
            (None, None, None),
            true,
        ),
        (
            "unknown_price",
            json!({"promptTokenCount":11,"candidatesTokenCount":7}),
            (Some(11), Some(7), None),
            false,
        ),
    ] {
        let id = h.connection(name, true, false, false, priced).await;
        h.route(name, &[&id]).await;
        let mark = h.plan(vec![Step::inference(Reply::Json(response(
            Some(usage),
            true,
        )))]);
        h.success(0, name).await;
        h.completed(mark, &["inference"]);
        usages.push(h.usage(name, expected).await);
        buffered_cases += 1;
    }
    stages.push(stage(
        &h.fixture,
        "buffered_conversion_usage",
        start,
        buffered_cases,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    let discovered = h
        .connection("project_discovery", false, false, false, true)
        .await;
    h.route("project_discovery", &[&discovered]).await;
    let mark = h.plan(vec![
        Step::discovery(Reply::Json(json!({"cloudaicompanionProject":PROJECT}))),
        Step::inference(complete()),
    ]);
    h.success(0, "project_discovery").await;
    h.completed(mark, &["discovery", "inference"]);
    let saved = h.store.get_connection(&discovered).unwrap().unwrap();
    let meta: Value = serde_json::from_str(saved.oauth.unwrap().meta.as_deref().unwrap()).unwrap();
    assert_eq!(meta["project"], PROJECT);
    let mark = h.plan(vec![Step::inference(complete())]);
    h.success(2, "project_discovery").await;
    h.completed(mark, &["inference"]);
    for (name, reply) in [
        ("discovery_http_failure", Reply::Error(503)),
        (
            "discovery_malformed",
            Reply::Json(json!({"missing_project":true})),
        ),
    ] {
        let id = h.connection(name, false, false, false, false).await;
        h.route(name, &[&id]).await;
        let mark = h.plan(vec![Step::discovery(reply)]);
        assert_eq!(
            h.request(0, name, false).await.status(),
            StatusCode::BAD_GATEWAY
        );
        h.completed(mark, &["discovery"]);
        assert_eq!(
            h.store
                .get_connection(&id)
                .unwrap()
                .unwrap()
                .oauth
                .unwrap()
                .meta
                .as_deref(),
            Some("{}")
        );
    }
    stages.push(stage(&h.fixture, "project_cache_and_discovery", start, 4));

    let start = h.fixture.records.lock().unwrap().len();
    for (name, proactive, outcome) in [
        ("proactive_success", true, "success"),
        ("proactive_failure", true, "http_failure"),
        ("proactive_malformed", true, "malformed"),
        ("retry_success", false, "success"),
        ("retry_failure", false, "http_failure"),
        ("retry_malformed", false, "malformed"),
        ("retry_second_401", false, "second_401"),
    ] {
        let id = h.connection(name, true, true, proactive, true).await;
        h.route(name, &[&id]).await;
        let before = h.store.get_connection(&id).unwrap().unwrap().oauth.unwrap();
        let refreshed = matches!(outcome, "success" | "second_401");
        let refresh_reply = match outcome {
            "http_failure" => Reply::Error(401),
            "malformed" => Reply::Malformed,
            _ => token_success(),
        };
        let mut steps = Vec::new();
        let mut order = Vec::new();
        if !proactive {
            steps.push(Step::inference(Reply::Error(401)));
            order.push("inference");
        }
        steps.push(Step::refresh(refresh_reply));
        order.push("refresh");
        if proactive || refreshed {
            let mut inference = Step::inference(if outcome == "second_401" {
                Reply::Error(401)
            } else {
                complete()
            });
            if refreshed {
                inference = inference.fresh();
            }
            steps.push(inference);
            order.push("inference");
        }
        let mark = h.plan(steps);
        if proactive || outcome == "success" {
            h.success(0, name).await;
            usages.push(h.usage(name, (Some(11), Some(7), Some(0.000043))).await);
        } else {
            assert_eq!(
                h.request(0, name, false).await.status(),
                StatusCode::UNAUTHORIZED
            );
            usages.push(h.usage(name, (None, None, None)).await);
        }
        h.completed(mark, &order);
        let after = h.store.get_connection(&id).unwrap().unwrap().oauth.unwrap();
        if refreshed {
            assert!(after.access_token == FRESH);
            assert!(after.refresh_token.as_deref() == Some("synthetic-rotated-refresh"));
            assert!(after
                .expires_at
                .as_deref()
                .is_some_and(|s| chrono::DateTime::parse_from_rfc3339(s).is_ok()));
            assert_eq!(after.meta, before.meta);
        } else {
            assert!(after.access_token == before.access_token);
            assert!(after.refresh_token == before.refresh_token);
            assert_eq!(after.expires_at, before.expires_at);
            assert_eq!(after.meta, before.meta);
        }
    }
    stages.push(stage(
        &h.fixture,
        "proactive_and_bounded_401_refresh",
        start,
        7,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    for (name, status, fallback) in [
        ("retryable_fallback", 503, true),
        ("nonretryable_failure", 400, false),
    ] {
        let first = h
            .connection(&format!("{name}_first"), true, false, false, true)
            .await;
        let second = h
            .connection(&format!("{name}_second"), true, false, false, true)
            .await;
        h.route(name, &[&first, &second]).await;
        let mut steps = vec![Step::inference(Reply::Error(status))];
        if fallback {
            steps.push(Step::inference(complete()));
        }
        let mark = h.plan(steps);
        if fallback {
            h.success(1, name).await;
            h.completed(mark, &["inference", "inference"]);
            usages.push(h.usage(name, (Some(11), Some(7), Some(0.000043))).await);
        } else {
            assert_eq!(h.request(1, name, false).await.status().as_u16(), status);
            h.completed(mark, &["inference"]);
            usages.push(h.usage(name, (None, None, None)).await);
        }
        let rows: Vec<_> = h
            .store
            .recent_usage(100)
            .unwrap()
            .into_iter()
            .filter(|r| r.public_model.as_deref() == Some(name))
            .collect();
        assert_eq!(rows.len(), if fallback { 2 } else { 1 });
        let failed = rows.last().unwrap();
        if fallback {
            assert_eq!(rows[0].connection_id.as_deref(), Some(second.as_str()));
        }
        assert_eq!(failed.connection_id.as_deref(), Some(first.as_str()));
        assert_eq!(failed.status, Some(i64::from(status)));
        assert!(
            failed.prompt_tokens.is_none()
                && failed.completion_tokens.is_none()
                && failed.estimated_cost_usd.is_none()
        );
        assert_eq!(failed.error.as_deref(), Some("upstream_attempt_failed"));
    }
    let id = h
        .connection("malformed_inference", true, false, false, true)
        .await;
    h.route("malformed_inference", &[&id]).await;
    let rows_before = h.store.recent_usage(100).unwrap().len();
    let mark = h.plan(vec![Step::inference(Reply::Malformed)]);
    assert_eq!(
        h.request(0, "malformed_inference", false).await.status(),
        StatusCode::BAD_REQUEST
    );
    h.completed(mark, &["inference"]);
    // Observe this legacy gap without requiring future honest accounting to stay absent.
    let malformed_usage_rows = h.store.recent_usage(100).unwrap().len() - rows_before;
    stages.push(stage(&h.fixture, "errors_and_fallback", start, 3));

    let start = h.fixture.records.lock().unwrap().len();
    for protocol in 0..3 {
        let name = format!("stream_passthrough_{protocol}");
        let id = h.connection(&name, true, false, false, true).await;
        h.route(&name, &[&id]).await;
        let mark = h.plan(vec![
            Step::inference(Reply::Stream { hold: false }).streaming()
        ]);
        let reply = h.request(protocol, &name, true).await;
        assert_eq!(reply.status(), StatusCode::OK);
        assert_eq!(reply.bytes().await.unwrap().as_ref(), STREAM_BYTES);
        h.completed(mark, &["inference"]);
        h.wait_stream_cleanup(protocol + 1).await;
        usages.push(h.usage(&name, (None, None, None)).await);
    }
    for (name, cancel) in [("stream_client_drop", true), ("stream_stall", false)] {
        let id = h.connection(name, true, false, false, true).await;
        h.route(name, &[&id]).await;
        let mark = h.plan(vec![
            Step::inference(Reply::Stream { hold: true }).streaming()
        ]);
        let dropped_before = h.fixture.dropped_streams.load(Ordering::SeqCst);
        let reply = h.request(0, name, true).await;
        assert_eq!(reply.status(), StatusCode::OK);
        let mut stream = reply.bytes_stream();
        let mut initial = Vec::new();
        while initial.len() < STREAM_BYTES.len() {
            let chunk = timeout(Duration::from_secs(3), stream.next())
                .await
                .expect("initial stream bytes must arrive")
                .expect("initial stream bytes must not be truncated")
                .unwrap();
            initial.extend_from_slice(&chunk);
        }
        assert_eq!(initial, STREAM_BYTES);
        assert_eq!(h.fixture.active_streams.load(Ordering::SeqCst), 1);
        if cancel {
            drop(stream);
        } else {
            let terminal = timeout(Duration::from_secs(8), stream.next())
                .await
                .expect("existing five-second stall must terminate the HTTP body");
            assert!(
                terminal.is_none_or(|chunk| chunk.is_err()),
                "passthrough stall is an HTTP body error"
            );
            drop(stream);
        }
        h.wait_stream_cleanup(dropped_before + 1).await;
        h.completed(mark, &["inference"]);
        usages.push(h.usage(name, (None, None, None)).await);
    }
    let id = h
        .connection("stream_upstream_failure", true, false, false, true)
        .await;
    h.route("stream_upstream_failure", &[&id]).await;
    let mark = h.plan(vec![Step::inference(Reply::Error(503)).streaming()]);
    assert_eq!(
        h.request(2, "stream_upstream_failure", true).await.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    h.completed(mark, &["inference"]);
    usages.push(h.usage("stream_upstream_failure", (None, None, None)).await);
    stages.push(stage(
        &h.fixture,
        "existing_stream_passthrough_and_cleanup",
        start,
        6,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    let history_before = serde_json::to_value(h.store.recent_usage(100).unwrap()).unwrap();
    let routes_before = serde_json::to_value(h.store.list_routes().unwrap()).unwrap();
    let keys_before = serde_json::to_value(h.store.list_api_keys().unwrap()).unwrap();
    h.gateway.close().await;
    h.store = Store::open(&h.dir.path().join("thinrouter.db"), None).unwrap();
    h.gateway = Harness::gateway(h.dir.path(), h.store.clone(), h.fixture.transport.clone()).await;
    assert_eq!(
        serde_json::to_value(h.store.recent_usage(100).unwrap()).unwrap(),
        history_before
    );
    assert_eq!(
        serde_json::to_value(h.store.list_routes().unwrap()).unwrap(),
        routes_before
    );
    assert_eq!(
        serde_json::to_value(h.store.list_api_keys().unwrap()).unwrap(),
        keys_before
    );
    let admin_history = h
        .admin_json(reqwest::Method::GET, "/admin/api/usage", None)
        .await;
    assert_eq!(admin_history["data"], history_before);
    assert_eq!(
        h.fixture.records.lock().unwrap().len(),
        start,
        "restart/read must not replay inference"
    );
    let mark = h.plan(vec![Step::inference(complete())]);
    h.success(2, "project_discovery").await;
    h.completed(mark, &["inference"]);
    usages.push(
        h.usage("project_discovery", (Some(11), Some(7), Some(0.000043)))
            .await,
    );
    stages.push(stage(
        &h.fixture,
        "reopen_preserves_history_without_replay",
        start,
        1,
    ));

    let records = h.fixture.records.lock().unwrap().clone();
    let counts = json!({
        "inference":records.iter().filter(|r| r["operation"]=="inference").count(),
        "discovery":records.iter().filter(|r| r["operation"]=="discovery").count(),
        "refresh":records.iter().filter(|r| r["operation"]=="refresh").count(),
        "unexpected_destinations":h.fixture.unexpected.load(Ordering::SeqCst),
        "client_inference_requests":h.client_inferences.load(Ordering::SeqCst),
        "admin_http_requests":h.admin_requests.load(Ordering::SeqCst)
    });
    let observed_usage_rows = h.store.recent_usage(100).unwrap().len();
    let cleanup = h.close().await;
    let report = json!({
        "schema_version":1,"test":"proxy::agy_http_tests::ai_http_acceptance","status":"passed",
        "transport":"sealed_test_only_loopback_nonforwarding_proxy","actual_gateway_http":true,
        "stages":stages,"counts":counts,"destinations":records,"usage":usages,
        "observed_usage_rows":observed_usage_rows,"malformed_success_usage_rows":malformed_usage_rows,
        "cleanup":cleanup,
        "gaps":["synthetic offline acceptance only; no real client/version/provider validation",
            "stream=true uses generateContent and opaque byte passthrough for all three client APIs",
            "Antigravity has no native stream conversion or durable stream attempt/terminal accounting",
            "legacy successful-header stream rows do not establish terminal success or measured usage",
            "admin refresh, refresh-all, connection probe and host credential import are excluded",
            "malformed buffered-success accounting is observed without a completeness claim",
            "enumerated application transport confinement is not a machine-wide egress claim"]
    });
    println!("\nANTIGRAVITY_HTTP_REPORT={report}");
}

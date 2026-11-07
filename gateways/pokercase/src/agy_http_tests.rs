//! Actual gateway HTTP acceptance with a sealed, non-forwarding Antigravity fixture.
//! This module is test-only. No provider credentials, environment configuration,
//! production refresh entrypoints, or native provider traffic are used here.
use super::*;
use crate::antigravity_test_transport::{AntigravityTestTransport, Operation};
use axum::extract::{Request, State};
use std::collections::{HashSet, VecDeque};
use std::net::SocketAddr;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use std::sync::Mutex;
use tempfile::TempDir;

const ADMIN: &str = "synthetic-admin";
const OLD: &str = "synthetic-access";
const FRESH: &str = "synthetic-fresh-access";
const PROJECT: &str = "synthetic-project";
const STREAM_BYTES: &[u8] = b"event: synthetic\ndata: {\"fixture\":true}\n\ndata: [DONE]\n\n";
const OPAQUE_BYTES: &[u8] = b"data: {\"choices\":[{\"delta\":{\"content\":\"synthetic\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":123,\"completion_tokens\":456}}\n\ndata: [DONE]\n\n";

enum StreamEnd {
    Eof,
    Hold,
    ReadError,
}

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
    Opaque(StreamEnd),
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
    body_release: Arc<tokio::sync::Notify>,
    store: Store,
    witness_reservations: AtomicBool,
    reserved_attempts: Mutex<Vec<String>>,
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
    if fake.witness_reservations.load(Ordering::SeqCst) {
        let pending: Vec<_> = fake
            .store
            .recent_usage(1000)
            .unwrap()
            .into_iter()
            .filter(|row| row.finalized_at.is_none())
            .collect();
        if operation == Operation::GenerateContent {
            assert_eq!(
                pending.len(),
                1,
                "one reservation must exist before inference reaches the fixture"
            );
            assert!(pending[0].request_id.is_some());
            assert!(pending[0].status.is_none());
            fake.reserved_attempts
                .lock()
                .unwrap()
                .push(pending[0].attempt_id.clone().unwrap());
        } else {
            assert!(
                pending.is_empty(),
                "discovery and refresh must not create inference attempts"
            );
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
        Reply::Stream { hold } => fixture_stream(
            &fake,
            STREAM_BYTES,
            if hold {
                StreamEnd::Hold
            } else {
                StreamEnd::Eof
            },
        ),
        Reply::Opaque(end) => fixture_stream(&fake, OPAQUE_BYTES, end),
    }
}

fn fixture_stream(fake: &Fixture, bytes: &'static [u8], end: StreamEnd) -> Response {
    fake.active_streams.fetch_add(1, Ordering::SeqCst);
    let owner = StreamOwner {
        active: fake.active_streams.clone(),
        dropped: fake.dropped_streams.clone(),
    };
    let release = fake.body_release.clone();
    let stream = async_stream::stream! {
        let _owner = owner;
        yield Ok::<Bytes, std::io::Error>(Bytes::from_static(bytes));
        match end {
            StreamEnd::Eof => {},
            StreamEnd::Hold => std::future::pending::<()>().await,
            StreamEnd::ReadError => {
                release.notified().await;
                yield Err(std::io::Error::other("synthetic body read failure"));
            }
        }
    };
    (
        [("content-type", "text/event-stream")],
        Body::from_stream(stream),
    )
        .into_response()
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
            body_release: Arc::new(tokio::sync::Notify::new()),
            store: store.clone(),
            witness_reservations: AtomicBool::new(false),
            reserved_attempts: Mutex::new(Vec::new()),
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
    // Preserve this characterization's observed delta; AS-2 separately requires
    // one durable failed attempt for a malformed successful upstream response.
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
            "Antigravity has no native stream conversion; opaque bytes do not establish semantic completion",
            "successful headers and opaque EOF do not establish terminal success or measured usage",
            "admin refresh, refresh-all, connection probe and host credential import are excluded",
            "malformed buffered-success durability is separately checked by settlement acceptance",
            "enumerated application transport confinement is not a machine-wide egress claim"]
    });
    println!("\nANTIGRAVITY_HTTP_REPORT={report}");
}

/// AS-2 actual HTTP regression: a dispatched malformed success must not disappear.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn as2_malformed_success_has_durable_failed_attempt() {
    let h = Harness::new().await;
    let id = h
        .connection("as2_malformed", true, false, false, true)
        .await;
    h.route("as2_malformed", &[&id]).await;
    h.fixture
        .pending
        .lock()
        .unwrap()
        .push_back(Step::inference(Reply::Malformed));
    let response = h.request(0, "as2_malformed", false).await;
    let status = response.status();
    let _ = response.bytes().await.unwrap();
    let rows = h.store.recent_usage(100).unwrap();
    let dispatches = h.fixture.records.lock().unwrap().len();
    let cleanup = h.close().await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(dispatches, 1);
    assert_eq!(cleanup["active_streams"], 0);
    assert_eq!(
        rows.len(),
        1,
        "AS2 dispatched malformed HTTP200 must persist one failed attempt"
    );
    assert!(rows[0].attempt_id.is_some());
    assert_eq!(rows[0].status, Some(200));
    assert_eq!(rows[0].outcome, "failed");
    assert!(rows[0].finalized_at.is_some());
}

const BUFFERED_SOURCE: &str = "antigravity_generate_content_v1";
const OPAQUE_SOURCE: &str = "antigravity_opaque_v1";

fn settlement_response(usage: Option<Value>, wrapped: bool, reason: Option<&str>) -> Reply {
    let mut body = response(usage, wrapped);
    if let Some(reason) = reason {
        let candidate = if wrapped {
            &mut body["response"]["candidates"][0]
        } else {
            &mut body["candidates"][0]
        };
        candidate["finishReason"] = json!(reason);
    }
    Reply::Json(body)
}

fn settled_success() -> Reply {
    settlement_response(
        Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
        true,
        Some("STOP"),
    )
}

fn rows_for(h: &Harness, model: &str) -> Vec<crate::store::UsageEvent> {
    let mut rows: Vec<_> = h
        .store
        .recent_usage(1000)
        .unwrap()
        .into_iter()
        .filter(|row| row.public_model.as_deref() == Some(model))
        .collect();
    rows.reverse();
    rows
}

async fn settled_rows(h: &Harness, model: &str, count: usize) -> Vec<crate::store::UsageEvent> {
    timeout(Duration::from_secs(3), async {
        loop {
            let rows = rows_for(h, model);
            assert!(
                rows.len() <= count,
                "an inference must not acquire duplicate accounting rows"
            );
            if rows.len() == count && rows.iter().all(|r| r.finalized_at.is_some()) {
                break rows;
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("actual HTTP attempt did not settle")
}

fn assert_attempt(
    row: &crate::store::UsageEvent,
    source: &str,
    status: i64,
    outcome: &str,
    usage: &str,
) {
    assert!(row.request_id.as_deref().is_some_and(|id| !id.is_empty()));
    assert!(row.attempt_id.as_deref().is_some_and(|id| !id.is_empty()));
    assert!(row.finalized_at.is_some());
    assert_eq!(row.usage_source, source);
    assert_eq!(row.status, Some(status));
    assert_eq!(row.outcome, outcome);
    assert_eq!(row.usage_status, usage);
    assert!(
        row.first_output_ms.is_none(),
        "buffer completion and opaque bytes are not semantic TTFT"
    );
    assert!(row.headers_ms.is_some());
    assert!(row.total_observed_ms.is_some());
    assert!(row.headers_ms.unwrap() <= row.total_observed_ms.unwrap());
}

fn assert_group(rows: &[crate::store::UsageEvent]) {
    assert!(!rows.is_empty());
    let request = rows[0].request_id.as_ref().unwrap();
    let mut ids = HashSet::new();
    for row in rows {
        assert_eq!(row.request_id.as_ref(), Some(request));
        assert!(
            ids.insert(row.attempt_id.as_ref().unwrap()),
            "retry/fallback must reserve a distinct attempt"
        );
    }
}

fn attempt_report(row: &crate::store::UsageEvent) -> Value {
    json!({
        "case":row.public_model,"attempt_id":row.attempt_id,"request_id":row.request_id,
        "status":row.status,"outcome":row.outcome,"usage_status":row.usage_status,
        "usage_source":row.usage_source,"finalized_at":row.finalized_at,
        "prompt_tokens":row.prompt_tokens,"completion_tokens":row.completion_tokens,
        "estimated_cost_usd":row.estimated_cost_usd,"headers_ms":row.headers_ms,
        "first_output_ms":row.first_output_ms,"total_observed_ms":row.total_observed_ms,
        "error":row.error
    })
}

async fn reconcile_attempt_surfaces(h: &Harness) {
    let rows = h.store.recent_usage(1000).unwrap();
    let admin = h
        .admin_json(reqwest::Method::GET, "/admin/api/usage", None)
        .await;
    assert_eq!(admin["data"], serde_json::to_value(&rows).unwrap());
    h.admin_requests.fetch_add(1, Ordering::SeqCst);
    let response = h
        .client
        .get(h.url("/admin/api/usage/export.csv"))
        .header("x-admin-token", ADMIN)
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let csv = response.text().await.unwrap();
    let mut lines = csv.lines();
    let columns: Vec<_> = lines.next().unwrap().split(',').collect();
    let exported: Vec<_> = lines.collect();
    assert_eq!(exported.len(), rows.len());
    let sql = rusqlite::Connection::open(h.dir.path().join("thinrouter.db")).unwrap();
    let fields = [
        "attempt_id",
        "request_id",
        "status",
        "outcome",
        "usage_status",
        "usage_source",
        "finalized_at",
        "prompt_tokens",
        "completion_tokens",
        "estimated_cost_usd",
        "headers_ms",
        "first_output_ms",
        "total_observed_ms",
        "error",
    ];
    for row in &rows {
        let raw: Value = sql.query_row(
            "SELECT attempt_id,request_id,status,outcome,usage_status,usage_source,finalized_at,
                    prompt_tokens,completion_tokens,estimated_cost_usd,headers_ms,first_output_ms,
                    total_observed_ms,error FROM usage_events WHERE id=?1",
            [row.id], |r| Ok(json!({
                "attempt_id":r.get::<_,Option<String>>(0)?,"request_id":r.get::<_,Option<String>>(1)?,
                "status":r.get::<_,Option<i64>>(2)?,"outcome":r.get::<_,String>(3)?,
                "usage_status":r.get::<_,String>(4)?,"usage_source":r.get::<_,String>(5)?,
                "finalized_at":r.get::<_,Option<String>>(6)?,"prompt_tokens":r.get::<_,Option<i64>>(7)?,
                "completion_tokens":r.get::<_,Option<i64>>(8)?,"estimated_cost_usd":r.get::<_,Option<f64>>(9)?,
                "headers_ms":r.get::<_,Option<i64>>(10)?,"first_output_ms":r.get::<_,Option<i64>>(11)?,
                "total_observed_ms":r.get::<_,Option<i64>>(12)?,"error":r.get::<_,Option<String>>(13)?
            }))
        ).unwrap();
        let report = attempt_report(row);
        let line = exported
            .iter()
            .find(|line| line.starts_with(&format!("{},", row.id)))
            .unwrap();
        // Every selected text field is a fixed code, synthetic UUID, or timestamp.
        // None contains CSV commas/newlines; arbitrary upstream error text is excluded.
        let values: Vec<_> = line.split(',').collect();
        for field in fields {
            assert_eq!(
                raw[field], report[field],
                "SQLite adapter mismatch for {field}"
            );
            let expected = match &raw[field] {
                Value::Null => String::new(),
                Value::String(value) => value.clone(),
                value => value.to_string(),
            };
            let index = columns.iter().position(|name| *name == field).unwrap();
            let actual = values[index].trim_matches('"');
            if field == "estimated_cost_usd" && !expected.is_empty() {
                assert!(
                    (actual.parse::<f64>().unwrap() - raw[field].as_f64().unwrap()).abs() < 1e-12
                );
            } else {
                assert_eq!(actual, expected, "CSV adapter mismatch for {field}");
            }
        }
    }
}

/// AS-1–AS-5: run only after the existing closed transport proof passes.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn as_http_settlement_acceptance() {
    let mut h = Harness::new().await;
    h.fixture.witness_reservations.store(true, Ordering::SeqCst);
    let mut stages = Vec::new();
    let mut usage = Vec::new();

    let start = h.fixture.records.lock().unwrap().len();
    let mut buffered_cases = 0;
    for protocol in 0..3 {
        for (label, reason, outcome) in [
            ("stop", Some("STOP"), "succeeded"),
            ("max_tokens", Some("MAX_TOKENS"), "incomplete"),
            ("missing_terminal", None, "unknown"),
            ("unsupported_terminal", Some("UNRECOGNIZED"), "unknown"),
        ] {
            let name = format!("as_buffered_{protocol}_{label}");
            let id = h.connection(&name, true, false, false, true).await;
            h.route(&name, &[&id]).await;
            let mark = h.plan(vec![Step::inference(settlement_response(
                Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
                protocol != 1,
                reason,
            ))]);
            h.success(protocol, &name).await;
            h.completed(mark, &["inference"]);
            let rows = settled_rows(&h, &name, 1).await;
            assert_attempt(&rows[0], BUFFERED_SOURCE, 200, outcome, "complete");
            assert!(rows[0].error.is_none());
            usage.push(h.usage(&name, (Some(11), Some(7), Some(0.000043))).await);
            buffered_cases += 1;
        }
    }
    for (name, counters, expected, quality, priced) in [
        (
            "as_missing_usage",
            None,
            (None, None, None),
            "missing",
            true,
        ),
        (
            "as_partial_usage",
            Some(json!({"promptTokenCount":11})),
            (Some(11), None, None),
            "partial",
            true,
        ),
        (
            "as_zero_usage",
            Some(json!({"promptTokenCount":0,"candidatesTokenCount":0})),
            (Some(0), Some(0), Some(0.0)),
            "complete",
            true,
        ),
        (
            "as_negative_usage",
            Some(json!({"promptTokenCount":-1,"candidatesTokenCount":7})),
            (None, Some(7), None),
            "invalid",
            true,
        ),
        (
            "as_type_usage",
            Some(json!({"promptTokenCount":11,"candidatesTokenCount":"7"})),
            (Some(11), None, None),
            "invalid",
            true,
        ),
        (
            "as_overflow_usage",
            Some(json!({"promptTokenCount":u64::MAX,"candidatesTokenCount":null})),
            (None, None, None),
            "invalid",
            true,
        ),
        (
            "as_unknown_price",
            Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
            (Some(11), Some(7), None),
            "complete",
            false,
        ),
    ] {
        let id = h.connection(name, true, false, false, priced).await;
        h.route(name, &[&id]).await;
        let mark = h.plan(vec![Step::inference(settlement_response(
            counters,
            true,
            Some("STOP"),
        ))]);
        h.success(0, name).await;
        h.completed(mark, &["inference"]);
        let rows = settled_rows(&h, name, 1).await;
        assert_attempt(&rows[0], BUFFERED_SOURCE, 200, "succeeded", quality);
        assert_eq!(
            rows[0].error.as_deref(),
            if quality == "invalid" {
                Some("stream_invalid_usage")
            } else {
                None
            }
        );
        usage.push(h.usage(name, expected).await);
        buffered_cases += 1;
    }
    let name = "as_ambiguous_candidates";
    let id = h.connection(name, true, false, false, true).await;
    h.route(name, &[&id]).await;
    let mut ambiguous = response(
        Some(json!({"promptTokenCount":11,"candidatesTokenCount":7})),
        true,
    );
    ambiguous["response"]["candidates"][0]["finishReason"] = json!("STOP");
    let candidate = ambiguous["response"]["candidates"][0].clone();
    ambiguous["response"]["candidates"]
        .as_array_mut()
        .unwrap()
        .push(candidate);
    let mark = h.plan(vec![Step::inference(Reply::Json(ambiguous))]);
    h.success(0, name).await;
    h.completed(mark, &["inference"]);
    let rows = settled_rows(&h, name, 1).await;
    assert_attempt(&rows[0], BUFFERED_SOURCE, 200, "unknown", "complete");
    usage.push(h.usage(name, (Some(11), Some(7), Some(0.000043))).await);
    buffered_cases += 1;
    stages.push(stage(
        &h.fixture,
        "buffered_raw_usage_and_terminal",
        start,
        buffered_cases,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    let discovered = h
        .connection("as_discovery", false, false, false, true)
        .await;
    h.route("as_discovery", &[&discovered]).await;
    let mark = h.plan(vec![
        Step::discovery(Reply::Json(json!({"cloudaicompanionProject":PROJECT}))),
        Step::inference(settled_success()),
    ]);
    h.success(0, "as_discovery").await;
    h.completed(mark, &["discovery", "inference"]);
    let mark = h.plan(vec![Step::inference(settled_success())]);
    h.success(2, "as_discovery").await;
    h.completed(mark, &["inference"]);
    let rows = settled_rows(&h, "as_discovery", 2).await;
    assert_ne!(rows[0].request_id, rows[1].request_id);
    for row in &rows {
        assert_attempt(row, BUFFERED_SOURCE, 200, "succeeded", "complete");
    }
    let id = h
        .connection("as_discovery_failure", false, false, false, false)
        .await;
    h.route("as_discovery_failure", &[&id]).await;
    let mark = h.plan(vec![Step::discovery(Reply::Error(503))]);
    assert_eq!(
        h.request(0, "as_discovery_failure", false).await.status(),
        StatusCode::BAD_GATEWAY
    );
    h.completed(mark, &["discovery"]);
    assert!(
        rows_for(&h, "as_discovery_failure").is_empty(),
        "preflight failure is not inference"
    );
    for (name, proactive, refresh_success, second_401) in [
        ("as_proactive", true, true, false),
        ("as_retry", false, true, false),
        ("as_refresh_failure", false, false, false),
        ("as_retry_bound", false, true, true),
    ] {
        let id = h.connection(name, true, true, proactive, true).await;
        h.route(name, &[&id]).await;
        let mut steps = Vec::new();
        let mut order = Vec::new();
        if !proactive {
            steps.push(Step::inference(Reply::Error(401)));
            order.push("inference");
        }
        steps.push(Step::refresh(if refresh_success {
            token_success()
        } else {
            Reply::Error(401)
        }));
        order.push("refresh");
        if refresh_success {
            steps.push(
                Step::inference(if second_401 {
                    Reply::Error(401)
                } else {
                    settled_success()
                })
                .fresh(),
            );
            order.push("inference");
        }
        let mark = h.plan(steps);
        if refresh_success && !second_401 {
            h.success(1, name).await;
        } else {
            assert_eq!(
                h.request(1, name, false).await.status(),
                StatusCode::UNAUTHORIZED
            );
        }
        h.completed(mark, &order);
        let count = order.iter().filter(|op| **op == "inference").count();
        let rows = settled_rows(&h, name, count).await;
        assert_group(&rows);
        for (index, row) in rows.iter().enumerate() {
            let successful = refresh_success && !second_401 && index == rows.len() - 1;
            assert_attempt(
                row,
                BUFFERED_SOURCE,
                if successful { 200 } else { 401 },
                if successful { "succeeded" } else { "failed" },
                if successful { "complete" } else { "missing" },
            );
            assert_eq!(
                row.error.as_deref(),
                if successful {
                    None
                } else {
                    Some("upstream_attempt_failed")
                }
            );
        }
    }
    stages.push(stage(
        &h.fixture,
        "discovery_refresh_and_legal_retry",
        start,
        7,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    for protocol in 0..3 {
        let name = format!("as_malformed_{protocol}");
        let id = h.connection(&name, true, false, false, true).await;
        h.route(&name, &[&id]).await;
        let mark = h.plan(vec![Step::inference(Reply::Malformed)]);
        let response = h.request(protocol, &name, false).await;
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let _ = response.bytes().await.unwrap();
        h.completed(mark, &["inference"]);
        let rows = settled_rows(&h, &name, 1).await;
        assert_attempt(&rows[0], BUFFERED_SOURCE, 200, "failed", "invalid");
        assert_eq!(rows[0].error.as_deref(), Some("stream_conversion_failed"));
        usage.push(h.usage(&name, (None, None, None)).await);
    }
    for (name, status, fallback) in [("as_fallback", 503, true), ("as_nonretryable", 400, false)] {
        let first = h
            .connection(&format!("{name}_first"), true, false, false, true)
            .await;
        let second = h
            .connection(&format!("{name}_second"), true, false, false, true)
            .await;
        h.route(name, &[&first, &second]).await;
        let mut steps = vec![Step::inference(Reply::Error(status))];
        if fallback {
            steps.push(Step::inference(settled_success()));
        }
        let mark = h.plan(steps);
        if fallback {
            h.success(2, name).await;
        } else {
            assert_eq!(h.request(2, name, false).await.status().as_u16(), status);
        }
        h.completed(
            mark,
            if fallback {
                &["inference", "inference"]
            } else {
                &["inference"]
            },
        );
        let rows = settled_rows(&h, name, if fallback { 2 } else { 1 }).await;
        assert_group(&rows);
        assert_attempt(
            &rows[0],
            BUFFERED_SOURCE,
            i64::from(status),
            "failed",
            "missing",
        );
        assert_eq!(rows[0].connection_id.as_deref(), Some(first.as_str()));
        assert_eq!(rows[0].error.as_deref(), Some("upstream_attempt_failed"));
        if fallback {
            assert_attempt(&rows[1], BUFFERED_SOURCE, 200, "succeeded", "complete");
            assert_eq!(rows[1].connection_id.as_deref(), Some(second.as_str()));
        }
    }
    let name = "as_buffered_read_failure";
    let id = h.connection(name, true, false, false, true).await;
    h.route(name, &[&id]).await;
    let dropped = h.fixture.dropped_streams.load(Ordering::SeqCst);
    let mark = h.plan(vec![Step::inference(Reply::Opaque(StreamEnd::ReadError))]);
    // The server releases its failing body only after the gateway has durably
    // observed HTTP200; this avoids a race with headers without a timing sleep.
    let (response, ()) = tokio::join!(h.request(0, name, false), async {
        timeout(Duration::from_secs(3), async {
            loop {
                if rows_for(&h, name)
                    .first()
                    .is_some_and(|r| r.status == Some(200))
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("buffered read failure must occur after observed headers");
        h.fixture.body_release.notify_one();
    });
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let _ = response.bytes().await.unwrap();
    h.completed(mark, &["inference"]);
    h.wait_stream_cleanup(dropped + 1).await;
    let rows = settled_rows(&h, name, 1).await;
    assert_attempt(&rows[0], BUFFERED_SOURCE, 200, "failed", "missing");
    assert_eq!(rows[0].error.as_deref(), Some("upstream_transport_error"));
    stages.push(stage(
        &h.fixture,
        "failed_conversion_transport_and_fallback",
        start,
        6,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    for protocol in 0..3 {
        let name = format!("as_opaque_eof_{protocol}");
        let id = h.connection(&name, true, false, false, true).await;
        h.route(&name, &[&id]).await;
        let dropped = h.fixture.dropped_streams.load(Ordering::SeqCst);
        let mark = h.plan(vec![
            Step::inference(Reply::Opaque(StreamEnd::Eof)).streaming()
        ]);
        let response = h.request(protocol, &name, true).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.bytes().await.unwrap().as_ref(), OPAQUE_BYTES);
        h.completed(mark, &["inference"]);
        h.wait_stream_cleanup(dropped + 1).await;
        let rows = settled_rows(&h, &name, 1).await;
        assert_attempt(&rows[0], OPAQUE_SOURCE, 200, "unknown", "unknown");
        assert!(rows[0].error.is_none());
        usage.push(h.usage(&name, (None, None, None)).await);
    }
    for (name, outcome, error) in [
        ("as_opaque_drop", "cancelled", "stream_cancelled"),
        ("as_opaque_unpolled_drop", "cancelled", "stream_cancelled"),
        ("as_opaque_stall", "timeout", "stream_timeout"),
        (
            "as_opaque_read_failure",
            "failed",
            "upstream_transport_error",
        ),
    ] {
        let id = h.connection(name, true, false, false, true).await;
        h.route(name, &[&id]).await;
        let dropped = h.fixture.dropped_streams.load(Ordering::SeqCst);
        let end = if outcome == "failed" {
            StreamEnd::ReadError
        } else {
            StreamEnd::Hold
        };
        let mark = h.plan(vec![Step::inference(Reply::Opaque(end)).streaming()]);
        let response = h.request(0, name, true).await;
        assert_eq!(response.status(), StatusCode::OK);
        if name == "as_opaque_unpolled_drop" {
            drop(response);
        } else {
            let mut stream = response.bytes_stream();
            let mut bytes = Vec::new();
            while bytes.len() < OPAQUE_BYTES.len() {
                let chunk = timeout(Duration::from_secs(3), stream.next())
                    .await
                    .unwrap()
                    .unwrap()
                    .unwrap();
                bytes.extend_from_slice(&chunk);
            }
            assert_eq!(bytes, OPAQUE_BYTES);
            assert_eq!(h.fixture.active_streams.load(Ordering::SeqCst), 1);
            if outcome != "cancelled" {
                if outcome == "failed" {
                    h.fixture.body_release.notify_one();
                }
                let terminal = timeout(Duration::from_secs(8), stream.next())
                    .await
                    .expect("opaque body must terminate after controlled error/stall");
                assert!(terminal.is_none_or(|chunk| chunk.is_err()));
            }
            drop(stream);
        }
        h.wait_stream_cleanup(dropped + 1).await;
        h.completed(mark, &["inference"]);
        let rows = settled_rows(&h, name, 1).await;
        assert_attempt(&rows[0], OPAQUE_SOURCE, 200, outcome, "unknown");
        assert_eq!(rows[0].error.as_deref(), Some(error));
        usage.push(h.usage(name, (None, None, None)).await);
    }
    let name = "as_opaque_http_failure";
    let id = h.connection(name, true, false, false, true).await;
    h.route(name, &[&id]).await;
    let mark = h.plan(vec![Step::inference(Reply::Error(503)).streaming()]);
    assert_eq!(
        h.request(1, name, true).await.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    h.completed(mark, &["inference"]);
    let rows = settled_rows(&h, name, 1).await;
    assert_attempt(&rows[0], OPAQUE_SOURCE, 503, "failed", "unknown");
    assert_eq!(rows[0].error.as_deref(), Some("upstream_attempt_failed"));
    usage.push(h.usage(name, (None, None, None)).await);
    stages.push(stage(
        &h.fixture,
        "opaque_bytes_and_explicit_lifecycle",
        start,
        8,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    let first = h
        .connection("as_reserve_first", true, false, false, true)
        .await;
    let second = h
        .connection("as_reserve_second", true, false, false, true)
        .await;
    h.route("as_reservation_failure", &[&first, &second]).await;
    let sql = rusqlite::Connection::open(h.dir.path().join("thinrouter.db")).unwrap();
    sql.execute_batch("CREATE TRIGGER as_fail_reservation BEFORE INSERT ON usage_events WHEN NEW.public_model='as_reservation_failure' BEGIN SELECT RAISE(FAIL,'synthetic reservation failure'); END;").unwrap();
    let mark = h.plan(Vec::new());
    assert_eq!(
        h.request(0, "as_reservation_failure", false).await.status(),
        StatusCode::SERVICE_UNAVAILABLE
    );
    h.completed(mark, &[]);
    assert!(rows_for(&h, "as_reservation_failure").is_empty());
    sql.execute_batch("DROP TRIGGER as_fail_reservation;")
        .unwrap();
    let name = "as_finalization_failure";
    let id = h.connection(name, true, false, false, true).await;
    h.route(name, &[&id]).await;
    sql.execute_batch("CREATE TRIGGER as_fail_finalization BEFORE UPDATE OF finalized_at ON usage_events WHEN OLD.public_model='as_finalization_failure' BEGIN SELECT RAISE(FAIL,'synthetic finalization failure'); END;").unwrap();
    let mark = h.plan(vec![Step::inference(settled_success())]);
    h.success(0, name).await;
    h.completed(mark, &["inference"]);
    let pending = rows_for(&h, name);
    assert_eq!(pending.len(), 1);
    assert!(pending[0].finalized_at.is_none());
    assert_eq!(pending[0].status, Some(200));
    assert_eq!(pending[0].usage_source, BUFFERED_SOURCE);
    assert!(pending[0].prompt_tokens.is_none() && pending[0].completion_tokens.is_none());
    sql.execute_batch("DROP TRIGGER as_fail_finalization;")
        .unwrap();
    drop(sql);
    stages.push(stage(
        &h.fixture,
        "storage_failure_without_redispatch",
        start,
        2,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    let seed = h
        .store
        .begin_stream_attempt_with_source(
            "synthetic-recovery-request",
            "as_seeded_recovery",
            &discovered,
            "fixture-model",
            BUFFERED_SOURCE,
        )
        .unwrap();
    let history: Vec<_> = h
        .store
        .recent_usage(1000)
        .unwrap()
        .into_iter()
        .filter(|r| r.finalized_at.is_some())
        .map(|r| (r.id, serde_json::to_value(r).unwrap()))
        .collect();
    let routes_before = serde_json::to_value(h.store.list_routes().unwrap()).unwrap();
    let keys_before = serde_json::to_value(h.store.list_api_keys().unwrap()).unwrap();
    h.gateway.close().await;
    let usage_owner = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(h.dir.path().join("thinrouter.usage-lock"))
        .unwrap();
    usage_owner.try_lock().unwrap();
    h.store = Store::open(&h.dir.path().join("thinrouter.db"), None).unwrap();
    assert_eq!(
        h.store
            .recent_usage(1000)
            .unwrap()
            .iter()
            .filter(|r| r.finalized_at.is_none())
            .count(),
        2,
        "Store::open alone must not recover live attempts"
    );
    assert_eq!(h.store.recover_stream_attempts().unwrap(), 2);
    let recovered = serde_json::to_value(h.store.recent_usage(1000).unwrap()).unwrap();
    assert_eq!(h.store.recover_stream_attempts().unwrap(), 0);
    assert_eq!(
        serde_json::to_value(h.store.recent_usage(1000).unwrap()).unwrap(),
        recovered
    );
    let after = h.store.recent_usage(1000).unwrap();
    for (id, before) in history {
        assert_eq!(
            serde_json::to_value(after.iter().find(|r| r.id == id).unwrap()).unwrap(),
            before
        );
    }
    for name in ["as_seeded_recovery", "as_finalization_failure"] {
        let rows = rows_for(&h, name);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].outcome, "interrupted");
        assert_eq!(rows[0].usage_status, "missing");
        assert_eq!(rows[0].error.as_deref(), Some("stream_interrupted"));
        assert!(rows[0].finalized_at.is_some());
        assert!(
            rows[0].prompt_tokens.is_none()
                && rows[0].completion_tokens.is_none()
                && rows[0].estimated_cost_usd.is_none()
        );
        assert!(rows[0].first_output_ms.is_none() && rows[0].total_observed_ms.is_none());
    }
    h.gateway = Harness::gateway(h.dir.path(), h.store.clone(), h.fixture.transport.clone()).await;
    assert_eq!(
        serde_json::to_value(h.store.list_routes().unwrap()).unwrap(),
        routes_before
    );
    assert_eq!(
        serde_json::to_value(h.store.list_api_keys().unwrap()).unwrap(),
        keys_before
    );
    assert_eq!(
        h.fixture.records.lock().unwrap().len(),
        start,
        "recovery/reopen must not replay inference"
    );
    let mark = h.plan(vec![Step::inference(settled_success())]);
    h.success(2, "as_discovery").await;
    h.completed(mark, &["inference"]);
    let rows = settled_rows(&h, "as_discovery", 3).await;
    assert_attempt(
        rows.last().unwrap(),
        BUFFERED_SOURCE,
        200,
        "succeeded",
        "complete",
    );
    let final_row = rows.last().unwrap();
    let settled_before = serde_json::to_value(final_row).unwrap();
    let final_id = final_row.attempt_id.as_deref().unwrap();
    assert!(
        !h.store
            .finalize_stream_attempt(
                final_id,
                &crate::store::StreamFinalization {
                    outcome: "failed",
                    error: Some("stream_error"),
                    ..Default::default()
                }
            )
            .unwrap(),
        "late callback must not overwrite a settled HTTP attempt"
    );
    h.store.observe_stream_headers(final_id, 502, 999).unwrap();
    assert_eq!(
        serde_json::to_value(rows_for(&h, "as_discovery").last().unwrap()).unwrap(),
        settled_before
    );
    stages.push(stage(
        &h.fixture,
        "reopen_recovery_and_idempotence",
        start,
        1,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    reconcile_attempt_surfaces(&h).await;
    h.completed(start, &[]);
    stages.push(stage(
        &h.fixture,
        "sqlite_json_csv_reconciliation",
        start,
        1,
    ));
    let records = h.fixture.records.lock().unwrap().clone();
    let inference_count = records
        .iter()
        .filter(|r| r["operation"] == "inference")
        .count();
    let mut rows = h.store.recent_usage(1000).unwrap();
    assert!(rows.iter().all(|r| r.finalized_at.is_some()));
    rows.reverse();
    let attempts: Vec<_> = rows
        .iter()
        .filter(|row| row.attempt_id.as_deref() != Some(seed.as_str()))
        .map(attempt_report)
        .collect();
    assert_eq!(attempts.len(), inference_count);
    let ids: Vec<_> = attempts
        .iter()
        .map(|r| r["attempt_id"].as_str().unwrap().to_owned())
        .collect();
    assert_eq!(ids, *h.fixture.reserved_attempts.lock().unwrap());
    assert_eq!(ids.iter().collect::<HashSet<_>>().len(), ids.len());
    let counts = json!({
        "inference":inference_count,
        "discovery":records.iter().filter(|r| r["operation"] == "discovery").count(),
        "refresh":records.iter().filter(|r| r["operation"] == "refresh").count(),
        "unexpected_destinations":h.fixture.unexpected.load(Ordering::SeqCst),
        "client_inference_requests":h.client_inferences.load(Ordering::SeqCst),
        "admin_http_requests":h.admin_requests.load(Ordering::SeqCst)
    });
    assert_eq!(counts["inference"], 45);
    assert_eq!(counts["discovery"], 2);
    assert_eq!(counts["refresh"], 4);
    assert_eq!(counts["unexpected_destinations"], 0);
    drop(usage_owner);
    let cleanup = h.close().await;
    let report = json!({
        "schema_version":1,"test":"proxy::agy_http_tests::as_http_settlement_acceptance",
        "status":"passed","actual_gateway_http":true,
        "transport":"sealed_test_only_loopback_nonforwarding_proxy",
        "stages":stages,"counts":counts,"destinations":records,"attempts":attempts,
        "usage":usage,"cleanup":cleanup,"seeded_recovery_rows":1,
        "accounting":{
            "dispatch_rows_match":true,"unique_attempts":true,"no_pending_after_recovery":true,
            "surfaces_match":true,"no_extra_dispatch":true,"opaque_semantics_verified":true,
            "restart_recovery_verified":true,"reservation_failure_no_dispatch":true
        },
        "gaps":["synthetic offline acceptance; no real provider/client/version validation",
            "opaque generateContent bytes are not native streaming conversion or semantic completion evidence",
            "buffered estimates use configured rates and are not verified billing",
            "deep owner-unpolled/race and exhaustive parser shapes require focused native tests",
            "admin refresh/refresh-all/probes and host credential import are excluded",
            "enumerated application transport confinement is not machine-wide egress proof"]
    });
    println!("\nANTIGRAVITY_SETTLEMENT_REPORT={report}");
}

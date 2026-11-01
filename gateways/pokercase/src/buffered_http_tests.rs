//! Buffered accounting through the real router and a sealed non-forwarding proxy.
//! Synthetic temporary stores only; no environment mutation or external CLI.
use super::*;
use axum::extract::{Request, State};
use std::collections::{HashSet, VecDeque};
use std::net::SocketAddr;
use std::sync::atomic::AtomicUsize;
use std::sync::Mutex;
use tempfile::TempDir;

const ADMIN: &str = "synthetic-buffered-admin";
const ACCESS: &str = "synthetic-buffered-access";

#[derive(Clone, Copy, PartialEq)]
enum End {
    Eof,
    Hold,
    ReadError,
    HeadersHold,
}

#[derive(Clone)]
struct Reply {
    status: u16,
    content_type: &'static str,
    bytes: Vec<u8>,
    end: End,
    rotate: Option<std::path::PathBuf>,
    expected_access: Option<&'static str>,
}

impl Reply {
    fn chat() -> Self {
        Self {
            end: End::Eof, rotate: None, expected_access: Some(ACCESS),
            status: 200,
            content_type: "application/json",
            bytes: serde_json::to_vec(&json!({"id":"synthetic-chat","object":"chat.completion","model":"fixture-model","choices":[{"index":0,"message":{"role":"assistant","content":"fixture-output"},"finish_reason":"stop"}],"usage":{"prompt_tokens":11,"completion_tokens":7}})).unwrap(),
        }
    }
}

struct Fixture {
    authority: String,
    store: Store,
    replies: Mutex<VecDeque<Reply>>,
    records: Mutex<Vec<Value>>,
    denied: AtomicUsize,
    denials: Mutex<Vec<Value>>,
    proof_requests: AtomicUsize,
    redirect: Mutex<Option<String>>,
    active: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
    release: Arc<tokio::sync::Notify>,
}

impl Fixture {
    fn permitted(&self, method: &str, target: &str, host: Option<&str>, upgrade: bool) -> bool {
        if method != "POST" || host != Some(self.authority.as_str()) || upgrade {
            return false;
        }
        let path = if target.starts_with('/') {
            target.to_owned()
        } else {
            let Ok(url) = reqwest::Url::parse(target) else {
                return false;
            };
            if url.scheme() != "http"
                || url.host_str() != Some("127.0.0.1")
                || url.port()
                    != self
                        .authority
                        .rsplit_once(':')
                        .and_then(|(_, p)| p.parse().ok())
                || !url.username().is_empty()
                || url.password().is_some()
                || url.query().is_some()
                || url.fragment().is_some()
            {
                return false;
            }
            url.path().to_owned()
        };
        matches!(
            path.as_str(),
            "/v1/chat/completions"
                | "/v1/responses"
                | "/api/accounts/oauth/token"
                | "/oauth2/token"
                | "/proof-redirect"
        )
    }
}

async fn endpoint(State(fixture): State<Arc<Fixture>>, request: Request) -> Response {
    if !fixture.permitted(
        request.method().as_str(),
        &request.uri().to_string(),
        request.headers().get("host").and_then(|v| v.to_str().ok()),
        request.headers().contains_key("upgrade"),
    ) {
        fixture.denied.fetch_add(1, Ordering::SeqCst);
        let denial = json!({"reason":"destination_guard","method":request.method().as_str(),"path":request.uri().path(),"absolute_target":request.uri().scheme().is_some()});
        eprintln!("BUFFERED_HTTP_FIXTURE_DENIAL={denial}");
        fixture.denials.lock().unwrap().push(denial);
        return (StatusCode::FORBIDDEN, "fixture destination denied").into_response();
    }
    let path = request.uri().path().to_owned();
    if path == "/proof-redirect" {
        fixture.proof_requests.fetch_add(1, Ordering::SeqCst);
        let location = fixture.redirect.lock().unwrap().clone().unwrap();
        return (
            StatusCode::TEMPORARY_REDIRECT,
            [("location", location)],
            "fixture redirect",
        )
            .into_response();
    }
    let refresh = matches!(path.as_str(), "/api/accounts/oauth/token" | "/oauth2/token");
    // Record the witness without panicking: baseline must return its normal reply,
    // release both owned servers and only then fail the intended accounting check.
    let pending: Vec<_> = fixture
        .store
        .recent_usage(1000)
        .unwrap()
        .into_iter()
        .filter(|row| row.finalized_at.is_none())
        .collect();
    let witness = pending.len() == 1
        && pending[0].attempt_id.is_some()
        && pending[0].request_id.is_some()
        && pending[0].status.is_none();
    let authorization = request
        .headers()
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let body = axum::body::to_bytes(request.into_body(), 64 * 1024)
        .await
        .unwrap();
    let stream = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v["stream"].as_bool());
    let reply = fixture.replies.lock().unwrap().pop_front();
    let Some(reply) = reply else {
        fixture.denied.fetch_add(1, Ordering::SeqCst);
        return (StatusCode::BAD_REQUEST, "unplanned fixture operation").into_response();
    };
    let auth_valid = if refresh {
        authorization.is_empty()
    } else {
        reply
            .expected_access
            .is_none_or(|access| authorization == format!("Bearer {access}"))
    };
    let tools = serde_json::from_slice::<Value>(&body)
        .ok()
        .and_then(|v| v["tools"].as_array().map(Vec::len))
        .unwrap_or(0);
    {
        let mut records = fixture.records.lock().unwrap();
        let sequence = records.len() + 1;
        records.push(json!({
        "sequence":sequence,"method":"POST","destination":format!("http://{}{}",fixture.authority,path),
        "operation":if refresh {"refresh"} else {"inference"},
        "path":path,"stream":stream,"reserved_before_send":witness,
        "pending_count":pending.len(), "auth_valid":auth_valid, "tools":tools,
        "attempt_id":pending.first().and_then(|r| r.attempt_id.clone()),
        "request_id":pending.first().and_then(|r| r.request_id.clone())
    }));
    }
    if let Some(path) = &reply.rotate {
        std::fs::write(path, r#"{"synthetic":{"key":"synthetic-fresh","refresh_token":"synthetic-owned-by-fixture"}}"#).unwrap();
    }
    if reply.end == End::Eof && reply.content_type != "text/event-stream" {
        return (
            StatusCode::from_u16(reply.status).unwrap(),
            [("content-type", reply.content_type)],
            reply.bytes,
        )
            .into_response();
    }
    fixture.active.fetch_add(1, Ordering::SeqCst);
    let owner = BodyOwner {
        active: fixture.active.clone(),
        dropped: fixture.dropped.clone(),
    };
    if reply.end == End::HeadersHold {
        let _owner = owner;
        fixture.release.notified().await;
        return (StatusCode::OK, "released synthetic headers").into_response();
    }
    let release = fixture.release.clone();
    let stream = async_stream::stream! {
        let _owner = owner;
        for chunk in reply.bytes.chunks(65_537) {
            yield Ok::<Bytes,std::io::Error>(Bytes::copy_from_slice(chunk));
        }
        match reply.end {
            End::Hold => { release.notified().await; }
            End::ReadError => {
                release.notified().await;
                yield Err(std::io::Error::other("synthetic body read failure"));
            }
            _ => {}
        }
    };
    (
        StatusCode::from_u16(reply.status).unwrap(),
        [("content-type", reply.content_type)],
        Body::from_stream(stream),
    )
        .into_response()
}

struct BodyOwner {
    active: Arc<AtomicUsize>,
    dropped: Arc<AtomicUsize>,
}
impl Drop for BodyOwner {
    fn drop(&mut self) {
        self.active.fetch_sub(1, Ordering::SeqCst);
        self.dropped.fetch_add(1, Ordering::SeqCst);
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
                Ok(joined) => joined.unwrap(),
                Err(_) => {
                    task.abort();
                    let _ = task.await;
                    panic!("owned server shutdown timeout");
                }
            }
        }
        drop(
            tokio::net::TcpListener::bind(self.address)
                .await
                .expect("owned listener released"),
        );
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
    fake: OwnedServer,
    gateway: OwnedServer,
    upstream: Client,
    client: Client,
    key: String,
    client_requests: AtomicUsize,
    admin_requests: AtomicUsize,
}
impl Harness {
    async fn new() -> Self {
        Self::with_timeout(Duration::from_secs(3)).await
    }
    async fn with_timeout(request_timeout: Duration) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("thinrouter.db"), None).unwrap();
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        assert_eq!(address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_ne!(address.port(), 0);
        let base = format!("http://{address}");
        let fixture = Arc::new(Fixture {
            authority: address.to_string(),
            store: store.clone(),
            replies: Mutex::new(VecDeque::new()),
            records: Mutex::new(Vec::new()),
            denied: AtomicUsize::new(0),
            denials: Mutex::new(Vec::new()),
            proof_requests: AtomicUsize::new(0),
            redirect: Mutex::new(None),
            active: Arc::new(AtomicUsize::new(0)),
            dropped: Arc::new(AtomicUsize::new(0)),
            release: Arc::new(tokio::sync::Notify::new()),
        });
        let fake = OwnedServer::start(
            listener,
            axum::Router::new()
                .fallback(endpoint)
                .with_state(fixture.clone()),
        );
        let upstream = Client::builder()
            .no_proxy()
            .proxy(reqwest::Proxy::all(&base).unwrap())
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(1))
            .timeout(request_timeout)
            .build()
            .unwrap();
        let gateway = Self::start_gateway(dir.path(), store.clone(), upstream.clone(), &base).await;
        let (_, key) = store.create_api_key("synthetic-buffered-client").unwrap();
        let client = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap();
        let h = Self {
            dir,
            store,
            fixture,
            fake,
            gateway,
            upstream,
            client,
            key,
            client_requests: AtomicUsize::new(0),
            admin_requests: AtomicUsize::new(0),
        };
        h.preflight();
        h
    }
    async fn start_gateway(
        dir: &std::path::Path,
        store: Store,
        upstream: Client,
        base: &str,
    ) -> OwnedServer {
        let proxy = ProxyState {
            http: upstream.clone(),
            store: store.clone(),
            cooldown: CooldownMap::new(),
            rr_counter: Arc::new(AtomicU64::new(0)),
            sse_stall_secs: 5,
            token_saver: false,
            token_saver_max_chars: 2000,
            provider_base_overrides: ["siwc", "grok", "opencode"]
                .into_iter()
                .map(|p| (p.to_owned(), base.to_owned()))
                .collect(),
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
            refresh_transport: Some(crate::oauth_refresh::TestTransport::loopback(base)),
            agy_transport: None,
        };
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let mut cfg = crate::config::AppConfig::new(
            "127.0.0.1".into(),
            listener.local_addr().unwrap().port(),
            Some(dir.to_owned()),
            Some(ADMIN.into()),
            None,
            Some(5),
            Some(false),
            None,
        )
        .unwrap();
        cfg.provider_base_overrides = ["siwc", "grok", "opencode"]
            .into_iter()
            .map(|provider| (provider.to_owned(), base.to_owned()))
            .collect();
        assert_eq!(cfg.provider_base_overrides, proxy.provider_base_overrides);
        OwnedServer::start(
            listener,
            crate::server::build_app(crate::server::AppState {
                cfg,
                store: store.clone(),
                proxy,
                sessions: crate::guard::Sessions::default(),
            }),
        )
    }
    fn preflight(&self) {
        assert_eq!(self.fake.address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert_eq!(self.gateway.address.ip(), std::net::Ipv4Addr::LOCALHOST);
        assert!(self.fixture.records.lock().unwrap().is_empty());
        assert_eq!(self.fixture.denied.load(Ordering::SeqCst), 0);
        assert!(self.store.recent_usage(1).unwrap().is_empty());
        assert!(self.dir.path().join("thinrouter.db").is_file());
        for (method, target, host, upgrade) in [
            (
                "CONNECT",
                self.fixture.authority.as_str(),
                Some(self.fixture.authority.as_str()),
                false,
            ),
            (
                "POST",
                "/unknown",
                Some(self.fixture.authority.as_str()),
                false,
            ),
            (
                "POST",
                "/v1/responses?query",
                Some(self.fixture.authority.as_str()),
                false,
            ),
            ("POST", "/v1/responses", Some("localhost:1"), false),
            (
                "POST",
                "/v1/responses",
                Some(self.fixture.authority.as_str()),
                true,
            ),
        ] {
            assert!(!self.fixture.permitted(method, target, host, upgrade));
        }
    }
    fn assert_bound_endpoints(&self) {
        let expected = format!("http://{}/v1", self.fake.address);
        for connection in self.store.list_connections().unwrap() {
            assert_eq!(
                connection.base_url, expected,
                "synthetic connection must store the exact owned inference base before dispatch"
            );
            if let Some(oauth) = connection.oauth {
                assert!(["siwc", "grok", "opencode"].contains(&oauth.provider.as_str()));
            }
        }
    }
    fn diagnostic(&self, case: &str, phase: &str) {
        let records = self.fixture.records.lock().unwrap();
        eprintln!(
            "BUFFERED_HTTP_CASE_DIAGNOSTIC={}",
            json!({"case":case,"phase":phase,
            "inference":records.iter().filter(|r|r["operation"]=="inference").count(),
            "refresh":records.iter().filter(|r|r["operation"]=="refresh").count(),"discovery":0,
            "denied":self.fixture.denied.load(Ordering::SeqCst),"denials":self.fixture.denials.lock().unwrap().clone(),
            "planned_operations_remaining":self.fixture.replies.lock().unwrap().len()})
        );
    }
    fn url(&self, path: &str) -> String {
        format!("http://{}{path}", self.gateway.address)
    }
    async fn admin(&self, method: reqwest::Method, path: &str, body: Option<Value>) -> Value {
        self.admin_requests.fetch_add(1, Ordering::SeqCst);
        let mut request = self
            .client
            .request(method, self.url(path))
            .header("x-admin-token", ADMIN);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await.unwrap();
        assert!(response.status().is_success());
        response.json().await.unwrap()
    }
    async fn generic(&self, name: &str) {
        let conn = self.admin(reqwest::Method::POST, "/admin/api/connections", Some(json!({
            "name":name,"base_url":format!("http://{}/v1",self.fake.address),"api_key":ACCESS,
            "default_model":"fixture-model","input_price_per_m":2.0,"output_price_per_m":3.0
        }))).await;
        self.admin(reqwest::Method::POST, "/admin/api/routes", Some(json!({
            "public_model":name,"strategy":"fallback","targets":[{"connection_id":conn["id"],"model_override":"fixture-model"}]
        }))).await;
    }
    async fn request(&self, protocol: usize, model: &str) -> reqwest::Response {
        self.assert_bound_endpoints();
        self.diagnostic(model, "client_start");
        self.client_requests.fetch_add(1, Ordering::SeqCst);
        let (path, body) = match protocol {
            0 => (
                "/v1/chat/completions",
                json!({"model":model,"stream":false,"messages":[{"role":"user","content":"synthetic-input"}]}),
            ),
            1 => (
                "/v1/messages",
                json!({"model":model,"stream":false,"max_tokens":64,"messages":[{"role":"user","content":"synthetic-input"}]}),
            ),
            _ => (
                "/v1/responses",
                json!({"model":model,"stream":false,"input":"synthetic-input"}),
            ),
        };
        let response = self
            .client
            .post(self.url(path))
            .bearer_auth(&self.key)
            .json(&body)
            .send()
            .await
            .unwrap();
        self.diagnostic(model, "client_response_headers");
        response
    }
    async fn close(mut self) -> Value {
        self.fixture.release.notify_waiters();
        self.gateway.close().await;
        self.fake.close().await;
        assert_eq!(self.fixture.active.load(Ordering::SeqCst), 0);
        let dropped = self.fixture.dropped.load(Ordering::SeqCst);
        let path = self.dir.path().to_owned();
        drop(self.client);
        drop(self.upstream);
        drop(self.fixture);
        drop(self.store);
        self.dir.close().unwrap();
        assert!(!path.exists());
        json!({"gateway_task_joined":true,"fixture_task_joined":true,"listeners_rebound":true,"temporary_data_removed":true,"active_streams":0,"dropped_streams":dropped})
    }
}

#[tokio::test]
async fn bh_confinement_preflight() {
    let h = Harness::new().await;
    let sentinel = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let sentinel_addr = sentinel.local_addr().unwrap();
    *h.fixture.redirect.lock().unwrap() = Some(format!("http://{sentinel_addr}/must-not-arrive"));
    assert_eq!(
        h.upstream
            .post(format!("http://{}/proof-redirect", h.fake.address))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::TEMPORARY_REDIRECT
    );
    assert_eq!(
        h.upstream
            .post(format!("http://{sentinel_addr}/unknown"))
            .send()
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    assert!(h
        .upstream
        .post(format!("https://{sentinel_addr}/unknown"))
        .send()
        .await
        .is_err());
    assert_eq!(h.fixture.denied.load(Ordering::SeqCst), 2);
    assert!(h.fixture.records.lock().unwrap().is_empty());
    assert!(timeout(Duration::from_millis(50), sentinel.accept())
        .await
        .is_err());
    let cleanup = h.close().await;
    println!(
        "BUFFERED_HTTP_CONFINEMENT_REPORT={}",
        json!({"status":"passed","exact_loopback":true,"mandatory_nonforwarding_proxy":true,"redirect_refused":true,"unknown_refused":true,"connect_refused":true,"inference":0,"refresh":0,"discovery":0,"sentinel_connections":0,"cleanup":cleanup})
    );
}

#[tokio::test]
async fn bh1_buffered_dispatch_is_reserved_and_finalized() {
    let h = Harness::new().await;
    h.generic("baseline-buffered").await;
    h.fixture.replies.lock().unwrap().push_back(Reply::chat());
    let response = h.request(0, "baseline-buffered").await;
    let status = response.status();
    let wire: Value = response.json().await.unwrap();
    let rows = h.store.recent_usage(10).unwrap();
    let records = h.fixture.records.lock().unwrap().clone();
    let denied = h.fixture.denied.load(Ordering::SeqCst);
    let observed = json!({"status":status.as_u16(),"records":records,"rows":rows,"unexpected_destinations":denied});
    let cleanup = h.close().await;
    println!(
        "BUFFERED_HTTP_BASELINE_OBSERVATION={}",
        json!({"observed":observed,"cleanup":cleanup})
    );
    assert_eq!(status, StatusCode::OK);
    assert_eq!(wire["choices"][0]["message"]["content"], "fixture-output");
    assert_eq!(denied, 0);
    assert_eq!(records.len(), 1);
    assert_eq!(rows.len(), 1);
    assert_eq!(
        records[0]["reserved_before_send"], true,
        "actual upstream must witness a durable pending inference row before responding"
    );
    assert!(
        rows[0].attempt_id.is_some()
            && rows[0].request_id.is_some()
            && rows[0].finalized_at.is_some(),
        "actual buffered inference must finalize its one reserved attempt"
    );
    assert_eq!(rows[0].outcome, "succeeded");
}

fn chat_value() -> Value {
    serde_json::from_slice(&Reply::chat().bytes).unwrap()
}
fn response_value() -> Value {
    json!({"id":"synthetic-response","object":"response","model":"fixture-model","status":"completed","error":null,
        "output":[{"type":"message","role":"assistant","content":[{"type":"output_text","text":"fixture-output"}]}],
        "usage":{"input_tokens":11,"output_tokens":7},"opaque":{"preserved":true}})
}
fn json_reply(value: Value) -> Reply {
    Reply {
        bytes: format!(" \n{}\n", serde_json::to_string_pretty(&value).unwrap()).into_bytes(),
        ..Reply::chat()
    }
}
fn frame(kind: &str, response: Value) -> String {
    format!("data: {}\n\n", json!({"type":kind,"response":response}))
}
fn sse_reply(value: Value, delta: bool) -> Reply {
    let mut bytes = if delta {
        b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture-output\"}\n\n".to_vec()
    } else {
        Vec::new()
    };
    let kind = if value["status"] == "incomplete" {
        "response.incomplete"
    } else {
        "response.completed"
    };
    bytes.extend_from_slice(frame(kind, value).as_bytes());
    Reply {
        content_type: "text/event-stream",
        bytes,
        ..Reply::chat()
    }
}
fn complete_reply(provider: &str) -> Reply {
    match provider {
        "siwc" => sse_reply(response_value(), true),
        "grok" => json_reply(response_value()),
        _ => Reply::chat(),
    }
}
fn http_error(status: u16) -> Reply {
    Reply {
        status,
        bytes: b"synthetic fixed upstream error".to_vec(),
        ..Reply::chat()
    }
}
fn refresh_reply() -> Reply {
    let mut reply = json_reply(
        json!({"access_token":"synthetic-fresh","refresh_token":"synthetic-rotated","expires_in":3600}),
    );
    reply.expected_access = None;
    reply
}
fn protocol_name(protocol: usize) -> &'static str {
    ["chat", "messages", "responses"][protocol]
}

impl Harness {
    async fn connection(
        &self,
        name: &str,
        provider: &str,
        refresh: bool,
        proactive: bool,
        meta: Option<String>,
    ) -> String {
        if provider == "generic" {
            return self.admin(reqwest::Method::POST,"/admin/api/connections",Some(json!({
                "name":name,"base_url":format!("http://{}/v1",self.fake.address),"api_key":ACCESS,
                "default_model":"fixture-model","input_price_per_m":2.0,"output_price_per_m":3.0
            }))).await["id"].as_str().unwrap().to_owned();
        }
        assert!(["siwc", "grok", "opencode"].contains(&provider));
        let imported=self.admin(reqwest::Method::POST,"/admin/api/connections/oauth/import",Some(json!({
            "name":name,"provider":provider,"base_url":format!("http://{}/v1",self.fake.address),"access_token":ACCESS,"refresh_token":refresh.then_some("synthetic-refresh"),
            "expires_at":if proactive {"0"} else {"4102444800"},"default_model":"fixture-model",
            "meta":meta.unwrap_or_else(||r#"{"client_id":"oaiapp_synthetic"}"#.into())
        }))).await;
        let c = &imported["connection"];
        let id = c["id"].as_str().unwrap().to_owned();
        let expected = format!("http://{}/v1", self.fake.address);
        assert_eq!(c["base_url"], expected);
        assert_eq!(
            self.store.get_connection(&id).unwrap().unwrap().base_url,
            expected
        );
        self.admin(reqwest::Method::PUT,&format!("/admin/api/connections/{id}"),Some(json!({
            "name":name,"base_url":c["base_url"],"default_model":"fixture-model","input_price_per_m":2.0,"output_price_per_m":3.0
        }))).await;
        id
    }
    async fn route(&self, name: &str, ids: &[String]) {
        self.admin(reqwest::Method::POST,"/admin/api/routes",Some(json!({"public_model":name,"strategy":"fallback",
            "targets":ids.iter().map(|id|json!({"connection_id":id,"model_override":"fixture-model"})).collect::<Vec<_>>()
        }))).await;
    }
    async fn setup(&self, name: &str, provider: &str) {
        let id = self.connection(name, provider, false, false, None).await;
        self.route(name, &[id]).await;
    }
    fn plan(&self, replies: Vec<Reply>) -> usize {
        self.assert_bound_endpoints();
        let mut pending = self.fixture.replies.lock().unwrap();
        assert!(pending.is_empty(), "unconsumed previous fixture operation");
        pending.extend(replies);
        self.fixture.records.lock().unwrap().len()
    }
    fn completed(&self, start: usize, operations: &[&str]) {
        assert!(
            self.fixture.replies.lock().unwrap().is_empty(),
            "missing expected fixture operation"
        );
        assert_eq!(self.fixture.denied.load(Ordering::SeqCst), 0);
        let records = self.fixture.records.lock().unwrap();
        let selected = &records[start..];
        assert_eq!(
            selected
                .iter()
                .map(|r| r["operation"].as_str().unwrap())
                .collect::<Vec<_>>(),
            operations
        );
        for r in selected {
            assert_eq!(r["auth_valid"], true);
            if r["operation"] == "inference" {
                assert_eq!(r["reserved_before_send"], true);
            } else {
                assert_eq!(r["pending_count"], 0);
            }
        }
    }
    async fn request_options(
        &self,
        protocol: usize,
        model: &str,
        background: bool,
        tools: bool,
    ) -> reqwest::Response {
        self.assert_bound_endpoints();
        self.diagnostic(model, "client_start");
        let (path, mut body) = client_body(protocol, model);
        if background {
            body["background"] = json!(true);
        }
        if tools {
            body["tools"] = match protocol {
                0 => {
                    json!([{"type":"function","function":{"name":"lookup","parameters":{"type":"object","properties":{}}}}])
                }
                1 => json!([{"name":"lookup","input_schema":{"type":"object","properties":{}}}]),
                _ => {
                    json!([{"type":"function","name":"lookup","parameters":{"type":"object","properties":{}}}])
                }
            };
        }
        self.client_requests.fetch_add(1, Ordering::SeqCst);
        let response = self
            .client
            .post(self.url(path))
            .bearer_auth(&self.key)
            .json(&body)
            .send()
            .await
            .unwrap();
        self.diagnostic(model, "client_response_headers");
        response
    }
    fn rows(&self, name: &str) -> Vec<crate::store::UsageEvent> {
        let mut rows: Vec<_> = self
            .store
            .recent_usage(1000)
            .unwrap()
            .into_iter()
            .filter(|r| r.public_model.as_deref() == Some(name))
            .collect();
        rows.reverse();
        rows
    }
    async fn settled(&self, name: &str, count: usize) -> Vec<crate::store::UsageEvent> {
        timeout(Duration::from_secs(3), async {
            loop {
                let rows = self.rows(name);
                assert!(rows.len() <= count);
                if rows.len() == count && rows.iter().all(|r| r.finalized_at.is_some()) {
                    break rows;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("buffered attempt did not settle")
    }
    async fn observed_headers(&self, name: &str) {
        timeout(Duration::from_secs(3), async {
            loop {
                if self.rows(name).iter().any(|r| r.status == Some(200)) {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("fixture requires durable headers before releasing body fault");
    }
    async fn body_released(&self) {
        timeout(Duration::from_secs(3), async {
            while self.fixture.active.load(Ordering::SeqCst) != 0 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("owned upstream body not released");
    }
}
fn client_body(protocol: usize, model: &str) -> (&'static str, Value) {
    match protocol {
        0 => (
            "/v1/chat/completions",
            json!({"model":model,"stream":false,"messages":[{"role":"user","content":"synthetic-input"}]}),
        ),
        1 => (
            "/v1/messages",
            json!({"model":model,"stream":false,"max_tokens":64,"messages":[{"role":"user","content":"synthetic-input"}]}),
        ),
        _ => (
            "/v1/responses",
            json!({"model":model,"stream":false,"input":"synthetic-input"}),
        ),
    }
}
fn check_row(
    row: &crate::store::UsageEvent,
    provider: &str,
    status: Option<i64>,
    outcome: &str,
    usage: &str,
    tokens: (Option<i64>, Option<i64>),
    delta: bool,
) {
    assert!(row.request_id.is_some() && row.attempt_id.is_some() && row.finalized_at.is_some());
    assert_eq!(row.status, status);
    assert_eq!(row.outcome, outcome);
    assert_eq!(row.usage_status, usage);
    assert_eq!((row.prompt_tokens, row.completion_tokens), tokens);
    assert_eq!(
        row.usage_source,
        if ["siwc", "grok"].contains(&provider) {
            "openai_responses_v1"
        } else {
            "openai_chat_v1"
        }
    );
    assert!(row.cli_ready_ms.is_none());
    assert_eq!(row.first_output_ms.is_some(), delta);
    if let Some(headers) = row.headers_ms {
        assert!(row.total_observed_ms.is_some_and(|total| total >= headers));
    }
    assert!(row.total_observed_ms.is_some());
    if delta {
        assert!(row.first_output_ms.unwrap() <= row.total_observed_ms.unwrap());
    }
    assert!(!serde_json::to_string(row)
        .unwrap()
        .contains("PRIVATE-CANARY"));
    let estimate = match tokens {
        (Some(a), Some(b)) if usage == "complete" => {
            Some((a as f64 * 2.0 + b as f64 * 3.0) / 1_000_000.0)
        }
        _ => None,
    };
    if let Some(expected) = estimate {
        assert!((row.estimated_cost_usd.unwrap() - expected).abs() < 1e-12);
    } else {
        assert!(row.estimated_cost_usd.is_none());
    }
}
fn group(rows: &[crate::store::UsageEvent]) {
    let mut ids = HashSet::new();
    for row in rows {
        assert_eq!(row.request_id, rows[0].request_id);
        assert!(ids.insert(row.attempt_id.as_ref().unwrap()));
    }
}
#[allow(clippy::too_many_arguments)]
fn record_case(
    cases: &mut Vec<Value>,
    name: &str,
    provider: &str,
    protocol: usize,
    dispatches: usize,
    rows: &[crate::store::UsageEvent],
    client_status: Option<u16>,
    body_contract: &str,
) {
    assert!(!cases.iter().any(|c| c["case"] == name));
    assert_eq!(rows.len(), dispatches);
    cases.push(json!({"case":name,"provider":provider,"client":protocol_name(protocol),"status":"passed",
        "expected_dispatch_count":dispatches,"observed_row_count":rows.len(),"expected_row_count":dispatches,
        "client_status":client_status,"body_contract":body_contract,"body_contract_passed":true,
        "attempts":rows}));
}
fn stage(h: &Harness, name: &str, start: usize, cases: usize) -> Value {
    let records = h.fixture.records.lock().unwrap();
    let selected = &records[start..];
    eprintln!(
        "BUFFERED_HTTP_STAGE_COMPLETED={}",
        json!({"stage":name,"cases":cases,"operations":selected.len()})
    );
    json!({"stage":name,"status":"passed","cases":cases,"inference":selected.iter().filter(|r|r["operation"]=="inference").count(),
        "refresh":selected.iter().filter(|r|r["operation"]=="refresh").count(),"discovery":0})
}

fn assert_codec_float(actual: f64, expected: f64, coverage: bool) {
    assert!(
        actual.is_finite() && expected.is_finite(),
        "measurement codecs must remain finite"
    );
    if coverage {
        assert!((0.0..=1.0).contains(&actual));
        assert!((0.0..=1.0).contains(&expected));
    }
    let tolerance = 4.0 * f64::EPSILON * expected.abs().max(1.0);
    assert!((actual-expected).abs()<=tolerance,"numeric codec discrepancy exceeds bounded representation tolerance: {actual} vs {expected}");
}
fn assert_optional_codec_float(actual: &Value, expected: Option<f64>, coverage: bool) {
    match expected {
        Some(expected) => assert_codec_float(
            actual.as_f64().expect("known measurement must be numeric"),
            expected,
            coverage,
        ),
        None => assert!(actual.is_null(), "missing measurement must remain null"),
    }
}

async fn reconcile(h: &Harness) -> Value {
    let rows = h.store.recent_usage(1000).unwrap();
    assert!(rows.len() < 100, "events JSON limit must remain explicit");
    let events = h
        .admin(reqwest::Method::GET, "/admin/api/usage", None)
        .await;
    assert_eq!(events["data"], serde_json::to_value(&rows).unwrap());
    h.admin_requests.fetch_add(1, Ordering::SeqCst);
    let csv_response = h
        .client
        .get(h.url("/admin/api/usage/export.csv"))
        .header("x-admin-token", ADMIN)
        .send()
        .await
        .unwrap();
    assert_eq!(csv_response.status(), StatusCode::OK);
    let csv = csv_response.text().await.unwrap();
    let mut lines = csv.lines();
    let columns: Vec<_> = lines.next().unwrap().split(',').collect();
    let lines: Vec<_> = lines.collect();
    assert_eq!(lines.len(), rows.len());
    let sql = rusqlite::Connection::open(h.dir.path().join("thinrouter.db")).unwrap();
    for row in &rows {
        let v = serde_json::to_value(row).unwrap();
        let line = lines
            .iter()
            .find(|line| line.starts_with(&format!("{},", row.id)))
            .unwrap();
        let cells: Vec<_> = line.split(',').collect();
        for field in [
            "id",
            "request_id",
            "attempt_id",
            "status",
            "outcome",
            "usage_status",
            "usage_source",
            "prompt_tokens",
            "completion_tokens",
            "estimated_cost_usd",
            "headers_ms",
            "first_output_ms",
            "total_observed_ms",
            "finalized_at",
            "cli_ready_ms",
            "error",
        ] {
            let index = columns.iter().position(|c| *c == field).unwrap();
            let actual = cells[index].trim_matches('"');
            let raw: rusqlite::types::Value = sql
                .query_row(
                    &format!("SELECT {field} FROM usage_events WHERE id=?1"),
                    [row.id],
                    |r| r.get(0),
                )
                .unwrap();
            let expected = match raw {
                rusqlite::types::Value::Null => Value::Null,
                rusqlite::types::Value::Integer(n) => json!(n),
                rusqlite::types::Value::Real(n) => json!(n),
                rusqlite::types::Value::Text(t) => json!(t),
                _ => panic!("unexpected SQLite type"),
            };
            assert_eq!(v[field], expected, "SQLite field {field}");
            match &expected {
                Value::Null => assert!(actual.is_empty(), "CSV null {field}"),
                Value::String(s) => assert_eq!(actual, s),
                Value::Number(n) => {
                    assert!((actual.parse::<f64>().unwrap() - n.as_f64().unwrap()).abs() < 1e-12)
                }
                _ => panic!("unexpected usage field"),
            }
        }
    }
    let daily = h
        .admin(
            reqwest::Method::GET,
            "/admin/api/usage/daily?schema=2",
            None,
        )
        .await;
    assert_eq!(daily["schema_revision"], 2);
    let days:Vec<String>=sql.prepare("SELECT substr(ts,1,10) FROM usage_events GROUP BY substr(ts,1,10) ORDER BY substr(ts,1,10) DESC").unwrap().query_map([],|r|r.get(0)).unwrap().collect::<Result<_,_>>().unwrap();
    assert!(
        !days.is_empty() && days.len() <= 14,
        "bounded fixture rows must fit both existing selected-day limits"
    );
    assert_eq!(
        daily["data"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["day"].as_str().unwrap())
            .collect::<Vec<_>>(),
        days.iter().map(String::as_str).collect::<Vec<_>>()
    );
    h.admin_requests.fetch_add(1, Ordering::SeqCst);
    let web = h
        .client
        .get(h.url("/admin/usage"))
        .header("x-admin-token", ADMIN)
        .send()
        .await
        .unwrap();
    assert_eq!(web.status(), StatusCode::OK);
    let html = web.text().await.unwrap();
    let recent = html
        .split_once("<h2>Recent events</h2>")
        .unwrap()
        .1
        .split_once("<tbody>")
        .unwrap()
        .1
        .split_once("</tbody>")
        .unwrap()
        .0;
    let recent_rows: Vec<_> = recent
        .split("<tr>")
        .skip(1)
        .map(|r| r.split_once("</tr>").unwrap().0)
        .collect();
    assert_eq!(recent_rows.len(), rows.len().min(50));
    for (fragment, row) in recent_rows.iter().zip(&rows) {
        let cells: Vec<_> = fragment
            .split("<td")
            .skip(1)
            .map(|s| s.split_once('>').unwrap().1.split_once("</td>").unwrap().0)
            .collect();
        assert_eq!(cells[1], row.public_model.as_deref().unwrap());
        assert_eq!(
            cells[3],
            row.status
                .map(|v| v.to_string())
                .unwrap_or_else(|| "—".into())
        );
        let timing = [
            row.headers_ms,
            row.cli_ready_ms,
            row.first_output_ms,
            row.total_observed_ms,
        ]
        .map(|v| v.map(|n| format!("{n} ms")).unwrap_or_else(|| "—".into()))
        .join(" / ");
        assert_eq!(cells[4], timing);
        let token = |v: Option<i64>| v.map(|n| n.to_string()).unwrap_or_else(|| "—".into());
        assert_eq!(
            cells[5],
            format!(
                "{}/{}",
                token(row.prompt_tokens),
                token(row.completion_tokens)
            )
        );
        assert_eq!(cells[8], row.outcome);
        assert_eq!(
            cells[9],
            format!("{} / {}", row.usage_status, row.usage_source)
        );
    }
    let selected = html
        .split_once("data-measurement-scope=\"selected\"")
        .unwrap()
        .1;
    for field in [
        "prompt_tokens",
        "completion_tokens",
        "headers_ms",
        "cli_ready_ms",
        "first_output_ms",
        "total_observed_ms",
        "latency_ms",
    ] {
        let (sum, known, total): (Option<i64>, i64, i64) = sql
            .query_row(
                &format!("SELECT SUM({field}),COUNT({field}),COUNT(*) FROM usage_events"),
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .unwrap();
        for day in daily["data"].as_array().unwrap() {
            let date = day["day"].as_str().unwrap();
            let (day_sum,day_known,day_total):(Option<i64>,i64,i64)=sql.query_row(&format!("SELECT SUM({field}),COUNT({field}),COUNT(*) FROM usage_events WHERE substr(ts,1,10)=?1"),[date],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?))).unwrap();
            let summary = &day["measurement_summary"][field];
            assert_eq!(summary["known_sum"], json!(day_sum));
            assert_eq!(summary["known_count"], day_known);
            assert_eq!(summary["unknown_count"], day_total - day_known);
            assert_eq!(summary["total_count"], day_total);
            let day_html = html
                .split_once(&format!("data-measurement-scope=\"{date}\""))
                .unwrap()
                .1
                .split_once("</tbody>")
                .unwrap()
                .0;
            let metric_html = day_html
                .split_once(&format!("data-metric=\"{field}\""))
                .unwrap()
                .1
                .split_once("</div>")
                .unwrap()
                .0;
            for key in ["known_sum", "known_count", "unknown_count", "total_count"] {
                let attribute = format!("data-{}=\"", key.replace('_', "-"));
                let actual = metric_html
                    .split_once(&attribute)
                    .unwrap()
                    .1
                    .split('"')
                    .next()
                    .unwrap();
                let expected = if summary[key].is_null() {
                    String::new()
                } else {
                    summary[key].to_string()
                };
                assert_eq!(actual, expected, "Web day/metric subset");
            }
        }
        let s = &daily["measurement_summary"][field];
        assert_eq!(s["known_sum"], json!(sum));
        assert_eq!(s["known_count"], known);
        assert_eq!(s["unknown_count"], total - known);
        assert_eq!(s["total_count"], total);
        assert_optional_codec_float(&s["coverage"], Some(known as f64 / total as f64), true);
        let fragment = selected
            .split_once(&format!("data-metric=\"{field}\""))
            .unwrap()
            .1
            .split_once("</div>")
            .unwrap()
            .0;
        for key in [
            "known_sum",
            "known_count",
            "unknown_count",
            "total_count",
            "status",
            "basis",
        ] {
            let attr = format!("data-{}=\"", key.replace('_', "-"));
            let actual = fragment
                .split_once(&attr)
                .unwrap()
                .1
                .split('"')
                .next()
                .unwrap();
            let expected = match &s[key] {
                Value::Null => String::new(),
                Value::String(v) => v.clone(),
                v => v.to_string(),
            };
            assert_eq!(actual, expected, "Web {field}/{key}");
        }
        let web_coverage = fragment
            .split_once("data-coverage=\"")
            .unwrap()
            .1
            .split('"')
            .next()
            .unwrap()
            .parse::<f64>()
            .unwrap();
        assert_codec_float(web_coverage, known as f64 / total as f64, true);
        if !["prompt_tokens", "completion_tokens"].contains(&field) {
            let mean: Option<f64> = sql
                .query_row(&format!("SELECT AVG({field}) FROM usage_events"), [], |r| {
                    r.get(0)
                })
                .unwrap();
            assert_optional_codec_float(&s["known_mean"], mean, false);
            let web_mean = fragment
                .split_once("data-known-mean=\"")
                .unwrap()
                .1
                .split('"')
                .next()
                .unwrap();
            if let Some(mean) = mean {
                assert_codec_float(web_mean.parse::<f64>().unwrap(), mean, false);
                assert!(fragment.contains("Mean of known observations"));
            } else {
                assert!(web_mean.is_empty());
            }
        }
        assert!(fragment.contains(&format!("Coverage {known}/{total} rows")));
        assert!(fragment.contains(&format!("Unknown {}", total - known)));
    }
    json!({"rows":rows.len(),"events_json_rows":rows.len(),"csv_rows":rows.len(),"web_recent_rows":rows.len().min(50),"web_recent_limit":50,
        "selected_date_buckets":days.len(),"daily_api_limit":30,"web_day_limit":14,"matching_summary_rows":rows.len(),"measurement_summary":daily["measurement_summary"],"sql_json_csv_web_reconciled":true})
}

fn expected_case_names() -> Vec<String> {
    let mut names = Vec::new();
    for p in ["generic", "siwc", "grok", "opencode"] {
        for c in ["chat", "messages", "responses"] {
            names.push(format!("success_{p}_{c}"));
        }
    }
    names.extend(
        [
            "tools_generic_messages",
            "tools_grok_responses",
            "tools_siwc_chat",
            "usage_missing",
            "usage_partial",
            "usage_zero",
            "usage_invalid_sibling",
            "usage_invalid_object",
            "chat_incomplete",
            "chat_unknown",
            "chat_error",
            "malformed_chat",
            "malformed_messages",
            "malformed_responses",
            "grok_failed",
            "grok_quota",
            "grok_unknown",
            "grok_malformed",
            "grok_background",
            "siwc_missing_terminal",
            "siwc_conflicting_terminal",
            "siwc_first_failed",
            "siwc_first_completed",
            "siwc_reconstruct",
            "fallback",
            "siwc_proactive",
            "siwc_401",
            "grok_proactive",
            "grok_401",
            "borrowed_changed",
            "borrowed_unchanged",
            "body_read_error",
            "body_cancelled",
            "body_timeout",
            "body_cap",
            "preheaders_cancelled",
            "preheaders_timeout",
            "reservation_failure",
            "finalization_failure",
            "reopen_history",
            "cross_surface",
        ]
        .into_iter()
        .map(str::to_owned),
    );
    names
}

/// Run the separate confinement proof before this actual gateway HTTP acceptance entry.
/// Every Harness also seals its endpoints before inference, so native suite test order
/// cannot enable a production destination even when proof and acceptance run concurrently.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn bh_http_settlement_acceptance() {
    let mut h = Harness::with_timeout(Duration::from_millis(750)).await;
    let mut cases = Vec::new();
    let mut stages = Vec::new();
    let start = h.fixture.records.lock().unwrap().len();
    for provider in ["generic", "siwc", "grok", "opencode"] {
        for protocol in 0..3 {
            let name = format!("success_{provider}_{}", protocol_name(protocol));
            h.setup(&name, provider).await;
            let reply = complete_reply(provider);
            let original = reply.bytes.clone();
            let mark = h.plan(vec![reply]);
            let response = h.request(protocol, &name).await;
            assert_eq!(response.status(), StatusCode::OK);
            let bytes = response.bytes().await.unwrap();
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            let text = match protocol {
                0 => value.pointer("/choices/0/message/content"),
                1 => value.pointer("/content/0/text"),
                _ => value.pointer("/output/0/content/0/text"),
            };
            assert_eq!(text, Some(&json!("fixture-output")));
            if provider == "grok" && protocol == 2 {
                assert_eq!(bytes.as_ref(), original);
            }
            if provider == "generic" && protocol == 0 {
                assert_eq!(bytes.as_ref(), original);
            }
            h.completed(mark, &["inference"]);
            let rows = h.settled(&name, 1).await;
            check_row(
                &rows[0],
                provider,
                Some(200),
                "succeeded",
                "complete",
                (Some(11), Some(7)),
                provider == "siwc",
            );
            assert_eq!(
                h.fixture.records.lock().unwrap()[mark]["stream"],
                provider == "siwc"
            );
            record_case(
                &mut cases,
                &name,
                provider,
                protocol,
                1,
                &rows,
                Some(200),
                if provider == "grok" && protocol == 2 {
                    "exact native bytes"
                } else {
                    "original text through client projection"
                },
            );
        }
    }
    stages.push(stage(&h, "twelve_family_client_success", start, 12));

    let start = h.fixture.records.lock().unwrap().len();
    for (provider, protocol) in [("generic", 1), ("grok", 2), ("siwc", 0)] {
        let name = format!("tools_{provider}_{}", protocol_name(protocol));
        h.setup(&name, provider).await;
        let mut value = if provider == "generic" {
            chat_value()
        } else {
            response_value()
        };
        if provider == "generic" {
            value["choices"][0]["finish_reason"] = json!("tool_calls");
            value["choices"][0]["message"] = json!({"role":"assistant","content":null,"tool_calls":[{"id":"synthetic-call","type":"function","function":{"name":"lookup","arguments":"{}"}}]});
        } else {
            value["output"] = json!([{"type":"function_call","id":"synthetic-item","call_id":"synthetic-call","name":"lookup","arguments":"{}"}]);
        }
        let reply = if provider == "siwc" {
            let mut r = sse_reply(value, false);
            let mut prefix=b"data: {\"type\":\"response.function_call_arguments.delta\",\"item_id\":\"synthetic-item\",\"delta\":\"{}\"}\n\n".to_vec();
            prefix.extend(r.bytes);
            r.bytes = prefix;
            r
        } else {
            json_reply(value)
        };
        let original = reply.bytes.clone();
        let mark = h.plan(vec![reply]);
        let response = h.request_options(protocol, &name, false, true).await;
        assert_eq!(response.status(), StatusCode::OK);
        let bytes = response.bytes().await.unwrap();
        let value: Value = serde_json::from_slice(&bytes).unwrap();
        let tool = match protocol {
            0 => value.pointer("/choices/0/message/tool_calls/0/function/name"),
            1 => value.pointer("/content/0/name"),
            _ => value.pointer("/output/0/name"),
        };
        assert_eq!(tool, Some(&json!("lookup")));
        if provider == "grok" {
            assert_eq!(bytes.as_ref(), original);
        }
        h.completed(mark, &["inference"]);
        assert!(
            h.fixture.records.lock().unwrap()[mark]["tools"]
                .as_u64()
                .unwrap()
                > 0
        );
        let rows = h.settled(&name, 1).await;
        check_row(
            &rows[0],
            provider,
            Some(200),
            "succeeded",
            "complete",
            (Some(11), Some(7)),
            provider == "siwc",
        );
        record_case(
            &mut cases,
            &name,
            provider,
            protocol,
            1,
            &rows,
            Some(200),
            "supported tool request and reply mapping; native bytes where applicable",
        );
    }
    stages.push(stage(&h, "representative_tools", start, 3));

    let start = h.fixture.records.lock().unwrap().len();
    for (name, usage, quality, tokens) in [
        ("usage_missing", Value::Null, "missing", (None, None)),
        (
            "usage_partial",
            json!({"prompt_tokens":11}),
            "partial",
            (Some(11), None),
        ),
        (
            "usage_zero",
            json!({"prompt_tokens":0,"completion_tokens":0}),
            "complete",
            (Some(0), Some(0)),
        ),
        (
            "usage_invalid_sibling",
            json!({"prompt_tokens":-1,"completion_tokens":7}),
            "invalid",
            (None, Some(7)),
        ),
        (
            "usage_invalid_object",
            json!("invalid"),
            "invalid",
            (None, None),
        ),
    ] {
        h.setup(name, "generic").await;
        let mut value = chat_value();
        value["usage"] = usage;
        let reply = json_reply(value);
        let original = reply.bytes.clone();
        let mark = h.plan(vec![reply]);
        let response = h.request(0, name).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.bytes().await.unwrap().as_ref(), original);
        h.completed(mark, &["inference"]);
        let rows = h.settled(name, 1).await;
        check_row(
            &rows[0],
            "generic",
            Some(200),
            "succeeded",
            quality,
            tokens,
            false,
        );
        record_case(
            &mut cases,
            name,
            "generic",
            0,
            1,
            &rows,
            Some(200),
            "unchanged permissive Chat bytes",
        );
    }
    for (name, finish, outcome) in [
        ("chat_incomplete", json!("length"), "incomplete"),
        ("chat_unknown", Value::Null, "unknown"),
        ("chat_error", json!("stop"), "failed"),
    ] {
        h.setup(name, "generic").await;
        let mut value = chat_value();
        value["choices"][0]["finish_reason"] = finish;
        if name == "chat_error" {
            value["error"] = json!({"code":"synthetic_error","message":"PRIVATE-CANARY"});
        }
        let reply = json_reply(value);
        let original = reply.bytes.clone();
        let mark = h.plan(vec![reply]);
        let response = h.request(0, name).await;
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.bytes().await.unwrap().as_ref(), original);
        h.completed(mark, &["inference"]);
        let rows = h.settled(name, 1).await;
        check_row(
            &rows[0],
            "generic",
            Some(200),
            outcome,
            "complete",
            (Some(11), Some(7)),
            false,
        );
        record_case(
            &mut cases,
            name,
            "generic",
            0,
            1,
            &rows,
            Some(200),
            "original finish evidence without new Chat validation",
        );
    }
    for protocol in 0..3 {
        let name = format!("malformed_{}", protocol_name(protocol));
        h.setup(&name, "generic").await;
        let mark = h.plan(vec![Reply {
            bytes: b"{malformed synthetic".to_vec(),
            ..Reply::chat()
        }]);
        let response = h.request(protocol, &name).await;
        let expected = if protocol == 0 { 200 } else { 400 };
        assert_eq!(response.status().as_u16(), expected);
        let bytes = response.bytes().await.unwrap();
        if protocol == 0 {
            assert_eq!(bytes.as_ref(), b"{malformed synthetic");
        }
        h.completed(mark, &["inference"]);
        let rows = h.settled(&name, 1).await;
        check_row(
            &rows[0],
            "generic",
            Some(200),
            if protocol == 0 { "unknown" } else { "failed" },
            "invalid",
            (None, None),
            false,
        );
        record_case(
            &mut cases,
            &name,
            "generic",
            protocol,
            1,
            &rows,
            Some(expected),
            "existing Chat passthrough versus client conversion status preserved",
        );
    }
    for name in [
        "grok_failed",
        "grok_quota",
        "grok_unknown",
        "grok_malformed",
        "grok_background",
    ] {
        h.setup(name, "grok").await;
        let mut value = response_value();
        let background = name == "grok_background";
        if name == "grok_failed" || name == "grok_quota" {
            value["status"] = json!("failed");
            value["error"] = json!({"code":if name=="grok_quota" {"subscription_sharing_usage_limit_exceeded"}else{"synthetic_error"},"message":"PRIVATE-CANARY"});
        }
        if name == "grok_unknown" {
            value["status"] = json!("future_unknown");
        }
        if background {
            value["status"] = json!("queued");
            value["background"] = json!(true);
        }
        let mut reply = json_reply(value);
        if name == "grok_malformed" {
            reply.bytes = b"{malformed synthetic".to_vec();
        }
        let original = reply.bytes.clone();
        let mark = h.plan(vec![reply]);
        let response = h.request_options(2, name, background, false).await;
        let status = if background {
            200
        } else if name == "grok_quota" {
            429
        } else {
            502
        };
        assert_eq!(response.status().as_u16(), status);
        let bytes = response.bytes().await.unwrap();
        if background {
            assert_eq!(bytes.as_ref(), original);
        } else {
            assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE-CANARY"));
        }
        h.completed(mark, &["inference"]);
        let rows = h.settled(name, 1).await;
        let malformed = name == "grok_malformed";
        check_row(
            &rows[0],
            "grok",
            Some(200),
            if background { "unknown" } else { "failed" },
            if malformed { "invalid" } else { "complete" },
            if malformed {
                (None, None)
            } else {
                (Some(11), Some(7))
            },
            false,
        );
        record_case(
            &mut cases,
            name,
            "grok",
            2,
            1,
            &rows,
            Some(status),
            if background {
                "exact native background bytes without completion or polling"
            } else {
                "fixed existing native Responses error status"
            },
        );
    }
    stages.push(stage(&h, "raw_usage_and_json_outcomes", start, 16));

    let start = h.fixture.records.lock().unwrap().len();
    for name in [
        "siwc_missing_terminal",
        "siwc_conflicting_terminal",
        "siwc_first_failed",
        "siwc_first_completed",
        "siwc_reconstruct",
    ] {
        h.setup(name, "siwc").await;
        let mut value = response_value();
        let mut raw = String::new();
        if name == "siwc_missing_terminal" {
            raw.push_str(
                "data: {\"type\":\"response.created\",\"response\":{\"id\":\"synthetic\"}}\n\n",
            );
        }
        if name == "siwc_conflicting_terminal" {
            value["status"] = json!("failed");
            raw.push_str(&frame("response.completed", value.clone()));
        }
        if name == "siwc_first_failed" {
            value["status"] = json!("failed");
            value["error"] = json!({"code":"synthetic_error","message":"PRIVATE-CANARY"});
            raw.push_str(&frame("response.failed", value.clone()));
            let mut later = response_value();
            later["usage"] = json!({"input_tokens":999,"output_tokens":888});
            raw.push_str(&frame("response.completed", later));
        }
        if name == "siwc_first_completed" {
            raw.push_str(&frame("response.completed", value.clone()));
            let mut later = response_value();
            later["usage"] = json!({"input_tokens":999,"output_tokens":888});
            raw.push_str(&frame("response.completed", later));
        }
        if name == "siwc_reconstruct" {
            raw.push_str(
                "data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture-output\"}\n\n",
            );
            value["output"] = json!([]);
            raw.push_str(&frame("response.completed", value.clone()));
        }
        let mark = h.plan(vec![Reply {
            content_type: "text/event-stream",
            bytes: raw.into_bytes(),
            ..Reply::chat()
        }]);
        let response = h.request(2, name).await;
        let success = ["siwc_first_completed", "siwc_reconstruct"].contains(&name);
        let status = if success { 200 } else { 502 };
        assert_eq!(response.status().as_u16(), status);
        let bytes = response.bytes().await.unwrap();
        if success {
            let value: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(value["usage"]["input_tokens"], 11);
            assert_eq!(value["output"][0]["content"][0]["text"], "fixture-output");
        } else {
            assert!(!String::from_utf8_lossy(&bytes).contains("PRIVATE-CANARY"));
        }
        h.completed(mark, &["inference"]);
        let rows = h.settled(name, 1).await;
        let missing = name == "siwc_missing_terminal";
        check_row(
            &rows[0],
            "siwc",
            Some(200),
            if success { "succeeded" } else { "failed" },
            if missing { "missing" } else { "complete" },
            if missing {
                (None, None)
            } else {
                (Some(11), Some(7))
            },
            name == "siwc_reconstruct",
        );
        record_case(
            &mut cases,
            name,
            "siwc",
            2,
            1,
            &rows,
            Some(status),
            "existing first terminal, failed-prefix and reconstruction semantics",
        );
    }
    stages.push(stage(&h, "forced_sse_terminal_contract", start, 5));

    let start = h.fixture.records.lock().unwrap().len();
    let name = "fallback";
    let first = h
        .connection("fallback-first", "generic", false, false, None)
        .await;
    let second = h
        .connection("fallback-second", "generic", false, false, None)
        .await;
    h.route(name, &[first, second]).await;
    let mark = h.plan(vec![http_error(503), Reply::chat()]);
    let response = h.request(0, name).await;
    assert_eq!(response.status(), StatusCode::OK);
    let _ = response.bytes().await.unwrap();
    h.completed(mark, &["inference", "inference"]);
    let rows = h.settled(name, 2).await;
    group(&rows);
    check_row(
        &rows[0],
        "generic",
        Some(503),
        "failed",
        "missing",
        (None, None),
        false,
    );
    check_row(
        &rows[1],
        "generic",
        Some(200),
        "succeeded",
        "complete",
        (Some(11), Some(7)),
        false,
    );
    record_case(
        &mut cases,
        name,
        "generic",
        0,
        2,
        &rows,
        Some(200),
        "existing fallback success after failed dispatch",
    );
    for provider in ["siwc", "grok"] {
        for proactive in [true, false] {
            let name = format!("{provider}_{}", if proactive { "proactive" } else { "401" });
            let id = h.connection(&name, provider, true, proactive, None).await;
            h.route(&name, &[id]).await;
            let mut success = complete_reply(provider);
            success.expected_access = Some("synthetic-fresh");
            let replies = if proactive {
                vec![refresh_reply(), success]
            } else {
                vec![http_error(401), refresh_reply(), success]
            };
            let mark = h.plan(replies);
            let response = h.request(2, &name).await;
            assert_eq!(response.status(), StatusCode::OK);
            let _ = response.bytes().await.unwrap();
            h.completed(
                mark,
                if proactive {
                    &["refresh", "inference"]
                } else {
                    &["inference", "refresh", "inference"]
                },
            );
            let rows = h.settled(&name, if proactive { 1 } else { 2 }).await;
            group(&rows);
            if !proactive {
                check_row(
                    &rows[0],
                    provider,
                    Some(401),
                    "failed",
                    "missing",
                    (None, None),
                    false,
                );
            }
            check_row(
                rows.last().unwrap(),
                provider,
                Some(200),
                "succeeded",
                "complete",
                (Some(11), Some(7)),
                provider == "siwc",
            );
            record_case(
                &mut cases,
                &name,
                provider,
                2,
                rows.len(),
                &rows,
                Some(200),
                "existing imported OAuth proactive or legal401 retry only",
            );
        }
    }
    for changed in [true, false] {
        let name = if changed {
            "borrowed_changed"
        } else {
            "borrowed_unchanged"
        };
        let parent = h.dir.path().join(name).join(".grok");
        std::fs::create_dir_all(&parent).unwrap();
        let path = parent.join("auth.json");
        let original = format!(
            r#"{{"synthetic":{{"key":"{ACCESS}","refresh_token":"synthetic-owned-by-fixture"}}}}"#
        );
        std::fs::write(&path, &original).unwrap();
        let id = h
            .connection(
                name,
                "grok",
                true,
                true,
                Some(json!({"source":path}).to_string()),
            )
            .await;
        h.route(name, &[id]).await;
        let mut failure = http_error(401);
        if changed {
            failure.rotate = Some(path.clone());
        }
        let mut replies = vec![failure];
        if changed {
            let mut success = complete_reply("grok");
            success.expected_access = Some("synthetic-fresh");
            replies.push(success);
        }
        let mark = h.plan(replies);
        let response = h.request(2, name).await;
        let status = if changed { 200 } else { 401 };
        assert_eq!(response.status().as_u16(), status);
        let _ = response.bytes().await.unwrap();
        h.completed(
            mark,
            if changed {
                &["inference", "inference"]
            } else {
                &["inference"]
            },
        );
        let rows = h.settled(name, if changed { 2 } else { 1 }).await;
        group(&rows);
        check_row(
            &rows[0],
            "grok",
            Some(401),
            "failed",
            "missing",
            (None, None),
            false,
        );
        if changed {
            check_row(
                &rows[1],
                "grok",
                Some(200),
                "succeeded",
                "complete",
                (Some(11), Some(7)),
                false,
            );
            assert_eq!(
                std::fs::read_to_string(&path).unwrap(),
                r#"{"synthetic":{"key":"synthetic-fresh","refresh_token":"synthetic-owned-by-fixture"}}"#
            );
        } else {
            assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
        }
        record_case(
            &mut cases,
            name,
            "grok",
            2,
            rows.len(),
            &rows,
            Some(status),
            "borrowed synthetic file only fixture rotates; no refresh or gateway writes",
        );
    }
    stages.push(stage(&h, "fallback_refresh_borrowed", start, 7));

    let start = h.fixture.records.lock().unwrap().len();
    for name in [
        "body_read_error",
        "body_cancelled",
        "body_timeout",
        "body_cap",
        "preheaders_cancelled",
        "preheaders_timeout",
    ] {
        h.setup(name, "generic").await;
        let end = if name == "body_read_error" {
            End::ReadError
        } else if name.starts_with("preheaders") {
            End::HeadersHold
        } else {
            End::Hold
        };
        let mut bytes = b"{".to_vec();
        if name == "body_cap" {
            bytes.resize(16 * 1024 * 1024 + 1, b' ');
        }
        let mark = h.plan(vec![Reply {
            bytes,
            end,
            ..Reply::chat()
        }]);
        let cancelled = name.ends_with("cancelled");
        let preheaders = name.starts_with("preheaders");
        let status = if cancelled {
            h.assert_bound_endpoints();
            h.diagnostic(name, "raw_client_start");
            use tokio::io::AsyncWriteExt;
            let (path, body) = client_body(0, name);
            let body = body.to_string();
            let mut socket = tokio::net::TcpStream::connect(h.gateway.address)
                .await
                .unwrap();
            h.client_requests.fetch_add(1, Ordering::SeqCst);
            socket.write_all(format!("POST {path} HTTP/1.1\r\nHost: {}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}",h.gateway.address,h.key,body.len()).as_bytes()).await.unwrap();
            if preheaders {
                timeout(Duration::from_secs(3), async {
                    while h.fixture.records.lock().unwrap().len() == mark {
                        tokio::time::sleep(Duration::from_millis(5)).await;
                    }
                })
                .await
                .unwrap();
            } else {
                h.observed_headers(name).await;
            }
            drop(socket);
            None
        } else {
            let response = if name == "body_read_error" {
                let (response, ()) = tokio::join!(h.request(0, name), async {
                    h.observed_headers(name).await;
                    h.fixture.release.notify_one();
                });
                response
            } else {
                h.request(0, name).await
            };
            let status = response.status().as_u16();
            assert_eq!(
                status,
                if preheaders || name == "body_cap" {
                    502
                } else {
                    500
                }
            );
            let _ = response.bytes().await.unwrap();
            Some(status)
        };
        h.completed(mark, &["inference"]);
        let rows = h.settled(name, 1).await;
        h.body_released().await;
        let outcome = if cancelled {
            "cancelled"
        } else if name.ends_with("timeout") {
            "timeout"
        } else {
            "failed"
        };
        check_row(
            &rows[0],
            "generic",
            if preheaders { None } else { Some(200) },
            outcome,
            "missing",
            (None, None),
            false,
        );
        if preheaders {
            assert!(rows[0].headers_ms.is_none());
        } else {
            assert!(rows[0].headers_ms.is_some());
        }
        record_case(
            &mut cases,
            name,
            "generic",
            0,
            1,
            &rows,
            status,
            "owned real HTTP interruption/readerror/request750ms deadline/received16MiB cap",
        );
    }
    stages.push(stage(
        &h,
        "buffered_body_and_preheaders_lifecycle",
        start,
        6,
    ));

    let start = h.fixture.records.lock().unwrap().len();
    let name = "reservation_failure";
    let first = h
        .connection("reserve-first", "generic", false, false, None)
        .await;
    let second = h
        .connection("reserve-second", "generic", false, false, None)
        .await;
    h.route(name, &[first, second]).await;
    let sql = rusqlite::Connection::open(h.dir.path().join("thinrouter.db")).unwrap();
    sql.execute_batch("CREATE TRIGGER bh_fail_reserve BEFORE INSERT ON usage_events WHEN NEW.public_model='reservation_failure' BEGIN SELECT RAISE(FAIL,'synthetic reserve failure'); END;").unwrap();
    let mark = h.plan(Vec::new());
    let response = h.request(0, name).await;
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let _ = response.bytes().await.unwrap();
    h.completed(mark, &[]);
    assert!(h.rows(name).is_empty());
    sql.execute_batch("DROP TRIGGER bh_fail_reserve;").unwrap();
    record_case(
        &mut cases,
        name,
        "generic",
        0,
        0,
        &[],
        Some(503),
        "reservation failure prohibits inference and fallback",
    );
    let name = "finalization_failure";
    h.setup(name, "generic").await;
    sql.execute_batch("CREATE TRIGGER bh_fail_finalize BEFORE UPDATE OF finalized_at ON usage_events WHEN OLD.public_model='finalization_failure' BEGIN SELECT RAISE(FAIL,'synthetic finalize failure'); END;").unwrap();
    let mark = h.plan(vec![Reply::chat()]);
    let response = h.request(0, name).await;
    assert_eq!(response.status(), StatusCode::OK);
    let _ = response.bytes().await.unwrap();
    h.completed(mark, &["inference"]);
    let pending = h.rows(name);
    assert_eq!(pending.len(), 1);
    assert!(pending[0].attempt_id.is_some() && pending[0].finalized_at.is_none());
    assert_eq!(pending[0].status, Some(200));
    assert!(pending[0].prompt_tokens.is_none());
    record_case(
        &mut cases,
        name,
        "generic",
        0,
        1,
        &pending,
        Some(200),
        "one dispatch leaves pending after failed durable finalization",
    );
    sql.execute_batch("DROP TRIGGER bh_fail_finalize;").unwrap();
    drop(sql);
    stages.push(stage(&h, "storage_failure_without_replay", start, 2));

    let start = h.fixture.records.lock().unwrap().len();
    let history: Vec<_> = h
        .store
        .recent_usage(1000)
        .unwrap()
        .into_iter()
        .filter(|r| r.finalized_at.is_some())
        .map(|r| (r.id, serde_json::to_value(r).unwrap()))
        .collect();
    h.gateway.close().await;
    let owner = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(h.dir.path().join("thinrouter.usage-lock"))
        .unwrap();
    owner.try_lock().unwrap();
    h.store = Store::open(&h.dir.path().join("thinrouter.db"), None).unwrap();
    assert_eq!(
        h.store
            .recent_usage(1000)
            .unwrap()
            .iter()
            .filter(|r| r.finalized_at.is_none())
            .count(),
        1
    );
    assert_eq!(h.store.recover_stream_attempts().unwrap(), 1);
    assert_eq!(h.store.recover_stream_attempts().unwrap(), 0);
    let after = h.store.recent_usage(1000).unwrap();
    for (id, before) in history {
        assert_eq!(
            serde_json::to_value(after.iter().find(|r| r.id == id).unwrap()).unwrap(),
            before
        );
    }
    let recovered = h.rows("finalization_failure");
    assert_eq!(recovered[0].outcome, "interrupted");
    assert!(recovered[0].prompt_tokens.is_none() && recovered[0].total_observed_ms.is_none());
    h.gateway = Harness::start_gateway(
        h.dir.path(),
        h.store.clone(),
        h.upstream.clone(),
        &format!("http://{}", h.fake.address),
    )
    .await;
    assert_eq!(h.fixture.records.lock().unwrap().len(), start);
    record_case(
        &mut cases,
        "reopen_history",
        "generic",
        0,
        0,
        &[],
        None,
        "owned startup recovery once, settled history unchanged and no inference replay",
    );
    stages.push(stage(&h, "reopen_preserved_history", start, 1));
    let start = h.fixture.records.lock().unwrap().len();
    let surfaces = reconcile(&h).await;
    record_case(
        &mut cases,
        "cross_surface",
        "all",
        2,
        0,
        &[],
        None,
        "SQLite authenticated JSON/CSV and matching daily/Web metric scopes",
    );
    stages.push(stage(&h, "sqlite_json_csv_web_reconciliation", start, 1));
    let mut inventory = expected_case_names();
    inventory.sort();
    let mut actual: Vec<_> = cases
        .iter()
        .map(|c| c["case"].as_str().unwrap().to_owned())
        .collect();
    actual.sort();
    assert_eq!(actual, inventory);
    let attempts = h.store.recent_usage(1000).unwrap();
    let records = h.fixture.records.lock().unwrap().clone();
    let inference = records
        .iter()
        .filter(|r| r["operation"] == "inference")
        .count();
    let refresh = records.len() - inference;
    assert_eq!(inference, 54);
    assert_eq!(refresh, 4);
    assert_eq!(attempts.len(), inference);
    let ids: HashSet<_> = attempts
        .iter()
        .map(|r| r.attempt_id.as_ref().unwrap())
        .collect();
    assert_eq!(ids.len(), attempts.len());
    let counts = json!({"inference":inference,"refresh":refresh,"discovery":0,"client_inference_requests":h.client_requests.load(Ordering::SeqCst),"admin_http_requests":h.admin_requests.load(Ordering::SeqCst),"unexpected_destinations":h.fixture.denied.load(Ordering::SeqCst)});
    let cleanup = h.close().await;
    drop(owner);
    println!(
        "BUFFERED_HTTP_SETTLEMENT_REPORT={}",
        json!({"schema_version":1,"kind":"buffered_http_settlement","status":"passed","synthetic":true,"actual_gateway_http":true,
        "live_client_version_provider_verified":false,"whole_round_metrics":null,"preflight":{"exact_loopback":true,"mandatory_nonforwarding_proxy":true,"refresh_test_transport":true,"no_environment_mutation":true},
        "case_inventory":inventory,"case_results":cases,"stage_inventory":stages.iter().map(|s|s["stage"].clone()).collect::<Vec<_>>(),"stages":stages,"counts":counts,
        "reservations":records,"attempts":attempts,"surfaces":surfaces,"buffered_request_timeout_ms":750,"sse_stall_seconds":5,
        "accounting":{"inference_matches_rows":true,"distinct_attempt_ids":true,"no_refresh_rows":true,"sql_json_csv_web_reconciled":true,"history_preserved":true,"recovery_once":true},"cleanup":cleanup})
    );
}

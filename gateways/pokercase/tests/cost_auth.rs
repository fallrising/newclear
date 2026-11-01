//! HTTP admission tests. Every upstream is a local, counted fake; no paid API calls.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

#[path = "support/owned_gateway.rs"]
mod owned_gateway;
use owned_gateway::{command, FailureCode, OwnedGateway};

const INFERENCE_PATHS: [&str; 6] = [
    "/v1/chat/completions",
    "/chat/completions",
    "/v1/messages",
    "/messages",
    "/v1/responses",
    "/responses",
];

struct FakeUpstream {
    url: String,
    calls: Arc<AtomicUsize>,
    task: tokio::task::JoinHandle<()>,
}

impl Drop for FakeUpstream {
    fn drop(&mut self) {
        self.task.abort();
    }
}

async fn fake_upstream() -> FakeUpstream {
    let calls = Arc::new(AtomicUsize::new(0));
    let counter = calls.clone();
    let app = Router::new().route("/v1/chat/completions", post(move || {
        let counter = counter.clone();
        async move {
            counter.fetch_add(1, Ordering::SeqCst);
            Json(json!({
                "id": "chatcmpl-local", "object": "chat.completion", "model": "mock",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "local"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
            }))
        }
    }));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    let task = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    FakeUpstream { url, calls, task }
}

struct Gateway {
    base: String,
    client: reqwest::Client,
    /// Explicit `--admin-token`, or the generated `<data_dir>/admin-token`.
    admin: String,
    owner: OwnedGateway,
    _dir: TempDir,
}

impl Gateway {
    async fn start(host: &str, bootstrap: bool, admin: Option<&str>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let owner = OwnedGateway::start(
            command(dir.path(), host, 0, bootstrap, admin),
            dir.path(),
            host,
            admin,
            Duration::from_secs(5),
        )
        .await
        .unwrap_or_else(|failure| panic!("{failure}"));
        Self {
            base: owner.base.clone(),
            client: owner.client.clone(),
            admin: owner.admin.clone(),
            owner,
            _dir: dir,
        }
    }

    fn admin_post(&self, path: &str) -> reqwest::RequestBuilder {
        self.client
            .post(format!("{}{path}", self.base))
            .header("x-admin-token", &self.admin)
    }

    async fn add_upstream(&self, fake: &FakeUpstream) {
        let req = self.admin_post("/admin/api/connections").json(&json!({
            "name": "mock", "base_url": fake.url, "api_key": "local-placeholder", "default_model": "mock",
        }));
        assert_eq!(req.send().await.unwrap().status(), 201);
    }

    async fn create_key(&self) -> Value {
        let req = self
            .admin_post("/admin/api/keys")
            .json(&json!({"name": "client"}));
        let resp = req.send().await.unwrap();
        assert_eq!(resp.status(), 201);
        resp.json().await.unwrap()
    }

    async fn assert_inference(&self, expected: u16, header: Option<(&str, &str)>) {
        for path in INFERENCE_PATHS {
            let mut req = self
                .client
                .post(format!("{}{path}", self.base))
                .json(&json!({
                    "model": "mock", "messages": [{"role": "user", "content": "hi"}],
                    "input": "hi", "max_tokens": 8, "max_output_tokens": 8,
                }));
            if let Some((name, value)) = header {
                req = req.header(name, value);
            }
            let resp = req.send().await.unwrap();
            assert_eq!(
                resp.status(),
                expected,
                "{path}: {}",
                resp.text().await.unwrap()
            );
        }
    }

    async fn assert_models(&self, expected: u16) {
        for path in ["/v1/models", "/models"] {
            assert_eq!(
                self.client
                    .get(format!("{}{path}", self.base))
                    .send()
                    .await
                    .unwrap()
                    .status(),
                expected,
                "{path}"
            );
        }
    }
}

#[tokio::test]
async fn empty_and_disabled_keys_reject_before_all_upstream_surfaces() {
    let fake = fake_upstream().await;
    let mut gateway = Gateway::start("127.0.0.1", false, None).await;
    gateway.add_upstream(&fake).await;
    gateway.assert_inference(401, None).await;
    gateway
        .assert_inference(401, Some(("authorization", "Bearer invalid")))
        .await;
    gateway
        .assert_inference(401, Some(("x-api-key", "invalid")))
        .await;
    gateway.assert_models(401).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 0);

    let key = gateway.create_key().await;
    let secret = key["secret"].as_str().unwrap();
    let bearer = format!("Bearer {secret}");
    gateway
        .assert_inference(200, Some(("authorization", &bearer)))
        .await;
    gateway
        .assert_inference(200, Some(("x-api-key", secret)))
        .await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 12);

    let resp = gateway
        .admin_post(&format!(
            "/admin/api/keys/{}/disable",
            key["key"]["id"].as_str().unwrap()
        ))
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    gateway.assert_inference(401, None).await;
    gateway
        .assert_inference(401, Some(("authorization", &bearer)))
        .await;
    gateway
        .assert_inference(401, Some(("x-api-key", "invalid")))
        .await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 12);
    gateway.owner.shutdown().await;
}

#[tokio::test]
async fn explicit_loopback_bootstrap_only_accepts_absent_credentials_and_zero_total_keys() {
    let fake = fake_upstream().await;
    let mut gateway = Gateway::start("127.0.0.1", true, None).await;
    gateway.add_upstream(&fake).await;
    for credential in ["Basic invalid", "Bearer ", "Bearer invalid"] {
        gateway
            .assert_inference(401, Some(("authorization", credential)))
            .await;
    }
    gateway.assert_inference(401, Some(("x-api-key", ""))).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 0);
    gateway.assert_inference(200, None).await;
    gateway.assert_models(200).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 6);

    let key = gateway.create_key().await;
    gateway.assert_inference(401, None).await;
    let id = key["key"]["id"].as_str().unwrap();
    assert_eq!(
        gateway
            .admin_post(&format!("/admin/api/keys/{id}/disable"))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    gateway.assert_inference(401, None).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 6);
    gateway.owner.shutdown().await;
}

#[tokio::test]
async fn public_listener_requires_admin_auth_and_gateway_auth() {
    let fake = fake_upstream().await;
    let mut gateway = Gateway::start("0.0.0.0", false, Some("local-admin-test")).await;
    gateway.add_upstream(&fake).await;
    for path in ["/admin/api/keys", "/admin/api/connections/mock/test"] {
        assert_eq!(
            gateway
                .client
                .post(format!("{}{path}", gateway.base))
                .json(&json!({"name": "attacker"}))
                .send()
                .await
                .unwrap()
                .status(),
            401
        );
    }
    gateway.assert_inference(401, None).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 0);
    let key = gateway.create_key().await;
    gateway
        .assert_inference(200, Some(("x-api-key", key["secret"].as_str().unwrap())))
        .await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 6);
    gateway.owner.shutdown().await;
}

#[tokio::test]
async fn public_bootstrap_and_unprotected_admin_fail_before_listener_start() {
    let dir = tempfile::tempdir().unwrap();
    for (bootstrap, token) in [
        (true, Some("local-admin-test")),
        (false, None),
        (false, Some(" ")),
    ] {
        let failure = OwnedGateway::start(
            command(dir.path(), "0.0.0.0", 0, bootstrap, token),
            dir.path(),
            "0.0.0.0",
            token,
            Duration::from_secs(5),
        )
        .await
        .unwrap_err();
        assert_eq!(failure.code, FailureCode::ChildExited);
        assert!(failure.diagnostics.exit_code.is_some_and(|code| code != 0));
        assert_eq!(failure.diagnostics.health_request_attempts, 0);
        assert_eq!(failure.diagnostics.admin_request_attempts, 0);
        assert!(failure.diagnostics.child_reaped);
        assert!(failure.diagnostics.drainer_closed);
    }
}

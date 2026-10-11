//! HTTP admission tests. Every upstream is a local, counted fake; no paid API calls.

use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

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

fn command(
    data_dir: &Path,
    host: &str,
    port: u16,
    bootstrap: bool,
    admin: Option<&str>,
) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
    cmd.args([
        "serve",
        "--host",
        host,
        "--port",
        &port.to_string(),
        "--data-dir",
        data_dir.to_str().unwrap(),
    ]);
    if bootstrap {
        cmd.arg("--allow-keyless-bootstrap");
    }
    if let Some(token) = admin {
        cmd.args(["--admin-token", token]);
    }
    for name in [
        "THINROUTER_ADMIN_TOKEN",
        "THINROUTER_SECRETS_KEY",
        "THINROUTER_ALLOW_KEYLESS_BOOTSTRAP",
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
    ] {
        cmd.env_remove(name);
    }
    cmd.kill_on_drop(true)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    cmd
}

struct Gateway {
    base: String,
    client: reqwest::Client,
    child: tokio::process::Child,
    _dir: TempDir,
}

impl Gateway {
    async fn start(host: &str, bootstrap: bool, admin: Option<&str>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let mut child = command(dir.path(), host, port, bootstrap, admin)
            .spawn()
            .unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        for _ in 0..80 {
            assert!(
                child.try_wait().unwrap().is_none(),
                "gateway exited before health"
            );
            if let Ok(resp) = client.get(format!("{base}/health")).send().await {
                if resp.status().is_success() {
                    return Self {
                        base,
                        client,
                        child,
                        _dir: dir,
                    };
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("gateway did not become healthy");
    }

    async fn add_upstream(&self, fake: &FakeUpstream, admin: Option<&str>) {
        let mut req = self.client.post(format!("{}/admin/api/connections", self.base)).json(&json!({
            "name": "mock", "base_url": fake.url, "api_key": "local-placeholder", "default_model": "mock",
        }));
        if let Some(token) = admin {
            req = req.header("x-admin-token", token);
        }
        assert_eq!(req.send().await.unwrap().status(), 201);
    }

    async fn create_key(&self, admin: Option<&str>) -> Value {
        let mut req = self
            .client
            .post(format!("{}/admin/api/keys", self.base))
            .json(&json!({"name": "client"}));
        if let Some(token) = admin {
            req = req.header("x-admin-token", token);
        }
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
    gateway.add_upstream(&fake, None).await;
    gateway.assert_inference(401, None).await;
    gateway
        .assert_inference(401, Some(("authorization", "Bearer invalid")))
        .await;
    gateway
        .assert_inference(401, Some(("x-api-key", "invalid")))
        .await;
    gateway.assert_models(401).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 0);

    let key = gateway.create_key(None).await;
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
        .client
        .post(format!(
            "{}/admin/api/keys/{}/disable",
            gateway.base,
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
    gateway.child.kill().await.unwrap();
}

#[tokio::test]
async fn explicit_loopback_bootstrap_only_accepts_absent_credentials_and_zero_total_keys() {
    let fake = fake_upstream().await;
    let mut gateway = Gateway::start("127.0.0.1", true, None).await;
    gateway.add_upstream(&fake, None).await;
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

    let key = gateway.create_key(None).await;
    gateway.assert_inference(401, None).await;
    let id = key["key"]["id"].as_str().unwrap();
    assert_eq!(
        gateway
            .client
            .post(format!("{}/admin/api/keys/{id}/disable", gateway.base))
            .send()
            .await
            .unwrap()
            .status(),
        200
    );
    gateway.assert_inference(401, None).await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 6);
    gateway.child.kill().await.unwrap();
}

#[tokio::test]
async fn public_listener_requires_admin_auth_and_gateway_auth() {
    let fake = fake_upstream().await;
    let mut gateway = Gateway::start("0.0.0.0", false, Some("local-admin-test")).await;
    gateway.add_upstream(&fake, Some("local-admin-test")).await;
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
    let key = gateway.create_key(Some("local-admin-test")).await;
    gateway
        .assert_inference(200, Some(("x-api-key", key["secret"].as_str().unwrap())))
        .await;
    assert_eq!(fake.calls.load(Ordering::SeqCst), 6);
    gateway.child.kill().await.unwrap();
}

#[tokio::test]
async fn public_bootstrap_and_unprotected_admin_fail_before_listener_start() {
    let dir = tempfile::tempdir().unwrap();
    for (bootstrap, token) in [
        (true, Some("local-admin-test")),
        (false, None),
        (false, Some(" ")),
    ] {
        let mut child = command(dir.path(), "0.0.0.0", 0, bootstrap, token)
            .spawn()
            .unwrap();
        let status = tokio::time::timeout(Duration::from_secs(5), child.wait())
            .await
            .unwrap()
            .unwrap();
        assert!(!status.success());
    }
}

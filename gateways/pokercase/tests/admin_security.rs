//! Admin surface hardening: mandatory admin token, forwarded requests treated as remote,
//! base_url allowlist, Host allowlist (DNS rebinding) and CSRF/Origin checks.
//! Only local fake upstreams are used.

use std::path::Path;
use std::time::Duration;

use axum::routing::post;
use axum::{Json, Router};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::io::AsyncReadExt;
use tokio::net::TcpListener;

struct Gateway {
    base: String,
    admin: String,
    client: reqwest::Client,
    child: tokio::process::Child,
    dir: TempDir,
}

async fn fake_chat_upstream() -> String {
    let app = Router::new().route(
        "/v1/chat/completions",
        post(|| async {
            Json(json!({
                "id": "chatcmpl-1", "object": "chat.completion", "model": "m",
                "choices": [{"index": 0, "message": {"role": "assistant", "content": "ok"}, "finish_reason": "stop"}],
                "usage": {"prompt_tokens": 1, "completion_tokens": 1, "total_tokens": 2}
            }))
        }),
    );
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/v1", listener.local_addr().unwrap());
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

impl Gateway {
    async fn start(extra: &[&str]) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
            l.local_addr().unwrap().port()
        };
        let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
        cmd.args([
            "serve",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
            "--data-dir",
            dir.path().to_str().unwrap(),
        ])
        .args(extra);
        for name in [
            "THINROUTER_ADMIN_TOKEN",
            "THINROUTER_SECRETS_KEY",
            "THINROUTER_ALLOW_KEYLESS_BOOTSTRAP",
            "THINROUTER_ALLOWED_HOSTS",
            "THINROUTER_PROVIDER_BASE_OVERRIDES",
            "HTTPS_PROXY",
            "https_proxy",
            "HTTP_PROXY",
            "http_proxy",
            "ALL_PROXY",
            "all_proxy",
        ] {
            cmd.env_remove(name);
        }
        cmd.env("RUST_LOG", "debug")
            .kill_on_drop(true)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped());
        let child = cmd.spawn().unwrap();
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        for _ in 0..100 {
            if let Ok(r) = client.get(format!("{base}/health")).send().await {
                if r.status().is_success() {
                    let admin = std::fs::read_to_string(dir.path().join("admin-token"))
                        .unwrap()
                        .trim()
                        .to_string();
                    return Self {
                        base,
                        admin,
                        client,
                        child,
                        dir,
                    };
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        panic!("gateway did not become healthy");
    }

    fn url(&self, path: &str) -> String {
        format!("{}{path}", self.base)
    }

    fn admin(&self, method: reqwest::Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, self.url(path))
            .header("x-admin-token", &self.admin)
    }

    /// Stop the process and return everything it logged.
    async fn logs(mut self) -> String {
        self.child.kill().await.unwrap();
        let mut out = String::new();
        if let Some(mut s) = self.child.stdout.take() {
            s.read_to_string(&mut out).await.unwrap();
        }
        if let Some(mut s) = self.child.stderr.take() {
            s.read_to_string(&mut out).await.unwrap();
        }
        out
    }
}

#[cfg(unix)]
fn mode(path: &Path) -> u32 {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[tokio::test]
async fn admin_always_requires_token_and_token_is_never_logged() {
    let gw = Gateway::start(&[]).await;
    #[cfg(unix)]
    {
        assert_eq!(mode(&gw.dir.path().join("admin-token")), 0o600);
        assert_eq!(mode(&gw.dir.path().join("secrets.key")), 0o600);
    }
    assert_eq!(gw.admin.len(), 64);

    for path in [
        "/admin/api/keys",
        "/admin/api/connections",
        "/admin/api/stats",
    ] {
        let r = gw.client.get(gw.url(path)).send().await.unwrap();
        assert_eq!(r.status(), 401, "{path}");
        let r = gw
            .client
            .get(gw.url(path))
            .header("x-admin-token", "wrong")
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 401, "{path}");
    }
    let r = gw
        .client
        .post(gw.url("/admin/api/keys"))
        .json(&json!({"name": "x"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    let r = gw.client.get(gw.url("/admin")).send().await.unwrap();
    assert_eq!(r.status(), 303);
    assert_eq!(r.headers()["location"], "/admin/login");
    let r = gw
        .admin(reqwest::Method::GET, "/admin/api/keys")
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200);

    // Store a credential so its plaintext could show up in logs if anything leaked it.
    let r = gw
        .admin(reqwest::Method::POST, "/admin/api/connections")
        .json(&json!({"name": "c", "base_url": "http://127.0.0.1:9/v1", "api_key": "sk-leakcheck-123"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);
    let token = gw.admin.clone();
    let key_hex = std::fs::read_to_string(gw.dir.path().join("secrets.key")).unwrap();
    let db = std::fs::read(gw.dir.path().join("thinrouter.db")).unwrap();
    assert!(!String::from_utf8_lossy(&db).contains("sk-leakcheck-123"));
    let logs = gw.logs().await;
    assert!(
        logs.contains("admin-token"),
        "path should be logged: {logs}"
    );
    assert!(!logs.contains(&token));
    assert!(!logs.contains(key_hex.trim()));
    assert!(!logs.contains("sk-leakcheck-123"));
}

#[tokio::test]
async fn forwarded_requests_cannot_use_keyless_bootstrap() {
    let upstream = fake_chat_upstream().await;
    let gw = Gateway::start(&["--allow-keyless-bootstrap"]).await;
    let r = gw
        .admin(reqwest::Method::POST, "/admin/api/connections")
        .json(&json!({"name": "mock", "base_url": upstream, "api_key": "k", "default_model": "m"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);
    let body = json!({"model": "mock", "messages": [{"role": "user", "content": "hi"}]});
    for (h, v) in [
        ("x-forwarded-for", "203.0.113.9"),
        ("forwarded", "for=203.0.113.9"),
        ("x-real-ip", "203.0.113.9"),
        ("cf-connecting-ip", "203.0.113.9"),
        ("tailscale-user-login", "someone@example.com"),
    ] {
        for path in ["/v1/chat/completions", "/chat/completions"] {
            let r = gw
                .client
                .post(gw.url(path))
                .header(h, v)
                .json(&body)
                .send()
                .await
                .unwrap();
            assert_eq!(r.status(), 401, "{h} {path}");
        }
    }
    let r = gw
        .client
        .post(gw.url("/v1/chat/completions"))
        .json(&body)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "direct loopback bootstrap still works");
}

#[tokio::test]
async fn connection_base_url_cannot_redirect_credentials() {
    let gw = Gateway::start(&[]).await;
    let post = |path: &str, body: Value| gw.admin(reqwest::Method::POST, path).json(&body).send();

    // OAuth import: provider allowlist.
    let r = post(
        "/admin/api/connections/oauth/import",
        json!({"name": "cx", "provider": "siwc", "access_token": "at", "base_url": "https://evil.example/v1"}),
    )
    .await
    .unwrap();
    assert_eq!(r.status(), 400);
    let r = post(
        "/admin/api/connections/oauth/import",
        json!({"name": "cx", "provider": "siwc", "access_token": "at", "refresh_token": "rt"}),
    )
    .await
    .unwrap();
    assert_eq!(r.status(), 201);
    let id = r.json::<Value>().await.unwrap()["connection"]["id"]
        .as_str()
        .unwrap()
        .to_string();

    // Admin API PUT and web form cannot move it.
    for evil in [
        "https://evil.example/v1",
        "http://api.openai.com/v1",
        "https://api.openai.com.evil.example/v1",
    ] {
        let r = gw
            .admin(
                reqwest::Method::PUT,
                &format!("/admin/api/connections/{id}"),
            )
            .json(&json!({"name": "cx", "base_url": evil}))
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 400, "{evil}");
        let r = gw
            .admin(
                reqwest::Method::POST,
                &format!("/admin/connections/{id}/update"),
            )
            .form(&[
                ("name", "cx"),
                ("base_url", evil),
                ("api_key", ""),
                ("default_model", ""),
            ])
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 400, "web {evil}");
    }
    // Re-import under the same name with another target must bring its own refresh token.
    let r = post(
        "/admin/api/connections/oauth/import",
        json!({"name": "cx", "provider": "generic", "access_token": "x", "base_url": "https://evil.example/v1"}),
    )
    .await
    .unwrap();
    assert_eq!(r.status(), 400);
    let r = gw
        .admin(
            reqwest::Method::GET,
            &format!("/admin/api/connections/{id}"),
        )
        .send()
        .await
        .unwrap();
    let row: Value = r.json().await.unwrap();
    assert_eq!(row["base_url"], "https://api.openai.com/v1");
    assert_eq!(row["provider"], "siwc");

    // API-key connection: moving base_url requires re-entering the key.
    let r = post(
        "/admin/api/connections",
        json!({"name": "k", "base_url": "http://127.0.0.1:9/v1", "api_key": "sk-1"}),
    )
    .await
    .unwrap();
    let kid = r.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_string();
    let put = |body: Value| {
        gw.admin(
            reqwest::Method::PUT,
            &format!("/admin/api/connections/{kid}"),
        )
        .json(&body)
        .send()
    };
    let r = put(json!({"name": "k", "base_url": "https://evil.example/v1"}))
        .await
        .unwrap();
    assert_eq!(r.status(), 400);
    let r = put(json!({"name": "k", "base_url": "http://127.0.0.1:9/v1", "priority": 5}))
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "same base_url keeps the stored key");
    let r = put(json!({"name": "k", "base_url": "https://other.example/v1", "api_key": "sk-2"}))
        .await
        .unwrap();
    assert_eq!(r.status(), 200, "new base with a new key is fine");
}

#[tokio::test]
async fn unknown_host_header_is_rejected() {
    let gw = Gateway::start(&["--allowed-host", "box.tail1234.ts.net"]).await;
    for (host, expected) in [
        ("evil.example", 421),
        ("evil.example:20128", 421),
        ("box.tail1234.ts.net", 200),
        ("localhost:1", 200),
    ] {
        let r = gw
            .client
            .get(gw.url("/health"))
            .header("host", host)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), expected, "{host}");
    }
    let r = gw
        .admin(reqwest::Method::GET, "/admin/api/keys")
        .header("host", "rebind.evil.example")
        .send()
        .await
        .unwrap();
    assert_eq!(
        r.status(),
        421,
        "admin token does not bypass the Host check"
    );
}

#[tokio::test]
async fn admin_session_writes_need_csrf_and_same_origin() {
    let gw = Gateway::start(&[]).await;
    let r = gw
        .client
        .post(gw.url("/admin/login"))
        .form(&[("token", "wrong")])
        .send()
        .await
        .unwrap();
    assert_eq!(r.headers()["location"], "/admin/login?error=invalid");
    assert!(r.headers().get("set-cookie").is_none());

    let r = gw
        .client
        .post(gw.url("/admin/login"))
        .form(&[("token", gw.admin.as_str())])
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 303);
    let set_cookie = r.headers()["set-cookie"].to_str().unwrap().to_string();
    assert!(set_cookie.contains("HttpOnly") && set_cookie.contains("SameSite=Strict"));
    assert!(
        !set_cookie.contains(&gw.admin),
        "cookie must not carry the admin token"
    );
    let cookie = set_cookie.split(';').next().unwrap().to_string();

    let page = gw
        .client
        .get(gw.url("/admin/keys"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    let csrf = page
        .split("name=\"csrf\" value=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .unwrap()
        .to_string();
    assert_eq!(csrf.len(), 64);

    let form_post = |fields: Vec<(&'static str, String)>, origin: Option<&'static str>| {
        let mut req = gw
            .client
            .post(gw.url("/admin/keys/new"))
            .header("cookie", &cookie)
            .form(&fields);
        if let Some(o) = origin {
            req = req.header("origin", o);
        }
        req.send()
    };
    let r = form_post(vec![("name", "a".into())], None).await.unwrap();
    assert_eq!(r.status(), 403, "missing csrf");
    let r = form_post(vec![("name", "a".into()), ("csrf", "00".repeat(32))], None)
        .await
        .unwrap();
    assert_eq!(r.status(), 403, "wrong csrf");
    let r = form_post(
        vec![("name", "a".into()), ("csrf", csrf.clone())],
        Some("http://evil.example"),
    )
    .await
    .unwrap();
    assert_eq!(r.status(), 403, "cross origin");
    let r = gw
        .client
        .post(gw.url("/admin/keys/new"))
        .header("cookie", &cookie)
        .header("sec-fetch-site", "cross-site")
        .form(&[("name", "a"), ("csrf", csrf.as_str())])
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403, "sec-fetch-site cross-site");
    let origin: &'static str = Box::leak(gw.base.clone().into_boxed_str());
    let r = form_post(
        vec![("name", "a".into()), ("csrf", csrf.clone())],
        Some(origin),
    )
    .await
    .unwrap();
    assert_eq!(r.status(), 200, "same-origin form with csrf");

    // JSON admin API on a cookie session needs the header token too.
    let r = gw
        .client
        .post(gw.url("/admin/api/keys"))
        .header("cookie", &cookie)
        .json(&json!({"name": "b"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 403);
    let r = gw
        .client
        .post(gw.url("/admin/api/keys"))
        .header("cookie", &cookie)
        .header("x-csrf-token", &csrf)
        .json(&json!({"name": "b"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 201);

    // Logout kills the session.
    let r = gw
        .client
        .post(gw.url("/admin/logout"))
        .header("cookie", &cookie)
        .form(&[("csrf", csrf.as_str())])
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 303);
    let r = gw
        .client
        .get(gw.url("/admin/api/keys"))
        .header("cookie", &cookie)
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}

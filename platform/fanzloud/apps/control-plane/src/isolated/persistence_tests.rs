use super::*;
use tower::ServiceExt;

// CU-M3 scenario skeleton: add real store/HTTP fixture cases below before integration.
// M3-01 reopen/receipt, M3-02 concurrent duplicate, M3-03 lost response/restart,
// M3-04 result/history, M3-05 auth/CSRF, M3-06 recovery via GET only.
#[tokio::test]
async fn m3_durable_history_is_an_authenticated_route_not_a_missing_asset() {
    let response = router(Config::new("https://operator.invalid", "127.0.0.1:9").expect("config"))
        .oneshot(
            Request::builder()
                .uri("/api/v1/submissions")
                .body(Body::empty())
                .expect("request"),
        )
        .await
        .expect("router");
    assert_ne!(response.status(), StatusCode::NOT_FOUND);
}

use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

const KEY: &str = "018ff3ab-1277-7000-8000-000000000010";
const RUN: &str = "018ff3ab-1277-7000-8000-000000000011";
const TASK: &str = "018ff3ab-1277-7000-8000-000000000012";
fn task() -> Value {
    json!({"project_id":"018ff3ab-1277-7000-8000-000000000013","profile_revision":"018ff3ab-1277-7000-8000-000000000014","base_sha":"a".repeat(40),"title":"repair","goal":"bounded repair"})
}
fn run() -> Value {
    json!({"id":RUN,"task_id":TASK,"base_sha":task()["base_sha"],"profile_revision":task()["profile_revision"],"goal":task()["goal"],"state":"queued","state_version":1,"last_event_seq":2,"cleanup_state":"pending","result":null})
}
fn receipt() -> Value {
    json!({"task":{"id":TASK,"project_id":task()["project_id"],"title":task()["title"]},"run":run()})
}

struct Fixture {
    path: std::path::PathBuf,
    address: SocketAddr,
    posts: Arc<AtomicUsize>,
    stop: Arc<AtomicBool>,
    thread: Option<std::thread::JoinHandle<()>>,
}
impl Fixture {
    fn new(mode: &'static str) -> Self {
        let mut random = [0; 16];
        getrandom::fill(&mut random).expect("random");
        let path = std::env::temp_dir().join(format!("fanz-m3-{}", Uuid::from_bytes(random)));
        std::fs::create_dir(&path).expect("directory");
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o700)).expect("mode");
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("listener");
        let address = listener.local_addr().expect("address");
        listener.set_nonblocking(true).expect("nonblocking");
        let posts = Arc::new(AtomicUsize::new(0));
        let count = posts.clone();
        let stop = Arc::new(AtomicBool::new(false));
        let stopped = stop.clone();
        let thread = std::thread::spawn(move || {
            while !stopped.load(Ordering::SeqCst) {
                let (mut socket, _) = match listener.accept() {
                    Ok(value) => value,
                    Err(e) if e.kind() == io::ErrorKind::WouldBlock => {
                        std::thread::sleep(Duration::from_millis(2));
                        continue;
                    }
                    Err(e) => panic!("fixture accept: {e}"),
                };
                socket
                    .set_read_timeout(Some(Duration::from_secs(2)))
                    .expect("timeout");
                let mut bytes = Vec::new();
                while !bytes.ends_with(b"\r\n\r\n") {
                    let mut byte = [0];
                    socket.read_exact(&mut byte).expect("header");
                    bytes.push(byte[0]);
                }
                let head = String::from_utf8(bytes).expect("ascii");
                let length: usize = head
                    .lines()
                    .find_map(|line| line.strip_prefix("Content-Length: "))
                    .expect("length")
                    .trim()
                    .parse()
                    .expect("integer");
                let mut body = vec![0; length];
                socket.read_exact(&mut body).expect("body");
                let (status, value) = if head.starts_with("GET /api/v1/session ") {
                    (
                        200,
                        json!({"authenticated":head.contains("cookie: auth=ok\r\n"),"username":"operator","csrf_token":"csrf"}),
                    )
                } else if head.starts_with("POST /api/v1/tasks ") {
                    count.fetch_add(1, Ordering::SeqCst);
                    if mode == "lost" {
                        continue;
                    }
                    if mode == "rejected" {
                        (422, json!({"error":"invalid"}))
                    } else if mode == "mismatch" {
                        let mut value = receipt();
                        value["run"]["base_sha"] = json!("b".repeat(40));
                        (202, value)
                    } else {
                        (202, receipt())
                    }
                } else if head.starts_with("GET /api/v1/runs/") && head.contains("/artifacts") {
                    if !head.contains("cookie: auth=ok\r\n") {
                        (401, json!({"error":"authentication_required"}))
                    } else if mode == "pruned" {
                        (410, json!({"error":"artifact_expired"}))
                    } else {
                        (
                            200,
                            json!({"archive":"exact UTF8 原始 bytes", "run_id":RUN}),
                        )
                    }
                } else if head.starts_with("GET /api/v1/runs/") {
                    (200, run())
                } else {
                    (404, json!({"error":"not_found"}))
                };
                let raw = value.to_string();
                write!(socket,"HTTP/1.1 {status} OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{raw}",raw.len()).expect("reply");
            }
        });
        Self {
            path,
            address,
            posts,
            stop,
            thread: Some(thread),
        }
    }
    fn app(&self) -> Router {
        let mut config =
            Config::new("https://operator.invalid", &self.address.to_string()).expect("config");
        config.store =
            Some(SubmissionStore::open(self.path.join("intents.sqlite")).expect("store"));
        router(config)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::SeqCst);
        self.thread.take().expect("thread").join().expect("fixture");
        std::fs::remove_dir_all(&self.path).expect("private test directory");
    }
}
fn request(
    method: Method,
    path: &str,
    key: &str,
    value: Option<Value>,
    auth: bool,
    csrf: &str,
) -> Request<Body> {
    let raw = value.map(|v| v.to_string()).unwrap_or_default();
    let mut request = Request::builder()
        .method(method)
        .uri(path)
        .header("Origin", "https://operator.invalid")
        .header("content-length", raw.len())
        .header("x-csrf-token", csrf)
        .header("idempotency-key", key);
    if auth {
        request = request.header("cookie", "auth=ok");
    }
    request.body(Body::from(raw)).expect("request")
}
async fn value(response: Response<Body>) -> Value {
    serde_json::from_slice(
        &to_bytes(response.into_body(), RESPONSE_LIMIT)
            .await
            .expect("body"),
    )
    .expect("json")
}

#[tokio::test]
async fn m3_01_receipt_reopens_and_duplicate_never_dispatches() {
    let f = Fixture::new("ok");
    let first = f
        .app()
        .oneshot(request(
            Method::POST,
            "/api/v1/tasks",
            KEY,
            Some(task()),
            true,
            "csrf",
        ))
        .await
        .expect("response");
    assert_eq!(first.status(), StatusCode::ACCEPTED);
    assert_eq!(value(first).await, receipt());
    let second = f
        .app()
        .oneshot(request(
            Method::POST,
            "/api/v1/tasks",
            KEY,
            Some(task()),
            true,
            "csrf",
        ))
        .await
        .expect("response");
    assert_eq!(second.status(), StatusCode::ACCEPTED);
    assert_eq!(value(second).await, receipt());
    let saved = f
        .app()
        .oneshot(request(
            Method::GET,
            "/api/v1/submissions",
            KEY,
            None,
            true,
            "csrf",
        ))
        .await
        .expect("history");
    let saved = value(saved).await;
    assert_eq!(saved["items"][0]["receipt"]["run"]["id"], RUN);
    assert_eq!(saved["blocked"], false);
    assert_eq!(f.posts.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn m3_02_concurrent_same_key_has_only_one_task_post() {
    let f = Fixture::new("ok");
    let app = f.app();
    let (a, b) = tokio::join!(
        app.clone().oneshot(request(
            Method::POST,
            "/api/v1/tasks",
            KEY,
            Some(task()),
            true,
            "csrf"
        )),
        app.oneshot(request(
            Method::POST,
            "/api/v1/tasks",
            KEY,
            Some(task()),
            true,
            "csrf"
        ))
    );
    let statuses = [a.expect("a").status(), b.expect("b").status()];
    assert!(statuses.contains(&StatusCode::ACCEPTED));
    assert!(
        statuses
            .iter()
            .all(|s| matches!(*s, StatusCode::ACCEPTED | StatusCode::CONFLICT))
    );
    assert_eq!(f.posts.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn m3_03_lost_or_invalid_receipt_reopen_blocks_all_resends() {
    for mode in ["lost", "mismatch"] {
        let f = Fixture::new(mode);
        let result = f
            .app()
            .oneshot(request(
                Method::POST,
                "/api/v1/tasks",
                KEY,
                Some(task()),
                true,
                "csrf",
            ))
            .await
            .expect("post");
        assert_eq!(result.status(), StatusCode::BAD_GATEWAY);
        for key in [KEY, "018ff3ab-1277-7000-8000-000000000099"] {
            let result = f
                .app()
                .oneshot(request(
                    Method::POST,
                    "/api/v1/tasks",
                    key,
                    Some(task()),
                    true,
                    "csrf",
                ))
                .await
                .expect("duplicate");
            assert_eq!(result.status(), StatusCode::CONFLICT);
        }
        let saved = f
            .app()
            .oneshot(request(
                Method::GET,
                "/api/v1/submissions",
                KEY,
                None,
                true,
                "csrf",
            ))
            .await
            .expect("history");
        assert_eq!(value(saved).await["blocked"], true);
        assert_eq!(f.posts.load(Ordering::SeqCst), 1);
    }
}
#[tokio::test]
async fn m3_05_auth_csrf_and_payload_fail_before_intent_or_dispatch() {
    let f = Fixture::new("ok");
    for (auth, csrf, status) in [
        (false, "csrf", StatusCode::UNAUTHORIZED),
        (true, "wrong", StatusCode::FORBIDDEN),
    ] {
        let result = f
            .app()
            .oneshot(request(
                Method::POST,
                "/api/v1/tasks",
                KEY,
                Some(task()),
                auth,
                csrf,
            ))
            .await
            .expect("request");
        assert_eq!(result.status(), status);
    }
    let mut invalid = task();
    invalid["operator"] = json!("foreign");
    let result = f
        .app()
        .oneshot(request(
            Method::POST,
            "/api/v1/tasks",
            KEY,
            Some(invalid),
            true,
            "csrf",
        ))
        .await
        .expect("request");
    assert_eq!(result.status(), StatusCode::BAD_REQUEST);
    let saved = f
        .app()
        .oneshot(request(
            Method::GET,
            "/api/v1/submissions",
            KEY,
            None,
            true,
            "csrf",
        ))
        .await
        .expect("history");
    assert_eq!(value(saved).await["items"], json!([]));
    assert_eq!(f.posts.load(Ordering::SeqCst), 0);
    let denied = f
        .app()
        .oneshot(request(
            Method::GET,
            "/api/v1/submissions",
            KEY,
            None,
            false,
            "csrf",
        ))
        .await
        .expect("denied");
    assert_eq!(denied.status(), StatusCode::UNAUTHORIZED);
}
#[tokio::test]
async fn m3_04_observed_run_reopens_with_stable_history_without_submit() {
    let f = Fixture::new("ok");
    let path = format!("/api/v1/runs/{RUN}");
    let a = f
        .app()
        .oneshot(request(Method::GET, &path, KEY, None, true, "csrf"))
        .await
        .expect("read");
    let a = value(a).await;
    let b = f
        .app()
        .oneshot(request(Method::GET, &path, KEY, None, true, "csrf"))
        .await
        .expect("read");
    let b = value(b).await;
    assert_eq!(a, b);
    assert_eq!(a["fanz_history"]["cursor"], 1);
    assert_eq!(a["fanz_history"]["events"][0]["state"], "queued");
    assert_eq!(f.posts.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn c01_artifact_tcp_preserves_auth_body_and_expiry_with_store_enabled() {
    for (mode, auth, expected) in [
        ("normal", true, 200),
        ("normal", false, 401),
        ("pruned", true, 410),
    ] {
        let fixture = Fixture::new(mode);
        for path in [
            format!("/api/v1/runs/{RUN}/artifacts"),
            format!("/api/v1/runs/{RUN}/artifacts/{KEY}"),
        ] {
            let response = fixture
                .app()
                .oneshot(request(Method::GET, &path, KEY, None, auth, "csrf"))
                .await
                .expect("response");
            assert_eq!(response.status().as_u16(), expected);
            assert_eq!(response.headers()["cache-control"], "no-store");
            let raw = to_bytes(response.into_body(), RESPONSE_LIMIT)
                .await
                .expect("body");
            if expected == 200 {
                assert_eq!(
                    raw.as_ref(),
                    json!({"archive":"exact UTF8 原始 bytes", "run_id":RUN})
                        .to_string()
                        .as_bytes()
                );
            }
        }
        assert_eq!(fixture.posts.load(Ordering::SeqCst), 0);
    }
}

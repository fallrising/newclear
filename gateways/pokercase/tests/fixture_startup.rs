//! T-0445: real gateway ownership and separately labelled diagnostic-child tests.
#![cfg(unix)]

#[path = "support/owned_gateway.rs"]
mod owned_gateway;

use std::net::{IpAddr, SocketAddr};
use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::{routing::any, Json, Router};
use owned_gateway::{command, inspect_line, FailureCode, OwnedGateway, StartupFailure, LINE_LIMIT};
use serde_json::json;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio::task::JoinHandle;
use tokio::time::{timeout, Instant};

const BUDGET: Duration = Duration::from_secs(5);
const TOKEN: &str = "fixture-owned-token";
const CANARY: &str = "PRIVATE-STARTUP-CANARY";

// This source-closed executor only binds an owned loopback HTTP server. It has no
// provider/network client, proxy, redirect-following or subprocess functionality.
const CONTROLLED: &str = r#"
import http.server, json, os, pathlib, sys, threading, time
mode, directory, extra = sys.argv[1:]
directory = pathlib.Path(directory)
canary = b'PRIVATE-STARTUP-CANARY'
written = 0
def output(value):
    global written
    sys.stderr.buffer.write(value)
    sys.stderr.buffer.flush()
    written += len(value)
if mode == 'early':
    output(canary + b' token=PRIVATE-ADMIN-CANARY\n')
    sys.exit(7)
if mode in ('silent', 'cancel', 'bad'):
    if mode == 'cancel':
        (directory / 'owned.pid').write_text(str(os.getpid()))
        output(canary + b'\n')
    if mode == 'bad':
        output(extra.encode() + b'\n')
    time.sleep(60)
    sys.exit(0)
class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        if self.path == '/health':
            if mode == 'redirect':
                self.send_response(302)
                self.send_header('Location', extra)
                self.end_headers()
                return
            status, body = 200, {'status': 'ok', 'service': 'thinrouter'}
        elif self.path == '/admin/api/stats':
            if self.headers.get('x-admin-token') != 'fixture-owned-token':
                status, body = 401, {'error': 'PRIVATE-STARTUP-CANARY'}
            else:
                status, body = 200, {'connections': 0}
        else:
            status, body = 404, {'error': 'PRIVATE-STARTUP-CANARY'}
        encoded = json.dumps(body).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)
server = http.server.HTTPServer(('127.0.0.1', 0), Handler)
if mode == 'noisy':
    output(canary + b'x' * 9000 + b'\n')
    output(b'\xff\xfe\n')
output(('2026-10-30T00:00:00Z INFO thinrouter::server: thinrouter listening addr=127.0.0.1:%d data_dir=PRIVATE-STARTUP-CANARY\n' % server.server_port).encode())
if mode == 'noisy':
    def flood():
        for _ in range(2048): output(canary + b'x' * 128 + b'\n')
        (directory / 'drain-count').write_text(str(written))
    threading.Thread(target=flood, daemon=True).start()
server.serve_forever()
"#;

fn controlled(dir: &Path, mode: &str, extra: &str) -> Command {
    let mut command = Command::new("/usr/bin/python3");
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", dir)
        .args(["-u", "-c", CONTROLLED, mode])
        .arg(dir)
        .arg(extra)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    command
}

struct Foreign {
    address: SocketAddr,
    requests: Arc<AtomicU64>,
    task: Option<JoinHandle<()>>,
}

impl Foreign {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let requests = Arc::new(AtomicU64::new(0));
        let counter = requests.clone();
        let app = Router::new().fallback(any(move || {
            let counter = counter.clone();
            async move {
                counter.fetch_add(1, Ordering::SeqCst);
                Json(json!({"status":"ok", "service":"thinrouter"}))
            }
        }));
        let task = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            address,
            requests,
            task: Some(task),
        }
    }

    async fn untouched(&self) {
        assert_eq!(self.requests.load(Ordering::SeqCst), 0);
        assert!(!self.task.as_ref().unwrap().is_finished());
        assert!(TcpListener::bind(self.address).await.is_err());
    }

    async fn close(mut self) {
        let task = self.task.take().unwrap();
        task.abort();
        let _ = task.await;
        assert!(TcpListener::bind(self.address).await.is_ok());
    }
}

impl Drop for Foreign {
    fn drop(&mut self) {
        if let Some(task) = self.task.take() {
            task.abort();
        }
    }
}

fn address(gateway: &OwnedGateway) -> SocketAddr {
    gateway
        .base
        .strip_prefix("http://")
        .unwrap()
        .parse()
        .unwrap()
}

async fn stopped(gateway: &mut OwnedGateway) {
    let address = address(gateway);
    gateway.shutdown().await;
    let d = gateway.diagnostics();
    assert!(d.child_reaped && d.drainer_closed);
    assert!(TcpListener::bind(address).await.is_ok());
}

fn safe_failure(failure: &StartupFailure, dir: &Path) {
    assert!(failure.diagnostics.child_reaped && failure.diagnostics.drainer_closed);
    let rendered = format!(
        "{failure:?} {failure} {}",
        serde_json::to_string(failure).unwrap()
    );
    assert!(!rendered.contains(CANARY));
    assert!(!rendered.contains("PRIVATE-ADMIN-CANARY"));
    assert!(!rendered.contains(dir.to_str().unwrap()));
    assert!(!rendered.contains("127.0.0.1"));
}

async fn gone(pid: u32) {
    timeout(Duration::from_secs(3), async {
        // Existence only, for this exact owned PID. No process environment/data reads.
        while Path::new(&format!("/proc/{pid}")).exists() {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("owned child was not reaped");
}

async fn number_file(path: &Path) -> u64 {
    timeout(BUDGET, async {
        loop {
            if let Ok(text) = tokio::fs::read_to_string(path).await {
                if let Ok(number) = text.parse() {
                    return number;
                }
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("controlled numeric witness absent")
}

#[tokio::test]
async fn fs_actual_port_zero_owned_admin() {
    for host in ["127.0.0.1", "0.0.0.0"] {
        let dir = tempfile::tempdir().unwrap();
        let admin = (host == "0.0.0.0").then_some(TOKEN);
        let mut gateway = OwnedGateway::start(
            command(dir.path(), host, 0, false, admin),
            dir.path(),
            host,
            admin,
            BUDGET,
        )
        .await
        .unwrap();
        assert_ne!(address(&gateway).port(), 0);
        assert!(address(&gateway).ip().is_loopback());
        let d = gateway.diagnostics();
        assert_eq!(
            (
                d.announcements,
                d.health_request_attempts,
                d.admin_request_attempts
            ),
            (1, 1, 1)
        );
        assert_eq!((d.health_status, d.admin_status), (Some(200), Some(200)));
        stopped(&mut gateway).await;
    }
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_actual_port_zero_owned_admin","layer":"actual_gateway_http","passed":true,"owned_children_reaped":true,"listener_ports_released":true,"children":2,"health_request_attempts":2,"admin_request_attempts":2})
    );
}

#[tokio::test]
async fn fs_actual_occupied_port_preserves_foreign_health() {
    let foreign = Foreign::start().await;
    let dir = tempfile::tempdir().unwrap();
    let failure = OwnedGateway::start(
        command(dir.path(), "127.0.0.1", foreign.address.port(), false, None),
        dir.path(),
        "127.0.0.1",
        None,
        BUDGET,
    )
    .await
    .unwrap_err();
    assert_eq!(failure.code, FailureCode::ChildExited);
    assert_eq!(failure.diagnostics.announcements, 0);
    assert_eq!(
        (
            failure.diagnostics.health_request_attempts,
            failure.diagnostics.admin_request_attempts
        ),
        (0, 0)
    );
    safe_failure(&failure, dir.path());
    foreign.untouched().await;
    foreign.close().await;
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_actual_occupied_port_preserves_foreign_health","layer":"actual_gateway_process","passed":true,"owned_children_reaped":true,"foreign_listener_preserved":true,"foreign_requests":0,"announcements":0,"children":1})
    );
}

#[tokio::test]
async fn fs_controlled_early_exit_and_silent_deadline() {
    for mode in ["early", "silent"] {
        let dir = tempfile::tempdir().unwrap();
        let started = Instant::now();
        let failure = OwnedGateway::start(
            controlled(dir.path(), mode, ""),
            dir.path(),
            "127.0.0.1",
            Some(TOKEN),
            if mode == "early" {
                BUDGET
            } else {
                Duration::from_millis(250)
            },
        )
        .await
        .unwrap_err();
        assert_eq!(
            failure.code,
            if mode == "early" {
                FailureCode::ChildExited
            } else {
                FailureCode::Deadline
            }
        );
        if mode == "early" {
            assert_eq!(failure.diagnostics.exit_code, Some(7));
        }
        if mode == "silent" {
            assert!(started.elapsed() < Duration::from_secs(3));
        }
        assert_eq!(
            (
                failure.diagnostics.health_request_attempts,
                failure.diagnostics.admin_request_attempts
            ),
            (0, 0)
        );
        safe_failure(&failure, dir.path());
    }
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_controlled_early_exit_and_silent_deadline","layer":"controlled_child","passed":true,"owned_children_reaped":true,"children":2,"exit_code":7,"timeout_classified":true,"canary_redacted":true,"health_request_attempts":0,"admin_request_attempts":0})
    );
}

#[tokio::test]
async fn fs_controlled_oversize_then_ready_keeps_draining() {
    let dir = tempfile::tempdir().unwrap();
    let mut gateway = OwnedGateway::start(
        controlled(dir.path(), "noisy", ""),
        dir.path(),
        "127.0.0.1",
        Some(TOKEN),
        BUDGET,
    )
    .await
    .unwrap();
    let expected = number_file(&dir.path().join("drain-count")).await;
    assert!(expected > 256 * 1024);
    timeout(BUDGET, async {
        while gateway.diagnostics().stderr_bytes < expected {
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    })
    .await
    .unwrap();
    let d = gateway.diagnostics();
    assert_eq!(d.max_line_bytes, LINE_LIMIT);
    assert_eq!(d.oversized_lines, 1);
    assert_eq!(
        (d.health_request_attempts, d.admin_request_attempts),
        (1, 1)
    );
    let safe = format!("{gateway:?} {}", serde_json::to_string(&d).unwrap());
    assert!(
        !safe.contains(CANARY)
            && !safe.contains(TOKEN)
            && !safe.contains(dir.path().to_str().unwrap())
    );
    stopped(&mut gateway).await;
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_controlled_oversize_then_ready_keeps_draining","layer":"controlled_child_http","passed":true,"owned_children_reaped":true,"children":1,"continuous_drain":true,"canary_redacted":true,"max_line_bytes":4096,"oversized_lines":1,"health_request_attempts":1,"admin_request_attempts":1})
    );
}

#[tokio::test]
async fn fs_controlled_malformed_and_wrong_host_announcements() {
    let bad = [
        "2026-10-30T00:00:00Z INFO thinrouter::server: thinrouter listening addr=127.0.0.1:0",
        "2026-10-30T00:00:00Z INFO thinrouter::server: thinrouter listening addr=192.0.2.1:5",
        "2026-10-30T00:00:00Z INFO thinrouter::server: thinrouter listening addr=PRIVATE-STARTUP-CANARY",
        "2026-10-30T00:00:00Z INFO wrong_target: thinrouter listening addr=127.0.0.1:5",
        "2026-10-30T00:00:00Z INFO thinrouter::server: thinrouter listening PRIVATE-STARTUP-CANARY",
    ];
    for line in bad {
        let dir = tempfile::tempdir().unwrap();
        let failure = OwnedGateway::start(
            controlled(dir.path(), "bad", line),
            dir.path(),
            "127.0.0.1",
            Some(TOKEN),
            BUDGET,
        )
        .await
        .unwrap_err();
        assert!(matches!(
            failure.code,
            FailureCode::MalformedAnnouncement | FailureCode::UnexpectedAddress
        ));
        assert_eq!(
            (
                failure.diagnostics.health_request_attempts,
                failure.diagnostics.admin_request_attempts
            ),
            (0, 0)
        );
        safe_failure(&failure, dir.path());
    }
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_controlled_malformed_and_wrong_host_announcements","layer":"controlled_child","passed":true,"owned_children_reaped":true,"children":5,"rejected_announcements":5,"health_request_attempts":0,"admin_request_attempts":0,"canary_redacted":true})
    );
}

#[tokio::test]
async fn fs_controlled_auth_and_redirect_fail_closed() {
    let foreign = Foreign::start().await;
    for mode in ["auth", "redirect"] {
        let dir = tempfile::tempdir().unwrap();
        let failure = OwnedGateway::start(
            controlled(
                dir.path(),
                mode,
                &format!("http://{}/sentinel", foreign.address),
            ),
            dir.path(),
            "127.0.0.1",
            Some("PRIVATE-ADMIN-CANARY"),
            BUDGET,
        )
        .await
        .unwrap_err();
        if mode == "auth" {
            assert_eq!(failure.code, FailureCode::AdminStatus);
            assert_eq!(failure.diagnostics.admin_status, Some(401));
            assert_eq!(failure.diagnostics.admin_request_attempts, 1);
        } else {
            assert_eq!(failure.code, FailureCode::HealthStatus);
            assert_eq!(failure.diagnostics.health_status, Some(302));
            assert_eq!(failure.diagnostics.admin_request_attempts, 0);
        }
        assert_eq!(failure.diagnostics.health_request_attempts, 1);
        safe_failure(&failure, dir.path());
    }
    foreign.untouched().await;
    foreign.close().await;
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_controlled_auth_and_redirect_fail_closed","layer":"controlled_child_http","passed":true,"owned_children_reaped":true,"children":2,"foreign_listener_preserved":true,"foreign_requests":0,"auth_status":401,"redirect_status":302,"health_request_attempts":2,"admin_request_attempts":1,"canary_redacted":true})
    );
}

#[tokio::test]
async fn fs_actual_serial_and_concurrent_ownership_cleanup() {
    for _ in 0..2 {
        let dir = tempfile::tempdir().unwrap();
        let mut gateway = OwnedGateway::start(
            command(dir.path(), "127.0.0.1", 0, false, None),
            dir.path(),
            "127.0.0.1",
            None,
            BUDGET,
        )
        .await
        .unwrap();
        assert_eq!(
            (
                gateway.diagnostics().health_request_attempts,
                gateway.diagnostics().admin_request_attempts
            ),
            (1, 1)
        );
        stopped(&mut gateway).await;
    }
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let (left, right) = tokio::join!(
        OwnedGateway::start(
            command(a.path(), "127.0.0.1", 0, false, None),
            a.path(),
            "127.0.0.1",
            None,
            BUDGET
        ),
        OwnedGateway::start(
            command(b.path(), "127.0.0.1", 0, false, None),
            b.path(),
            "127.0.0.1",
            None,
            BUDGET
        )
    );
    let (mut left, mut right) = (left.unwrap(), right.unwrap());
    assert!(address(&left) != address(&right));
    assert!(left.admin != right.admin);
    for (gateway, wrong_token) in [(&left, &right.admin), (&right, &left.admin)] {
        let status = gateway
            .client
            .get(format!("{}/admin/api/stats", gateway.base))
            .header("x-admin-token", wrong_token)
            .send()
            .await
            .unwrap()
            .status();
        assert_eq!(status, 401);
    }
    for gateway in [&mut left, &mut right] {
        assert_eq!(
            (
                gateway.diagnostics().health_request_attempts,
                gateway.diagnostics().admin_request_attempts
            ),
            (1, 1)
        );
        stopped(gateway).await;
    }
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_actual_serial_and_concurrent_ownership_cleanup","layer":"actual_gateway_http","passed":true,"owned_children_reaped":true,"children":4,"cross_admin_requests":2,"cross_admin_rejected":true,"distinct_concurrent_ports":true,"listener_ports_released":true,"health_request_attempts":4,"admin_request_attempts":4})
    );
}

#[tokio::test]
async fn fs_actual_drop_releases_owned_listener() {
    let dir = tempfile::tempdir().unwrap();
    let gateway = OwnedGateway::start(
        command(dir.path(), "127.0.0.1", 0, false, None),
        dir.path(),
        "127.0.0.1",
        None,
        BUDGET,
    )
    .await
    .unwrap();
    let pid = gateway.id().unwrap();
    let address = address(&gateway);
    assert_eq!(
        (
            gateway.diagnostics().health_request_attempts,
            gateway.diagnostics().admin_request_attempts
        ),
        (1, 1)
    );
    drop(gateway);
    gone(pid).await;
    assert!(TcpListener::bind(address).await.is_ok());
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_actual_drop_releases_owned_listener","layer":"actual_gateway_http","passed":true,"owned_children_reaped":true,"children":1,"listener_ports_released":true,"health_request_attempts":1,"admin_request_attempts":1})
    );
}

#[tokio::test]
async fn fs_controlled_start_future_cancellation_reaps() {
    let dir = tempfile::tempdir().unwrap();
    let pid_file = dir.path().join("owned.pid");
    let pid = {
        let startup = OwnedGateway::start(
            controlled(dir.path(), "cancel", ""),
            dir.path(),
            "127.0.0.1",
            Some(TOKEN),
            BUDGET,
        );
        tokio::pin!(startup);
        tokio::select! {
            result = &mut startup => panic!("silent startup unexpectedly returned: {result:?}"),
            pid = number_file(&pid_file) => pid,
        }
    };
    gone(u32::try_from(pid).unwrap()).await;
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_controlled_start_future_cancellation_reaps","layer":"controlled_child","passed":true,"owned_children_reaped":true,"children":1,"startup_cancelled":true})
    );
}

#[test]
fn fs_parser_exact_boundaries() {
    let host: IpAddr = "127.0.0.1".parse().unwrap();
    let prefix = "2026-10-30T00:00:00Z INFO thinrouter::server: thinrouter listening addr=";
    assert!(inspect_line(
        format!("{prefix}127.0.0.1:1234 data_dir=PRIVATE-STARTUP-CANARY\r").as_bytes(),
        host
    )
    .unwrap()
    .is_some());
    assert!(inspect_line(
        format!("{prefix}[::1]:1234").as_bytes(),
        "::1".parse().unwrap()
    )
    .unwrap()
    .is_some());
    for value in [
        format!("{prefix}127.0.0.1:0"),
        format!("{prefix}192.0.2.1:1234"),
        format!("{prefix}PRIVATE-STARTUP-CANARY"),
        format!("{prefix}127.0.0.1:1234").replace("thinrouter::server:", "other::server:"),
        format!("{prefix}127.0.0.1:1234").replace(" INFO ", " DEBUG "),
        format!("{prefix}127.0.0.1:1234 {}", "x".repeat(LINE_LIMIT)),
    ] {
        assert!(inspect_line(value.as_bytes(), host).is_err());
    }
    assert!(inspect_line(b"arbitrary PRIVATE-STARTUP-CANARY", host)
        .unwrap()
        .is_none());
    assert!(inspect_line(&[0xff, 0xfe], host).unwrap().is_none());
    println!(
        "FS_EVIDENCE {}",
        json!({"scenario":"fs_parser_exact_boundaries","layer":"pure_parser","passed":true,"accepted_variants":2,"rejected_variants":6})
    );
}

//! Test-only ownership/readiness guard. Diagnostics never contain child output.
#![allow(dead_code)] // Shared by fixtures with different diagnostic needs.

use std::fmt;
use std::io::Read;
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::io::AsyncReadExt;
use tokio::process::{Child, Command};
use tokio::task::JoinHandle;
use tokio::time::{timeout, timeout_at, Instant};

pub const LINE_LIMIT: usize = 4096;
const BODY_LIMIT: usize = 16 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FailureCode {
    InvalidHost,
    Spawn,
    ChildExited,
    ChildStatus,
    Deadline,
    MalformedAnnouncement,
    UnexpectedAddress,
    DuplicateAnnouncement,
    StderrRead,
    Client,
    Token,
    HealthTransport,
    HealthStatus,
    HealthBody,
    AdminTransport,
    AdminStatus,
    AdminBody,
}

#[derive(Clone, Copy, Debug, Default, Serialize)]
pub struct Diagnostics {
    pub stderr_bytes: u64,
    pub oversized_lines: u64,
    pub ignored_lines: u64,
    pub max_line_bytes: usize,
    pub announcements: u64,
    pub health_request_attempts: u64,
    pub admin_request_attempts: u64,
    pub health_status: Option<u16>,
    pub admin_status: Option<u16>,
    pub exit_code: Option<i32>,
    pub elapsed_ms: u64,
    pub child_reaped: bool,
    pub drainer_closed: bool,
}

#[derive(Debug, Serialize)]
pub struct StartupFailure {
    pub code: FailureCode,
    pub diagnostics: Diagnostics,
}

impl fmt::Display for StartupFailure {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "fixture startup {:?} {:?}", self.code, self.diagnostics)
    }
}

impl std::error::Error for StartupFailure {}

fn binary() -> PathBuf {
    let override_path = std::env::var_os("THINROUTER_TEST_BINARY");
    let override_hash = std::env::var_os("THINROUTER_TEST_BINARY_SHA256");
    match (override_path, override_hash) {
        (None, None) => PathBuf::from(env!("CARGO_BIN_EXE_thinrouter")),
        (Some(path), Some(expected)) => {
            let path = PathBuf::from(path);
            assert!(
                path.is_absolute() && path.is_file(),
                "test binary pin invalid"
            );
            let expected = expected.to_str().expect("test binary pin invalid");
            assert!(
                expected.len() == 64 && expected.bytes().all(|b| b.is_ascii_hexdigit()),
                "test binary pin invalid"
            );
            let mut file = std::fs::File::open(&path)
                .unwrap_or_else(|_| panic!("test binary pin unavailable"));
            let mut hash = Sha256::new();
            let mut chunk = [0_u8; 64 * 1024];
            loop {
                let size = file
                    .read(&mut chunk)
                    .unwrap_or_else(|_| panic!("test binary pin unavailable"));
                if size == 0 {
                    break;
                }
                hash.update(&chunk[..size]);
            }
            assert!(
                hex::encode(hash.finalize()) == expected,
                "test binary pin mismatch"
            );
            path
        }
        _ => panic!("test binary pin pair required"),
    }
}

pub fn command(
    data_dir: &Path,
    host: &str,
    port: u16,
    bootstrap: bool,
    admin: Option<&str>,
) -> Command {
    let home = data_dir.join("synthetic-home");
    let config = data_dir.join("synthetic-claude-config");
    assert!(
        std::fs::create_dir_all(&home).is_ok(),
        "fixture directory unavailable"
    );
    assert!(
        std::fs::create_dir_all(&config).is_ok(),
        "fixture directory unavailable"
    );
    let mut command = Command::new(binary());
    command
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("HOME", home)
        .env("CLAUDE_CONFIG_DIR", config)
        .env("RUST_LOG", "thinrouter::server=info")
        .env("NO_COLOR", "1")
        .env("TERM", "dumb")
        .arg("serve")
        .args(["--host", host, "--port", &port.to_string()])
        .arg("--data-dir")
        .arg(data_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if bootstrap {
        command.arg("--allow-keyless-bootstrap");
    }
    if let Some(admin) = admin {
        command.args(["--admin-token", admin]);
    }
    command
}

pub(crate) fn inspect_line(
    line: &[u8],
    expected: IpAddr,
) -> Result<Option<SocketAddr>, FailureCode> {
    let marker = b"thinrouter listening";
    if !line.windows(marker.len()).any(|part| part == marker) {
        return Ok(None);
    }
    if line.len() > LINE_LIMIT {
        return Err(FailureCode::MalformedAnnouncement);
    }
    let line = std::str::from_utf8(line).map_err(|_| FailureCode::MalformedAnnouncement)?;
    let mut fields = line.split_whitespace();
    let timestamp = fields.next().ok_or(FailureCode::MalformedAnnouncement)?;
    if !timestamp.contains('T')
        || !timestamp.ends_with('Z')
        || fields.next() != Some("INFO")
        || fields.next() != Some("thinrouter::server:")
        || fields.next() != Some("thinrouter")
        || fields.next() != Some("listening")
    {
        return Err(FailureCode::MalformedAnnouncement);
    }
    let address: SocketAddr = fields
        .next()
        .and_then(|field| field.strip_prefix("addr="))
        .ok_or(FailureCode::MalformedAnnouncement)?
        .parse()
        .map_err(|_| FailureCode::MalformedAnnouncement)?;
    if address.ip() != expected || address.port() == 0 {
        return Err(FailureCode::UnexpectedAddress);
    }
    Ok(Some(address))
}

#[derive(Default)]
struct DrainState {
    diagnostics: Diagnostics,
    address: Option<SocketAddr>,
    failure: Option<FailureCode>,
}

fn accept_line(state: &mut DrainState, line: &[u8], host: IpAddr) {
    match inspect_line(line, host) {
        Ok(Some(address)) => {
            state.diagnostics.announcements = state.diagnostics.announcements.saturating_add(1);
            if state.address.is_some() {
                state
                    .failure
                    .get_or_insert(FailureCode::DuplicateAnnouncement);
            } else {
                state.address = Some(address);
            }
        }
        Ok(None) => {
            state.diagnostics.ignored_lines = state.diagnostics.ignored_lines.saturating_add(1);
        }
        Err(code) => {
            state.failure.get_or_insert(code);
        }
    }
}

async fn drain(
    mut stderr: tokio::process::ChildStderr,
    state: Arc<Mutex<DrainState>>,
    host: IpAddr,
) {
    let mut chunk = [0_u8; 2048];
    let mut line = [0_u8; LINE_LIMIT];
    let mut length = 0;
    let mut oversized = false;
    loop {
        let read = match stderr.read(&mut chunk).await {
            Ok(read) => read,
            Err(_) => {
                state
                    .lock()
                    .unwrap()
                    .failure
                    .get_or_insert(FailureCode::StderrRead);
                break;
            }
        };
        let mut state = state.lock().unwrap();
        if read == 0 {
            if length != 0 && !oversized {
                accept_line(&mut state, &line[..length], host);
            }
            break;
        }
        state.diagnostics.stderr_bytes = state.diagnostics.stderr_bytes.saturating_add(read as u64);
        for byte in &chunk[..read] {
            if *byte == b'\n' {
                if !oversized {
                    accept_line(&mut state, &line[..length], host);
                }
                length = 0;
                oversized = false;
            } else if !oversized {
                if length == LINE_LIMIT {
                    oversized = true;
                    length = 0;
                    state.diagnostics.oversized_lines =
                        state.diagnostics.oversized_lines.saturating_add(1);
                } else {
                    line[length] = *byte;
                    length += 1;
                    state.diagnostics.max_line_bytes = state.diagnostics.max_line_bytes.max(length);
                }
            }
        }
    }
}

pub struct OwnedGateway {
    pub base: String,
    pub admin: String,
    pub client: reqwest::Client,
    child: Child,
    drainer: Option<JoinHandle<()>>,
    state: Arc<Mutex<DrainState>>,
    started: Instant,
    exit_code: Option<i32>,
    reaped: bool,
    drainer_closed: bool,
}

impl fmt::Debug for OwnedGateway {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("OwnedGateway")
            .field("diagnostics", &self.diagnostics())
            .finish()
    }
}

impl OwnedGateway {
    pub async fn start(
        mut command: Command,
        data_dir: &Path,
        host: &str,
        admin: Option<&str>,
        budget: Duration,
    ) -> Result<Self, StartupFailure> {
        let started = Instant::now();
        let bare_failure = |code| StartupFailure {
            code,
            diagnostics: Diagnostics::default(),
        };
        let host: IpAddr = host
            .parse()
            .map_err(|_| bare_failure(FailureCode::InvalidHost))?;
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(|_| bare_failure(FailureCode::Client))?;
        command
            .stdin(Stdio::null())
            .stderr(Stdio::piped())
            .stdout(Stdio::null())
            .kill_on_drop(true);
        let mut child = command
            .spawn()
            .map_err(|_| bare_failure(FailureCode::Spawn))?;
        let stderr = child.stderr.take().expect("owned stderr missing");
        let state = Arc::new(Mutex::new(DrainState::default()));
        let drainer = tokio::spawn(drain(stderr, state.clone(), host));
        let mut owned = Self {
            base: String::new(),
            admin: String::new(),
            client,
            child,
            drainer: Some(drainer),
            state,
            started,
            exit_code: None,
            reaped: false,
            drainer_closed: false,
        };
        let result = timeout_at(started + budget, owned.ready(data_dir, host, admin)).await;
        let code = match result {
            Ok(Ok(())) => return Ok(owned),
            Ok(Err(code)) => code,
            Err(_) => FailureCode::Deadline,
        };
        owned.shutdown().await;
        Err(StartupFailure {
            code,
            diagnostics: owned.diagnostics(),
        })
    }

    fn alive(&mut self) -> Result<(), FailureCode> {
        if let Some(status) = self
            .child
            .try_wait()
            .map_err(|_| FailureCode::ChildStatus)?
        {
            self.exit_code = status.code();
            self.reaped = true;
            return Err(FailureCode::ChildExited);
        }
        if let Some(code) = self.state.lock().unwrap().failure {
            return Err(code);
        }
        Ok(())
    }

    async fn ready(
        &mut self,
        dir: &Path,
        host: IpAddr,
        admin: Option<&str>,
    ) -> Result<(), FailureCode> {
        let address = loop {
            self.alive()?;
            let address = self.state.lock().unwrap().address;
            if let Some(address) = address {
                break address;
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        };
        let connect = if host.is_unspecified() {
            SocketAddr::new(
                if host.is_ipv4() {
                    "127.0.0.1".parse().unwrap()
                } else {
                    "::1".parse().unwrap()
                },
                address.port(),
            )
        } else {
            address
        };
        self.base = format!("http://{connect}");
        self.alive()?;
        self.state
            .lock()
            .unwrap()
            .diagnostics
            .health_request_attempts += 1;
        let response = self
            .client
            .get(format!("{}/health", self.base))
            .send()
            .await
            .map_err(|_| FailureCode::HealthTransport)?;
        let status = response.status().as_u16();
        self.state.lock().unwrap().diagnostics.health_status = Some(status);
        if status != 200 {
            return Err(FailureCode::HealthStatus);
        }
        let body = bounded_json(response)
            .await
            .map_err(|_| FailureCode::HealthBody)?;
        if body != serde_json::json!({"status":"ok", "service":"thinrouter"}) {
            return Err(FailureCode::HealthBody);
        }
        self.alive()?;
        self.admin = match admin {
            Some(token) if !token.is_empty() && token.len() <= LINE_LIMIT => token.to_owned(),
            Some(_) => return Err(FailureCode::Token),
            None => {
                let file = tokio::fs::File::open(dir.join("admin-token"))
                    .await
                    .map_err(|_| FailureCode::Token)?;
                let mut bytes = Vec::with_capacity(LINE_LIMIT + 1);
                file.take((LINE_LIMIT + 1) as u64)
                    .read_to_end(&mut bytes)
                    .await
                    .map_err(|_| FailureCode::Token)?;
                if bytes.len() > LINE_LIMIT {
                    return Err(FailureCode::Token);
                }
                let token = String::from_utf8(bytes).map_err(|_| FailureCode::Token)?;
                if token.trim().is_empty() {
                    return Err(FailureCode::Token);
                }
                token.trim().to_owned()
            }
        };
        self.alive()?;
        self.state
            .lock()
            .unwrap()
            .diagnostics
            .admin_request_attempts += 1;
        let response = self
            .client
            .get(format!("{}/admin/api/stats", self.base))
            .header("x-admin-token", &self.admin)
            .send()
            .await
            .map_err(|_| FailureCode::AdminTransport)?;
        let status = response.status().as_u16();
        self.state.lock().unwrap().diagnostics.admin_status = Some(status);
        if status != 200 {
            return Err(FailureCode::AdminStatus);
        }
        let stats = bounded_json(response)
            .await
            .map_err(|_| FailureCode::AdminBody)?;
        if !stats.is_object()
            || !stats
                .get("connections")
                .is_some_and(serde_json::Value::is_u64)
        {
            return Err(FailureCode::AdminBody);
        }
        self.alive()
    }

    pub fn id(&self) -> Option<u32> {
        self.child.id()
    }

    pub fn diagnostics(&self) -> Diagnostics {
        let mut result = self.state.lock().unwrap().diagnostics;
        result.elapsed_ms = self.started.elapsed().as_millis().min(u64::MAX as u128) as u64;
        result.exit_code = self.exit_code;
        result.child_reaped = self.reaped;
        result.drainer_closed = self.drainer_closed;
        result
    }

    pub async fn shutdown(&mut self) {
        if !self.reaped {
            let _ = self.child.start_kill();
            if let Ok(Ok(status)) = timeout(Duration::from_secs(1), self.child.wait()).await {
                self.exit_code = status.code();
                self.reaped = true;
            }
        }
        if let Some(mut task) = self.drainer.take() {
            self.drainer_closed = if timeout(Duration::from_millis(100), &mut task).await.is_ok() {
                true
            } else {
                task.abort();
                timeout(Duration::from_millis(100), task).await.is_ok()
            };
        }
    }
}

impl Drop for OwnedGateway {
    fn drop(&mut self) {
        if !self.reaped {
            let _ = self.child.start_kill();
        }
        if let Some(task) = self.drainer.take() {
            task.abort();
        }
    }
}

async fn bounded_json(mut response: reqwest::Response) -> Result<serde_json::Value, ()> {
    let mut body = Vec::with_capacity(BODY_LIMIT);
    while let Some(chunk) = response.chunk().await.map_err(|_| ())? {
        if chunk.len() > BODY_LIMIT - body.len() {
            return Err(());
        }
        body.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&body).map_err(|_| ())
}

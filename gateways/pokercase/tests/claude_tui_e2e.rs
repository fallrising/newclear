//! Approved TUI transport: synthetic child only, never an official CLI/profile.
#![cfg(unix)]

#[path = "support/owned_gateway.rs"]
mod owned_gateway;

use owned_gateway::{command, OwnedGateway};
use serde_json::{json, Value};
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;
use tempfile::TempDir;
use tokio::time::timeout;

const BUDGET: Duration = Duration::from_secs(15);

struct Env {
    gateway: OwnedGateway,
    client: reqwest::Client,
    dir: TempDir,
    peer: TempDir,
    mode: Option<&'static str>,
}

async fn start_gateway(dir: &Path, peer: &Path, mode: Option<&str>) -> OwnedGateway {
    let mut cmd = command(dir, "127.0.0.1", 0, false, None);
    cmd.arg("--claude-bin").arg(peer.join("claude"));
    if let Some(mode) = mode {
        cmd.args(["--claude-mode", mode]);
    }
    cmd.env("BUN_OPTIONS", "INHERITED_CANARY")
        .env("NODE_OPTIONS", "INHERITED_CANARY")
        .env("CLAUDE_CODE_ENTRYPOINT", "INHERITED_CANARY");
    OwnedGateway::start(cmd, dir, "127.0.0.1", None, BUDGET)
        .await
        .expect("owned gateway must announce its bound port and pass own-token readiness")
}

impl Env {
    async fn start(scenario: &str, mode: Option<&'static str>) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let peer = tempfile::tempdir().unwrap();
        std::fs::write(
            peer.path().join("claude"),
            include_str!("fixtures/claude_tui_fake.py"),
        )
        .unwrap();
        std::fs::set_permissions(
            peer.path().join("claude"),
            std::fs::Permissions::from_mode(0o700),
        )
        .unwrap();
        std::fs::write(peer.path().join("scenario"), scenario).unwrap();
        let gateway = start_gateway(dir.path(), peer.path(), mode).await;
        let post = |path: &str, body: Value| {
            gateway
                .client
                .post(format!("{}{path}", gateway.base))
                .header("x-admin-token", &gateway.admin)
                .json(&body)
                .send()
        };
        let response = post("/admin/api/connections/oauth/import", json!({
            "name":"cc", "provider":"claude", "access_token":"", "default_model":"claude-opus-5-5"
        })).await.unwrap();
        assert_eq!(response.status(), 201);
        let key: Value = post("/admin/api/keys", json!({"name":"synthetic-tui"}))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {}", key["secret"].as_str().unwrap())
                .parse()
                .unwrap(),
        );
        let client = reqwest::Client::builder()
            .no_proxy()
            .default_headers(headers)
            // Missing observation deliberately waits through production READY=40s.
            // No other case gets a larger deadline and no success assertion changes.
            .timeout(if scenario == "missing" {
                Duration::from_secs(60)
            } else {
                BUDGET
            })
            .build()
            .unwrap();
        Self {
            gateway,
            client,
            dir,
            peer,
            mode,
        }
    }

    async fn post(&self, path: &str, body: Value) -> reqwest::Response {
        self.client
            .post(format!("{}{path}", self.gateway.base))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    fn records(&self, name: &str) -> Vec<Value> {
        std::fs::read_to_string(self.peer.path().join(name))
            .unwrap_or_default()
            .lines()
            .map(|line| serde_json::from_str(line).unwrap())
            .collect()
    }

    async fn usage(&self) -> Vec<Value> {
        let value: Value = self
            .gateway
            .client
            .get(format!("{}/admin/api/usage", self.gateway.base))
            .header("x-admin-token", &self.gateway.admin)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        value["data"].as_array().unwrap().clone()
    }

    async fn stop(&mut self) {
        let pid = self.gateway.id().unwrap();
        // Owned PID only: allow normal lifecycle/shelf shutdown before guard reaping.
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
        timeout(BUDGET, async {
            loop {
                let state =
                    std::fs::read_to_string(format!("/proc/{pid}/stat")).unwrap_or_default();
                if state.is_empty()
                    || state
                        .split_once(") ")
                        .is_some_and(|(_, s)| s.starts_with('Z'))
                {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("owned gateway terminates");
        self.gateway.shutdown().await;
        for file in ["starts.jsonl", "helpers.jsonl", "descendants.jsonl"] {
            for record in self.records(file) {
                let pid = record["pid"].as_u64().unwrap();
                timeout(Duration::from_secs(5), async {
                    while Path::new(&format!("/proc/{pid}")).exists() {
                        tokio::time::sleep(Duration::from_millis(10)).await;
                    }
                })
                .await
                .expect("owned PTY/MCP child must be reaped");
            }
        }
    }

    async fn private_files_gone(&self) {
        for record in self.records("private.jsonl") {
            assert_eq!(record["dir_mode"], 0o700);
            assert_eq!(record["tap_mode"], 0o600);
            let path = Path::new(record["tap_dir"].as_str().unwrap());
            timeout(Duration::from_secs(8), async {
                while path.exists() {
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
            })
            .await
            .expect("owned response-tap directory must be removed");
        }
    }

    async fn restart(&mut self) {
        self.stop().await;
        self.gateway = start_gateway(self.dir.path(), self.peer.path(), self.mode).await;
    }
}

fn ask(stream: bool) -> Value {
    json!({"model":"cc", "max_tokens":100, "stream":stream,
        "messages":[{"role":"user", "content":"synthetic greeting"}]})
}

fn events(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| line.strip_prefix("data: "))
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect()
}

async fn until_text(response: &mut reqwest::Response, text: &mut String, marker: &str) {
    timeout(BUDGET, async {
        while !text.contains(marker) {
            let chunk = response
                .chunk()
                .await
                .unwrap()
                .expect("stream ended before marker");
            text.push_str(std::str::from_utf8(&chunk).unwrap());
        }
    })
    .await
    .expect("incremental response must precede completion gate");
}

#[test]
fn tui_mode_is_an_explicit_server_capability() {
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
        .args(["serve", "--help"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let help = String::from_utf8(output.stdout).unwrap();
    assert!(
        help.contains("--claude-mode"),
        "server has no TUI transport selector"
    );
    assert!(help.contains("tui") && help.contains("print"));
}

#[tokio::test]
async fn default_tui_streams_before_transcript_and_preserves_usage_once() {
    let mut env = Env::start("gated", None).await;
    let mut response = env.post("/v1/messages", ask(true)).await;
    assert_eq!(response.status(), 200);
    let mut body = String::new();
    until_text(&mut response, &mut body, "early-tui").await;
    assert!(
        !env.peer.path().join("assistant-written").exists(),
        "delta must arrive before complete transcript"
    );
    std::fs::write(env.peer.path().join("release"), "").unwrap();
    while let Some(chunk) = response.chunk().await.unwrap() {
        body.push_str(std::str::from_utf8(&chunk).unwrap());
    }
    let data = events(&body);
    assert_eq!(
        data.iter()
            .filter(|v| v["type"] == "content_block_delta" && v["delta"]["text"] == "early-tui")
            .count(),
        1
    );
    assert_eq!(
        data.iter().filter(|v| v["type"] == "message_stop").count(),
        1
    );
    let usage = &data.iter().find(|v| v["type"] == "message_start").unwrap()["message"]["usage"];
    assert_eq!(usage["input_tokens"], 2);
    assert_eq!(usage["cache_creation_input_tokens"], 3);
    assert_eq!(usage["cache_read_input_tokens"], 5);
    assert_eq!(
        data.iter().find(|v| v["type"] == "message_delta").unwrap()["usage"]["output_tokens"],
        7
    );
    let starts = env.records("starts.jsonl");
    assert_eq!(starts.len(), 1);
    assert_eq!(starts[0]["interactive"], true);
    assert_eq!(starts[0]["loader_clean"], true);
    assert_eq!(starts[0]["entrypoint_clean"], true);
    let rows = env.usage().await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["outcome"], "succeeded");
    assert_eq!(rows[0]["usage_status"], "complete");
    assert_eq!(rows[0]["reported_usage"]["cache_creation_input_tokens"], 3);
    assert_eq!(rows[0]["reported_usage"]["cache_read_input_tokens"], 5);
    assert!(rows[0]["request_id"]
        .as_str()
        .is_some_and(|s| !s.is_empty()));
    env.stop().await;
}

#[tokio::test]
async fn explicit_print_remains_separate() {
    let mut env = Env::start("print", Some("print")).await;
    let response = env.post("/v1/messages", ask(false)).await;
    assert_eq!(response.status(), 200);
    let value: Value = response.json().await.unwrap();
    assert_eq!(value["content"][0]["text"], "explicit-print");
    assert_eq!(env.records("starts.jsonl")[0]["interactive"], false);
    env.stop().await;
}

#[tokio::test]
async fn unavailable_or_cut_tap_never_reports_success_or_print_fallback() {
    for scenario in ["missing", "cut", "unobserved"] {
        let mut env = Env::start(scenario, Some("tui")).await;
        let response = env.post("/v1/messages", ask(false)).await;
        assert!(
            !response.status().is_success(),
            "{scenario} cannot become a completed successful response"
        );
        let body = response.text().await.unwrap();
        assert!(!body.contains("PRIVATE_TERMINAL_CANARY"));
        assert!(!body.contains("MUST_NOT_BECOME_SUCCESS"));
        let starts = env.records("starts.jsonl");
        assert!(!starts.is_empty());
        assert!(
            starts.iter().all(|v| v["interactive"] == true),
            "no print fallback"
        );
        env.stop().await;
    }
}

#[tokio::test]
async fn disconnect_stops_the_owned_pty_before_completion() {
    let mut env = Env::start("cancel", None).await;
    let mut response = env.post("/v1/messages", ask(true)).await;
    let mut body = String::new();
    until_text(&mut response, &mut body, "early-tui").await;
    let pid = env.records("starts.jsonl")[0]["pid"].as_u64().unwrap();
    drop(response);
    timeout(Duration::from_secs(5), async {
        while Path::new(&format!("/proc/{pid}")).exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("cancelled PTY must exit without waiting for synthetic release");
    assert!(!env.peer.path().join("assistant-written").exists());
    env.stop().await;
    env.private_files_gone().await;
}

#[tokio::test]
#[cfg(target_os = "linux")]
async fn hard_helper_kill_reaps_descendant_watchdog_and_private_files() {
    let mut env = Env::start("hardkill", None).await;
    let mut response = env.post("/v1/messages", ask(true)).await;
    let mut body = String::new();
    until_text(&mut response, &mut body, "early-tui").await;
    let private = env.records("private.jsonl");
    let helper = private[0]["helper_pid"].as_u64().unwrap();
    // Inspect only the already-witnessed helper's own children (PTY + watchdog).
    let children =
        std::fs::read_to_string(format!("/proc/{helper}/task/{helper}/children")).unwrap();
    let owned: Vec<u32> = children
        .split_whitespace()
        .map(|p| p.parse().unwrap())
        .collect();
    assert!(
        owned.len() >= 2,
        "PTY and cleanup watchdog must both be present"
    );
    let sentinel = env.peer.path().join("unrelated-preserve");
    std::fs::write(&sentinel, "owned test sentinel outside tap directory").unwrap();
    assert_eq!(unsafe { libc::kill(helper as i32, libc::SIGKILL) }, 0);
    drop(response);
    timeout(Duration::from_secs(8), async {
        for pid in &owned {
            while Path::new(&format!("/proc/{pid}")).exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
    })
    .await
    .expect("hard-killed helper leaves no PTY or watchdog process");
    env.private_files_gone().await;
    assert_eq!(
        std::fs::read_to_string(sentinel).unwrap(),
        "owned test sentinel outside tap directory"
    );
    assert!(!env.peer.path().join("assistant-written").exists());
    env.stop().await;
}

#[tokio::test]
async fn mcp_tool_result_returns_to_same_interactive_child() {
    let mut env = Env::start("tool", None).await;
    let tools = json!([{"type":"function", "function":{"name":"get_weather", "parameters":{"type":"object", "properties":{"city":{"type":"string"}}}}}]);
    let response = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc", "tools":tools,
        "messages":[{"role":"user", "content":"weather?"}]}),
        )
        .await;
    assert_eq!(response.status(), 200);
    let first: Value = response.json().await.unwrap();
    let call = &first["choices"][0]["message"]["tool_calls"][0];
    assert_eq!(call["id"], "toolu_tui");
    assert_eq!(call["function"]["name"], "get_weather");
    assert_eq!(
        serde_json::from_str::<Value>(call["function"]["arguments"].as_str().unwrap()).unwrap(),
        json!({"city":"Taipei"})
    );
    let response = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc", "tools":tools, "messages":[
        {"role":"user", "content":"weather?"},
        {"role":"assistant", "content":null, "tool_calls":[call]},
        {"role":"tool", "tool_call_id":"toolu_tui", "content":"sunny"}]}),
        )
        .await;
    assert_eq!(response.status(), 200);
    let next: Value = response.json().await.unwrap();
    assert_eq!(next["choices"][0]["message"]["content"], "Result: sunny");
    assert_eq!(env.records("starts.jsonl").len(), 1);
    assert_eq!(env.records("turns.jsonl").len(), 1);
    assert_eq!(
        env.records("mcp-result.jsonl")[0]["result"]["content"][0]["text"],
        "sunny"
    );
    env.stop().await;
}

#[tokio::test]
async fn continuation_and_gateway_restart_use_owned_saved_session() {
    let mut env = Env::start("delayedtap", None).await;
    let first: Value = env
        .post("/v1/messages", ask(false))
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(first["content"][0]["text"], "turn-1");
    let history = json!({"model":"cc", "max_tokens":100, "messages":[
        {"role":"user", "content":"synthetic greeting"},
        {"role":"assistant", "content":"turn-1"},
        {"role":"user", "content":"next"}]});
    let second: Value = env
        .post("/v1/messages", history)
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(second["content"][0]["text"], "turn-2");
    assert_eq!(env.records("starts.jsonl").len(), 1);
    let before = env.usage().await;
    assert_eq!(before.len(), 2);
    assert_ne!(before[0]["request_id"], before[1]["request_id"]);
    env.restart().await;
    assert_eq!(
        env.usage().await,
        before,
        "restart preserves original usage IDs and amounts"
    );
    let third: Value = env
        .post(
            "/v1/messages",
            json!({"model":"cc", "max_tokens":100, "messages":[
        {"role":"user", "content":"synthetic greeting"}, {"role":"assistant", "content":"turn-1"},
        {"role":"user", "content":"next"}, {"role":"assistant", "content":"turn-2"},
        {"role":"user", "content":"after restart"}]}),
        )
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(third["content"][0]["text"], "turn-1");
    let starts = env.records("starts.jsonl");
    assert_eq!(starts.len(), 2);
    assert!(starts[1]["args"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a == "--resume"));
    env.stop().await;
}

#[tokio::test]
async fn cancellation_preserves_polite_cleanup_grace() {
    let mut env = Env::start("grace", None).await;
    let mut response = env.post("/v1/messages", ask(true)).await;
    let mut body = String::new();
    until_text(&mut response, &mut body, "early-tui").await;
    drop(response);
    timeout(Duration::from_secs(5), async {
        while !env.peer.path().join("graceful-cleanup").exists() {
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
    })
    .await
    .expect("official child gets time for polite cleanup before forced kill");
    env.stop().await;
    env.private_files_gone().await;
}

#[tokio::test]
async fn responses_protocol_completes_from_the_interactive_event_stream() {
    let mut env = Env::start("delayedtap", None).await;
    let response = env
        .post(
            "/v1/responses",
            json!({"model":"cc","input":"hello","stream":true}),
        )
        .await;
    assert_eq!(response.status(), 200);
    let body = response.text().await.unwrap();
    assert!(body.contains("response.output_text.delta"));
    assert!(body.contains("turn-1"));
    assert!(body.contains("response.completed"));
    let rows = env.usage().await;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["outcome"], "succeeded");
    env.stop().await;
}

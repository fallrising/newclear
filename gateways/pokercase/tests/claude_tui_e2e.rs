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
async fn changed_tool_history_starts_fresh_without_delivering_to_old_callback() {
    let mut env = Env::start("tool", None).await;
    let tools = json!([{"type":"function", "function":{"name":"get_weather", "parameters":{"type":"object", "properties":{"city":{"type":"string"}}}}}]);
    let first = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc", "tools":tools,
        "messages":[{"role":"user", "content":"original question"}]}),
        )
        .await;
    assert_eq!(first.status(), 200);
    let first: Value = first.json().await.unwrap();
    let call = first["choices"][0]["message"]["tool_calls"][0].clone();
    // Only a newly started fake child reads this scenario. The original remains
    // blocked on its real MCP callback, so an accidental continuation is visible.
    std::fs::write(env.peer.path().join("scenario"), "delayedtap").unwrap();
    let changed = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc", "tools":tools,
        "messages":[{"role":"user", "content":"rewritten question"},
            {"role":"assistant", "content":null, "tool_calls":[call]},
            {"role":"tool", "tool_call_id":"toolu_tui", "content":"wrong-context-result"}]}),
        )
        .await;
    assert_eq!(changed.status(), 200);
    let changed: Value = changed.json().await.unwrap();
    assert_eq!(changed["choices"][0]["message"]["content"], "turn-1");
    assert_eq!(env.records("starts.jsonl").len(), 2);
    let turns = env.records("turns.jsonl");
    assert_eq!(turns.len(), 2);
    assert_ne!(turns[0]["pid"], turns[1]["pid"]);
    let prompt = turns[1]["prompt"].as_str().unwrap();
    assert!(prompt.contains("rewritten question"));
    assert!(prompt.contains("wrong-context-result"));
    assert!(env.records("mcp-result.jsonl").is_empty());
    let valid = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc", "tools":tools,
        "messages":[{"role":"user", "content":"original question"},
            {"role":"assistant", "content":null, "tool_calls":[call]},
            {"role":"tool", "tool_call_id":"toolu_tui", "content":"correct-result"}]}),
        )
        .await;
    assert_eq!(valid.status(), 200);
    let valid: Value = valid.json().await.unwrap();
    assert_eq!(
        valid["choices"][0]["message"]["content"],
        "Result: correct-result"
    );
    assert_eq!(env.records("starts.jsonl").len(), 2);
    assert_eq!(env.records("turns.jsonl").len(), 2);
    let results = env.records("mcp-result.jsonl");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0]["result"]["content"][0]["text"], "correct-result");
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
async fn dc2_ordered_inline_user_turns_reuse_child_and_saved_session() {
    let mut env = Env::start("delayedtap", None).await;
    let mut messages = json!([
        {"role":"system","content":[{"type":"text","text":"initial inline context"}]},
        {"role":"user","content":"first question"}
    ]);
    let first = env
        .post(
            "/v1/messages",
            json!({"model":"cc","max_tokens":100,"system":"stable top","messages":messages}),
        )
        .await;
    assert_eq!(first.status(), 200);
    assert_eq!(
        first.json::<Value>().await.unwrap()["content"][0]["text"],
        "turn-1"
    );
    messages[0]["content"] = json!("initial inline context");
    messages.as_array_mut().unwrap().extend([
        json!({"role":"assistant","content":"turn-1"}),
        json!({"role":"developer","content":"second context"}),
        json!({"role":"user","content":"second question"}),
    ]);
    let second=env.post("/v1/messages",json!({"model":"cc","max_tokens":100,"system":[{"type":"text","text":"stable top"}],"messages":messages})).await;
    assert_eq!(second.status(), 200);
    assert_eq!(
        second.json::<Value>().await.unwrap()["content"][0]["text"],
        "turn-2"
    );
    assert_eq!(env.records("starts.jsonl").len(), 1);
    let turns = env.records("turns.jsonl");
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[0]["pid"], turns[1]["pid"]);
    assert_eq!(
        turns[0]["pieces"], 2,
        "stable and conversation blocks both acknowledged"
    );
    let first_prompt = turns[0]["prompt"].as_str().unwrap();
    assert!(
        first_prompt.find("stable top").unwrap()
            < first_prompt.find("initial inline context").unwrap()
    );
    assert!(
        first_prompt.find("initial inline context").unwrap()
            < first_prompt.find("first question").unwrap()
    );
    let next_prompt = turns[1]["prompt"].as_str().unwrap();
    assert!(next_prompt.contains("Developer: second context"));
    assert!(
        next_prompt.find("second context").unwrap() < next_prompt.find("second question").unwrap()
    );
    assert!(!next_prompt.contains("initial inline context") && !next_prompt.contains("stable top"));
    let before = env.usage().await;
    env.restart().await;
    assert_eq!(env.usage().await, before);
    messages.as_array_mut().unwrap().extend([
        json!({"role":"assistant","content":"turn-2"}),
        json!({"role":"system","content":"restart context"}),
        json!({"role":"user","content":"restart question"}),
    ]);
    let third = env
        .post(
            "/v1/messages",
            json!({"model":"cc","max_tokens":100,"system":"stable top","messages":messages}),
        )
        .await;
    assert_eq!(third.status(), 200);
    assert_eq!(
        third.json::<Value>().await.unwrap()["content"][0]["text"],
        "turn-1"
    );
    let starts = env.records("starts.jsonl");
    assert_eq!(starts.len(), 2);
    assert!(starts[1]["args"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a == "--resume"));
    let turns = env.records("turns.jsonl");
    let resumed = turns[2]["prompt"].as_str().unwrap();
    assert!(resumed.contains("System: restart context"));
    assert!(resumed.find("restart context").unwrap() < resumed.find("restart question").unwrap());
    assert!(!resumed.contains("initial inline context") && !resumed.contains("second context"));
    messages[0]["content"] = json!("rewritten old context");
    messages.as_array_mut().unwrap().extend([
        json!({"role":"assistant","content":"turn-1"}),
        json!({"role":"user","content":"after edit"}),
    ]);
    let edited = env
        .post(
            "/v1/messages",
            json!({"model":"cc","max_tokens":100,"system":"stable top","messages":messages}),
        )
        .await;
    assert_eq!(edited.status(), 200);
    assert_eq!(
        edited.json::<Value>().await.unwrap()["content"][0]["text"],
        "turn-1"
    );
    let starts = env.records("starts.jsonl");
    assert_eq!(starts.len(), 3);
    assert!(!starts[2]["args"]
        .as_array()
        .unwrap()
        .iter()
        .any(|a| a == "--resume"));
    assert_eq!(env.usage().await.len(), 4);
    env.stop().await;
}

#[tokio::test]
async fn dc1_chat_marker_cannot_enable_dynamic_instruction_reuse() {
    let mut env = Env::start("delayedtap", None).await;
    let mut messages = json!([
        {"role":"system","content":"stable chat", "_thinrouter_inline_instruction":true},
        {"role":"user","content":"first"}]);
    let first = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc","messages":messages}),
        )
        .await;
    assert_eq!(first.status(), 200);
    assert_eq!(
        first.json::<Value>().await.unwrap()["choices"][0]["message"]["content"],
        "turn-1"
    );
    messages.as_array_mut().unwrap().extend([
        json!({"role":"assistant","content":"turn-1"}),
        json!({"role":"system","content":"changed chat instructions", "_thinrouter_inline_instruction":true}),
        json!({"role":"user","content":"next"})]);
    let next = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cc","messages":messages}),
        )
        .await;
    assert_eq!(next.status(), 200);
    assert_eq!(
        next.json::<Value>().await.unwrap()["choices"][0]["message"]["content"],
        "turn-1"
    );
    assert_eq!(env.records("starts.jsonl").len(), 2);
    env.stop().await;
}

#[tokio::test]
async fn dc3_new_tool_notice_starts_fresh_and_original_result_still_continues() {
    let mut env = Env::start("tool", None).await;
    let tools = json!([{"name":"get_weather","input_schema":{"type":"object","properties":{"city":{"type":"string"}}}}]);
    let prefix = json!([{"role":"system","content":"heard tool context"},{"role":"user","content":"weather?"}]);
    let first = env
        .post(
            "/v1/messages",
            json!({"model":"cc","max_tokens":100,"tools":tools,"messages":prefix}),
        )
        .await;
    assert_eq!(first.status(), 200);
    let first: Value = first.json().await.unwrap();
    let mut messages = prefix.as_array().unwrap().clone();
    messages.extend([json!({"role":"assistant","content":first["content"]}),
        json!({"role":"user","content":[{"type":"tool_result","tool_use_id":"toolu_tui","content":"sunny"}]})]);
    let valid = messages.clone();
    messages.push(json!({"role":"developer","content":"new tool notice"}));
    std::fs::write(env.peer.path().join("scenario"), "delayedtap").unwrap();
    let changed = env
        .post(
            "/v1/messages",
            json!({"model":"cc","max_tokens":100,"tools":tools,"messages":messages}),
        )
        .await;
    assert_eq!(changed.status(), 200);
    assert_eq!(
        changed.json::<Value>().await.unwrap()["content"][0]["text"],
        "turn-1"
    );
    assert_eq!(env.records("starts.jsonl").len(), 2);
    assert!(env.records("mcp-result.jsonl").is_empty());
    let turns = env.records("turns.jsonl");
    let prompt = turns[1]["prompt"].as_str().unwrap();
    assert!(prompt.find("sunny").unwrap() < prompt.find("new tool notice").unwrap());
    assert!(prompt.contains("Developer: new tool notice"));
    let corrected = env
        .post(
            "/v1/messages",
            json!({"model":"cc","max_tokens":100,"tools":tools,"messages":valid}),
        )
        .await;
    assert_eq!(corrected.status(), 200);
    assert_eq!(
        corrected.json::<Value>().await.unwrap()["content"][0]["text"],
        "Result: sunny"
    );
    assert_eq!(env.records("starts.jsonl").len(), 2);
    assert_eq!(env.records("mcp-result.jsonl").len(), 1);
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

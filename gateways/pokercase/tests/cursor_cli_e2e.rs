//! The `cursor` provider runs the official Cursor Agent CLI. A Python stand-in records
//! its arguments and environment and prints stream-json as documented at
//! https://cursor.com/docs/cli/reference/output-format (with --stream-partial-output).

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

/// Answers "Hello there" (two deltas plus the duplicate flushes); "FAIL" in the prompt →
/// not-logged-in error on stderr with exit 1.
const FAKE_CURSOR: &str = r#"#!/usr/bin/env python3
import json, os, sys, time
d = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
with open(os.path.join(d, "args.json"), "w") as f: json.dump(args, f)
with open(os.path.join(d, "env.txt"), "w") as f: f.write("\n".join(k + "=" + v for k, v in os.environ.items()))
prompt = args[-1]
if "NO_SANDBOX" in prompt:
    sys.stderr.write("Error: Sandbox mode is enabled but not available on this system. PRIVATE-STDERR-CANARY\n"); sys.exit(1)
if "LEAK" in prompt:
    sys.stderr.write("not logged in PRIVATE-STDERR-CANARY\n"); sys.exit(1)
if "FAIL" in prompt:
    sys.stderr.write("Error: not logged in. Run cursor-agent login\n"); sys.exit(1)
def out(o): sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
if "HANG_" in prompt:
    with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
    if "HANG_AFTER" in prompt:
        out({"type":"assistant","timestamp_ms":1,"message":{"content":[{"type":"text","text":"partial"}]}})
    while True: time.sleep(60)

if "BAD_RESULT" in prompt or "EARLY_EOF" in prompt:
    if "PARTIAL" in prompt:
        out({"type": "assistant", "timestamp_ms": 1, "message": {"content": [{"type": "text", "text": "partial answer"}]}})
    if "BAD_RESULT" in prompt:
        out({"type": "result", "subtype": "error", "is_error": True, "result": "PRIVATE-RESULT-CANARY"})
        # A subsequent success must not rescue a failed terminal event.
        out({"type": "result", "subtype": "success", "is_error": False, "result": "PRIVATE-RESULT-CANARY"})
    sys.exit(0)
# Shape recorded from cursor-agent 2026.10.16 (`-p --output-format stream-json
# --stream-partial-output --mode ask`): thinking deltas, streamed assistant deltas
# (timestamp_ms, no model_call_id), a final unstamped flush, and usage on the result.
sid = "345d87ff-d504-44d2-86e0-a530f774b8dc"
out({"type": "system", "subtype": "init", "apiKeySource": "login", "cwd": os.getcwd(), "session_id": sid, "model": "Auto", "permissionMode": "default"})
out({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}, "session_id": sid})
out({"type": "thinking", "subtype": "delta", "text": "The user wants", "session_id": sid, "timestamp_ms": 1})
out({"type": "thinking", "subtype": "completed", "session_id": sid, "timestamp_ms": 2})
out({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello "}]}, "session_id": sid, "timestamp_ms": 3})
out({"type": "tool_call", "subtype": "started", "call_id": "t1", "tool_call": {"readToolCall": {"args": {"path": "README.md"}}}, "session_id": sid})
out({"type": "assistant", "timestamp_ms": 4, "model_call_id": "m1", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello "}]}, "session_id": sid})
out({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "there"}]}, "session_id": sid, "timestamp_ms": 5})
out({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello there"}]}, "session_id": sid})
out({"type": "result", "subtype": "success", "duration_ms": 5, "duration_api_ms": 5, "is_error": False, "result": "Hello there", "session_id": sid, "request_id": "r1", "usage": {"inputTokens": 9359, "outputTokens": 33, "cacheReadTokens": 3328, "cacheWriteTokens": 0}})
"#;

const FAKE_DOCKER: &str = r#"#!/usr/bin/env python3
import json, os, subprocess, sys
d = os.path.dirname(os.path.abspath(__file__))
a = sys.argv[1:]
if "rm" in a:
    with open(os.path.join(d, "cleanup.jsonl"), "a") as f: f.write(json.dumps(a) + "\n")
    sys.exit(0)
assert "run" in a, a
with open(os.path.join(d, "docker-args.json"), "w") as f: json.dump(a, f)
i = next(i for i, x in enumerate(a) if x.startswith("sha256:"))
entry = a[a.index("--entrypoint") + 1]
# For hanging fixtures the runtime owns the exact executable PID; no orphan child.
if "HANG_" in a[-1]:
    os.execvpe(entry, [entry] + a[i+1:], {"PATH": os.environ.get("PATH", "/usr/bin:/bin")})
sys.exit(subprocess.call([entry] + a[i+1:], env={"PATH": os.environ.get("PATH", "/usr/bin:/bin")}))
"#;

struct Env {
    base: String,
    client: reqwest::Client,
    bin_dir: TempDir,
    _child: tokio::process::Child,
    _dir: TempDir,
}

impl Env {
    async fn start() -> Self {
        Self::start_with(&[
            "--cursor-accept-account-plugins",
            "--cursor-image",
            "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "--cursor-profile-volume",
            "thinrouter-cursor-tests",
        ])
        .await
    }

    async fn start_with(extra: &[&str]) -> Self {
        let bin_dir = tempfile::tempdir().unwrap();
        let bin = bin_dir.path().join("cursor-agent");
        std::fs::write(&bin, FAKE_CURSOR).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let runtime = bin_dir.path().join("docker");
        std::fs::write(&runtime, FAKE_DOCKER).unwrap();
        std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o755)).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
            l.local_addr().unwrap().port()
        };
        let child = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"))
            .args([
                "serve",
                "--port",
                &port.to_string(),
                "--data-dir",
                dir.path().to_str().unwrap(),
                "--cursor-bin",
                bin.to_str().unwrap(),
                "--cursor-runtime-bin",
                runtime.to_str().unwrap(),
            ])
            .args(extra)
            .env_remove("THINROUTER_ADMIN_TOKEN")
            .env_remove("THINROUTER_SECRETS_KEY")
            .env("CURSOR_API_ENDPOINT", "http://evil.example")
            .env("HOST_SECRET_CANARY", "do-not-forward")
            .kill_on_drop(true)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .spawn()
            .unwrap();
        let base = format!("http://127.0.0.1:{port}");
        let plain = reqwest::Client::builder().no_proxy().build().unwrap();
        for _ in 0..100 {
            if plain
                .get(format!("{base}/health"))
                .send()
                .await
                .is_ok_and(|r| r.status().is_success())
            {
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        let admin = std::fs::read_to_string(dir.path().join("admin-token")).unwrap();
        let post = |path: &str, body: Value| {
            plain
                .post(format!("{base}{path}"))
                .header("x-admin-token", admin.trim())
                .json(&body)
                .send()
        };
        let r = post(
            "/admin/api/connections/oauth/import",
            json!({"name": "cu", "provider": "cursor", "access_token": "", "default_model": "gpt-5"}),
        )
        .await
        .unwrap();
        assert_eq!(r.status(), 201, "{}", r.text().await.unwrap());
        let key: Value = post("/admin/api/keys", json!({"name": "t"}))
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
            .timeout(Duration::from_secs(15))
            .build()
            .unwrap();
        Self {
            base,
            client,
            bin_dir,
            _child: child,
            _dir: dir,
        }
    }

    async fn post(&self, path: &str, body: Value) -> reqwest::Response {
        self.client
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .unwrap()
    }

    fn args(&self) -> Vec<String> {
        serde_json::from_str(
            &std::fs::read_to_string(self.bin_dir.path().join("args.json")).unwrap(),
        )
        .unwrap()
    }
}

#[tokio::test]
async fn cursor_answers_through_the_container_runtime() {
    let env = Env::start().await;

    // Chat, non-stream: duplicate flushes skipped.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cu", "messages": [
                {"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]}),
        )
        .await;
    assert_eq!(r.status(), 200);
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(v["usage"]["prompt_tokens"], 9359);
    assert_eq!(v["usage"]["completion_tokens"], 33);
    assert!(
        !v.to_string().contains("The user wants"),
        "thinking is not passed on"
    );

    let args = env.args();
    assert!(args.windows(2).any(|w| w[0] == "--mode" && w[1] == "ask"));
    assert!(args
        .windows(2)
        .any(|w| w[0] == "--sandbox" && w[1] == "disabled"));
    assert!(args
        .windows(2)
        .any(|w| w[0] == "--model" && w[1] == "gpt-5"));
    assert!(args.iter().any(|a| a == "--stream-partial-output"));
    for never in ["--force", "--yolo", "--approve-mcps"] {
        assert!(!args.iter().any(|a| a == never), "{never}");
    }
    let prompt = args.last().unwrap();
    assert!(prompt.starts_with("<external_system_instructions>\nbe brief"));
    assert!(prompt.contains("Human: hi"));
    let env_txt = std::fs::read_to_string(env.bin_dir.path().join("env.txt")).unwrap();
    assert!(
        !env_txt.contains("evil.example"),
        "CURSOR_API_ENDPOINT is not passed on"
    );

    let docker_args: Vec<String> = serde_json::from_str(
        &std::fs::read_to_string(env.bin_dir.path().join("docker-args.json")).unwrap(),
    )
    .unwrap();
    assert!(docker_args.iter().any(|a| a == "--read-only"));
    assert!(docker_args.iter().any(|a| a == "--pull=never"));
    assert!(docker_args
        .windows(2)
        .any(|w| w[0] == "--user" && w[1] == "1000:1000"));
    assert!(docker_args
        .windows(2)
        .any(|w| w[0] == "--network" && w[1] == "bridge"));
    assert!(docker_args.iter().all(|a| !a.contains("type=bind")));
    assert!(!env_txt.contains("HOST_SECRET_CANARY"));
    for _ in 0..50 {
        if env.bin_dir.path().join("cleanup.jsonl").exists() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    let cleanup = std::fs::read_to_string(env.bin_dir.path().join("cleanup.jsonl")).unwrap();
    let name = &docker_args[docker_args.iter().position(|a| a == "--name").unwrap() + 1];
    assert!(cleanup.contains(name));

    // Anthropic, stream.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cu", "max_tokens": 50, "stream": true, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let text = r.text().await.unwrap();
    let events: Vec<&str> = text
        .lines()
        .filter_map(|l| l.strip_prefix("event: "))
        .collect();
    assert_eq!(events.first(), Some(&"message_start"));
    assert_eq!(events.last(), Some(&"message_stop"));
    let deltas: String = text
        .lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .filter_map(|d| serde_json::from_str::<Value>(d).ok())
        .filter_map(|v| {
            v.pointer("/delta/text")
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })
        .collect();
    assert_eq!(deltas, "Hello there");

    // Responses, stream.
    let r = env
        .post(
            "/v1/responses",
            json!({"model": "cu", "stream": true, "input": "hi"}),
        )
        .await;
    let text = r.text().await.unwrap();
    let last: Value = serde_json::from_str(
        text.lines()
            .rev()
            .find_map(|l| l.strip_prefix("data: "))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(last["type"], "response.completed");
    assert_eq!(
        last["response"]["output"][0]["content"][0]["text"],
        "Hello there"
    );
}

#[tokio::test]
async fn cursor_refuses_what_the_cli_cannot_take() {
    let env = Env::start().await;
    let tools = json!([{"type": "function", "function": {"name": "f", "parameters": {}}}]);
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cu", "tools": tools, "messages": [{"role": "user", "content": "x"}]}),
        )
        .await;
    assert_eq!(r.status(), 501);
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cu", "messages": [{"role": "user", "content": [
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,QQ=="}}]}]}),
        )
        .await;
    assert_eq!(r.status(), 501);
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cu", "messages": [{"role": "user", "content": "FAIL"}]}),
        )
        .await;
    assert_eq!(r.status(), 401);
    assert!(r.text().await.unwrap().contains("not logged in"));
}

#[tokio::test]
async fn cursor_is_off_until_the_operator_accepts_account_plugins() {
    let env = Env::start_with(&[]).await;
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cu", "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    assert_eq!(r.status(), 503);
    let body = r.text().await.unwrap();
    assert!(body.contains("--cursor-accept-account-plugins"), "{body}");
    assert!(
        !env.bin_dir.path().join("args.json").exists(),
        "cursor-agent never started"
    );
}

#[tokio::test]
async fn cursor_requires_container_settings_before_starting_any_process() {
    let env = Env::start_with(&["--cursor-accept-account-plugins"]).await;
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cu", "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    assert_eq!(r.status(), 503);
    assert!(!env.bin_dir.path().join("args.json").exists());
}

#[tokio::test]
async fn cursor_does_not_return_raw_runtime_stderr() {
    let env = Env::start().await;
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model":"cu","messages":[{"role":"user","content":"LEAK"}]}),
        )
        .await;
    assert_eq!(r.status(), 401);
    assert!(!r.text().await.unwrap().contains("PRIVATE-STDERR-CANARY"));
}

#[tokio::test]
async fn unavailable_cursor_sandbox_is_an_actionable_redacted_error() {
    let env = Env::start().await;
    let response = env
        .post(
            "/v1/chat/completions",
            json!({
                "model":"cu", "messages":[{"role":"user","content":"NO_SANDBOX"}]
            }),
        )
        .await;
    assert_eq!(response.status(), 503);
    let body = response.text().await.unwrap();
    assert!(body.contains("Cursor sandbox is unavailable"), "{body}");
    assert!(!body.contains("PRIVATE-STDERR-CANARY"), "{body}");
    let args: Vec<String> = serde_json::from_str(
        &std::fs::read_to_string(env.bin_dir.path().join("args.json")).unwrap(),
    )
    .unwrap();
    assert!(args
        .windows(2)
        .any(|pair| pair == ["--sandbox", "disabled"]));
}

async fn check_cursor_failure(prompt: &str, stream: bool, partial: bool) {
    for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
        let env = Env::start().await;
        let body = if path == "/v1/responses" {
            json!({"model": "cu", "stream": stream, "input": prompt})
        } else {
            json!({"model": "cu", "stream": stream, "max_tokens": 50,
                "messages": [{"role": "user", "content": prompt}]})
        };
        let response = env.post(path, body).await;
        let status = response.status();
        let text = response.text().await.unwrap();
        assert!(
            !text.contains("PRIVATE-RESULT-CANARY"),
            "{path}: leaked result: {text}"
        );
        if !stream || !partial {
            assert_eq!(status, 502, "{path}: {text}");
            let body: Value = serde_json::from_str(&text).unwrap();
            assert!(body.get("error").is_some(), "{path}: {text}");
            assert!(!text.contains("partial answer"), "{path}: {text}");
        } else {
            assert_eq!(status, 200, "{path}: already-started SSE status");
            assert!(text.contains("partial answer"), "{path}: {text}");
            let events: Vec<Value> = text
                .lines()
                .filter_map(|l| l.strip_prefix("data: "))
                .filter_map(|d| serde_json::from_str(d).ok())
                .collect();
            if path == "/v1/responses" {
                assert!(
                    events
                        .iter()
                        .any(|v| v["type"] == "error" && v["message"].as_str().is_some()),
                    "{path}: {text}"
                );
                assert!(
                    events
                        .last()
                        .unwrap()
                        .pointer("/response/error/message")
                        .and_then(Value::as_str)
                        .is_some(),
                    "{path}: {text}"
                );
            } else {
                assert!(
                    events.iter().any(|v| v
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .is_some()),
                    "{path}: {text}"
                );
            }
            assert!(!text.contains("message_stop"), "{path}: {text}");
            assert!(!text.contains("response.completed"), "{path}: {text}");
            assert!(
                !events
                    .iter()
                    .any(|v| v.pointer("/choices/0/finish_reason") == Some(&json!("stop"))),
                "{path}: {text}"
            );
            if path == "/v1/responses" {
                assert_eq!(events.last().unwrap()["type"], "response.failed", "{text}");
            }
        }
        let args: Vec<String> = serde_json::from_str(
            &std::fs::read_to_string(env.bin_dir.path().join("docker-args.json")).unwrap(),
        )
        .unwrap();
        let name = &args[args.iter().position(|a| a == "--name").unwrap() + 1];
        let cleanup = std::fs::read_to_string(env.bin_dir.path().join("cleanup.jsonl")).unwrap();
        assert!(cleanup.contains(name), "request container cleanup missing");
    }
}

#[tokio::test]
async fn ce1_failed_cursor_result_before_output_is_redacted() {
    check_cursor_failure("BAD_RESULT", false, false).await;
    check_cursor_failure("BAD_RESULT", true, false).await;
}

#[tokio::test]
async fn ce2_failed_cursor_result_after_output_is_not_success() {
    check_cursor_failure("PARTIAL BAD_RESULT", false, true).await;
    check_cursor_failure("PARTIAL BAD_RESULT", true, true).await;
}

#[tokio::test]
async fn ce2_cursor_eof_after_output_is_not_success() {
    check_cursor_failure("PARTIAL EARLY_EOF", false, true).await;
    check_cursor_failure("PARTIAL EARLY_EOF", true, true).await;
}

// Process-reaping evidence uses Linux procfs; other platforms retain the existing tests.
#[cfg(target_os = "linux")]
mod disconnect_tests {
    use super::*;
    struct HangingCursor {
        pid: i32,
        bin: std::path::PathBuf,
    }
    impl Drop for HangingCursor {
        fn drop(&mut self) {
            let cmd = std::fs::read(format!("/proc/{}/cmdline", self.pid)).unwrap_or_default();
            if cmd
                .split(|b| *b == 0)
                .any(|arg| arg == self.bin.as_os_str().as_encoded_bytes())
            {
                unsafe {
                    libc::kill(self.pid, libc::SIGKILL);
                }
            }
        }
    }
    #[tokio::test]
    async fn dc3_cursor_disconnect_reaps_runtime_reconciles_and_releases_slot() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [true, false] {
                for phase in ["HANG_BEFORE", "HANG_AFTER"] {
                    let env = Env::start_with(&[
                        "--cursor-accept-account-plugins",
                        "--cursor-image",
                        "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                        "--cursor-profile-volume",
                        "thinrouter-cursor-tests",
                        "--cursor-max-runs",
                        "1",
                    ])
                    .await;
                    let body = if path == "/v1/responses" {
                        json!({"model":"cu","stream":stream,"input":phase})
                    } else {
                        json!({"model":"cu","stream":stream,"max_tokens":30,"messages":[{"role":"user","content":phase}]})
                    };
                    let request = env.client.post(format!("{}{path}", env.base)).json(&body);
                    let pending = tokio::spawn(async move { request.send().await });
                    let pid = tokio::time::timeout(Duration::from_secs(3), async {
                        loop {
                            if let Ok(raw) =
                                std::fs::read_to_string(env.bin_dir.path().join("hanging.pid"))
                            {
                                if let Ok(pid) = raw.parse::<i32>() {
                                    break pid;
                                }
                            }
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                    })
                    .await
                    .expect("fake runtime reached silent phase");
                    let _fixture = HangingCursor {
                        pid,
                        bin: env.bin_dir.path().join("cursor-agent"),
                    };
                    let args: Vec<String> = serde_json::from_str(
                        &std::fs::read_to_string(env.bin_dir.path().join("docker-args.json"))
                            .unwrap(),
                    )
                    .unwrap();
                    let name = args[args.iter().position(|a| a == "--name").unwrap() + 1].clone();
                    if stream && phase == "HANG_AFTER" {
                        let mut response = pending.await.unwrap().unwrap();
                        assert_eq!(response.status(), 200);
                        assert!(response.chunk().await.unwrap().is_some());
                        drop(response);
                    } else {
                        pending.abort();
                        let _ = pending.await;
                    }
                    tokio::time::timeout(Duration::from_secs(3), async {
                        loop {
                            let reaped = !std::path::Path::new(&format!("/proc/{pid}")).exists();
                            let reconciled =
                                std::fs::read_to_string(env.bin_dir.path().join("cleanup.jsonl"))
                                    .unwrap_or_default()
                                    .lines()
                                    .any(|l| {
                                        serde_json::from_str::<Vec<String>>(l)
                                            .unwrap()
                                            .contains(&name)
                                    });
                            if reaped && reconciled {
                                break;
                            }
                            tokio::time::sleep(Duration::from_millis(10)).await;
                        }
                    })
                    .await
                    .expect("runtime reaped and named container reconciliation requested");
                    let response = tokio::time::timeout(
                    Duration::from_secs(3),
                    env.post(
                        "/v1/chat/completions",
                        json!({"model":"cu","messages":[{"role":"user","content":"replacement"}]}),
                    ),
                )
                .await
                .expect("single slot is released");
                    assert_eq!(response.status(), 200);
                    let value: Value = response.json().await.unwrap();
                    assert_eq!(value["choices"][0]["message"]["content"], "Hello there");
                }
            }
        }
    }
}

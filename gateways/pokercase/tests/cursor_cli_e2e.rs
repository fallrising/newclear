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
import json, os, sys
d = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
with open(os.path.join(d, "args.json"), "w") as f: json.dump(args, f)
with open(os.path.join(d, "env.txt"), "w") as f: f.write("\n".join(k + "=" + v for k, v in os.environ.items()))
prompt = args[-1]
if "FAIL" in prompt:
    sys.stderr.write("Error: not logged in. Run cursor-agent login\n"); sys.exit(1)
def out(o): sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
sid = "c0ffee"
out({"type": "system", "subtype": "init", "apiKeySource": "login", "cwd": os.getcwd(), "session_id": sid, "model": "x", "permissionMode": "default"})
out({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": prompt}]}, "session_id": sid})
out({"type": "assistant", "timestamp_ms": 1, "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello "}]}, "session_id": sid})
out({"type": "tool_call", "subtype": "started", "call_id": "t1", "tool_call": {"readToolCall": {"args": {"path": "README.md"}}}, "session_id": sid})
out({"type": "assistant", "timestamp_ms": 2, "model_call_id": "m1", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello "}]}, "session_id": sid})
out({"type": "assistant", "timestamp_ms": 3, "message": {"role": "assistant", "content": [{"type": "text", "text": "there"}]}, "session_id": sid})
out({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello there"}]}, "session_id": sid})
out({"type": "result", "subtype": "success", "duration_ms": 5, "duration_api_ms": 5, "is_error": False, "result": "Hello there", "session_id": sid})
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
        let bin_dir = tempfile::tempdir().unwrap();
        let bin = bin_dir.path().join("cursor-agent");
        std::fs::write(&bin, FAKE_CURSOR).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
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
            ])
            .env_remove("THINROUTER_ADMIN_TOKEN")
            .env_remove("THINROUTER_SECRETS_KEY")
            .env("CURSOR_API_ENDPOINT", "http://evil.example")
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
async fn cursor_answers_through_the_official_cli_read_only() {
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

    let args = env.args();
    assert!(args.windows(2).any(|w| w[0] == "--mode" && w[1] == "ask"));
    assert!(args
        .windows(2)
        .any(|w| w[0] == "--sandbox" && w[1] == "enabled"));
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

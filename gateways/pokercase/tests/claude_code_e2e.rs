//! The `claude` provider runs the local Claude Code CLI. A fake `claude` script stands
//! in for it: it records its arguments, environment and stdin, and prints stream-json
//! like `claude -p --output-format stream-json --include-partial-messages`.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::time::Duration;

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

/// Replies "Hello there" (thinking block first, then text), or fails when the
/// prompt contains "LIMIT", or exits silently when it contains "CRASH".
const FAKE_CLAUDE: &str = r#"#!/bin/sh
dir="$(dirname "$0")"
printf '%s\n' "$@" > "$dir/args.txt"
env > "$dir/env.txt"
cat > "$dir/stdin.txt"
if grep -q CRASH "$dir/stdin.txt"; then echo "boom: not logged in" >&2; exit 1; fi
echo '{"type":"system","subtype":"init","session_id":"s1"}'
if grep -q LIMIT "$dir/stdin.txt"; then
  echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Claude AI usage limit reached|1700000000"}'
  exit 0
fi
ev() { printf '{"type":"stream_event","event":%s}\n' "$1"; }
ev '{"type":"message_start","message":{"id":"msg_01","type":"message","role":"assistant","model":"claude-sonnet-x","content":[],"usage":{"input_tokens":12,"output_tokens":0}}}'
ev '{"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}'
ev '{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"secret thoughts"}}'
ev '{"type":"content_block_stop","index":0}'
ev '{"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}'
ev '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello "}}'
ev '{"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"there"}}'
ev '{"type":"content_block_stop","index":1}'
ev '{"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}'
ev '{"type":"message_stop"}'
echo '{"type":"result","subtype":"success","is_error":false,"result":"Hello there"}'
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
        let bin = bin_dir.path().join("claude");
        std::fs::write(&bin, FAKE_CLAUDE).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();

        let dir = tempfile::tempdir().unwrap();
        let port = {
            let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
            l.local_addr().unwrap().port()
        };
        let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
        cmd.args([
            "serve",
            "--port",
            &port.to_string(),
            "--data-dir",
            dir.path().to_str().unwrap(),
            "--claude-bin",
            bin.to_str().unwrap(),
            "--codex-version",
            "0.0.0",
        ]);
        for name in ["THINROUTER_ADMIN_TOKEN", "THINROUTER_SECRETS_KEY"] {
            cmd.env_remove(name);
        }
        // Must not reach the Claude Code run.
        cmd.env("ANTHROPIC_API_KEY", "sk-should-not-leak")
            .env("ANTHROPIC_BASE_URL", "http://evil.example")
            .env("CLAUDECODE", "1");
        let child = cmd
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
            json!({"name": "cc", "provider": "claude", "access_token": "", "default_model": "sonnet"}),
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

    fn file(&self, name: &str) -> String {
        std::fs::read_to_string(self.bin_dir.path().join(name)).unwrap_or_default()
    }

    async fn post(&self, path: &str, body: Value) -> reqwest::Response {
        self.client
            .post(format!("{}{path}", self.base))
            .json(&body)
            .send()
            .await
            .unwrap()
    }
}

fn sse_data(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .map(|d| serde_json::from_str(d).unwrap_or_else(|_| Value::String(d.to_string())))
        .collect()
}

#[tokio::test]
async fn claude_runs_the_cli_with_claude_codes_own_prompt() {
    let env = Env::start().await;

    // Anthropic client, non-stream.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cc", "max_tokens": 100, "system": "You are a pirate.",
                   "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    assert_eq!(r.status(), 200);
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["content"][0]["text"], "Hello there");
    assert_eq!(
        v["content"].as_array().unwrap().len(),
        1,
        "thinking dropped"
    );
    assert_eq!(v["stop_reason"], "end_turn");
    assert_eq!(v["usage"]["output_tokens"], 5);

    // The real CLI is driven as magpie does; caller system never replaces Claude Code's.
    let args: Vec<String> = env.file("args.txt").lines().map(str::to_string).collect();
    for want in [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "--include-partial-messages",
        "--strict-mcp-config",
        "--no-session-persistence",
    ] {
        assert!(args.iter().any(|a| a == want), "missing {want}: {args:?}");
    }
    assert!(args
        .windows(2)
        .any(|w| w[0] == "--model" && w[1] == "sonnet"));
    assert!(args
        .windows(2)
        .any(|w| w[0] == "--tools" && w[1].is_empty()));
    assert!(!args.iter().any(|a| a.contains("system-prompt")));
    let env_txt = env.file("env.txt");
    assert!(!env_txt.contains("sk-should-not-leak"));
    assert!(!env_txt.contains("evil.example"));
    assert!(!env_txt.lines().any(|l| l.starts_with("CLAUDECODE=")));
    assert!(env_txt.contains("DISABLE_AUTOUPDATER=1"));
    let stdin: Value = serde_json::from_str(env.file("stdin.txt").trim()).unwrap();
    assert_eq!(stdin["type"], "user");
    let first = stdin["message"]["content"][0]["text"].as_str().unwrap();
    assert!(first.starts_with("<external_system_instructions>\nYou are a pirate."));
    assert_eq!(stdin["message"]["content"][1]["text"], "Human: hi\n\n");

    // Anthropic client, stream: Claude Code's own events, thinking removed.
    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cc", "max_tokens": 100, "stream": true, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let text = r.text().await.unwrap();
    assert!(!text.contains("secret thoughts"));
    let events: Vec<&str> = text
        .lines()
        .filter_map(|l| l.strip_prefix("event: "))
        .collect();
    assert_eq!(
        events,
        [
            "message_start",
            "content_block_start",
            "content_block_delta",
            "content_block_delta",
            "content_block_stop",
            "message_delta",
            "message_stop"
        ]
    );

    // Chat client, stream and non-stream.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cc", "stream": true, "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let chunks = sse_data(&r.text().await.unwrap());
    let content: String = chunks
        .iter()
        .filter_map(|c| {
            c.pointer("/choices/0/delta/content")
                .and_then(|t| t.as_str())
        })
        .collect();
    assert_eq!(content, "Hello there");
    assert_eq!(chunks.last().unwrap(), "[DONE]");
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cc", "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(v["usage"]["completion_tokens"], 5);

    // Responses client.
    let r = env
        .post("/v1/responses", json!({"model": "cc", "input": "hi"}))
        .await;
    let v: Value = r.json().await.unwrap();
    assert_eq!(v["output"][0]["content"][0]["text"], "Hello there");

    // Client tools are not bridged yet: clear 501.
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cc", "tools": [{"type": "function", "function": {"name": "f", "parameters": {}}}],
                   "messages": [{"role": "user", "content": "hi"}]}),
        )
        .await;
    assert_eq!(r.status(), 501);
}

#[tokio::test]
async fn claude_cli_failures_map_to_statuses() {
    let env = Env::start().await;
    let r = env
        .post(
            "/v1/chat/completions",
            json!({"model": "cc", "messages": [{"role": "user", "content": "LIMIT"}]}),
        )
        .await;
    assert_eq!(r.status(), 429);
    assert!(r.text().await.unwrap().contains("usage limit"));

    let r = env
        .post(
            "/v1/messages",
            json!({"model": "cc", "max_tokens": 5, "messages": [{"role": "user", "content": "CRASH"}]}),
        )
        .await;
    assert_eq!(r.status(), 401);
    assert!(r.text().await.unwrap().contains("not logged in"));
}

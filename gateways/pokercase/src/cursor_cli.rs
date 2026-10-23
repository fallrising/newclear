//! Cursor subscription through the official Cursor Agent CLI (`cursor-agent -p`).
//!
//! thinrouter holds no Cursor token and speaks no private Cursor protocol: every request
//! is answered by the locally signed-in `cursor-agent` in print mode, so Cursor sees its
//! own client. `cursor-agent` is a coding agent with built-in tools and no switch to turn
//! them off, so runs are confined: `--mode ask` (read-only), `--sandbox enabled`, an
//! empty workspace, and never `--force` or `--approve-mcps`. The caller's system prompt
//! goes into the prompt inside `<external_system_instructions>`, as for Claude Code.
//!
//! Cursor account plugins (for example Gmail) stay callable by the agent in ask mode and
//! cannot be turned off from the CLI (verified with cursor-agent 2026.10.16): a client
//! that can send a prompt can make the agent read them. The provider is therefore off
//! unless the operator passes `--cursor-accept-account-plugins`.
//!
//! The CLI takes the prompt as a command-line argument (text only): requests with images
//! or client tools are refused with a retryable 501 so a route can fall back.
//! Output follows <https://cursor.com/docs/cli/reference/output-format> (stream-json with
//! `--stream-partial-output`) and is re-emitted as Anthropic Messages SSE records.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::claude_code::{first_record, status_for, stop, ClaudeRun, Item};
use crate::proxy::UpstreamAttemptError;

/// Linux refuses a single argument longer than this (MAX_ARG_STRLEN).
const MAX_PROMPT_BYTES: usize = 128 * 1024 - 1;

/// Environment a run must not inherit (it would point the CLI at another endpoint).
const BLOCKED_ENV: &[&str] = &["CURSOR_API_ENDPOINT"];

#[derive(Clone)]
pub struct CursorCli {
    /// `cursor-agent` executable (PATH lookup when bare).
    pub bin: String,
    /// Empty workspace runs are confined to.
    pub work_dir: PathBuf,
    runs: Arc<Semaphore>,
    /// Operator accepted that the agent can use the account's Cursor plugins.
    pub enabled: bool,
}

pub const DISABLED_MSG: &str = "the cursor provider is off: cursor-agent can use your Cursor \
account plugins (e.g. Gmail) even in read-only ask mode, so any client could read that data \
through a prompt. Start thinrouter with --cursor-accept-account-plugins to accept this, or \
disconnect those plugins in Cursor first.";

impl CursorCli {
    pub fn new(bin: Option<String>, data_dir: &std::path::Path, max_runs: usize) -> Self {
        Self {
            bin: bin
                .filter(|b| !b.trim().is_empty())
                .unwrap_or_else(|| "cursor-agent".into()),
            work_dir: data_dir.join("cursor-work"),
            runs: Arc::new(Semaphore::new(max_runs.max(1))),
            enabled: false,
        }
    }

    pub fn accept_account_plugins(mut self, yes: bool) -> Self {
        self.enabled = yes;
        self
    }
}

/// `cursor-agent` arguments for one request; `model` "default"/"auto" leaves the
/// account's default.
pub fn cli_args(model: &str, workspace: &std::path::Path, prompt: &str) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--mode",
        "ask",
        "--sandbox",
        "enabled",
        "--trust",
        "--workspace",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(workspace.display().to_string());
    if !matches!(model, "" | "default" | "auto") {
        args.push("--model".into());
        args.push(model.to_string());
    }
    args.push(prompt.to_string());
    args
}

/// The request as one text prompt (same rendering as Claude Code's first message).
/// Err when it has something the CLI cannot take.
pub fn render(chat: &Value) -> Result<String, &'static str> {
    if crate::claude_code::has_tools(chat) {
        return Err("cursor (Cursor Agent CLI) does not bridge client tools yet");
    }
    let mut text = String::new();
    for block in crate::claude_code::render_prompt(chat) {
        match block.get("type").and_then(|t| t.as_str()) {
            Some("text") => text.push_str(block.get("text").and_then(|t| t.as_str()).unwrap_or("")),
            _ => return Err("cursor (Cursor Agent CLI) takes text only; this request has images"),
        }
    }
    Ok(text)
}

fn record(ev: &Value) -> String {
    let name = ev.get("type").and_then(|t| t.as_str()).unwrap_or("message");
    format!("event: {name}\ndata: {ev}")
}

/// stream-json lines → Anthropic SSE records.
#[derive(Default)]
struct Translate {
    started: bool,
    streamed: bool,
    done: bool,
}

impl Translate {
    fn begin(&mut self, out: &mut Vec<String>, session: &str, model: &str) {
        if self.started {
            return;
        }
        self.started = true;
        out.push(record(&json!({"type": "message_start", "message": {
            "id": format!("msg_{session}"), "type": "message", "role": "assistant",
            "model": model, "content": [], "stop_reason": null, "stop_sequence": null,
            "usage": {"input_tokens": 0, "output_tokens": 0}}})));
        out.push(record(&json!({"type": "content_block_start", "index": 0,
            "content_block": {"type": "text", "text": ""}})));
    }

    fn text(out: &mut Vec<String>, t: &str) {
        if !t.is_empty() {
            out.push(record(&json!({"type": "content_block_delta", "index": 0,
                "delta": {"type": "text_delta", "text": t}})));
        }
    }

    fn on_line(&mut self, v: &Value, model: &str) -> Vec<String> {
        let mut out = Vec::new();
        if self.done {
            return out;
        }
        let session = v
            .get("session_id")
            .and_then(|s| s.as_str())
            .unwrap_or("cursor");
        match v.get("type").and_then(|t| t.as_str()) {
            // Only streaming deltas carry new text: timestamp_ms without model_call_id.
            Some("assistant")
                if v.get("timestamp_ms").is_some() && v.get("model_call_id").is_none() =>
            {
                self.begin(&mut out, session, model);
                for c in v
                    .pointer("/message/content")
                    .and_then(|c| c.as_array())
                    .into_iter()
                    .flatten()
                {
                    if let Some(t) = c.get("text").and_then(|t| t.as_str()) {
                        self.streamed |= !t.is_empty();
                        Self::text(&mut out, t);
                    }
                }
            }
            Some("result") => {
                self.begin(&mut out, session, model);
                if !self.streamed {
                    // No deltas seen: the result holds all assistant text.
                    let t = v.get("result").and_then(|r| r.as_str()).unwrap_or("");
                    Self::text(&mut out, t);
                }
                out.push(record(&json!({"type": "content_block_stop", "index": 0})));
                // cursor-agent reports usage on the result (camelCase, not in its docs).
                let n = |k: &str| {
                    v.pointer(&format!("/usage/{k}"))
                        .and_then(|x| x.as_i64())
                        .unwrap_or(0)
                };
                out.push(record(&json!({"type": "message_delta",
                "delta": {"stop_reason": "end_turn", "stop_sequence": null},
                "usage": {
                    "input_tokens": n("inputTokens"),
                    "output_tokens": n("outputTokens"),
                    "cache_read_input_tokens": n("cacheReadTokens"),
                    "cache_creation_input_tokens": n("cacheWriteTokens"),
                }})));
                out.push(record(&json!({"type": "message_stop"})));
                self.done = true;
            }
            _ => {} // system/init, user echo, thinking, flushes, the agent's own tool calls
        }
        out
    }
}

/// Answer one request with `cursor-agent -p`; waits for the first reply event so
/// failures before any output can fall back to another target.
pub async fn start(
    cc: &CursorCli,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    let fail = |status: u16, body: String, retryable: bool| UpstreamAttemptError {
        status,
        body,
        retryable,
    };
    if !cc.enabled {
        return Err(fail(503, DISABLED_MSG.into(), true));
    }
    let prompt = render(chat).map_err(|m| fail(501, m.into(), true))?;
    if prompt.len() > MAX_PROMPT_BYTES {
        return Err(fail(
            413,
            "conversation too long for the Cursor Agent CLI's command line (128 KiB)".into(),
            true,
        ));
    }
    let permit = tokio::select! {
        _ = cancel.cancelled() => return Err(fail(499, "client disconnected".into(), false)),
        p = cc.runs.clone().acquire_owned() => p.map_err(|_| fail(503, "cursor runs closed".into(), true))?,
    };
    std::fs::create_dir_all(&cc.work_dir)
        .map_err(|e| fail(500, format!("cursor work dir: {e}"), false))?;
    let mut cmd = Command::new(&cc.bin);
    cmd.args(cli_args(model, &cc.work_dir, &prompt))
        .current_dir(&cc.work_dir)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for k in BLOCKED_ENV {
        cmd.env_remove(k);
    }
    let mut child = cmd.spawn().map_err(|e| {
        fail(
            503,
            format!(
                "cannot start Cursor Agent CLI ({}): {e}; install it and run `cursor-agent login`",
                cc.bin
            ),
            true,
        )
    })?;
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    let (tx, rx) = mpsc::channel::<Item>(64);
    let cancel = cancel.clone();
    let model = model.to_string();
    tokio::spawn(async move {
        let _permit = permit;
        let mut lines = BufReader::new(stdout).lines();
        let mut tr = Translate::default();
        let mut sent = false;
        'read: loop {
            let next = tokio::select! {
                _ = cancel.cancelled(), if !sent => break,
                l = lines.next_line() => l,
            };
            let Ok(Some(l)) = next else { break };
            let Ok(v) = serde_json::from_str::<Value>(&l) else {
                continue;
            };
            for rec in tr.on_line(&v, &model) {
                sent = true;
                if tx.send(Item::Record(rec)).await.is_err() {
                    break 'read; // client went away
                }
            }
            if tr.done {
                break;
            }
        }
        if !tr.done && !cancel.is_cancelled() {
            let mut err = String::new();
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                (&mut stderr).take(4096).read_to_string(&mut err),
            )
            .await;
            let tail: String = err.trim().chars().take(300).collect();
            let msg = format!("Cursor Agent CLI ended without a complete reply: {tail}");
            warn!("{msg}");
            let _ = tx
                .send(Item::Failed {
                    status: status_for(&tail),
                    message: msg,
                })
                .await;
        }
        stop(child).await;
    });
    first_record(rx).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runs_are_confined_and_read_only() {
        let args = cli_args("gpt-5", std::path::Path::new("/w"), "hi");
        for want in ["-p", "--stream-partial-output", "--trust"] {
            assert!(args.iter().any(|a| a == want), "{want}");
        }
        assert!(args.windows(2).any(|w| w[0] == "--mode" && w[1] == "ask"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--sandbox" && w[1] == "enabled"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--workspace" && w[1] == "/w"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--model" && w[1] == "gpt-5"));
        for never in ["--force", "--yolo", "--approve-mcps"] {
            assert!(!args.iter().any(|a| a == never), "{never}");
        }
        assert_eq!(args.last().unwrap(), "hi");
        assert!(!cli_args("default", std::path::Path::new("/w"), "x")
            .iter()
            .any(|a| a == "--model"));
    }

    #[test]
    fn render_refuses_tools_and_images() {
        let ok = render(&json!({"messages": [
            {"role": "system", "content": "be brief"}, {"role": "user", "content": "hi"}]}))
        .unwrap();
        assert!(ok.starts_with("<external_system_instructions>\nbe brief"));
        assert!(ok.ends_with("Human: hi\n\n"));
        assert!(render(
            &json!({"tools": [{"type": "function", "function": {"name": "f"}}],
            "messages": [{"role": "user", "content": "x"}]})
        )
        .is_err());
        assert!(render(&json!({"messages": [{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64,QQ=="}}]}]}))
        .is_err());
    }

    #[test]
    fn deltas_are_used_and_flushes_skipped() {
        let mut t = Translate::default();
        let lines = [
            json!({"type": "system", "subtype": "init", "session_id": "s1", "model": "m"}),
            json!({"type": "user", "message": {"role": "user", "content": [{"type": "text", "text": "hi"}]}, "session_id": "s1"}),
            json!({"type": "assistant", "timestamp_ms": 1, "message": {"role": "assistant", "content": [{"type": "text", "text": "Hel"}]}, "session_id": "s1"}),
            json!({"type": "assistant", "timestamp_ms": 2, "message": {"role": "assistant", "content": [{"type": "text", "text": "lo"}]}, "session_id": "s1"}),
            json!({"type": "assistant", "timestamp_ms": 3, "model_call_id": "c", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello"}]}, "session_id": "s1"}),
            json!({"type": "tool_call", "subtype": "started", "call_id": "x", "tool_call": {"readToolCall": {"args": {"path": "a"}}}}),
            json!({"type": "assistant", "message": {"role": "assistant", "content": [{"type": "text", "text": "Hello"}]}, "session_id": "s1"}),
            json!({"type": "result", "subtype": "success", "is_error": false, "result": "Hello", "session_id": "s1"}),
        ];
        let out: Vec<String> = lines.iter().flat_map(|l| t.on_line(l, "m")).collect();
        let text: String = out
            .iter()
            .filter_map(|r| r.lines().nth(1))
            .filter_map(|d| serde_json::from_str::<Value>(d.trim_start_matches("data: ")).ok())
            .filter_map(|v| {
                v.pointer("/delta/text")
                    .and_then(|t| t.as_str())
                    .map(str::to_string)
            })
            .collect();
        assert_eq!(text, "Hello");
        assert!(out.last().unwrap().starts_with("event: message_stop"));
        // Usage from the result (as cursor-agent 2026.10.16 prints it).
        let mut t = Translate::default();
        let out = t.on_line(
            &json!({"type": "result", "subtype": "success", "result": "x",
                "usage": {"inputTokens": 9359, "outputTokens": 33, "cacheReadTokens": 3328, "cacheWriteTokens": 0}}),
            "m",
        );
        let delta = out
            .iter()
            .find(|r| r.starts_with("event: message_delta"))
            .unwrap();
        assert!(delta.contains("\"input_tokens\":9359") && delta.contains("\"output_tokens\":33"));
        assert!(delta.contains("\"cache_read_input_tokens\":3328"));
        // Without --stream-partial-output deltas, the result text is used.
        let mut t = Translate::default();
        let out = t.on_line(
            &json!({"type": "result", "subtype": "success", "result": "Hi"}),
            "m",
        );
        assert!(out.iter().any(|r| r.contains("\"text\":\"Hi\"")));
    }
}

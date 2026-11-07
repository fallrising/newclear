//! Cursor subscription through the official Cursor Agent CLI (`cursor-agent -p`).
//!
//! thinrouter holds no Cursor token and speaks no private Cursor protocol: every request
//! is answered by `cursor-agent` inside a resource-bounded Docker container. A pinned
//! local image and dedicated named profile volume are required; there is no host CLI
//! fallback. Docker supplies isolation; the nested CLI sandbox is disabled for
//! compatibility with Docker's default seccomp policy. Ask remains a preference.
//! The caller's system prompt
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
use tokio::io::{AsyncReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, Semaphore};
use tokio_util::sync::CancellationToken;
use tracing::warn;

use crate::claude_code::{first_record, status_for, ClaudeRun, Item};
use crate::proxy::UpstreamAttemptError;

/// Linux refuses a single argument longer than this (MAX_ARG_STRLEN).
const MAX_PROMPT_BYTES: usize = 128 * 1024 - 1;

/// Environment a run must not inherit (it would point the CLI at another endpoint).
const BLOCKED_ENV: &[&str] = &[
    "CURSOR_API_ENDPOINT",
    "DOCKER_HOST",
    "DOCKER_CONTEXT",
    "DOCKER_TLS_VERIFY",
    "DOCKER_CERT_PATH",
];

#[derive(Clone)]
pub struct CursorCli {
    /// Executable inside the pinned container image.
    pub bin: String,
    /// Ephemeral container workspace.
    pub work_dir: PathBuf,
    image: Option<String>,
    profile_volume: Option<String>,
    runtime_bin: String,
    runs: Arc<Semaphore>,
    /// Operator accepted that the agent can use the account's Cursor plugins.
    pub enabled: bool,
}

pub const DISABLED_MSG: &str = "the cursor provider is off: cursor-agent can use your Cursor \
account plugins (e.g. Gmail) even in read-only ask mode, so any client could read that data \
through a prompt. Start thinrouter with --cursor-accept-account-plugins to accept this, or \
disconnect those plugins in Cursor first.";

impl CursorCli {
    pub fn new(bin: Option<String>, _data_dir: &std::path::Path, max_runs: usize) -> Self {
        Self {
            bin: bin
                .filter(|b| !b.trim().is_empty())
                .unwrap_or_else(|| "cursor-agent".into()),
            work_dir: PathBuf::from("/workspace"),
            image: None,
            profile_volume: None,
            runtime_bin: "docker".into(),
            runs: Arc::new(Semaphore::new(max_runs.max(1))),
            enabled: false,
        }
    }

    pub fn with_container(
        mut self,
        image: Option<String>,
        profile_volume: Option<String>,
        runtime_bin: Option<String>,
    ) -> Self {
        self.image = image;
        self.profile_volume = profile_volume;
        self.runtime_bin = runtime_bin.unwrap_or_else(|| "docker".into());
        self
    }

    fn container_args(&self, name: &str) -> Result<Vec<String>, &'static str> {
        let image = self
            .image
            .as_deref()
            .filter(|s| valid_image(s))
            .ok_or("cursor requires --cursor-image with a pinned local sha256 image")?;
        let volume = self
            .profile_volume
            .as_deref()
            .filter(|s| valid_profile(s))
            .ok_or(
                "cursor requires a dedicated --cursor-profile-volume named thinrouter-cursor-...",
            )?;
        if self.runtime_bin.trim().is_empty() || self.bin.trim().is_empty() {
            return Err("cursor container runtime and command must not be empty");
        }
        let mut args: Vec<String> = [
            "run",
            "--rm",
            "--pull=never",
            "--init",
            "--name",
            name,
            "--user",
            "1000:1000",
            "--read-only",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--pids-limit",
            "128",
            "--memory",
            "1g",
            "--cpus",
            "1",
            "--network",
            "bridge",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,size=64m",
            "--tmpfs",
            "/workspace:rw,noexec,nosuid,size=64m,mode=1777",
            "--workdir",
            "/workspace",
            "--env",
            "HOME=/home/cursor",
            "--mount",
        ]
        .into_iter()
        .map(str::to_owned)
        .collect();
        args.push(format!("type=volume,src={volume},dst=/home/cursor"));
        args.extend(["--entrypoint".into(), self.bin.clone(), image.into()]);
        Ok(args)
    }

    pub fn accept_account_plugins(mut self, yes: bool) -> Self {
        self.enabled = yes;
        self
    }
}

fn valid_image(image: &str) -> bool {
    let digest = if let Some(digest) = image.strip_prefix("sha256:") {
        digest
    } else if let Some((repo, digest)) = image.split_once("@sha256:") {
        if repo.is_empty()
            || repo.starts_with('-')
            || !repo
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"._/:-".contains(&b))
        {
            return false;
        }
        digest
    } else {
        return false;
    };
    digest.len() == 64 && digest.bytes().all(|b| b.is_ascii_hexdigit())
}

fn valid_profile(volume: &str) -> bool {
    volume
        .strip_prefix("thinrouter-cursor-")
        .is_some_and(|suffix| {
            !suffix.is_empty()
                && suffix
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
}

fn runtime_command(runtime: &str) -> Command {
    let mut cmd = Command::new(runtime);
    cmd.arg("--host=unix:///var/run/docker.sock");
    for key in BLOCKED_ENV {
        cmd.env_remove(key);
    }
    cmd.kill_on_drop(true);
    cmd
}

async fn remove_container(runtime: &str, name: &str) {
    let result = tokio::time::timeout(
        Duration::from_secs(3),
        runtime_command(runtime)
            .args(["rm", "-f", name])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status(),
    )
    .await;
    if !matches!(result, Ok(Ok(status)) if status.success()) {
        warn!("Cursor container cleanup did not confirm removal");
    }
}

// Docker may already have accepted create when its client is killed. Repeat removal
// after the client is reaped, including after an initial "not found" response.
async fn reconcile_container(runtime: &str, name: &str) {
    for attempt in 0..3 {
        if attempt != 0 {
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
        remove_container(runtime, name).await;
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
        "disabled",
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
    failed: bool,
    visible_text: bool,
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

    fn text(&mut self, out: &mut Vec<String>, t: &str) {
        if !t.is_empty() {
            self.visible_text = true;
            out.push(record(&json!({"type": "content_block_delta", "index": 0,
                "delta": {"type": "text_delta", "text": t}})));
        }
    }

    fn on_line(&mut self, v: &Value, model: &str) -> Vec<String> {
        let mut out = Vec::new();
        self.visible_text = false;
        if self.done || self.failed {
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
                        self.text(&mut out, t);
                    }
                }
            }
            Some("result") => {
                // Only the documented success shape can complete a reply. Never
                // expose error payloads as assistant text, even after deltas.
                if v.get("subtype").and_then(Value::as_str) != Some("success")
                    || v.get("is_error").and_then(Value::as_bool) != Some(false)
                    || !v.get("result").is_some_and(Value::is_string)
                {
                    self.failed = true;
                    return out;
                }
                self.begin(&mut out, session, model);
                if !self.streamed {
                    // No deltas seen: the result holds all assistant text.
                    let t = v.get("result").and_then(|r| r.as_str()).unwrap_or("");
                    self.text(&mut out, t);
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
/// Accounting is per actual dispatch, never attached to synthesized usage records.
pub async fn start_observed(
    cc: &CursorCli,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
    usage: Option<&crate::cursor_usage::RequestContext>,
) -> Result<(ClaudeRun, Option<crate::cursor_usage::Attempt>), UpstreamAttemptError> {
    let fail = |status: u16, body: String, retryable: bool| UpstreamAttemptError {
        status,
        body,
        retryable,
    };
    if !cc.enabled {
        return Err(fail(503, DISABLED_MSG.into(), true));
    }
    let name = format!("thinrouter-cursor-{}", uuid::Uuid::new_v4());
    let mut args = cc
        .container_args(&name)
        .map_err(|m| fail(503, m.into(), true))?;
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
    args.extend(cli_args(model, &cc.work_dir, &prompt));
    let runtime = cc.runtime_bin.clone();
    let mut cmd = runtime_command(&runtime);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let accounting = usage
        .map(crate::cursor_usage::RequestContext::begin)
        .transpose()?;
    let mut startup = StartupAccounting(accounting.clone());
    let mut child = match cmd.spawn() {
        Ok(child) => child,
        Err(_) => {
            if let Some(a) = &accounting {
                a.stop("failed", "upstream_attempt_failed");
            }
            reconcile_container(&runtime, &name).await;
            return Err(fail(
                503,
                "cannot start Cursor container runtime".into(),
                true,
            ));
        }
    };
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    // Drain concurrently so diagnostics cannot fill a pipe and stall the CLI.
    let mut diagnostics = tokio::spawn(async move {
        let mut bytes = Vec::new();
        let _ = (&mut stderr).take(4096).read_to_end(&mut bytes).await;
        let _ = tokio::io::copy(&mut stderr, &mut tokio::io::sink()).await;
        String::from_utf8_lossy(&bytes).into_owned()
    });
    let (tx, rx) = mpsc::channel::<Item>(64);
    let cancel = cancel.clone();
    let model = model.to_string();
    let producer_accounting = accounting.clone();
    tokio::spawn(async move {
        let _permit = permit;
        let mut lines = crate::cli_lines::Lines::new(BufReader::new(stdout));
        let mut line_overflow = false;
        let mut tr = Translate::default();
        'read: loop {
            let next = tokio::select! {
                _ = cancel.cancelled() => break,
                _ = tx.closed() => break,
                l = lines.next_line() => l,
            };
            let l = match next {
                Ok(Some(line)) => line,
                Err(crate::cli_lines::LineError::TooLarge) => {
                    line_overflow = true;
                    break;
                }
                _ => break,
            };
            let Ok(v) = serde_json::from_str::<Value>(&l) else {
                continue;
            };
            let records = tr.on_line(&v, &model);
            if let Some(a) = &producer_accounting {
                if !records.is_empty() {
                    a.ready();
                }
                a.observe_line(&v, tr.visible_text, tr.done);
            }
            for rec in records {
                tokio::select! {
                    _ = cancel.cancelled() => break 'read,
                    result = tx.send(Item::Record(rec)) => if result.is_err() { break 'read; },
                }
            }
            if tr.done || tr.failed {
                break;
            }
        }
        drop(lines);
        let failed = !tr.done && !cancel.is_cancelled() && !tx.is_closed();
        if let Some(a) = &producer_accounting {
            if failed {
                a.stop(
                    "failed",
                    if line_overflow {
                        "stream_observer_limit"
                    } else {
                        "stream_incomplete"
                    },
                );
            } else if cancel.is_cancelled() {
                a.stop("cancelled", "stream_cancelled");
            }
            // Receiver closure is owned by the consumer lease (possibly timeout).
            // Do not race it with a less-specific producer cancellation outcome.
        }
        let mut status = 502;
        let mut sandbox_unavailable = false;
        if failed && !line_overflow {
            if let Ok(Ok(err)) =
                tokio::time::timeout(Duration::from_secs(2), &mut diagnostics).await
            {
                let diagnostic = err.to_ascii_lowercase();
                sandbox_unavailable = diagnostic
                    .contains("sandbox mode is enabled but not available on this system")
                    || diagnostic.contains("sandbox is not available on this system");
                status = if sandbox_unavailable {
                    503
                } else {
                    status_for(&err)
                };
            }
        }
        let _ = child.start_kill();
        let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        reconcile_container(&runtime, &name).await;
        diagnostics.abort();
        drop(_permit);
        if failed {
            let message = if line_overflow { crate::cli_lines::LIMIT_MESSAGE } else { match status {
                401 => "Cursor container profile is not logged in",
                429 => "Cursor account quota or rate limit reached",
                503 if sandbox_unavailable => "Cursor sandbox is unavailable inside the configured container; review the container runtime requirements",
                _ => "Cursor container ended without a complete reply",
            }}
            .to_owned();
            let reason = if line_overflow {
                "stdout_record_limit"
            } else if sandbox_unavailable {
                "sandbox_unavailable"
            } else {
                "cli_error"
            };
            warn!(status, reason, "Cursor container request failed");
            tokio::select! {
                _ = cancel.cancelled() => {},
                _ = tx.send(Item::Failed { status, message }) => {},
            }
        }
    });
    match first_record(rx).await {
        Ok(run) => {
            startup.0 = None;
            Ok((run, accounting))
        }
        Err(error) => {
            if let Some(a) = &accounting {
                a.stop("failed", "upstream_attempt_failed");
            }
            Err(error)
        }
    }
}

/// A dropped startup future still owns its already-reserved dispatch. The producer
/// reacts to the closed receiver/cancellation and performs existing runtime cleanup.
struct StartupAccounting(Option<crate::cursor_usage::Attempt>);
impl Drop for StartupAccounting {
    fn drop(&mut self) {
        if let Some(a) = &self.0 {
            a.stop("cancelled", "stream_cancelled");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cu3_only_accepted_nonempty_text_marks_visible_output() {
        let mut tr = Translate::default();
        for event in [
            json!({"type":"thinking","text":"private"}),
            json!({"type":"tool_call","text":"private"}),
            json!({"type":"assistant","timestamp_ms":1,"model_call_id":"flush",
                "message":{"content":[{"text":"duplicate"}]}}),
            json!({"type":"assistant","message":{"content":[{"text":"duplicate"}]}}),
            json!({"type":"assistant","timestamp_ms":1,"message":{"content":[{"text":""}]}}),
        ] {
            tr.on_line(&event, "m");
            assert!(!tr.visible_text);
        }
        tr.on_line(
            &json!({"type":"assistant","timestamp_ms":2,
            "message":{"content":[{"type":"text","text":"visible"}]}}),
            "m",
        );
        assert!(tr.visible_text);
        tr.on_line(
            &json!({"type":"result","subtype":"success","is_error":false,
            "result":"visible"}),
            "m",
        );
        assert!(
            tr.done && !tr.visible_text,
            "result must not count the repeated text"
        );

        let mut only = Translate::default();
        only.on_line(
            &json!({"type":"result","subtype":"success","is_error":false,
            "result":"result-only text"}),
            "m",
        );
        assert!(only.done && only.visible_text);
        let mut failed = Translate::default();
        assert!(failed
            .on_line(
                &json!({"type":"result","subtype":"error","is_error":true,
            "result":"private error"}),
                "m"
            )
            .is_empty());
        assert!(failed.failed && !failed.visible_text);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn removal_reconciles_late_container_creation() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("cursor-cleanup-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let runtime = dir.join("runtime");
        let pending = dir.join("pending");
        let container = dir.join("container");
        // The first removal sees no container; model the daemon completing create
        // independently after the killed docker run client has already exited.
        std::fs::write(&pending, "pending").unwrap();
        std::fs::write(&runtime, format!("#!/bin/sh\nif [ -e '{}' ]; then\n rm '{}'\n (sleep 0.1; touch '{}') >/dev/null 2>&1 &\n exit 1\nfi\nrm -f '{}'\n", pending.display(), pending.display(), container.display(), container.display())).unwrap();
        std::fs::set_permissions(&runtime, std::fs::Permissions::from_mode(0o700)).unwrap();
        reconcile_container(runtime.to_str().unwrap(), "thinrouter-cursor-test").await;
        assert!(
            !container.exists(),
            "late-created container escaped removal"
        );
        assert!(!pending.exists(), "fake runtime did not run");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn container_configuration_and_arguments_are_restricted() {
        let digest = format!("sha256:{}", "a".repeat(64));
        assert!(valid_image(&digest));
        assert!(valid_image(&format!("registry.test/repo@{digest}")));
        for bad in [
            "latest",
            "repo:latest",
            "sha256:abc",
            "--privileged",
            "repo@sha256:xyz",
        ] {
            assert!(!valid_image(bad));
        }
        for bad in [
            "",
            "thinrouter-cursor-",
            "other-profile",
            "thinrouter-cursor-/host",
            "thinrouter-cursor-a,dst=/etc",
            "thinrouter-cursor-a b",
        ] {
            assert!(!valid_profile(bad));
        }
        assert!(valid_profile("thinrouter-cursor-test_1"));
        let cc = CursorCli::new(None, std::path::Path::new("/host"), 1);
        assert!(cc.container_args("test").is_err());
        let cc = cc.with_container(
            Some(digest.clone()),
            Some("thinrouter-cursor-test".into()),
            None,
        );
        let args = cc.container_args("thinrouter-cursor-request").unwrap();
        for required in [
            "--read-only",
            "--pull=never",
            "--rm",
            "--init",
            "no-new-privileges",
            "1000:1000",
            "/workspace:rw,noexec,nosuid,size=64m,mode=1777",
        ] {
            assert!(args.iter().any(|a| a == required));
        }
        assert!(args.windows(2).any(|w| w == ["--cap-drop", "ALL"]));
        assert!(args.windows(2).any(|w| w == ["--network", "bridge"]));
        assert!(!args.iter().any(|a| a.contains("seccomp=")
            || a.contains("apparmor=")
            || a == "--cap-add"
            || a == "--pid"
            || a.starts_with("--pid=")));
        assert_eq!(args.last(), Some(&digest));
        assert!(args
            .windows(2)
            .any(|w| w == ["--entrypoint", "cursor-agent"]));
        assert!(args
            .iter()
            .any(|a| a == "type=volume,src=thinrouter-cursor-test,dst=/home/cursor"));
        assert!(!args
            .iter()
            .any(|a| a.contains("type=bind") || a == "--privileged" || a.contains("docker.sock")));
        assert_eq!(cc.work_dir, PathBuf::from("/workspace"));
        let command = runtime_command("docker");
        assert_eq!(
            command.as_std().get_args().next().unwrap(),
            "--host=unix:///var/run/docker.sock"
        );
    }

    #[test]
    fn cli_preferences_do_not_enable_extra_tools() {
        let args = cli_args("gpt-5", std::path::Path::new("/w"), "hi");
        for want in ["-p", "--stream-partial-output", "--trust"] {
            assert!(args.iter().any(|a| a == want), "{want}");
        }
        assert!(args.windows(2).any(|w| w[0] == "--mode" && w[1] == "ask"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--sandbox" && w[1] == "disabled"));
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
            &json!({"type": "result", "subtype": "success", "is_error": false, "result": "x",
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
            &json!({"type": "result", "subtype": "success", "is_error": false, "result": "Hi"}),
            "m",
        );
        assert!(out.iter().any(|r| r.contains("\"text\":\"Hi\"")));
    }

    #[test]
    fn ce1_only_a_documented_success_result_can_complete() {
        let invalid = [
            json!({"type": "result", "subtype": "error", "is_error": true, "result": "PRIVATE"}),
            json!({"type": "result", "subtype": "success", "is_error": true, "result": "PRIVATE"}),
            json!({"type": "result", "subtype": "error", "is_error": false, "result": "PRIVATE"}),
            json!({"type": "result", "subtype": "success", "result": "PRIVATE"}),
            json!({"type": "result", "is_error": false, "result": "PRIVATE"}),
            json!({"type": "result", "subtype": "success", "is_error": "false", "result": "PRIVATE"}),
            json!({"type": "result", "subtype": "success", "is_error": false}),
            json!({"type": "result", "subtype": "success", "is_error": false, "result": {"error": "PRIVATE"}}),
        ];
        let success = json!({"type": "result", "subtype": "success", "is_error": false,
            "result": "", "future_field": true});
        for value in invalid {
            for partial in [false, true] {
                let mut tr = Translate::default();
                if partial {
                    assert!(!tr
                        .on_line(
                            &json!({"type": "assistant", "timestamp_ms": 1,
                        "message": {"content": [{"text": "partial"}]}}),
                            "m"
                        )
                        .is_empty());
                }
                assert!(tr.on_line(&value, "m").is_empty(), "{value}");
                assert!(tr.failed && !tr.done, "{value}");
                assert!(
                    tr.on_line(&success, "m").is_empty(),
                    "terminal failure cannot recover"
                );
            }
        }
        let mut tr = Translate::default();
        assert!(tr
            .on_line(&success, "m")
            .iter()
            .any(|e| e.starts_with("event: message_stop")));
        assert!(
            tr.done && !tr.failed,
            "empty successful result and unknown fields remain valid"
        );
    }
}

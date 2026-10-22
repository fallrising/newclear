//! Claude subscription through the real Claude Code CLI (`claude -p`).
//!
//! thinrouter never sends a Claude subscription token itself. Every request is answered
//! by the local `claude` binary, signed in with the user's own account, so requests to
//! Anthropic carry Claude Code's own system prompt, billing block and client identity.
//! The caller's system prompt goes into the first user message inside
//! `<external_system_instructions>`, never in place of Claude Code's (replacing it is
//! what makes subscription traffic look non-Claude-Code). Approach and arguments follow
//! yetone/magpie's Claude subscription bridge.
//!
//! Client tools are offered through an MCP helper (`claude_mcp.rs`) as
//! `mcp__thinrouter__<name>`. A run that calls one is ended right after the call is
//! streamed to the client; the request carrying the tool result starts a new run that
//! is told the whole conversation. Runs are not kept across requests.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::Duration;

use bytes::Bytes;
use futures_util::Stream;
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use crate::error::AppError;
use crate::proxy::UpstreamAttemptError;

/// Process settings shared by every run.
#[derive(Clone)]
pub struct ClaudeCode {
    /// `claude` executable (PATH lookup when bare).
    pub bin: String,
    /// Empty folder runs start in, so no project CLAUDE.md or settings are picked up.
    pub work_dir: PathBuf,
    /// Bounds concurrent Claude Code processes.
    pub runs: Arc<Semaphore>,
}

impl ClaudeCode {
    pub fn new(bin: Option<String>, data_dir: &std::path::Path, max_runs: usize) -> Self {
        Self {
            bin: bin
                .filter(|b| !b.trim().is_empty())
                .unwrap_or_else(|| "claude".into()),
            work_dir: data_dir.join("claude-work"),
            runs: Arc::new(Semaphore::new(max_runs.max(1))),
        }
    }
}

/// Arguments as magpie's `claudeCLIArgs`. With client tools, the MCP helper's config
/// and an allow-list of exactly those tools (no permission prompt in `-p`).
pub fn cli_args(model: &str, mcp_config: Option<&Path>, allowed: &[String]) -> Vec<String> {
    let mut args: Vec<String> = [
        "-p",
        "--output-format",
        "stream-json",
        "--input-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model",
        model,
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--no-session-persistence",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    if let Some(cfg) = mcp_config {
        args.push("--mcp-config".into());
        args.push(cfg.display().to_string());
        args.push("--allowedTools".into());
        args.push(allowed.join(","));
    }
    args
}

/// Environment the run must not inherit: anything that would point Claude Code at
/// another endpoint or credential, or make it think it runs inside another session.
const BLOCKED_ENV: &[&str] = &[
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "CLAUDECODE",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_CODE_SSE_PORT",
    "CLAUDE_CODE_OAUTH_TOKEN",
    "CLAUDE_CODE_PROMPT_CACHE_TTL",
    "CLAUDE_CODE_EXTRA_BODY",
    "ANTHROPIC_BETAS",
];

const EXTRA_ENV: &[(&str, &str)] = &[
    ("ENABLE_CLAUDEAI_MCP_SERVERS", "0"),
    ("DISABLE_AUTO_COMPACT", "1"),
    ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1"),
    ("CLAUDE_CODE_DISABLE_AUTO_MEMORY", "1"),
    ("DISABLE_AUTOUPDATER", "1"),
];

const HISTORY_OPEN: &str = "<conversation_history>\nThe conversation so far, each turn of it answered already. \
Images and files in it were sent with those earlier messages: none of them is new, and none needs answering again.\n\n";
const HISTORY_CLOSE: &str =
    "</conversation_history>\n\n<current_turn>\nThe turn to answer now:\n\n";

fn is_tool_call(m: &Value) -> bool {
    m.get("tool_calls")
        .and_then(|t| t.as_array())
        .is_some_and(|t| !t.is_empty())
}

/// Index of the first message after the last assistant reply that calls no tool
/// (magpie's `historyEnd`); 0 when there is no answered history.
fn history_end(msgs: &[Value]) -> usize {
    for j in (0..msgs.len()).rev() {
        if msgs[j].get("role").and_then(|r| r.as_str()) == Some("assistant")
            && !is_tool_call(&msgs[j])
        {
            return if j == msgs.len() - 1 { 0 } else { j + 1 };
        }
    }
    0
}

/// Image part (chat `image_url`) → Anthropic image block.
fn image_block(part: &Value) -> Option<Value> {
    let url = match part.get("image_url")? {
        Value::String(u) => u.as_str(),
        o => o.get("url")?.as_str()?,
    };
    if let Some(rest) = url.strip_prefix("data:") {
        let (media, data) = rest.split_once(";base64,")?;
        return Some(
            json!({"type": "image", "source": {"type": "base64", "media_type": media, "data": data}}),
        );
    }
    Some(json!({"type": "image", "source": {"type": "url", "url": url}}))
}

fn flush(blocks: &mut Vec<Value>, text: &mut String) {
    if !text.is_empty() {
        blocks.push(json!({"type": "text", "text": std::mem::take(text)}));
    }
}

/// Render a chat-completions request as the content of Claude Code's first user message.
pub fn render_prompt(chat: &Value) -> Vec<Value> {
    let messages: Vec<Value> = chat
        .get("messages")
        .and_then(|m| m.as_array())
        .cloned()
        .unwrap_or_default();
    let (system, convo): (Vec<&Value>, Vec<&Value>) = messages.iter().partition(|m| {
        matches!(
            m.get("role").and_then(|r| r.as_str()),
            Some("system" | "developer")
        )
    });
    let mut blocks: Vec<Value> = Vec::new();
    let mut text = String::new();

    let mut instructions: Vec<String> = system
        .iter()
        .map(|m| content_text(m.get("content").unwrap_or(&Value::Null)))
        .filter(|s| !s.is_empty())
        .collect();
    // Claude Code takes no tool-choice flag; say it in words (as magpie does).
    match chat.get("tool_choice") {
        Some(Value::String(c)) if c == "required" && has_tools(chat) => {
            instructions.push("You must call at least one available tool before answering.".into())
        }
        Some(c) => {
            if let Some(name) = c.pointer("/function/name").and_then(|n| n.as_str()) {
                instructions.push(format!(
                    "You must call the {} tool.",
                    crate::claude_mcp::bridged_name(name)
                ));
            }
        }
        None => {}
    }
    if !instructions.is_empty() {
        text.push_str("<external_system_instructions>\n");
        text.push_str(&instructions.join("\n"));
        text.push_str("\n</external_system_instructions>\n\n");
        flush(&mut blocks, &mut text);
    }

    let convo: Vec<Value> = convo.into_iter().cloned().collect();
    let offered: std::collections::HashSet<&str> = chat
        .get("tools")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
        .filter_map(|t| t.pointer("/function/name").and_then(|n| n.as_str()))
        .collect();
    let split = history_end(&convo);
    for (i, m) in convo.iter().enumerate() {
        if split > 0 && i == 0 {
            text.push_str(HISTORY_OPEN);
        }
        if split > 0 && i == split {
            text.push_str(HISTORY_CLOSE);
        }
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
        text.push_str(if role == "assistant" {
            "Assistant: "
        } else {
            "Human: "
        });
        if role == "tool" {
            text.push_str(&format!(
                "\n[tool result id={}]\n",
                m.get("tool_call_id").and_then(|i| i.as_str()).unwrap_or("")
            ));
        }
        match m.get("content") {
            Some(Value::Array(parts)) => {
                for p in parts {
                    if p.get("type").and_then(|t| t.as_str()) == Some("image_url") {
                        if let Some(img) = image_block(p) {
                            flush(&mut blocks, &mut text);
                            blocks.push(img);
                        }
                    } else if let Some(t) = p.get("text").and_then(|t| t.as_str()) {
                        text.push_str(t);
                    }
                }
            }
            Some(other) => text.push_str(&content_text(other)),
            None => {}
        }
        for call in m
            .get("tool_calls")
            .and_then(|t| t.as_array())
            .into_iter()
            .flatten()
        {
            let name = call
                .pointer("/function/name")
                .and_then(|n| n.as_str())
                .unwrap_or("");
            // Offered tools are named as this run's Claude Code knows them.
            let name = if offered.contains(name) {
                crate::claude_mcp::bridged_name(name)
            } else {
                name.to_string()
            };
            text.push_str(&format!(
                "\n[tool call {} id={} args={}]",
                name,
                call.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                call.pointer("/function/arguments")
                    .and_then(|a| a.as_str())
                    .unwrap_or("{}"),
            ));
        }
        text.push_str("\n\n");
    }
    if split > 0 {
        text.push_str("</current_turn>");
    }
    flush(&mut blocks, &mut text);
    if blocks.is_empty() {
        blocks.push(json!({"type": "text", "text": "[continue]"}));
    }
    blocks
}

fn content_text(c: &Value) -> String {
    match c {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

pub fn has_tools(chat: &Value) -> bool {
    chat.get("tools")
        .and_then(|t| t.as_array())
        .is_some_and(|t| !t.is_empty())
}

/// One item from a run: an Anthropic SSE record, or a failure.
enum Item {
    Record(String),
    Failed { status: u16, message: String },
}

/// A started run: Anthropic Messages SSE records (`event: ...\ndata: ...`).
pub struct ClaudeRun {
    first: Option<String>,
    rx: mpsc::Receiver<Item>,
}

impl ClaudeRun {
    /// SSE byte stream (records separated by blank lines).
    pub fn into_stream(self) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send {
        let ClaudeRun { first, mut rx } = self;
        async_stream::stream! {
            if let Some(f) = first {
                yield Ok(Bytes::from(format!("{f}\n\n")));
            }
            while let Some(item) = rx.recv().await {
                match item {
                    Item::Record(r) => yield Ok(Bytes::from(format!("{r}\n\n"))),
                    Item::Failed { message, .. } => {
                        let ev = json!({"type": "error", "error": {"type": "api_error", "message": message}});
                        yield Ok(Bytes::from(format!("event: error\ndata: {ev}\n\n")));
                        break;
                    }
                }
            }
        }
    }

    /// Collect the whole reply as an Anthropic Messages JSON body.
    pub async fn collect(self, model: &str) -> Result<Bytes, AppError> {
        let ClaudeRun { first, mut rx } = self;
        let mut records: Vec<String> = first.into_iter().collect();
        while let Some(item) = rx.recv().await {
            match item {
                Item::Record(r) => records.push(r),
                Item::Failed { status, message } => {
                    return Err(AppError::Upstream {
                        status,
                        body: message,
                    })
                }
            }
        }
        Ok(crate::claude::anthropic_sse_to_message(&records, model))
    }
}

/// Map a Claude Code failure text to an HTTP status (no secrets in these texts).
fn status_for(message: &str) -> u16 {
    let m = message.to_ascii_lowercase();
    if m.contains("rate limit") || m.contains("usage limit") || m.contains("limit reached") {
        429
    } else if ["login", "log in", "logged in", "auth", "credential"]
        .iter()
        .any(|k| m.contains(k))
    {
        401
    } else {
        502
    }
}

/// Ask Claude Code to stop with SIGTERM (it then removes its OAuth refresh lock), and
/// kill it only after a grace period.
async fn stop(mut child: Child) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: plain kill(2) on our own child's pid.
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    if tokio::time::timeout(Duration::from_secs(5), child.wait())
        .await
        .is_err()
    {
        let _ = child.kill().await;
    }
}

/// Start `claude -p` for one request and wait for its first reply event, so failures
/// before any output can still fall back to another target.
pub async fn start(
    cc: &ClaudeCode,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    let fail = |status: u16, body: String, retryable: bool| UpstreamAttemptError {
        status,
        body,
        retryable,
    };
    let permit: OwnedSemaphorePermit = tokio::select! {
        _ = cancel.cancelled() => return Err(fail(499, "client disconnected".into(), false)),
        p = cc.runs.clone().acquire_owned() => p.map_err(|_| fail(503, "claude runs closed".into(), true))?,
    };
    std::fs::create_dir_all(&cc.work_dir)
        .map_err(|e| fail(500, format!("claude work dir: {e}"), false))?;

    // Client tools: a per-run folder with the helper's tool list and MCP config.
    let mut names: HashMap<String, String> = HashMap::new();
    let mut run_dir: Option<PathBuf> = None;
    let mut mcp_config: Option<PathBuf> = None;
    if let Some(tools) = chat
        .get("tools")
        .and_then(|t| t.as_array())
        .filter(|t| !t.is_empty())
    {
        let (list, map) = crate::claude_mcp::mcp_tools(tools);
        let dir = cc
            .work_dir
            .join("runs")
            .join(uuid::Uuid::new_v4().to_string());
        let setup = || -> std::io::Result<PathBuf> {
            std::fs::create_dir_all(&dir)?;
            let tools_file = dir.join("tools.json");
            std::fs::write(&tools_file, serde_json::to_vec(&list)?)?;
            let exe = std::env::current_exe()?;
            let cfg = json!({"mcpServers": {crate::claude_mcp::SERVER: {
                "type": "stdio",
                "command": exe,
                "args": ["claude-mcp-helper", "--tools-file", tools_file],
            }}});
            let cfg_file = dir.join("mcp.json");
            std::fs::write(&cfg_file, serde_json::to_vec(&cfg)?)?;
            Ok(cfg_file)
        };
        let cfg_file = setup().map_err(|e| fail(500, format!("claude tool bridge: {e}"), false))?;
        mcp_config = Some(cfg_file);
        run_dir = Some(dir);
        names = map;
    }
    let allowed: Vec<String> = names.keys().cloned().collect();

    let mut cmd = Command::new(&cc.bin);
    cmd.args(cli_args(model, mcp_config.as_deref(), &allowed))
        .current_dir(&cc.work_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    for k in BLOCKED_ENV {
        cmd.env_remove(k);
    }
    for (k, v) in EXTRA_ENV {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| {
        fail(
            503,
            format!(
                "cannot start Claude Code ({}): {e}; install it and run `claude` once to sign in",
                cc.bin
            ),
            true,
        )
    })?;

    let line = json!({"type": "user", "message": {"role": "user", "content": render_prompt(chat)}});
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let mut stderr = child.stderr.take().expect("piped stderr");
    if let Err(e) = stdin.write_all(format!("{line}\n").as_bytes()).await {
        stop(child).await;
        return Err(fail(502, format!("Claude Code input: {e}"), true));
    }
    // EOF after the one message: Claude Code answers it and exits.
    drop(stdin);

    let (tx, mut rx) = mpsc::channel::<Item>(64);
    let cancel = cancel.clone();
    tokio::spawn(async move {
        let _permit = permit;
        let mut lines = BufReader::new(stdout).lines();
        let mut sent = false;
        let mut finished = false;
        let mut translator = EventFilter {
            names,
            ..Default::default()
        };
        loop {
            let next = tokio::select! {
                _ = cancel.cancelled() => break,
                l = lines.next_line() => l,
            };
            let Ok(Some(l)) = next else { break };
            let Ok(env) = serde_json::from_str::<Value>(&l) else {
                continue;
            };
            match env.get("type").and_then(|t| t.as_str()) {
                Some("stream_event") => {
                    let Some(ev) = env.get("event") else { continue };
                    for rec in translator.on_event(ev) {
                        sent = true;
                        if tx.send(Item::Record(rec)).await.is_err() {
                            finished = true;
                            break;
                        }
                    }
                    // The reply is complete. A tool call waits on the client, so the run
                    // is ended now (the next request starts a new one with the result).
                    if translator.done {
                        finished = true;
                    }
                }
                Some("result") => {
                    let failed = env.get("is_error").and_then(|e| e.as_bool()) == Some(true)
                        || env.get("subtype").and_then(|s| s.as_str()) != Some("success");
                    if failed {
                        let msg = env
                            .get("result")
                            .and_then(|r| r.as_str())
                            .unwrap_or("Claude Code reported an error")
                            .chars()
                            .take(500)
                            .collect::<String>();
                        let _ = tx
                            .send(Item::Failed {
                                status: status_for(&msg),
                                message: format!("Claude Code: {msg}"),
                            })
                            .await;
                    }
                    finished = true;
                }
                _ => {}
            }
            if finished {
                break;
            }
        }
        if !finished && !sent && !cancel.is_cancelled() {
            let mut err = String::new();
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                (&mut stderr).take(4096).read_to_string(&mut err),
            )
            .await;
            let tail: String = err
                .trim()
                .chars()
                .rev()
                .take(300)
                .collect::<Vec<_>>()
                .into_iter()
                .rev()
                .collect();
            let msg = format!("Claude Code ended without a reply: {tail}");
            warn!("{msg}");
            let _ = tx
                .send(Item::Failed {
                    status: status_for(&tail),
                    message: msg,
                })
                .await;
        }
        stop(child).await;
        if let Some(dir) = run_dir {
            let _ = std::fs::remove_dir_all(dir);
        }
        debug!("claude code run finished");
    });

    match rx.recv().await {
        Some(Item::Record(first)) => Ok(ClaudeRun {
            first: Some(first),
            rx,
        }),
        Some(Item::Failed { status, message }) => Err(fail(
            status,
            message,
            matches!(status, 429 | 401 | 502 | 503),
        )),
        None => Err(fail(502, "Claude Code ended without a reply".into(), true)),
    }
}

/// Re-emits the first message's stream events as client SSE records: text blocks and
/// calls of the client's own tools (renamed back); thinking and anything else dropped,
/// indexes renumbered.
#[derive(Default)]
struct EventFilter {
    /// bridged MCP name → client tool name
    names: HashMap<String, String>,
    started: bool,
    done: bool,
    /// upstream block index → client index (None = dropped)
    map: std::collections::HashMap<i64, Option<i64>>,
    next: i64,
}

impl EventFilter {
    fn record(ev: &Value) -> String {
        let name = ev.get("type").and_then(|t| t.as_str()).unwrap_or("message");
        format!("event: {name}\ndata: {ev}")
    }

    fn on_event(&mut self, ev: &Value) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        let ty = ev.get("type").and_then(|t| t.as_str()).unwrap_or("");
        match ty {
            "message_start" => {
                if self.started {
                    return Vec::new();
                }
                self.started = true;
                vec![Self::record(ev)]
            }
            "content_block_start" => {
                let idx = ev.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                let kind = ev
                    .pointer("/content_block/type")
                    .and_then(|t| t.as_str())
                    .unwrap_or("");
                let client_tool = (kind == "tool_use")
                    .then(|| {
                        ev.pointer("/content_block/name")
                            .and_then(|n| n.as_str())
                            .and_then(|n| self.names.get(n))
                            .cloned()
                    })
                    .flatten();
                if kind != "text" && client_tool.is_none() {
                    self.map.insert(idx, None);
                    return Vec::new();
                }
                let out = self.next;
                self.next += 1;
                self.map.insert(idx, Some(out));
                let mut ev = ev.clone();
                ev["index"] = json!(out);
                if let Some(name) = client_tool {
                    ev["content_block"]["name"] = json!(name);
                }
                vec![Self::record(&ev)]
            }
            "content_block_delta" | "content_block_stop" => {
                let idx = ev.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                match self.map.get(&idx).copied().flatten() {
                    Some(out) => {
                        let mut ev = ev.clone();
                        ev["index"] = json!(out);
                        vec![Self::record(&ev)]
                    }
                    None => Vec::new(),
                }
            }
            "message_delta" => vec![Self::record(ev)],
            "message_stop" => {
                self.done = true;
                vec![Self::record(ev)]
            }
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn caller_system_goes_into_the_message_not_the_system_prompt() {
        let chat = json!({"messages": [
            {"role": "system", "content": "You are a pirate."},
            {"role": "user", "content": "hi"},
        ]});
        let blocks = render_prompt(&chat);
        assert_eq!(
            blocks[0]["text"],
            "<external_system_instructions>\nYou are a pirate.\n</external_system_instructions>\n\n"
        );
        assert_eq!(blocks[1]["text"], "Human: hi\n\n");
        let args = cli_args("sonnet", None, &[]);
        assert!(!args
            .iter()
            .any(|a| a == "--system-prompt" || a == "--system-prompt-file"));
        assert!(args
            .windows(2)
            .any(|w| w[0] == "--tools" && w[1].is_empty()));
    }

    #[test]
    fn history_and_current_turn_with_images() {
        let chat = json!({"messages": [
            {"role": "user", "content": "first"},
            {"role": "assistant", "content": "answer"},
            {"role": "user", "content": [
                {"type": "text", "text": "look"},
                {"type": "image_url", "image_url": {"url": "data:image/png;base64,QUJD"}}
            ]},
        ]});
        let blocks = render_prompt(&chat);
        let t0 = blocks[0]["text"].as_str().unwrap();
        assert!(t0.starts_with("<conversation_history>"));
        assert!(t0.contains("Human: first\n\nAssistant: answer\n\n</conversation_history>"));
        assert!(t0.ends_with("Human: look"));
        assert_eq!(blocks[1]["source"]["data"], "QUJD");
        assert_eq!(blocks[1]["source"]["media_type"], "image/png");
        assert!(blocks[2]["text"]
            .as_str()
            .unwrap()
            .ends_with("</current_turn>"));
    }

    #[test]
    fn filter_drops_thinking_and_renumbers() {
        let mut f = EventFilter::default();
        let evs = [
            json!({"type": "message_start", "message": {"id": "msg_1"}}),
            json!({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}}),
            json!({"type": "content_block_delta", "index": 0, "delta": {"type": "thinking_delta", "thinking": "x"}}),
            json!({"type": "content_block_stop", "index": 0}),
            json!({"type": "content_block_start", "index": 1, "content_block": {"type": "text", "text": ""}}),
            json!({"type": "content_block_delta", "index": 1, "delta": {"type": "text_delta", "text": "hi"}}),
            json!({"type": "content_block_stop", "index": 1}),
            json!({"type": "message_delta", "delta": {"stop_reason": "end_turn"}}),
            json!({"type": "message_stop"}),
            json!({"type": "message_start", "message": {"id": "msg_2"}}),
        ];
        let out: Vec<String> = evs.iter().flat_map(|e| f.on_event(e)).collect();
        assert_eq!(out.len(), 6);
        assert!(out[1].contains("\"index\":0") && out[2].contains("\"text\":\"hi\""));
        assert!(out.iter().all(|r| !r.contains("thinking")));
    }

    #[test]
    fn failure_text_maps_to_status() {
        assert_eq!(status_for("Claude AI usage limit reached|123"), 429);
        assert_eq!(status_for("Invalid API key · Please run /login"), 401);
        assert_eq!(status_for("boom: not logged in"), 401);
        assert_eq!(status_for("boom"), 502);
    }
}

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
//! `mcp__thinrouter__<name>`. A run that calls one hands the `tool_use` to the client
//! and stays alive, waiting in `waiting` by tool id; the helper's `tools/call` blocks on
//! the gateway callback. The request that brings exactly those tool results answers the
//! calls and reads the same process's next message, so the conversation is not sent
//! again. A run whose reply ended (`end_turn`) parks idle with the conversation it
//! knows; a request that only adds user messages to exactly that conversation (same
//! model, instructions and tools) is written to its stdin. An idle run that is ended
//! (expired, evicted, gateway shutdown) leaves its Claude Code session on disk and a
//! shelf entry in the database (hashes only), so a later turn — also after a restart —
//! starts `claude --resume <session>` told only the new messages. Anything else (other
//! results, edited history, nothing saved) starts a new run told the whole
//! conversation, its history in cache-marked blocks.

use std::collections::{HashMap, VecDeque};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};

use bytes::Bytes;
use futures_util::Stream;
use serde_json::{json, Value};
use tokio::io::{AsyncWriteExt, BufReader};
use tokio::process::{Child, Command};
use tokio::sync::{mpsc, oneshot, OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;
use tracing::{debug, warn};

use crate::error::AppError;
use crate::proxy::UpstreamAttemptError;

/// Process settings and live runs shared by every request.
#[derive(Clone)]
pub struct ClaudeCode {
    /// `claude` executable (PATH lookup when bare).
    pub bin: String,
    /// Empty folder runs start in, so no project CLAUDE.md or settings are picked up.
    pub work_dir: PathBuf,
    /// Bounds concurrent Claude Code processes (waiting runs hold a slot).
    pub runs: Arc<Semaphore>,
    /// How long a run waits for the client's tool results.
    pub idle: Duration,
    /// `http://<listen>:<port>` for the MCP helper's callback; set once listening.
    pub callback_base: Arc<OnceLock<String>>,
    live: Arc<Mutex<Live>>,
    /// Processes not yet exited (for shutdown).
    alive: Arc<std::sync::atomic::AtomicUsize>,
    /// Where saved sessions of ended idle runs are listed (`claude_shelf`).
    store: Option<crate::store::Store>,
    /// Claude Code's config folder (`CLAUDE_CONFIG_DIR`, else `~/.claude`).
    config_dir: PathBuf,
}

/// Saved sessions kept on the shelf at most, and for how long.
const SHELF_MOST: usize = 64;
const SHELF_SECS: i64 = 6 * 3600;

fn sha(s: &str) -> String {
    use sha2::{Digest, Sha256};
    hex::encode(Sha256::digest(s.as_bytes()))
}

/// A session id is only used as a file name when it is plainly an id.
fn safe_session_id(sid: &str) -> bool {
    !sid.is_empty()
        && sid.len() <= 128
        && sid
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Claude Code's folder name for a working directory's sessions: the path with
/// everything but ASCII letters and digits made `-` (as magpie's claudeProjectName).
fn project_name(path: &Path) -> String {
    path.to_string_lossy()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect()
}

/// Runs that outlive a request.
#[derive(Default)]
struct Live {
    /// Every live run by callback token.
    by_token: HashMap<String, Arc<LiveRun>>,
    /// Runs waiting for tool results, by pending tool_use id.
    waiting: HashMap<String, Arc<LiveRun>>,
    /// Idle runs whose reply ended, waiting for the next user turn.
    idle: Vec<Arc<LiveRun>>,
    /// Waiting and idle runs, oldest first (evicted when slots run out).
    order: VecDeque<Arc<LiveRun>>,
}

/// A client tool result for an MCP call.
#[derive(Clone, Debug)]
struct ToolResult {
    text: String,
    is_error: bool,
}

/// One Claude Code process that may answer several requests.
struct LiveRun {
    trace_id: u64,
    token: String,
    /// Where the current request's records go; None between requests.
    sink: Mutex<Option<mpsc::Sender<Item>>>,
    /// Wake the reader when an idle run gets a new request receiver.
    sink_changed: tokio::sync::Notify,
    /// tool_use blocks streamed and not yet matched to an MCP call: (id, bridged name, input).
    announced: Mutex<VecDeque<(String, String, Value)>>,
    announcement_changed: tokio::sync::Notify,
    /// Ids of the last message's tool calls, awaiting the client's results.
    pending: Mutex<Vec<String>>,
    /// Results delivered before Claude Code asked for them.
    results: Mutex<HashMap<String, ToolResult>>,
    /// MCP calls waiting for a result.
    calls: Mutex<HashMap<String, oneshot::Sender<ToolResult>>>,
    /// Ends the process.
    stop: CancellationToken,
    /// When it started waiting for tool results or for the next turn.
    waiting_since: Mutex<Option<Instant>>,
    /// Open while the run lives; later user turns are written here.
    stdin: tokio::sync::Mutex<Option<tokio::process::ChildStdin>>,
    /// Model, instructions and tools the run was started with.
    signature: String,
    /// The conversation it has (normalized messages, see `norm`).
    known: Mutex<Vec<Value>>,
    /// Claude Code's session id (from its `system`/`init` line).
    session_id: Mutex<Option<String>>,
    /// Parked after a complete reply (so its session can be shelved when it ends).
    idle_now: std::sync::atomic::AtomicBool,
}

/// What must match for a message to count as "the same" in a known conversation.
fn norm(m: &Value) -> Value {
    let calls: Vec<Value> = m
        .get("tool_calls")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
        .filter_map(|c| c.get("id").cloned())
        .collect();
    let images = m
        .get("content")
        .and_then(|c| c.as_array())
        .map(|p| {
            p.iter()
                .filter(|x| x.get("type").and_then(|t| t.as_str()) == Some("image_url"))
                .count()
        })
        .unwrap_or(0);
    json!({
        "role": m.get("role").cloned().unwrap_or(json!("user")),
        "text": content_text(m.get("content").unwrap_or(&Value::Null)).trim(),
        "calls": calls,
        "call_id": m.get("tool_call_id").cloned().unwrap_or(Value::Null),
        "images": images,
    })
}

fn is_system(m: &Value) -> bool {
    matches!(
        m.get("role").and_then(|r| r.as_str()),
        Some("system" | "developer")
    )
}

/// The conversation part of a chat request (system/developer messages excluded).
fn convo(chat: &Value) -> Vec<Value> {
    chat.get("messages")
        .and_then(|m| m.as_array())
        .into_iter()
        .flatten()
        .filter(|m| !is_system(m))
        .cloned()
        .collect()
}

/// Model + instructions + tool names: a run only goes on under the same ones.
fn signature(model: &str, chat: &Value) -> String {
    let system: Vec<String> = chat
        .get("messages")
        .and_then(|m| m.as_array())
        .into_iter()
        .flatten()
        .filter(|m| is_system(m))
        .map(|m| content_text(m.get("content").unwrap_or(&Value::Null)))
        .collect();
    let mut tools: Vec<String> = chat
        .get("tools")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
        .map(|t| t.get("function").unwrap_or(t).to_string())
        .collect();
    tools.sort();
    json!([model, system, tools]).to_string()
}

impl ClaudeCode {
    pub fn new(bin: Option<String>, data_dir: &std::path::Path, max_runs: usize) -> Self {
        Self {
            bin: bin
                .filter(|b| !b.trim().is_empty())
                .unwrap_or_else(|| "claude".into()),
            work_dir: data_dir.join("claude-work"),
            runs: Arc::new(Semaphore::new(max_runs.max(1))),
            idle: Duration::from_secs(600),
            callback_base: Arc::new(OnceLock::new()),
            live: Arc::new(Mutex::new(Live::default())),
            alive: Arc::new(std::sync::atomic::AtomicUsize::new(0)),
            store: None,
            config_dir: std::env::var_os("CLAUDE_CONFIG_DIR")
                .map(PathBuf::from)
                .or_else(|| dirs::home_dir().map(|h| h.join(".claude")))
                .unwrap_or_else(|| PathBuf::from(".claude")),
        }
    }

    pub fn with_store(mut self, store: crate::store::Store) -> Self {
        self.store = Some(store);
        self
    }

    /// Folders Claude Code saves this work dir's sessions in (its own path and, when
    /// different, the resolved one).
    fn session_dirs(&self) -> Vec<PathBuf> {
        let mut dirs = vec![self
            .config_dir
            .join("projects")
            .join(project_name(&self.work_dir))];
        if let Ok(real) = std::fs::canonicalize(&self.work_dir) {
            let d = self.config_dir.join("projects").join(project_name(&real));
            if !dirs.contains(&d) {
                dirs.push(d);
            }
        }
        dirs
    }

    fn session_saved(&self, sid: &str) -> bool {
        safe_session_id(sid)
            && self
                .session_dirs()
                .iter()
                .any(|d| d.join(format!("{sid}.jsonl")).is_file())
    }

    /// Remove a session's file and the folder Claude Code may keep beside it.
    fn remove_session(&self, sid: &str) {
        if !safe_session_id(sid) {
            return;
        }
        for d in self.session_dirs() {
            let _ = std::fs::remove_file(d.join(format!("{sid}.jsonl")));
            let _ = std::fs::remove_dir_all(d.join(sid));
        }
    }

    /// Drop expired shelf entries with their files, and session files no shelf entry
    /// names (left by runs that ended without being shelved, or before a crash).
    /// Only the work dir's own project folders are touched: no one else works there.
    pub fn sweep_sessions(&self, at_startup: bool) {
        let Some(store) = &self.store else { return };
        for sid in store.shelf_expire(SHELF_SECS).unwrap_or_default() {
            self.remove_session(&sid);
        }
        if !at_startup {
            return;
        }
        let kept: std::collections::HashSet<String> =
            store.shelf_ids().unwrap_or_default().into_iter().collect();
        for d in self.session_dirs() {
            for e in std::fs::read_dir(&d).into_iter().flatten().flatten() {
                let name = e.file_name().to_string_lossy().to_string();
                if let Some(sid) = name.strip_suffix(".jsonl") {
                    if !kept.contains(sid) {
                        self.remove_session(sid);
                    }
                }
            }
        }
    }

    /// A saved session this conversation goes on from: same settings, its messages a
    /// prefix, only user messages after it, and the file still there.
    fn unshelve(&self, model: &str, chat: &Value) -> Option<(String, usize)> {
        let store = self.store.as_ref()?;
        let msgs = convo(chat);
        let hashes: Vec<String> = msgs.iter().map(|m| sha(&norm(m).to_string())).collect();
        let (sid, n) = store
            .shelf_take(&sha(&signature(model, chat)), &hashes)
            .ok()??;
        let only_user = msgs[n..]
            .iter()
            .all(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"));
        if !only_user || !self.session_saved(&sid) {
            self.remove_session(&sid);
            return None;
        }
        Some((sid, n))
    }

    /// Put an ended idle run's session on the shelf.
    fn shelve(&self, run: &LiveRun) -> bool {
        let (Some(store), Some(sid)) = (&self.store, run.session_id.lock().unwrap().clone()) else {
            return false;
        };
        if !self.session_saved(&sid) {
            return false;
        }
        let known: Vec<String> = run
            .known
            .lock()
            .unwrap()
            .iter()
            .map(|m| sha(&m.to_string()))
            .collect();
        match store.shelf_put(&sid, &sha(&run.signature), &known, SHELF_MOST) {
            Ok(pushed_out) => {
                for old in pushed_out {
                    self.remove_session(&old);
                }
                debug!("saved an ended Claude Code run's session for its next turn");
                true
            }
            Err(_) => false,
        }
    }

    pub fn with_idle(mut self, idle: Duration) -> Self {
        self.idle = idle;
        self
    }

    fn forget(&self, run: &Arc<LiveRun>) {
        let mut live = self.live.lock().unwrap();
        live.by_token.remove(&run.token);
        live.waiting.retain(|_, r| !Arc::ptr_eq(r, run));
        live.idle.retain(|r| !Arc::ptr_eq(r, run));
        live.order.retain(|r| !Arc::ptr_eq(r, run));
    }

    /// Stop every live run and wait (bounded) for them to exit.
    pub async fn shutdown(&self) {
        let runs: Vec<Arc<LiveRun>> = self
            .live
            .lock()
            .unwrap()
            .by_token
            .values()
            .cloned()
            .collect();
        for r in &runs {
            r.stop.cancel();
        }
        let deadline = Instant::now() + Duration::from_secs(6);
        while self.alive.load(std::sync::atomic::Ordering::SeqCst) > 0 && Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// End the run after `idle` unless it was used again meanwhile.
    fn expire_later(&self, run: &Arc<LiveRun>) {
        let (run, idle) = (run.clone(), self.idle);
        tokio::spawn(async move {
            tokio::time::sleep(idle).await;
            let still = run
                .waiting_since
                .lock()
                .unwrap()
                .is_some_and(|t| t.elapsed() >= idle);
            if still {
                debug!("Claude Code run idle too long; ending it");
                run.stop.cancel();
            }
        });
    }

    /// If `chat` only adds user messages to the conversation an idle run has, write
    /// them to it and return a sink for its reply.
    async fn resume_run(&self, model: &str, chat: &Value) -> Option<mpsc::Receiver<Item>> {
        let sig = signature(model, chat);
        let msgs = convo(chat);
        let normed: Vec<Value> = msgs.iter().map(norm).collect();
        let (run, start, rx) = {
            let mut live = self.live.lock().unwrap();
            let pos = live.idle.iter().position(|r| {
                let known = r.known.lock().unwrap();
                r.signature == sig
                    && known.len() < normed.len()
                    && normed[..known.len()] == known[..]
                    && msgs[known.len()..]
                        .iter()
                        .all(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
            })?;
            let run = live.idle.remove(pos);
            live.order.retain(|r| !Arc::ptr_eq(r, &run));
            let start = run.known.lock().unwrap().len();
            run.idle_now
                .store(false, std::sync::atomic::Ordering::SeqCst);
            let (tx, rx) = mpsc::channel::<Item>(64);
            *run.sink.lock().unwrap() = Some(tx);
            *run.waiting_since.lock().unwrap() = None;
            *run.known.lock().unwrap() = normed;
            run.sink_changed.notify_one();
            debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "resume_user_sink");
            (run, start, rx)
        };
        let line = json!({"type": "user", "message": {"role": "user", "content": render_turn(&msgs[start..])}});
        let written = match run.stdin.lock().await.as_mut() {
            Some(stdin) => stdin
                .write_all(format!("{line}\n").as_bytes())
                .await
                .is_ok(),
            None => false,
        };
        if !written {
            *run.sink.lock().unwrap() = None;
            run.stop.cancel();
            return None;
        }
        Some(rx)
    }

    /// A slot for a new run; when none is free, the oldest waiting run is ended.
    async fn slot(&self, cancel: &CancellationToken) -> Option<OwnedSemaphorePermit> {
        if let Ok(p) = self.runs.clone().try_acquire_owned() {
            return Some(p);
        }
        let oldest = self.live.lock().unwrap().order.pop_front();
        if let Some(run) = oldest {
            debug!("ending the oldest waiting Claude Code run for a new one");
            run.stop.cancel();
        }
        tokio::select! {
            _ = cancel.cancelled() => None,
            p = self.runs.clone().acquire_owned() => p.ok(),
        }
    }

    /// The helper's `tools/call` for run `token`: answered with the client's result for
    /// the matching streamed tool_use (waits for it up to `idle`).
    pub async fn mcp_call(&self, token: &str, params: &Value) -> Option<Value> {
        let run = {
            let live = self.live.lock().unwrap();
            live.by_token
                .iter()
                .find(|(t, _)| crate::guard::ct_eq(t, token))
                .map(|(_, r)| r.clone())?
        };
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_received");
        let name = params.get("name").and_then(|n| n.as_str()).unwrap_or("");
        let args = params.get("arguments").cloned().unwrap_or(Value::Null);
        let bridged = format!("{}{name}", crate::claude_mcp::PREFIX);
        // HTTP callback and stdout are independent I/O paths. Keep the original
        // idle allowance as one deadline covering announcement and result waits.
        let deadline = tokio::time::Instant::now() + self.idle;
        let id = loop {
            // notify_waiters also wakes a Notified created but not yet polled.
            let changed = run.announcement_changed.notified();
            let found = {
                let mut ann = run.announced.lock().unwrap();
                let pos = ann
                    .iter()
                    .position(|(_, n, input)| *n == bridged && *input == args)
                    .or_else(|| ann.iter().position(|(_, n, _)| *n == bridged));
                pos.and_then(|p| ann.remove(p).map(|(id, _, _)| id))
            };
            if let Some(id) = found {
                break id;
            }
            if run.idle_now.load(std::sync::atomic::Ordering::SeqCst) {
                return Some(crate::claude_mcp::call_result(
                    "no matching tool call is pending",
                    true,
                ));
            }
            debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_wait_announcement");
            tokio::select! {
                _ = changed => {},
                _ = run.stop.cancelled() => return None,
                _ = tokio::time::sleep_until(deadline) => {
                    debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_announcement_timeout");
                    return Some(crate::claude_mcp::call_result("no matching tool call is pending", true));
                },
            }
        };
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_matched");
        let rx = {
            // Same lock order as continue_run: no gap between inspecting buffered
            // results and registering the waiter that a concurrent result uses.
            let mut calls = run.calls.lock().unwrap();
            let (tx, rx) = oneshot::channel();
            if let Some(result) = run.results.lock().unwrap().remove(&id) {
                let _ = tx.send(result);
            } else {
                calls.insert(id.clone(), tx);
            }
            rx
        };
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_wait_result");
        let result = tokio::select! {
            r = rx => r.ok()?,
            _ = run.stop.cancelled() => return None,
            _ = tokio::time::sleep_until(deadline) => {
                run.calls.lock().unwrap().remove(&id);
                debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_result_timeout");
                return Some(crate::claude_mcp::call_result("the client did not return a tool result in time", true));
            },
        };
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "mcp_result_reply");
        Some(crate::claude_mcp::call_result(
            &result.text,
            result.is_error,
        ))
    }

    /// If `chat` ends with exactly the results a waiting run asked for, hand them over
    /// and return a new sink's receiver for that run's next message.
    fn continue_run(&self, chat: &Value) -> Option<mpsc::Receiver<Item>> {
        let results = trailing_tool_results(chat)?;
        let known = convo(chat).iter().map(norm).collect();
        let mut live = self.live.lock().unwrap();
        let run = live.waiting.get(&results[0].0)?.clone();
        let pending = run.pending.lock().unwrap().clone();
        let mut want: Vec<&String> = pending.iter().collect();
        let mut got: Vec<&String> = results.iter().map(|(id, _)| id).collect();
        want.sort();
        got.sort();
        if want != got {
            return None;
        }
        for id in &pending {
            live.waiting.remove(id);
        }
        live.order.retain(|r| !Arc::ptr_eq(r, &run));
        // Completion and new-sink installation share the live lock. A completed
        // phase cannot publish stale waiting entries or overwrite this receiver.
        let (tx, rx) = mpsc::channel::<Item>(64);
        *run.sink.lock().unwrap() = Some(tx);
        *run.waiting_since.lock().unwrap() = None;
        *run.known.lock().unwrap() = known;
        run.pending.lock().unwrap().clear();
        run.sink_changed.notify_one();
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "continue_tool_sink");
        for (id, result) in results {
            match run.calls.lock().unwrap().remove(&id) {
                Some(tx) => {
                    debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "tool_result_deliver");
                    let _ = tx.send(result);
                }
                None => {
                    debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "tool_result_buffer");
                    run.results.lock().unwrap().insert(id, result);
                }
            }
        }
        Some(rx)
    }

    /// Detach this message's sender before making the run reusable. Retire a
    /// completed tool phase even if its client has already gone away.
    fn finish_turn(
        &self,
        run: &Arc<LiveRun>,
        filter: &mut EventFilter,
    ) -> Option<mpsc::Sender<Item>> {
        let mut live = self.live.lock().unwrap();
        let tx = run.sink.lock().unwrap().take();
        let waits = filter.stop_reason.as_deref() == Some("tool_use");
        live.order.retain(|r| !Arc::ptr_eq(r, run));
        live.idle.retain(|r| !Arc::ptr_eq(r, run));
        if waits {
            debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_tool_waiting");
            let ids = std::mem::take(&mut filter.tool_ids);
            *run.pending.lock().unwrap() = ids.clone();
            run.idle_now
                .store(false, std::sync::atomic::Ordering::SeqCst);
            for id in ids {
                live.waiting.insert(id, run.clone());
            }
        } else {
            debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_end_turn");
            live.waiting.retain(|_, r| !Arc::ptr_eq(r, run));
            run.pending.lock().unwrap().clear();
            run.announced.lock().unwrap().clear();
            run.calls.lock().unwrap().clear();
            run.results.lock().unwrap().clear();
            run.known.lock().unwrap().push(json!({
                "role":"assistant", "text":filter.reply_text.trim(), "calls":[], "call_id":null, "images":0,
            }));
            run.idle_now
                .store(true, std::sync::atomic::Ordering::SeqCst);
            run.announcement_changed.notify_waiters();
            live.idle.push(run.clone());
        }
        *run.waiting_since.lock().unwrap() = Some(Instant::now());
        live.order.push_back(run.clone());
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_retire_sink");
        tx
    }
}

/// `(tool_call_id, result)` for the tool messages after the last assistant tool call,
/// when nothing else follows them.
fn trailing_tool_results(chat: &Value) -> Option<Vec<(String, ToolResult)>> {
    let msgs = chat.get("messages")?.as_array()?;
    let mut out = Vec::new();
    for m in msgs.iter().rev() {
        match m.get("role").and_then(|r| r.as_str()) {
            Some("tool") => {
                let id = m.get("tool_call_id")?.as_str()?.to_string();
                let text = content_text(m.get("content").unwrap_or(&Value::Null));
                let is_error = text.starts_with("[tool error]");
                out.push((id, ToolResult { text, is_error }));
            }
            Some("assistant") if is_tool_call(m) => break,
            _ => return None,
        }
    }
    if out.is_empty() {
        return None;
    }
    out.reverse();
    Some(out)
}

/// Arguments as magpie's `claudeCLIArgs`. With client tools, the MCP helper's config
/// and an allow-list of exactly those tools (no permission prompt in `-p`).
/// Sessions are saved (no `--no-session-persistence`) so an ended idle run can be
/// resumed with `--resume <session>`.
pub fn cli_args(
    model: &str,
    mcp_config: Option<&Path>,
    allowed: &[String],
    resume: Option<&str>,
) -> Vec<String> {
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
    if let Some(sid) = resume {
        args.push("--resume".into());
        args.push(sid.to_string());
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
/// History messages per cached block of a new run's first message (magpie's
/// `historyChunk`): a later new run of the same conversation reads the cached prefix up
/// to the last whole block, within Anthropic's 20-block lookback.
const HISTORY_CHUNK: usize = 20;

fn cache_mark() -> Value {
    json!({"type": "ephemeral", "ttl": "1h"})
}

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
    let instructions_block = blocks.len().checked_sub(1);
    let mut chunk_block: Option<usize> = None;

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
        if split > 0 && i < split && (i + 1) % HISTORY_CHUNK == 0 {
            flush(&mut blocks, &mut text);
            chunk_block = blocks.len().checked_sub(1);
        }
    }
    // One cache mark (Claude Code keeps three of Anthropic's four): on the last whole
    // history block, else on the caller's instructions.
    if let Some(i) = chunk_block.or(instructions_block) {
        blocks[i]["cache_control"] = cache_mark();
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

/// New user messages for a run that already has the conversation: their own text and
/// images, as Claude Code would be told them directly.
pub fn render_turn(msgs: &[Value]) -> Vec<Value> {
    let mut blocks: Vec<Value> = Vec::new();
    let mut text = String::new();
    for (i, m) in msgs.iter().enumerate() {
        if i > 0 {
            text.push_str("\n\n");
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
pub(crate) enum Item {
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
        let mut records = crate::collection::Records::default();
        if let Some(first) = first {
            records.push(first)?;
        }
        while let Some(item) = rx.recv().await {
            match item {
                Item::Record(r) => records.push(r)?,
                Item::Failed { status, message } => {
                    return Err(AppError::Upstream {
                        status,
                        body: message,
                    })
                }
            }
        }
        Ok(crate::claude::anthropic_sse_to_message(
            records.as_slice(),
            model,
        ))
    }
}

/// Map a Claude Code failure text to an HTTP status (no secrets in these texts).
pub(crate) fn status_for(message: &str) -> u16 {
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
pub(crate) async fn stop(mut child: Child) {
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

/// Wait for a run's first record for this request.
pub(crate) async fn first_record(
    mut rx: mpsc::Receiver<Item>,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    match rx.recv().await {
        Some(Item::Record(first)) => Ok(ClaudeRun {
            first: Some(first),
            rx,
        }),
        Some(Item::Failed { status, message }) => Err(UpstreamAttemptError {
            status,
            body: message,
            retryable: matches!(status, 429 | 401 | 502 | 503),
        }),
        None => Err(UpstreamAttemptError {
            status: 502,
            body: "Claude Code ended without a reply".into(),
            retryable: true,
        }),
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    use std::io::Write;
    let mut opts = std::fs::OpenOptions::new();
    opts.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    opts.open(path)?.write_all(bytes)
}

/// Answer a request with Claude Code: hand tool results to the run waiting for them, or
/// start `claude -p`. Waits for the first reply event, so failures before any output can
/// still fall back to another target.
pub async fn start(
    cc: &ClaudeCode,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    if let Some(rx) = cc.continue_run(chat) {
        debug!("tool results go on in the waiting Claude Code run");
        return first_record(rx).await;
    }
    if let Some(rx) = cc.resume_run(model, chat).await {
        debug!("the next turn goes on in the idle Claude Code run");
        return first_record(rx).await;
    }
    if let Some(saved) = cc.unshelve(model, chat) {
        match spawn_run(cc, model, chat, cancel, Some(saved)).await {
            Ok(run) => {
                debug!("the next turn goes on from a saved Claude Code session");
                return Ok(run);
            }
            Err(e) if !cancel.is_cancelled() => {
                debug!(
                    status = e.status,
                    "saved session not resumable; a new run is told the conversation"
                );
            }
            Err(e) => return Err(e),
        }
    }
    spawn_run(cc, model, chat, cancel, None).await
}

/// Own only a directory created by this run, including during startup errors or
/// cancellation before the reader task exists. Never adopt an existing path.
struct RunDir(PathBuf);

impl RunDir {
    fn create(path: PathBuf) -> std::io::Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::create_dir(&path)?;
        Ok(Self(path))
    }
}

impl Drop for RunDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Start `claude -p`: told the whole conversation, or (`resume` = saved session and how
/// many messages it has) only the messages after it.
async fn spawn_run(
    cc: &ClaudeCode,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
    resume: Option<(String, usize)>,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    let fail = |status: u16, body: String, retryable: bool| UpstreamAttemptError {
        status,
        body,
        retryable,
    };
    let permit = cc
        .slot(cancel)
        .await
        .ok_or_else(|| fail(499, "client disconnected".into(), false))?;
    std::fs::create_dir_all(&cc.work_dir)
        .map_err(|e| fail(500, format!("claude work dir: {e}"), false))?;
    let token = crate::guard::random_hex(24);

    // Client tools: a per-run folder (0600 files) with the helper's tool list, MCP config
    // and callback URL (which holds the run token, so it is never on a command line).
    let mut names: HashMap<String, String> = HashMap::new();
    let mut run_dir: Option<RunDir> = None;
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
        let callback = cc.callback_base.get().map(|base| {
            json!({"url": format!("{base}{}", crate::claude_mcp::CALLBACK_PATH), "token": token})
        });
        let setup = || -> std::io::Result<(PathBuf, RunDir)> {
            let owned_dir = RunDir::create(dir.clone())?;
            let tools_file = dir.join("tools.json");
            write_private(&tools_file, &serde_json::to_vec(&list)?)?;
            let mut args = vec![
                json!("claude-mcp-helper"),
                json!("--tools-file"),
                json!(tools_file),
            ];
            if let Some(cb_json) = &callback {
                let cb = dir.join("callback.json");
                write_private(&cb, &serde_json::to_vec(cb_json)?)?;
                args.push(json!("--callback-file"));
                args.push(json!(cb));
            }
            let cfg = json!({"mcpServers": {crate::claude_mcp::SERVER: {
                "type": "stdio",
                "command": std::env::current_exe()?,
                "args": args,
            }}});
            let cfg_file = dir.join("mcp.json");
            write_private(&cfg_file, &serde_json::to_vec(&cfg)?)?;
            Ok((cfg_file, owned_dir))
        };
        let (cfg_file, owned_dir) =
            setup().map_err(|e| fail(500, format!("claude tool bridge: {e}"), false))?;
        mcp_config = Some(cfg_file);
        run_dir = Some(owned_dir);
        names = map;
    }
    let allowed: Vec<String> = names.keys().cloned().collect();

    let mut cmd = Command::new(&cc.bin);
    cmd.args(cli_args(
        model,
        mcp_config.as_deref(),
        &allowed,
        resume.as_ref().map(|(sid, _)| sid.as_str()),
    ))
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

    let content = match &resume {
        Some((_, n)) => render_turn(&convo(chat)[*n..]),
        None => render_prompt(chat),
    };
    let line = json!({"type": "user", "message": {"role": "user", "content": content}});
    let mut stdin = child.stdin.take().expect("piped stdin");
    let stdout = child.stdout.take().expect("piped stdout");
    let mut diagnostics = crate::cli_stderr::Drain::new(child.stderr.take().expect("piped stderr"));
    if let Err(e) = stdin.write_all(format!("{line}\n").as_bytes()).await {
        stop(child).await;
        diagnostics.stop().await;
        return Err(fail(502, format!("Claude Code input: {e}"), true));
    }

    let (tx, rx) = mpsc::channel::<Item>(64);
    static NEXT_TRACE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let run = Arc::new(LiveRun {
        trace_id: NEXT_TRACE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        token: token.clone(),
        sink: Mutex::new(Some(tx)),
        sink_changed: tokio::sync::Notify::new(),
        announced: Mutex::new(VecDeque::new()),
        announcement_changed: tokio::sync::Notify::new(),
        pending: Mutex::new(Vec::new()),
        results: Mutex::new(HashMap::new()),
        calls: Mutex::new(HashMap::new()),
        stop: CancellationToken::new(),
        waiting_since: Mutex::new(None),
        stdin: tokio::sync::Mutex::new(Some(stdin)),
        signature: signature(model, chat),
        known: Mutex::new(convo(chat).iter().map(norm).collect()),
        session_id: Mutex::new(resume.as_ref().map(|(sid, _)| sid.clone())),
        idle_now: std::sync::atomic::AtomicBool::new(false),
    });
    cc.live.lock().unwrap().by_token.insert(token, run.clone());

    // The first request's disconnect ends the run while it is still answering it.
    let first_cancel = cancel.clone();
    cc.alive.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let cc = cc.clone();
    tokio::spawn(async move {
        let _permit = permit;
        let mut lines = crate::cli_lines::Lines::new(BufReader::new(stdout));
        let mut limit_failure = None;
        let mut sent = false;
        let mut filter = EventFilter {
            names,
            ..Default::default()
        };
        let sink = |run: &LiveRun| run.sink.lock().unwrap().clone();
        'read: loop {
            // An active receiver can disappear while stdout stays silent. Between
            // completed turns there is no sink; retain the reusable process then.
            let active_sink = sink(&run);
            let disconnected = async {
                match active_sink.as_ref() {
                    Some(tx) => tx.closed().await,
                    None => std::future::pending::<()>().await,
                }
            };
            let next = tokio::select! {
                _ = run.sink_changed.notified() => continue,
                _ = disconnected => break,
                _ = run.stop.cancelled() => break,
                _ = first_cancel.cancelled(), if !sent => break,
                l = lines.next_line() => l,
            };
            let l = match next {
                Ok(Some(line)) => line,
                Err(crate::cli_lines::LineError::TooLarge) => {
                    limit_failure = Some(crate::cli_lines::LIMIT_MESSAGE);
                    // A corrupted process must not become a resumable idle run.
                    run.idle_now
                        .store(false, std::sync::atomic::Ordering::SeqCst);
                    break;
                }
                _ => break,
            };
            let Ok(env) = serde_json::from_str::<Value>(&l) else {
                continue;
            };
            match env.get("type").and_then(|t| t.as_str()) {
                Some("stream_event") => {
                    let Some(ev) = env.get("event") else { continue };
                    let records = filter.on_event(ev);
                    if filter.failed {
                        limit_failure = Some(EVENT_STATE_LIMIT_MESSAGE);
                        run.idle_now
                            .store(false, std::sync::atomic::Ordering::SeqCst);
                        break;
                    }
                    // A callback may already be waiting for this stdout announcement.
                    if !filter.finished_tools.is_empty() {
                        run.announced
                            .lock()
                            .unwrap()
                            .extend(filter.finished_tools.drain(..));
                        run.announcement_changed.notify_waiters();
                    }
                    let tx = if filter.done {
                        cc.finish_turn(&run, &mut filter)
                    } else {
                        sink(&run)
                    };
                    if let Some(tx) = tx {
                        for rec in records {
                            sent = true;
                            if tx.send(Item::Record(rec)).await.is_err() {
                                break 'read;
                            }
                        }
                    } else {
                        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_no_sink", done = filter.done);
                    }
                    if filter.done {
                        // Reset and expire even an unsolicited completion. Do not
                        // clear the next request's sender after publishing reuse.
                        filter.reset();
                        cc.expire_later(&run);
                    }
                }
                Some("result") => {
                    let failed = env.get("is_error").and_then(|e| e.as_bool()) == Some(true)
                        || env.get("subtype").and_then(|s| s.as_str()) != Some("success");
                    // A successful turn ends with a result; the run lives on.
                    if !failed {
                        continue;
                    }
                    {
                        let msg = env
                            .get("result")
                            .and_then(|r| r.as_str())
                            .unwrap_or("Claude Code reported an error")
                            .chars()
                            .take(500)
                            .collect::<String>();
                        if let Some(tx) = sink(&run) {
                            sent = true;
                            let _ = tx
                                .send(Item::Failed {
                                    status: status_for(&msg),
                                    message: format!("Claude Code: {msg}"),
                                })
                                .await;
                        }
                    }
                    break;
                }
                Some("system") if env.get("subtype").and_then(|s| s.as_str()) == Some("init") => {
                    if let Some(sid) = env.get("session_id").and_then(|s| s.as_str()) {
                        *run.session_id.lock().unwrap() = Some(sid.to_string());
                    }
                }
                _ => {}
            }
        }
        drop(lines);
        drop(filter);
        // Hold the active sender across cleanup so the client cannot observe EOF
        // as success, and deliver limit failures only after the process/slot are freed.
        let failure_sink = limit_failure.and_then(|message| sink(&run).map(|tx| (tx, message)));
        if let Some(tx) = sink(&run) {
            if limit_failure.is_none()
                && !sent
                && !run.stop.is_cancelled()
                && !first_cancel.is_cancelled()
            {
                let err = diagnostics.diagnostic().await;
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
        }
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_cleanup");
        cc.forget(&run);
        run.stop.cancel();
        *run.sink.lock().unwrap() = None;
        stop(child).await;
        diagnostics.stop().await;
        // An idle run's session is kept for its next turn; any other run's is removed.
        let idle = run.idle_now.load(std::sync::atomic::Ordering::SeqCst);
        if !(idle && cc.shelve(&run)) {
            if let Some(sid) = run.session_id.lock().unwrap().clone() {
                cc.remove_session(&sid);
            }
        }
        cc.alive.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        drop(run_dir);
        drop(_permit);
        if let Some((tx, message)) = failure_sink {
            let _ = tx
                .send(Item::Failed {
                    status: 502,
                    message: message.into(),
                })
                .await;
        }
        debug!("claude code run finished");
    });

    first_record(rx).await
}

const EVENT_STATE_LIMIT_MESSAGE: &str = "Claude event state limit exceeded";

/// Re-emits the first message's stream events as client SSE records: text blocks and
/// calls of the client's own tools (renamed back); thinking and anything else dropped,
/// indexes renumbered.
#[derive(Default)]
struct EventFilter {
    budget: crate::stream_budget::RetainedBudget,
    failed: bool,
    /// bridged MCP name → client tool name
    names: HashMap<String, String>,
    started: bool,
    done: bool,
    stop_reason: Option<String>,
    /// upstream index → (tool_use id, bridged name, input JSON so far)
    tools: HashMap<i64, (String, String, String)>,
    /// Client tool calls of this message, complete: (id, bridged name, input).
    finished_tools: Vec<(String, String, Value)>,
    /// Ids of this message's client tool calls.
    tool_ids: Vec<String>,
    /// Text the client was shown in this message.
    reply_text: String,
    /// upstream block index → client index (None = dropped)
    map: std::collections::HashMap<i64, Option<i64>>,
    next: i64,
}

impl EventFilter {
    /// Ready for the next message of the same run.
    fn reset(&mut self) {
        *self = EventFilter {
            names: std::mem::take(&mut self.names),
            ..Default::default()
        };
    }

    fn record(ev: &Value) -> String {
        let name = ev.get("type").and_then(|t| t.as_str()).unwrap_or("message");
        format!("event: {name}\ndata: {ev}")
    }

    /// Charge exactly the payload retained below, plus every block start. Starts
    /// count even on ignored/replaced indexes, bounding all block collections.
    fn charge_event(&mut self, ev: &Value) -> bool {
        let idx = ev.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
        let (bytes, starts) = match ev.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "content_block_start" => {
                let name = ev
                    .pointer("/content_block/name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                let client_tool = ev.pointer("/content_block/type").and_then(|v| v.as_str())
                    == Some("tool_use")
                    && self.names.contains_key(name);
                let bytes = if client_tool {
                    let id = ev
                        .pointer("/content_block/id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("");
                    id.len().saturating_mul(2).saturating_add(name.len())
                } else {
                    0
                };
                (bytes, 1)
            }
            "content_block_delta" | "content_block_stop" => {
                let arguments = if self.tools.contains_key(&idx) {
                    ev.pointer("/delta/partial_json")
                        .and_then(|v| v.as_str())
                        .map_or(0, str::len)
                } else {
                    0
                };
                let text = if self.map.get(&idx).copied().flatten().is_some() {
                    ev.pointer("/delta/text")
                        .and_then(|v| v.as_str())
                        .map_or(0, str::len)
                } else {
                    0
                };
                (arguments.saturating_add(text), 0)
            }
            "message_delta" => (
                ev.pointer("/delta/stop_reason")
                    .and_then(|v| v.as_str())
                    .map_or(0, str::len),
                0,
            ),
            _ => (0, 0),
        };
        self.budget.charge(bytes, starts)
    }

    fn on_event(&mut self, ev: &Value) -> Vec<String> {
        if self.done || self.failed {
            return Vec::new();
        }
        if !self.charge_event(ev) {
            self.reset(); // release owned payload, preserving only request tool names
            self.failed = true;
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
                    let id = ev
                        .pointer("/content_block/id")
                        .and_then(|i| i.as_str())
                        .unwrap_or("")
                        .to_string();
                    let bridged = ev
                        .pointer("/content_block/name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    self.tool_ids.push(id.clone());
                    self.tools.insert(idx, (id, bridged, String::new()));
                    ev["content_block"]["name"] = json!(name);
                }
                vec![Self::record(&ev)]
            }
            "content_block_delta" | "content_block_stop" => {
                let idx = ev.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                if let Some(j) = ev.pointer("/delta/partial_json").and_then(|j| j.as_str()) {
                    if let Some(t) = self.tools.get_mut(&idx) {
                        t.2.push_str(j);
                    }
                }
                if let Some(t) = ev.pointer("/delta/text").and_then(|t| t.as_str()) {
                    if self.map.get(&idx).copied().flatten().is_some() {
                        self.reply_text.push_str(t);
                    }
                }
                if ty == "content_block_stop" {
                    if let Some((id, bridged, input)) = self.tools.remove(&idx) {
                        let input = serde_json::from_str(&input).unwrap_or_else(|_| json!({}));
                        self.finished_tools.push((id, bridged, input));
                    }
                }
                match self.map.get(&idx).copied().flatten() {
                    Some(out) => {
                        let mut ev = ev.clone();
                        ev["index"] = json!(out);
                        vec![Self::record(&ev)]
                    }
                    None => Vec::new(),
                }
            }
            "message_delta" => {
                if let Some(r) = ev.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                    self.stop_reason = Some(r.to_string());
                }
                vec![Self::record(ev)]
            }
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
    fn continuation_fixture() -> (
        tempfile::TempDir,
        super::ClaudeCode,
        std::sync::Arc<super::LiveRun>,
    ) {
        use super::*;
        let dir = tempfile::tempdir().unwrap();
        let cc = ClaudeCode::new(Some("unused-test-cli".into()), dir.path(), 1)
            .with_idle(Duration::from_secs(2));
        let run = Arc::new(LiveRun {
            trace_id: 0,
            token: "synthetic".into(),
            sink: Mutex::new(None),
            sink_changed: tokio::sync::Notify::new(),
            announced: Mutex::new(VecDeque::new()),
            announcement_changed: tokio::sync::Notify::new(),
            pending: Mutex::new(Vec::new()),
            results: Mutex::new(HashMap::new()),
            calls: Mutex::new(HashMap::new()),
            stop: CancellationToken::new(),
            waiting_since: Mutex::new(None),
            stdin: tokio::sync::Mutex::new(None),
            signature: String::new(),
            known: Mutex::new(Vec::new()),
            session_id: Mutex::new(None),
            idle_now: std::sync::atomic::AtomicBool::new(false),
        });
        cc.live
            .lock()
            .unwrap()
            .by_token
            .insert(run.token.clone(), run.clone());
        (dir, cc, run)
    }

    fn synthetic_tool_result() -> serde_json::Value {
        serde_json::json!({"messages":[
            {"role":"assistant","tool_calls":[{"id":"tool_1","type":"function","function":{"name":"probe","arguments":"{}"}}]},
            {"role":"tool","tool_call_id":"tool_1","content":"synthetic-result"}
        ]})
    }

    #[tokio::test]
    async fn tc2_early_callback_and_both_result_delivery_orders() {
        use super::*;
        for buffered in [false, true] {
            let (_dir, cc, run) = continuation_fixture();
            let params = json!({"name":"probe","arguments":{}});
            let callback = cc.mcp_call("synthetic", &params);
            tokio::pin!(callback);
            assert!(
                futures_util::poll!(&mut callback).is_pending(),
                "callback waits for stdout announcement"
            );
            let mut filter = EventFilter {
                done: true,
                stop_reason: Some("tool_use".into()),
                tool_ids: vec!["tool_1".into()],
                ..Default::default()
            };
            cc.finish_turn(&run, &mut filter);
            let early_receiver =
                buffered.then(|| cc.continue_run(&synthetic_tool_result()).unwrap());
            run.announced.lock().unwrap().push_back((
                "tool_1".into(),
                "mcp__thinrouter__probe".into(),
                json!({}),
            ));
            run.announcement_changed.notify_waiters();
            let late_receiver = if !buffered {
                assert!(
                    futures_util::poll!(&mut callback).is_pending(),
                    "matched callback now awaits result"
                );
                Some(cc.continue_run(&synthetic_tool_result()).unwrap())
            } else {
                None
            };
            let reply = tokio::time::timeout(Duration::from_secs(1), callback)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(reply["isError"], false);
            assert_eq!(reply["content"][0]["text"], "synthetic-result");
            assert!(run.calls.lock().unwrap().is_empty());
            assert!(run.results.lock().unwrap().is_empty());
            drop((early_receiver, late_receiver));
        }
    }

    #[tokio::test]
    async fn tc2_missing_announcement_is_bounded_or_cancelled() {
        use super::*;
        for cancelled in [false, true] {
            let (_dir, cc, run) = continuation_fixture();
            let cc = cc.with_idle(Duration::from_millis(20));
            let params = json!({"name":"probe","arguments":{}});
            let callback = cc.mcp_call("synthetic", &params);
            tokio::pin!(callback);
            assert!(futures_util::poll!(&mut callback).is_pending());
            if cancelled {
                run.stop.cancel();
            }
            let reply = tokio::time::timeout(Duration::from_secs(1), callback)
                .await
                .unwrap();
            if cancelled {
                assert!(reply.is_none());
            } else {
                let reply = reply.unwrap();
                assert_eq!(reply["isError"], true);
                assert_eq!(
                    reply["content"][0]["text"],
                    "no matching tool call is pending"
                );
            }
        }
    }

    #[tokio::test]
    async fn tc3_completion_does_not_retire_the_next_requests_sink() {
        use super::*;
        let (_dir, cc, run) = continuation_fixture();
        let (old_tx, mut old_rx) = mpsc::channel(4);
        *run.sink.lock().unwrap() = Some(old_tx);
        let mut filter = EventFilter {
            done: true,
            stop_reason: Some("tool_use".into()),
            tool_ids: vec!["tool_1".into()],
            ..Default::default()
        };
        let retiring = cc.finish_turn(&run, &mut filter).unwrap();
        let mut next_rx = cc.continue_run(&synthetic_tool_result()).unwrap();
        retiring
            .send(Item::Record("old-terminal".into()))
            .await
            .unwrap();
        filter.reset();
        drop(retiring);
        assert!(matches!(old_rx.recv().await, Some(Item::Record(s)) if s == "old-terminal"));
        assert!(old_rx.recv().await.is_none());
        let next = run.sink.lock().unwrap().clone().unwrap();
        next.send(Item::Record("new-turn".into())).await.unwrap();
        assert!(matches!(next_rx.recv().await, Some(Item::Record(s)) if s == "new-turn"));
    }

    #[test]
    fn tc3_unsolicited_completion_retires_all_waiting_tool_state() {
        use super::*;
        for with_sink in [false, true] {
            let (_dir, cc, run) = continuation_fixture();
            let old_receiver = if with_sink {
                let (tx, rx) = mpsc::channel(4);
                *run.sink.lock().unwrap() = Some(tx);
                Some(rx)
            } else {
                None
            };
            *run.pending.lock().unwrap() = vec!["tool_1".into()];
            run.announced.lock().unwrap().push_back((
                "tool_1".into(),
                "mcp__thinrouter__probe".into(),
                json!({}),
            ));
            run.results.lock().unwrap().insert(
                "tool_1".into(),
                ToolResult {
                    text: "unused".into(),
                    is_error: false,
                },
            );
            let (tx, _rx) = oneshot::channel();
            run.calls.lock().unwrap().insert("tool_1".into(), tx);
            cc.live
                .lock()
                .unwrap()
                .waiting
                .insert("tool_1".into(), run.clone());
            let mut filter = EventFilter {
                done: true,
                stop_reason: Some("end_turn".into()),
                ..Default::default()
            };
            assert_eq!(cc.finish_turn(&run, &mut filter).is_some(), with_sink);
            assert!(
                cc.continue_run(&synthetic_tool_result()).is_none(),
                "late result must use existing fallback instead of attaching to an ended phase"
            );
            assert!(run.pending.lock().unwrap().is_empty());
            assert!(run.announced.lock().unwrap().is_empty());
            assert!(run.results.lock().unwrap().is_empty());
            assert!(run.calls.lock().unwrap().is_empty());
            assert!(run.sink.lock().unwrap().is_none());
            assert!(run.idle_now.load(std::sync::atomic::Ordering::SeqCst));
            drop(old_receiver);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn sc2_dropped_startup_future_cleans_directory_child_and_slot() {
        use super::*;
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-claude");
        std::fs::write(&bin, "#!/usr/bin/env python3\nimport os, time\nopen('pid', 'w').write(str(os.getpid()))\nwhile True: time.sleep(60)\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cc = ClaudeCode::new(Some(bin.to_string_lossy().into()), dir.path(), 1);
        let runner = cc.clone();
        let pending = tokio::spawn(async move {
            start(&runner, "sonnet", &json!({"tools":[{"type":"function","function":{"name":"probe","parameters":{"type":"object"}}}],"messages":[{"role":"user","content":"q".repeat(1024*1024)}]}), &CancellationToken::new()).await
        });
        let pid = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Ok(raw) = std::fs::read_to_string(cc.work_dir.join("pid")) {
                    if let Ok(pid) = raw.parse::<u32>() {
                        break pid;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        if pid.is_err() {
            pending.abort();
            let _ = pending.await;
            panic!("fake child did not start");
        }
        let pid = pid.unwrap();
        assert!(!pending.is_finished());
        assert_eq!(cc.runs.available_permits(), 0);
        // No reader has taken ownership: the initial write exceeds pipe capacity.
        assert_eq!(cc.alive.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(
            std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
            1
        );
        pending.abort();
        assert!(pending.await.err().unwrap().is_cancelled());
        assert_eq!(
            std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
            0
        );
        assert_eq!(cc.runs.available_permits(), 1);
        tokio::time::timeout(Duration::from_secs(3), async {
            while std::path::Path::new(&format!("/proc/{pid}")).exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("owned child reaped after future drop");
        let permit = cc.slot(&CancellationToken::new()).await.unwrap();
        assert_eq!(cc.runs.available_permits(), 0);
        drop(permit);
    }

    #[test]
    fn sc1_partial_setup_and_existing_paths_keep_ownership_separate() {
        use super::*;
        let root = tempfile::tempdir().unwrap();
        let existing = root.path().join("runs/existing");
        std::fs::create_dir_all(&existing).unwrap();
        std::fs::write(existing.join("keep"), b"existing").unwrap();
        assert!(RunDir::create(existing.clone()).is_err());
        assert_eq!(std::fs::read(existing.join("keep")).unwrap(), b"existing");
        for partial in ["tools.json", "callback.json", "mcp.json"] {
            let path = root.path().join("runs/partial");
            let result = (|| -> std::io::Result<()> {
                let _owned = RunDir::create(path.clone())?;
                write_private(&path.join(partial), b"synthetic")?;
                // A deterministic setup error after a private file was created.
                write_private(&path.join("missing-parent/file"), b"failure")
            })();
            assert!(result.is_err());
            assert!(!path.exists());
            assert!(existing.join("keep").exists());
        }
        assert_eq!(
            std::fs::read_dir(root.path().join("runs")).unwrap().count(),
            1
        );
    }

    #[tokio::test]
    async fn sc1_spawn_failure_removes_only_its_tool_directory() {
        use super::*;
        let dir = tempfile::tempdir().unwrap();
        let cc = ClaudeCode::new(
            Some(dir.path().join("missing-cli").to_string_lossy().into()),
            dir.path(),
            1,
        );
        let sibling = cc.work_dir.join("runs/keep");
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
        for tool in [true, true, false] {
            let mut chat = json!({"messages":[{"role":"user","content":"hello"}]});
            if tool {
                chat["tools"] = json!([{"type":"function","function":{"name":"probe","parameters":{"type":"object"}}}]);
            }
            let error = match start(&cc, "sonnet", &chat, &CancellationToken::new()).await {
                Err(error) => error,
                Ok(_) => panic!("missing CLI must fail"),
            };
            assert_eq!(error.status, 503);
            assert!(error.retryable);
            assert_eq!(cc.runs.available_permits(), 1);
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1,
                "startup failure leaked a tool directory"
            );
            assert_eq!(std::fs::read(sibling.join("sentinel")).unwrap(), b"keep");
        }
    }

    #[tokio::test]
    async fn bc2_bc3_later_records_entries_boundaries_and_failures() {
        use super::{ClaudeRun, Item};
        use crate::{
            collection::{LIMIT_MESSAGE, MAX_BYTES, MAX_RECORDS},
            error::AppError,
        };
        for (first, count, record, overflow) in [
            (Some(String::new()), 1, "x".repeat(MAX_BYTES - 4), false),
            (Some(String::new()), 1, "x".repeat(MAX_BYTES - 3), true),
            (None, 1, "é".repeat((MAX_BYTES - 2) / 2), false),
            (Some(String::new()), MAX_RECORDS - 1, String::new(), false),
            (Some(String::new()), MAX_RECORDS, String::new(), true),
        ] {
            let (tx, rx) = tokio::sync::mpsc::channel(4);
            let observe = tx.downgrade();
            let producer = tokio::spawn(async move {
                for _ in 0..count {
                    if tx.send(Item::Record(record.clone())).await.is_err() {
                        break;
                    }
                }
                if overflow {
                    tx.closed().await;
                }
            });
            let result = tokio::time::timeout(
                std::time::Duration::from_secs(3),
                ClaudeRun { first, rx }.collect("m"),
            )
            .await
            .unwrap();
            if overflow {
                assert!(
                    matches!(result,Err(AppError::Upstream{status:502,body}) if body == LIMIT_MESSAGE)
                );
            } else {
                assert!(result.is_ok());
            }
            if let Some(tx) = observe.upgrade() {
                assert!(tx.is_closed());
            }
            producer.await.unwrap();
        }
        for status in [401, 429, 502] {
            let (tx, rx) = tokio::sync::mpsc::channel(1);
            tx.send(Item::Failed {
                status,
                message: "explicit CLI failure".into(),
            })
            .await
            .unwrap();
            assert!(
                matches!(ClaudeRun{first:Some(String::new()),rx}.collect("m").await,Err(AppError::Upstream{status:s,body}) if s == status && body == "explicit CLI failure")
            );
            assert!(tx.is_closed());
        }
    }

    #[tokio::test]
    async fn bc2_oversized_first_record_closes_receiver() {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        let run = super::ClaudeRun {
            first: Some("x".repeat(16 * 1024 * 1024 - 1)),
            rx,
        };
        let result = tokio::time::timeout(std::time::Duration::from_secs(1), run.collect("m"))
            .await
            .expect("over-limit first record must fail without waiting for EOF");
        match result {
            Err(crate::error::AppError::Upstream { status: 502, body }) => {
                assert_eq!(body, "upstream response collection limit exceeded")
            }
            other => panic!("unexpected {other:?}"),
        }
        assert!(tx.is_closed());
    }

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
        let args = cli_args("sonnet", None, &[], None);
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
    fn long_history_is_cache_marked_by_block() {
        let mut messages = vec![json!({"role": "system", "content": "sys"})];
        for i in 0..25 {
            messages.push(json!({"role": "user", "content": format!("q{i}")}));
            messages.push(json!({"role": "assistant", "content": format!("a{i}")}));
        }
        messages.push(json!({"role": "user", "content": "now"}));
        let blocks = render_prompt(&json!({"messages": messages}));
        let marked: Vec<usize> = blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| b.get("cache_control").is_some())
            .map(|(i, _)| i)
            .collect();
        assert_eq!(marked.len(), 1, "one mark");
        // 50 history messages → blocks after 20 and 40; the mark is on the second.
        assert_eq!(marked[0], 2);
        assert!(blocks[2]["text"]
            .as_str()
            .unwrap()
            .contains("Assistant: a19"));
        assert_eq!(blocks[2]["cache_control"]["ttl"], "1h");
        // Short conversation: the mark stays on the instructions.
        let short = render_prompt(&json!({"messages": [
            {"role": "system", "content": "sys"}, {"role": "user", "content": "hi"}]}));
        assert!(short[0].get("cache_control").is_some());
        assert!(short[1].get("cache_control").is_none());
    }

    #[test]
    fn turn_rendering_is_the_users_own_words() {
        let blocks = render_turn(&[json!({"role": "user", "content": [
            {"type": "text", "text": "look"},
            {"type": "image_url", "image_url": {"url": "https://x/y.png"}}]})]);
        assert_eq!(blocks[0]["text"], "look");
        assert_eq!(blocks[1]["source"]["url"], "https://x/y.png");
    }

    #[test]
    fn cf1_text_overflow_is_not_forwarded() {
        let mut f = EventFilter::default();
        f.on_event(
            &json!({"type":"content_block_start","index":0,"content_block":{"type":"text"}}),
        );
        let delta =
            json!({"type":"content_block_delta","index":0,"delta":{"text":"x".repeat(1024*1024)}});
        for _ in 0..16 {
            assert_eq!(f.on_event(&delta).len(), 1);
        }
        let overflow = json!({"type":"content_block_delta","index":0,"delta":{"text":"!"}});
        assert!(
            f.on_event(&overflow).is_empty(),
            "over-limit retained text must not be emitted"
        );
        assert!(
            f.reply_text.is_empty(),
            "failed filter releases retained text"
        );
    }

    #[test]
    fn cf1_cf2_payload_boundaries_and_sticky_failure() {
        for kind in ["text", "arguments", "metadata", "reason"] {
            for offset in 0..3 {
                let mut f = EventFilter {
                    names: [("bb".into(), "client".into())].into(),
                    budget: crate::stream_budget::RetainedBudget::limited(16, 10),
                    ..Default::default()
                };
                let event = match kind {
                    "text" => {
                        f.on_event(&json!({"type":"content_block_start","index":0,"content_block":{"type":"text"}}));
                        json!({"type":"content_block_delta","index":0,"delta":{"text":"é".repeat(7+offset)}})
                    }
                    "arguments" => {
                        f.on_event(&json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"bb","id":"i"}}));
                        json!({"type":"content_block_delta","index":0,"delta":{"partial_json":" ".repeat(11+offset)}})
                    }
                    "metadata" => {
                        json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","name":"bb","id":"i".repeat(6+offset)}})
                    }
                    _ => {
                        json!({"type":"message_delta","delta":{"stop_reason":"r".repeat(15+offset)}})
                    }
                };
                let output = f.on_event(&event);
                assert_eq!(f.failed, offset == 2, "{kind}/{offset}");
                if offset == 2 {
                    assert!(output.is_empty());
                    assert!(
                        f.reply_text.is_empty()
                            && f.tools.is_empty()
                            && f.tool_ids.is_empty()
                            && f.map.is_empty()
                            && f.finished_tools.is_empty()
                            && f.stop_reason.is_none()
                    );
                    assert!(f.on_event(&json!({"type":"message_stop"})).is_empty());
                    assert_eq!(f.names["bb"], "client");
                } else {
                    assert_eq!(output.len(), 1);
                    assert_eq!(f.on_event(&json!({"type":"message_stop"})).len(), 1);
                    assert!(f.done);
                }
            }
        }
    }

    #[test]
    fn cf1_cf2_block_starts_include_ignored_and_replaced_indexes() {
        for kind in ["thinking", "text", "tool_use"] {
            for repeated in [false, true] {
                let mut f = EventFilter {
                    names: [("bb".into(), "client".into())].into(),
                    budget: crate::stream_budget::RetainedBudget::limited(100, 2),
                    ..Default::default()
                };
                for n in 0..3 {
                    let out=f.on_event(&json!({"type":"content_block_start","index":if repeated {0} else {n},"content_block":{"type":kind,"id":"i","name":"bb"}}));
                    assert_eq!(f.failed, n == 2);
                    assert_eq!(out.len(), usize::from(n < 2 && kind != "thinking"));
                }
                assert!(f.map.is_empty() && f.tools.is_empty() && f.tool_ids.is_empty());
            }
        }
        // Exercise the production block cap and reset across two healthy messages.
        let mut f = EventFilter::default();
        for _ in 0..2 {
            for index in 0..4096 {
                f.on_event(&json!({"type":"content_block_start","index":index,"content_block":{"type":"thinking"}}));
                assert!(!f.failed);
            }
            assert_eq!(f.on_event(&json!({"type":"message_stop"})).len(), 1);
            assert!(f
                .on_event(&json!({"type":"content_block_start"}))
                .is_empty());
            f.reset();
        }
        for index in 0..4097 {
            f.on_event(&json!({"type":"content_block_start","index":index,"content_block":{"type":"thinking"}}));
        }
        assert!(f.failed && f.map.is_empty());
    }

    #[test]
    fn cf2_interleaved_tools_moves_and_unretained_payload() {
        let mut f = EventFilter {
            names: [("bb".into(), "client".into())].into(),
            budget: crate::stream_budget::RetainedBudget::limited(16, 3),
            ..Default::default()
        };
        for (index, id) in [(0, "a"), (1, "b")] {
            let output=f.on_event(&json!({"type":"content_block_start","index":index,"content_block":{"type":"tool_use","id":id,"name":"bb"}}));
            assert!(output[0].contains("client"));
        }
        for index in [1, 0] {
            for fragment in ["{", "}"] {
                f.on_event(&json!({"type":"content_block_delta","index":index,"delta":{"partial_json":fragment}}));
            }
            f.on_event(&json!({"type":"content_block_stop","index":index}));
        }
        f.on_event(
            &json!({"type":"content_block_start","index":2,"content_block":{"type":"text"}}),
        );
        f.on_event(&json!({"type":"content_block_delta","index":2,"delta":{"text":"é"}}));
        f.on_event(&json!({"type":"message_delta","delta":{"stop_reason":"ok"}}));
        assert!(!f.failed);
        assert_eq!(f.finished_tools.len(), 2);
        assert_eq!(f.finished_tools[0], ("b".into(), "bb".into(), json!({})));
        assert_eq!(f.tool_ids, vec!["a", "b"]);
        assert_eq!(f.reply_text, "é");
        // Moving completed tools out does not refund their charge.
        f.finished_tools.clear();
        assert!(f
            .on_event(&json!({"type":"message_delta","delta":{"stop_reason":"!"}}))
            .is_empty());
        assert!(f.failed);
        f.reset();
        assert_eq!(f.names["bb"], "client");
        assert!(!f.failed);
        f.budget = crate::stream_budget::RetainedBudget::limited(0, 1);
        f.on_event(
            &json!({"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}),
        );
        f.on_event(&json!({"type":"content_block_delta","index":0,"delta":{"text":"ignored","partial_json":"ignored"}}));
        f.on_event(
            &json!({"type":"content_block_delta","index":99,"delta":{"partial_json":"unmatched"}}),
        );
        assert!(!f.failed && f.reply_text.is_empty() && f.tools.is_empty());
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

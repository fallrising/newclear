//! Claude subscription through the real Claude Code CLI (interactive TUI or print).
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

use crate::claude_usage::{Attempt, RequestContext};
use crate::error::AppError;
use crate::proxy::UpstreamAttemptError;

/// The server selects TUI by default; print remains an explicit compatibility mode.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Mode {
    Tui,
    Print,
}

/// Process settings and live runs shared by every request.
#[derive(Clone)]
pub struct ClaudeCode {
    /// `claude` executable (PATH lookup when bare).
    pub bin: String,
    pub mode: Mode,
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
    /// Accounting is bound to the same channel as the current reply, never the process.
    accounting: Mutex<Option<(mpsc::WeakSender<Item>, Attempt)>>,
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
    /// Latched only after the reader has released all owned resources.
    cleaned: CancellationToken,
    /// Interrupted input or active reply ownership must never become reusable or shelved.
    interrupted_input: std::sync::atomic::AtomicBool,
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

/// Retire the selected run when input or first-reply ownership is interrupted.
struct ResumeInputGuard(Option<Arc<LiveRun>>);

/// Covers the interval before the reader owns the initial reply. Dropping a
/// startup future must settle its reservation even when no LiveRun exists yet.
struct StartupAccounting(Option<Attempt>);

impl Drop for StartupAccounting {
    fn drop(&mut self) {
        if let Some(attempt) = &self.0 {
            attempt.stop("cancelled", "stream_cancelled");
        }
    }
}

impl Drop for ResumeInputGuard {
    fn drop(&mut self) {
        if let Some(run) = &self.0 {
            run.interrupted_input
                .store(true, std::sync::atomic::Ordering::SeqCst);
            run.idle_now
                .store(false, std::sync::atomic::Ordering::SeqCst);
            run.stop.cancel();
        }
    }
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
            // Keep this internal constructor compatible with direct print fixtures.
            // AppConfig/server owns the operator-facing default and always sets it.
            mode: Mode::Print,
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

    pub fn with_mode(mut self, mode: Mode) -> Self {
        self.mode = mode;
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
        let deadline =
            Instant::now() + Duration::from_secs(if self.mode == Mode::Tui { 7 } else { 6 });
        while self.alive.load(std::sync::atomic::Ordering::SeqCst) > 0 && Instant::now() < deadline
        {
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }

    /// End this completed phase at its idle deadline unless it was used again.
    fn expire_later(&self, run: &Arc<LiveRun>, since: Instant) {
        let (run, idle, live) = (run.clone(), self.idle, self.live.clone());
        tokio::spawn(async move {
            tokio::time::sleep_until(tokio::time::Instant::from_std(since + idle)).await;
            // Serialize the expiry decision with both kinds of new-sink admission.
            // The captured phase cannot expire a later completed or active turn.
            let _live = live.lock().unwrap();
            if *run.waiting_since.lock().unwrap() == Some(since) {
                debug!("Claude Code run idle too long; ending it");
                run.stop.cancel();
            }
        });
    }

    /// If `chat` only adds user messages to the conversation an idle run has, write
    /// them to it and return a sink for its reply.
    async fn resume_run(
        &self,
        model: &str,
        chat: &Value,
        cancel: &CancellationToken,
        context: Option<&RequestContext>,
    ) -> Result<Option<(Arc<LiveRun>, ReplyReceiver)>, UpstreamAttemptError> {
        let sig = signature(model, chat);
        let msgs = convo(chat);
        let normed: Vec<Value> = msgs.iter().map(norm).collect();
        let (run, start, rx) = {
            let mut live = self.live.lock().unwrap();
            let Some(pos) = live.idle.iter().position(|r| {
                let known = r.known.lock().unwrap();
                !r.stop.is_cancelled()
                    && !r
                        .interrupted_input
                        .load(std::sync::atomic::Ordering::SeqCst)
                    && r.signature == sig
                    && known.len() < normed.len()
                    && normed[..known.len()] == known[..]
                    && msgs[known.len()..]
                        .iter()
                        .all(|m| m.get("role").and_then(|r| r.as_str()) == Some("user"))
            }) else {
                return Ok(None);
            };
            let accounting = context.map(RequestContext::begin).transpose()?;
            let run = live.idle.remove(pos);
            live.order.retain(|r| !Arc::ptr_eq(r, &run));
            let start = run.known.lock().unwrap().len();
            run.idle_now
                .store(false, std::sync::atomic::Ordering::SeqCst);
            let (tx, rx) = reply_channel_observed(accounting);
            install_reply(&run, tx, rx.accounting.clone());
            *run.waiting_since.lock().unwrap() = None;
            *run.known.lock().unwrap() = normed;
            run.sink_changed.notify_one();
            debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "resume_user_sink");
            (run, start, rx)
        };
        let mut guard = ResumeInputGuard(Some(run.clone()));
        let accounting = rx.accounting.clone();
        let line = json!({"type": "user", "message": {"role": "user", "content": render_turn(&msgs[start..])}});
        let input = format!("{line}\n");
        let written = tokio::select! {
            biased;
            _ = cancel.cancelled() => None,
            written = async {
                match run.stdin.lock().await.as_mut() {
                    Some(stdin) => stdin.write_all(input.as_bytes()).await.is_ok(),
                    None => false,
                }
            } => Some(written),
        };
        match written {
            None => {
                if let Some(attempt) = &accounting {
                    attempt.stop("cancelled", "stream_cancelled");
                }
                // The select's write future (and mutex guard) is gone before cleanup.
                drop(guard);
                drop(rx);
                run.cleaned.cancelled().await;
                Err(UpstreamAttemptError {
                    status: 499,
                    body: "client disconnected".into(),
                    retryable: false,
                })
            }
            Some(false) => {
                if let Some(attempt) = &accounting {
                    attempt.stop("failed", "upstream_attempt_failed");
                }
                clear_reply(&run);
                Ok(None)
            }
            Some(true) => {
                guard.0 = None;
                Ok(Some((run, rx)))
            }
        }
    }

    /// A slot for a new run; when none is free, the oldest waiting run is ended.
    async fn slot(&self, cancel: &CancellationToken) -> Option<OwnedSemaphorePermit> {
        if cancel.is_cancelled() {
            return None;
        }
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
    #[cfg(test)]
    fn continue_run(&self, chat: &Value) -> Option<(Arc<LiveRun>, ReplyReceiver)> {
        self.continue_run_observed(chat, None).unwrap()
    }

    fn continue_run_observed(
        &self,
        chat: &Value,
        context: Option<&RequestContext>,
    ) -> Result<Option<(Arc<LiveRun>, ReplyReceiver)>, UpstreamAttemptError> {
        let Some(results) = trailing_tool_results(chat) else {
            return Ok(None);
        };
        let known = convo(chat).iter().map(norm).collect();
        let mut live = self.live.lock().unwrap();
        let Some(run) = live.waiting.get(&results[0].0).cloned() else {
            return Ok(None);
        };
        if run.stop.is_cancelled()
            || run
                .interrupted_input
                .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Ok(None);
        }
        let pending = run.pending.lock().unwrap().clone();
        let mut want: Vec<&String> = pending.iter().collect();
        let mut got: Vec<&String> = results.iter().map(|(id, _)| id).collect();
        want.sort();
        got.sort();
        if want != got {
            return Ok(None);
        }
        let accounting = context.map(RequestContext::begin).transpose()?;
        for id in &pending {
            live.waiting.remove(id);
        }
        live.order.retain(|r| !Arc::ptr_eq(r, &run));
        // Completion and new-sink installation share the live lock. A completed
        // phase cannot publish stale waiting entries or overwrite this receiver.
        let (tx, rx) = reply_channel_observed(accounting);
        install_reply(&run, tx, rx.accounting.clone());
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
        Ok(Some((run, rx)))
    }

    /// Detach this message's sender before making the run reusable. Retire a
    /// completed tool phase even if its client has already gone away.
    fn finish_turn(
        &self,
        run: &Arc<LiveRun>,
        filter: &mut EventFilter,
    ) -> Option<mpsc::Sender<Item>> {
        let mut live = self.live.lock().unwrap();
        let tx = clear_reply(run);
        if run
            .interrupted_input
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return tx;
        }
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
        let since = Instant::now();
        *run.waiting_since.lock().unwrap() = Some(since);
        live.order.push_back(run.clone());
        // Delivery of the detached terminal may remain backpressured indefinitely.
        self.expire_later(run, since);
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

/// Created alongside the sender, before that sender can be detached/reused.
/// Reading LiveRun.sink later could accidentally bind an old receiver to a new turn.
struct ReplyReceiver {
    rx: mpsc::Receiver<Item>,
    sink: mpsc::WeakSender<Item>,
    accounting: Option<Attempt>,
}

#[cfg(test)]
fn reply_channel() -> (mpsc::Sender<Item>, ReplyReceiver) {
    reply_channel_observed(None)
}

fn reply_channel_observed(accounting: Option<Attempt>) -> (mpsc::Sender<Item>, ReplyReceiver) {
    let (tx, rx) = mpsc::channel(64);
    let sink = tx.downgrade();
    (
        tx,
        ReplyReceiver {
            rx,
            sink,
            accounting,
        },
    )
}

fn install_reply(run: &LiveRun, tx: mpsc::Sender<Item>, accounting: Option<Attempt>) {
    let mut sink = run.sink.lock().unwrap();
    *run.accounting.lock().unwrap() = accounting.map(|attempt| (tx.downgrade(), attempt));
    *sink = Some(tx);
}

fn clear_reply(run: &LiveRun) -> Option<mpsc::Sender<Item>> {
    let mut sink = run.sink.lock().unwrap();
    let tx = sink.take();
    run.accounting.lock().unwrap().take();
    tx
}

/// Snapshot both identities under the sink lock. A detached terminal retains its
/// own clone and never consults a newer reply's accounting after publishing reuse.
fn active_reply(run: &LiveRun) -> (Option<mpsc::Sender<Item>>, Option<Attempt>) {
    let sink = run.sink.lock().unwrap();
    let accounting = run.accounting.lock().unwrap();
    let attempt = accounting.as_ref().and_then(|(owner, attempt)| {
        owner
            .upgrade()
            .filter(|owner| {
                sink.as_ref()
                    .is_some_and(|current| current.same_channel(owner))
            })
            .map(|_| attempt.clone())
    });
    (sink.clone(), attempt)
}

/// Cancellation belongs to one request sink, not to the reusable process. A weak
/// sender identifies the sink without holding its EOF open after completion.
struct OutputCancellation {
    run: Arc<LiveRun>,
    sink: mpsc::WeakSender<Item>,
    cancel: CancellationToken,
}

impl OutputCancellation {
    fn stop_if_active(&self) -> bool {
        // finish_turn detaches the sender under this same lock before publishing
        // reuse. Mark interruption before releasing it so completion cannot park
        // a cancelled turn, and an old response can never stop a newer sink.
        let sink = self.run.sink.lock().unwrap();
        let active = self.sink.upgrade().is_some_and(|owned| {
            sink.as_ref()
                .is_some_and(|current| current.same_channel(&owned))
        });
        if active {
            self.run
                .interrupted_input
                .store(true, std::sync::atomic::Ordering::SeqCst);
            self.run
                .idle_now
                .store(false, std::sync::atomic::Ordering::SeqCst);
            self.run.stop.cancel();
        }
        active
    }
}

/// A started run: Anthropic Messages SSE records (`event: ...\ndata: ...`).
pub struct ClaudeRun {
    first: Option<String>,
    rx: mpsc::Receiver<Item>,
    output: Option<OutputCancellation>,
    accounting: Option<Attempt>,
}

impl ClaudeRun {
    pub fn accounting(&self) -> Option<Attempt> {
        self.accounting.clone()
    }

    /// Observe cancellation while the response is being consumed, including a
    /// pending receive. Merely retaining an unpolled response is not a watcher.
    async fn next(&mut self) -> Option<Item> {
        if let Some(output) = self.output.as_ref() {
            tokio::select! {
                biased;
                _ = output.cancel.cancelled() => {},
                item = async {
                    match self.first.take() {
                        Some(first) => Some(Item::Record(first)),
                        None => self.rx.recv().await,
                    }
                } => return item,
            }
            let output = self.output.take().unwrap();
            if output.stop_if_active() {
                if let Some(attempt) = &self.accounting {
                    attempt.stop("cancelled", "stream_cancelled");
                }
                self.first = None;
                // Closing before awaiting cleanup also wakes a producer blocked
                // on a full channel; no cancellation waits behind backpressure.
                self.rx.close();
                output.run.cleaned.cancelled().await;
                return Some(Item::Failed {
                    status: 499,
                    message: "client disconnected".into(),
                });
            }
            // This request already detached. Preserve its queued completion and
            // leave any newly installed request's ownership untouched.
        }
        match self.first.take() {
            Some(first) => Some(Item::Record(first)),
            None => self.rx.recv().await,
        }
    }

    /// SSE byte stream (records separated by blank lines).
    pub fn into_stream(mut self) -> impl Stream<Item = Result<Bytes, std::io::Error>> + Send {
        async_stream::stream! {
            while let Some(item) = self.next().await {
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
    pub async fn collect(mut self, model: &str) -> Result<Bytes, AppError> {
        let mut records = crate::collection::Records::default();
        while let Some(item) = self.next().await {
            match item {
                Item::Record(r) => {
                    if let Err(error) = records.push(r) {
                        // Settle before dropping the receiver: otherwise the
                        // producer can mistake this collection failure for a
                        // caller cancellation and win the once-only finalizer.
                        if let Some(accounting) = &self.accounting {
                            accounting.converted_terminal(true);
                        }
                        return Err(error);
                    }
                }
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
async fn stop(mut child: Child, mode: Mode) {
    #[cfg(unix)]
    if let Some(pid) = child.id() {
        // SAFETY: plain kill(2) on our own child's pid.
        unsafe {
            libc::kill(pid as i32, libc::SIGTERM);
        }
    }
    if tokio::time::timeout(
        Duration::from_secs(if mode == Mode::Tui { 6 } else { 5 }),
        child.wait(),
    )
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
            output: None,
            accounting: None,
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

/// Own this request's selected run, transferring active-output cancellation at handoff. Cursor
/// still uses `first_record` directly; its cancellation policy is independent.
async fn first_reply(
    run: Arc<LiveRun>,
    reply: ReplyReceiver,
    cancel: &CancellationToken,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    let ReplyReceiver {
        rx,
        sink,
        accounting,
    } = reply;
    let mut guard = ResumeInputGuard(Some(run.clone()));
    let output = Some(OutputCancellation {
        run: run.clone(),
        sink,
        cancel: cancel.clone(),
    });
    let result = tokio::select! {
        biased;
        _ = cancel.cancelled() => None,
        result = first_record(rx) => Some(result),
    };
    match result {
        None => {
            if let Some(attempt) = &accounting {
                attempt.stop("cancelled", "stream_cancelled");
            }
            // The receiver has been dropped before waiting for latched cleanup.
            drop(guard);
            run.cleaned.cancelled().await;
            Err(UpstreamAttemptError {
                status: 499,
                body: "client disconnected".into(),
                retryable: false,
            })
        }
        Some(result) => {
            // Preserve ordinary errors and their existing cleanup/fallback timing.
            guard.0 = None;
            match result {
                Ok(mut response) => {
                    response.output = output;
                    response.accounting = accounting;
                    Ok(response)
                }
                Err(error) => {
                    if let Some(attempt) = &accounting {
                        attempt.stop("failed", "upstream_attempt_failed");
                    }
                    Err(error)
                }
            }
        }
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
#[cfg(test)]
pub async fn start(
    cc: &ClaudeCode,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    start_observed(cc, model, chat, cancel, None).await
}

pub async fn start_observed(
    cc: &ClaudeCode,
    model: &str,
    chat: &Value,
    cancel: &CancellationToken,
    context: Option<&RequestContext>,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    // Reject before consuming a pending tool result or taking an idle process.
    if cancel.is_cancelled() {
        return Err(UpstreamAttemptError {
            status: 499,
            body: "client disconnected".into(),
            retryable: false,
        });
    }
    if let Some((run, rx)) = cc.continue_run_observed(chat, context)? {
        debug!("tool results go on in the waiting Claude Code run");
        return first_reply(run, rx, cancel).await;
    }
    if let Some((run, rx)) = cc.resume_run(model, chat, cancel, context).await? {
        debug!("the next turn goes on in the idle Claude Code run");
        return first_reply(run, rx, cancel).await;
    }
    // A new process is now selected. Reserve before shelf_take removes a saved
    // session entry, so a storage refusal cannot orphan that reusable session.
    let accounting = context.map(RequestContext::begin).transpose()?;
    if let Some(saved) = cc.unshelve(model, chat) {
        return match spawn_run(cc, model, chat, cancel, Some(saved), accounting).await {
            Ok(run) => {
                debug!("the next turn goes on from a saved Claude Code session");
                Ok(run)
            }
            Err(e) if !cancel.is_cancelled() && e.body != "usage reservation failed" => {
                debug!(
                    status = e.status,
                    "saved session not resumable; a new run is told the conversation"
                );
                let accounting = context.map(RequestContext::begin).transpose()?;
                spawn_run(cc, model, chat, cancel, None, accounting).await
            }
            Err(e) => Err(e),
        };
    }
    spawn_run(cc, model, chat, cancel, None, accounting).await
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

/// Own a new child until the reader takes over. Tokio's kill-on-drop kills
/// promptly but only reaps orphaned children on a best-effort basis. A dropped
/// HTTP handler must retain a waiter as well, even while its first write blocks.
struct StartupChild(Option<Child>);

impl StartupChild {
    fn get_mut(&mut self) -> &mut Child {
        self.0.as_mut().expect("startup child not yet handed off")
    }

    fn take(&mut self) -> Child {
        self.0.take().expect("startup child handed off once")
    }
}

impl Drop for StartupChild {
    fn drop(&mut self) {
        if let Some(mut child) = self.0.take() {
            // Preserve the existing immediate kill on abandoned startup. Keep
            // ownership through wait so a quiet gateway does not retain zombies.
            let _ = child.start_kill();
            if let Ok(runtime) = tokio::runtime::Handle::try_current() {
                runtime.spawn(async move {
                    let _ = child.wait().await;
                });
            }
            // Without a running runtime, Child's kill_on_drop remains the
            // teardown fallback; Drop must not panic trying to spawn a task.
        }
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
    accounting: Option<Attempt>,
) -> Result<ClaudeRun, UpstreamAttemptError> {
    // Own the reservation before acquiring capacity (which may evict a waiting
    // process), creating tool files, spawning a child, or writing any input.
    let mut startup_accounting = StartupAccounting(accounting.clone());
    let fail = |status: u16, body: String, retryable: bool| {
        if let Some(attempt) = &accounting {
            if status == 499 {
                attempt.stop("cancelled", "stream_cancelled");
            } else {
                attempt.stop("failed", "upstream_attempt_failed");
            }
        }
        UpstreamAttemptError {
            status,
            body,
            retryable,
        }
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

    let mut cmd = match cc.mode {
        Mode::Print => Command::new(&cc.bin),
        Mode::Tui => {
            let executable = std::env::current_exe()
                .map_err(|_| fail(503, "cannot locate Claude TUI helper".into(), false))?;
            let mut command = Command::new(executable);
            command.arg("claude-tui-helper").arg("--").arg(&cc.bin);
            // Only the helper's owned tap may instrument the interactive child.
            // Remove loaders before launching the helper, not only inside it.
            for key in [
                "BUN_OPTIONS",
                "NODE_OPTIONS",
                "LD_PRELOAD",
                "DYLD_INSERT_LIBRARIES",
            ] {
                command.env_remove(key);
            }
            command
        }
    };
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
    let mut child = StartupChild(Some(cmd.spawn().map_err(|e| {
        fail(
            503,
            format!(
                "cannot start Claude Code ({}): {e}; install it and run `claude` once to sign in",
                cc.bin
            ),
            true,
        )
    })?));

    let content = match &resume {
        Some((_, n)) => render_turn(&convo(chat)[*n..]),
        None => render_prompt(chat),
    };
    let line = json!({"type": "user", "message": {"role": "user", "content": content}});
    let mut stdin = child.get_mut().stdin.take().expect("piped stdin");
    let stdout = child.get_mut().stdout.take().expect("piped stdout");
    let mut diagnostics =
        crate::cli_stderr::Drain::new(child.get_mut().stderr.take().expect("piped stderr"));
    let input = format!("{line}\n");
    let written = tokio::select! {
        biased;
        _ = cancel.cancelled() => {
            debug!(target: "thinrouter::claude_lifecycle", stage = "startup_input_cancelled");
            // A partial write cannot be replayed safely. Retire this new child
            // with the existing grace period before returning a non-retryable error.
            stop(child.take(), cc.mode).await;
            diagnostics.stop().await;
            return Err(fail(499, "client disconnected".into(), false));
        },
        result = stdin.write_all(input.as_bytes()) => result,
    };
    if let Err(e) = written {
        stop(child.take(), cc.mode).await;
        diagnostics.stop().await;
        return Err(fail(502, format!("Claude Code input: {e}"), true));
    }

    let child = child.take();
    let (tx, rx) = reply_channel_observed(accounting);
    static NEXT_TRACE_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);
    let run = Arc::new(LiveRun {
        trace_id: NEXT_TRACE_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
        token: token.clone(),
        sink: Mutex::new(Some(tx)),
        accounting: Mutex::new(
            rx.accounting
                .clone()
                .map(|attempt| (rx.sink.clone(), attempt)),
        ),
        sink_changed: tokio::sync::Notify::new(),
        announced: Mutex::new(VecDeque::new()),
        announcement_changed: tokio::sync::Notify::new(),
        pending: Mutex::new(Vec::new()),
        results: Mutex::new(HashMap::new()),
        calls: Mutex::new(HashMap::new()),
        stop: CancellationToken::new(),
        cleaned: CancellationToken::new(),
        interrupted_input: std::sync::atomic::AtomicBool::new(false),
        waiting_since: Mutex::new(None),
        stdin: tokio::sync::Mutex::new(Some(stdin)),
        signature: signature(model, chat),
        known: Mutex::new(convo(chat).iter().map(norm).collect()),
        session_id: Mutex::new(resume.as_ref().map(|(sid, _)| sid.clone())),
        idle_now: std::sync::atomic::AtomicBool::new(false),
    });
    cc.live.lock().unwrap().by_token.insert(token, run.clone());

    // First-reply ownership hands this request's cancellation to its consumer.
    let first_run = run.clone();
    cc.alive.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    let cc = cc.clone();
    tokio::spawn(async move {
        let _permit = permit;
        let mut lines = crate::cli_lines::Lines::new(BufReader::new(stdout));
        let mut limit_failure = None;
        let mut cancelled = false;
        let mut sent = false;
        let mut filter = EventFilter {
            names,
            ..Default::default()
        };
        let sink = |run: &LiveRun| run.sink.lock().unwrap().clone();
        'read: loop {
            // An active receiver can disappear while stdout stays silent. Between
            // completed turns there is no sink; retain the reusable process then.
            let (active_sink, _) = active_reply(&run);
            let disconnected = async {
                match active_sink.as_ref() {
                    Some(tx) => tx.closed().await,
                    None => std::future::pending::<()>().await,
                }
            };
            let next = tokio::select! {
                _ = run.sink_changed.notified() => continue,
                _ = disconnected => { cancelled = true; break; },
                _ = run.stop.cancelled() => { cancelled = true; break; },
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
            let (_, active_accounting) = active_reply(&run);
            match env.get("type").and_then(|t| t.as_str()) {
                Some("stream_event") => {
                    let Some(ev) = env.get("event") else { continue };
                    let records = filter.on_event(ev);
                    if let Some(attempt) = &active_accounting {
                        // Decide readiness using accepted records, then observe the
                        // untouched source event before delivery or conversion. In
                        // particular ready must precede an already-queued terminal.
                        if !records.is_empty() {
                            attempt.ready();
                        }
                        attempt.observe_filtered_event(ev, !records.is_empty());
                    }
                    if filter.failed {
                        if let Some(attempt) = &active_accounting {
                            attempt.converted_terminal(true);
                        }
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
                            // Run stop also owns a send blocked by backpressure,
                            // including a completed sender detached for reuse.
                            let delivered = tokio::select! {
                                biased;
                                _ = run.stop.cancelled() => break 'read,
                                delivered = tx.send(Item::Record(rec)) => delivered,
                            };
                            if delivered.is_err() {
                                // A completed turn detached before publishing reuse.
                                // Dropping its queued terminal cannot own a later turn.
                                if !filter.done {
                                    cancelled = true;
                                    break 'read;
                                }
                                break;
                            }
                        }
                    } else {
                        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_no_sink", done = filter.done);
                    }
                    if filter.done {
                        // Reset even an unsolicited completion. Do not clear the
                        // next request's sender or reschedule its idle deadline.
                        filter.reset();
                    }
                }
                Some("result") => {
                    let failed = env.get("is_error").and_then(|e| e.as_bool()) == Some(true)
                        || env.get("subtype").and_then(|s| s.as_str()) != Some("success");
                    // A successful turn ends with a result; the run lives on.
                    if !failed {
                        continue;
                    }
                    if let Some(attempt) = &active_accounting {
                        attempt.stop("failed", "stream_error");
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
                            tokio::select! {
                                biased;
                                _ = run.stop.cancelled() => {},
                                _ = tx.send(Item::Failed {
                                    status: status_for(&msg),
                                    message: format!("Claude Code: {msg}"),
                                }) => {},
                            }
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
        // A process-wide `sent` bit does not describe a reused reply. Settle the
        // current channel on every exit, even if an earlier request had output.
        let (_, unfinished_accounting) = active_reply(&run);
        if let Some(attempt) = &unfinished_accounting {
            if limit_failure.is_some() {
                attempt.stop("failed", "stream_observer_invalid");
            } else if cancelled || run.stop.is_cancelled() {
                attempt.stop("cancelled", "stream_cancelled");
            } else {
                attempt.eof();
            }
        }
        // Hold the active sender across cleanup so the client cannot observe EOF
        // as success, and deliver limit failures only after the process/slot are freed.
        let failure_sink = limit_failure.and_then(|message| sink(&run).map(|tx| (tx, message)));
        if let Some(tx) = sink(&run) {
            if limit_failure.is_none() && !sent && !run.stop.is_cancelled() {
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
                tokio::select! {
                    biased;
                    _ = run.stop.cancelled() => {},
                    _ = tx.send(Item::Failed {
                        status: status_for(&tail),
                        message: msg,
                    }) => {},
                }
            }
        }
        debug!(target: "thinrouter::claude_lifecycle", run_id = run.trace_id, stage = "reader_cleanup");
        cc.forget(&run);
        run.stop.cancel();
        clear_reply(&run);
        stop(child, cc.mode).await;
        diagnostics.stop().await;
        // An idle run's session is kept for its next turn; any other run's is removed.
        let idle = run.idle_now.load(std::sync::atomic::Ordering::SeqCst);
        if !(idle
            && !run
                .interrupted_input
                .load(std::sync::atomic::Ordering::SeqCst)
            && cc.shelve(&run))
        {
            if let Some(sid) = run.session_id.lock().unwrap().clone() {
                cc.remove_session(&sid);
            }
        }
        cc.alive.fetch_sub(1, std::sync::atomic::Ordering::SeqCst);
        drop(run_dir);
        drop(_permit);
        run.cleaned.cancel();
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

    startup_accounting.0 = None;
    first_reply(first_run, rx, cancel).await
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
    fn usage_context(store: &crate::store::Store, request: &str) -> super::RequestContext {
        let connection = serde_json::from_value(serde_json::json!({
            "id":"synthetic","name":"synthetic","base_url":"http://127.0.0.1:1/v1",
            "api_key":"synthetic","default_model":null,"priority":0,"enabled":true,
            "input_price_per_m":null,"output_price_per_m":null,"auth_type":"api_key","oauth":null,
            "created_at":"synthetic","updated_at":"synthetic"
        }))
        .unwrap();
        super::RequestContext::new(
            store,
            request,
            "public",
            &crate::store::ResolvedTarget {
                connection,
                upstream_model: "sonnet".into(),
            },
        )
    }

    fn refuse_usage_reservations(path: &std::path::Path) {
        rusqlite::Connection::open(path)
            .unwrap()
            .execute_batch(
                "CREATE TRIGGER refuse_usage BEFORE INSERT ON usage_events
             BEGIN SELECT RAISE(FAIL, 'synthetic reservation refusal'); END;",
            )
            .unwrap();
    }

    #[tokio::test]
    async fn cs1_reservation_failure_preserves_tool_results_and_capacity() {
        let (dir, cc, run) = continuation_fixture();
        let path = dir.path().join("usage.db");
        let store = crate::store::Store::open(&path, None).unwrap();
        let context = usage_context(&store, "request");
        refuse_usage_reservations(&path);
        run.pending.lock().unwrap().push("tool_1".into());
        cc.live
            .lock()
            .unwrap()
            .waiting
            .insert("tool_1".into(), run.clone());
        cc.live.lock().unwrap().order.push_back(run.clone());
        let permit = cc.runs.clone().acquire_owned().await.unwrap();
        for chat in [
            synthetic_tool_result(),
            json!({"messages":[{"role":"user","content":"fresh"}]}),
        ] {
            let error = match start_observed(
                &cc,
                "sonnet",
                &chat,
                &CancellationToken::new(),
                Some(&context),
            )
            .await
            {
                Err(error) => error,
                Ok(_) => panic!("reservation refusal admitted a request"),
            };
            assert_eq!(
                (error.status, error.body.as_str(), error.retryable),
                (503, "usage reservation failed", false)
            );
            assert_eq!(*run.pending.lock().unwrap(), ["tool_1"]);
            assert!(cc.live.lock().unwrap().waiting.contains_key("tool_1"));
            assert_eq!(cc.live.lock().unwrap().order.len(), 1);
            assert!(run.sink.lock().unwrap().is_none());
            assert!(run.results.lock().unwrap().is_empty());
            assert!(
                !run.stop.is_cancelled(),
                "reservation failure must not evict the waiting run"
            );
            assert!(!cc.work_dir.exists());
        }
        assert!(store.recent_usage(10).unwrap().is_empty());
        drop(permit);
    }

    #[tokio::test]
    async fn cs3_detached_reply_accounting_does_not_adopt_next_sink() {
        let (dir, cc, run) = continuation_fixture();
        let store = crate::store::Store::open(&dir.path().join("usage.db"), None).unwrap();
        let old = usage_context(&store, "old-request").begin().unwrap();
        let (tx, old_reply) = reply_channel_observed(Some(old.clone()));
        install_reply(&run, tx, Some(old.clone()));
        old.ready();
        old.observe_event(&json!({"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":0,"cache_creation_input_tokens":0}}}));
        old.observe_event(&json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":5}}));
        old.observe_event(&json!({"type":"message_stop"}));
        let mut filter = EventFilter {
            done: true,
            stop_reason: Some("tool_use".into()),
            tool_ids: vec!["tool_1".into()],
            ..Default::default()
        };
        let retiring = cc.finish_turn(&run, &mut filter).unwrap();
        let next_context = usage_context(&store, "next-request");
        let (_, next_reply) = cc
            .continue_run_observed(&synthetic_tool_result(), Some(&next_context))
            .unwrap()
            .unwrap();
        retiring
            .send(Item::Record(
                "event: message_stop\ndata: {\"type\":\"message_stop\"}".into(),
            ))
            .await
            .unwrap();
        drop(retiring);
        let old_response = first_reply(run.clone(), old_reply, &CancellationToken::new())
            .await
            .unwrap();
        old_response
            .accounting()
            .unwrap()
            .stop("cancelled", "stream_cancelled");
        let rows = store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 2);
        let old_row = rows
            .iter()
            .find(|row| row.request_id.as_deref() == Some("old-request"))
            .unwrap();
        assert_eq!(old_row.outcome, "succeeded");
        assert_eq!(old_row.completion_tokens, Some(5));
        let next_row = rows
            .iter()
            .find(|row| row.request_id.as_deref() == Some("next-request"))
            .unwrap();
        assert!(next_row.finalized_at.is_none());
        assert!(!run.stop.is_cancelled());
        next_reply
            .accounting
            .as_ref()
            .unwrap()
            .stop("cancelled", "stream_cancelled");
        clear_reply(&run);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn cs1_saved_resume_and_existing_fallback_have_distinct_attempts() {
        let (_dir, cc, chat, token) = first_reply_fixture("saved_error", false).await;
        let store = cc.store.as_ref().unwrap();
        let context = usage_context(store, "saved-request");
        let response = tokio::time::timeout(
            Duration::from_secs(3),
            start_observed(&cc, "sonnet", &chat, &token, Some(&context)),
        )
        .await;
        if response.is_err() {
            cc.shutdown().await;
        }
        let response = response.unwrap().unwrap();
        let accounting = response.accounting().unwrap();
        response.collect("sonnet").await.unwrap();
        accounting.eof();
        cc.shutdown().await;
        let rows = store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .all(|row| row.request_id.as_deref() == Some("saved-request")));
        assert_ne!(rows[0].attempt_id, rows[1].attempt_id);
        assert_eq!(rows.iter().filter(|row| row.outcome == "failed").count(), 1);
        assert_eq!(
            rows.iter().filter(|row| row.outcome == "succeeded").count(),
            1
        );
        assert_eq!(
            std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
            "resume\nfresh\n"
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn cs1_reservation_failure_does_not_consume_saved_session() {
        let (dir, cc, chat, token) = first_reply_fixture("saved_error", false).await;
        let store = cc.store.as_ref().unwrap();
        let before = store.shelf_ids().unwrap();
        assert_eq!(before.len(), 1);
        let context = usage_context(store, "saved-refused");
        refuse_usage_reservations(&dir.path().join("shelf.db"));
        let error = match start_observed(&cc, "sonnet", &chat, &token, Some(&context)).await {
            Err(error) => error,
            Ok(_) => panic!("reservation refusal dispatched a saved session"),
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (503, "usage reservation failed", false)
        );
        assert_eq!(store.shelf_ids().unwrap(), before);
        assert!(!cc.work_dir.join("starts").exists());
        assert_eq!(cc.runs.available_permits(), 1);
        cc.shutdown().await;
    }

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
            accounting: Mutex::new(None),
            sink_changed: tokio::sync::Notify::new(),
            announced: Mutex::new(VecDeque::new()),
            announcement_changed: tokio::sync::Notify::new(),
            pending: Mutex::new(Vec::new()),
            results: Mutex::new(HashMap::new()),
            calls: Mutex::new(HashMap::new()),
            stop: CancellationToken::new(),
            cleaned: CancellationToken::new(),
            interrupted_input: std::sync::atomic::AtomicBool::new(false),
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
        let (_, mut next_rx) = cc.continue_run(&synthetic_tool_result()).unwrap();
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
        assert!(matches!(next_rx.rx.recv().await, Some(Item::Record(s)) if s == "new-turn"));
    }

    #[tokio::test]
    async fn tc3_unsolicited_completion_retires_all_waiting_tool_state() {
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

    #[tokio::test]
    async fn ic1_precancelled_slot_preserves_capacity_and_waiting_run() {
        for busy in [false, true] {
            let (_dir, cc, run) = continuation_fixture();
            let held = if busy {
                Some(cc.runs.clone().acquire_owned().await.unwrap())
            } else {
                None
            };
            cc.live.lock().unwrap().order.push_back(run.clone());
            let cancel = CancellationToken::new();
            cancel.cancel();
            assert!(cc.slot(&cancel).await.is_none());
            assert!(!run.stop.is_cancelled());
            assert_eq!(cc.live.lock().unwrap().order.len(), 1);
            assert_eq!(cc.runs.available_permits(), usize::from(!busy));
            drop(held);
        }
    }

    #[tokio::test]
    async fn ic1_precancelled_start_preserves_pending_tool_result() {
        let (_dir, cc, run) = continuation_fixture();
        run.pending.lock().unwrap().push("tool_1".into());
        cc.live
            .lock()
            .unwrap()
            .waiting
            .insert("tool_1".into(), run.clone());
        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = tokio::time::timeout(
            Duration::from_secs(1),
            start(&cc, "sonnet", &synthetic_tool_result(), &cancel),
        )
        .await
        .unwrap();
        let error = match result {
            Err(e) => e,
            Ok(_) => panic!("cancelled request was admitted"),
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (499, "client disconnected", false)
        );
        assert_eq!(*run.pending.lock().unwrap(), ["tool_1"]);
        assert!(cc.live.lock().unwrap().waiting.contains_key("tool_1"));
        assert!(run.sink.lock().unwrap().is_none());
        assert!(run.results.lock().unwrap().is_empty());
        assert!(!run.stop.is_cancelled());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn ic1_precancelled_start_does_not_spawn_or_create_tool_files() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-claude");
        std::fs::write(&bin, "#!/bin/sh\nprintf started > started\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cc = ClaudeCode::new(Some(bin.to_string_lossy().into()), dir.path(), 1);
        let cancel = CancellationToken::new();
        cancel.cancel();
        let chat = json!({"tools":[{"type":"function","function":{"name":"probe","parameters":{"type":"object"}}}],"messages":[{"role":"user","content":"hello"}]});
        let error = match start(&cc, "sonnet", &chat, &cancel).await {
            Err(e) => e,
            Ok(_) => panic!("cancelled request started"),
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (499, "client disconnected", false)
        );
        assert!(!cc.work_dir.join("started").exists());
        assert!(!cc.work_dir.join("runs").exists());
        assert_eq!(cc.runs.available_permits(), 1);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ic2_cancel_blocked_initial_input_reaps_child_and_releases_resources() {
        use std::os::unix::fs::PermissionsExt;
        for (tools, ignore_term) in [(true, false), (false, false), (true, true)] {
            let dir = tempfile::tempdir().unwrap();
            let bin = dir.path().join("fake-claude");
            // Readiness follows a pipe-sized stderr burst, so the real drain must
            // be running. The child never reads stdin; 1MiB cannot fit its pipe.
            let script = format!("#!/usr/bin/env python3\nimport os, signal, sys, time\n{}\nsys.stderr.write('diagnostic' * 32768)\nsys.stderr.flush()\nopen('pid', 'w').write(str(os.getpid()))\nwhile True: time.sleep(60)\n", if ignore_term { "signal.signal(signal.SIGTERM, signal.SIG_IGN)" } else { "pass" });
            std::fs::write(&bin, script).unwrap();
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
            let cc = ClaudeCode::new(Some(bin.to_string_lossy().into()), dir.path(), 1);
            let sibling = cc.work_dir.join("runs/keep");
            std::fs::create_dir_all(&sibling).unwrap();
            std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
            let cancel = CancellationToken::new();
            let token = cancel.clone();
            let runner = cc.clone();
            let mut chat = json!({"messages":[{"role":"user","content":"q".repeat(1024*1024)}]});
            if tools {
                chat["tools"] = json!([{"type":"function","function":{"name":"probe","parameters":{"type":"object"}}}]);
            }
            let mut pending =
                tokio::spawn(async move { start(&runner, "sonnet", &chat, &token).await });
            let ready = tokio::time::timeout(Duration::from_secs(3), async {
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
            if ready.is_err() {
                pending.abort();
                let _ = pending.await;
                panic!("blocked-input child did not become ready");
            }
            let pid = ready.unwrap();
            assert!(!pending.is_finished());
            assert_eq!(
                cc.alive.load(std::sync::atomic::Ordering::SeqCst),
                0,
                "reader must not own startup yet"
            );
            assert_eq!(cc.runs.available_permits(), 0);
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1 + usize::from(tools)
            );
            cancel.cancel();
            // Existing stop() allows five seconds for a SIGTERM-resistant child.
            let done = tokio::time::timeout(Duration::from_secs(7), &mut pending).await;
            if done.is_err() {
                pending.abort();
                let _ = pending.await;
            }
            let result = done
                .expect("explicit cancellation did not interrupt initial stdin write")
                .unwrap();
            let error = match result {
                Err(e) => e,
                Ok(_) => panic!("cancelled write succeeded"),
            };
            assert_eq!(
                (error.status, error.body.as_str(), error.retryable),
                (499, "client disconnected", false)
            );
            assert!(
                !std::path::Path::new(&format!("/proc/{pid}")).exists(),
                "child must be reaped before returning"
            );
            assert_eq!(cc.runs.available_permits(), 1);
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1
            );
            assert_eq!(std::fs::read(sibling.join("sentinel")).unwrap(), b"keep");
            assert!(cc.live.lock().unwrap().by_token.is_empty());

            // Prove that the released slot can run a real healthy replacement.
            std::fs::write(
                &bin,
                r#"#!/usr/bin/env python3
import json, sys, time
sys.stdin.readline()
for event in [
 {"type":"message_start","message":{"id":"replacement","usage":{"input_tokens":1}}},
 {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}},
 {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"replacement"}},
 {"type":"content_block_stop","index":0},
 {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}},
 {"type":"message_stop"}
]: print(json.dumps({"type":"stream_event","event":event}), flush=True)
while True: time.sleep(60)
"#,
            )
            .unwrap();
            let healthy = tokio::time::timeout(Duration::from_secs(3), async {
                start(
                    &cc,
                    "sonnet",
                    &json!({"messages":[{"role":"user","content":"hello"}]}),
                    &CancellationToken::new(),
                )
                .await
                .unwrap()
                .collect("sonnet")
                .await
                .unwrap()
            })
            .await;
            cc.shutdown().await;
            let response: Value = serde_json::from_slice(&healthy.unwrap()).unwrap();
            assert_eq!(response["content"][0]["text"], "replacement");
            assert_eq!(cc.runs.available_permits(), 1);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn fr1_cancel_silent_fresh_reply_cleans_before_499() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-claude");
        std::fs::write(&bin, "#!/usr/bin/env python3\nimport os, sys, time\nsys.stdin.readline()\nopen('admitted', 'w').write(str(os.getpid()))\nwhile True: time.sleep(60)\n").unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cc = ClaudeCode::new(Some(bin.to_string_lossy().into()), dir.path(), 1);
        let token = CancellationToken::new();
        let runner = cc.clone();
        let request_token = token.clone();
        let mut pending = tokio::spawn(async move {
            start(
                &runner,
                "sonnet",
                &json!({"messages":[{"role":"user","content":"hello"}]}),
                &request_token,
            )
            .await
        });
        let admitted = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Ok(raw) = std::fs::read_to_string(cc.work_dir.join("admitted")) {
                    if let Ok(pid) = raw.parse::<u32>() {
                        break pid;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        if admitted.is_err() {
            pending.abort();
            cc.shutdown().await;
        }
        let pid = admitted.unwrap();
        assert!(!pending.is_finished());
        token.cancel();
        let result = tokio::time::timeout(Duration::from_secs(7), &mut pending).await;
        if result.is_err() {
            pending.abort();
        }
        cc.shutdown().await;
        let error = match result.expect("first reply cancellation hung").unwrap() {
            Err(e) => e,
            Ok(_) => panic!("silent process returned a reply"),
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (499, "client disconnected", false)
        );
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
        assert_eq!(cc.runs.available_permits(), 1);
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn oc1_cancel_active_collection_returns_499() {
        let (_dir, cc, chat, _) = first_reply_fixture("fresh", false).await;
        let script = std::fs::read_to_string(&cc.bin).unwrap().replace(
            "open('admitted', 'w').write(str(os.getpid()))",
            "print(json.dumps({'type':'stream_event','event':{'type':'message_start','message':{'id':'reply'}}}), flush=True)\nopen('admitted', 'w').write(str(os.getpid()))",
        );
        std::fs::write(&cc.bin, script).unwrap();
        let token = CancellationToken::new();
        let response = start(&cc, "sonnet", &chat, &token).await.unwrap();
        let pid = first_reply_admitted(&cc).await;
        token.cancel();
        let result = tokio::time::timeout(Duration::from_secs(2), response.collect("sonnet")).await;
        let clean_before_shutdown =
            !Path::new(&format!("/proc/{pid}")).exists() && cc.runs.available_permits() == 1;
        cc.shutdown().await;
        let error = result
            .expect("cancelled active collection remained blocked")
            .unwrap_err();
        assert!(
            matches!(error, AppError::Upstream { status: 499, body } if body == "client disconnected")
        );
        assert!(
            clean_before_shutdown,
            "cancellation must follow selected-run cleanup"
        );
    }

    /// The process really reads each user turn and emits tool announcements.
    /// Tool results use the native mcp_call boundary, not an HTTP/helper process.
    #[cfg(target_os = "linux")]
    async fn first_reply_fixture(
        mode: &str,
        ignore_term: bool,
    ) -> (tempfile::TempDir, ClaudeCode, Value, CancellationToken) {
        reply_fixture(mode, ignore_term, false).await
    }

    #[cfg(target_os = "linux")]
    async fn reply_fixture(
        mode: &str,
        ignore_term: bool,
        active_output: bool,
    ) -> (tempfile::TempDir, ClaudeCode, Value, CancellationToken) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-claude");
        let script = r#"#!/usr/bin/env python3
import json, os, signal, sys, time
mode = MODE
if IGNORE_TERM: signal.signal(signal.SIGTERM, signal.SIG_IGN)
resumed = '--resume' in sys.argv
open('starts', 'a').write('resume\n' if resumed else 'fresh\n')
open('pid', 'w').write(str(os.getpid()))
sys.stdin.readline()
sys.stderr.write('diagnostic' * 32768)
sys.stderr.flush()
print(json.dumps({'type':'system','subtype':'init','session_id':'first-reply-test'}), flush=True)
if mode == 'saved_error' and resumed or mode == 'error':
 print(json.dumps({'type':'result','is_error':True,'result':'auth failed' if resumed else 'usage limit'}), flush=True)
 sys.exit(1)
def reply(tool=False):
 block = {'type':'tool_use','id':'tool_1','name':'mcp__thinrouter__probe','input':{}} if tool else {'type':'text','text':''}
 events = [
  {'type':'message_start','message':{'id':'reply','usage':{'input_tokens':1}}},
  {'type':'content_block_start','index':0,'content_block':block},
  {'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':'{}'} if tool else {'type':'text_delta','text':'hello'}},
  {'type':'content_block_stop','index':0},
  {'type':'message_delta','delta':{'stop_reason':'tool_use' if tool else 'end_turn'},'usage':{'output_tokens':1}},
  {'type':'message_stop'}]
 for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)
if mode in ['idle', 'tool', 'healthy', 'saved_error']:
 reply(mode == 'tool')
 if mode == 'idle': sys.stdin.readline()
 if mode in ['healthy', 'saved_error']:
  while sys.stdin.readline(): reply()
open('admitted', 'w').write(str(os.getpid()))
if ACTIVE_OUTPUT:
 if mode == 'tool':
  while not os.path.exists('continue-output'): time.sleep(0.01)
 events = [
  {'type':'message_start','message':{'id':'partial','usage':{'input_tokens':1}}},
  {'type':'content_block_start','index':0,'content_block':{'type':'text','text':''}},
  {'type':'content_block_delta','index':0,'delta':{'type':'text_delta','text':'partial'}}]
 for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)
 if mode == 'flood':
  for i in range(1000): print(json.dumps({'type':'stream_event','event':events[-1]}), flush=True)
while True: time.sleep(60)
"#.replace("MODE", &format!("{mode:?}")).replace("IGNORE_TERM", if ignore_term { "True" } else { "False" }).replace("ACTIVE_OUTPUT", if active_output { "True" } else { "False" });
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut cc = ClaudeCode::new(Some(bin.to_string_lossy().into()), dir.path(), 1)
            .with_idle(Duration::from_secs(60))
            .with_store(crate::store::Store::open(&dir.path().join("shelf.db"), None).unwrap());
        cc.config_dir = dir.path().join("config");
        let sibling = cc.work_dir.join("runs/keep");
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
        let session_dir = cc.session_dirs().remove(0);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(
            session_dir.join("first-reply-test.jsonl"),
            b"synthetic session",
        )
        .unwrap();
        let mut chat = json!({"tools":[{"type":"function","function":{"name":"probe","parameters":{"type":"object"}}}],"messages":[{"role":"user","content":"first"}]});
        let old = CancellationToken::new();
        if mode == "idle" || mode == "tool" {
            let first = tokio::time::timeout(Duration::from_secs(3), async {
                start(&cc, "sonnet", &chat, &old)
                    .await
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
            })
            .await;
            if first.is_err() {
                cc.shutdown().await;
            }
            let response: Value = serde_json::from_slice(&first.unwrap()).unwrap();
            if mode == "idle" {
                assert_eq!(response["content"][0]["text"], "hello");
            } else {
                assert_eq!(response["stop_reason"], "tool_use");
            }
        }
        if mode == "tool" {
            chat["messages"]
                .as_array_mut()
                .unwrap()
                .extend(convo(&synthetic_tool_result()));
        } else if mode == "idle" || mode.starts_with("saved") {
            chat["messages"].as_array_mut().unwrap().extend([
                json!({"role":"assistant","content":"hello"}),
                json!({"role":"user","content":"second"}),
            ]);
        }
        if mode.starts_with("saved") {
            let hashes: Vec<String> = convo(&chat)[..2]
                .iter()
                .map(|m| sha(&norm(m).to_string()))
                .collect();
            cc.store
                .as_ref()
                .unwrap()
                .shelf_put(
                    "first-reply-test",
                    &sha(&signature("sonnet", &chat)),
                    &hashes,
                    SHELF_MOST,
                )
                .unwrap();
        }
        (dir, cc, chat, old)
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn oc1_oc2_active_output_cancel_drop_and_backpressure_matrix() {
        use futures_util::StreamExt;
        for (mode, stream, dropped, ignore_term) in [
            ("fresh", false, false, false),
            ("saved", false, false, false),
            ("idle", false, false, false),
            ("tool", false, false, false),
            ("fresh", true, false, false),
            ("saved", true, false, false),
            ("idle", true, false, false),
            ("tool", true, false, false),
            ("fresh", false, false, true),
            ("flood", true, false, false),
            ("fresh", true, true, false),
            ("idle", true, true, false),
        ] {
            let (_dir, cc, chat, old) = reply_fixture(mode, ignore_term, true).await;
            let token = CancellationToken::new();
            let runner = cc.clone();
            let current = token.clone();
            let mut started =
                tokio::spawn(async move { start(&runner, "sonnet", &chat, &current).await });
            if mode == "tool" {
                let run = cc
                    .live
                    .lock()
                    .unwrap()
                    .by_token
                    .values()
                    .next()
                    .unwrap()
                    .clone();
                let reply = tokio::time::timeout(
                    Duration::from_secs(3),
                    cc.mcp_call(&run.token, &json!({"name":"probe","arguments":{}})),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(reply["content"][0]["text"], "synthetic-result");
                assert!(run.pending.lock().unwrap().is_empty());
                std::fs::write(cc.work_dir.join("continue-output"), b"ready").unwrap();
            }
            let response = tokio::time::timeout(Duration::from_secs(3), &mut started).await;
            if response.is_err() {
                started.abort();
                cc.shutdown().await;
            }
            let response = response.unwrap().unwrap().unwrap();
            assert!(response.first.as_ref().unwrap().contains("message_start"));
            let pid = first_reply_admitted(&cc).await;
            let run = cc
                .live
                .lock()
                .unwrap()
                .by_token
                .values()
                .next()
                .unwrap()
                .clone();
            old.cancel();
            assert!(
                !run.stop.is_cancelled(),
                "old token must not own current output"
            );
            if mode == "flood" {
                tokio::time::timeout(Duration::from_secs(3), async {
                    while response.rx.capacity() != 0 {
                        tokio::task::yield_now().await;
                    }
                })
                .await
                .unwrap();
            }
            if stream {
                let mut body = Box::pin(response.into_stream());
                let first = body.next().await.unwrap().unwrap();
                assert!(String::from_utf8_lossy(&first).contains("message_start"));
                if dropped {
                    drop(body);
                    let cleaned =
                        tokio::time::timeout(Duration::from_secs(7), run.cleaned.cancelled()).await;
                    if cleaned.is_err() {
                        cc.shutdown().await;
                    }
                    cleaned.expect("dropped active stream did not clean");
                } else {
                    token.cancel();
                    let next = tokio::time::timeout(Duration::from_secs(7), body.next()).await;
                    if next.is_err() {
                        drop(body);
                        cc.shutdown().await;
                        panic!("active stream cancellation blocked");
                    }
                    let error =
                        String::from_utf8(next.unwrap().unwrap().unwrap().to_vec()).unwrap();
                    assert!(error.starts_with("event: error\n"), "{error}");
                    assert!(error.contains("client disconnected"));
                    assert!(!error.contains("message_stop"));
                    assert!(run.cleaned.is_cancelled());
                    assert!(body.next().await.is_none());
                }
            } else {
                let mut collecting = tokio::spawn(async move { response.collect("sonnet").await });
                tokio::task::yield_now().await;
                assert!(!collecting.is_finished());
                token.cancel();
                let result = tokio::time::timeout(Duration::from_secs(7), &mut collecting).await;
                if result.is_err() {
                    collecting.abort();
                    cc.shutdown().await;
                }
                assert!(
                    matches!(result.expect("active collection cancellation blocked").unwrap(),
                    Err(AppError::Upstream { status: 499, body }) if body == "client disconnected")
                );
                assert!(run.cleaned.is_cancelled());
            }
            assert!(!Path::new(&format!("/proc/{pid}")).exists());
            assert_eq!(cc.runs.available_permits(), 1);
            assert_eq!(cc.alive.load(std::sync::atomic::Ordering::SeqCst), 0);
            assert!(cc.live.lock().unwrap().by_token.is_empty());
            assert!(cc.live.lock().unwrap().idle.is_empty());
            assert!(cc.store.as_ref().unwrap().shelf_ids().unwrap().is_empty());
            assert!(!cc.session_saved("first-reply-test"));
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1
            );
            assert_eq!(
                std::fs::read(cc.work_dir.join("runs/keep/sentinel")).unwrap(),
                b"keep"
            );
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                if mode == "saved" {
                    "resume\n"
                } else {
                    "fresh\n"
                }
            );
            let script = std::fs::read_to_string(&cc.bin)
                .unwrap()
                .replace(&format!("mode = {mode:?}"), "mode = \"healthy\"")
                .replace("if True: signal.signal", "if False: signal.signal");
            std::fs::write(&cc.bin, script).unwrap();
            let replacement = tokio::time::timeout(Duration::from_secs(3), async {
                start(
                    &cc,
                    "sonnet",
                    &json!({"messages":[{"role":"user","content":"replacement"}]}),
                    &CancellationToken::new(),
                )
                .await
                .unwrap()
                .collect("sonnet")
                .await
                .unwrap()
            })
            .await;
            cc.shutdown().await;
            assert_eq!(
                serde_json::from_slice::<Value>(&replacement.unwrap()).unwrap()["content"][0]
                    ["text"],
                "hello"
            );
            assert_eq!(cc.runs.available_permits(), 1);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn oc3_detached_terminal_drop_preserves_next_request() {
        let (_dir, cc, mut chat, _) = first_reply_fixture("healthy", false).await;
        let script = std::fs::read_to_string(&cc.bin).unwrap().replace(
            "for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)",
            "events[3:3] = [events[2]] * 60\n for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)",
        );
        std::fs::write(&cc.bin, script).unwrap();
        let token = CancellationToken::new();
        let old = start(&cc, "sonnet", &chat, &token).await.unwrap();
        let run = cc
            .live
            .lock()
            .unwrap()
            .by_token
            .values()
            .next()
            .unwrap()
            .clone();
        let completed = tokio::time::timeout(Duration::from_secs(3), async {
            while cc.live.lock().unwrap().idle.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await;
        if completed.is_err() {
            drop(old);
            cc.shutdown().await;
            panic!("first turn did not detach at full terminal queue");
        }
        assert_eq!(old.rx.capacity(), 0);
        chat["messages"].as_array_mut().unwrap().extend([
            json!({"role":"assistant","content":"hello".repeat(61)}),
            json!({"role":"user","content":"next"}),
        ]);
        let runner = cc.clone();
        let mut next = tokio::spawn(async move {
            start(&runner, "sonnet", &chat, &CancellationToken::new())
                .await
                .unwrap()
                .collect("sonnet")
                .await
        });
        let resumed = tokio::time::timeout(Duration::from_secs(3), async {
            while run.sink.lock().unwrap().is_none() {
                tokio::task::yield_now().await;
            }
        })
        .await;
        if resumed.is_err() {
            next.abort();
            drop(old);
            cc.shutdown().await;
            panic!("next turn was not installed");
        }
        token.cancel();
        drop(old);
        let result = tokio::time::timeout(Duration::from_secs(3), &mut next).await;
        if result.is_err() {
            next.abort();
        }
        let stopped = run.stop.is_cancelled();
        cc.shutdown().await;
        let response = result
            .expect("completed old response drop blocked next request")
            .unwrap()
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<Value>(&response).unwrap()["content"][0]["text"],
            "hello".repeat(61)
        );
        assert!(!stopped, "completed response drop stopped the reused run");
        assert_eq!(
            std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
            "fresh\n"
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn bp1_cancel_next_request_while_old_terminal_is_backpressured() {
        let (_dir, cc, mut chat, _) = first_reply_fixture("healthy", false).await;
        let script = std::fs::read_to_string(&cc.bin).unwrap().replace(
            "for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)",
            "events[3:3] = [events[2]] * 60\n for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)",
        );
        std::fs::write(&cc.bin, script).unwrap();
        let old = start(&cc, "sonnet", &chat, &CancellationToken::new())
            .await
            .unwrap();
        let run = cc
            .live
            .lock()
            .unwrap()
            .by_token
            .values()
            .next()
            .unwrap()
            .clone();
        let completed = tokio::time::timeout(Duration::from_secs(3), async {
            while cc.live.lock().unwrap().idle.is_empty() {
                tokio::task::yield_now().await;
            }
        })
        .await;
        if completed.is_err() {
            drop(old);
            cc.shutdown().await;
            panic!("old turn did not detach before terminal backpressure");
        }
        assert_eq!(old.rx.capacity(), 0);
        assert!(run.sink.lock().unwrap().is_none());
        let pid: u32 = std::fs::read_to_string(cc.work_dir.join("pid"))
            .unwrap()
            .parse()
            .unwrap();
        chat["messages"].as_array_mut().unwrap().extend([
            json!({"role":"assistant","content":"hello".repeat(61)}),
            json!({"role":"user","content":"next"}),
        ]);
        let token = CancellationToken::new();
        let current = token.clone();
        let runner = cc.clone();
        let mut next = tokio::spawn(async move { start(&runner, "sonnet", &chat, &current).await });
        let admitted = tokio::time::timeout(Duration::from_secs(3), async {
            while run.sink.lock().unwrap().is_none() {
                tokio::task::yield_now().await;
            }
        })
        .await;
        if admitted.is_err() {
            next.abort();
            drop(old);
            cc.shutdown().await;
            panic!("new continuation sink not installed");
        }
        assert!(!next.is_finished());
        token.cancel();
        let cancelled = tokio::time::timeout(Duration::from_secs(3), &mut next).await;
        let clean_before_old_drop = run.cleaned.is_cancelled();
        let alive_before_old_drop = Path::new(&format!("/proc/{pid}")).exists();
        let permits_before_old_drop = cc.runs.available_permits();
        eprintln!(
            "BP-1 before old receiver drop: stop={}, cleaned={}, process_exists={}, free_slots={}",
            run.stop.is_cancelled(),
            clean_before_old_drop,
            alive_before_old_drop,
            permits_before_old_drop
        );
        if cancelled.is_err() {
            next.abort();
        }
        drop(old);
        cc.shutdown().await;
        let error = match cancelled
            .expect("cancelled next request remained blocked behind retained old terminal")
            .unwrap()
        {
            Err(error) => error,
            Ok(_) => panic!("cancelled continuation succeeded"),
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (499, "client disconnected", false)
        );
        assert!(clean_before_old_drop);
        assert!(!alive_before_old_drop);
        assert_eq!(permits_before_old_drop, 1);
    }

    #[cfg(target_os = "linux")]
    struct BackpressuredReply {
        _dir: tempfile::TempDir,
        cc: ClaudeCode,
        chat: Value,
        response: ClaudeRun,
        run: Arc<LiveRun>,
        pid: u32,
        token: CancellationToken,
    }

    #[cfg(target_os = "linux")]
    async fn backpressured_reply(kind: &str, ignore_term: bool) -> BackpressuredReply {
        backpressured_reply_with_idle(kind, ignore_term, Duration::from_secs(60)).await
    }

    #[cfg(target_os = "linux")]
    async fn backpressured_reply_with_idle(
        kind: &str,
        ignore_term: bool,
        idle: Duration,
    ) -> BackpressuredReply {
        let (dir, cc, chat, _) = reply_fixture("fresh", ignore_term, true).await;
        let cc = cc.with_idle(idle);
        let mut script = std::fs::read_to_string(&cc.bin).unwrap();
        if kind == "terminal" || kind == "tool" {
            script = script.replace(
                "mode = \"fresh\"",
                if kind == "tool" { "mode = \"tool\"" } else { "mode = \"healthy\"" },
            ).replacen(
                "for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)",
                "extra = {'type':'content_block_delta','index':0,'delta':{'type':'input_json_delta','partial_json':''}} if tool else events[2]\n events[3:3] = [extra] * 60\n for event in events: print(json.dumps({'type':'stream_event','event':event}), flush=True)",
                1,
            );
            // Tool result admission is exercised through mcp_call. A separate gate
            // lets a healthy control emit the next text reply, without claiming
            // the fake process itself runs an HTTP MCP helper.
            script = script.replace(
                "if True:\n if mode == 'tool':",
                "if mode == 'tool':\n while not os.path.exists('healthy-tool-reply'): time.sleep(0.01)\n reply()\nif False:\n if mode == 'tool':",
            );
        } else {
            let tail = if kind == "failure" {
                "for i in range(62): print(json.dumps({'type':'stream_event','event':events[-1]}), flush=True)\n print(json.dumps({'type':'result','is_error':True,'result':'usage limit'}), flush=True)\n open('output-emitted', 'w').write('failure')"
            } else {
                "for i in range(64): print(json.dumps({'type':'stream_event','event':events[-1]}), flush=True)\n open('output-emitted', 'w').write('record')"
            };
            script = script.replace(
                "if mode == 'flood':\n  for i in range(1000): print(json.dumps({'type':'stream_event','event':events[-1]}), flush=True)",
                tail,
            );
        }
        std::fs::write(&cc.bin, script).unwrap();
        let token = CancellationToken::new();
        let response = start(&cc, "sonnet", &chat, &token).await.unwrap();
        let run = cc
            .live
            .lock()
            .unwrap()
            .by_token
            .values()
            .next()
            .unwrap()
            .clone();
        let ready = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                let terminal = kind == "terminal" || kind == "tool";
                let phase_ready = if terminal {
                    let live = cc.live.lock().unwrap();
                    !live.idle.is_empty() || !live.waiting.is_empty()
                } else {
                    cc.work_dir.join("output-emitted").exists()
                };
                if response.rx.capacity() == 0 && phase_ready {
                    break;
                }
                tokio::task::yield_now().await;
            }
        })
        .await;
        if ready.is_err() {
            drop(response);
            cc.shutdown().await;
            panic!("fake {kind} reply did not reach bounded channel backpressure");
        }
        assert_eq!(
            run.sink.lock().unwrap().is_none(),
            kind == "terminal" || kind == "tool"
        );
        let pid = std::fs::read_to_string(cc.work_dir.join("pid"))
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(
            std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
            2
        );
        BackpressuredReply {
            _dir: dir,
            cc,
            chat,
            response,
            run,
            pid,
            token,
        }
    }

    #[cfg(target_os = "linux")]
    fn assert_backpressure_resources_released(
        cc: &ClaudeCode,
        run: &LiveRun,
        pid: u32,
        shelved: bool,
    ) {
        assert!(run.cleaned.is_cancelled());
        assert!(!Path::new(&format!("/proc/{pid}")).exists());
        assert_eq!(cc.runs.available_permits(), 1);
        assert_eq!(cc.alive.load(std::sync::atomic::Ordering::SeqCst), 0);
        let live = cc.live.lock().unwrap();
        assert!(live.by_token.is_empty());
        assert!(live.idle.is_empty());
        assert!(live.waiting.is_empty());
        drop(live);
        assert_eq!(cc.session_saved("first-reply-test"), shelved);
        assert_eq!(
            cc.store.as_ref().unwrap().shelf_ids().unwrap().len(),
            usize::from(shelved)
        );
        assert_eq!(
            std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
            1
        );
        assert_eq!(
            std::fs::read(cc.work_dir.join("runs/keep/sentinel")).unwrap(),
            b"keep"
        );
    }

    #[cfg(target_os = "linux")]
    fn next_backpressured_chat(chat: &Value, tool: bool) -> Value {
        let mut next = chat.clone();
        if tool {
            next["messages"]
                .as_array_mut()
                .unwrap()
                .extend(convo(&synthetic_tool_result()));
        } else {
            next["messages"].as_array_mut().unwrap().extend([
                json!({"role":"assistant","content":"hello".repeat(61)}),
                json!({"role":"user","content":"next"}),
            ]);
        }
        next
    }

    #[cfg(target_os = "linux")]
    async fn install_backpressured_continuation(
        fixture: &BackpressuredReply,
        tool: bool,
        token: &CancellationToken,
    ) -> tokio::task::JoinHandle<Result<ClaudeRun, UpstreamAttemptError>> {
        let runner = fixture.cc.clone();
        let next = next_backpressured_chat(&fixture.chat, tool);
        let current = token.clone();
        let pending = tokio::spawn(async move { start(&runner, "sonnet", &next, &current).await });
        tokio::time::timeout(Duration::from_secs(3), async {
            while fixture.run.sink.lock().unwrap().is_none() {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("continuation installed its new sink");
        if tool {
            let result = fixture
                .cc
                .mcp_call(&fixture.run.token, &json!({"name":"probe","arguments":{}}))
                .await
                .unwrap();
            assert_eq!(result["content"][0]["text"], "synthetic-result");
        }
        assert!(!pending.is_finished());
        pending
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ie1_idle_expiry_releases_retained_completed_terminal() {
        for (kind, ignore_term) in [("terminal", false), ("tool", false), ("terminal", true)] {
            let idle = Duration::from_millis(150);
            let fixture = backpressured_reply_with_idle(kind, ignore_term, idle).await;
            assert_eq!(fixture.response.rx.capacity(), 0);
            assert!(fixture.run.sink.lock().unwrap().is_none());
            let since = fixture.run.waiting_since.lock().unwrap().unwrap();
            let bound = if ignore_term { 7 } else { 3 };
            let result =
                tokio::time::timeout(Duration::from_secs(bound), fixture.run.cleaned.cancelled())
                    .await;
            let stopped = fixture.run.stop.is_cancelled();
            let cleaned = fixture.run.cleaned.is_cancelled();
            let process_exists = Path::new(&format!("/proc/{}", fixture.pid)).exists();
            let slots = fixture.cc.runs.available_permits();
            if result.is_err() {
                drop(fixture.response);
                fixture.cc.shutdown().await;
                panic!("idle expiry behind retained {kind}: stop={stopped}, cleaned={cleaned}, process_exists={process_exists}, free_slots={slots}");
            }
            assert!(since.elapsed() >= idle);
            assert_backpressure_resources_released(
                &fixture.cc,
                &fixture.run,
                fixture.pid,
                kind == "terminal",
            );
            assert_eq!(
                fixture.response.rx.capacity(),
                0,
                "old receiver was never drained"
            );
            if kind == "terminal" && !ignore_term {
                let replacement = tokio::time::timeout(Duration::from_secs(3), async {
                    start(
                        &fixture.cc,
                        "sonnet",
                        &json!({"messages":[{"role":"user","content":"replacement"}]}),
                        &CancellationToken::new(),
                    )
                    .await
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
                })
                .await;
                fixture.cc.shutdown().await;
                let reply: Value = serde_json::from_slice(&replacement.unwrap()).unwrap();
                assert_eq!(reply["content"][0]["text"], "hello".repeat(61));
                assert_eq!(
                    std::fs::read_to_string(fixture.cc.work_dir.join("starts")).unwrap(),
                    "fresh\nfresh\n",
                );
            }
            drop(fixture.response);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ie2_continuation_outlives_old_deadline_and_gets_its_own() {
        for tool in [false, true] {
            let idle = Duration::from_millis(300);
            let fixture =
                backpressured_reply_with_idle(if tool { "tool" } else { "terminal" }, false, idle)
                    .await;
            let first_since = fixture.run.waiting_since.lock().unwrap().unwrap();
            let token = CancellationToken::new();
            let mut next = install_backpressured_continuation(&fixture, tool, &token).await;
            assert!(fixture.run.waiting_since.lock().unwrap().is_none());
            tokio::time::sleep_until(tokio::time::Instant::from_std(
                first_since + idle + Duration::from_millis(40),
            ))
            .await;
            let active_after_old_deadline = !fixture.run.stop.is_cancelled()
                && !fixture.run.cleaned.is_cancelled()
                && fixture.run.waiting_since.lock().unwrap().is_none()
                && fixture.run.sink.lock().unwrap().is_some()
                && fixture.response.rx.capacity() == 0
                && Path::new(&format!("/proc/{}", fixture.pid)).exists();
            if !active_after_old_deadline {
                next.abort();
                drop(fixture.response);
                fixture.cc.shutdown().await;
                panic!(
                    "old idle deadline ended healthy continuation while old terminal was retained"
                );
            }
            fixture.token.cancel(); // A completed old response no longer owns this run.
            let old = fixture.response.collect("sonnet").await.unwrap();
            let old: Value = serde_json::from_slice(&old).unwrap();
            if tool {
                assert_eq!(old["stop_reason"], "tool_use");
                std::fs::write(fixture.cc.work_dir.join("healthy-tool-reply"), b"go").unwrap();
            } else {
                assert_eq!(old["content"][0]["text"], "hello".repeat(61));
            }
            let reply = tokio::time::timeout(Duration::from_secs(3), async {
                (&mut next)
                    .await
                    .unwrap()
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
            })
            .await;
            if reply.is_err() {
                next.abort();
                fixture.cc.shutdown().await;
            }
            let reply: Value = serde_json::from_slice(&reply.unwrap()).unwrap();
            assert_eq!(reply["content"][0]["text"], "hello".repeat(61));
            let second_since = fixture.run.waiting_since.lock().unwrap().unwrap();
            assert!(second_since >= first_since + idle);
            let expiry =
                tokio::time::timeout(Duration::from_secs(3), fixture.run.stop.cancelled()).await;
            let elapsed_at_stop = second_since.elapsed();
            if expiry.is_err() {
                fixture.cc.shutdown().await;
            }
            expiry.unwrap();
            assert!(
                elapsed_at_stop >= idle,
                "later phase lost part of its idle duration"
            );
            tokio::time::timeout(Duration::from_secs(3), fixture.run.cleaned.cancelled())
                .await
                .unwrap();
            assert_backpressure_resources_released(&fixture.cc, &fixture.run, fixture.pid, true);
            assert_eq!(
                std::fs::read_to_string(fixture.cc.work_dir.join("starts")).unwrap(),
                "fresh\n"
            );
        }
    }

    #[tokio::test]
    async fn ie2_old_epoch_cannot_expire_a_later_completed_phase() {
        let (_dir, cc, run) = continuation_fixture();
        let idle = Duration::from_millis(400);
        let cc = cc.with_idle(idle);
        let mut first = EventFilter {
            done: true,
            stop_reason: Some("tool_use".into()),
            tool_ids: vec!["tool_1".into()],
            ..Default::default()
        };
        drop(cc.finish_turn(&run, &mut first));
        let first_since = run.waiting_since.lock().unwrap().unwrap();
        let (_run, _receiver) = cc.continue_run(&synthetic_tool_result()).unwrap();
        tokio::time::sleep(Duration::from_millis(200)).await;
        let mut second = EventFilter {
            done: true,
            ..Default::default()
        };
        drop(cc.finish_turn(&run, &mut second));
        let second_since = run.waiting_since.lock().unwrap().unwrap();
        tokio::time::sleep_until(tokio::time::Instant::from_std(
            first_since + idle + Duration::from_millis(40),
        ))
        .await;
        assert!(
            !run.stop.is_cancelled(),
            "old phase timer stopped a newer completed phase"
        );
        tokio::time::timeout(Duration::from_secs(3), run.stop.cancelled())
            .await
            .unwrap();
        assert!(second_since.elapsed() >= idle);
    }

    #[tokio::test]
    async fn ie2_expired_or_interrupted_tool_phase_rejects_admission() {
        for interrupted in [false, true] {
            let (_dir, cc, run) = continuation_fixture();
            let cc = cc.with_idle(Duration::from_millis(20));
            let mut filter = EventFilter {
                done: true,
                stop_reason: Some("tool_use".into()),
                tool_ids: vec!["tool_1".into()],
                ..Default::default()
            };
            drop(cc.finish_turn(&run, &mut filter));
            if interrupted {
                run.interrupted_input
                    .store(true, std::sync::atomic::Ordering::SeqCst);
            } else {
                tokio::time::timeout(Duration::from_secs(3), run.stop.cancelled())
                    .await
                    .unwrap();
            }
            assert!(cc.continue_run(&synthetic_tool_result()).is_none());
            assert!(run.sink.lock().unwrap().is_none());
            assert_eq!(run.pending.lock().unwrap().as_slice(), ["tool_1"]);
            assert!(run.results.lock().unwrap().is_empty());
            assert!(cc.live.lock().unwrap().waiting.contains_key("tool_1"));
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn bp1_user_and_tool_cancel_drop_retire_behind_retained_terminal() {
        for (tool, dropped) in [(false, true), (true, false), (true, true)] {
            let fixture = backpressured_reply(if tool { "tool" } else { "terminal" }, false).await;
            let token = CancellationToken::new();
            let mut pending = install_backpressured_continuation(&fixture, tool, &token).await;
            // A completed old request's token does not stop this newer sink.
            fixture.token.cancel();
            assert!(!fixture.run.stop.is_cancelled());
            if dropped {
                pending.abort();
                assert!(matches!((&mut pending).await, Err(error) if error.is_cancelled()));
            } else {
                token.cancel();
            }
            let clean =
                tokio::time::timeout(Duration::from_secs(3), fixture.run.cleaned.cancelled()).await;
            let clean_before_old_drop = clean.is_ok();
            if !clean_before_old_drop {
                if !dropped {
                    pending.abort();
                }
                drop(fixture.response);
                fixture.cc.shutdown().await;
                panic!("continuation cancellation did not clean up with old receiver retained");
            }
            if !dropped {
                let result = pending.await.unwrap();
                let error = match result {
                    Err(e) => e,
                    Ok(_) => panic!("cancelled continuation succeeded"),
                };
                assert_eq!(
                    (error.status, error.body.as_str(), error.retryable),
                    (499, "client disconnected", false)
                );
            }
            assert_backpressure_resources_released(&fixture.cc, &fixture.run, fixture.pid, false);
            assert_eq!(
                std::fs::read_to_string(fixture.cc.work_dir.join("starts")).unwrap(),
                "fresh\n"
            );
            drop(fixture.response);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn bp2_shutdown_releases_full_record_failure_and_terminal_channels() {
        for (kind, ignore_term) in [
            ("record", false),
            ("failure", false),
            ("terminal", false),
            ("record", true),
        ] {
            let fixture = backpressured_reply(kind, ignore_term).await;
            let bound = if ignore_term { 7 } else { 3 };
            let result =
                tokio::time::timeout(Duration::from_secs(bound), fixture.cc.shutdown()).await;
            let clean_before_old_drop = fixture.run.cleaned.is_cancelled();
            if result.is_err() || !clean_before_old_drop {
                drop(fixture.response);
                fixture.cc.shutdown().await;
                panic!("shutdown of backpressured {kind} did not release resources in {bound}s");
            }
            assert_backpressure_resources_released(
                &fixture.cc,
                &fixture.run,
                fixture.pid,
                kind == "terminal",
            );
            assert_eq!(
                std::fs::read_to_string(fixture.cc.work_dir.join("starts")).unwrap(),
                "fresh\n"
            );
            drop(fixture.response);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn bp2_one_slot_eviction_releases_retained_terminal_and_admits_replacement() {
        let fixture = backpressured_reply("terminal", false).await;
        let next = tokio::time::timeout(Duration::from_secs(3), async {
            start(
                &fixture.cc,
                "sonnet",
                &json!({"messages":[{"role":"user","content":"unrelated replacement"}]}),
                &CancellationToken::new(),
            )
            .await
            .unwrap()
            .collect("sonnet")
            .await
            .unwrap()
        })
        .await;
        let cleaned_before_old_drop = fixture.run.cleaned.is_cancelled();
        if next.is_err() {
            drop(fixture.response);
            fixture.cc.shutdown().await;
            panic!("one-slot eviction stayed blocked by retained terminal");
        }
        assert!(cleaned_before_old_drop);
        assert!(!Path::new(&format!("/proc/{}", fixture.pid)).exists());
        let reply: Value = serde_json::from_slice(&next.unwrap()).unwrap();
        assert_eq!(reply["content"][0]["text"], "hello".repeat(61));
        assert_eq!(
            std::fs::read_to_string(fixture.cc.work_dir.join("starts")).unwrap(),
            "fresh\nfresh\n"
        );
        assert_eq!(
            std::fs::read(fixture.cc.work_dir.join("runs/keep/sentinel")).unwrap(),
            b"keep"
        );
        assert_eq!(
            std::fs::read_dir(fixture.cc.work_dir.join("runs"))
                .unwrap()
                .count(),
            1
        );
        drop(fixture.response);
        fixture.cc.shutdown().await;
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn bp3_healthy_full_queues_deliver_records_failure_and_same_process_reuse() {
        for tool in [false, true] {
            let fixture = backpressured_reply(if tool { "tool" } else { "terminal" }, false).await;
            let token = CancellationToken::new();
            let mut next = install_backpressured_continuation(&fixture, tool, &token).await;
            fixture.token.cancel();
            let old = fixture.response.collect("sonnet").await.unwrap();
            let old: Value = serde_json::from_slice(&old).unwrap();
            if tool {
                assert_eq!(old["stop_reason"], "tool_use");
                std::fs::write(fixture.cc.work_dir.join("healthy-tool-reply"), b"go").unwrap();
            } else {
                assert_eq!(old["content"][0]["text"], "hello".repeat(61));
            }
            let result = tokio::time::timeout(Duration::from_secs(3), async {
                (&mut next)
                    .await
                    .unwrap()
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
            })
            .await;
            if result.is_err() {
                next.abort();
            }
            let stopped = fixture.run.stop.is_cancelled();
            fixture.cc.shutdown().await;
            let result: Value = serde_json::from_slice(&result.unwrap()).unwrap();
            assert_eq!(result["content"][0]["text"], "hello".repeat(61));
            assert!(!stopped);
            assert_eq!(
                std::fs::read_to_string(fixture.cc.work_dir.join("starts")).unwrap(),
                "fresh\n"
            );
        }
        let fixture = backpressured_reply("failure", false).await;
        let error =
            tokio::time::timeout(Duration::from_secs(3), fixture.response.collect("sonnet"))
                .await
                .unwrap()
                .unwrap_err();
        fixture.cc.shutdown().await;
        assert!(
            matches!(error, AppError::Upstream {status:429, body} if body == "Claude Code: usage limit")
        );
        assert_backpressure_resources_released(&fixture.cc, &fixture.run, fixture.pid, false);
    }

    #[tokio::test]
    async fn oc3_channel_identity_survives_completion_before_first_handoff() {
        let (_dir, cc, run) = continuation_fixture();
        let (old_tx, old_rx) = reply_channel();
        old_tx
            .send(Item::Record("queued old record".into()))
            .await
            .unwrap();
        *run.sink.lock().unwrap() = Some(old_tx);
        let mut filter = EventFilter {
            done: true,
            ..Default::default()
        };
        drop(cc.finish_turn(&run, &mut filter));
        let (new_tx, mut new_rx) = reply_channel();
        *run.sink.lock().unwrap() = Some(new_tx);
        let token = CancellationToken::new();
        let mut old = first_reply(run.clone(), old_rx, &token).await.unwrap();
        token.cancel();
        assert!(matches!(old.next().await, Some(Item::Record(s)) if s == "queued old record"));
        assert!(old.next().await.is_none());
        drop(old);
        assert!(!run.stop.is_cancelled());
        assert!(!run
            .interrupted_input
            .load(std::sync::atomic::Ordering::SeqCst));
        run.sink
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .try_send(Item::Record("new turn".into()))
            .unwrap();
        assert!(matches!(new_rx.rx.recv().await, Some(Item::Record(s)) if s == "new turn"));
    }

    #[tokio::test]
    async fn oc2_ready_cancel_beats_output_and_uses_latched_cleanup() {
        for first in [true, false] {
            let (_dir, _cc, run) = continuation_fixture();
            let (tx, reply) = reply_channel();
            tx.send(Item::Record("first".into())).await.unwrap();
            *run.sink.lock().unwrap() = Some(tx.clone());
            let token = CancellationToken::new();
            let mut response = first_reply(run.clone(), reply, &token).await.unwrap();
            if !first {
                assert!(matches!(response.next().await, Some(Item::Record(_))));
                tx.send(Item::Record("queued".into())).await.unwrap();
            }
            run.cleaned.cancel(); // Controlled cleanup-latch state, not OS evidence.
            token.cancel();
            assert!(
                matches!(response.next().await, Some(Item::Failed{status:499,message}) if message == "client disconnected")
            );
            assert!(run.stop.is_cancelled());
            assert!(tx.is_closed());
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn oc3_completed_queued_replies_ignore_late_cancel() {
        for mode in ["healthy", "tool"] {
            let (_dir, cc, chat, _) = first_reply_fixture("fresh", false).await;
            let script = std::fs::read_to_string(&cc.bin)
                .unwrap()
                .replace("mode = \"fresh\"", &format!("mode = {mode:?}"));
            std::fs::write(&cc.bin, script).unwrap();
            let token = CancellationToken::new();
            let response = start(&cc, "sonnet", &chat, &token).await.unwrap();
            let run = cc
                .live
                .lock()
                .unwrap()
                .by_token
                .values()
                .next()
                .unwrap()
                .clone();
            let completed = tokio::time::timeout(Duration::from_secs(3), async {
                loop {
                    let ready = {
                        let live = cc.live.lock().unwrap();
                        if mode == "tool" {
                            !live.waiting.is_empty()
                        } else {
                            !live.idle.is_empty()
                        }
                    };
                    if ready {
                        break;
                    }
                    tokio::task::yield_now().await;
                }
            })
            .await;
            if completed.is_err() {
                drop(response);
                cc.shutdown().await;
                panic!("healthy turn did not detach");
            }
            token.cancel();
            let result =
                tokio::time::timeout(Duration::from_secs(3), response.collect("sonnet")).await;
            let stopped = run.stop.is_cancelled();
            let indexed = {
                let live = cc.live.lock().unwrap();
                if mode == "tool" {
                    live.waiting.len()
                } else {
                    live.idle.len()
                }
            };
            cc.shutdown().await;
            let reply: Value = serde_json::from_slice(&result.unwrap().unwrap()).unwrap();
            assert_eq!(
                reply["stop_reason"],
                if mode == "tool" {
                    "tool_use"
                } else {
                    "end_turn"
                }
            );
            assert!(!stopped);
            assert_eq!(indexed, 1);
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                "fresh\n"
            );
        }
    }

    #[cfg(target_os = "linux")]
    async fn first_reply_admitted(cc: &ClaudeCode) -> u32 {
        tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Ok(raw) = std::fs::read_to_string(cc.work_dir.join("admitted")) {
                    if let Ok(pid) = raw.parse::<u32>() {
                        let initialized = cc
                            .live
                            .lock()
                            .unwrap()
                            .by_token
                            .values()
                            .any(|run| run.session_id.lock().unwrap().is_some());
                        if initialized {
                            break pid;
                        }
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fake process did not accept input")
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn fr1_fr2_current_cancel_and_drop_first_reply_matrix() {
        for (mode, dropped, ignore_term) in [
            ("fresh", false, false),
            ("saved", false, false),
            ("idle", false, false),
            ("tool", false, false),
            ("fresh", true, false),
            ("saved", true, false),
            ("idle", true, false),
            ("tool", true, false),
            ("fresh", false, true),
            ("idle", true, true),
        ] {
            let (_dir, cc, chat, old) = first_reply_fixture(mode, ignore_term).await;
            let token = CancellationToken::new();
            let runner = cc.clone();
            let current = token.clone();
            let mut pending =
                tokio::spawn(async move { start(&runner, "sonnet", &chat, &current).await });
            if mode == "tool" {
                let run = cc
                    .live
                    .lock()
                    .unwrap()
                    .by_token
                    .values()
                    .next()
                    .unwrap()
                    .clone();
                let reply = tokio::time::timeout(
                    Duration::from_secs(3),
                    cc.mcp_call(&run.token, &json!({"name":"probe","arguments":{}})),
                )
                .await
                .unwrap()
                .unwrap();
                assert_eq!(reply["content"][0]["text"], "synthetic-result");
                assert!(
                    run.pending.lock().unwrap().is_empty(),
                    "tool continuation was admitted"
                );
            }
            let pid = first_reply_admitted(&cc).await;
            let run = cc
                .live
                .lock()
                .unwrap()
                .by_token
                .values()
                .next()
                .unwrap()
                .clone();
            assert!(
                !pending.is_finished(),
                "stdout remains open without a new reply"
            );
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                2
            );
            old.cancel();
            tokio::task::yield_now().await;
            assert!(
                !run.stop.is_cancelled(),
                "old request token must not own this wait"
            );
            assert!(!pending.is_finished());
            if dropped {
                pending.abort();
                assert!(matches!(pending.await, Err(e) if e.is_cancelled()));
                let cleaned =
                    tokio::time::timeout(Duration::from_secs(7), run.cleaned.cancelled()).await;
                if cleaned.is_err() {
                    cc.shutdown().await;
                }
                cleaned.expect("dropped first reply did not finish cleanup");
            } else {
                token.cancel();
                let done = tokio::time::timeout(Duration::from_secs(7), &mut pending).await;
                if done.is_err() {
                    pending.abort();
                    cc.shutdown().await;
                }
                let error = match done
                    .expect("current first reply cancellation hung")
                    .unwrap()
                {
                    Err(e) => e,
                    Ok(_) => panic!("cancelled reply succeeded"),
                };
                assert_eq!(
                    (error.status, error.body.as_str(), error.retryable),
                    (499, "client disconnected", false)
                );
                assert!(run.cleaned.is_cancelled(), "499 must follow cleanup");
            }
            assert!(!Path::new(&format!("/proc/{pid}")).exists());
            assert_eq!(cc.runs.available_permits(), 1);
            assert_eq!(cc.alive.load(std::sync::atomic::Ordering::SeqCst), 0);
            assert!(cc.live.lock().unwrap().by_token.is_empty());
            assert!(cc.live.lock().unwrap().idle.is_empty());
            assert!(cc.store.as_ref().unwrap().shelf_ids().unwrap().is_empty());
            assert!(!cc.session_saved("first-reply-test"));
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1
            );
            assert_eq!(
                std::fs::read(cc.work_dir.join("runs/keep/sentinel")).unwrap(),
                b"keep"
            );
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                if mode == "saved" {
                    "resume\n"
                } else {
                    "fresh\n"
                }
            );
            // Exercise the released slot with a healthy actual replacement.
            let script = std::fs::read_to_string(&cc.bin)
                .unwrap()
                .replace(&format!("mode = {mode:?}"), "mode = \"healthy\"")
                .replace("if True: signal.signal", "if False: signal.signal");
            std::fs::write(&cc.bin, script).unwrap();
            let replacement = tokio::time::timeout(Duration::from_secs(3), async {
                start(
                    &cc,
                    "sonnet",
                    &json!({"messages":[{"role":"user","content":"replacement"}]}),
                    &CancellationToken::new(),
                )
                .await
                .unwrap()
                .collect("sonnet")
                .await
                .unwrap()
            })
            .await;
            cc.shutdown().await;
            let response: Value = serde_json::from_slice(&replacement.unwrap()).unwrap();
            assert_eq!(response["content"][0]["text"], "hello");
            assert_eq!(cc.runs.available_permits(), 1);
        }
    }

    #[tokio::test]
    async fn fr3_ready_cancellation_wins_and_cleanup_latch_is_retained() {
        for item in [
            Item::Record("queued".into()),
            Item::Failed {
                status: 401,
                message: "ordinary".into(),
            },
        ] {
            let (_dir, _cc, run) = continuation_fixture();
            // State-boundary injection: cleanup completed before this waiter starts.
            run.cleaned.cancel();
            let (tx, rx) = mpsc::channel(1);
            let rx = ReplyReceiver {
                sink: tx.downgrade(),
                accounting: None,
                rx,
            };
            tx.send(item).await.unwrap();
            let cancel = CancellationToken::new();
            cancel.cancel();
            let error = match first_reply(run.clone(), rx, &cancel).await {
                Err(e) => e,
                Ok(_) => panic!("queued record defeated ready cancellation"),
            };
            assert_eq!(
                (error.status, error.body.as_str(), error.retryable),
                (499, "client disconnected", false)
            );
            assert!(run.stop.is_cancelled());
            assert!(tx.is_closed());
        }
        for failure in [false, true] {
            let (_dir, _cc, run) = continuation_fixture();
            let (tx, rx) = mpsc::channel(1);
            let rx = ReplyReceiver {
                sink: tx.downgrade(),
                accounting: None,
                rx,
            };
            if failure {
                tx.send(Item::Failed {
                    status: 401,
                    message: "ordinary".into(),
                })
                .await
                .unwrap();
            }
            drop(tx);
            let error = match first_reply(run.clone(), rx, &CancellationToken::new()).await {
                Err(e) => e,
                Ok(_) => panic!("expected ordinary failure"),
            };
            assert_eq!(
                (error.status, error.retryable),
                (if failure { 401 } else { 502 }, true)
            );
            assert!(
                !run.stop.is_cancelled(),
                "ordinary classification keeps existing ownership"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn fr3_healthy_handoff_and_saved_failure_fallback() {
        for mode in ["healthy", "saved_error", "error"] {
            let (_dir, cc, mut chat, token) = first_reply_fixture(mode, false).await;
            let first =
                tokio::time::timeout(Duration::from_secs(3), start(&cc, "sonnet", &chat, &token))
                    .await;
            if first.is_err() {
                cc.shutdown().await;
            }
            if mode == "error" {
                let error = match first.unwrap() {
                    Err(e) => e,
                    Ok(_) => panic!("expected failure"),
                };
                assert_eq!((error.status, error.retryable), (429, true));
                cc.shutdown().await;
                continue;
            }
            let first = first.unwrap().unwrap();
            // Active output now owns cancellation too. Anchor this healthy control
            // at completion before cancelling the old request's token.
            let completed = tokio::time::timeout(Duration::from_secs(3), async {
                while cc.live.lock().unwrap().idle.is_empty() {
                    tokio::task::yield_now().await;
                }
            })
            .await;
            if completed.is_err() {
                drop(first);
                cc.shutdown().await;
                panic!("healthy first reply did not complete");
            }
            token.cancel();
            let response = tokio::time::timeout(Duration::from_secs(3), first.collect("sonnet"))
                .await
                .unwrap()
                .unwrap();
            assert_eq!(
                serde_json::from_slice::<Value>(&response).unwrap()["content"][0]["text"],
                "hello"
            );
            let run = cc.live.lock().unwrap().idle[0].clone();
            assert!(!run.stop.is_cancelled());
            chat["messages"].as_array_mut().unwrap().extend([
                json!({"role":"assistant","content":"hello"}),
                json!({"role":"user","content":"next"}),
            ]);
            let next = tokio::time::timeout(Duration::from_secs(3), async {
                start(&cc, "sonnet", &chat, &CancellationToken::new())
                    .await
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
            })
            .await;
            assert!(Arc::ptr_eq(&cc.live.lock().unwrap().idle[0], &run));
            cc.shutdown().await;
            assert_eq!(
                serde_json::from_slice::<Value>(&next.unwrap()).unwrap()["content"][0]["text"],
                "hello"
            );
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                if mode == "saved_error" {
                    "resume\nfresh\n"
                } else {
                    "fresh\n"
                }
            );
        }
    }

    #[cfg(target_os = "linux")]
    async fn resumed_fixture(
        tools: bool,
        ignore_term: bool,
        healthy: bool,
    ) -> (tempfile::TempDir, ClaudeCode, Value, Arc<LiveRun>, u32) {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let bin = dir.path().join("fake-claude");
        let script = format!(
            r#"#!/usr/bin/env python3
import json, os, signal, sys, time
if {ignore_term}: signal.signal(signal.SIGTERM, signal.SIG_IGN)
open('starts', 'a').write('start\n')
open('pid', 'w').write(str(os.getpid()))
sys.stdin.readline()
sys.stderr.write('diagnostic' * 32768)
sys.stderr.flush()
print(json.dumps({{"type":"system","subtype":"init","session_id":"resume-test"}}), flush=True)
while True:
 for event in [
  {{"type":"message_start","message":{{"id":"resume","usage":{{"input_tokens":1}}}}}},
  {{"type":"content_block_start","index":0,"content_block":{{"type":"text","text":""}}}},
  {{"type":"content_block_delta","index":0,"delta":{{"type":"text_delta","text":"hello"}}}},
  {{"type":"content_block_stop","index":0}},
  {{"type":"message_delta","delta":{{"stop_reason":"end_turn"}},"usage":{{"output_tokens":1}}}},
  {{"type":"message_stop"}}
 ]: print(json.dumps({{"type":"stream_event","event":event}}), flush=True)
 if {healthy}:
  if not sys.stdin.readline(): break
 else:
  while True: time.sleep(60)
"#,
            ignore_term = if ignore_term { "True" } else { "False" },
            healthy = if healthy { "True" } else { "False" }
        );
        std::fs::write(&bin, script).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut cc = ClaudeCode::new(Some(bin.to_string_lossy().into()), dir.path(), 1)
            .with_idle(Duration::from_secs(60))
            .with_store(crate::store::Store::open(&dir.path().join("shelf.db"), None).unwrap());
        cc.config_dir = dir.path().join("config");
        let mut chat = json!({"messages":[{"role":"user","content":"first"}]});
        if tools {
            chat["tools"] = json!([{"type":"function","function":{"name":"probe","parameters":{"type":"object"}}}]);
        }
        let first = tokio::time::timeout(Duration::from_secs(3), async {
            start(&cc, "sonnet", &chat, &CancellationToken::new())
                .await
                .unwrap()
                .collect("sonnet")
                .await
                .unwrap()
        })
        .await;
        if first.is_err() {
            cc.shutdown().await;
        }
        let response: Value = serde_json::from_slice(&first.unwrap()).unwrap();
        assert_eq!(response["content"][0]["text"], "hello");
        let run = cc.live.lock().unwrap().idle[0].clone();
        let session_dir = cc.session_dirs().remove(0);
        std::fs::create_dir_all(&session_dir).unwrap();
        std::fs::write(session_dir.join("resume-test.jsonl"), b"synthetic session").unwrap();
        let pid = std::fs::read_to_string(cc.work_dir.join("pid"))
            .unwrap()
            .parse()
            .unwrap();
        chat["messages"].as_array_mut().unwrap().extend([
            json!({"role":"assistant","content":"hello"}),
            json!({"role":"user","content":"q".repeat(1024 * 1024)}),
        ]);
        (dir, cc, chat, run, pid)
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ri1_cancel_blocked_resumed_input_cleans_before_499() {
        for (tools, ignore_term) in [(true, false), (false, false), (true, true)] {
            let (_dir, cc, chat, run, pid) = resumed_fixture(tools, ignore_term, false).await;
            let sibling = cc.work_dir.join("runs/keep");
            std::fs::create_dir_all(&sibling).unwrap();
            std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
            let token = CancellationToken::new();
            let mut pending = Box::pin(start(&cc, "sonnet", &chat, &token));
            assert!(futures_util::poll!(&mut pending).is_pending());
            assert!(!run.idle_now.load(std::sync::atomic::Ordering::SeqCst));
            assert!(
                run.stdin.try_lock().is_err(),
                "resume owns the blocked stdin write"
            );
            token.cancel();
            let done = tokio::time::timeout(Duration::from_secs(7), &mut pending).await;
            drop(pending);
            if done.is_err() {
                cc.shutdown().await;
            }
            let error =
                match done.expect("explicit cancellation did not interrupt resumed stdin write") {
                    Err(e) => e,
                    Ok(_) => panic!("cancelled resume succeeded"),
                };
            assert_eq!(
                (error.status, error.body.as_str(), error.retryable),
                (499, "client disconnected", false)
            );
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
            assert_eq!(cc.runs.available_permits(), 1);
            assert_eq!(cc.alive.load(std::sync::atomic::Ordering::SeqCst), 0);
            assert!(cc.live.lock().unwrap().by_token.is_empty());
            assert!(cc.store.as_ref().unwrap().shelf_ids().unwrap().is_empty());
            assert!(!cc.session_saved("resume-test"));
            assert!(!run.idle_now.load(std::sync::atomic::Ordering::SeqCst));
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                "start\n"
            );
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1
            );
            assert_eq!(std::fs::read(sibling.join("sentinel")).unwrap(), b"keep");
            // The released one-slot limit admits a healthy new process.
            let replacement = tokio::time::timeout(Duration::from_secs(3), async {
                start(
                    &cc,
                    "sonnet",
                    &json!({"messages":[{"role":"user","content":"replacement"}]}),
                    &CancellationToken::new(),
                )
                .await
                .unwrap()
                .collect("sonnet")
                .await
                .unwrap()
            })
            .await;
            cc.shutdown().await;
            let replacement: Value = serde_json::from_slice(&replacement.unwrap()).unwrap();
            assert_eq!(replacement["content"][0]["text"], "hello");
            assert_eq!(cc.runs.available_permits(), 1);
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ri1_cancel_waiting_for_resumed_stdin_lock() {
        let (_dir, cc, chat, run, pid) = resumed_fixture(true, false, false).await;
        let held = run.stdin.lock().await;
        let token = CancellationToken::new();
        let mut pending = Box::pin(start(&cc, "sonnet", &chat, &token));
        assert!(futures_util::poll!(&mut pending).is_pending());
        assert!(!run.idle_now.load(std::sync::atomic::Ordering::SeqCst));
        token.cancel();
        let done = tokio::time::timeout(Duration::from_secs(3), &mut pending).await;
        drop(pending);
        // Keep the mutex held until cancellation and cleanup have returned.
        drop(held);
        if done.is_err() {
            cc.shutdown().await;
        }
        let error = match done.expect("cancellation waited for stdin mutex") {
            Err(e) => e,
            Ok(_) => panic!("cancelled lock acquisition succeeded"),
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (499, "client disconnected", false)
        );
        assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
        assert_eq!(cc.runs.available_permits(), 1);
        assert_eq!(
            std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
            "start\n"
        );
        assert_eq!(
            std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
            0
        );
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ri2_dropped_resumed_input_retires_run() {
        for ignore_term in [false, true] {
            let (_dir, cc, chat, run, pid) = resumed_fixture(true, ignore_term, false).await;
            let sibling = cc.work_dir.join("runs/keep");
            std::fs::create_dir_all(&sibling).unwrap();
            std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
            let token = CancellationToken::new();
            let mut pending = Box::pin(start(&cc, "sonnet", &chat, &token));
            assert!(futures_util::poll!(&mut pending).is_pending());
            assert!(run.stdin.try_lock().is_err());
            drop(pending);
            assert!(run.stop.is_cancelled());
            // Even a terminal record observed after interruption cannot republish idle.
            let mut terminal = EventFilter {
                done: true,
                ..Default::default()
            };
            drop(cc.finish_turn(&run, &mut terminal));
            assert!(cc.live.lock().unwrap().idle.is_empty());
            let cleaned =
                tokio::time::timeout(Duration::from_secs(7), run.cleaned.cancelled()).await;
            if cleaned.is_err() {
                cc.shutdown().await;
            }
            cleaned.expect("dropped resumed input did not finish cleanup");
            assert!(cc.store.as_ref().unwrap().shelf_ids().unwrap().is_empty());
            assert!(!cc.session_saved("resume-test"));
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
            assert_eq!(cc.runs.available_permits(), 1);
            assert!(!run.idle_now.load(std::sync::atomic::Ordering::SeqCst));
            assert_eq!(
                std::fs::read_dir(cc.work_dir.join("runs")).unwrap().count(),
                1
            );
            assert_eq!(std::fs::read(sibling.join("sentinel")).unwrap(), b"keep");
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                "start\n"
            );
        }
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn ri3_healthy_resume_and_ordinary_write_error_fallback() {
        for tools in [false, true] {
            let (_dir, cc, mut chat, run, pid) = resumed_fixture(tools, false, true).await;
            chat["messages"][2]["content"] = json!("second");
            let resumed = tokio::time::timeout(Duration::from_secs(3), async {
                start(&cc, "sonnet", &chat, &CancellationToken::new())
                    .await
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
            })
            .await;
            if resumed.is_err() {
                cc.shutdown().await;
            }
            let response: Value = serde_json::from_slice(&resumed.unwrap()).unwrap();
            assert_eq!(response["content"][0]["text"], "hello");
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                "start\n"
            );
            assert!(Arc::ptr_eq(&cc.live.lock().unwrap().idle[0], &run));
            assert_eq!(
                run.session_id.lock().unwrap().as_deref(),
                Some("resume-test")
            );
            // Close the real input pipe, then submit the matching next turn. The
            // ordinary None/write failure must still start a full-conversation run.
            run.stdin.lock().await.take();
            chat["messages"].as_array_mut().unwrap().extend([
                json!({"role":"assistant","content":"hello"}),
                json!({"role":"user","content":"third"}),
            ]);
            let fallback = tokio::time::timeout(Duration::from_secs(3), async {
                start(&cc, "sonnet", &chat, &CancellationToken::new())
                    .await
                    .unwrap()
                    .collect("sonnet")
                    .await
                    .unwrap()
            })
            .await;
            cc.shutdown().await;
            let response: Value = serde_json::from_slice(&fallback.unwrap()).unwrap();
            assert_eq!(response["content"][0]["text"], "hello");
            assert_eq!(
                std::fs::read_to_string(cc.work_dir.join("starts")).unwrap(),
                "start\nstart\n"
            );
            assert!(!std::path::Path::new(&format!("/proc/{pid}")).exists());
            assert_eq!(cc.runs.available_permits(), 1);
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
                ClaudeRun {
                    first,
                    rx,
                    output: None,
                    accounting: None,
                }
                .collect("m"),
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
                matches!(ClaudeRun{first:Some(String::new()),rx,output:None,accounting:None}.collect("m").await,Err(AppError::Upstream{status:s,body}) if s == status && body == "explicit CLI failure")
            );
            assert!(tx.is_closed());
        }
    }

    #[tokio::test]
    async fn cb3_collection_failure_settles_before_receiver_close() {
        let dir = tempfile::tempdir().unwrap();
        let store = crate::store::Store::open(&dir.path().join("usage.db"), None).unwrap();
        let accounting = usage_context(&store, "collection-failure").begin().unwrap();
        accounting.observe_event(&json!({"type":"message_start","message":{"usage":{
            "input_tokens":12,"cache_read_input_tokens":3,"cache_creation_input_tokens":2,
            "output_tokens":0
        }}}));
        let producer_accounting = accounting.clone();
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        let producer = tokio::spawn(async move {
            tx.closed().await;
            // The real producer treats a closed consumer as cancellation.
            producer_accounting.stop("cancelled", "stream_cancelled");
        });
        let result = tokio::time::timeout(
            Duration::from_secs(3),
            ClaudeRun {
                first: Some("x".repeat(crate::collection::MAX_BYTES - 1)),
                rx,
                output: None,
                accounting: Some(accounting.clone()),
            }
            .collect("m"),
        )
        .await
        .unwrap();
        assert!(
            matches!(result, Err(AppError::Upstream { status: 502, body })
            if body == crate::collection::LIMIT_MESSAGE)
        );
        // Force the producer to observe closure before the outer proxy handles
        // collect's error, so scheduler timing cannot hide the settlement race.
        tokio::time::timeout(Duration::from_secs(3), producer)
            .await
            .unwrap()
            .unwrap();
        accounting.converted_terminal(true);
        let rows = store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.outcome, "failed");
        assert_eq!(row.error.as_deref(), Some("stream_conversion_failed"));
        assert_eq!(row.prompt_tokens, Some(17));
        assert_eq!(row.completion_tokens, Some(0));
        assert_eq!(row.usage_status, "partial");
        assert!(row.status.is_none());
        assert!(row.finalized_at.is_some());
    }

    #[tokio::test]
    async fn bc2_oversized_first_record_closes_receiver() {
        let (tx, rx) = tokio::sync::mpsc::channel(1);
        let run = super::ClaudeRun {
            first: Some("x".repeat(16 * 1024 * 1024 - 1)),
            rx,
            output: None,
            accounting: None,
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

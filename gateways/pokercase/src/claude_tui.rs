//! Strict interactive Claude transport. No print fallback or transcript-generated output.
//!
//! Response observation follows yetone/magpie a6217e83d3caa8b870fc200b252226bf7c5560e9
//! internal/claudetui (MIT). The Rust adapter is independently implemented; unlike the
//! reference it fails closed without a tap and never accepts onboarding/trust prompts.

use anyhow::{bail, ensure, Result};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

const MAX_LINE: usize = 8 * 1024 * 1024;
const MAX_FILE: u64 = 64 * 1024 * 1024;

#[cfg(unix)]
#[path = "claude_tui/unix.rs"]
mod unix;

/// Run the explicit interactive transport using the original executable and print args.
pub async fn run(args: Vec<String>) -> Result<()> {
    #[cfg(unix)]
    {
        unix::run(args).await
    }
    #[cfg(not(unix))]
    {
        let _ = args;
        bail!("Claude TUI is unsupported on this platform; select explicit print mode")
    }
}

pub(crate) fn interactive_args(args: &[String], sid: &str) -> Result<Vec<String>> {
    ensure!(
        uuid::Uuid::parse_str(sid).is_ok(),
        "invalid TUI session identity"
    );
    let mut out = Vec::new();
    let mut i = 0;
    let mut resume = false;
    while i < args.len() {
        let a = args[i].as_str();
        match a {
            "-p"
            | "--print"
            | "--verbose"
            | "--include-partial-messages"
            | "--replay-user-messages" => {}
            "--output-format" | "--input-format" => {
                i += 1;
                ensure!(
                    args.get(i).map(String::as_str) == Some("stream-json"),
                    "unsupported TUI format"
                );
            }
            "--permission-mode" => {
                i += 1;
                ensure!(
                    args.get(i).map(String::as_str) == Some("default"),
                    "unsafe TUI permission mode"
                );
            }
            "--model" | "--tools" | "--mcp-config" | "--allowedTools" | "--setting-sources"
            | "--settings" | "--effort" | "--resume" => {
                i += 1;
                let value = args
                    .get(i)
                    .ok_or_else(|| anyhow::anyhow!("missing TUI argument"))?;
                if a == "--resume" {
                    ensure!(value == sid && !resume, "invalid TUI resume identity");
                    resume = true;
                }
                out.extend([a.to_string(), value.clone()]);
            }
            "--strict-mcp-config" | "--no-chrome" => out.push(a.to_string()),
            _ => bail!("unsupported or unsafe TUI argument"),
        }
        i += 1;
    }
    ensure!(
        out.iter().any(|v| v == "--strict-mcp-config"),
        "TUI requires strict MCP configuration"
    );
    if !resume {
        out.extend(["--session-id".into(), sid.into()]);
    }
    out.extend([
        "--permission-mode".into(),
        "default".into(),
        "--no-chrome".into(),
    ]);
    Ok(out)
}

pub(crate) fn session_id(args: &[String]) -> Result<String> {
    let mut values = args.windows(2).filter(|a| a[0] == "--resume");
    let sid = values
        .next()
        .map(|a| a[1].clone())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    ensure!(
        values.next().is_none() && uuid::Uuid::parse_str(&sid).is_ok(),
        "invalid TUI session identity"
    );
    Ok(sid)
}

pub(crate) fn transcript_path(config: &Path, cwd: &Path, sid: &str) -> Result<PathBuf> {
    ensure!(
        uuid::Uuid::parse_str(sid).is_ok() && cwd.is_absolute(),
        "invalid TUI transcript location"
    );
    let cwd = cwd
        .to_str()
        .ok_or_else(|| anyhow::anyhow!("unsupported TUI work directory"))?;
    let slug: String = cwd
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    // Do not scan other projects/sessions if the selected CLI uses a different encoding.
    ensure!(slug.len() <= 240, "unsupported TUI work directory length");
    Ok(config
        .join("projects")
        .join(slug)
        .join(format!("{sid}.jsonl")))
}

pub(crate) fn paste_text(text: &str) -> Result<String> {
    ensure!(text.len() <= MAX_LINE, "TUI input exceeds limit");
    ensure!(
        !text
            .chars()
            .any(|c| c.is_control() && !matches!(c, '\r' | '\n' | '\t')),
        "TUI input contains control characters"
    );
    let text = text.replace("\r\n", "\n").replace('\r', "\n");
    ensure!(!text.trim().is_empty(), "empty TUI input");
    // A literal prefix makes command-like text data even when the CLI trims a queued paste.
    let first = text.trim_start().chars().next().unwrap();
    Ok(if matches!(first, '/' | '!' | '#' | '&') {
        format!("[user message]\n{text}")
    } else {
        text
    })
}

#[derive(Default)]
pub(crate) struct Lines {
    part: Vec<u8>,
}
impl Lines {
    pub(crate) fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        for &b in bytes {
            ensure!(self.part.len() < MAX_LINE, "TUI record exceeds limit");
            if b == b'\n' {
                if !self.part.is_empty() {
                    out.push(
                        serde_json::from_slice(&self.part)
                            .map_err(|_| anyhow::anyhow!("invalid TUI record"))?,
                    );
                    self.part.clear();
                }
            } else {
                self.part.push(b);
            }
        }
        Ok(out)
    }
    pub(crate) fn finish(&self) -> Result<()> {
        ensure!(self.part.is_empty(), "truncated TUI record");
        Ok(())
    }
}

#[derive(Default)]
struct Stream {
    id: Option<String>,
    duplicate: bool,
    terminal: Option<Value>,
    reason: bool,
}

#[derive(Default)]
pub(crate) struct Tap {
    pub(crate) on: bool,
    streams: HashMap<u64, Stream>,
    ended: HashSet<u64>,
    messages: HashSet<String>,
}
impl Tap {
    pub(crate) fn row(&mut self, row: Value, sid: &str) -> Result<Vec<Value>> {
        let mut out = Vec::new();
        if let Some(state) = row.get("tap") {
            ensure!(state == "on", "Claude TUI response observation unavailable");
            self.on = true;
            return Ok(out);
        }
        ensure!(self.on, "Claude TUI tap not initialized");
        let n = row
            .get("s")
            .and_then(Value::as_u64)
            .filter(|n| *n != 0)
            .ok_or_else(|| anyhow::anyhow!("invalid TUI stream identity"))?;
        if self.ended.contains(&n) {
            return Ok(out);
        }
        if row.get("open") == Some(&Value::Bool(true)) {
            ensure!(
                self.streams.is_empty() && self.ended.len() < 4096,
                "invalid TUI stream open"
            );
            self.streams.insert(n, Stream::default());
            return Ok(out);
        }
        let st = self
            .streams
            .get_mut(&n)
            .ok_or_else(|| anyhow::anyhow!("unopened TUI stream"))?;
        if let Some(status) = row.get("http_status").and_then(Value::as_u64) {
            match status {
                401 => bail!("Claude TUI authentication required"),
                429 => bail!("Claude TUI usage limit reached"),
                _ => bail!("Claude TUI upstream request failed"),
            }
        }
        if let Some(event) = row.get("e") {
            let kind = event
                .get("type")
                .and_then(Value::as_str)
                .ok_or_else(|| anyhow::anyhow!("invalid TUI event"))?;
            if kind == "error" {
                bail!("Claude TUI upstream stream error");
            }
            if kind == "ping" {
                return Ok(out);
            }
            if kind == "message_start" {
                ensure!(st.id.is_none(), "duplicate TUI message start");
                let id = event
                    .pointer("/message/id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty() && s.len() < 1024)
                    .ok_or_else(|| anyhow::anyhow!("missing TUI message identity"))?;
                st.duplicate = !self.messages.insert(id.into());
                st.id = Some(id.into());
            }
            ensure!(
                st.id.is_some() && st.terminal.is_none(),
                "invalid TUI event order"
            );
            if kind == "message_delta"
                && event
                    .pointer("/delta/stop_reason")
                    .and_then(Value::as_str)
                    .is_some()
            {
                st.reason = true;
            }
            if kind == "message_stop" {
                st.terminal = Some(event.clone());
            } else if !st.duplicate {
                out.push(json!({"type":"stream_event","event":event,"session_id":sid,"parent_tool_use_id":null}));
            }
            return Ok(out);
        }
        ensure!(
            row.get("end") == Some(&Value::String("done".into())),
            "Claude TUI stream interrupted"
        );
        ensure!(
            st.terminal.is_some() && st.reason,
            "Claude TUI stream missing terminal evidence"
        );
        if !st.duplicate {
            out.push(json!({"type":"stream_event","event":st.terminal,"session_id":sid,"parent_tool_use_id":null}));
        }
        self.streams.remove(&n);
        self.ended.insert(n);
        Ok(out)
    }
    pub(crate) fn finish(&self) -> Result<()> {
        ensure!(self.streams.is_empty(), "Claude TUI stream interrupted");
        Ok(())
    }
}

//! MCP helper that offers a client's tools to a Claude Code run.
//!
//! Claude Code runs with `--tools ""` (no built-ins) and this helper as its only MCP
//! server, so the model sees the caller's tools as `mcp__thinrouter__<name>`. When the
//! model calls one, the gateway already has the `tool_use` from the stream: it hands it
//! to the client and ends the run. `tools/call` is therefore never answered here; the
//! next request (with the tool result) starts a new run told the whole conversation.

use std::collections::HashMap;
use std::io::{BufRead, Write};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const SERVER: &str = "thinrouter";
const PREFIX: &str = "mcp__thinrouter__";
/// Claude Code keeps MCP tool names at 64 characters including the prefix.
const MAX_NAME: usize = 64 - PREFIX.len();

/// Name the helper offers a client tool under: `[A-Za-z0-9_-]` only; a name that would
/// change (or is too long) is cut and given a hash of the whole name, so it is unique
/// and the same in every run.
pub fn tool_name(name: &str) -> String {
    let clean = !name.is_empty()
        && name.len() <= MAX_NAME
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-');
    if clean {
        return name.to_string();
    }
    let safe: String = name
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .take(MAX_NAME - 13)
        .collect();
    let hash = hex::encode(Sha256::digest(name.as_bytes()));
    format!("{safe}_{}", &hash[..12])
}

/// Full name Claude Code calls the tool by.
pub fn bridged_name(name: &str) -> String {
    format!("{PREFIX}{}", tool_name(name))
}

/// Chat tools → (MCP tool list, bridged name → client name).
pub fn mcp_tools(chat_tools: &[Value]) -> (Vec<Value>, HashMap<String, String>) {
    let mut list = Vec::new();
    let mut names = HashMap::new();
    for t in chat_tools {
        let f = t.get("function").unwrap_or(t);
        let Some(name) = f.get("name").and_then(|n| n.as_str()) else {
            continue;
        };
        names.insert(bridged_name(name), name.to_string());
        list.push(json!({
            "name": tool_name(name),
            "description": f.get("description").cloned().unwrap_or(json!("")),
            "inputSchema": f
                .get("parameters")
                .cloned()
                .filter(|p| p.is_object())
                .unwrap_or_else(|| json!({"type": "object", "properties": {}})),
        }));
    }
    (list, names)
}

/// Answer one JSON-RPC message; None = no reply (notifications, `tools/call`).
pub fn handle(msg: &Value, tools: &[Value]) -> Option<Value> {
    let id = msg.get("id")?.clone();
    let method = msg.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let result = match method {
        "initialize" => json!({
            "protocolVersion": msg.pointer("/params/protocolVersion").cloned().unwrap_or(json!("2025-06-18")),
            "capabilities": {"tools": {}},
            "serverInfo": {"name": SERVER, "version": env!("CARGO_PKG_VERSION")},
        }),
        "tools/list" => json!({"tools": tools}),
        "ping" => json!({}),
        // The gateway ends the run once the call is streamed to the client.
        "tools/call" => return None,
        _ => {
            return Some(json!({
                "jsonrpc": "2.0", "id": id,
                "error": {"code": -32601, "message": format!("method not found: {method}")}
            }))
        }
    };
    Some(json!({"jsonrpc": "2.0", "id": id, "result": result}))
}

/// `thinrouter claude-mcp-helper --tools-file <path>`: newline-delimited JSON-RPC on stdio.
pub fn run(tools_file: &std::path::Path) -> anyhow::Result<()> {
    let tools: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(tools_file)?)?;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout().lock();
    for line in stdin.lock().lines() {
        let line = line?;
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if let Some(reply) = handle(&msg, &tools) {
            writeln!(out, "{reply}")?;
            out.flush()?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_are_kept_or_made_safe_and_unique() {
        assert_eq!(bridged_name("get_weather"), "mcp__thinrouter__get_weather");
        let a = tool_name("fs/read");
        let b = tool_name("fs_read");
        assert_ne!(a, b);
        assert!(a.starts_with("fs_read_"));
        let long = "x".repeat(80);
        assert!(bridged_name(&long).len() <= 64);
        assert_eq!(tool_name("fs/read"), a, "stable across runs");
    }

    #[test]
    fn mcp_protocol() {
        let (tools, names) = mcp_tools(&[json!({"type": "function", "function": {
            "name": "spawn.agent", "description": "d", "parameters": {"type": "object"}}})]);
        assert_eq!(names[&bridged_name("spawn.agent")], "spawn.agent");
        let init = handle(
            &json!({"jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": {"protocolVersion": "2025-03-26"}}),
            &tools,
        )
        .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert!(handle(
            &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
            &tools
        )
        .is_none());
        let list = handle(
            &json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list"}),
            &tools,
        )
        .unwrap();
        assert_eq!(list["result"]["tools"][0]["inputSchema"]["type"], "object");
        assert!(handle(
            &json!({"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {}}),
            &tools
        )
        .is_none());
        let err = handle(
            &json!({"jsonrpc": "2.0", "id": 4, "method": "resources/list"}),
            &tools,
        )
        .unwrap();
        assert_eq!(err["error"]["code"], -32601);
    }
}

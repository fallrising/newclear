//! MCP helper that offers a client's tools to a Claude Code run.
//!
//! Claude Code runs with `--tools ""` (no built-ins) and this helper as its only MCP
//! server, so the model sees the caller's tools as `mcp__thinrouter__<name>`. When the
//! model calls one, the gateway has already handed the streamed `tool_use` to the
//! client. The helper forwards `tools/call` to the gateway callback
//! (`POST /_thinrouter/claude-mcp` with the run's token header), which answers once the client's next
//! request brings the tool result, and the same Claude Code process goes on.

use std::collections::HashMap;
use std::sync::Arc;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const SERVER: &str = "thinrouter";
/// Gateway route the helper posts `tools/call` params to.
pub const CALLBACK_PATH: &str = "/_thinrouter/claude-mcp";
/// Header carrying the run's secret token.
pub const TOKEN_HEADER: &str = "x-thinrouter-run-token";
pub const PREFIX: &str = "mcp__thinrouter__";
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
        // Answered asynchronously through the gateway callback (see `run`).
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

/// MCP `tools/call` result for a client tool result.
pub fn call_result(text: &str, is_error: bool) -> Value {
    json!({"content": [{"type": "text", "text": text}], "isError": is_error})
}

/// `thinrouter claude-mcp-helper --tools-file <path> [--callback-file <path>]`:
/// newline-delimited JSON-RPC on stdio. Calls run concurrently (parallel tool use).
pub async fn run(
    tools_file: &std::path::Path,
    callback_file: Option<&std::path::Path>,
) -> anyhow::Result<()> {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let tools: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(tools_file)?)?;
    // `{"url", "token"}` from a 0600 file: the token is never on a command line.
    let callback: Option<(String, String)> = match callback_file {
        Some(p) => {
            let v: Value = serde_json::from_str(&std::fs::read_to_string(p)?)?;
            let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
            Some((s("url"), s("token")))
        }
        None => None,
    };
    let http = reqwest::Client::builder().no_proxy().build()?;
    let out = Arc::new(tokio::sync::Mutex::new(tokio::io::stdout()));
    let write = |out: Arc<tokio::sync::Mutex<tokio::io::Stdout>>, v: Value| async move {
        let mut o = out.lock().await;
        let _ = o.write_all(format!("{v}\n").as_bytes()).await;
        let _ = o.flush().await;
    };
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        let Ok(msg) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        if msg.get("method").and_then(|m| m.as_str()) == Some("tools/call") {
            let (Some(id), Some((url, token))) = (msg.get("id").cloned(), callback.clone()) else {
                continue; // no callback: the gateway ends the run instead
            };
            let (http, out) = (http.clone(), out.clone());
            let params = msg.get("params").cloned().unwrap_or(Value::Null);
            tokio::spawn(async move {
                let req = http.post(&url).header(TOKEN_HEADER, token).json(&params);
                let result = match req.send().await {
                    Ok(r) if r.status().is_success() => r
                        .json::<Value>()
                        .await
                        .unwrap_or_else(|_| call_result("bad gateway reply", true)),
                    Ok(r) => call_result(&format!("gateway returned {}", r.status()), true),
                    Err(_) => call_result("gateway unreachable", true),
                };
                write(out, json!({"jsonrpc": "2.0", "id": id, "result": result})).await;
            });
            continue;
        }
        if let Some(reply) = handle(&msg, &tools) {
            write(out.clone(), reply).await;
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

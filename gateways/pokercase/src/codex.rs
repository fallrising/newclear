//! Codex (ChatGPT backend) request identity: client version for the User-Agent and a
//! stable per-conversation `prompt_cache_key` + session headers so prompt-cache hits
//! route to the machine holding the cached prefix.

use std::path::{Path, PathBuf};
use std::time::Duration;

use bytes::Bytes;
use serde_json::Value;
use uuid::Uuid;

/// Used when neither `--codex-version` nor an installed `codex` CLI gives a version.
pub const FALLBACK_VERSION: &str = "0.136.0";

/// Namespace for deriving conversation keys (UUIDv5).
const KEY_NAMESPACE: Uuid = Uuid::from_u128(0x6f1d_93a4_2c55_4b0e_9a1e_7d3c_5b8f_0e21);

/// Version precedence: explicit setting, then `codex --version`, then the fallback.
pub async fn resolve_version(configured: Option<&str>) -> (String, &'static str) {
    if let Some(v) = configured.map(str::trim).filter(|v| !v.is_empty()) {
        return (v.to_string(), "configured");
    }
    if let Some(v) = detect_installed_version().await {
        return (v, "codex --version");
    }
    (FALLBACK_VERSION.to_string(), "fallback")
}

async fn detect_installed_version() -> Option<String> {
    let run = tokio::process::Command::new("codex")
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    let out = tokio::time::timeout(Duration::from_secs(3), run)
        .await
        .ok()?
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_version(&String::from_utf8_lossy(&out.stdout))
}

/// `codex-cli 0.163.0` → `0.163.0`.
pub fn parse_version(output: &str) -> Option<String> {
    output
        .split_whitespace()
        .find(|w| {
            w.split('.').count() >= 2
                && w.chars().next().is_some_and(|c| c.is_ascii_digit())
                && w.chars()
                    .all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-')
        })
        .map(str::to_string)
}

pub fn user_agent(version: &str) -> String {
    format!("codex_cli_rs/{version}")
}

/// Ensure the Responses body has a `prompt_cache_key` and return it. A client-supplied
/// key wins; otherwise the key is derived from what stays fixed across a conversation's
/// turns: model, instructions and the first input item.
pub fn ensure_prompt_cache_key(body: &Bytes) -> (Bytes, Option<String>) {
    let Ok(Value::Object(mut obj)) = serde_json::from_slice::<Value>(body) else {
        return (body.clone(), None);
    };
    if let Some(k) = obj
        .get("prompt_cache_key")
        .and_then(|k| k.as_str())
        .filter(|k| !k.is_empty())
    {
        return (body.clone(), Some(k.to_string()));
    }
    let first = obj
        .get("input")
        .and_then(|i| i.as_array())
        .and_then(|a| a.first())
        .cloned();
    let Some(first) = first else {
        return (body.clone(), None);
    };
    let seed = serde_json::json!([
        obj.get("model").cloned().unwrap_or(Value::Null),
        obj.get("instructions").cloned().unwrap_or(Value::Null),
        first,
    ]);
    let key = Uuid::new_v5(&KEY_NAMESPACE, seed.to_string().as_bytes()).to_string();
    obj.insert("prompt_cache_key".into(), Value::String(key.clone()));
    match serde_json::to_vec(&obj) {
        Ok(v) => (Bytes::from(v), Some(key)),
        Err(_) => (body.clone(), None),
    }
}

/// Session headers the ChatGPT backend uses for cache routing (same value as the key).
pub fn session_headers(key: &str) -> [(&'static str, String); 2] {
    [
        ("session-id", key.to_string()),
        ("thread-id", key.to_string()),
    ]
}

/// Connections imported from `~/.codex/auth.json` borrow the Codex CLI's login: the CLI
/// owns the rotating refresh token, so thinrouter re-reads the file and never refreshes.
pub fn borrowed_source(conn: &crate::store::ConnectionRow) -> Option<PathBuf> {
    let oauth = conn.oauth.as_ref().filter(|o| o.provider == "codex")?;
    let meta: Value = serde_json::from_str(oauth.meta.as_deref()?).ok()?;
    let path = PathBuf::from(meta.get("source")?.as_str()?);
    (path.is_absolute() && path.file_name().is_some_and(|n| n == "auth.json")).then_some(path)
}

pub const BORROWED_HINT: &str =
    "the Codex CLI owns this login: run any `codex` command (or `codex login`) to refresh ~/.codex/auth.json";

/// (access token, ChatGPT account id) from a Codex CLI `auth.json`.
pub fn read_borrowed(path: &Path) -> anyhow::Result<(String, Option<String>)> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("read {}: {}", path.display(), e.kind()))?;
    let v: Value = serde_json::from_str(&raw)
        .map_err(|_| anyhow::anyhow!("{} is not valid JSON", path.display()))?;
    let access = v
        .pointer("/tokens/access_token")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .ok_or_else(|| {
            anyhow::anyhow!("{} has no access token; {BORROWED_HINT}", path.display())
        })?;
    let account = v
        .pointer("/tokens/account_id")
        .and_then(|t| t.as_str())
        .filter(|t| !t.is_empty())
        .map(str::to_string);
    Ok((access.to_string(), account))
}

/// Replace the connection's access token / account id with the file's current values.
pub fn apply_borrowed(conn: &mut crate::store::ConnectionRow, path: &Path) -> anyhow::Result<()> {
    let (access, account) = read_borrowed(path)?;
    if let Some(o) = conn.oauth.as_mut() {
        o.access_token = access;
        let mut meta: Value = o
            .meta
            .as_deref()
            .and_then(|m| serde_json::from_str(m).ok())
            .unwrap_or_else(|| serde_json::json!({}));
        if let (Some(obj), Some(acct)) = (meta.as_object_mut(), account) {
            obj.insert("account_id".into(), Value::String(acct));
        }
        o.meta = Some(meta.to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn key_of(v: Value) -> String {
        let (b, k) = ensure_prompt_cache_key(&Bytes::from(v.to_string()));
        let body: Value = serde_json::from_slice(&b).unwrap();
        assert_eq!(body["prompt_cache_key"], k.clone().unwrap());
        k.unwrap()
    }

    #[test]
    fn key_is_stable_across_turns_and_differs_between_conversations() {
        let first = json!({"type": "message", "role": "user", "content": [{"type": "input_text", "text": "plan a trip"}]});
        let turn1 = json!({"model": "m", "instructions": "sys", "input": [first]});
        let turn2 = json!({"model": "m", "instructions": "sys", "input": [first,
            {"type": "function_call", "call_id": "c", "name": "f", "arguments": "{}"},
            {"type": "function_call_output", "call_id": "c", "output": "x"}]});
        assert_eq!(key_of(turn1.clone()), key_of(turn2));
        let other = json!({"model": "m", "instructions": "sys", "input": [{"type": "message", "role": "user", "content": "other"}]});
        assert_ne!(key_of(turn1), key_of(other));
    }

    #[test]
    fn client_key_wins() {
        let v = json!({"prompt_cache_key": "mine", "input": [{"role": "user", "content": "x"}]});
        let (b, k) = ensure_prompt_cache_key(&Bytes::from(v.to_string()));
        assert_eq!(k.as_deref(), Some("mine"));
        assert_eq!(b, Bytes::from(v.to_string()));
    }

    #[test]
    fn borrowed_login_is_read_from_auth_json() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("auth.json");
        std::fs::write(
            &path,
            r#"{"tokens":{"access_token":"at-1","account_id":"acct"}}"#,
        )
        .unwrap();
        assert_eq!(
            read_borrowed(&path).unwrap(),
            ("at-1".to_string(), Some("acct".to_string()))
        );
        std::fs::write(&path, r#"{"tokens":{}}"#).unwrap();
        let err = read_borrowed(&path).unwrap_err().to_string();
        assert!(err.contains("codex"), "{err}");
        assert!(read_borrowed(&dir.path().join("missing/auth.json")).is_err());
    }

    #[test]
    fn parses_cli_version() {
        assert_eq!(
            parse_version("codex-cli 0.163.0\n").as_deref(),
            Some("0.163.0")
        );
        assert_eq!(
            parse_version("codex-cli 0.200.0-alpha.1").as_deref(),
            Some("0.200.0-alpha.1")
        );
        assert_eq!(parse_version("command not found"), None);
        assert_eq!(user_agent("1.2.3"), "codex_cli_rs/1.2.3");
    }
}

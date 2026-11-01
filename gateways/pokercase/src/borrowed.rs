//! Logins borrowed from a local CLI whose refresh tokens rotate (xAI / Grok CLI).
//!
//! If thinrouter refreshed such a login and kept the new pair only in its database, the
//! CLI's stored refresh token would stop working and log it out. So a connection imported
//! from the CLI's auth file reads the access token from that file on every upstream
//! attempt and is never refreshed or written by thinrouter; the CLI keeps it fresh.

use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::store::ConnectionRow;

pub const GROK_HINT: &str =
    "the Grok CLI owns this login: run `grok` (or log in again) to refresh ~/.grok/auth.json";

fn expand_home(p: &str) -> Option<PathBuf> {
    match p.strip_prefix("~/") {
        Some(rest) => dirs::home_dir().map(|h| h.join(rest)),
        None => Some(PathBuf::from(p)),
    }
}

/// The CLI auth file a connection borrows its login from, if any.
pub fn source(conn: &ConnectionRow) -> Option<PathBuf> {
    let oauth = conn.oauth.as_ref().filter(|o| o.provider == "grok")?;
    let meta: Value = serde_json::from_str(oauth.meta.as_deref()?).ok()?;
    let path = expand_home(meta.get("source")?.as_str()?)?;
    let is_grok_file = path.is_absolute()
        && path.file_name().is_some_and(|n| n == "auth.json")
        && path
            .parent()
            .and_then(|p| p.file_name())
            .is_some_and(|n| n == ".grok");
    is_grok_file.then_some(path)
}

/// Access token from a Grok CLI `auth.json` (the first entry holding a `key`).
pub fn read_grok(path: &Path) -> anyhow::Result<String> {
    let raw = std::fs::read_to_string(path)
        .map_err(|e| anyhow::anyhow!("read {}: {}", path.display(), e.kind()))?;
    let v: Value = serde_json::from_str(&raw)
        .map_err(|_| anyhow::anyhow!("{} is not valid JSON", path.display()))?;
    v.as_object()
        .into_iter()
        .flat_map(|m| m.values())
        .find_map(|e| {
            e.get("key")
                .and_then(|k| k.as_str())
                .filter(|k| !k.is_empty())
        })
        .map(str::to_string)
        .ok_or_else(|| anyhow::anyhow!("{} has no access token; {GROK_HINT}", path.display()))
}

/// Replace the connection's access token with the file's current one.
pub fn apply(conn: &mut ConnectionRow, path: &Path) -> anyhow::Result<()> {
    let access = read_grok(path)?;
    if let Some(o) = conn.oauth.as_mut() {
        o.access_token = access;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn grok_file_is_read_each_time() {
        let dir = tempfile::tempdir().unwrap();
        let grok = dir.path().join(".grok");
        std::fs::create_dir(&grok).unwrap();
        let path = grok.join("auth.json");
        std::fs::write(
            &path,
            r#"{"https://auth.x.ai":{"key":"at-1","refresh_token":"rt"}}"#,
        )
        .unwrap();
        assert_eq!(read_grok(&path).unwrap(), "at-1");
        std::fs::write(&path, r#"{"x":{"key":"at-2"}}"#).unwrap();
        assert_eq!(read_grok(&path).unwrap(), "at-2");
        std::fs::write(&path, r#"{"x":{}}"#).unwrap();
        assert!(read_grok(&path).unwrap_err().to_string().contains("grok"));
    }
}

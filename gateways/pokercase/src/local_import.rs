//! Import OAuth/session tokens from local agent CLI installs.

use std::path::PathBuf;

use anyhow::{Context, Result};
use serde_json::Value;

use crate::providers;
use crate::store::Store;

#[derive(Debug)]
pub struct ImportResult {
    pub provider: String,
    pub name: String,
    pub ok: bool,
    pub detail: String,
}

fn home() -> PathBuf {
    dirs::home_dir().unwrap_or_else(|| PathBuf::from("."))
}

/// Scan known agent credential paths and upsert oauth connections + simple routes.
pub fn import_all_local(store: &Store, make_routes: bool) -> Result<Vec<ImportResult>> {
    Ok(vec![
        import_claude(store, make_routes),
        import_grok(store, make_routes),
        import_cursor(store, make_routes),
        import_opencode(store, make_routes),
        import_agy(store, make_routes),
    ])
}

#[allow(
    clippy::too_many_arguments,
    reason = "Keep the existing import adapter's explicit credential and route fields aligned with Store::upsert_oauth_connection"
)]
fn upsert(
    store: &Store,
    name: &str,
    provider: &str,
    access: &str,
    refresh: Option<&str>,
    expires: Option<&str>,
    meta: Option<&str>,
    default_model: Option<&str>,
    make_routes: bool,
) -> ImportResult {
    let profile = providers::resolve(provider);
    let base = profile
        .map(|p| p.default_base_url)
        .unwrap_or("https://api.openai.com/v1");
    let model = default_model.or_else(|| profile.and_then(|p| p.default_model));
    match store.upsert_oauth_connection(
        None,
        name,
        base,
        profile.map(|p| p.id).unwrap_or(provider),
        access,
        refresh,
        expires,
        meta,
        model,
        100,
        true,
    ) {
        Ok(row) => {
            if make_routes {
                let public = format!("rt-{}", profile.map(|p| p.id).unwrap_or(provider));
                let _ = store.upsert_route(None, &public, "fallback", &[(row.id.clone(), None)]);
            }
            ImportResult {
                provider: provider.into(),
                name: name.into(),
                ok: true,
                detail: format!(
                    "id={} model={}",
                    &row.id[..8.min(row.id.len())],
                    model.unwrap_or("-")
                ),
            }
        }
        Err(e) => ImportResult {
            provider: provider.into(),
            name: name.into(),
            ok: false,
            detail: e.to_string(),
        },
    }
}

/// Claude needs no token import: the local Claude Code CLI answers with its own login.
fn import_claude(store: &Store, make_routes: bool) -> ImportResult {
    let bin = std::env::var("THINROUTER_CLAUDE_BIN").unwrap_or_else(|_| "claude".into());
    let found = std::process::Command::new(&bin)
        .arg("--version")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success());
    if !found {
        return ImportResult {
            provider: "claude".into(),
            name: "local-claude".into(),
            ok: false,
            detail: format!(
                "Claude Code CLI `{bin}` not found; install it and run `claude` once to sign in"
            ),
        };
    }
    upsert(
        store,
        "local-claude",
        "claude",
        "",
        None,
        None,
        Some(r#"{"source":"claude-code-cli"}"#),
        Some("sonnet"),
        make_routes,
    )
}

fn import_grok(store: &Store, make_routes: bool) -> ImportResult {
    let path = home().join(".grok/auth.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            return ImportResult {
                provider: "grok".into(),
                name: "local-grok".into(),
                ok: false,
                detail: format!("missing {}: {e}", path.display()),
            };
        }
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return ImportResult {
                provider: "grok".into(),
                name: "local-grok".into(),
                ok: false,
                detail: format!("parse: {e}"),
            };
        }
    };
    let entry = v.as_object().and_then(|m| {
        m.values()
            .find(|v| v.get("key").and_then(|k| k.as_str()).is_some())
    });
    let Some(entry) = entry else {
        return ImportResult {
            provider: "grok".into(),
            name: "local-grok".into(),
            ok: false,
            detail: "no key entry".into(),
        };
    };
    let access = entry.get("key").and_then(|k| k.as_str()).unwrap_or("");
    let refresh = entry.get("refresh_token").and_then(|t| t.as_str());
    let exp = entry.get("expires_at").and_then(|t| t.as_str());
    upsert(
        store,
        "local-grok",
        "grok",
        access,
        refresh,
        exp,
        Some(r#"{"source":"~/.grok/auth.json"}"#),
        Some("grok-build"),
        make_routes,
    )
}

fn import_cursor(store: &Store, make_routes: bool) -> ImportResult {
    let path = home().join(".config/cursor/auth.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            return ImportResult {
                provider: "cursor".into(),
                name: "local-cursor".into(),
                ok: false,
                detail: format!("missing {}: {e}", path.display()),
            };
        }
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return ImportResult {
                provider: "cursor".into(),
                name: "local-cursor".into(),
                ok: false,
                detail: format!("parse: {e}"),
            };
        }
    };
    let access = v.get("accessToken").and_then(|t| t.as_str()).unwrap_or("");
    let refresh = v.get("refreshToken").and_then(|t| t.as_str());
    if access.is_empty() {
        return ImportResult {
            provider: "cursor".into(),
            name: "local-cursor".into(),
            ok: false,
            detail: "no accessToken".into(),
        };
    }
    upsert(
        store,
        "local-cursor",
        "cursor",
        access,
        refresh,
        None,
        Some(r#"{"source":"~/.config/cursor/auth.json"}"#),
        Some("default"),
        make_routes,
    )
}

fn import_opencode(store: &Store, make_routes: bool) -> ImportResult {
    upsert(
        store,
        "local-opencode",
        "opencode",
        "",
        None,
        None,
        Some(r#"{"source":"builtin-free"}"#),
        Some("big-pickle"),
        make_routes,
    )
}

fn import_agy(store: &Store, make_routes: bool) -> ImportResult {
    let path = home().join(".gemini/antigravity-cli/antigravity-oauth-token");
    let raw = match std::fs::read_to_string(&path) {
        Ok(s) => s,
        Err(e) => {
            return ImportResult {
                provider: "agy".into(),
                name: "local-agy".into(),
                ok: false,
                detail: format!("missing {}: {e}", path.display()),
            };
        }
    };
    let v: Value = match serde_json::from_str(&raw) {
        Ok(v) => v,
        Err(e) => {
            return ImportResult {
                provider: "agy".into(),
                name: "local-agy".into(),
                ok: false,
                detail: format!("parse: {e}"),
            };
        }
    };
    let tok = &v["token"];
    let access = tok
        .get("access_token")
        .and_then(|t| t.as_str())
        .unwrap_or("");
    let refresh = tok.get("refresh_token").and_then(|t| t.as_str());
    let exp = tok.get("expiry").and_then(|t| t.as_str());
    if access.is_empty() && refresh.unwrap_or("").is_empty() {
        return ImportResult {
            provider: "agy".into(),
            name: "local-agy".into(),
            ok: false,
            detail: "no tokens".into(),
        };
    }
    // project is filled on first request via loadCodeAssist (or set THINROUTER_AGY_PROJECT)
    let project = std::env::var("THINROUTER_AGY_PROJECT").ok();
    let meta = serde_json::json!({
        "source": "~/.gemini/antigravity-cli/antigravity-oauth-token",
        "project": project,
    });
    upsert(
        store,
        "local-agy",
        "agy",
        access,
        refresh,
        exp,
        Some(&meta.to_string()),
        Some("gemini-2.5-flash"),
        make_routes,
    )
}

/// Also try refreshing all oauth connections that need it.
pub async fn refresh_all_oauth(store: &Store) -> Result<Vec<(String, bool, String)>> {
    use crate::oauth_refresh;
    let mut out = Vec::new();
    for c in store.list_connections().context("list")? {
        if c.auth_type != "oauth_import" {
            continue;
        }
        if c.oauth
            .as_ref()
            .and_then(|o| o.refresh_token.as_ref())
            .is_none()
        {
            continue;
        }
        match oauth_refresh::refresh_connection(store, &c).await {
            Ok(_) => out.push((c.name, true, "refreshed".into())),
            Err(e) => out.push((c.name, false, e.to_string())),
        }
    }
    Ok(out)
}

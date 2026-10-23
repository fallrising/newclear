//! Subscription / free provider registry for personal use.
//!
//! **Active** providers: codex, claude, cursor, grok, opencode, agy (antigravity).
//! Full protocol executors for Cursor protobuf / Antigravity Gemini envelope
//! are staged — tokens can be imported now; wire format completes as needed.
//!
//! See `docs/PROVIDERS.md` for the wishlist of everything else.

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum ProviderStatus {
    /// Token import + HTTP forward wired (best-effort for this format).
    Active,
    /// Token import OK; full upstream protocol still incomplete.
    Partial,
    /// Documented only — implement when you need it.
    Wishlist,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum UpstreamFormat {
    /// Standard POST …/chat/completions
    OpenAiChat,
    /// OpenAI Responses (Codex / Grok CLI style)
    OpenAiResponses,
    /// Anthropic Messages
    AnthropicMessages,
    /// Google Antigravity cloudcode-pa generateContent
    Antigravity,
    /// Cursor AgentService (HTTP/2 Connect+proto)
    CursorAgent,
    /// Not yet implemented — refuse generic chat forward
    Stub,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
#[allow(dead_code)]
pub enum AuthScheme {
    Bearer,
    /// Anthropic API-key style (we still send Bearer for OAuth imports).
    BearerAnthropic,
    /// OpenCode free: Authorization: Bearer public (or token if provided)
    BearerOrPublic,
    None,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProviderInfo {
    pub id: &'static str,
    pub aliases: Vec<&'static str>,
    pub display_name: &'static str,
    pub category: &'static str,
    pub status: ProviderStatus,
    pub default_base_url: &'static str,
    pub format: UpstreamFormat,
    pub default_model: Option<&'static str>,
    pub auth: AuthScheme,
    pub notes: &'static str,
}

#[derive(Debug, Clone, Copy)]
pub struct ProviderProfile {
    pub id: &'static str,
    pub aliases: &'static [&'static str],
    pub display_name: &'static str,
    pub category: &'static str,
    pub status: ProviderStatus,
    pub default_base_url: &'static str,
    pub format: UpstreamFormat,
    pub default_model: Option<&'static str>,
    pub auth: AuthScheme,
    pub extra_headers: &'static [(&'static str, &'static str)],
    /// Some upstreams (ChatGPT Codex) reject non-stream; force stream and reassemble.
    pub force_stream: bool,
    pub notes: &'static str,
}

impl ProviderProfile {
    pub fn to_info(self) -> ProviderInfo {
        ProviderInfo {
            id: self.id,
            aliases: self.aliases.to_vec(),
            display_name: self.display_name,
            category: self.category,
            status: self.status,
            default_base_url: self.default_base_url,
            format: self.format,
            default_model: self.default_model,
            auth: self.auth,
            notes: self.notes,
        }
    }
}

/// Providers you asked to support first.
pub const ACTIVE: &[ProviderProfile] = &[
    ProviderProfile {
        id: "codex",
        aliases: &["cx", "openai_codex", "chatgpt_codex"],
        display_name: "OpenAI Codex (ChatGPT subscription)",
        category: "oauth",
        status: ProviderStatus::Active,
        default_base_url: "https://chatgpt.com/backend-api/codex/responses",
        format: UpstreamFormat::OpenAiResponses,
        default_model: Some("gpt-5.6-sol"),
        auth: AuthScheme::Bearer,
        extra_headers: &[
            // User-Agent carries the detected/configured CLI version; see codex.rs.
            ("originator", "codex_cli_rs"),
            ("OpenAI-Beta", "responses=experimental"),
        ],
        force_stream: true,
        notes: "Codex requires stream=true. Prefer gpt-5.6-sol (not *-codex). Token: ~/.codex/auth.json",
    },
    ProviderProfile {
        id: "siwc",
        aliases: &["chatgpt_siwc", "openai_siwc", "sign_in_with_chatgpt"],
        display_name: "OpenAI API via Sign in with ChatGPT (official plan sharing)",
        category: "oauth",
        status: ProviderStatus::Active,
        default_base_url: "https://api.openai.com/v1",
        format: UpstreamFormat::OpenAiResponses,
        default_model: None,
        auth: AuthScheme::Bearer,
        extra_headers: &[],
        force_stream: true,
        notes: "Preferred over codex. Sign in with `thinrouter login-siwc`; store:false + stream:true enforced, unsupported fields dropped.",
    },
    ProviderProfile {
        id: "claude",
        aliases: &["cc", "anthropic", "claude_code"],
        display_name: "Claude Code (Anthropic subscription)",
        category: "oauth",
        status: ProviderStatus::Active,
        default_base_url: "https://api.anthropic.com/v1/messages",
        format: UpstreamFormat::AnthropicMessages,
        default_model: Some("claude-sonnet-4-5-20250929"),
        auth: AuthScheme::BearerAnthropic,
        extra_headers: &[
            ("Anthropic-Version", "2023-06-01"),
            (
                "Anthropic-Beta",
                "claude-code-20250219,oauth-2025-04-20,interleaved-thinking-2025-05-14",
            ),
            ("Anthropic-Dangerous-Direct-Browser-Access", "true"),
            ("User-Agent", "claude-cli/2.1.92 (external, sdk-cli)"),
            ("X-App", "cli"),
        ],
        force_stream: false,
        notes: "Anthropic Messages + OAuth bearer. Token: ~/.claude/.credentials.json",
    },
    ProviderProfile {
        id: "cursor",
        aliases: &["cu"],
        display_name: "Cursor IDE",
        category: "oauth",
        status: ProviderStatus::Active,
        default_base_url: "https://agent.api5.cursor.sh",
        format: UpstreamFormat::CursorAgent,
        default_model: Some("default"),
        auth: AuthScheme::Bearer,
        extra_headers: &[
            ("User-Agent", "connect-es/1.6.1"),
            ("connect-protocol-version", "1"),
        ],
        force_stream: false,
        notes: "AgentService HTTP/2 text chat. Token: ~/.config/cursor/auth.json. Tools not supported yet.",
    },
    ProviderProfile {
        id: "grok",
        aliases: &["xai", "grok_cli", "grok-shell"],
        display_name: "Grok CLI (xAI)",
        category: "oauth",
        status: ProviderStatus::Active,
        default_base_url: "https://cli-chat-proxy.grok.com/v1",
        format: UpstreamFormat::OpenAiResponses,
        default_model: Some("grok-build"),
        auth: AuthScheme::Bearer,
        extra_headers: &[
            ("User-Agent", "grok-shell/0.2.114 (linux; x86_64)"),
            ("x-grok-client", "grok-shell"),
            ("x-grok-client-version", "0.2.114"),
        ],
        force_stream: false,
        notes: "Grok CLI Responses API. Token: ~/.grok/auth.json",
    },
    ProviderProfile {
        id: "opencode",
        aliases: &["oc", "opencode_free"],
        display_name: "OpenCode Free",
        category: "free",
        status: ProviderStatus::Active,
        default_base_url: "https://opencode.ai/zen/v1",
        format: UpstreamFormat::OpenAiChat,
        default_model: Some("big-pickle"),
        auth: AuthScheme::BearerOrPublic,
        extra_headers: &[("x-opencode-client", "desktop")],
        force_stream: false,
        notes: "Free zen API. Token optional (Bearer public).",
    },
    ProviderProfile {
        id: "agy",
        aliases: &["ag", "antigravity", "google_antigravity"],
        display_name: "Antigravity (Google)",
        category: "oauth",
        status: ProviderStatus::Active,
        default_base_url: "https://cloudcode-pa.googleapis.com",
        format: UpstreamFormat::Antigravity,
        default_model: Some("gemini-2.5-flash"),
        auth: AuthScheme::Bearer,
        extra_headers: &[("User-Agent", "antigravity/ide/1.0 darwin/arm64")],
        force_stream: false,
        notes: "Token: ~/.gemini/antigravity-cli/antigravity-oauth-token. Uses loadCodeAssist project + generateContent. Set THINROUTER_AGY_CLIENT_* for refresh.",
    },
];

/// Known aliases → canonical id for wishlist / future work (not active).
pub const WISHLIST: &[(&str, &str)] = &[
    (
        "github_copilot",
        "GitHub Copilot — OAuth + copilot-token exchange",
    ),
    ("kiro", "Kiro free/subscription — custom executor"),
    ("gemini_cli", "Google Gemini CLI OAuth"),
    ("qwen", "Qwen / DashScope OAuth or API key"),
    ("iflow", "iFlow free tier"),
    ("vertex", "Google Vertex / free credits"),
    ("glm", "Zhipu GLM cheap API"),
    ("minimax", "MiniMax cheap API"),
    ("deepseek", "DeepSeek API key"),
    ("openrouter", "OpenRouter multi-model API key"),
    ("ollama", "Local Ollama OpenAI-compatible"),
    ("azure_openai", "Azure OpenAI deployments"),
    ("bedrock", "AWS Bedrock"),
    ("perplexity", "Perplexity web/API"),
    ("grok_web", "Grok web (non-CLI) scraper path"),
    ("codebuddy", "Tencent CodeBuddy"),
    ("qoder", "Qoder"),
    ("mimo_free", "MiMo free"),
    ("xiaomi_tokenplan", "Xiaomi token plan"),
];

pub fn resolve(id_or_alias: &str) -> Option<&'static ProviderProfile> {
    let key = id_or_alias.trim().to_ascii_lowercase();
    if key.is_empty() {
        return None;
    }
    ACTIVE
        .iter()
        .find(|p| p.id == key || p.aliases.iter().any(|a| a.eq_ignore_ascii_case(&key)))
}

pub fn default_base_url(id_or_alias: &str) -> &'static str {
    resolve(id_or_alias)
        .map(|p| p.default_base_url)
        .unwrap_or("https://api.openai.com/v1")
}

pub fn list_public() -> serde_json::Value {
    let active: Vec<_> = ACTIVE.iter().map(|p| p.to_info()).collect();
    let wishlist: Vec<_> = WISHLIST
        .iter()
        .map(|(id, note)| {
            serde_json::json!({
                "id": id,
                "status": "wishlist",
                "notes": note,
            })
        })
        .collect();
    serde_json::json!({
        "active": active,
        "wishlist": wishlist,
    })
}

/// Official upstream hosts per provider. OAuth tokens are only ever sent to these
/// (https, default port) or to an operator-supplied `--provider-base-override`.
fn official_hosts(provider_id: &str) -> &'static [&'static str] {
    match provider_id {
        "codex" => &["chatgpt.com"],
        "siwc" => &["api.openai.com"],
        "claude" => &["api.anthropic.com"],
        "cursor" => &["agent.api5.cursor.sh", "api2.cursor.sh"],
        "grok" => &["cli-chat-proxy.grok.com"],
        "opencode" => &["opencode.ai"],
        "agy" => &["cloudcode-pa.googleapis.com"],
        _ => &[],
    }
}

/// Is `base_url` an allowed upstream for this known provider?
pub fn base_url_allowed(
    profile: &ProviderProfile,
    base_url: &str,
    overrides: &[(String, String)],
) -> bool {
    let base = base_url.trim().trim_end_matches('/');
    let Ok(url) = reqwest::Url::parse(base) else {
        return false;
    };
    if !url.username().is_empty() || url.password().is_some() {
        return false;
    }
    let official = url.scheme() == "https"
        && url.port().is_none()
        && url
            .host_str()
            .is_some_and(|h| official_hosts(profile.id).contains(&h));
    official
        || overrides.iter().any(|(id, prefix)| {
            id == profile.id
                && (base == prefix
                    || base
                        .strip_prefix(prefix.as_str())
                        .is_some_and(|rest| rest.starts_with('/')))
        })
}

/// Validate a provider connection's base_url; error text is safe to return to clients.
pub fn check_base_url(
    profile: &ProviderProfile,
    base_url: &str,
    overrides: &[(String, String)],
) -> Result<(), String> {
    if base_url_allowed(profile, base_url, overrides) {
        Ok(())
    } else {
        Err(format!(
            "base_url for provider '{}' must be https on {} (or a --provider-base-override set by the operator)",
            profile.id,
            official_hosts(profile.id).join(", ")
        ))
    }
}

/// Build upstream POST URL for this provider + connection base_url.
pub fn build_upstream_url(profile: &ProviderProfile, base_url: &str) -> String {
    let base = base_url.trim_end_matches('/');
    match profile.format {
        UpstreamFormat::OpenAiChat => {
            if base.ends_with("/chat/completions") {
                base.to_string()
            } else {
                format!("{base}/chat/completions")
            }
        }
        UpstreamFormat::OpenAiResponses => {
            if base.ends_with("/responses") {
                base.to_string()
            } else {
                // codex stores full …/codex/responses
                format!("{base}/responses")
            }
        }
        UpstreamFormat::AnthropicMessages => {
            if base.ends_with("/messages") {
                // Claude Code often wants ?beta=true
                if base.contains('?') {
                    base.to_string()
                } else {
                    format!("{base}?beta=true")
                }
            } else {
                format!("{base}/messages?beta=true")
            }
        }
        UpstreamFormat::Antigravity => {
            // Full URL used by agy module; base kept for connection display.
            "https://cloudcode-pa.googleapis.com/v1internal:generateContent".into()
        }
        UpstreamFormat::CursorAgent => {
            "https://agent.api5.cursor.sh/agent.v1.AgentService/Run".into()
        }
        UpstreamFormat::Stub => base.to_string(),
    }
}

/// Authorization header value (including scheme) or None if no auth header.
pub fn authorization_header(profile: &ProviderProfile, token: &str) -> Option<String> {
    let token = token.trim();
    match profile.auth {
        AuthScheme::None => None,
        AuthScheme::BearerOrPublic => {
            if token.is_empty() {
                Some("Bearer public".into())
            } else {
                Some(format!("Bearer {token}"))
            }
        }
        AuthScheme::Bearer | AuthScheme::BearerAnthropic => {
            if token.is_empty() {
                None
            } else {
                Some(format!("Bearer {token}"))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_aliases() {
        assert_eq!(resolve("cx").unwrap().id, "codex");
        assert_eq!(resolve("claude").unwrap().id, "claude");
        assert_eq!(resolve("ag").unwrap().id, "agy");
        assert_eq!(resolve("antigravity").unwrap().id, "agy");
        assert_eq!(resolve("oc").unwrap().id, "opencode");
        assert!(resolve("nope").is_none());
    }

    #[test]
    fn base_url_allowlist_rejects_foreign_hosts() {
        let codex = resolve("codex").unwrap();
        assert!(base_url_allowed(codex, codex.default_base_url, &[]));
        for bad in [
            "https://evil.example/backend-api/codex/responses",
            "http://chatgpt.com/backend-api/codex/responses",
            "https://chatgpt.com:8443/backend-api/codex/responses",
            "https://chatgpt.com.evil.example/x",
            "https://user:pw@chatgpt.com/x",
            "not a url",
        ] {
            assert!(!base_url_allowed(codex, bad, &[]), "{bad}");
        }
        let ov = vec![("codex".to_string(), "http://127.0.0.1:9999".to_string())];
        assert!(base_url_allowed(codex, "http://127.0.0.1:9999/codex", &ov));
        assert!(!base_url_allowed(
            codex,
            "http://127.0.0.1:99990/codex",
            &ov
        ));
        let claude = resolve("claude").unwrap();
        assert!(!base_url_allowed(
            claude,
            "http://127.0.0.1:9999/codex",
            &ov
        ));
        for p in ACTIVE {
            assert!(base_url_allowed(p, p.default_base_url, &[]), "{}", p.id);
        }
    }

    #[test]
    fn codex_url() {
        let p = resolve("codex").unwrap();
        assert!(build_upstream_url(p, p.default_base_url).contains("responses"));
    }
}

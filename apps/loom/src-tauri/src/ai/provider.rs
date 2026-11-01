//! Provider trait — the multi-vendor seam. Each provider owns:
//!
//!   - Request construction (URL, headers, JSON body).
//!   - SSE event parsing into a normalized `StreamEvent` stream.
//!
//! Provider-specific quirks (cache_control header beta, OpenAI's
//! `stream_options: include_usage`, etc.) stay inside each impl. The
//! `Streamer` in `client.rs` is provider-agnostic.

use serde::Deserialize;

use super::error::AiError;

/// Logical name of the provider, for status / telemetry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProviderKind {
    Anthropic,
    OpenAi,
    DeepSeek,
    OpenCode,
}

impl ProviderKind {
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Anthropic => "anthropic",
            Self::OpenAi => "openai",
            Self::DeepSeek => "deepseek",
            Self::OpenCode => "opencode",
        }
    }

    /// Parse `LOOM_AI_PROVIDER`; the resolver rejects unrecognized explicit
    /// values and supplies defaults only when the variable is absent.
    #[must_use]
    pub fn parse(raw: &str) -> Option<Self> {
        match raw.trim().to_ascii_lowercase().as_str() {
            "anthropic" | "claude" => Some(Self::Anthropic),
            "openai" | "gpt" => Some(Self::OpenAi),
            "deepseek" => Some(Self::DeepSeek),
            "opencode" => Some(Self::OpenCode),
            _ => None,
        }
    }

    /// The env var carrying the API key for this provider.
    #[must_use]
    pub fn api_key_env(self) -> &'static str {
        match self {
            Self::Anthropic => "ANTHROPIC_API_KEY",
            Self::OpenAi => "OPENAI_API_KEY",
            Self::DeepSeek => "DEEPSEEK_API_KEY",
            Self::OpenCode => "OPENCODE_API_KEY",
        }
    }

    /// The default model when `LOOM_AI_MODEL` is unset.
    #[must_use]
    pub fn default_model(self) -> &'static str {
        match self {
            Self::Anthropic => "claude-sonnet-4-6",
            Self::OpenAi => "gpt-4o-mini",
            Self::DeepSeek => "deepseek-chat",
            Self::OpenCode => "",
        }
    }
}

/// Shared inputs every provider needs to build a request.
#[derive(Debug, Clone)]
pub struct ProviderConfig {
    pub api_key: String,
    pub model: String,
    pub system_prompt: String,
    pub max_tokens: u32,
}

/// A single pinned-context source the user attached via a `context_for`
/// canvas edge. `source` is a short label (e.g., relative path) shown in
/// the panel and embedded in the prompt so the model can reference it;
/// `content` is the full body.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct PinnedContext {
    pub source: String,
    pub content: String,
}

/// What the user asked, plus optional context the assistant should
/// ground its answer in. `context_doc` is "this doc" (always the active
/// document body). `pinned_context` is the set of other documents wired
/// in via incoming `context_for` edges on the canvas.
#[derive(Debug, Clone)]
pub struct CompletionInput {
    pub prompt: String,
    pub context_doc: Option<String>,
    pub pinned_context: Vec<PinnedContext>,
}

/// Normalized intermediate the `Streamer` turns into a single HTTP call.
pub struct PreparedRequest {
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: serde_json::Value,
}

/// Events produced by the provider's SSE parser. Internal to the AI
/// module — the service layer translates these to the `AiChunk` Tauri
/// payload.
#[derive(Debug, Clone)]
pub enum StreamEvent {
    /// A piece of text the assistant just produced.
    TextDelta(String),
    /// Usage update. Providers send these at varying times; the streamer
    /// folds them into a single final usage report.
    Usage(Usage),
    /// Required terminal marker (e.g., OpenAI's `[DONE]` line).
    /// The streamer completes immediately; EOF without it is an error.
    StreamDone,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Usage {
    #[serde(default)]
    pub input_tokens: u32,
    #[serde(default)]
    pub output_tokens: u32,
    #[serde(default)]
    pub cache_read_input_tokens: u32,
    #[serde(default)]
    pub cache_creation_input_tokens: u32,
}

pub trait Provider: Send + Sync {
    fn kind(&self) -> ProviderKind;

    fn prepare(&self, cfg: &ProviderConfig, input: &CompletionInput) -> PreparedRequest;

    /// Parse the `data:` payload of a single SSE event. Returns zero or
    /// more `StreamEvent`s (e.g., a single Anthropic event can emit just
    /// text, just usage, or nothing). Returns `Err` only on a payload we
    /// genuinely can't make sense of.
    fn parse_event(&self, data: &str) -> Result<Vec<StreamEvent>, AiError>;
}

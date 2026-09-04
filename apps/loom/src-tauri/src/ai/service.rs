//! High-level AI service used by Tauri commands. Owns the in-flight
//! requests, manages cancellation tokens, and emits chunk events via a
//! pluggable sink (Tauri's `AppHandle::emit` at the call site).

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;

use super::client::{CompletionRequest, Streamer};
use super::error::{AiError, AiResult};
use super::provider::{PinnedContext, Provider, ProviderConfig, ProviderKind, StreamEvent, Usage};
use super::providers::{AnthropicProvider, OpenAiProvider};

pub type AiRequestId = String;

#[derive(serde::Serialize, Clone)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum AiChunk {
    Started {
        request_id: AiRequestId,
    },
    Text {
        request_id: AiRequestId,
        delta: String,
    },
    Done {
        request_id: AiRequestId,
        usage: UsageDto,
    },
    Error {
        request_id: AiRequestId,
        message: String,
    },
    Cancelled {
        request_id: AiRequestId,
    },
}

#[derive(serde::Serialize, Clone, Default)]
pub struct UsageDto {
    pub input_tokens: u32,
    pub output_tokens: u32,
    pub cache_read_input_tokens: u32,
    pub cache_creation_input_tokens: u32,
}

impl From<Usage> for UsageDto {
    fn from(u: Usage) -> Self {
        Self {
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens,
            cache_creation_input_tokens: u.cache_creation_input_tokens,
        }
    }
}

#[derive(serde::Serialize, Clone)]
pub struct AiStatus {
    pub provider: String,
    pub model: String,
    pub key_present: bool,
    /// Env var the user needs to set for the active provider's key. The
    /// frontend reads this to produce a friendly empty-state message
    /// without hard-coding per-provider strings.
    pub key_env: String,
}

const PROVIDER_ENV: &str = "LOOM_AI_PROVIDER";
const MODEL_ENV: &str = "LOOM_AI_MODEL";
const DEFAULT_MAX_TOKENS: u32 = 2048;
const MAX_TOKENS_ENV: &str = "LOOM_AI_MAX_TOKENS";
const SYSTEM_PROMPT: &str = "\
You are an assistant embedded inside Loom — an AI-native workspace whose \
plain-text markdown documents live next to live PTY terminals on a \
spatial canvas. The user is iterating on a plan or notes. When they ask, \
expand, revise, or annotate — directly, concisely, with valid markdown. \
Prefer fenced code blocks for commands the user would run; use plain \
prose for analysis. Don't repeat the user's document back to them.";

pub struct AiService {
    inflight: Mutex<HashMap<AiRequestId, CancellationToken>>,
}

impl AiService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inflight: Mutex::new(HashMap::new()),
        }
    }

    pub fn status() -> AiStatus {
        let kind = active_provider_kind();
        let key_env = kind.api_key_env();
        let key_present = std::env::var(key_env)
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let model = std::env::var(MODEL_ENV).unwrap_or_else(|_| kind.default_model().into());
        AiStatus {
            provider: kind.as_str().into(),
            model,
            key_present,
            key_env: key_env.into(),
        }
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        if let Some(tok) = self.inflight.lock().remove(request_id) {
            tok.cancel();
            true
        } else {
            false
        }
    }

    /// Start a streaming completion. The `emit_chunk` callback is
    /// invoked from this task's runtime with each event in the order
    /// they should be observed by the frontend.
    pub async fn run<F>(
        &self,
        request_id: AiRequestId,
        prompt: String,
        context_doc: Option<String>,
        pinned_context: Vec<PinnedContext>,
        mut emit_chunk: F,
    ) -> AiResult<()>
    where
        F: FnMut(AiChunk) + Send + 'static,
    {
        let (cfg, provider) = Self::build_call()?;
        let cancel = CancellationToken::new();
        self.inflight
            .lock()
            .insert(request_id.clone(), cancel.clone());

        emit_chunk(AiChunk::Started {
            request_id: request_id.clone(),
        });

        let streamer = Streamer::new(cfg, provider);
        let req = CompletionRequest {
            prompt,
            context_doc,
            pinned_context,
        };
        let req_id_for_callback = request_id.clone();
        let result = streamer
            .stream(req, cancel, request_id.clone(), move |ev| match ev {
                StreamEvent::TextDelta(text) => emit_chunk(AiChunk::Text {
                    request_id: req_id_for_callback.clone(),
                    delta: text,
                }),
                StreamEvent::Usage(u) => emit_chunk(AiChunk::Done {
                    request_id: req_id_for_callback.clone(),
                    usage: u.into(),
                }),
                StreamEvent::StreamDone => {}
            })
            .await;

        self.inflight.lock().remove(&request_id);

        match result {
            Ok(_) => Ok(()),
            Err(AiError::Cancelled(_)) => Err(AiError::Cancelled(request_id)),
            Err(e) => Err(e),
        }
    }

    fn build_call() -> AiResult<(ProviderConfig, Box<dyn Provider>)> {
        let kind = active_provider_kind();
        let key_env = kind.api_key_env();
        let api_key = std::env::var(key_env)
            .map(|v| v.trim().to_string())
            .ok()
            .filter(|v| !v.is_empty())
            .ok_or(AiError::MissingApiKey)?;
        let model = std::env::var(MODEL_ENV).unwrap_or_else(|_| kind.default_model().into());
        let max_tokens = std::env::var(MAX_TOKENS_ENV)
            .ok()
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|n| *n > 0)
            .unwrap_or(DEFAULT_MAX_TOKENS);
        let cfg = ProviderConfig {
            api_key,
            model,
            system_prompt: SYSTEM_PROMPT.into(),
            max_tokens,
        };
        let provider: Box<dyn Provider> = match kind {
            ProviderKind::Anthropic => Box::new(AnthropicProvider),
            ProviderKind::OpenAi => Box::new(OpenAiProvider::openai()),
            ProviderKind::DeepSeek => Box::new(OpenAiProvider::deepseek()),
        };
        Ok((cfg, provider))
    }
}

impl Default for AiService {
    fn default() -> Self {
        Self::new()
    }
}

fn active_provider_kind() -> ProviderKind {
    std::env::var(PROVIDER_ENV)
        .ok()
        .and_then(|raw| ProviderKind::parse(&raw))
        .unwrap_or(ProviderKind::Anthropic)
}

/// Wrap an `Arc<AiService>` so Tauri's `manage` can store it.
pub type SharedAi = Arc<AiService>;

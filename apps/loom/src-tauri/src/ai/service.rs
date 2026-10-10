//! High-level AI service used by Tauri commands. Owns the in-flight
//! requests, manages cancellation tokens, and emits chunk events via a
//! pluggable sink (Tauri's `AppHandle::emit` at the call site).

use std::collections::HashMap;
use std::sync::Arc;

use parking_lot::Mutex;
use tokio_util::sync::CancellationToken;

use super::client::{CompletionRequest, Streamer};
use super::config::{AiSettings, WireProtocol};
use super::error::{AiError, AiResult};
use super::provider::{
    CompletionInput, PinnedContext, PreparedRequest, Provider, ProviderConfig, ProviderKind,
    StreamEvent, Usage,
};
use super::providers::{AnthropicProvider, OpenAiProvider, ResponsesProvider};

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
    pub protocol: Option<String>,
    pub base_url: Option<String>,
    pub configuration_error: Option<String>,
}

const SYSTEM_PROMPT: &str = "\
You are an assistant embedded inside Loom — an AI-native workspace whose \
plain-text markdown documents live next to live PTY terminals on a \
spatial canvas. The user is iterating on a plan or notes. When they ask, \
expand, revise, or annotate — directly, concisely, with valid markdown. \
Prefer fenced code blocks for commands the user would run; use plain \
prose for analysis. Don't repeat the user's document back to them.";

pub struct AiService {
    inflight: Inflight,
    settings: Option<AiSettings>,
    session_id: String,
}

impl AiService {
    #[must_use]
    pub fn new() -> Self {
        Self {
            inflight: Arc::new(Mutex::new(HashMap::new())),
            settings: None,
            session_id: uuid::Uuid::now_v7().to_string(),
        }
    }

    /// Use already validated settings, without reading global environment.
    #[must_use]
    pub fn with_settings(settings: AiSettings) -> Self {
        Self {
            settings: Some(settings),
            ..Self::new()
        }
    }

    #[must_use]
    pub fn status() -> AiStatus {
        Self::status_for(AiSettings::from_env())
    }

    #[must_use]
    pub fn current_status(&self) -> AiStatus {
        Self::status_for(self.resolve_settings())
    }

    fn status_for(settings: AiResult<AiSettings>) -> AiStatus {
        match settings {
            Ok(settings) => settings.status(),
            Err(error) => AiStatus {
                provider: "unconfigured".into(),
                model: String::new(),
                key_present: false,
                key_env: String::new(),
                protocol: None,
                base_url: None,
                configuration_error: Some(error.to_string()),
            },
        }
    }

    fn resolve_settings(&self) -> AiResult<AiSettings> {
        self.settings.clone().map_or_else(AiSettings::from_env, Ok)
    }

    pub fn cancel(&self, request_id: &str) -> bool {
        if let Some(token) = self.inflight.lock().get(request_id) {
            // Retain ownership until the execution is dropped or finishes. A
            // cancelled execution must still exclude duplicate admissions.
            token.cancel();
            true
        } else {
            false
        }
    }

    /// Register before handing work to a runtime or returning its ID to IPC.
    /// Dropping this value (or its run future) releases the registration.
    pub fn admit(&self, request_id: AiRequestId) -> AiResult<AdmittedAiRequest> {
        let cancel = Arc::new(CancellationToken::new());
        {
            let mut inflight = self.inflight.lock();
            if inflight.contains_key(&request_id) {
                return Err(AiError::DuplicateRequest(request_id));
            }
            inflight.insert(request_id.clone(), cancel.clone());
        }
        let registration = Registration {
            inflight: self.inflight.clone(),
            request_id,
            cancel,
        };
        Ok(AdmittedAiRequest {
            registration,
            // Snapshot settings now, but preserve configuration errors as run
            // results so IPC continues to emit its single error terminal.
            call: self.build_call(),
        })
    }

    /// Start a streaming completion. Admission happens at future creation,
    /// while execution and callbacks begin when the future is polled.
    pub fn run<F>(
        &self,
        request_id: AiRequestId,
        prompt: String,
        context_doc: Option<String>,
        pinned_context: Vec<PinnedContext>,
        emit_chunk: F,
    ) -> impl std::future::Future<Output = AiResult<()>> + Send + 'static
    where
        F: FnMut(AiChunk) + Send + 'static,
    {
        let admitted = self.admit(request_id);
        async move {
            admitted?
                .run(prompt, context_doc, pinned_context, emit_chunk)
                .await
        }
    }

    fn build_call(&self) -> AiResult<(ProviderConfig, Box<dyn Provider>)> {
        let settings = self.resolve_settings()?;
        let api_key = settings.api_key.ok_or(AiError::MissingApiKey)?;
        let cfg = ProviderConfig {
            api_key,
            model: settings.model,
            system_prompt: SYSTEM_PROMPT.into(),
            max_tokens: settings.max_tokens,
        };
        let inner: Box<dyn Provider> = match settings.protocol {
            WireProtocol::Messages => Box::new(AnthropicProvider),
            WireProtocol::ChatCompletions => Box::new(OpenAiProvider::openai()),
            WireProtocol::Responses => Box::new(ResponsesProvider),
        };
        let provider = ConfiguredProvider {
            inner,
            kind: settings.provider,
            url: format!("{}/{}", settings.base_url, settings.protocol.operation()),
            session_id: self.session_id.clone(),
        };
        Ok((cfg, Box::new(provider)))
    }
}

type Inflight = Arc<Mutex<HashMap<AiRequestId, Arc<CancellationToken>>>>;

struct Registration {
    inflight: Inflight,
    request_id: AiRequestId,
    cancel: Arc<CancellationToken>,
}

impl Registration {
    fn complete(&self) -> bool {
        let mut inflight = self.inflight.lock();
        // Serialize cancellation with committing success. Release the lock
        // before the callback, which may cancel or admit another request.
        if self.cancel.is_cancelled() {
            return false;
        }
        if inflight
            .get(&self.request_id)
            .is_some_and(|token| Arc::ptr_eq(token, &self.cancel))
        {
            inflight.remove(&self.request_id);
        }
        true
    }
}

impl Drop for Registration {
    fn drop(&mut self) {
        let mut inflight = self.inflight.lock();
        // Only this execution can release its slot, even if an ID is reused.
        if inflight
            .get(&self.request_id)
            .is_some_and(|token| Arc::ptr_eq(token, &self.cancel))
        {
            inflight.remove(&self.request_id);
        }
    }
}

/// An owned, synchronously registered execution. It is intentionally not
/// cloneable: exactly one execution owns cancellation and cleanup for its ID.
#[must_use = "dropping an admitted request releases its cancellation registration"]
pub struct AdmittedAiRequest {
    registration: Registration,
    call: AiResult<(ProviderConfig, Box<dyn Provider>)>,
}

impl AdmittedAiRequest {
    /// Consume admission into a future that keeps registration alive through
    /// completion, cancellation, or task abortion (including before polling).
    pub async fn run<F>(
        self,
        prompt: String,
        context_doc: Option<String>,
        pinned_context: Vec<PinnedContext>,
        mut emit_chunk: F,
    ) -> AiResult<()>
    where
        F: FnMut(AiChunk) + Send + 'static,
    {
        let request_id = self.registration.request_id.clone();
        let cancel = self.registration.cancel.as_ref().clone();
        if cancel.is_cancelled() {
            return Err(AiError::Cancelled(request_id));
        }
        let (cfg, provider) = self.call?;
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
        let registration = &self.registration;
        let result = streamer
            .stream(
                req,
                cancel.clone(),
                request_id.clone(),
                move |ev| match ev {
                    StreamEvent::TextDelta(text) => emit_chunk(AiChunk::Text {
                        request_id: req_id_for_callback.clone(),
                        delta: text,
                    }),
                    StreamEvent::Usage(u) => {
                        if registration.complete() {
                            emit_chunk(AiChunk::Done {
                                request_id: req_id_for_callback.clone(),
                                usage: u.into(),
                            });
                        }
                    }
                    StreamEvent::StreamDone => {}
                },
            )
            .await;
        match result {
            Ok(_) if cancel.is_cancelled() => Err(AiError::Cancelled(request_id)),
            Ok(_) => Ok(()),
            Err(AiError::Cancelled(_)) => Err(AiError::Cancelled(request_id)),
            Err(e) => Err(e),
        }
    }
}

/// Keep wire-format adapters unchanged; configured routing and gateway identity
/// are orthogonal to authentication/body/parser semantics.
struct ConfiguredProvider {
    inner: Box<dyn Provider>,
    kind: ProviderKind,
    url: String,
    session_id: String,
}

impl Provider for ConfiguredProvider {
    fn kind(&self) -> ProviderKind {
        self.kind
    }

    fn prepare(&self, cfg: &ProviderConfig, input: &CompletionInput) -> PreparedRequest {
        let mut request = self.inner.prepare(cfg, input);
        request.url.clone_from(&self.url);
        if self.kind == ProviderKind::OpenCode {
            request
                .headers
                .push(("user-agent".into(), "loom/0.1.0".into()));
            request
                .headers
                .push(("x-opencode-session".into(), self.session_id.clone()));
        }
        request
    }

    fn parse_event(&self, data: &str) -> AiResult<Vec<StreamEvent>> {
        self.inner.parse_event(data)
    }
}

impl Default for AiService {
    fn default() -> Self {
        Self::new()
    }
}

/// Wrap an `Arc<AiService>` so Tauri's `manage` can store it.
pub type SharedAi = Arc<AiService>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn invalid_configuration_status_disables_sending_without_echoing_input() {
        let settings = AiSettings::resolve(|name| {
            (name == "LOOM_AI_BASE_URL").then(|| "https://secret-user:secret-key@gateway/v1".into())
        });
        let status = AiService::status_for(settings);
        assert!(!status.key_present);
        assert!(status.protocol.is_none());
        assert!(status.base_url.is_none());
        let error = status.configuration_error.unwrap();
        assert!(error.contains("LOOM_AI_BASE_URL"));
        assert!(!error.contains("secret"));
    }
}

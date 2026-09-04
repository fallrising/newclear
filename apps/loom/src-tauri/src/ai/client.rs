//! Provider-agnostic HTTP + SSE streamer.
//!
//! Anthropic-specific quirks (cache_control, `x-api-key`, message-event
//! taxonomy) and OpenAI-style quirks (Bearer auth, `[DONE]` sentinel,
//! chat-completions chunks) live in `providers/`. Everything here is
//! the same shape regardless of vendor:
//!
//! 1. Ask the `Provider` to `prepare` a `PreparedRequest`.
//! 2. POST it.
//! 3. Parse the SSE response a frame at a time, handing each `data:`
//!    payload to `provider.parse_event` for normalization into
//!    `StreamEvent`s.
//! 4. Bail at the first `Cancelled` token wake-up.

use futures_util::StreamExt;

use super::error::{AiError, AiResult};
use super::provider::{CompletionInput, Provider, ProviderConfig, StreamEvent, Usage};

/// Public façade re-exports for the rest of the crate.
pub use super::provider::CompletionInput as CompletionRequest;

pub struct Streamer {
    cfg: ProviderConfig,
    provider: Box<dyn Provider>,
}

impl Streamer {
    #[must_use]
    pub fn new(cfg: ProviderConfig, provider: Box<dyn Provider>) -> Self {
        Self { cfg, provider }
    }

    /// Drive a streamed completion, invoking `on_event` once per logical
    /// `StreamEvent`. Honors `cancel_token`: when it resolves the stream
    /// is dropped and the function returns `Err(AiError::Cancelled)`.
    pub async fn stream<E>(
        &self,
        req: CompletionInput,
        cancel_token: tokio_util::sync::CancellationToken,
        request_id: String,
        mut on_event: E,
    ) -> AiResult<Usage>
    where
        E: FnMut(StreamEvent),
    {
        let prepared = self.provider.prepare(&self.cfg, &req);
        let client = reqwest::Client::builder().build()?;
        let mut builder = client.post(&prepared.url).json(&prepared.body);
        for (k, v) in prepared.headers {
            builder = builder.header(k, v);
        }

        let resp = tokio::select! {
            r = builder.send() => r?,
            () = cancel_token.cancelled() => return Err(AiError::Cancelled(request_id)),
        };

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = resp.text().await.unwrap_or_default();
            return Err(AiError::Api { status, body });
        }

        let mut byte_stream = resp.bytes_stream();
        let mut buf = String::new();
        let mut usage = Usage::default();
        let mut stream_done = false;

        loop {
            if stream_done {
                break;
            }
            tokio::select! {
                chunk = byte_stream.next() => {
                    let Some(chunk) = chunk else { break };
                    let bytes = chunk?;
                    buf.push_str(&String::from_utf8_lossy(&bytes));
                    while let Some(idx) = buf.find("\n\n") {
                        let event_str: String = buf.drain(..=idx + 1).collect();
                        let Some(payload) = extract_data_payload(&event_str) else { continue };
                        for ev in self.provider.parse_event(&payload)? {
                            match ev {
                                StreamEvent::TextDelta(text) => {
                                    on_event(StreamEvent::TextDelta(text));
                                }
                                StreamEvent::Usage(u) => {
                                    usage = merge_usage(&usage, &u);
                                }
                                StreamEvent::StreamDone => {
                                    stream_done = true;
                                }
                            }
                        }
                    }
                }
                () = cancel_token.cancelled() => {
                    return Err(AiError::Cancelled(request_id));
                }
            }
        }

        on_event(StreamEvent::Usage(usage.clone()));
        Ok(usage)
    }
}

/// Pull the `data:` line(s) out of an SSE event. Returns `None` for
/// keep-alives / event-only lines.
fn extract_data_payload(event: &str) -> Option<String> {
    let mut out = String::new();
    for line in event.lines() {
        if let Some(rest) = line.strip_prefix("data:") {
            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(rest.trim_start());
        }
    }
    if out.is_empty() {
        None
    } else {
        Some(out)
    }
}

fn merge_usage(a: &Usage, b: &Usage) -> Usage {
    Usage {
        input_tokens: a.input_tokens.max(b.input_tokens),
        output_tokens: a.output_tokens + b.output_tokens,
        cache_read_input_tokens: a.cache_read_input_tokens.max(b.cache_read_input_tokens),
        cache_creation_input_tokens: a
            .cache_creation_input_tokens
            .max(b.cache_creation_input_tokens),
    }
}

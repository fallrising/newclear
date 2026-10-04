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
            biased;
            () = cancel_token.cancelled() => return Err(AiError::Cancelled(request_id)),
            r = builder.send() => r?,
        };

        if !resp.status().is_success() {
            let status = resp.status().as_u16();
            let body = tokio::select! {
                biased;
                () = cancel_token.cancelled() => return Err(AiError::Cancelled(request_id)),
                body = resp.text() => body?,
            };
            return Err(AiError::Api { status, body });
        }

        let mut byte_stream = resp.bytes_stream();
        let mut decoder = SseDecoder::default();
        let mut usage = Usage::default();

        loop {
            let chunk = tokio::select! {
                biased;
                () = cancel_token.cancelled() => return Err(AiError::Cancelled(request_id)),
                chunk = byte_stream.next() => chunk,
            };
            let Some(chunk) = chunk else {
                return Err(AiError::Stream(
                    "EOF before provider terminal marker".into(),
                ));
            };
            for &byte in chunk?.iter() {
                if cancel_token.is_cancelled() {
                    return Err(AiError::Cancelled(request_id));
                }
                let Some(payload) = decoder.push(byte)? else {
                    continue;
                };
                for event in self.provider.parse_event(&payload)? {
                    if cancel_token.is_cancelled() {
                        return Err(AiError::Cancelled(request_id));
                    }
                    match event {
                        StreamEvent::TextDelta(text) => on_event(StreamEvent::TextDelta(text)),
                        StreamEvent::Usage(update) => usage = merge_usage(&usage, &update),
                        StreamEvent::StreamDone => {
                            // Do not parse trailing frames in the same HTTP chunk,
                            // or wait for the server to close the connection.
                            on_event(StreamEvent::Usage(usage.clone()));
                            return Ok(usage);
                        }
                    }
                }
            }
        }
    }
}

/// Incremental SSE framing. Decode a line only after its delimiter arrives,
/// preserving UTF-8 even when an HTTP chunk ends inside a character. CRLF,
/// LF and CR delimit lines; data fields join with a single newline. Invalid
/// UTF-8 is an error instead of silently altering provider JSON/text.
#[derive(Default)]
struct SseDecoder {
    line: Vec<u8>,
    data: Vec<String>,
    skip_lf: bool,
}

impl SseDecoder {
    fn push(&mut self, byte: u8) -> AiResult<Option<String>> {
        if std::mem::take(&mut self.skip_lf) && byte == b'\n' {
            return Ok(None);
        }
        if byte != b'\r' && byte != b'\n' {
            self.line.push(byte);
            return Ok(None);
        }
        self.skip_lf = byte == b'\r';
        let bytes = std::mem::take(&mut self.line);
        let line = std::str::from_utf8(&bytes)
            .map_err(|error| AiError::Stream(format!("invalid SSE UTF-8: {error}")))?;
        if line.is_empty() {
            return Ok(if self.data.is_empty() {
                None
            } else {
                Some(std::mem::take(&mut self.data).join("\n"))
            });
        }
        if let Some(data) = data_field(line) {
            self.data.push(data.to_owned());
        }
        Ok(None)
    }
}

fn data_field(line: &str) -> Option<&str> {
    let (field, value) = line.split_once(':').unwrap_or((line, ""));
    (field == "data").then(|| value.strip_prefix(' ').unwrap_or(value))
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

#[cfg(test)]
#[path = "client_tests.rs"]
mod tests;

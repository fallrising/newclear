//! Responses API text adapter. Only deltas enter document output;
//! final response usage is emitted immediately before the terminal marker.
//! Gateway URL/kind/headers are handled by the configuration wrapper.

use serde::Deserialize;

use crate::ai::error::AiError;
use crate::ai::provider::{
    CompletionInput, PreparedRequest, Provider, ProviderConfig, ProviderKind, StreamEvent, Usage,
};

pub struct ResponsesProvider;

impl Provider for ResponsesProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::OpenAi
    }

    fn prepare(&self, cfg: &ProviderConfig, input: &CompletionInput) -> PreparedRequest {
        PreparedRequest {
            url: "https://api.openai.com/v1/responses".into(),
            headers: vec![
                ("authorization".into(), format!("Bearer {}", cfg.api_key)),
                ("content-type".into(), "application/json".into()),
            ],
            body: serde_json::json!({
                "model": cfg.model,
                "instructions": cfg.system_prompt,
                "input": build_input(input),
                "max_output_tokens": cfg.max_tokens,
                "stream": true,
            }),
        }
    }

    fn parse_event(&self, data: &str) -> Result<Vec<StreamEvent>, AiError> {
        // Do not attach raw payloads: malformed events can contain user
        // context or credentials echoed by a gateway.
        let event: ResponseEvent = serde_json::from_str(data)
            .map_err(|error| AiError::Stream(format!("responses SSE parse: {error}")))?;
        match event {
            ResponseEvent::OutputTextDelta { delta } | ResponseEvent::RefusalDelta { delta } => {
                Ok(if delta.is_empty() {
                    vec![]
                } else {
                    vec![StreamEvent::TextDelta(delta)]
                })
            }
            ResponseEvent::Completed { response } => {
                require_status(&response, "completed")?;
                let mut events = Vec::new();
                if let Some(usage) = response.usage {
                    let details = usage.input_tokens_details.unwrap_or_default();
                    events.push(StreamEvent::Usage(Usage {
                        input_tokens: usage.input_tokens,
                        output_tokens: usage.output_tokens,
                        cache_read_input_tokens: details.cached_tokens,
                        cache_creation_input_tokens: details.cache_write_tokens,
                    }));
                }
                events.push(StreamEvent::StreamDone);
                Ok(events)
            }
            ResponseEvent::Failed { response } => {
                require_status(&response, "failed")?;
                Err(AiError::Stream(response.error.map_or_else(
                    || "Responses generation failed".into(),
                    |error| error.message,
                )))
            }
            ResponseEvent::Incomplete { response } => {
                require_status(&response, "incomplete")?;
                let reason = response
                    .incomplete_details
                    .map_or_else(|| "unspecified reason".into(), |details| details.reason);
                Err(AiError::Stream(format!(
                    "Responses generation incomplete: {reason}"
                )))
            }
            ResponseEvent::Error { message } => Err(AiError::Stream(message)),
            ResponseEvent::Created { response } | ResponseEvent::InProgress { response } => {
                // Validate lifecycle envelopes but never count provisional usage.
                require_status(&response, "in_progress")?;
                Ok(vec![])
            }
            ResponseEvent::Queued { response } => {
                require_status(&response, "queued")?;
                Ok(vec![])
            }
            ResponseEvent::OutputTextDone { .. }
            | ResponseEvent::RefusalDone { .. }
            | ResponseEvent::Metadata => Ok(vec![]),
        }
    }
}

// Fields consumed by this text adapter are required and typed. Unknown
// event types remain forward-compatible metadata, including tool/reasoning
// events. Aggregate text events are validated but never emitted again.
#[derive(Deserialize)]
#[serde(tag = "type")]
enum ResponseEvent {
    #[serde(rename = "response.output_text.delta")]
    OutputTextDelta { delta: String },
    #[serde(rename = "response.refusal.delta")]
    RefusalDelta { delta: String },
    #[serde(rename = "response.output_text.done")]
    OutputTextDone {
        #[serde(rename = "text")]
        _text: String,
    },
    #[serde(rename = "response.refusal.done")]
    RefusalDone {
        #[serde(rename = "refusal")]
        _refusal: String,
    },
    #[serde(rename = "response.completed")]
    Completed { response: Response },
    #[serde(rename = "response.failed")]
    Failed { response: Response },
    #[serde(rename = "response.incomplete")]
    Incomplete { response: Response },
    #[serde(rename = "error")]
    Error { message: String },
    #[serde(rename = "response.created")]
    Created { response: Response },
    #[serde(rename = "response.in_progress")]
    InProgress { response: Response },
    #[serde(rename = "response.queued")]
    Queued { response: Response },
    #[serde(other)]
    Metadata,
}

#[derive(Deserialize)]
struct Response {
    status: String,
    usage: Option<ResponseUsage>,
    error: Option<ResponseError>,
    incomplete_details: Option<IncompleteDetails>,
}

#[derive(Deserialize)]
struct ResponseUsage {
    input_tokens: u32,
    output_tokens: u32,
    input_tokens_details: Option<InputTokenDetails>,
}

#[derive(Default, Deserialize)]
struct InputTokenDetails {
    #[serde(default)]
    cached_tokens: u32,
    #[serde(default)]
    cache_write_tokens: u32,
}

#[derive(Deserialize)]
struct ResponseError {
    message: String,
}

#[derive(Deserialize)]
struct IncompleteDetails {
    reason: String,
}

fn require_status(response: &Response, expected: &str) -> Result<(), AiError> {
    if response.status == expected {
        Ok(())
    } else {
        Err(AiError::Stream(format!(
            "responses event requires status {expected}"
        )))
    }
}

fn build_input(input: &CompletionInput) -> String {
    use std::fmt::Write as _;

    let mut out = String::new();
    for context in &input.pinned_context {
        let _ = writeln!(
            out,
            "<context source=\"{}\">\n{}\n</context>\n",
            context.source, context.content
        );
    }
    match &input.context_doc {
        Some(doc) if !doc.trim().is_empty() => {
            let _ = write!(
                out,
                "The following is the user's current document:\n\n---\n{doc}\n---\n\nUser's instruction:\n{}",
                input.prompt
            );
        }
        _ => out.push_str(&input.prompt),
    }
    out
}

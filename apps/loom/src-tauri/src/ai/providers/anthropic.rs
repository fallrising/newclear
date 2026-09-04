//! Anthropic provider — /v1/messages with prompt caching beta. The
//! system prompt is wrapped in a `cache_control: ephemeral` block so
//! repeat calls within the 5-minute TTL pay 10% on the cached portion.

use serde::{Deserialize, Serialize};

use crate::ai::error::AiError;
use crate::ai::provider::{
    CompletionInput, PreparedRequest, Provider, ProviderConfig, ProviderKind, StreamEvent,
    Usage as ProviderUsage,
};

const API_URL: &str = "https://api.anthropic.com/v1/messages";
const API_VERSION: &str = "2023-06-01";
const CACHE_BETA: &str = "prompt-caching-2024-07-31";

pub struct AnthropicProvider;

impl Provider for AnthropicProvider {
    fn kind(&self) -> ProviderKind {
        ProviderKind::Anthropic
    }

    fn prepare(&self, cfg: &ProviderConfig, input: &CompletionInput) -> PreparedRequest {
        let user_content = build_user_content(input);
        let body = serde_json::json!({
            "model": cfg.model,
            "max_tokens": cfg.max_tokens,
            "stream": true,
            "system": [{
                "type": "text",
                "text": cfg.system_prompt,
                "cache_control": { "type": "ephemeral" },
            }],
            "messages": [{
                "role": "user",
                "content": user_content,
            }],
        });
        PreparedRequest {
            url: API_URL.to_string(),
            headers: vec![
                ("x-api-key".into(), cfg.api_key.clone()),
                ("anthropic-version".into(), API_VERSION.into()),
                ("anthropic-beta".into(), CACHE_BETA.into()),
                ("content-type".into(), "application/json".into()),
            ],
            body,
        }
    }

    fn parse_event(&self, data: &str) -> Result<Vec<StreamEvent>, AiError> {
        let parsed: SseEvent = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(e) => {
                return Err(AiError::Stream(format!(
                    "anthropic SSE parse: {e}; payload={data}"
                )));
            }
        };
        Ok(match parsed {
            SseEvent::MessageStart { message } => message
                .usage
                .map(|u| vec![StreamEvent::Usage(u.into())])
                .unwrap_or_default(),
            SseEvent::ContentBlockDelta {
                delta: ContentDelta::TextDelta { text },
            } => vec![StreamEvent::TextDelta(text)],
            SseEvent::MessageDelta { usage: Some(u) } => vec![StreamEvent::Usage(u.into())],
            SseEvent::MessageStop => vec![StreamEvent::StreamDone],
            SseEvent::Error { error } => return Err(AiError::Stream(error.message)),
            _ => vec![],
        })
    }
}

// ── SSE payload shapes ─────────────────────────────────────────────────

#[derive(Deserialize)]
#[serde(tag = "type")]
enum SseEvent {
    #[serde(rename = "message_start")]
    MessageStart { message: MessageStartPayload },
    #[serde(rename = "content_block_delta")]
    ContentBlockDelta { delta: ContentDelta },
    #[serde(rename = "message_delta")]
    MessageDelta { usage: Option<Usage> },
    #[serde(rename = "message_stop")]
    MessageStop,
    #[serde(rename = "error")]
    Error { error: ApiErrorPayload },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct MessageStartPayload {
    #[serde(default)]
    usage: Option<Usage>,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
enum ContentDelta {
    #[serde(rename = "text_delta")]
    TextDelta { text: String },
    #[serde(other)]
    Other,
}

#[derive(Deserialize)]
struct ApiErrorPayload {
    message: String,
}

#[derive(Deserialize, Serialize, Default, Clone)]
#[allow(clippy::struct_field_names)]
struct Usage {
    #[serde(default)]
    input_tokens: u32,
    #[serde(default)]
    output_tokens: u32,
    #[serde(default)]
    cache_read_input_tokens: u32,
    #[serde(default)]
    cache_creation_input_tokens: u32,
}

impl From<Usage> for ProviderUsage {
    fn from(u: Usage) -> Self {
        Self {
            input_tokens: u.input_tokens,
            output_tokens: u.output_tokens,
            cache_read_input_tokens: u.cache_read_input_tokens,
            cache_creation_input_tokens: u.cache_creation_input_tokens,
        }
    }
}

/// Build the user-message content array. Pinned contexts come first as
/// individual text blocks (so they're easy for the model to reference by
/// `source` name). A single `cache_control: ephemeral` breakpoint sits on
/// the last pinned block — that caches the whole pinned-context prefix
/// for the 5-minute TTL, so follow-up turns with the same pinned set
/// pay 10% on those tokens. The final block is the "this doc" preamble
/// + user prompt (always varying, never cached).
fn build_user_content(input: &CompletionInput) -> Vec<serde_json::Value> {
    let mut blocks: Vec<serde_json::Value> = input
        .pinned_context
        .iter()
        .map(|pc| {
            serde_json::json!({
                "type": "text",
                "text": format!(
                    "<context source=\"{}\">\n{}\n</context>",
                    pc.source, pc.content
                ),
            })
        })
        .collect();
    if let Some(serde_json::Value::Object(map)) = blocks.last_mut() {
        map.insert(
            "cache_control".into(),
            serde_json::json!({ "type": "ephemeral" }),
        );
    }

    let final_text = match &input.context_doc {
        Some(doc) if !doc.trim().is_empty() => format!(
            "The following is the user's current document:\n\n---\n{doc}\n---\n\nUser's instruction:\n{}",
            input.prompt
        ),
        _ => input.prompt.clone(),
    };
    blocks.push(serde_json::json!({
        "type": "text",
        "text": final_text,
    }));
    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ai::provider::PinnedContext;

    fn input_with_pinned(pinned: Vec<PinnedContext>) -> CompletionInput {
        CompletionInput {
            prompt: "Summarize.".into(),
            context_doc: None,
            pinned_context: pinned,
        }
    }

    #[test]
    fn no_pinned_emits_single_prompt_block() {
        let content = build_user_content(&input_with_pinned(vec![]));
        assert_eq!(content.len(), 1);
        assert_eq!(content[0]["type"], "text");
        assert_eq!(content[0]["text"], "Summarize.");
        assert!(content[0].get("cache_control").is_none());
    }

    #[test]
    fn pinned_blocks_cache_breakpoint_on_last_pinned() {
        let pinned = vec![
            PinnedContext {
                source: "a.md".into(),
                content: "alpha".into(),
            },
            PinnedContext {
                source: "b.md".into(),
                content: "beta".into(),
            },
        ];
        let content = build_user_content(&input_with_pinned(pinned));
        assert_eq!(content.len(), 3, "two pinned + one prompt block");

        assert!(content[0]["text"]
            .as_str()
            .unwrap()
            .contains("source=\"a.md\""));
        assert!(content[0].get("cache_control").is_none());

        assert!(content[1]["text"]
            .as_str()
            .unwrap()
            .contains("source=\"b.md\""));
        assert_eq!(content[1]["cache_control"]["type"], "ephemeral");

        assert_eq!(content[2]["text"], "Summarize.");
        assert!(content[2].get("cache_control").is_none());
    }

    #[test]
    fn this_doc_preamble_still_works_alongside_pinned() {
        let mut input = input_with_pinned(vec![PinnedContext {
            source: "ref.md".into(),
            content: "ref body".into(),
        }]);
        input.context_doc = Some("active doc body".into());
        let content = build_user_content(&input);
        assert_eq!(content.len(), 2);
        // pinned block carries cache breakpoint
        assert_eq!(content[0]["cache_control"]["type"], "ephemeral");
        // final block embeds the active doc + prompt
        let final_text = content[1]["text"].as_str().unwrap();
        assert!(final_text.contains("active doc body"));
        assert!(final_text.contains("Summarize."));
    }
}

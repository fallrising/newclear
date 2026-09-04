//! OpenAI chat-completions provider + the DeepSeek shim that reuses the
//! same wire format with a different base URL and default model.
//!
//! OpenAI doesn't expose a public prompt-cache control like Anthropic
//! (the platform's auto KV-cache is opaque), so the same call shape
//! gets reused as-is. `stream_options: include_usage = true` is the
//! single knob that asks the server to emit a final usage event.

use serde::Deserialize;

use crate::ai::error::AiError;
use crate::ai::provider::{
    CompletionInput, PreparedRequest, Provider, ProviderConfig, ProviderKind, StreamEvent,
    Usage as ProviderUsage,
};

pub struct OpenAiProvider {
    base_url: String,
    kind: ProviderKind,
}

impl OpenAiProvider {
    pub fn openai() -> Self {
        Self {
            base_url: "https://api.openai.com/v1".into(),
            kind: ProviderKind::OpenAi,
        }
    }

    pub fn deepseek() -> Self {
        Self {
            base_url: "https://api.deepseek.com/v1".into(),
            kind: ProviderKind::DeepSeek,
        }
    }
}

impl Provider for OpenAiProvider {
    fn kind(&self) -> ProviderKind {
        self.kind
    }

    fn prepare(&self, cfg: &ProviderConfig, input: &CompletionInput) -> PreparedRequest {
        let user_text = build_user_message(input);
        let body = serde_json::json!({
            "model": cfg.model,
            "max_tokens": cfg.max_tokens,
            "stream": true,
            "stream_options": { "include_usage": true },
            "messages": [
                { "role": "system", "content": cfg.system_prompt },
                { "role": "user", "content": user_text },
            ],
        });
        PreparedRequest {
            url: format!("{}/chat/completions", self.base_url),
            headers: vec![
                ("authorization".into(), format!("Bearer {}", cfg.api_key)),
                ("content-type".into(), "application/json".into()),
            ],
            body,
        }
    }

    fn parse_event(&self, data: &str) -> Result<Vec<StreamEvent>, AiError> {
        // The terminal sentinel is a plain "[DONE]" line, not JSON.
        if data.trim() == "[DONE]" {
            return Ok(vec![StreamEvent::StreamDone]);
        }
        let parsed: ChunkPayload = match serde_json::from_str(data) {
            Ok(v) => v,
            Err(e) => {
                return Err(AiError::Stream(format!(
                    "openai SSE parse: {e}; payload={data}"
                )));
            }
        };
        let mut out = Vec::new();
        for choice in parsed.choices {
            if let Some(content) = choice.delta.and_then(|d| d.content) {
                if !content.is_empty() {
                    out.push(StreamEvent::TextDelta(content));
                }
            }
        }
        if let Some(usage) = parsed.usage {
            out.push(StreamEvent::Usage(ProviderUsage {
                input_tokens: usage.prompt_tokens,
                output_tokens: usage.completion_tokens,
                // OpenAI doesn't surface cached input separately in the
                // public response; leave at zero.
                cache_read_input_tokens: 0,
                cache_creation_input_tokens: 0,
            }));
        }
        Ok(out)
    }
}

#[derive(Deserialize)]
struct ChunkPayload {
    #[serde(default)]
    choices: Vec<Choice>,
    #[serde(default)]
    usage: Option<OpenAiUsage>,
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Option<Delta>,
}

#[derive(Deserialize)]
struct Delta {
    #[serde(default)]
    content: Option<String>,
}

#[derive(Deserialize)]
struct OpenAiUsage {
    #[serde(default)]
    prompt_tokens: u32,
    #[serde(default)]
    completion_tokens: u32,
}

fn build_user_message(input: &CompletionInput) -> String {
    use std::fmt::Write as _;

    let mut out = String::new();
    for pc in &input.pinned_context {
        let _ = writeln!(
            out,
            "<context source=\"{}\">\n{}\n</context>\n",
            pc.source, pc.content
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

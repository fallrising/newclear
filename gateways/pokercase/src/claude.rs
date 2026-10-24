//! Anthropic Messages API ↔ OpenAI Chat Completions translation (client side and the
//! Claude Code bridge's output).

use bytes::Bytes;
use serde_json::{json, Value};

use crate::error::{AppError, AppResult};

/// Convert Anthropic messages response → OpenAI chat completions JSON.
pub fn anthropic_to_openai_response(body: &Bytes) -> AppResult<Bytes> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("upstream JSON: {e}")))?;

    let blocks = v
        .get("content")
        .and_then(|c| c.as_array())
        .cloned()
        .unwrap_or_default();
    let text = blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) != Some("tool_use"))
        .filter_map(|b| b.get("text").and_then(|t| t.as_str()))
        .collect::<Vec<_>>()
        .join("");
    let calls: Vec<Value> = blocks
        .iter()
        .filter(|b| b.get("type").and_then(|t| t.as_str()) == Some("tool_use"))
        .map(|b| {
            json!({
                "id": b.get("id").cloned().unwrap_or(json!("")),
                "type": "function",
                "function": {
                    "name": b.get("name").cloned().unwrap_or(json!("")),
                    "arguments": b.get("input").map(|i| i.to_string()).unwrap_or_else(|| "{}".into()),
                }
            })
        })
        .collect();

    let id = v
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("msg_unknown");
    let model = v.get("model").and_then(|m| m.as_str()).unwrap_or("claude");
    let input_tokens = v
        .pointer("/usage/input_tokens")
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let output_tokens = v
        .pointer("/usage/output_tokens")
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let stop = v
        .get("stop_reason")
        .and_then(|s| s.as_str())
        .unwrap_or("end_turn");
    let finish = match stop {
        _ if !calls.is_empty() => "tool_calls",
        "end_turn" | "stop_sequence" => "stop",
        "max_tokens" => "length",
        "tool_use" => "tool_calls",
        "refusal" => "content_filter",
        other => other,
    };
    let mut message = json!({
        "role": "assistant",
        "content": if text.is_empty() && !calls.is_empty() { Value::Null } else { Value::String(text) },
    });
    if !calls.is_empty() {
        message["tool_calls"] = Value::Array(calls);
    }

    let out = json!({
        "id": id.replace("msg_", "chatcmpl-"),
        "object": "chat.completion",
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish
        }],
        "usage": {
            "prompt_tokens": input_tokens,
            "completion_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens
        }
    });
    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

/// Convert Anthropic `/v1/messages` body to OpenAI `/v1/chat/completions` body.
/// Keeps tool_use / tool_result (call ids preserved) and images.
pub fn anthropic_to_openai(body: &Bytes) -> AppResult<Bytes> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON body: {e}")))?;
    let obj = v
        .as_object()
        .ok_or_else(|| AppError::BadRequest("body must be a JSON object".into()))?;

    let model = obj
        .get("model")
        .and_then(|m| m.as_str())
        .ok_or_else(|| AppError::BadRequest("model is required".into()))?;

    let mut messages: Vec<Value> = Vec::new();

    if let Some(system) = obj.get("system") {
        match system {
            Value::String(s) if !s.is_empty() => {
                messages.push(json!({"role": "system", "content": s}));
            }
            Value::Array(blocks) => {
                let text = blocks_to_text(blocks);
                if !text.is_empty() {
                    messages.push(json!({"role": "system", "content": text}));
                }
            }
            _ => {}
        }
    }

    let anth_messages = obj
        .get("messages")
        .and_then(|m| m.as_array())
        .ok_or_else(|| AppError::BadRequest("messages is required".into()))?;

    for m in anth_messages {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
        match m.get("content") {
            Some(Value::Array(blocks)) if role == "assistant" => {
                messages.push(assistant_blocks_to_chat(blocks));
            }
            Some(Value::Array(blocks)) => push_user_blocks(&mut messages, blocks),
            Some(Value::String(s)) => messages.push(json!({"role": role, "content": s})),
            Some(other) => messages.push(json!({"role": role, "content": other})),
            None => messages.push(json!({"role": role, "content": ""})),
        }
    }

    let mut out = json!({
        "model": model,
        "messages": messages,
    });
    let out_obj = out.as_object_mut().unwrap();

    if let Some(mt) = obj.get("max_tokens") {
        out_obj.insert("max_tokens".into(), mt.clone());
    }
    if let Some(t) = obj.get("temperature") {
        out_obj.insert("temperature".into(), t.clone());
    }
    if let Some(t) = obj.get("top_p") {
        out_obj.insert("top_p".into(), t.clone());
    }
    if let Some(s) = obj.get("stop_sequences").and_then(|s| s.as_array()) {
        out_obj.insert("stop".into(), Value::Array(s.clone()));
    }
    let stream = obj.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
    out_obj.insert("stream".into(), Value::Bool(stream));

    if let Some(tools) = obj.get("tools").and_then(|t| t.as_array()) {
        let oai_tools: Vec<Value> = tools
            .iter()
            // Server tools (web_search, bash ...) carry a `type` and have no chat equivalent.
            .filter(|t| t.get("type").is_none() || t.get("input_schema").is_some())
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.get("name").cloned().unwrap_or(json!("tool")),
                        "description": t.get("description").cloned().unwrap_or(json!("")),
                        "parameters": t
                            .get("input_schema")
                            .cloned()
                            .unwrap_or_else(|| json!({"type": "object", "properties": {}})),
                    }
                })
            })
            .collect();
        if !oai_tools.is_empty() {
            out_obj.insert("tools".into(), Value::Array(oai_tools));
        }
    }
    if let Some(tc) = obj.get("tool_choice") {
        let mapped = match tc.get("type").and_then(|t| t.as_str()) {
            Some("auto") => Some(json!("auto")),
            Some("any") => Some(json!("required")),
            Some("none") => Some(json!("none")),
            Some("tool") => tc
                .get("name")
                .map(|n| json!({"type": "function", "function": {"name": n}})),
            _ => None,
        };
        if let Some(m) = mapped {
            out_obj.insert("tool_choice".into(), m);
        }
        if tc
            .get("disable_parallel_tool_use")
            .and_then(|d| d.as_bool())
            == Some(true)
        {
            out_obj.insert("parallel_tool_calls".into(), Value::Bool(false));
        }
    }

    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

/// Assistant blocks → one chat message with text and `tool_calls`.
fn assistant_blocks_to_chat(blocks: &[Value]) -> Value {
    let mut text = Vec::new();
    let mut calls = Vec::new();
    for b in blocks {
        match b.get("type").and_then(|t| t.as_str()) {
            Some("tool_use") => calls.push(json!({
                "id": b.get("id").cloned().unwrap_or(json!("")),
                "type": "function",
                "function": {
                    "name": b.get("name").cloned().unwrap_or(json!("")),
                    "arguments": b.get("input").map(|i| i.to_string()).unwrap_or_else(|| "{}".into()),
                }
            })),
            Some("text") | None => {
                if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                    text.push(t.to_string());
                }
            }
            _ => {} // thinking / redacted_thinking have no chat equivalent
        }
    }
    let content = if text.is_empty() && !calls.is_empty() {
        Value::Null
    } else {
        Value::String(text.join("\n"))
    };
    let mut msg = json!({"role": "assistant", "content": content});
    if !calls.is_empty() {
        msg["tool_calls"] = Value::Array(calls);
    }
    msg
}

/// User blocks → `tool` messages for each tool_result (first, so they follow the
/// assistant tool_calls), then one user message with text and images.
fn push_user_blocks(messages: &mut Vec<Value>, blocks: &[Value]) {
    let mut parts = Vec::new();
    let mut has_image = false;
    for b in blocks {
        match b.get("type").and_then(|t| t.as_str()) {
            Some("tool_result") => {
                let content = match b.get("content") {
                    Some(Value::String(s)) => s.clone(),
                    Some(Value::Array(inner)) => blocks_to_text(inner),
                    Some(other) => other.to_string(),
                    None => String::new(),
                };
                let content = if b.get("is_error").and_then(|e| e.as_bool()) == Some(true) {
                    format!("[tool error] {content}")
                } else {
                    content
                };
                messages.push(json!({
                    "role": "tool",
                    "tool_call_id": b.get("tool_use_id").cloned().unwrap_or(json!("")),
                    "content": content,
                }));
            }
            Some("image") => {
                let src = b.get("source").cloned().unwrap_or(Value::Null);
                let url = match src.get("type").and_then(|t| t.as_str()) {
                    Some("base64") => format!(
                        "data:{};base64,{}",
                        src.get("media_type")
                            .and_then(|m| m.as_str())
                            .unwrap_or("image/png"),
                        src.get("data").and_then(|d| d.as_str()).unwrap_or("")
                    ),
                    Some("url") => src
                        .get("url")
                        .and_then(|u| u.as_str())
                        .unwrap_or("")
                        .to_string(),
                    _ => continue,
                };
                has_image = true;
                parts.push(json!({"type": "image_url", "image_url": {"url": url}}));
            }
            _ => {
                if let Some(t) = b.get("text").and_then(|t| t.as_str()).or(b.as_str()) {
                    parts.push(json!({"type": "text", "text": t}));
                }
            }
        }
    }
    if parts.is_empty() {
        return;
    }
    let content = if has_image {
        Value::Array(parts)
    } else {
        Value::String(
            parts
                .iter()
                .filter_map(|p| p.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<_>>()
                .join("\n"),
        )
    };
    messages.push(json!({"role": "user", "content": content}));
}

fn blocks_to_text(blocks: &[Value]) -> String {
    let mut parts = Vec::new();
    for b in blocks {
        if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
            parts.push(t.to_string());
            continue;
        }
        if b.get("type").and_then(|t| t.as_str()) == Some("text") {
            if let Some(t) = b.get("text").and_then(|t| t.as_str()) {
                parts.push(t.to_string());
            }
        } else if let Some(s) = b.as_str() {
            parts.push(s.to_string());
        }
    }
    parts.join("\n")
}

fn stop_reason_for(finish: &str) -> &str {
    match finish {
        "stop" => "end_turn",
        "length" => "max_tokens",
        "tool_calls" | "function_call" => "tool_use",
        "content_filter" => "refusal",
        other => other,
    }
}

/// Convert OpenAI chat completion JSON to Anthropic messages response.
pub fn openai_to_anthropic(body: &Bytes, model: &str) -> AppResult<Bytes> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("upstream JSON: {e}")))?;

    let id = v
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("msg_thinrouter");
    let content_text = v
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let finish = v
        .pointer("/choices/0/finish_reason")
        .and_then(|f| f.as_str())
        .unwrap_or("stop");
    let input_tokens = v
        .pointer("/usage/prompt_tokens")
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let output_tokens = v
        .pointer("/usage/completion_tokens")
        .and_then(|n| n.as_i64())
        .unwrap_or(0);

    let calls = v
        .pointer("/choices/0/message/tool_calls")
        .and_then(|t| t.as_array())
        .cloned()
        .unwrap_or_default();
    let mut content = Vec::new();
    if !content_text.is_empty() || calls.is_empty() {
        content.push(json!({"type": "text", "text": content_text}));
    }
    for call in &calls {
        let args = call
            .pointer("/function/arguments")
            .and_then(|a| a.as_str())
            .unwrap_or("{}");
        content.push(json!({
            "type": "tool_use",
            "id": call.get("id").cloned().unwrap_or(json!("")),
            "name": call.pointer("/function/name").cloned().unwrap_or(json!("")),
            "input": serde_json::from_str::<Value>(args).unwrap_or_else(|_| json!({})),
        }));
    }
    let stop_reason = if calls.is_empty() {
        stop_reason_for(finish)
    } else {
        "tool_use"
    };

    let out = json!({
        "id": id.replace("chatcmpl-", "msg_"),
        "type": "message",
        "role": "assistant",
        "model": model,
        "content": content,
        "stop_reason": stop_reason,
        "stop_sequence": null,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
        }
    });
    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

/// Open content block in the Anthropic stream.
#[derive(Debug, Clone, Copy, PartialEq)]
enum OpenBlock {
    Text,
    /// Chat `tool_calls[].index` this tool_use block belongs to.
    Tool(i64),
}

/// `chat.completion.chunk` SSE → Anthropic Messages SSE (text and tool_use blocks).
#[derive(Debug)]
pub struct StreamTranslateState {
    pub model: String,
    pub message_start_sent: bool,
    pub message_stop_sent: bool,
    open: Option<OpenBlock>,
    next_block: usize,
    stop_reason: Option<String>,
    input_tokens: i64,
    pub output_tokens: i64,
}

impl StreamTranslateState {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            model: model.into(),
            message_start_sent: false,
            message_stop_sent: false,
            open: None,
            next_block: 0,
            stop_reason: None,
            input_tokens: 0,
            output_tokens: 0,
        }
    }

    fn close_block(&mut self, events: &mut Vec<String>) {
        if self.open.take().is_some() {
            events.push(sse_event(
                "content_block_stop",
                &json!({"type": "content_block_stop", "index": self.next_block - 1}),
            ));
        }
    }

    fn open_block(&mut self, kind: OpenBlock, block: Value, events: &mut Vec<String>) {
        self.close_block(events);
        events.push(sse_event(
            "content_block_start",
            &json!({"type": "content_block_start", "index": self.next_block, "content_block": block}),
        ));
        self.next_block += 1;
        self.open = Some(kind);
    }

    fn current_index(&self) -> usize {
        self.next_block - 1
    }

    fn stop(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        if self.message_stop_sent {
            return events;
        }
        if !self.message_start_sent {
            events.extend(self.start(None, None));
        }
        self.close_block(&mut events);
        events.push(sse_event(
            "message_delta",
            &json!({
                "type": "message_delta",
                "delta": {
                    "stop_reason": self.stop_reason.clone().unwrap_or_else(|| "end_turn".into()),
                    "stop_sequence": null
                },
                "usage": {"input_tokens": self.input_tokens, "output_tokens": self.output_tokens}
            }),
        ));
        events.push(sse_event("message_stop", &json!({"type": "message_stop"})));
        self.message_stop_sent = true;
        events
    }

    /// EOF may complete Chat streams only after an explicit finish reason.
    pub fn on_end(&mut self) -> Vec<String> {
        if self.message_stop_sent || self.stop_reason.is_some() {
            return self.stop();
        }
        openai_sse_chunk_to_anthropic(
            &json!({"error": {"type": "api_error", "message": crate::error::INCOMPLETE_STREAM_MESSAGE}}).to_string(),
            self,
        )
    }

    fn start(&mut self, id: Option<&str>, model: Option<&str>) -> Vec<String> {
        self.message_start_sent = true;
        vec![sse_event(
            "message_start",
            &json!({
                "type": "message_start",
                "message": {
                    "id": id.unwrap_or("msg_thinrouter").replace("chatcmpl-", "msg_"),
                    "type": "message",
                    "role": "assistant",
                    "model": model.unwrap_or(self.model.as_str()),
                    "content": [],
                    "stop_reason": null,
                    "stop_sequence": null,
                    "usage": {"input_tokens": 0, "output_tokens": 0}
                }
            }),
        )]
    }
}

/// Convert a single OpenAI SSE `data: {...}` payload to Anthropic SSE events (may be multiple).
/// Returns `event:`/`data:` records; the caller adds the blank-line separator.
pub fn openai_sse_chunk_to_anthropic(data: &str, state: &mut StreamTranslateState) -> Vec<String> {
    if data.trim() == "[DONE]" {
        return state.stop();
    }
    let Ok(v) = serde_json::from_str::<Value>(data) else {
        return Vec::new();
    };
    if state.message_stop_sent {
        return Vec::new();
    }

    let mut events = Vec::new();
    if let Some(err) = v.get("error") {
        events.push(sse_event(
            "error",
            &json!({"type": "error", "error": {"type": "api_error", "message": err.get("message").cloned().unwrap_or_else(|| err.clone())}}),
        ));
        state.message_stop_sent = true;
        return events;
    }
    if !state.message_start_sent {
        let id = v.get("id").and_then(|i| i.as_str());
        let model = v.get("model").and_then(|m| m.as_str());
        events.extend(state.start(id, model));
    }
    if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
        state.input_tokens = u
            .get("prompt_tokens")
            .and_then(|n| n.as_i64())
            .unwrap_or(state.input_tokens);
        state.output_tokens = u
            .get("completion_tokens")
            .and_then(|n| n.as_i64())
            .unwrap_or(state.output_tokens);
    }

    let delta = v
        .pointer("/choices/0/delta")
        .cloned()
        .unwrap_or(Value::Null);
    if let Some(text) = delta.get("content").and_then(|c| c.as_str()) {
        if !text.is_empty() {
            if state.open != Some(OpenBlock::Text) {
                state.open_block(
                    OpenBlock::Text,
                    json!({"type": "text", "text": ""}),
                    &mut events,
                );
            }
            events.push(sse_event(
                "content_block_delta",
                &json!({
                    "type": "content_block_delta",
                    "index": state.current_index(),
                    "delta": {"type": "text_delta", "text": text}
                }),
            ));
        }
    }
    for call in delta
        .get("tool_calls")
        .and_then(|t| t.as_array())
        .into_iter()
        .flatten()
    {
        let idx = call.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
        if state.open != Some(OpenBlock::Tool(idx)) {
            state.open_block(
                OpenBlock::Tool(idx),
                json!({
                    "type": "tool_use",
                    "id": call.get("id").cloned().unwrap_or(json!("")),
                    "name": call.pointer("/function/name").cloned().unwrap_or(json!("")),
                    "input": {}
                }),
                &mut events,
            );
        }
        if let Some(args) = call.pointer("/function/arguments").and_then(|a| a.as_str()) {
            if !args.is_empty() {
                events.push(sse_event(
                    "content_block_delta",
                    &json!({
                        "type": "content_block_delta",
                        "index": state.current_index(),
                        "delta": {"type": "input_json_delta", "partial_json": args}
                    }),
                ));
            }
        }
    }

    if let Some(f) = v
        .pointer("/choices/0/finish_reason")
        .and_then(|f| f.as_str())
    {
        state.stop_reason = Some(stop_reason_for(f).to_string());
    }
    events
}

/// Fold Anthropic SSE records (`event: ...\ndata: ...`) into one Messages JSON body.
pub fn anthropic_sse_to_message(records: &[String], model: &str) -> Bytes {
    let mut msg = json!({
        "id": "msg_thinrouter", "type": "message", "role": "assistant", "model": model,
        "content": [], "stop_reason": null, "stop_sequence": null,
        "usage": {"input_tokens": 0, "output_tokens": 0}
    });
    let mut blocks: Vec<Value> = Vec::new();
    let mut partial: Vec<String> = Vec::new();
    for rec in records {
        let Some(data) = rec.lines().find_map(|l| l.strip_prefix("data: ")) else {
            continue;
        };
        let Ok(ev) = serde_json::from_str::<Value>(data) else {
            continue;
        };
        match ev.get("type").and_then(|t| t.as_str()) {
            Some("message_start") => {
                if let Some(m) = ev.get("message") {
                    for k in ["id", "model"] {
                        if let Some(v) = m.get(k) {
                            msg[k] = v.clone();
                        }
                    }
                    if let Some(u) = m.get("usage") {
                        msg["usage"] = u.clone();
                    }
                }
            }
            Some("content_block_start") => {
                blocks.push(
                    ev.get("content_block")
                        .cloned()
                        .unwrap_or(json!({"type": "text", "text": ""})),
                );
                partial.push(String::new());
            }
            Some("content_block_delta") => {
                let i = ev.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                let (Some(b), Some(p)) = (blocks.get_mut(i), partial.get_mut(i)) else {
                    continue;
                };
                if let Some(t) = ev.pointer("/delta/text").and_then(|t| t.as_str()) {
                    let cur = b
                        .get("text")
                        .and_then(|t| t.as_str())
                        .unwrap_or("")
                        .to_string();
                    b["text"] = json!(cur + t);
                }
                if let Some(j) = ev.pointer("/delta/partial_json").and_then(|t| t.as_str()) {
                    p.push_str(j);
                }
            }
            Some("content_block_stop") => {
                let i = ev.get("index").and_then(|i| i.as_u64()).unwrap_or(0) as usize;
                if let (Some(b), Some(p)) = (blocks.get_mut(i), partial.get(i)) {
                    if !p.is_empty() {
                        b["input"] = serde_json::from_str(p).unwrap_or(json!({}));
                    }
                }
            }
            Some("message_delta") => {
                if let Some(r) = ev.pointer("/delta/stop_reason") {
                    msg["stop_reason"] = r.clone();
                }
                if let Some(u) = ev.get("usage").and_then(|u| u.as_object()) {
                    for (k, v) in u {
                        msg["usage"][k] = v.clone();
                    }
                }
            }
            _ => {}
        }
    }
    msg["content"] = Value::Array(blocks);
    Bytes::from(serde_json::to_vec(&msg).unwrap_or_default())
}

/// Anthropic Messages SSE → `chat.completion.chunk` records (text and tool_use).
pub struct AnthropicToChatStream {
    id: String,
    model: String,
    created: i64,
    /// Anthropic block index → chat tool index.
    tools: std::collections::HashMap<i64, usize>,
    finish: Option<String>,
    usage: (i64, i64),
    done: bool,
}

impl AnthropicToChatStream {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            id: "chatcmpl-thinrouter".into(),
            model: model.into(),
            created: chrono::Utc::now().timestamp(),
            tools: Default::default(),
            finish: None,
            usage: (0, 0),
            done: false,
        }
    }

    fn chunk(&self, delta: Value, finish: Option<&str>, usage: bool) -> String {
        let mut c = json!({
            "id": self.id, "object": "chat.completion.chunk", "created": self.created,
            "model": self.model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        });
        if usage {
            let (p, o) = self.usage;
            c["usage"] = json!({"prompt_tokens": p, "completion_tokens": o, "total_tokens": p + o});
        }
        format!("data: {c}")
    }

    fn finish(&mut self) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        self.done = true;
        let reason = match self.finish.as_deref() {
            Some("max_tokens") => "length",
            Some("tool_use") => "tool_calls",
            Some("refusal") => "content_filter",
            _ if !self.tools.is_empty() => "tool_calls",
            _ => "stop",
        };
        vec![
            self.chunk(json!({}), Some(reason), true),
            "data: [DONE]".into(),
        ]
    }

    pub fn on_data(&mut self, data: &str) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        let Ok(ev) = serde_json::from_str::<Value>(data) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        match ev.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "message_start" => {
                if let Some(id) = ev.pointer("/message/id").and_then(|i| i.as_str()) {
                    self.id = id.replace("msg_", "chatcmpl-");
                }
                if let Some(u) = ev
                    .pointer("/message/usage/input_tokens")
                    .and_then(|n| n.as_i64())
                {
                    self.usage.0 = u;
                }
                out.push(self.chunk(json!({"role": "assistant", "content": ""}), None, false));
            }
            "content_block_start" => {
                if ev.pointer("/content_block/type").and_then(|t| t.as_str()) == Some("tool_use") {
                    let idx = ev.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                    let n = self.tools.len();
                    self.tools.insert(idx, n);
                    out.push(self.chunk(
                        json!({"tool_calls": [{"index": n, "id": ev.pointer("/content_block/id"), "type": "function",
                            "function": {"name": ev.pointer("/content_block/name"), "arguments": ""}}]}),
                        None,
                        false,
                    ));
                }
            }
            "content_block_delta" => {
                if let Some(t) = ev.pointer("/delta/text").and_then(|t| t.as_str()) {
                    out.push(self.chunk(json!({"content": t}), None, false));
                } else if let Some(j) = ev.pointer("/delta/partial_json").and_then(|t| t.as_str()) {
                    let idx = ev.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
                    if let Some(n) = self.tools.get(&idx) {
                        out.push(self.chunk(
                            json!({"tool_calls": [{"index": n, "function": {"arguments": j}}]}),
                            None,
                            false,
                        ));
                    }
                }
            }
            "message_delta" => {
                if let Some(r) = ev.pointer("/delta/stop_reason").and_then(|r| r.as_str()) {
                    self.finish = Some(r.to_string());
                }
                if let Some(u) = ev.pointer("/usage/input_tokens").and_then(|n| n.as_i64()) {
                    self.usage.0 = u;
                }
                if let Some(u) = ev.pointer("/usage/output_tokens").and_then(|n| n.as_i64()) {
                    self.usage.1 = u;
                }
            }
            "message_stop" => out.extend(self.finish()),
            "error" => {
                out.push(format!(
                    "data: {}",
                    json!({"error": ev.get("error").cloned().unwrap_or(Value::Null)})
                ));
                out.push("data: [DONE]".into());
                self.done = true;
            }
            _ => {}
        }
        out
    }

    pub fn on_end(&mut self) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        self.on_data(
            &json!({"type": "error", "error": {
                "type": "api_error", "message": crate::error::INCOMPLETE_STREAM_MESSAGE
            }})
            .to_string(),
        )
    }
}

fn sse_event(event: &str, data: &Value) -> String {
    format!("event: {event}\ndata: {data}")
}

pub fn extract_anthropic_model_stream(body: &Bytes) -> AppResult<(String, bool)> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("invalid JSON body: {e}")))?;
    let model = v
        .get("model")
        .and_then(|m| m.as_str())
        .unwrap_or("")
        .to_string();
    let stream = v.get("stream").and_then(|s| s.as_bool()).unwrap_or(false);
    if model.is_empty() {
        return Err(AppError::BadRequest("model is required".into()));
    }
    Ok((model, stream))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn convert_basic_request() {
        let body = Bytes::from(
            r#"{"model":"cheap","max_tokens":64,"messages":[{"role":"user","content":"hi"}],"system":"be brief"}"#,
        );
        let out = anthropic_to_openai(&body).unwrap();
        let v: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["model"], "cheap");
        let msgs = v["messages"].as_array().unwrap();
        assert_eq!(msgs[0]["role"], "system");
        assert_eq!(msgs[1]["role"], "user");
        assert_eq!(msgs[1]["content"], "hi");
    }

    #[test]
    fn tool_use_history_and_images_map_to_chat() {
        let body = Bytes::from(
            json!({
                "model": "m", "max_tokens": 10,
                "tools": [{"name": "lookup", "description": "d", "input_schema": {"type": "object"}},
                          {"type": "web_search_20250305", "name": "web_search"}],
                "tool_choice": {"type": "tool", "name": "lookup"},
                "messages": [
                    {"role": "user", "content": [
                        {"type": "text", "text": "look"},
                        {"type": "image", "source": {"type": "base64", "media_type": "image/jpeg", "data": "QUJD"}}
                    ]},
                    {"role": "assistant", "content": [
                        {"type": "thinking", "thinking": "hmm", "signature": "s"},
                        {"type": "text", "text": "calling"},
                        {"type": "tool_use", "id": "toolu_1", "name": "lookup", "input": {"q": 1}}
                    ]},
                    {"role": "user", "content": [
                        {"type": "tool_result", "tool_use_id": "toolu_1", "content": [{"type": "text", "text": "42"}]},
                        {"type": "text", "text": "thanks"}
                    ]}
                ]
            })
            .to_string(),
        );
        let v: Value = serde_json::from_slice(&anthropic_to_openai(&body).unwrap()).unwrap();
        let m = v["messages"].as_array().unwrap();
        assert_eq!(
            m[0]["content"][1]["image_url"]["url"],
            "data:image/jpeg;base64,QUJD"
        );
        assert_eq!(m[1]["content"], "calling");
        assert_eq!(m[1]["tool_calls"][0]["id"], "toolu_1");
        assert_eq!(m[1]["tool_calls"][0]["function"]["arguments"], "{\"q\":1}");
        assert_eq!(m[2]["role"], "tool");
        assert_eq!(m[2]["tool_call_id"], "toolu_1");
        assert_eq!(m[2]["content"], "42");
        assert_eq!(m[3]["content"], "thanks");
        assert_eq!(v["tools"].as_array().unwrap().len(), 1);
        assert_eq!(v["tool_choice"]["function"]["name"], "lookup");
    }

    #[test]
    fn chat_tool_calls_map_to_tool_use_blocks() {
        let body = Bytes::from(
            r#"{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":null,"tool_calls":[{"id":"call_1","type":"function","function":{"name":"lookup","arguments":"{\"q\":1}"}}]},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}"#,
        );
        let v: Value = serde_json::from_slice(&openai_to_anthropic(&body, "m").unwrap()).unwrap();
        assert_eq!(v["stop_reason"], "tool_use");
        assert_eq!(v["content"].as_array().unwrap().len(), 1);
        assert_eq!(v["content"][0]["type"], "tool_use");
        assert_eq!(v["content"][0]["id"], "call_1");
        assert_eq!(v["content"][0]["input"]["q"], 1);
    }

    #[test]
    fn stream_text_then_tool_use_events() {
        let mut st = StreamTranslateState::new("m");
        let chunks = [
            json!({"id": "chatcmpl-9", "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}}]}),
            json!({"choices": [{"index": 0, "delta": {"content": "Hi"}}]}),
            json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "lookup", "arguments": ""}}]}}]}),
            json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{\"q\":1}"}}]}}]}),
            json!({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 5, "completion_tokens": 7}}),
        ];
        let mut events: Vec<String> = Vec::new();
        for c in chunks {
            events.extend(openai_sse_chunk_to_anthropic(&c.to_string(), &mut st));
        }
        events.extend(openai_sse_chunk_to_anthropic("[DONE]", &mut st));
        let names: Vec<&str> = events
            .iter()
            .map(|e| e.lines().next().unwrap().trim_start_matches("event: "))
            .collect();
        assert_eq!(
            names,
            [
                "message_start",
                "content_block_start",
                "content_block_delta",
                "content_block_stop",
                "content_block_start",
                "content_block_delta",
                "content_block_stop",
                "message_delta",
                "message_stop"
            ]
        );
        let data = |i: usize| -> Value {
            serde_json::from_str(
                events[i]
                    .lines()
                    .nth(1)
                    .unwrap()
                    .trim_start_matches("data: "),
            )
            .unwrap()
        };
        assert_eq!(data(0)["message"]["id"], "msg_9");
        assert_eq!(data(4)["index"], 1);
        assert_eq!(data(4)["content_block"]["type"], "tool_use");
        assert_eq!(data(4)["content_block"]["id"], "call_1");
        assert_eq!(data(5)["delta"]["partial_json"], "{\"q\":1}");
        assert_eq!(data(7)["delta"]["stop_reason"], "tool_use");
        assert_eq!(data(7)["usage"]["output_tokens"], 7);
        assert!(openai_sse_chunk_to_anthropic("[DONE]", &mut st).is_empty());
    }

    #[test]
    fn convert_response() {
        let body = Bytes::from(
            r#"{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":1}}"#,
        );
        let out = openai_to_anthropic(&body, "cheap").unwrap();
        let v: Value = serde_json::from_slice(&out).unwrap();
        assert_eq!(v["type"], "message");
        assert_eq!(v["content"][0]["text"], "hello");
        assert_eq!(v["usage"]["input_tokens"], 3);
    }
}

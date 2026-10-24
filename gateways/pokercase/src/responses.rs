//! OpenAI Responses API ↔ Chat Completions translation (requests, bodies and SSE).

use std::collections::{HashMap, HashSet};

use bytes::Bytes;
use serde_json::{json, Map, Value};

use crate::error::{AppError, AppResult};

fn parse_object(body: &Bytes) -> AppResult<Map<String, Value>> {
    match serde_json::from_slice(body) {
        Ok(Value::Object(o)) => Ok(o),
        Ok(_) => Err(AppError::BadRequest("body must be a JSON object".into())),
        Err(e) => Err(AppError::BadRequest(format!("invalid JSON body: {e}"))),
    }
}

/// Plain text of a chat `content` (string or parts).
fn content_text(content: &Value) -> String {
    match content {
        Value::String(s) => s.clone(),
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| p.get("text").and_then(|t| t.as_str()).or(p.as_str()))
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Null => String::new(),
        other => other.to_string(),
    }
}

/// Chat user content → Responses input parts (text + images).
fn user_parts(content: &Value) -> Vec<Value> {
    match content {
        Value::Array(parts) => parts
            .iter()
            .filter_map(|p| match p.get("type").and_then(|t| t.as_str()) {
                Some("image_url") => {
                    let (url, detail) = match p.get("image_url") {
                        Some(Value::String(u)) => (u.clone(), None),
                        Some(o) => (
                            o.get("url").and_then(|u| u.as_str())?.to_string(),
                            o.get("detail").cloned(),
                        ),
                        None => return None,
                    };
                    let mut part = json!({"type": "input_image", "image_url": url});
                    if let Some(d) = detail {
                        part["detail"] = d;
                    }
                    Some(part)
                }
                _ => {
                    let text = p.get("text").and_then(|t| t.as_str()).or(p.as_str())?;
                    Some(json!({"type": "input_text", "text": text}))
                }
            })
            .collect(),
        other => vec![json!({"type": "input_text", "text": content_text(other)})],
    }
}

/// Chat `tools` → Responses function tools (flattened `function`).
fn chat_tools_to_responses(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .map(|t| match t.get("function") {
            Some(f) if t.get("type").and_then(|x| x.as_str()) == Some("function") => {
                let mut out = json!({"type": "function", "name": f.get("name").cloned().unwrap_or(json!(""))});
                for k in ["description", "parameters", "strict"] {
                    if let Some(v) = f.get(k) {
                        out[k] = v.clone();
                    }
                }
                out
            }
            _ => t.clone(),
        })
        .collect()
}

/// Responses function tools → chat `tools` (hosted tools have no chat equivalent).
fn responses_tools_to_chat(tools: &[Value]) -> Vec<Value> {
    tools
        .iter()
        .filter(|t| t.get("type").and_then(|x| x.as_str()) == Some("function"))
        .map(|t| {
            let mut f = json!({"name": t.get("name").cloned().unwrap_or(json!(""))});
            for k in ["description", "parameters", "strict"] {
                if let Some(v) = t.get(k) {
                    f[k] = v.clone();
                }
            }
            json!({"type": "function", "function": f})
        })
        .collect()
}

fn chat_tool_choice_to_responses(tc: &Value) -> Value {
    match tc.pointer("/function/name") {
        Some(name) => json!({"type": "function", "name": name}),
        None => tc.clone(),
    }
}

/// Convert Chat Completions request → Responses request (for Codex / Grok upstreams).
pub fn chat_to_responses_request(body: &Bytes) -> AppResult<Bytes> {
    let obj = parse_object(body)?;
    let model = obj
        .get("model")
        .and_then(|m| m.as_str())
        .ok_or_else(|| AppError::BadRequest("model is required".into()))?;

    let mut instructions: Vec<String> = Vec::new();
    let mut input: Vec<Value> = Vec::new();

    for m in obj
        .get("messages")
        .and_then(|m| m.as_array())
        .into_iter()
        .flatten()
    {
        let role = m.get("role").and_then(|r| r.as_str()).unwrap_or("user");
        let content = m.get("content").cloned().unwrap_or(Value::Null);
        match role {
            "system" | "developer" => instructions.push(content_text(&content)),
            "tool" => input.push(json!({
                "type": "function_call_output",
                "call_id": m.get("tool_call_id").and_then(|t| t.as_str()).unwrap_or(""),
                "output": content_text(&content),
            })),
            "assistant" => {
                let text = content_text(&content);
                if !text.is_empty() {
                    input.push(json!({
                        "type": "message",
                        "role": "assistant",
                        "content": [{"type": "output_text", "text": text}]
                    }));
                }
                for call in m
                    .get("tool_calls")
                    .and_then(|t| t.as_array())
                    .into_iter()
                    .flatten()
                {
                    input.push(json!({
                        "type": "function_call",
                        "call_id": call.get("id").and_then(|i| i.as_str()).unwrap_or(""),
                        "name": call.pointer("/function/name").and_then(|n| n.as_str()).unwrap_or(""),
                        "arguments": call.pointer("/function/arguments").and_then(|a| a.as_str()).unwrap_or("{}"),
                    }));
                }
            }
            _ => input.push(json!({
                "type": "message",
                "role": "user",
                "content": user_parts(&content),
            })),
        }
    }

    let mut out = json!({
        "model": model,
        "input": input,
        "store": false,
    });
    let o = out.as_object_mut().unwrap();
    if !instructions.is_empty() {
        o.insert(
            "instructions".into(),
            Value::String(instructions.join("\n")),
        );
    }
    if let Some(s) = obj.get("stream") {
        o.insert("stream".into(), s.clone());
    }
    // Sampling limits are not forwarded: subscription Responses upstreams reject them.
    if let Some(tools) = obj.get("tools").and_then(|t| t.as_array()) {
        o.insert("tools".into(), Value::Array(chat_tools_to_responses(tools)));
    }
    if let Some(tc) = obj.get("tool_choice") {
        o.insert("tool_choice".into(), chat_tool_choice_to_responses(tc));
    }
    if let Some(p) = obj.get("parallel_tool_calls") {
        o.insert("parallel_tool_calls".into(), p.clone());
    }
    if let Some(effort) = obj.get("reasoning_effort") {
        o.insert("reasoning".into(), json!({"effort": effort}));
    }
    if let Some(k) = obj.get("prompt_cache_key") {
        o.insert("prompt_cache_key".into(), k.clone());
    }

    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

/// Prepare a client Responses request for a Responses upstream: keep every item
/// (function_call, reasoning, images ...) and only touch what the upstream requires.
pub fn prepare_native_request(
    body: &Bytes,
    upstream_model: &str,
    force_stream: bool,
) -> AppResult<Bytes> {
    let mut obj = parse_object(body)?;
    obj.insert("model".into(), Value::String(upstream_model.to_string()));
    if let Some(Value::String(s)) = obj.get("input") {
        let text = s.clone();
        obj.insert(
            "input".into(),
            json!([{"type": "message", "role": "user", "content": [{"type": "input_text", "text": text}]}]),
        );
    }
    if force_stream {
        obj.insert("stream".into(), Value::Bool(true));
    }
    Ok(Bytes::from(serde_json::to_vec(&obj)?))
}

fn finish_reason_for(response: &Value, has_tool_calls: bool) -> &'static str {
    if has_tool_calls {
        return "tool_calls";
    }
    let incomplete = response.get("status").and_then(|s| s.as_str()) == Some("incomplete");
    let reason = response
        .pointer("/incomplete_details/reason")
        .and_then(|r| r.as_str());
    match (incomplete, reason) {
        (true, Some("content_filter")) => "content_filter",
        (true, _) => "length",
        _ => "stop",
    }
}

/// Convert Responses JSON response → Chat Completions JSON (non-stream).
pub fn responses_body_to_chat(body: &Bytes) -> AppResult<Bytes> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("upstream JSON: {e}")))?;

    let mut text = String::new();
    let mut tool_calls: Vec<Value> = Vec::new();
    for item in v
        .get("output")
        .and_then(|o| o.as_array())
        .into_iter()
        .flatten()
    {
        match item.get("type").and_then(|t| t.as_str()) {
            Some("function_call") => tool_calls.push(json!({
                "id": item.get("call_id").and_then(|c| c.as_str()).unwrap_or(""),
                "type": "function",
                "function": {
                    "name": item.get("name").and_then(|n| n.as_str()).unwrap_or(""),
                    "arguments": item.get("arguments").and_then(|a| a.as_str()).unwrap_or("{}"),
                }
            })),
            Some("message") | None => {
                for block in item
                    .get("content")
                    .and_then(|c| c.as_array())
                    .into_iter()
                    .flatten()
                {
                    if block.get("type").and_then(|t| t.as_str()) != Some("refusal") {
                        if let Some(t) = block.get("text").and_then(|t| t.as_str()) {
                            text.push_str(t);
                        }
                    }
                }
            }
            _ => {} // reasoning and other items have no chat equivalent
        }
    }
    if text.is_empty() {
        if let Some(t) = v.get("output_text").and_then(|t| t.as_str()) {
            text = t.to_string();
        }
    }

    let id = v
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("chatcmpl-from-resp");
    let model = v.get("model").and_then(|m| m.as_str()).unwrap_or("unknown");
    let input_tokens = v
        .pointer("/usage/input_tokens")
        .and_then(|n| n.as_i64())
        .unwrap_or(0);
    let output_tokens = v
        .pointer("/usage/output_tokens")
        .and_then(|n| n.as_i64())
        .unwrap_or(0);

    let finish = finish_reason_for(&v, !tool_calls.is_empty());
    let mut message = json!({
        "role": "assistant",
        "content": if text.is_empty() && !tool_calls.is_empty() { Value::Null } else { Value::String(text) },
    });
    if !tool_calls.is_empty() {
        message["tool_calls"] = Value::Array(tool_calls);
    }

    let mut usage = json!({
        "prompt_tokens": input_tokens,
        "completion_tokens": output_tokens,
        "total_tokens": input_tokens + output_tokens
    });
    if let Some(cached) = v.pointer("/usage/input_tokens_details/cached_tokens") {
        usage["prompt_tokens_details"] = json!({"cached_tokens": cached});
    }
    let out = json!({
        "id": id.replace("resp_", "chatcmpl-"),
        "object": "chat.completion",
        "created": chrono::Utc::now().timestamp(),
        "model": model,
        "choices": [{
            "index": 0,
            "message": message,
            "finish_reason": finish
        }],
        "usage": usage
    });
    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

/// Keep recognized quota codes, but never expose arbitrary upstream error text.
fn buffered_failure(error: &Value) -> AppError {
    let code = error.get("code").and_then(Value::as_str).unwrap_or("");
    if crate::siwc::is_usage_limit_code(code) {
        AppError::Upstream {
            status: 429,
            body: json!({"error": {"code": code, "message": "subscription sharing usage limit reached"}}).to_string(),
        }
    } else {
        AppError::Upstream {
            status: 502,
            body: "Responses upstream reported failure".into(),
        }
    }
}

/// Validate a direct JSON envelope before passthrough or protocol conversion.
/// Native callers may preserve explicitly requested background pending responses.
/// Keep the original bytes: this is not a full nested-output schema validator.
pub fn validate_json_response(body: &Bytes, allow_background: bool) -> AppResult<()> {
    let invalid = || AppError::Upstream {
        status: 502,
        body: "Responses upstream returned an invalid response".into(),
    };
    let value: Value = serde_json::from_slice(body).map_err(|_| invalid())?;
    let object = value.as_object().ok_or_else(invalid)?;
    let status = object.get("status").and_then(Value::as_str);
    let error = object.get("error").filter(|v| !v.is_null());
    // Error-only envelopes and explicit failures may preserve known quota codes.
    // A conflicting success/status must not be relabeled as a quota failure.
    if status == Some("failed") || (!object.contains_key("status") && error.is_some()) {
        return Err(buffered_failure(error.unwrap_or(&Value::Null)));
    }
    if error.is_some() || !value["output"].is_array() {
        return Err(invalid());
    }
    match status {
        Some("completed" | "incomplete") => Ok(()),
        Some("queued" | "in_progress") if allow_background && value["background"] == true => Ok(()),
        _ => Err(invalid()),
    }
}

/// Rebuild a Responses JSON body from a Responses SSE transcript (upstream forced
/// streaming while the client asked for a single body).
pub fn reassemble_sse(raw: &str) -> AppResult<Bytes> {
    let unfinished = || AppError::Upstream {
        status: 502,
        body: crate::error::INCOMPLETE_STREAM_MESSAGE.into(),
    };
    let mut terminal = false;
    let mut response: Value = json!({
        "id": "resp_reassembled",
        "object": "response",
        "model": "unknown",
        "status": "in_progress",
    });
    let mut items: Vec<(i64, Value)> = Vec::new();
    let mut text = String::new();
    for data in raw.lines().filter_map(|l| l.strip_prefix("data:")) {
        let Ok(ev) = serde_json::from_str::<Value>(data.trim()) else {
            continue;
        };
        match ev.get("type").and_then(|t| t.as_str()) {
            Some("response.created" | "response.in_progress") => {
                if let Some(r) = ev.get("response") {
                    for k in ["id", "model", "created_at"] {
                        if let Some(v) = r.get(k) {
                            response[k] = v.clone();
                        }
                    }
                }
            }
            Some("response.output_text.delta") => {
                text.push_str(ev.get("delta").and_then(|d| d.as_str()).unwrap_or(""));
            }
            Some("response.output_item.done") => {
                let idx = ev
                    .get("output_index")
                    .and_then(|i| i.as_i64())
                    .unwrap_or(items.len() as i64);
                if let Some(item) = ev.get("item") {
                    items.push((idx, item.clone()));
                }
            }
            Some("error") => return Err(buffered_failure(ev.get("error").unwrap_or(&ev))),
            Some("response.failed") => {
                return Err(buffered_failure(
                    ev.pointer("/response/error").unwrap_or(&Value::Null),
                ));
            }
            Some(kind @ ("response.completed" | "response.incomplete")) => {
                let expected = if kind == "response.completed" {
                    "completed"
                } else {
                    "incomplete"
                };
                let r = ev
                    .get("response")
                    .and_then(Value::as_object)
                    .filter(|r| r.get("status").and_then(Value::as_str) == Some(expected))
                    .ok_or_else(unfinished)?;
                if r.get("error").is_some_and(|e| !e.is_null()) {
                    return Err(unfinished());
                }
                for (k, v) in r {
                    response[k] = v.clone();
                }
                terminal = true;
                break;
            }
            _ => {}
        }
    }
    if !terminal {
        return Err(unfinished());
    }
    let has_output = response
        .get("output")
        .and_then(|o| o.as_array())
        .is_some_and(|a| !a.is_empty());
    if !has_output {
        // Some upstreams omit final output; only then reconstruct from events.
        if !items.is_empty() {
            items.sort_by_key(|(i, _)| *i);
            response["output"] = Value::Array(items.into_iter().map(|(_, v)| v).collect());
        } else {
            response["output"] = json!([{
                "type": "message",
                "role": "assistant",
                "content": [{"type": "output_text", "text": text}]
            }]);
        }
    }
    Ok(Bytes::from(serde_json::to_vec(&response)?))
}

/// Responses SSE → `chat.completion.chunk` SSE, one upstream `data:` payload at a time.
/// Output lines are complete `data: ...` records without the blank-line separator.
pub struct ResponsesToChatStream {
    id: String,
    model: String,
    created: i64,
    role_sent: bool,
    /// Upstream function_call item (by item id and output_index) → chat tool index.
    tool_index_by_item: HashMap<String, usize>,
    tool_index_by_output: HashMap<i64, usize>,
    /// Item ids whose arguments already streamed as deltas.
    args_streamed: HashSet<String>,
    next_tool: usize,
    finished: bool,
}

impl ResponsesToChatStream {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            id: "chatcmpl-thinrouter".into(),
            model: model.into(),
            created: chrono::Utc::now().timestamp(),
            role_sent: false,
            tool_index_by_item: HashMap::new(),
            tool_index_by_output: HashMap::new(),
            args_streamed: HashSet::new(),
            next_tool: 0,
            finished: false,
        }
    }

    fn chunk(&self, delta: Value, finish: Option<&str>, usage: Option<Value>) -> String {
        let mut c = json!({
            "id": self.id,
            "object": "chat.completion.chunk",
            "created": self.created,
            "model": self.model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}],
        });
        if let Some(u) = usage {
            c["usage"] = u;
        }
        format!("data: {c}")
    }

    fn ensure_role(&mut self, out: &mut Vec<String>) {
        if !self.role_sent {
            self.role_sent = true;
            out.push(self.chunk(json!({"role": "assistant", "content": ""}), None, None));
        }
    }

    fn tool_index(&self, ev: &Value) -> Option<usize> {
        let by_item = ev
            .get("item_id")
            .or_else(|| ev.pointer("/item/id"))
            .and_then(|i| i.as_str())
            .and_then(|i| self.tool_index_by_item.get(i));
        let by_output = || {
            ev.get("output_index")
                .and_then(|i| i.as_i64())
                .and_then(|i| self.tool_index_by_output.get(&i))
        };
        by_item.or_else(by_output).copied()
    }

    fn finish(&mut self, response: Option<&Value>) -> Vec<String> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        let mut out = Vec::new();
        self.ensure_role(&mut out);
        let empty = json!({});
        let finish = finish_reason_for(response.unwrap_or(&empty), self.next_tool > 0);
        let usage = response.and_then(|r| r.get("usage")).map(|u| {
            let pt = u.get("input_tokens").and_then(|n| n.as_i64()).unwrap_or(0);
            let ct = u.get("output_tokens").and_then(|n| n.as_i64()).unwrap_or(0);
            json!({"prompt_tokens": pt, "completion_tokens": ct, "total_tokens": pt + ct})
        });
        out.push(self.chunk(json!({}), Some(finish), usage));
        out.push("data: [DONE]".into());
        out
    }

    pub fn on_data(&mut self, data: &str) -> Vec<String> {
        if self.finished {
            return Vec::new();
        }
        if data.trim() == "[DONE]" {
            return self.on_end();
        }
        let Ok(ev) = serde_json::from_str::<Value>(data) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        match ev.get("type").and_then(|t| t.as_str()).unwrap_or("") {
            "response.created" | "response.in_progress" => {
                if let Some(r) = ev.get("response") {
                    if let Some(id) = r.get("id").and_then(|i| i.as_str()) {
                        self.id = id.replace("resp_", "chatcmpl-");
                    }
                    if let Some(m) = r.get("model").and_then(|m| m.as_str()) {
                        self.model = m.to_string();
                    }
                }
                self.ensure_role(&mut out);
            }
            "response.output_text.delta" => {
                self.ensure_role(&mut out);
                let d = ev.get("delta").and_then(|d| d.as_str()).unwrap_or("");
                if !d.is_empty() {
                    out.push(self.chunk(json!({"content": d}), None, None));
                }
            }
            "response.output_item.added" => {
                let item = ev.get("item").cloned().unwrap_or(Value::Null);
                if item.get("type").and_then(|t| t.as_str()) == Some("function_call") {
                    self.ensure_role(&mut out);
                    let idx = self.next_tool;
                    self.next_tool += 1;
                    if let Some(id) = item.get("id").and_then(|i| i.as_str()) {
                        self.tool_index_by_item.insert(id.to_string(), idx);
                    }
                    if let Some(oi) = ev.get("output_index").and_then(|i| i.as_i64()) {
                        self.tool_index_by_output.insert(oi, idx);
                    }
                    out.push(self.chunk(
                        json!({"tool_calls": [{
                            "index": idx,
                            "id": item.get("call_id").cloned().unwrap_or(json!("")),
                            "type": "function",
                            "function": {"name": item.get("name").cloned().unwrap_or(json!("")), "arguments": ""}
                        }]}),
                        None,
                        None,
                    ));
                }
            }
            "response.function_call_arguments.delta" => {
                if let Some(idx) = self.tool_index(&ev) {
                    if let Some(id) = ev.get("item_id").and_then(|i| i.as_str()) {
                        self.args_streamed.insert(id.to_string());
                    }
                    let d = ev.get("delta").and_then(|d| d.as_str()).unwrap_or("");
                    out.push(self.chunk(
                        json!({"tool_calls": [{"index": idx, "function": {"arguments": d}}]}),
                        None,
                        None,
                    ));
                }
            }
            "response.output_item.done" => {
                // Upstreams that skip argument deltas still send the full call here.
                let item = ev.get("item").cloned().unwrap_or(Value::Null);
                let id = item.get("id").and_then(|i| i.as_str()).unwrap_or("");
                if item.get("type").and_then(|t| t.as_str()) == Some("function_call")
                    && !self.args_streamed.contains(id)
                {
                    if let Some(idx) = self.tool_index(&ev) {
                        let args = item.get("arguments").and_then(|a| a.as_str()).unwrap_or("");
                        out.push(self.chunk(
                            json!({"tool_calls": [{"index": idx, "function": {"arguments": args}}]}),
                            None,
                            None,
                        ));
                    }
                }
            }
            "response.completed" | "response.incomplete" => {
                out.extend(self.finish(ev.get("response")));
            }
            "response.failed" | "error" => {
                let err = ev
                    .pointer("/response/error")
                    .or_else(|| ev.get("error"))
                    .cloned()
                    .unwrap_or_else(|| {
                        json!({"message": ev.get("message").cloned().unwrap_or(json!("upstream error"))})
                    });
                out.push(format!("data: {}", json!({"error": err})));
                self.finished = true;
                out.push("data: [DONE]".into());
            }
            _ => {}
        }
        out
    }

    /// Responses must supply a typed terminal event; EOF is not completion.
    pub fn on_end(&mut self) -> Vec<String> {
        if self.finished {
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

/// Convert Responses request body to Chat Completions (for chat-format upstreams).
pub fn responses_to_chat(body: &Bytes) -> AppResult<Bytes> {
    let obj = parse_object(body)?;
    let model = obj
        .get("model")
        .and_then(|m| m.as_str())
        .ok_or_else(|| AppError::BadRequest("model is required".into()))?;

    let mut messages: Vec<Value> = Vec::new();
    if let Some(instr) = obj.get("instructions").and_then(|i| i.as_str()) {
        if !instr.is_empty() {
            messages.push(json!({"role": "system", "content": instr}));
        }
    }
    match obj.get("input") {
        Some(Value::String(s)) => messages.push(json!({"role": "user", "content": s})),
        Some(Value::Array(items)) => {
            for item in items {
                push_input_item(&mut messages, item);
            }
        }
        Some(other) => messages.push(json!({"role": "user", "content": other.to_string()})),
        None => return Err(AppError::BadRequest("input is required".into())),
    }

    let mut out = json!({
        "model": model,
        "messages": messages,
    });
    let o = out.as_object_mut().unwrap();
    for k in ["stream", "temperature", "top_p", "parallel_tool_calls"] {
        if let Some(v) = obj.get(k) {
            o.insert(k.into(), v.clone());
        }
    }
    if let Some(mt) = obj
        .get("max_output_tokens")
        .or_else(|| obj.get("max_tokens"))
    {
        o.insert("max_tokens".into(), mt.clone());
    }
    if let Some(tools) = obj.get("tools").and_then(|t| t.as_array()) {
        let tools = responses_tools_to_chat(tools);
        if !tools.is_empty() {
            o.insert("tools".into(), Value::Array(tools));
        }
    }
    if let Some(tc) = obj.get("tool_choice") {
        let tc = match tc.get("name") {
            Some(name) => json!({"type": "function", "function": {"name": name}}),
            None => tc.clone(),
        };
        o.insert("tool_choice".into(), tc);
    }

    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

/// One Responses input item → chat message(s); consecutive function calls share one
/// assistant message.
fn push_input_item(messages: &mut Vec<Value>, item: &Value) {
    let ty = item.get("type").and_then(|t| t.as_str()).unwrap_or("");
    match ty {
        "function_call" => {
            let call = json!({
                "id": item.get("call_id").cloned().unwrap_or(json!("")),
                "type": "function",
                "function": {
                    "name": item.get("name").cloned().unwrap_or(json!("")),
                    "arguments": item.get("arguments").cloned().unwrap_or(json!("{}")),
                }
            });
            if let Some(last) = messages.last_mut() {
                if last.get("role").and_then(|r| r.as_str()) == Some("assistant") {
                    match last.get_mut("tool_calls").and_then(|t| t.as_array_mut()) {
                        Some(calls) => calls.push(call),
                        None => last["tool_calls"] = json!([call]),
                    }
                    return;
                }
            }
            messages.push(json!({"role": "assistant", "content": null, "tool_calls": [call]}));
        }
        "function_call_output" => {
            let output = match item.get("output") {
                Some(Value::String(s)) => s.clone(),
                Some(other) => other.to_string(),
                None => String::new(),
            };
            messages.push(json!({
                "role": "tool",
                "tool_call_id": item.get("call_id").cloned().unwrap_or(json!("")),
                "content": output,
            }));
        }
        "reasoning" => {}
        _ => {
            let role = match item.get("role").and_then(|r| r.as_str()).unwrap_or("user") {
                r @ ("assistant" | "system" | "user") => r,
                "developer" => "system",
                _ => "user",
            };
            let content = match item.get("content") {
                Some(Value::Array(blocks)) => input_blocks_to_chat(blocks),
                Some(other) => other.clone(),
                None => item.get("text").cloned().unwrap_or(json!("")),
            };
            messages.push(json!({"role": role, "content": content}));
        }
    }
}

/// Responses content blocks → chat content: a string, or parts when images are present.
fn input_blocks_to_chat(blocks: &[Value]) -> Value {
    let has_image = blocks
        .iter()
        .any(|b| b.get("type").and_then(|t| t.as_str()) == Some("input_image"));
    if !has_image {
        return Value::String(content_text(&Value::Array(blocks.to_vec())));
    }
    Value::Array(
        blocks
            .iter()
            .filter_map(|b| match b.get("type").and_then(|t| t.as_str()) {
                Some("input_image") => {
                    let url = b.get("image_url").and_then(|u| u.as_str())?;
                    let mut img = json!({"url": url});
                    if let Some(d) = b.get("detail") {
                        img["detail"] = d.clone();
                    }
                    Some(json!({"type": "image_url", "image_url": img}))
                }
                _ => b
                    .get("text")
                    .and_then(|t| t.as_str())
                    .map(|t| json!({"type": "text", "text": t})),
            })
            .collect(),
    )
}

/// Convert Chat Completions JSON to Responses API shape.
pub fn chat_to_responses(body: &Bytes, model: &str) -> AppResult<Bytes> {
    let v: Value = serde_json::from_slice(body)
        .map_err(|e| AppError::BadRequest(format!("upstream JSON: {e}")))?;

    let id = v
        .get("id")
        .and_then(|i| i.as_str())
        .unwrap_or("resp_thinrouter");
    let text = v
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or("");
    let finish = v
        .pointer("/choices/0/finish_reason")
        .and_then(|f| f.as_str())
        .unwrap_or("stop");
    let status = match finish {
        "length" => "incomplete",
        _ => "completed",
    };
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
    let mut output = Vec::new();
    if !text.is_empty() || calls.is_empty() {
        output.push(json!({
            "type": "message",
            "id": "msg_0",
            "role": "assistant",
            "status": "completed",
            "content": [{"type": "output_text", "text": text, "annotations": []}]
        }));
    }
    for (i, call) in calls.iter().enumerate() {
        output.push(json!({
            "type": "function_call",
            "id": format!("fc_{i}"),
            "call_id": call.get("id").cloned().unwrap_or(json!("")),
            "name": call.pointer("/function/name").cloned().unwrap_or(json!("")),
            "arguments": call.pointer("/function/arguments").cloned().unwrap_or(json!("{}")),
            "status": "completed",
        }));
    }

    let out = json!({
        "id": id.replace("chatcmpl-", "resp_"),
        "object": "response",
        "created_at": chrono::Utc::now().timestamp(),
        "status": status,
        "model": model,
        "output": output,
        "usage": {
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "total_tokens": input_tokens + output_tokens
        }
    });
    Ok(Bytes::from(serde_json::to_vec(&out)?))
}

pub fn extract_responses_model_stream(body: &Bytes) -> AppResult<(String, bool)> {
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

/// `chat.completion.chunk` SSE → Responses API SSE: `response.created`, a `message`
/// item for text and one `function_call` item per tool call (each opened with
/// `output_item.added`, filled by deltas, closed with `.done` events), then
/// `response.completed` carrying the full output and usage. Records are
/// `event: ...\ndata: ...`; Responses streams end without `[DONE]`.
pub struct ChatToResponsesStream {
    id: String,
    model: String,
    created: i64,
    seq: u64,
    started: bool,
    done: bool,
    /// Output items in order (finished ones complete).
    output: Vec<Value>,
    /// Index into `output` of the open text item, and its text so far.
    text: Option<(usize, String)>,
    /// chat tool index → (index into `output`, arguments so far)
    tools: HashMap<i64, (usize, String)>,
    finish: Option<String>,
    usage: Option<(i64, i64)>,
}

impl ChatToResponsesStream {
    pub fn new(model: impl Into<String>) -> Self {
        Self {
            id: "resp_thinrouter".into(),
            model: model.into(),
            created: chrono::Utc::now().timestamp(),
            seq: 0,
            started: false,
            done: false,
            output: Vec::new(),
            text: None,
            tools: HashMap::new(),
            finish: None,
            usage: None,
        }
    }

    fn ev(&mut self, ty: &str, mut body: Value) -> String {
        body["type"] = json!(ty);
        body["sequence_number"] = json!(self.seq);
        self.seq += 1;
        sse(ty, &body)
    }

    fn response(&self, status: &str) -> Value {
        let mut r = json!({
            "id": self.id, "object": "response", "created_at": self.created,
            "status": status, "model": self.model, "output": self.output,
        });
        if let Some((i, o)) = self.usage {
            r["usage"] = json!({"input_tokens": i, "output_tokens": o, "total_tokens": i + o});
        }
        r
    }

    fn start(&mut self, out: &mut Vec<String>) {
        if !self.started {
            self.started = true;
            let r = self.response("in_progress");
            out.push(self.ev("response.created", json!({"response": r})));
        }
    }

    fn close_text(&mut self, out: &mut Vec<String>) {
        let Some((idx, text)) = self.text.take() else {
            return;
        };
        let item_id = format!("msg_{idx}");
        out.push(self.ev(
            "response.output_text.done",
            json!({"item_id": item_id, "output_index": idx, "content_index": 0, "text": text}),
        ));
        let part = json!({"type": "output_text", "text": text, "annotations": []});
        out.push(self.ev(
            "response.content_part.done",
            json!({"item_id": item_id, "output_index": idx, "content_index": 0, "part": part}),
        ));
        self.output[idx]["status"] = json!("completed");
        self.output[idx]["content"] = json!([part]);
        let item = self.output[idx].clone();
        out.push(self.ev(
            "response.output_item.done",
            json!({"output_index": idx, "item": item}),
        ));
    }

    fn close_tools(&mut self, out: &mut Vec<String>) {
        let mut open: Vec<(i64, (usize, String))> = self.tools.drain().collect();
        open.sort_by_key(|(_, (idx, _))| *idx);
        for (_, (idx, args)) in open {
            let item_id = format!("fc_{idx}");
            out.push(self.ev(
                "response.function_call_arguments.done",
                json!({"item_id": item_id, "output_index": idx, "arguments": args}),
            ));
            self.output[idx]["arguments"] = json!(args);
            self.output[idx]["status"] = json!("completed");
            let item = self.output[idx].clone();
            out.push(self.ev(
                "response.output_item.done",
                json!({"output_index": idx, "item": item}),
            ));
        }
    }

    fn finish(&mut self) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        self.done = true;
        let mut out = Vec::new();
        self.start(&mut out);
        self.close_text(&mut out);
        self.close_tools(&mut out);
        let (ty, status) = match self.finish.as_deref() {
            Some("length") => ("response.incomplete", "incomplete"),
            _ => ("response.completed", "completed"),
        };
        let mut r = self.response(status);
        if status == "incomplete" {
            r["incomplete_details"] = json!({"reason": "max_output_tokens"});
        }
        out.push(self.ev(ty, json!({"response": r})));
        out
    }

    pub fn on_data(&mut self, data: &str) -> Vec<String> {
        if self.done {
            return Vec::new();
        }
        if data.trim() == "[DONE]" {
            return self.finish();
        }
        let Ok(v) = serde_json::from_str::<Value>(data) else {
            return Vec::new();
        };
        let mut out = Vec::new();
        if let Some(err) = v.get("error") {
            self.start(&mut out);
            out.push(self.ev("error", json!({
                "code": err.get("code").cloned().unwrap_or(Value::Null),
                "message": err.get("message").cloned().unwrap_or_else(|| json!(err.to_string())),
            })));
            let mut r = self.response("failed");
            r["error"] = err.clone();
            out.push(self.ev("response.failed", json!({"response": r})));
            self.done = true;
            return out;
        }
        if !self.started {
            if let Some(id) = v.get("id").and_then(|i| i.as_str()) {
                self.id = id.replace("chatcmpl-", "resp_");
            }
        }
        self.start(&mut out);
        if let Some(u) = v.get("usage").filter(|u| u.is_object()) {
            let i = u.get("prompt_tokens").and_then(|n| n.as_i64()).unwrap_or(0);
            let o = u
                .get("completion_tokens")
                .and_then(|n| n.as_i64())
                .unwrap_or(0);
            self.usage = Some((i, o));
        }
        let delta = v
            .pointer("/choices/0/delta")
            .cloned()
            .unwrap_or(Value::Null);
        if let Some(t) = delta
            .get("content")
            .and_then(|c| c.as_str())
            .filter(|t| !t.is_empty())
        {
            if self.text.is_none() {
                let idx = self.output.len();
                let item = json!({"type": "message", "id": format!("msg_{idx}"), "role": "assistant",
                    "status": "in_progress", "content": []});
                self.output.push(item.clone());
                out.push(self.ev(
                    "response.output_item.added",
                    json!({"output_index": idx, "item": item}),
                ));
                out.push(self.ev(
                    "response.content_part.added",
                    json!({
                        "item_id": format!("msg_{idx}"), "output_index": idx, "content_index": 0,
                        "part": {"type": "output_text", "text": "", "annotations": []}
                    }),
                ));
                self.text = Some((idx, String::new()));
            }
            let idx = self.text.as_ref().map(|(i, _)| *i).unwrap_or(0);
            if let Some((_, acc)) = self.text.as_mut() {
                acc.push_str(t);
            }
            out.push(self.ev("response.output_text.delta", json!({
                "item_id": format!("msg_{idx}"), "output_index": idx, "content_index": 0, "delta": t
            })));
        }
        for call in delta
            .get("tool_calls")
            .and_then(|t| t.as_array())
            .into_iter()
            .flatten()
        {
            let k = call.get("index").and_then(|i| i.as_i64()).unwrap_or(0);
            if !self.tools.contains_key(&k) {
                self.close_text(&mut out);
                let idx = self.output.len();
                let item = json!({
                    "type": "function_call", "id": format!("fc_{idx}"),
                    "call_id": call.get("id").cloned().unwrap_or(json!("")),
                    "name": call.pointer("/function/name").cloned().unwrap_or(json!("")),
                    "arguments": "", "status": "in_progress",
                });
                self.output.push(item.clone());
                out.push(self.ev(
                    "response.output_item.added",
                    json!({"output_index": idx, "item": item}),
                ));
                self.tools.insert(k, (idx, String::new()));
            }
            if let Some(a) = call
                .pointer("/function/arguments")
                .and_then(|a| a.as_str())
                .filter(|a| !a.is_empty())
            {
                let idx = self.tools.get(&k).map(|(i, _)| *i).unwrap_or(0);
                if let Some((_, acc)) = self.tools.get_mut(&k) {
                    acc.push_str(a);
                }
                out.push(self.ev(
                    "response.function_call_arguments.delta",
                    json!({
                        "item_id": format!("fc_{idx}"), "output_index": idx, "delta": a
                    }),
                ));
            }
        }
        if let Some(f) = v
            .pointer("/choices/0/finish_reason")
            .and_then(|f| f.as_str())
        {
            self.finish = Some(f.to_string());
        }
        out
    }

    /// Preserve finish_reason-only Chat upstreams without inventing completion.
    pub fn on_end(&mut self) -> Vec<String> {
        if self.done || self.finish.is_some() {
            return self.finish();
        }
        self.on_data(
            &json!({"error": {
                "type": "api_error", "message": crate::error::INCOMPLETE_STREAM_MESSAGE
            }})
            .to_string(),
        )
    }
}

fn sse(event: &str, data: &Value) -> String {
    format!("event: {event}\ndata: {data}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn js(b: &Bytes) -> Value {
        serde_json::from_slice(b).unwrap()
    }

    #[test]
    fn convert_string_input() {
        let body = Bytes::from(r#"{"model":"cheap","input":"hello","max_output_tokens":32}"#);
        let v = js(&responses_to_chat(&body).unwrap());
        assert_eq!(v["model"], "cheap");
        assert_eq!(v["messages"][0]["role"], "user");
        assert_eq!(v["messages"][0]["content"], "hello");
        assert_eq!(v["max_tokens"], 32);
    }

    #[test]
    fn convert_response() {
        let body = Bytes::from(
            r#"{"id":"chatcmpl-1","choices":[{"message":{"role":"assistant","content":"yo"},"finish_reason":"stop"}],"usage":{"prompt_tokens":1,"completion_tokens":1}}"#,
        );
        let v = js(&chat_to_responses(&body, "cheap").unwrap());
        assert_eq!(v["object"], "response");
        assert_eq!(v["output"][0]["content"][0]["text"], "yo");
    }

    #[test]
    fn chat_request_with_tools_history_and_images() {
        let body = Bytes::from(
            json!({
                "model": "m",
                "messages": [
                    {"role": "system", "content": "be brief"},
                    {"role": "user", "content": [
                        {"type": "text", "text": "what is this?"},
                        {"type": "image_url", "image_url": {"url": "data:image/png;base64,AAA", "detail": "low"}}
                    ]},
                    {"role": "assistant", "content": "checking", "tool_calls": [
                        {"id": "call_1", "type": "function", "function": {"name": "lookup", "arguments": "{\"q\":1}"}}
                    ]},
                    {"role": "tool", "tool_call_id": "call_1", "content": "result"}
                ],
                "tools": [{"type": "function", "function": {"name": "lookup", "description": "d", "parameters": {"type": "object"}}}],
                "tool_choice": {"type": "function", "function": {"name": "lookup"}},
                "temperature": 0.2,
                "stream": true
            })
            .to_string(),
        );
        let v = js(&chat_to_responses_request(&body).unwrap());
        assert_eq!(v["instructions"], "be brief");
        assert_eq!(v["store"], false);
        assert!(v.get("temperature").is_none());
        let input = v["input"].as_array().unwrap();
        assert_eq!(input[0]["content"][0]["type"], "input_text");
        assert_eq!(input[0]["content"][1]["type"], "input_image");
        assert_eq!(
            input[0]["content"][1]["image_url"],
            "data:image/png;base64,AAA"
        );
        assert_eq!(input[0]["content"][1]["detail"], "low");
        assert_eq!(input[1]["role"], "assistant");
        assert_eq!(input[1]["content"][0]["type"], "output_text");
        assert_eq!(input[2]["type"], "function_call");
        assert_eq!(input[2]["call_id"], "call_1");
        assert_eq!(input[2]["arguments"], "{\"q\":1}");
        assert_eq!(input[3]["type"], "function_call_output");
        assert_eq!(input[3]["call_id"], "call_1");
        assert_eq!(input[3]["output"], "result");
        assert_eq!(v["tools"][0]["name"], "lookup");
        assert_eq!(v["tools"][0]["parameters"]["type"], "object");
        assert!(v["tools"][0].get("function").is_none());
        assert_eq!(
            v["tool_choice"],
            json!({"type": "function", "name": "lookup"})
        );
    }

    #[test]
    fn responses_body_with_function_call_maps_to_tool_calls() {
        let body = Bytes::from(
            json!({
                "id": "resp_1", "model": "gpt", "status": "completed",
                "output": [
                    {"type": "reasoning", "id": "rs_1", "summary": []},
                    {"type": "function_call", "id": "fc_1", "call_id": "call_9", "name": "lookup", "arguments": "{}"}
                ],
                "usage": {"input_tokens": 3, "output_tokens": 2}
            })
            .to_string(),
        );
        let v = js(&responses_body_to_chat(&body).unwrap());
        assert_eq!(v["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(v["choices"][0]["message"]["content"], Value::Null);
        assert_eq!(v["choices"][0]["message"]["tool_calls"][0]["id"], "call_9");
        assert_eq!(v["usage"]["total_tokens"], 5);

        let incomplete = Bytes::from(
            r#"{"status":"incomplete","incomplete_details":{"reason":"max_output_tokens"},"output":[{"type":"message","content":[{"type":"output_text","text":"cut"}]}]}"#,
        );
        let v = js(&responses_body_to_chat(&incomplete).unwrap());
        assert_eq!(v["choices"][0]["finish_reason"], "length");
    }

    #[test]
    fn responses_items_roundtrip_to_chat_request() {
        let body = Bytes::from(
            json!({
                "model": "m",
                "input": [
                    {"type": "message", "role": "user", "content": [
                        {"type": "input_text", "text": "see"},
                        {"type": "input_image", "image_url": "https://x/y.png"}
                    ]},
                    {"type": "function_call", "call_id": "c1", "name": "a", "arguments": "{}"},
                    {"type": "function_call", "call_id": "c2", "name": "b", "arguments": "{}"},
                    {"type": "function_call_output", "call_id": "c1", "output": "r1"},
                    {"type": "function_call_output", "call_id": "c2", "output": "r2"}
                ],
                "tools": [{"type": "function", "name": "a", "parameters": {}}, {"type": "web_search"}]
            })
            .to_string(),
        );
        let v = js(&responses_to_chat(&body).unwrap());
        let m = v["messages"].as_array().unwrap();
        assert_eq!(m[0]["content"][1]["image_url"]["url"], "https://x/y.png");
        assert_eq!(m[1]["tool_calls"].as_array().unwrap().len(), 2);
        assert_eq!(m[2]["tool_call_id"], "c1");
        assert_eq!(m[3]["tool_call_id"], "c2");
        assert_eq!(v["tools"].as_array().unwrap().len(), 1);
        assert_eq!(v["tools"][0]["function"]["name"], "a");
    }

    fn feed(conv: &mut ResponsesToChatStream, events: &[Value]) -> Vec<Value> {
        let mut out = Vec::new();
        for e in events {
            out.extend(conv.on_data(&e.to_string()));
        }
        out.extend(conv.on_end());
        out.iter()
            .map(|l| {
                let d = l.strip_prefix("data: ").unwrap();
                if d == "[DONE]" {
                    json!("[DONE]")
                } else {
                    serde_json::from_str(d).unwrap()
                }
            })
            .collect()
    }

    #[test]
    fn responses_stream_to_chat_chunks_with_tool_call() {
        let mut conv = ResponsesToChatStream::new("public");
        let out = feed(
            &mut conv,
            &[
                json!({"type": "response.created", "response": {"id": "resp_7", "model": "gpt-x"}}),
                json!({"type": "response.output_text.delta", "output_index": 0, "delta": "Hi"}),
                json!({"type": "response.output_item.added", "output_index": 1, "item": {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": ""}}),
                json!({"type": "response.function_call_arguments.delta", "item_id": "fc_1", "output_index": 1, "delta": "{\"q\":"}),
                json!({"type": "response.function_call_arguments.delta", "item_id": "fc_1", "output_index": 1, "delta": "1}"}),
                json!({"type": "response.output_item.done", "output_index": 1, "item": {"type": "function_call", "id": "fc_1", "call_id": "call_1", "name": "lookup", "arguments": "{\"q\":1}"}}),
                json!({"type": "response.completed", "response": {"status": "completed", "usage": {"input_tokens": 4, "output_tokens": 6}}}),
            ],
        );
        assert_eq!(out[0]["choices"][0]["delta"]["role"], "assistant");
        assert_eq!(out[0]["id"], "chatcmpl-7");
        assert_eq!(out[1]["choices"][0]["delta"]["content"], "Hi");
        let tc = &out[2]["choices"][0]["delta"]["tool_calls"][0];
        assert_eq!(tc["index"], 0);
        assert_eq!(tc["id"], "call_1");
        assert_eq!(tc["function"]["name"], "lookup");
        let args: String = out[3..5]
            .iter()
            .map(|c| {
                c["choices"][0]["delta"]["tool_calls"][0]["function"]["arguments"]
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert_eq!(args, "{\"q\":1}");
        assert_eq!(out[5]["choices"][0]["finish_reason"], "tool_calls");
        assert_eq!(out[5]["usage"]["total_tokens"], 10);
        assert_eq!(out[6], json!("[DONE]"));
        assert_eq!(out.len(), 7, "item.done must not repeat streamed arguments");
    }

    #[test]
    fn sc1_stream_without_completed_reports_failure() {
        let mut conv = ResponsesToChatStream::new("m");
        let out = feed(
            &mut conv,
            &[json!({"type": "response.output_text.delta", "delta": "x"})],
        );
        assert_eq!(out.last().unwrap(), &json!("[DONE]"));
        assert_eq!(
            out[out.len() - 2]["error"]["message"],
            crate::error::INCOMPLETE_STREAM_MESSAGE
        );
        assert!(out
            .iter()
            .any(|v| v.pointer("/choices/0/delta/content") == Some(&json!("x"))));
        assert!(!out.iter().any(|v| v
            .pointer("/choices/0/finish_reason")
            .is_some_and(|f| !f.is_null())));
        assert!(conv.on_end().is_empty());
    }

    fn events_of(records: &[String]) -> Vec<(String, Value)> {
        records
            .iter()
            .map(|r| {
                let mut l = r.lines();
                let name = l.next().unwrap().trim_start_matches("event: ").to_string();
                let data =
                    serde_json::from_str(l.next().unwrap().trim_start_matches("data: ")).unwrap();
                (name, data)
            })
            .collect()
    }

    #[test]
    fn chat_stream_to_responses_events_with_tool_calls() {
        let mut c = ChatToResponsesStream::new("pub");
        let chunks = [
            json!({"id": "chatcmpl-9", "choices": [{"index": 0, "delta": {"role": "assistant", "content": "Let me "}}]}),
            json!({"choices": [{"index": 0, "delta": {"content": "check."}}]}),
            json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "id": "call_1", "type": "function", "function": {"name": "lookup", "arguments": ""}}]}}]}),
            json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "{\"q\":"}}]}}]}),
            json!({"choices": [{"index": 0, "delta": {"tool_calls": [{"index": 0, "function": {"arguments": "1}"}}]}}]}),
            json!({"choices": [{"index": 0, "delta": {}, "finish_reason": "tool_calls"}], "usage": {"prompt_tokens": 7, "completion_tokens": 3}}),
        ];
        let mut recs = Vec::new();
        for ch in chunks {
            recs.extend(c.on_data(&ch.to_string()));
        }
        recs.extend(c.on_data("[DONE]"));
        assert!(c.on_end().is_empty());
        let evs = events_of(&recs);
        let names: Vec<&str> = evs.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(
            names,
            [
                "response.created",
                "response.output_item.added",
                "response.content_part.added",
                "response.output_text.delta",
                "response.output_text.delta",
                "response.output_text.done",
                "response.content_part.done",
                "response.output_item.done",
                "response.output_item.added",
                "response.function_call_arguments.delta",
                "response.function_call_arguments.delta",
                "response.function_call_arguments.done",
                "response.output_item.done",
                "response.completed",
            ]
        );
        for (i, (n, d)) in evs.iter().enumerate() {
            assert_eq!(d["type"], json!(n));
            assert_eq!(d["sequence_number"], json!(i));
        }
        assert_eq!(evs[0].1["response"]["id"], "resp_9");
        assert_eq!(evs[5].1["text"], "Let me check.");
        assert_eq!(evs[8].1["item"]["call_id"], "call_1");
        assert_eq!(evs[11].1["arguments"], "{\"q\":1}");
        let done = &evs[13].1["response"];
        assert_eq!(done["status"], "completed");
        assert_eq!(done["model"], "pub");
        assert_eq!(done["output"][0]["content"][0]["text"], "Let me check.");
        assert_eq!(done["output"][1]["type"], "function_call");
        assert_eq!(done["output"][1]["arguments"], "{\"q\":1}");
        assert_eq!(done["usage"]["total_tokens"], 10);
        assert!(!recs.iter().any(|r| r.contains("[DONE]")));
    }

    #[test]
    fn chat_stream_to_responses_length_and_error() {
        let mut c = ChatToResponsesStream::new("m");
        c.on_data(&json!({"choices": [{"index": 0, "delta": {"content": "cut"}, "finish_reason": "length"}]}).to_string());
        let evs = events_of(&c.on_end());
        assert_eq!(evs.last().unwrap().0, "response.incomplete");
        let mut c = ChatToResponsesStream::new("m");
        let evs = events_of(&c.on_data(
            &json!({"error": {"code": "rate_limit", "message": "slow down"}}).to_string(),
        ));
        let names: Vec<&str> = evs.iter().map(|(n, _)| n.as_str()).collect();
        assert_eq!(names, ["response.created", "error", "response.failed"]);
        assert!(c.on_end().is_empty());
    }

    #[test]
    fn reassemble_prefers_completed_items() {
        let raw = [
            json!({"type": "response.created", "response": {"id": "resp_1", "model": "gpt-x"}}),
            json!({"type": "response.output_text.delta", "delta": "ok"}),
            json!({"type": "response.output_item.done", "output_index": 0, "item": {"type": "message", "role": "assistant", "content": [{"type": "output_text", "text": "ok"}]}}),
            json!({"type": "response.output_item.done", "output_index": 1, "item": {"type": "function_call", "call_id": "c", "name": "f", "arguments": "{}"}}),
            json!({"type": "response.completed", "response": {"id": "resp_1", "status": "completed", "output": [], "usage": {"input_tokens": 1, "output_tokens": 1}}}),
        ]
        .iter()
        .map(|e| format!("event: x\ndata: {e}\n\n"))
        .collect::<String>();
        let v = js(&reassemble_sse(&raw).unwrap());
        assert_eq!(v["model"], "gpt-x");
        assert_eq!(v["output"].as_array().unwrap().len(), 2);
        assert_eq!(v["usage"]["input_tokens"], 1);
        let chat = js(&responses_body_to_chat(&reassemble_sse(&raw).unwrap()).unwrap());
        assert_eq!(chat["choices"][0]["message"]["content"], "ok");
        assert_eq!(chat["choices"][0]["finish_reason"], "tool_calls");
    }

    fn transcript(events: &[Value]) -> String {
        events.iter().map(|v| format!("data: {v}\n\n")).collect()
    }

    #[test]
    fn br1_collector_requires_a_consistent_terminal() {
        for raw in ["", "data: [DONE]\n\n", "data: {broken\n\n"] {
            assert_eq!(reassemble_sse(raw).unwrap_err().status_code(), 502);
        }
        for event in [
            json!({"type":"response.output_text.delta","delta":"PRIVATE"}),
            json!({"type":"response.output_item.done","item":{"type":"function_call","arguments":"{}"}}),
            json!({"type":"response.completed"}),
            json!({"type":"response.completed","response":[]}),
            json!({"type":"response.completed","response":{"status":"incomplete"}}),
            json!({"type":"response.incomplete","response":{"status":"completed"}}),
            json!({"type":"response.completed","response":{"status":"completed","error":{"message":"PRIVATE"}}}),
            json!({"type":"response.completed","response":{"status":"completed","error":{"code":"subscription_sharing_usage_limit_exceeded","message":"PRIVATE"}}}),
        ] {
            let err = reassemble_sse(&transcript(&[event])).unwrap_err();
            assert_eq!(err.status_code(), 502);
            assert!(!err.to_string().contains("PRIVATE"));
        }
    }

    #[test]
    fn br2_first_terminal_controls_collection_and_errors_are_redacted() {
        let success = json!({"type":"response.completed","response":{"status":"completed","output":[],"usage":{"input_tokens":3,"output_tokens":2}}});
        for error in [
            json!({"type":"error","message":"PRIVATE"}),
            json!({"type":"error","error":{"code":"PRIVATE","message":"PRIVATE"}}),
            json!({"type":"response.failed","response":{"error":{"code":"PRIVATE","message":"PRIVATE"}}}),
            json!({"type":"response.completed","response":null}),
        ] {
            let err = reassemble_sse(&transcript(&[error.clone(), success.clone()])).unwrap_err();
            assert_eq!(err.status_code(), 502);
            assert!(!err.to_string().contains("PRIVATE"));
            let accepted = js(&reassemble_sse(&transcript(&[success.clone(), error])).unwrap());
            assert_eq!(accepted["status"], "completed");
            assert!(!accepted.to_string().contains("PRIVATE"));
        }
        for code in [
            "subscription_sharing_usage_limit_exceeded",
            "subscription_sharing_usage_unavailable",
        ] {
            for error in [
                json!({"type":"error","code":code,"message":"PRIVATE"}),
                json!({"type":"error","error":{"code":code,"message":"PRIVATE"}}),
                json!({"type":"response.failed","response":{"status":"failed","error":{"code":code,"message":"PRIVATE"}}}),
            ] {
                let err = reassemble_sse(&transcript(&[error])).unwrap_err();
                assert_eq!(err.status_code(), 429);
                assert!(err.to_string().contains(code));
                assert!(!err.to_string().contains("PRIVATE"));
            }
        }
    }

    #[test]
    fn br3_collector_preserves_terminal_output_and_incomplete_details() {
        for status in ["completed", "incomplete"] {
            let terminal = json!({"type":format!("response.{status}"),"response":{"id":"resp1","status":status,
                "output":[{"type":"message","content":[{"type":"output_text","text":"terminal text"}]}],
                "usage":{"input_tokens":3,"output_tokens":2},"incomplete_details":{"reason":"content_filter"}}});
            let v = js(&reassemble_sse(&transcript(&[terminal])).unwrap());
            assert_eq!(v["status"], status);
            assert_eq!(v["output"][0]["content"][0]["text"], "terminal text");
            assert_eq!(v["usage"]["input_tokens"], 3);
            assert_eq!(v["incomplete_details"]["reason"], "content_filter");
        }
    }

    #[test]
    fn br3_terminal_output_is_authoritative_over_intermediate_items() {
        for status in ["completed", "incomplete"] {
            let output = json!([
                {"type":"message","id":"msg1","content":[{"type":"output_text","text":"final text"}]},
                {"type":"function_call","call_id":"c1","name":"lookup","arguments":"{}"}
            ]);
            let events = [
                json!({"type":"response.output_item.done","output_index":0,"item":{"type":"message","id":"msg1","content":[{"type":"output_text","text":"stale partial"}]}}),
                json!({"type":format!("response.{status}"),"response":{"status":status,"output":output,"usage":{"input_tokens":3,"output_tokens":2}}}),
            ];
            let value = js(&reassemble_sse(&transcript(&events)).unwrap());
            assert_eq!(
                value["output"], output,
                "terminal output must not lose items or use stale content"
            );
            assert_eq!(value["status"], status);
        }
    }
}

//! Bounded, read-only observation of raw Chat and Responses SSE for accounting.
//! It never changes bytes, drives the upstream, or retains event contents in SQLite.
use std::time::Instant;

use serde_json::Value;

use crate::store::{Store, StreamFinalization};

const EVENT_LIMIT: usize = 64 * 1024;
const CHOICE_LIMIT: usize = 128;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum HttpUsageFormat {
    Chat,
    Responses,
}

pub struct StreamAttempt {
    store: Store,
    id: String,
    start: Instant,
    input_price: Option<f64>,
    output_price: Option<f64>,
    observation: ChatObservation,
    settled: bool,
}

impl StreamAttempt {
    pub fn begin(
        store: &Store,
        request_id: &str,
        model: &str,
        target: &crate::store::ResolvedTarget,
        body: &[u8],
    ) -> crate::error::AppResult<Self> {
        Self::begin_http(
            store,
            request_id,
            model,
            target,
            body,
            HttpUsageFormat::Chat,
            true,
        )
    }

    #[allow(
        clippy::too_many_arguments,
        reason = "Explicit raw format and estimate policy at the dispatch boundary"
    )]
    pub fn begin_http(
        store: &Store,
        request_id: &str,
        model: &str,
        target: &crate::store::ResolvedTarget,
        body: &[u8],
        format: HttpUsageFormat,
        allow_estimate: bool,
    ) -> crate::error::AppResult<Self> {
        let reserved = match format {
            HttpUsageFormat::Chat => store.begin_stream_attempt(
                request_id,
                model,
                &target.connection.id,
                &target.upstream_model,
            ),
            HttpUsageFormat::Responses => store.begin_stream_attempt_with_source(
                request_id,
                model,
                &target.connection.id,
                &target.upstream_model,
                "openai_responses_v1",
            ),
        };
        let id = reserved.map_err(|_| crate::error::AppError::Upstream {
            status: 503,
            body: "usage reservation failed".into(),
        })?;
        let choices = serde_json::from_slice::<Value>(body)
            .ok()
            .and_then(|v| v.get("n").cloned())
            .map_or(Some(1), |n| {
                n.as_u64().and_then(|n| usize::try_from(n).ok())
            });
        Ok(Self {
            store: store.clone(),
            id,
            start: Instant::now(),
            input_price: target
                .connection
                .input_price_per_m
                .filter(|_| allow_estimate),
            output_price: target
                .connection
                .output_price_per_m
                .filter(|_| allow_estimate),
            observation: match format {
                HttpUsageFormat::Chat => ChatObservation::new(choices),
                HttpUsageFormat::Responses => ChatObservation::responses(),
            },
            settled: false,
        })
    }

    fn elapsed(&self) -> i64 {
        self.start.elapsed().as_millis().min(i64::MAX as u128) as i64
    }

    pub fn headers(&mut self, status: u16) {
        if self
            .store
            .observe_stream_headers(&self.id, i64::from(status), self.elapsed())
            .is_err()
        {
            // A failed write is not a reason to replay already-dispatched inference.
            tracing::warn!("usage_headers_write_failed");
        }
    }

    pub fn push(&mut self, bytes: &[u8]) {
        if self.settled {
            return;
        }
        self.observation.push(bytes, self.elapsed());
        if self.observation.transport_done {
            self.settle("unknown", None, true);
        }
    }

    /// Conversion consumes a prefix of each received chunk. Defer settlement until
    /// that prefix has passed the converter, without observing bytes it discards.
    pub fn observe_converted(&mut self, bytes: &[u8]) {
        if !self.settled {
            self.observation.converted_lines = true;
            self.observation.push(bytes, self.elapsed());
            // Existing converters consume each LF-terminated data line, before
            // its SSE blank delimiter. Retain that observed finish/usage even
            // if a subsequent read error, stall or cancellation ends the source.
            if bytes.ends_with(b"\n") {
                self.observation.end(self.elapsed());
            }
        }
    }

    /// Native guard owns validity and CR lookahead. Observe only the raw prefix it
    /// consumed, then let its terminal disposition settle before final output.
    pub fn observe_native(&mut self, bytes: &[u8]) {
        if !self.settled {
            self.observation.push(bytes, self.elapsed());
        }
    }

    /// The converter accepts its final data line before the SSE blank delimiter.
    /// Flush only the consumed prefix; a conversion rejection wins content finish.
    pub fn converted_terminal(&mut self, failed: bool) {
        if self.settled {
            return;
        }
        self.observation.end(self.elapsed());
        if failed && self.observation.outcome != Some("failed") {
            self.observation.outcome = Some("failed");
            self.observation.error = Some("stream_conversion_failed");
            self.observation.terminal_ms = None;
        }
        let ended = self.observation.transport_done;
        self.settle("unknown", None, ended);
    }

    pub fn eof(&mut self) {
        if self.settled {
            return;
        }
        self.observation.end(self.elapsed());
        self.settle("failed", Some("stream_incomplete"), true);
    }

    pub fn stop(&mut self, outcome: &'static str, error: &'static str) {
        self.settle(outcome, Some(error), false);
    }

    fn settle(&mut self, fallback: &'static str, error: Option<&'static str>, ended: bool) {
        if self.settled {
            return;
        }
        self.settled = true; // One write attempt; failure stays pending for startup recovery.
        let o = &self.observation;
        let outcome = o
            .outcome
            .unwrap_or(if o.invalid { "unknown" } else { fallback });
        let usage_status = if o.invalid_usage || o.invalid {
            "invalid"
        } else if o.prompt.is_some() && o.completion.is_some() && ended {
            "complete"
        } else if o.prompt.is_some() || o.completion.is_some() {
            "partial"
        } else {
            "missing"
        };
        let cost = if usage_status == "complete" {
            crate::proxy::estimate_cost(o.prompt, o.completion, self.input_price, self.output_price)
        } else {
            None
        };
        let reason = if !ended {
            error.or(o.error)
        } else {
            o.error.or(if o.outcome.is_some() { None } else { error })
        };
        let finalization = StreamFinalization {
            outcome,
            usage_status,
            error: reason,
            prompt_tokens: o.prompt,
            completion_tokens: o.completion,
            estimated_cost_usd: cost,
            first_output_ms: o.first_output_ms,
            total_observed_ms: o.terminal_ms.unwrap_or_else(|| self.elapsed()),
        };
        if self
            .store
            .finalize_stream_attempt(&self.id, &finalization)
            .is_err()
        {
            tracing::warn!("usage_finalization_failed");
        }
    }
}

impl Drop for StreamAttempt {
    fn drop(&mut self) {
        self.stop("cancelled", "stream_cancelled");
    }
}

#[derive(Clone, Copy, Default)]
enum EventName {
    #[default]
    Absent,
    Named(&'static str),
    Other,
}

struct ChatObservation {
    format: HttpUsageFormat,
    event_name: EventName,
    first_line: bool,
    converted_lines: bool,
    line: Vec<u8>,
    data: Vec<u8>,
    cr: bool,
    has_data: bool,
    choices: Vec<Option<&'static str>>,
    prompt: Option<i64>,
    completion: Option<i64>,
    first_output_ms: Option<i64>,
    terminal_ms: Option<i64>,
    outcome: Option<&'static str>,
    error: Option<&'static str>,
    invalid: bool,
    invalid_usage: bool,
    disabled: bool,
    transport_done: bool,
}

impl ChatObservation {
    fn new(choices: Option<usize>) -> Self {
        let supported = choices.is_some_and(|n| (1..=CHOICE_LIMIT).contains(&n));
        Self {
            format: HttpUsageFormat::Chat,
            event_name: EventName::Absent,
            first_line: true,
            converted_lines: false,
            // Exact bounded capacities; no geometric growth on untrusted lines/events.
            line: Vec::with_capacity(EVENT_LIMIT),
            data: Vec::with_capacity(EVENT_LIMIT),
            cr: false,
            has_data: false,
            choices: vec![None; choices.filter(|_| supported).unwrap_or(0)],
            prompt: None,
            completion: None,
            first_output_ms: None,
            terminal_ms: None,
            outcome: None,
            error: if supported {
                None
            } else {
                Some("stream_observer_invalid")
            },
            invalid: !supported,
            invalid_usage: false,
            disabled: !supported,
            transport_done: false,
        }
    }

    fn responses() -> Self {
        Self {
            format: HttpUsageFormat::Responses,
            ..Self::new(Some(1))
        }
    }

    fn invalidate(&mut self, code: &'static str, disable: bool) {
        self.invalid = true;
        self.error = Some(code);
        if disable {
            self.disabled = true;
            self.line = Vec::new();
            self.data = Vec::new();
        }
    }

    fn push(&mut self, bytes: &[u8], elapsed: i64) {
        if self.transport_done || self.disabled {
            return;
        }
        if self.format == HttpUsageFormat::Responses && self.converted_lines {
            self.push_converted_responses(bytes, elapsed);
            return;
        }
        for &b in bytes {
            let native_responses =
                self.format == HttpUsageFormat::Responses && !self.converted_lines;
            if self.cr {
                self.cr = false;
                if native_responses {
                    self.line_end(elapsed);
                    if self.transport_done || self.disabled {
                        break;
                    }
                }
                if b == b'\n' {
                    continue;
                }
            }
            if b == b'\r' || b == b'\n' {
                if b != b'\r' || !native_responses {
                    self.line_end(elapsed);
                }
                self.cr = b == b'\r';
            } else {
                if self.line.len() + self.data.len() >= EVENT_LIMIT {
                    self.invalidate("stream_observer_limit", true);
                    break;
                }
                self.line.push(b);
            }
            if self.transport_done || self.disabled {
                break;
            }
        }
    }

    /// Responses converters consume LF-terminated data lines, not CR-only
    /// frames. A pending line is observed only after LF or explicit final-input
    /// feedback; a raw CR must not invent a terminal before conversion accepts it.
    fn push_converted_responses(&mut self, bytes: &[u8], elapsed: i64) {
        for &b in bytes {
            if b == b'\n' {
                if self.line.last() == Some(&b'\r') {
                    self.line.pop();
                }
                self.line_end(elapsed);
                self.end(elapsed);
            } else {
                if self.line.len() + self.data.len() >= EVENT_LIMIT {
                    self.invalidate("stream_observer_limit", true);
                    break;
                }
                self.line.push(b);
            }
            if self.transport_done || self.disabled {
                break;
            }
        }
    }

    fn line_end(&mut self, elapsed: i64) {
        if self.first_line {
            if self.format == HttpUsageFormat::Responses
                && !self.converted_lines
                && self.line.starts_with(b"\xef\xbb\xbf")
            {
                self.line.drain(..3);
            }
            self.first_line = false;
        }
        if self.line.is_empty() {
            if self.has_data {
                self.event(elapsed);
            }
            self.data.clear();
            self.has_data = false;
            self.event_name = EventName::Absent;
        } else if let Some(data) = self.line.strip_prefix(b"data:") {
            let data = data.strip_prefix(b" ").unwrap_or(data);
            if self.data.len() + data.len() + usize::from(self.has_data) > EVENT_LIMIT {
                self.invalidate("stream_observer_limit", true);
                return;
            }
            if self.has_data {
                self.data.push(b'\n');
            }
            self.data.extend_from_slice(data);
            self.has_data = true;
        } else if self.format == HttpUsageFormat::Responses {
            if self.line == b"data" {
                if self.has_data {
                    self.data.push(b'\n');
                }
                self.has_data = true;
            } else if self.line == b"event" {
                self.event_name = EventName::Absent;
            } else if let Some(name) = self.line.strip_prefix(b"event:") {
                let name = name.strip_prefix(b" ").unwrap_or(name);
                self.event_name = match name {
                    b"" => EventName::Absent,
                    b"response.completed" => EventName::Named("response.completed"),
                    b"response.incomplete" => EventName::Named("response.incomplete"),
                    b"response.failed" => EventName::Named("response.failed"),
                    b"error" => EventName::Named("error"),
                    _ => EventName::Other,
                };
            }
        }
        self.line.clear();
    }

    fn end(&mut self, elapsed: i64) {
        if self.transport_done || self.disabled {
            return;
        }
        if self.format == HttpUsageFormat::Responses && !self.converted_lines && self.cr {
            self.cr = false;
            self.line_end(elapsed);
            if self.transport_done || self.disabled {
                return;
            }
        }
        // Converted streams accept a final unterminated data line. Native guard
        // supplies its validity disposition before any such observation settles.
        if !self.line.is_empty() {
            self.line_end(elapsed);
        }
        if self.has_data {
            self.event(elapsed);
            self.data.clear();
            self.has_data = false;
        }
    }

    fn event(&mut self, elapsed: i64) {
        if self.format == HttpUsageFormat::Responses {
            self.responses_event(elapsed);
            return;
        }
        if self.data == b"[DONE]"
            || (self.converted_lines
                && std::str::from_utf8(&self.data).is_ok_and(|data| data.trim() == "[DONE]"))
        {
            self.transport_done = true;
            self.terminal_ms = Some(elapsed);
            if self.outcome.is_none() {
                self.outcome = Some(if self.invalid { "unknown" } else { "failed" });
                self.error.get_or_insert("stream_incomplete");
            }
            return;
        }
        let value: Value = match serde_json::from_slice(&self.data) {
            Ok(v) => v,
            Err(_) => {
                self.invalidate("stream_observer_invalid", false);
                return;
            }
        };
        if !value.is_object() || value.get("choices").is_some_and(|c| !c.is_array()) {
            self.invalidate("stream_observer_invalid", false);
            return;
        }
        if let Some(usage) = value.get("usage").filter(|v| !v.is_null()) {
            if !usage.is_object() {
                self.invalid_usage = true;
            }
            for (name, target) in [
                ("prompt_tokens", &mut self.prompt),
                ("completion_tokens", &mut self.completion),
            ] {
                if let Some(v) = usage.get(name).filter(|v| !v.is_null()) {
                    match v.as_i64().filter(|v| *v >= 0) {
                        Some(n) => {
                            if target.is_some_and(|old| n < old) {
                                self.invalid_usage = true;
                            } else {
                                *target = Some(n);
                            }
                        }
                        None => self.invalid_usage = true,
                    }
                }
            }
            if self.invalid_usage {
                self.error = Some("stream_invalid_usage");
            }
        }
        // A content terminal wins a later error, while tail usage may still arrive.
        if self.outcome.is_some() {
            return;
        }
        if value.get("error").is_some_and(|e| !e.is_null()) {
            self.outcome = Some("failed");
            self.error = Some("stream_error");
            self.transport_done = true;
            self.terminal_ms = Some(elapsed);
            return;
        }
        if let Some(choices) = value.get("choices").and_then(Value::as_array) {
            for choice in choices {
                if !choice.is_object() {
                    self.invalidate("stream_observer_invalid", false);
                    continue;
                }
                let delta = &choice["delta"];
                let nonempty = |v: &Value| v.as_str().is_some_and(|s| !s.is_empty());
                let tool_output = delta
                    .get("tool_calls")
                    .and_then(Value::as_array)
                    .is_some_and(|calls| {
                        calls.iter().any(|c| {
                            nonempty(&c["function"]["name"])
                                || nonempty(&c["function"]["arguments"])
                        })
                    });
                if nonempty(&delta["content"])
                    || tool_output
                    || nonempty(&delta["function_call"]["name"])
                    || nonempty(&delta["function_call"]["arguments"])
                {
                    self.first_output_ms.get_or_insert(elapsed);
                }
                let index = choice.get("index").map_or(Some(0), |v| {
                    v.as_u64().and_then(|v| usize::try_from(v).ok())
                });
                let Some(index) = index.filter(|i| *i < self.choices.len()) else {
                    self.invalidate("stream_observer_invalid", false);
                    continue;
                };
                if let Some(reason) = choice.get("finish_reason").filter(|r| !r.is_null()) {
                    let outcome = match reason.as_str() {
                        Some("stop" | "tool_calls" | "function_call") => "succeeded",
                        Some("length" | "content_filter") => "incomplete",
                        _ => "unknown",
                    };
                    self.choices[index].get_or_insert(outcome);
                }
            }
            if !self.choices.is_empty() && self.choices.iter().all(Option::is_some) {
                self.outcome = Some(if self.invalid || self.choices.contains(&Some("unknown")) {
                    "unknown"
                } else if self.choices.contains(&Some("incomplete")) {
                    "incomplete"
                } else {
                    "succeeded"
                });
            }
        }
    }
    fn responses_event(&mut self, elapsed: i64) {
        let terminal_name = |kind: &str| {
            matches!(
                kind,
                "response.completed" | "response.incomplete" | "response.failed" | "error"
            )
        };
        let value: Value = match serde_json::from_slice(&self.data) {
            Ok(v) => v,
            Err(_) => {
                // Native preserves unknown non-JSON extension frames. A named
                // terminal or bare DONE still cannot become successful evidence.
                let terminal = matches!(self.event_name, EventName::Named(_))
                    || std::str::from_utf8(&self.data).is_ok_and(|s| s.trim() == "[DONE]");
                if terminal {
                    self.invalidate("stream_observer_invalid", false);
                }
                return;
            }
        };
        let kind = value.get("type").and_then(Value::as_str).unwrap_or("");
        let terminal = terminal_name(kind);
        if !self.converted_lines {
            let mismatch = match self.event_name {
                EventName::Named(name) => name != kind,
                EventName::Other => terminal,
                EventName::Absent => false,
            };
            let invalid_sequence = value
                .get("sequence_number")
                .is_some_and(|v| !v.as_u64().is_some_and(|n| n < i64::MAX as u64));
            if mismatch || invalid_sequence {
                self.invalidate("stream_observer_invalid", false);
                return;
            }
        }
        let response = value.get("response");
        if terminal && kind != "error" {
            let valid = response.is_some_and(|r| {
                r.is_object()
                    && r.get("status").and_then(Value::as_str) == kind.strip_prefix("response.")
                    && (kind == "response.failed" || r.get("error").is_none_or(Value::is_null))
            });
            if !valid {
                self.invalidate("stream_observer_invalid", false);
                return;
            }
        }
        if kind == "error"
            && !value.get("message").is_some_and(Value::is_string)
            && !(self.converted_lines && value.get("error").is_some_and(Value::is_object))
        {
            self.invalidate("stream_observer_invalid", false);
            return;
        }
        // Usage is only the original response object on recognized lifecycle
        // events. Unknown extensions cannot inject counters into this source.
        if matches!(
            kind,
            "response.created"
                | "response.in_progress"
                | "response.completed"
                | "response.incomplete"
                | "response.failed"
        ) {
            if let Some(usage) = response
                .and_then(|r| r.get("usage"))
                .filter(|u| !u.is_null())
            {
                if !usage.is_object() {
                    self.invalid_usage = true;
                }
                for (name, target) in [
                    ("input_tokens", &mut self.prompt),
                    ("output_tokens", &mut self.completion),
                ] {
                    if let Some(v) = usage.get(name).filter(|v| !v.is_null()) {
                        match v.as_i64().filter(|n| *n >= 0) {
                            Some(n) if target.is_none_or(|old| n >= old) => *target = Some(n),
                            _ => self.invalid_usage = true,
                        }
                    }
                }
                if self.invalid_usage {
                    self.error = Some("stream_invalid_usage");
                }
            }
        }
        let nonempty = |v: &Value| v.as_str().is_some_and(|s| !s.is_empty());
        let output = match kind {
            "response.output_text.delta" | "response.function_call_arguments.delta" => {
                nonempty(&value["delta"])
            }
            "response.output_item.added" | "response.output_item.done" => {
                let item = &value["item"];
                item["type"] == "function_call"
                    && (nonempty(&item["name"]) || nonempty(&item["arguments"]))
            }
            _ => false,
        };
        if output {
            self.first_output_ms.get_or_insert(elapsed);
        }
        if terminal {
            self.outcome = Some(match kind {
                "response.completed" => "succeeded",
                "response.incomplete" => "incomplete",
                _ => "failed",
            });
            if self.outcome == Some("failed") {
                self.error = Some("stream_error");
            }
            self.transport_done = true;
            self.terminal_ms = Some(elapsed);
        }
    }
}

#[cfg(test)]
mod stream_usage_tests {
    use super::*;
    use serde_json::json;

    fn frame(v: Value) -> String {
        format!("data: {v}\n\n")
    }
    fn finish(reason: &str) -> String {
        frame(json!({"choices":[{"index":0,"delta":{},"finish_reason":reason}]}))
    }

    #[test]
    fn ss1_ss2_tail_usage_and_terminal_priorities() {
        for (reason, expected) in [
            ("stop", "succeeded"),
            ("tool_calls", "succeeded"),
            ("length", "incomplete"),
            ("content_filter", "incomplete"),
            ("new-reason", "unknown"),
        ] {
            let mut o = ChatObservation::new(Some(1));
            o.push(finish(reason).as_bytes(), 3);
            assert_eq!(o.outcome, Some(expected));
            assert!(!o.transport_done);
            let usage =
                frame(json!({"choices":[],"usage":{"prompt_tokens":0,"completion_tokens":3}}));
            o.push(usage.as_bytes(), 5);
            o.push(usage.as_bytes(), 7);
            o.push(b"data: [DONE]\n\n", 9);
            o.push(
                frame(
                    json!({"error":{"message":"synthetic-canary"},"usage":{"prompt_tokens":999}}),
                )
                .as_bytes(),
                10,
            );
            assert_eq!((o.prompt, o.completion), (Some(0), Some(3)));
            assert_eq!(o.outcome, Some(expected));
            assert_eq!(o.terminal_ms, Some(9));
        }
        let mut o = ChatObservation::new(Some(1));
        o.push(
            frame(json!({"error":{"message":"synthetic-canary"},"usage":{"prompt_tokens":4}}))
                .as_bytes(),
            1,
        );
        o.push(finish("stop").as_bytes(), 2);
        assert_eq!(o.outcome, Some("failed"));
        assert_eq!(o.prompt, Some(4));
        let mut o = ChatObservation::new(Some(1));
        o.push(b"data: [DONE]\n\n", 1);
        assert_eq!(o.outcome, Some("failed"));
    }

    #[test]
    fn ss2_arbitrary_chunks_newlines_multiline_and_missing_usage() {
        let wire=": ping\n\ndata: {\ndata: \"choices\":[{\"index\":0,\"delta\":{\"content\":\"字\"},\"finish_reason\":\"stop\"}]}\n\ndata: [DONE]\n\n";
        for newline in ["\n", "\r", "\r\n"] {
            let bytes = wire.replace('\n', newline).into_bytes();
            for width in [1, 2, 7, 8192] {
                let mut o = ChatObservation::new(Some(1));
                for part in bytes.chunks(width) {
                    o.push(part, 8);
                }
                assert_eq!(o.outcome, Some("succeeded"));
                assert_eq!((o.prompt, o.completion), (None, None));
                assert_eq!(o.first_output_ms, Some(8));
            }
        }
    }

    #[test]
    fn ss2_invalid_usage_never_becomes_complete_from_later_values() {
        for bad in [json!(-1), json!(1.2), json!("3"), json!(u64::MAX)] {
            let mut o = ChatObservation::new(Some(1));
            o.push(
                frame(json!({"usage":{"prompt_tokens":bad,"completion_tokens":3}})).as_bytes(),
                1,
            );
            o.push(
                frame(json!({"usage":{"prompt_tokens":5,"completion_tokens":3}})).as_bytes(),
                2,
            );
            assert!(o.invalid_usage);
            assert_eq!(o.completion, Some(3));
        }
        let mut o = ChatObservation::new(Some(1));
        o.push(
            frame(json!({"usage":{"prompt_tokens":5,"completion_tokens":null}})).as_bytes(),
            1,
        );
        assert_eq!((o.prompt, o.completion), (Some(5), None));
        assert!(!o.invalid_usage);
        o.push(frame(json!({"usage":{"prompt_tokens":4}})).as_bytes(), 2);
        assert!(o.invalid_usage);
        assert_eq!(o.prompt, Some(5));
    }

    #[test]
    fn ss2_ss3_multiple_choices_and_meaningful_first_output() {
        for malformed in [
            json!(42),
            json!({"choices":"wrong-shape"}),
            json!({"choices":[1]}),
        ] {
            let mut o = ChatObservation::new(Some(1));
            o.push(frame(malformed).as_bytes(), 1);
            o.push(finish("stop").as_bytes(), 2);
            assert_eq!(o.outcome, Some("unknown"), "known malformed event shape");
            assert!(o.invalid);
        }
        let mut o = ChatObservation::new(Some(2));
        o.push(frame(json!({"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":"stop"}]})).as_bytes(),2);
        assert_eq!(o.outcome, None);
        assert_eq!(o.first_output_ms, None);
        o.push(frame(json!({"choices":[{"index":1,"delta":{"tool_calls":[{"id":"synthetic-id","function":{"arguments":"{"}}]},"finish_reason":"length"}]})).as_bytes(),4);
        assert_eq!(o.outcome, Some("incomplete"));
        assert_eq!(o.first_output_ms, Some(4));
        let mut o = ChatObservation::new(Some(1));
        o.push(b"data: not-json\n\n", 1);
        o.push(finish("stop").as_bytes(), 2);
        assert_eq!(o.outcome, Some("unknown"));
        assert!(o.invalid);
    }

    #[test]
    fn ss2_observer_retention_is_bounded_and_eof_accepts_content_finish() {
        let mut o = ChatObservation::new(Some(1));
        let data = vec![b'x'; EVENT_LIMIT + 1];
        o.push(&data, 1);
        assert!(o.disabled);
        assert!(o.line.is_empty());
        assert!(o.data.is_empty());
        assert_eq!(o.error, Some("stream_observer_limit"));
        let mut o = ChatObservation::new(Some(1));
        let last = finish("stop");
        o.push(last.trim_end().as_bytes(), 1);
        o.end(2);
        assert_eq!(o.outcome, Some("succeeded"));
        assert!(!o.transport_done);
    }
}

#[cfg(test)]
mod responses_usage_tests {
    use super::*;
    use serde_json::json;

    fn frame(kind: &str, response: Value) -> String {
        format!(
            "event: {kind}\ndata: {}\n\n",
            json!({"type":kind,"response":response})
        )
    }

    #[test]
    fn nh2_raw_responses_terminal_usage_and_first_terminal_win() {
        for (status, outcome) in [
            ("completed", "succeeded"),
            ("incomplete", "incomplete"),
            ("failed", "failed"),
        ] {
            let mut o = ChatObservation::responses();
            o.push(b"event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"synthetic\"}\n\n", 2);
            o.push(
                frame(
                    &format!("response.{status}"),
                    json!({"status":status,"usage":{"input_tokens":0,"output_tokens":7}}),
                )
                .as_bytes(),
                5,
            );
            o.push(
                frame(
                    "response.completed",
                    json!({"status":"completed","usage":{"input_tokens":999,"output_tokens":999}}),
                )
                .as_bytes(),
                9,
            );
            assert_eq!(o.outcome, Some(outcome));
            assert_eq!((o.prompt, o.completion), (Some(0), Some(7)));
            assert_eq!(o.first_output_ms, Some(2));
            assert_eq!(o.terminal_ms, Some(5));
            assert!(o.transport_done);
        }
    }

    #[test]
    fn nh2_raw_responses_missing_invalid_decreasing_are_not_zero() {
        for usage in [
            Value::Null,
            json!({}),
            json!({"input_tokens":null}),
            json!({"output_tokens":7}),
        ] {
            let mut o = ChatObservation::responses();
            o.push(
                frame(
                    "response.completed",
                    json!({"status":"completed","usage":usage}),
                )
                .as_bytes(),
                1,
            );
            assert_eq!(o.prompt, None);
            assert_eq!(o.completion, usage["output_tokens"].as_i64());
            assert!(!o.invalid_usage);
            assert_eq!(o.outcome, Some("succeeded"));
        }
        for bad in [json!(-1), json!(1.5), json!("3"), json!(u64::MAX)] {
            let mut o = ChatObservation::responses();
            o.push(
                frame(
                    "response.in_progress",
                    json!({"status":"in_progress","usage":{"input_tokens":bad,"output_tokens":7}}),
                )
                .as_bytes(),
                1,
            );
            o.push(
                frame(
                    "response.completed",
                    json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
                )
                .as_bytes(),
                2,
            );
            assert!(o.invalid_usage);
            assert_eq!(o.outcome, Some("succeeded"));
        }
        let mut o = ChatObservation::responses();
        o.push(
            frame(
                "response.in_progress",
                json!({"status":"in_progress","usage":{"input_tokens":11}}),
            )
            .as_bytes(),
            1,
        );
        o.push(
            frame(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":10,"output_tokens":7}}),
            )
            .as_bytes(),
            2,
        );
        assert!(o.invalid_usage);
        assert_eq!(o.prompt, Some(11));
    }

    #[test]
    fn nh2_responses_native_frames_fragmentation_bom_and_cr_lookahead() {
        let wire = format!(
            "\u{feff}: ping\n\nevent: future.event\ndata: {{\"type\":\"future.event\"}}\n\n{}",
            frame(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}})
            )
        );
        for newline in ["\n", "\r\n", "\r"] {
            let raw = wire.replace('\n', newline);
            for size in [1, 2, 17, 8192] {
                let mut o = ChatObservation::responses();
                for part in raw.as_bytes().chunks(size) {
                    o.push(part, 3);
                }
                if newline == "\r" {
                    assert_eq!(o.outcome, None);
                }
                o.end(4);
                assert_eq!(o.outcome, Some("succeeded"));
                assert_eq!((o.prompt, o.completion), (Some(11), Some(7)));
                assert!(!o.invalid);
            }
        }
    }

    #[test]
    fn nh2_responses_terminal_validation_and_tools() {
        for raw in [
            "event: response.failed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n".to_owned(),
            frame("response.completed",json!({"status":"in_progress"})),
            frame("response.completed",json!({"status":"completed","error":{"message":"synthetic"}})),
            frame("response.completed",json!([])),
            "event: response.completed\ndata: nope\n\n".to_owned(),
            "data: [DONE]\n\n".to_owned(),
        ] {
            let mut o=ChatObservation::responses();o.push(raw.as_bytes(),1);
            assert_ne!(o.outcome,Some("succeeded"),"{raw}");assert!(o.invalid);
        }
        let mut o = ChatObservation::responses();
        o.push(
            b"data: {\"type\":\"response.created\",\"response\":{\"status\":\"in_progress\"}}\n\n",
            1,
        );
        assert_eq!(o.first_output_ms, None);
        o.push(b"data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"reasoning\",\"name\":\"ignored\"}}\n\n",2);
        assert_eq!(o.first_output_ms, None);
        o.push(b"data: {\"type\":\"response.output_item.added\",\"item\":{\"type\":\"function_call\",\"name\":\"tool\"}}\n\n",3);
        assert_eq!(o.first_output_ms, Some(3));
        o.push(
            b"event: error\ndata: {\"type\":\"error\",\"message\":\"synthetic\"}\n\n",
            4,
        );
        assert_eq!(o.outcome, Some("failed"));
    }

    #[test]
    fn nh2_responses_observer_limit_is_bounded() {
        let mut o = ChatObservation::responses();
        o.push(&vec![b'x'; EVENT_LIMIT + 1], 1);
        assert!(o.disabled);
        assert!(o.line.is_empty());
        assert!(o.data.is_empty());
        assert_eq!(o.error, Some("stream_observer_limit"));
    }
    fn attempt(store: &Store, format: HttpUsageFormat, allow_estimate: bool) -> StreamAttempt {
        let connection = serde_json::from_value(json!({
            "id":"synthetic","name":"synthetic","base_url":"http://127.0.0.1:1/v1",
            "api_key":"synthetic","default_model":null,"priority":0,"enabled":true,
            "input_price_per_m":1.0,"output_price_per_m":2.0,"auth_type":"api_key","oauth":null,
            "created_at":"synthetic","updated_at":"synthetic"
        }))
        .unwrap();
        StreamAttempt::begin_http(
            store,
            "generated-request",
            "public",
            &crate::store::ResolvedTarget {
                connection,
                upstream_model: "synthetic".into(),
            },
            b"{}",
            format,
            allow_estimate,
        )
        .unwrap()
    }

    #[test]
    fn nh2_nh4_native_feedback_persists_source_null_cost_and_only_once() {
        for format in [HttpUsageFormat::Chat, HttpUsageFormat::Responses] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
            let mut a = attempt(&store, format, false);
            a.headers(200);
            let raw=match format {
                HttpUsageFormat::Chat=>"data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":0,\"completion_tokens\":7}}\n\ndata: [DONE]\n\n".to_owned(),
                HttpUsageFormat::Responses=>frame("response.completed",json!({"status":"completed","usage":{"input_tokens":0,"output_tokens":7}})),
            };
            a.observe_native(raw.as_bytes());
            assert!(
                store.recent_usage(1).unwrap()[0].finalized_at.is_none(),
                "consumer disposition still owns finalization"
            );
            a.converted_terminal(false);
            let rows = store.recent_usage(1).unwrap();
            let row = &rows[0];
            assert_eq!(
                row.usage_source,
                if format == HttpUsageFormat::Chat {
                    "openai_chat_v1"
                } else {
                    "openai_responses_v1"
                }
            );
            assert_eq!(
                (row.prompt_tokens, row.completion_tokens),
                (Some(0), Some(7))
            );
            assert_eq!(row.outcome, "succeeded");
            assert_eq!(row.usage_status, "complete");
            assert!(row.estimated_cost_usd.is_none());
            let before = serde_json::to_value(&rows).unwrap();
            a.stop("cancelled", "stream_cancelled");
            a.converted_terminal(true);
            drop(a);
            assert_eq!(
                serde_json::to_value(store.recent_usage(1).unwrap()).unwrap(),
                before
            );
            assert_eq!(store.recover_stream_attempts().unwrap(), 0);
        }
    }

    #[test]
    fn nh3_responses_conversion_failure_cannot_be_saved_by_later_terminal() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let mut a = attempt(&store, HttpUsageFormat::Responses, false);
        a.observe_converted(
            b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"synthetic\"}\n",
        );
        a.converted_terminal(true);
        a.observe_native(
            frame(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
            )
            .as_bytes(),
        );
        let row = store.recent_usage(1).unwrap().pop().unwrap();
        assert_eq!(row.outcome, "failed");
        assert_eq!(row.error.as_deref(), Some("stream_conversion_failed"));
        assert!(row.prompt_tokens.is_none() && row.completion_tokens.is_none());
        assert!(row.first_output_ms.is_some());
    }

    #[test]
    fn nh4_responses_finalize_failure_keeps_pending_for_one_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("synthetic.db");
        let store = Store::open(&db, None).unwrap();
        let mut a = attempt(&store, HttpUsageFormat::Responses, false);
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TRIGGER deny_finalization BEFORE UPDATE OF finalized_at ON usage_events BEGIN SELECT RAISE(FAIL,'synthetic failure'); END;").unwrap();
        a.observe_native(
            frame(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
            )
            .as_bytes(),
        );
        a.converted_terminal(false);
        assert!(store.recent_usage(1).unwrap()[0].finalized_at.is_none());
        conn.execute_batch("DROP TRIGGER deny_finalization")
            .unwrap();
        drop(a);
        assert!(
            store.recent_usage(1).unwrap()[0].finalized_at.is_none(),
            "drop must not retry failed persistence"
        );
        let reopened = Store::open(&db, None).unwrap();
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 1);
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 0);
        let row = reopened.recent_usage(1).unwrap().pop().unwrap();
        assert_eq!(row.outcome, "interrupted");
        assert!(row.prompt_tokens.is_none() && row.completion_tokens.is_none());
    }
    #[test]
    fn nh3_native_unknown_invalid_sequence_feedback_ignores_following_success() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let mut a = attempt(&store, HttpUsageFormat::Responses, false);
        a.observe_native(
            b"event: future.event\ndata: {\"type\":\"future.event\",\"sequence_number\":-1}\n\n",
        );
        a.converted_terminal(true);
        a.observe_native(
            frame(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
            )
            .as_bytes(),
        );
        let row = store.recent_usage(1).unwrap().pop().unwrap();
        assert_eq!(row.outcome, "failed");
        assert_eq!(row.usage_status, "invalid");
        assert_eq!(row.error.as_deref(), Some("stream_conversion_failed"));
        assert!(row.prompt_tokens.is_none() && row.completion_tokens.is_none());
    }

    #[test]
    fn nh2_native_empty_event_field_resets_prior_name() {
        let mut o = ChatObservation::responses();
        o.push(b"event: response.failed\nevent\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n",1);
        assert_eq!(o.outcome, Some("succeeded"));
        assert!(!o.invalid);
    }
    #[test]
    fn nh3_converted_responses_wait_for_actual_lf_consumption() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let mut a = attempt(&store, HttpUsageFormat::Responses, false);
        a.observe_converted(b"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":11,\"output_tokens\":7}}}\r\r");
        assert_eq!(
            a.observation.outcome, None,
            "LF converter has not accepted this raw data line"
        );
        a.observe_converted(b"\n");
        assert_eq!(a.observation.outcome, Some("succeeded"));
        a.converted_terminal(false);
        assert_eq!(store.recent_usage(1).unwrap()[0].outcome, "succeeded");
    }
    #[test]
    fn nh3_converted_responses_ignore_bom_prefixed_data_like_converter() {
        for ignored in [
            json!({"type":"response.completed","response":{"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}}),
            json!({"type":"response.output_text.delta","delta":"synthetic-ignored"}),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
            let mut a = attempt(&store, HttpUsageFormat::Responses, false);
            a.observe_converted(format!("\u{feff}data: {ignored}\n").as_bytes());
            assert_eq!(
                a.observation.outcome, None,
                "converter ignores BOM-prefixed data"
            );
            assert_eq!(
                a.observation.first_output_ms, None,
                "ignored BOM data is not caller output"
            );
            a.observe_converted(b"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":99,\"output_tokens\":88}}}\n");
            a.converted_terminal(false);
            let row = store.recent_usage(1).unwrap().pop().unwrap();
            assert_eq!(row.outcome, "succeeded");
            assert_eq!(
                (row.prompt_tokens, row.completion_tokens),
                (Some(99), Some(88))
            );
            assert_eq!(row.first_output_ms, None);
        }
    }
}

//! Bounded, read-only observation of generic Chat upstream SSE for accounting.
//! It never changes bytes, drives the upstream, or retains event contents in SQLite.
use std::time::Instant;

use serde_json::Value;

use crate::store::{Store, StreamFinalization};

const EVENT_LIMIT: usize = 64 * 1024;
const CHOICE_LIMIT: usize = 128;

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
        let id = store
            .begin_stream_attempt(
                request_id,
                model,
                &target.connection.id,
                &target.upstream_model,
            )
            .map_err(|_| crate::error::AppError::Upstream {
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
            input_price: target.connection.input_price_per_m,
            output_price: target.connection.output_price_per_m,
            observation: ChatObservation::new(choices),
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

struct ChatObservation {
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
        for &b in bytes {
            if self.cr {
                self.cr = false;
                if b == b'\n' {
                    continue;
                }
            }
            if b == b'\r' || b == b'\n' {
                self.line_end(elapsed);
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

    fn line_end(&mut self, elapsed: i64) {
        if self.line.is_empty() {
            if self.has_data {
                self.event(elapsed);
            }
            self.data.clear();
            self.has_data = false;
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
        }
        self.line.clear();
    }

    fn end(&mut self, elapsed: i64) {
        if self.transport_done || self.disabled {
            return;
        }
        // Match the gateway's existing acceptance of a final unterminated data line.
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

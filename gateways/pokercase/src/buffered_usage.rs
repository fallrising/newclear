//! Original buffered HTTP observations, independent of client conversion.

use serde_json::Value;

use super::{HttpUsageFormat, CHOICE_LIMIT};

pub(super) struct BufferedObservation {
    format: HttpUsageFormat,
    forced_sse: bool,
    choices: Option<usize>,
    line: Vec<u8>,
    line_arrival_ms: Option<i64>,
    received: usize,
    chunks_observed: bool,
    body_observed: bool,
    disabled: bool,
    terminal: bool,
    pub(super) prompt: Option<i64>,
    pub(super) completion: Option<i64>,
    invalid_usage: bool,
    pub(super) first_output_ms: Option<i64>,
    pub(super) terminal_ms: Option<i64>,
    pub(super) outcome: Option<&'static str>,
    pub(super) error: Option<&'static str>,
}

impl BufferedObservation {
    pub(super) fn new(format: HttpUsageFormat, choices: Option<usize>, forced_sse: bool) -> Self {
        Self {
            format,
            forced_sse: forced_sse && format == HttpUsageFormat::Responses,
            choices,
            line: Vec::new(),
            line_arrival_ms: None,
            received: 0,
            chunks_observed: false,
            body_observed: false,
            disabled: false,
            terminal: false,
            prompt: None,
            completion: None,
            invalid_usage: false,
            first_output_ms: None,
            terminal_ms: None,
            outcome: None,
            error: None,
        }
    }

    pub(super) fn usage_status(&self) -> &'static str {
        if self.invalid_usage {
            "invalid"
        } else if self.prompt.is_some() && self.completion.is_some() && self.terminal {
            "complete"
        } else if self.prompt.is_some() || self.completion.is_some() {
            "partial"
        } else {
            "missing"
        }
    }

    /// A coherent original usage object replaces both sides. In particular a
    /// missing terminal side cannot borrow a counter from an earlier lifecycle.
    fn replace_usage(&mut self, usage: Option<&Value>) {
        self.prompt = None;
        self.completion = None;
        self.invalid_usage = false;
        let Some(usage) = usage.filter(|value| !value.is_null()) else {
            return;
        };
        if !usage.is_object() {
            self.invalid_usage = true;
            return;
        }
        let (input, output) = match self.format {
            HttpUsageFormat::Chat => ("prompt_tokens", "completion_tokens"),
            HttpUsageFormat::Responses => ("input_tokens", "output_tokens"),
        };
        for (name, target) in [(input, &mut self.prompt), (output, &mut self.completion)] {
            match usage.get(name) {
                None | Some(Value::Null) => {}
                Some(value) => match value.as_i64().filter(|count| *count >= 0) {
                    Some(count) => *target = Some(count),
                    None => self.invalid_usage = true,
                },
            }
        }
    }

    pub(super) fn chunk(&mut self, bytes: &[u8], elapsed: i64) {
        if !self.forced_sse || self.body_observed {
            return;
        }
        self.chunks_observed = true;
        self.feed(bytes, Some(elapsed));
    }

    pub(super) fn body(&mut self, bytes: &[u8], elapsed: i64) {
        if self.body_observed {
            return;
        }
        self.body_observed = true;
        if self.forced_sse {
            if !self.chunks_observed {
                // Parsing after collection must never manufacture a first delta
                // clock. Root normally observes each real received chunk.
                self.feed(bytes, None);
            }
            if !self.line.is_empty() && !self.terminal && !self.disabled {
                self.finish_line(self.line_arrival_ms);
            }
            return;
        }
        self.terminal = true;
        self.terminal_ms = Some(elapsed);
        let Ok(value) = serde_json::from_slice::<Value>(bytes) else {
            self.invalid_usage = true;
            return;
        };
        if !value.is_object() {
            self.invalid_usage = true;
            return;
        }
        self.replace_usage(value.get("usage"));
        if value.get("error").is_some_and(|error| !error.is_null()) {
            self.outcome = Some("failed");
            self.error = Some("stream_error");
            return;
        }
        self.outcome = match self.format {
            HttpUsageFormat::Chat => chat_outcome(&value, self.choices),
            HttpUsageFormat::Responses => match value.get("status").and_then(Value::as_str) {
                Some("completed") => Some("succeeded"),
                Some("incomplete") => Some("incomplete"),
                Some("failed") => {
                    self.error = Some("stream_error");
                    Some("failed")
                }
                Some("cancelled") => Some("cancelled"),
                _ => None,
            },
        };
    }

    fn feed(&mut self, bytes: &[u8], elapsed: Option<i64>) {
        if self.terminal || self.disabled {
            return;
        }
        if bytes.len() > crate::collection::MAX_BYTES - self.received {
            self.disabled = true;
            self.error = Some("stream_observer_limit");
            self.line = Vec::new();
            return;
        }
        self.received += bytes.len();
        // reassemble_sse uses str::lines, not native SSE frame parsing: LF ends
        // a line, a preceding CR is removed, and bare CR does not delimit it.
        for part in bytes.split_inclusive(|byte| *byte == b'\n') {
            if self.terminal {
                break;
            }
            self.line_arrival_ms = elapsed;
            if part.last() == Some(&b'\n') {
                self.append_line(&part[..part.len() - 1]);
                self.finish_line(elapsed);
            } else {
                self.append_line(part);
            }
        }
    }

    fn append_line(&mut self, bytes: &[u8]) {
        let required = self.line.len() + bytes.len();
        if required > self.line.capacity() {
            let capacity = required
                .max(self.line.capacity().saturating_mul(2))
                .min(crate::collection::MAX_BYTES);
            self.line.reserve_exact(capacity - self.line.len());
        }
        self.line.extend_from_slice(bytes);
    }

    fn finish_line(&mut self, elapsed: Option<i64>) {
        let event = {
            // The existing collector decodes the complete body lossily. Keeping
            // bytes through fragment boundaries gives identical line decoding.
            let raw = String::from_utf8_lossy(&self.line);
            let line = raw.strip_suffix('\r').unwrap_or(&raw);
            line.strip_prefix("data:")
                .and_then(|data| serde_json::from_str::<Value>(data.trim()).ok())
        };
        self.line.clear();
        self.line_arrival_ms = None;
        let Some(event) = event else { return };
        let kind = event.get("type").and_then(Value::as_str).unwrap_or("");
        match kind {
            "response.created" | "response.in_progress" => {
                self.replace_usage(event.get("response").and_then(|value| value.get("usage")));
            }
            "response.completed" | "response.incomplete" | "response.failed" | "error" => {
                // The collector stops at this first recognized terminal even
                // when its status conflicts or the failure payload is sparse.
                self.terminal = true;
                self.terminal_ms = elapsed;
                self.replace_usage(event.get("response").and_then(|value| value.get("usage")));
                let accepted = event.get("response").is_some_and(|response| {
                    response.is_object()
                        && response.get("status").and_then(Value::as_str)
                            == kind.strip_prefix("response.")
                        && response.get("error").is_none_or(Value::is_null)
                });
                self.outcome = Some(match kind {
                    "response.completed" if accepted => "succeeded",
                    "response.incomplete" if accepted => "incomplete",
                    _ => "failed",
                });
                if self.outcome == Some("failed") {
                    self.error = Some("stream_error");
                }
            }
            _ => {}
        }
        let nonempty = |value: &Value| value.as_str().is_some_and(|text| !text.is_empty());
        let meaningful = match kind {
            "response.output_text.delta" | "response.function_call_arguments.delta" => {
                nonempty(&event["delta"])
            }
            "response.output_item.added" | "response.output_item.done" => {
                let item = &event["item"];
                item["type"] == "function_call"
                    && (nonempty(&item["name"]) || nonempty(&item["arguments"]))
            }
            _ => false,
        };
        if meaningful {
            if let Some(elapsed) = elapsed {
                self.first_output_ms.get_or_insert(elapsed);
            }
        }
    }
}

fn chat_outcome(value: &Value, requested: Option<usize>) -> Option<&'static str> {
    let expected = requested.filter(|count| (1..=CHOICE_LIMIT).contains(count))?;
    let choices = value.get("choices")?.as_array()?;
    if choices.len() != expected {
        return None;
    }
    let mut seen = vec![false; expected];
    let mut incomplete = false;
    for choice in choices {
        let index = match choice.get("index") {
            None if expected == 1 => 0,
            Some(value) => usize::try_from(value.as_u64()?).ok()?,
            None => return None,
        };
        if index >= expected || seen[index] {
            return None;
        }
        seen[index] = true;
        match choice.get("finish_reason")?.as_str()? {
            "stop" | "tool_calls" | "function_call" => {}
            "length" | "content_filter" => incomplete = true,
            _ => return None,
        }
    }
    Some(if incomplete {
        "incomplete"
    } else {
        "succeeded"
    })
}

#[cfg(test)]
mod tests {
    use crate::store::{Store, UsageEvent};
    use crate::stream_usage::{HttpUsageFormat, StreamAttempt};
    use serde_json::{json, Value};
    use std::time::{Duration, Instant};

    fn target() -> crate::store::ResolvedTarget {
        crate::store::ResolvedTarget {
            connection: serde_json::from_value(json!({
                "id":"synthetic","name":"synthetic","base_url":"http://127.0.0.1:1/v1",
                "api_key":"synthetic","default_model":null,"priority":0,"enabled":true,
                "input_price_per_m":1.0,"output_price_per_m":2.0,"auth_type":"api_key","oauth":null,
                "created_at":"synthetic","updated_at":"synthetic"
            }))
            .unwrap(),
            upstream_model: "synthetic".into(),
        }
    }

    fn begin(
        format: HttpUsageFormat,
        forced: bool,
        request: Value,
    ) -> (tempfile::TempDir, Store, StreamAttempt) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
        let attempt = StreamAttempt::begin_buffered_http(
            &store,
            "synthetic-request",
            "public",
            &target(),
            &serde_json::to_vec(&request).unwrap(),
            format,
            forced,
        )
        .unwrap();
        (dir, store, attempt)
    }

    fn row(store: &Store) -> UsageEvent {
        let mut rows = store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 1);
        rows.remove(0)
    }

    fn body(format: HttpUsageFormat, usage: Value, terminal: &str) -> Vec<u8> {
        serde_json::to_vec(&match format {
            HttpUsageFormat::Chat => {
                json!({"choices":[{"index":0,"finish_reason":terminal}],"usage":usage})
            }
            HttpUsageFormat::Responses => json!({"status":terminal,"output":[],"usage":usage}),
        })
        .unwrap()
    }

    fn event(kind: &str, response: Value) -> String {
        format!("data: {}\n", json!({"type":kind,"response":response}))
    }

    #[test]
    fn bh2_buffered_json_independent_usage_zero_invalid_and_cost() {
        for format in [HttpUsageFormat::Chat, HttpUsageFormat::Responses] {
            for (input, output, quality, prompt, completion, cost) in [
                (
                    json!(11),
                    json!(7),
                    "complete",
                    Some(11),
                    Some(7),
                    Some(0.000025),
                ),
                (json!(0), json!(0), "complete", Some(0), Some(0), Some(0.0)),
                (Value::Null, Value::Null, "missing", None, None, None),
                (json!(11), Value::Null, "partial", Some(11), None, None),
                (json!(-1), json!(7), "invalid", None, Some(7), None),
                (json!(1.5), json!(7), "invalid", None, Some(7), None),
                (json!("11"), json!(7), "invalid", None, Some(7), None),
                (json!(u64::MAX), json!(7), "invalid", None, Some(7), None),
            ] {
                let (input_key, output_key, terminal, source) = match format {
                    HttpUsageFormat::Chat => (
                        "prompt_tokens",
                        "completion_tokens",
                        "stop",
                        "openai_chat_v1",
                    ),
                    HttpUsageFormat::Responses => (
                        "input_tokens",
                        "output_tokens",
                        "completed",
                        "openai_responses_v1",
                    ),
                };
                let (_dir, store, mut a) = begin(format, false, json!({}));
                a.headers(200);
                a.observe_buffered_body(&body(
                    format,
                    json!({input_key:input,output_key:output}),
                    terminal,
                ));
                assert!(row(&store).finalized_at.is_none());
                a.complete_buffered();
                let got = row(&store);
                assert_eq!(
                    (got.prompt_tokens, got.completion_tokens),
                    (prompt, completion)
                );
                assert_eq!(got.usage_status, quality);
                assert_eq!(got.outcome, "succeeded");
                assert_eq!(got.estimated_cost_usd, cost);
                assert_eq!(got.usage_source, source);
                assert!(got.first_output_ms.is_none() && got.cli_ready_ms.is_none());
                assert!(got.total_observed_ms.unwrap() >= got.headers_ms.unwrap());
            }
        }
        for usage in [json!([]), json!(7), json!("bad")] {
            let (_dir, store, mut a) = begin(HttpUsageFormat::Chat, false, json!({}));
            a.observe_buffered_body(&body(HttpUsageFormat::Chat, usage, "stop"));
            a.complete_buffered();
            assert_eq!(row(&store).usage_status, "invalid");
        }
    }

    #[test]
    fn bh2_buffered_invalid_usage_does_not_mark_success_as_error() {
        for (format, forced_sse) in [
            (HttpUsageFormat::Chat, false),
            (HttpUsageFormat::Responses, false),
            (HttpUsageFormat::Responses, true),
        ] {
            for (input, output, prompt, completion) in [
                (json!("invalid"), json!(7), None, Some(7)),
                (json!(11), json!("invalid"), Some(11), None),
            ] {
                let (_dir, store, mut attempt) = begin(format, forced_sse, json!({}));
                attempt.headers(200);
                let original = if format == HttpUsageFormat::Chat {
                    body(
                        format,
                        json!({"prompt_tokens":input,"completion_tokens":output}),
                        "stop",
                    )
                } else if forced_sse {
                    event("response.completed", json!({
                        "status":"completed","usage":{"input_tokens":input,"output_tokens":output}
                    })).into_bytes()
                } else {
                    body(
                        format,
                        json!({"input_tokens":input,"output_tokens":output}),
                        "completed",
                    )
                };
                if forced_sse {
                    attempt.observe_buffered_chunk(&original);
                }
                attempt.observe_buffered_body(&original);
                attempt.complete_buffered();
                let got = row(&store);
                assert_eq!((got.status, got.error), (Some(200), None));
                assert_eq!(got.outcome, "succeeded");
                assert_eq!(got.usage_status, "invalid");
                assert_eq!(
                    (got.prompt_tokens, got.completion_tokens),
                    (prompt, completion)
                );
                assert!(got.estimated_cost_usd.is_none());
            }
        }
        for stopped in [false, true] {
            let (_dir, store, mut attempt) = begin(HttpUsageFormat::Responses, false, json!({}));
            attempt.headers(200);
            attempt.observe_buffered_body(&body(
                HttpUsageFormat::Responses,
                json!({"input_tokens":11,"output_tokens":"invalid"}),
                "failed",
            ));
            if stopped {
                attempt.stop("failed", "stream_conversion_failed");
            } else {
                attempt.complete_buffered();
            }
            let got = row(&store);
            assert_eq!(got.outcome, "failed");
            assert_eq!(got.usage_status, "invalid");
            assert_eq!(
                got.error.as_deref(),
                Some(if stopped {
                    "stream_conversion_failed"
                } else {
                    "stream_error"
                })
            );
            assert_eq!((got.prompt_tokens, got.completion_tokens), (Some(11), None));
            assert!(got.estimated_cost_usd.is_none());
        }
    }

    #[test]
    fn bh2_buffered_chat_choices_are_explicit_and_independent_of_usage() {
        for (n, choices, outcome) in [
            (1, json!([{"finish_reason":"stop"}]), "succeeded"),
            (
                2,
                json!([{"index":1,"finish_reason":"tool_calls"},{"index":0,"finish_reason":"stop"}]),
                "succeeded",
            ),
            (
                2,
                json!([{"index":0,"finish_reason":"length"},{"index":1,"finish_reason":"stop"}]),
                "incomplete",
            ),
            (2, json!([{"index":0,"finish_reason":"stop"}]), "unknown"),
            (
                2,
                json!([{"index":0,"finish_reason":"stop"},{"index":0,"finish_reason":"stop"}]),
                "unknown",
            ),
            (
                2,
                json!([{"finish_reason":"stop"},{"index":1,"finish_reason":"stop"}]),
                "unknown",
            ),
            (1, json!([{"index":0,"finish_reason":"future"}]), "unknown"),
            (1, json!([{"index":0}]), "unknown"),
            (0, json!([]), "unknown"),
            (129, json!([]), "unknown"),
        ] {
            let (_dir, store, mut a) = begin(HttpUsageFormat::Chat, false, json!({"n":n}));
            a.observe_buffered_body(
                &serde_json::to_vec(
                    &json!({"choices":choices,"usage":{"prompt_tokens":3,"completion_tokens":2}}),
                )
                .unwrap(),
            );
            a.complete_buffered();
            assert_eq!(row(&store).outcome, outcome);
            assert_eq!(row(&store).usage_status, "complete");
        }
    }

    #[test]
    fn bh2_buffered_responses_outcome_pending_and_invalid_json() {
        for (status, outcome) in [
            ("completed", "succeeded"),
            ("incomplete", "incomplete"),
            ("failed", "failed"),
            ("queued", "unknown"),
            ("in_progress", "unknown"),
            ("future", "unknown"),
        ] {
            let (_dir, store, mut a) = begin(
                HttpUsageFormat::Responses,
                false,
                json!({"background":true}),
            );
            a.observe_buffered_body(&body(
                HttpUsageFormat::Responses,
                json!({"input_tokens":0}),
                status,
            ));
            a.complete_buffered();
            assert_eq!(row(&store).outcome, outcome);
            assert_eq!(
                (row(&store).prompt_tokens, row(&store).completion_tokens),
                (Some(0), None)
            );
            assert!(row(&store).first_output_ms.is_none());
        }
        let (_dir, store, mut a) = begin(HttpUsageFormat::Chat, false, json!({}));
        a.observe_buffered_body(b"not json");
        a.complete_buffered();
        assert_eq!(row(&store).outcome, "unknown");
        assert_eq!(row(&store).usage_status, "invalid");
    }

    #[test]
    fn bh2_buffered_terminal_replaces_lifecycle_snapshot_without_borrowing() {
        for usage in [
            json!({"input_tokens":11}),
            json!(null),
            json!({"input_tokens":0,"output_tokens":0}),
        ] {
            let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
            let lifecycle = event(
                "response.in_progress",
                json!({"usage":{"input_tokens":5,"output_tokens":9}}),
            );
            let terminal = event(
                "response.completed",
                json!({"status":"completed","usage":usage}),
            );
            a.observe_buffered_chunk(lifecycle.as_bytes());
            a.observe_buffered_chunk(terminal.as_bytes());
            a.observe_buffered_body(format!("{lifecycle}{terminal}").as_bytes());
            a.complete_buffered();
            let got = row(&store);
            assert_eq!(got.prompt_tokens, usage["input_tokens"].as_i64());
            assert_eq!(got.completion_tokens, usage["output_tokens"].as_i64());
            assert_eq!(
                got.usage_status,
                if usage.is_null() {
                    "missing"
                } else if usage.get("output_tokens").is_some() {
                    "complete"
                } else {
                    "partial"
                }
            );
            if got.usage_status != "complete" {
                assert!(got.estimated_cost_usd.is_none());
            }
        }
        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_chunk(
            event(
                "response.created",
                json!({"usage":{"input_tokens":5,"output_tokens":9}}),
            )
            .as_bytes(),
        );
        a.stop("timeout", "stream_timeout");
        let got = row(&store);
        assert_eq!(
            (got.prompt_tokens, got.completion_tokens),
            (Some(5), Some(9))
        );
        assert_eq!(got.usage_status, "partial");
        assert!(got.estimated_cost_usd.is_none());
    }

    #[test]
    fn bh4_buffered_sse_first_terminal_and_collector_acceptance_match() {
        let success = event(
            "response.completed",
            json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
        );
        let failed = event(
            "response.failed",
            json!({"status":"unusual","usage":{"input_tokens":4,"output_tokens":2}}),
        );
        let conflict = event(
            "response.completed",
            json!({"status":"in_progress","usage":{"input_tokens":6,"output_tokens":3}}),
        );
        for (prefix, outcome, prompt, accepted) in [
            (&success, "succeeded", 11, true),
            (&failed, "failed", 4, false),
            (&conflict, "failed", 6, false),
        ] {
            let transcript = format!("{prefix}{success}{failed}");
            assert_eq!(
                crate::responses::reassemble_sse(&transcript).is_ok(),
                accepted
            );
            let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
            a.observe_buffered_chunk(transcript.as_bytes());
            a.observe_buffered_body(transcript.as_bytes());
            a.complete_buffered();
            assert_eq!(row(&store).outcome, outcome);
            assert_eq!(row(&store).prompt_tokens, Some(prompt));
        }
    }

    #[test]
    fn bh2_bh4_buffered_fragment_crlf_eof_and_real_arrival_clocks() {
        let delta = "data: {\"type\":\"response.output_text.delta\",\"delta\":\"字\"}\r\n";
        let terminal = event(
            "response.completed",
            json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
        );
        let transcript = format!("{delta}{}", terminal.trim_end());
        for width in [1, 2, 7, 4096] {
            let outer = Instant::now();
            let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
            a.headers(200);
            for chunk in delta.as_bytes().chunks(width) {
                a.observe_buffered_chunk(chunk);
            }
            std::thread::sleep(Duration::from_millis(3));
            for chunk in terminal.trim_end().as_bytes().chunks(width) {
                a.observe_buffered_chunk(chunk);
            }
            let arrival_upper = outer.elapsed().as_millis() as i64;
            std::thread::sleep(Duration::from_millis(5));
            a.observe_buffered_body(transcript.as_bytes());
            a.complete_buffered();
            let got = row(&store);
            assert_eq!(got.outcome, "succeeded");
            assert!(got.first_output_ms.unwrap() < got.total_observed_ms.unwrap());
            assert!(got.total_observed_ms.unwrap() <= arrival_upper);
        }
        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_body(transcript.as_bytes());
        a.complete_buffered();
        assert!(row(&store).first_output_ms.is_none());
        assert_eq!(row(&store).outcome, "succeeded");
    }

    #[test]
    fn bh2_buffered_tools_empty_delta_and_lossy_data_lines() {
        let prefix=b"\xef\xbb\xbfdata: {\"type\":\"response.failed\"}\n:ping\ndata: nope\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"\"}\n";
        let tool = b"data: {\"type\":\"response.function_call_arguments.delta\",\"delta\":\"{\"}\n";
        let terminal = event(
            "response.incomplete",
            json!({"status":"incomplete","usage":{"input_tokens":3,"output_tokens":2}}),
        );
        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_chunk(prefix);
        a.observe_buffered_chunk(tool);
        a.observe_buffered_chunk(terminal.as_bytes());
        a.observe_buffered_body(b"unused collected copy");
        a.complete_buffered();
        let got = row(&store);
        assert_eq!(got.outcome, "incomplete");
        assert!(got.first_output_ms.is_some());
        let raw=b"data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"opaque\":\"\xff\",\"usage\":{\"input_tokens\":3,\"output_tokens\":2}}}";
        assert!(crate::responses::reassemble_sse(&String::from_utf8_lossy(raw)).is_ok());
        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_chunk(raw);
        a.observe_buffered_body(raw);
        a.complete_buffered();
        assert_eq!(row(&store).outcome, "succeeded");
        assert_eq!(row(&store).prompt_tokens, Some(3));
    }

    #[test]
    fn bh3_buffered_stop_wins_terminal_and_finalizes_once() {
        for (outcome, error) in [
            ("failed", "stream_conversion_failed"),
            ("cancelled", "stream_cancelled"),
            ("timeout", "stream_timeout"),
        ] {
            let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
            a.headers(200);
            a.observe_buffered_chunk(
                event(
                    "response.completed",
                    json!({"status":"completed","usage":{"input_tokens":11,"output_tokens":7}}),
                )
                .as_bytes(),
            );
            std::thread::sleep(Duration::from_millis(3));
            a.stop(outcome, error);
            let got = row(&store);
            assert_eq!(got.outcome, outcome);
            assert_eq!(got.error.as_deref(), Some(error));
            assert_eq!(
                (got.prompt_tokens, got.completion_tokens),
                (Some(11), Some(7))
            );
            let before = serde_json::to_value(got).unwrap();
            a.complete_buffered();
            a.eof();
            drop(a);
            assert_eq!(serde_json::to_value(row(&store)).unwrap(), before);
        }
        let (_dir, store, a) = begin(HttpUsageFormat::Chat, false, json!({}));
        drop(a);
        assert_eq!(row(&store).outcome, "cancelled");
    }

    #[test]
    fn bh3_buffered_storage_fault_stays_pending_for_one_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("synthetic.db");
        let store = Store::open(&db, None).unwrap();
        let conn = rusqlite::Connection::open(&db).unwrap();
        conn.execute_batch("CREATE TRIGGER deny_insert BEFORE INSERT ON usage_events BEGIN SELECT RAISE(FAIL,'synthetic'); END;").unwrap();
        assert!(StreamAttempt::begin_buffered_http(
            &store,
            "request",
            "public",
            &target(),
            b"{}",
            HttpUsageFormat::Chat,
            false
        )
        .is_err());
        assert!(store.recent_usage(10).unwrap().is_empty());
        conn.execute_batch("DROP TRIGGER deny_insert").unwrap();
        let mut a = StreamAttempt::begin_buffered_http(
            &store,
            "request",
            "public",
            &target(),
            b"{}",
            HttpUsageFormat::Chat,
            false,
        )
        .unwrap();
        a.headers(200);
        a.observe_buffered_body(&body(
            HttpUsageFormat::Chat,
            json!({"prompt_tokens":11,"completion_tokens":7}),
            "stop",
        ));
        conn.execute_batch("CREATE TRIGGER deny_finalization BEFORE UPDATE OF finalized_at ON usage_events BEGIN SELECT RAISE(FAIL,'synthetic'); END;").unwrap();
        a.complete_buffered();
        assert!(row(&store).finalized_at.is_none());
        conn.execute_batch("DROP TRIGGER deny_finalization")
            .unwrap();
        a.complete_buffered();
        drop(a);
        assert!(row(&store).finalized_at.is_none());
        let reopened = Store::open(&db, None).unwrap();
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 1);
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 0);
        assert_eq!(row(&reopened).outcome, "interrupted");
        assert!(row(&reopened).prompt_tokens.is_none());
    }

    #[test]
    fn bh2_buffered_cost_requires_both_valid_rates_and_finite_result() {
        for (input_price, output_price) in [
            (None, Some(2.0)),
            (Some(1.0), None),
            (Some(-1.0), Some(2.0)),
            (Some(f64::INFINITY), Some(2.0)),
            (Some(f64::MAX), Some(f64::MAX)),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
            let mut target = target();
            target.connection.input_price_per_m = input_price;
            target.connection.output_price_per_m = output_price;
            let mut attempt = StreamAttempt::begin_buffered_http(
                &store,
                "request",
                "public",
                &target,
                b"{}",
                HttpUsageFormat::Responses,
                false,
            )
            .unwrap();
            attempt.observe_buffered_body(&body(
                HttpUsageFormat::Responses,
                json!({"input_tokens":i64::MAX,"output_tokens":i64::MAX}),
                "completed",
            ));
            attempt.complete_buffered();
            let got = row(&store);
            assert_eq!(got.usage_status, "complete");
            assert_eq!(
                (got.prompt_tokens, got.completion_tokens),
                (Some(i64::MAX), Some(i64::MAX))
            );
            assert!(got.estimated_cost_usd.is_none());
        }
    }

    #[test]
    fn bh4_buffered_methods_do_not_settle_other_observation_modes() {
        for antigravity in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("synthetic.db"), None).unwrap();
            let mut a = if antigravity {
                StreamAttempt::begin_antigravity(&store, "request", "public", &target(), true)
                    .unwrap()
            } else {
                StreamAttempt::begin(&store, "request", "public", &target(), b"{}").unwrap()
            };
            a.observe_buffered_chunk(
                event(
                    "response.completed",
                    json!({"status":"completed","usage":{"input_tokens":99,"output_tokens":88}}),
                )
                .as_bytes(),
            );
            a.observe_buffered_body(&body(
                HttpUsageFormat::Chat,
                json!({"prompt_tokens":99,"completion_tokens":88}),
                "stop",
            ));
            a.complete_buffered();
            assert!(row(&store).finalized_at.is_none());
            a.stop("cancelled", "stream_cancelled");
            assert!(row(&store).prompt_tokens.is_none());
        }
        let (_dir, store, mut a) = begin(HttpUsageFormat::Chat, false, json!({}));
        let wrong=b"data: {\"choices\":[{\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":99,\"completion_tokens\":88}}\n\ndata: [DONE]\n\n";
        a.push(wrong);
        a.observe_converted(wrong);
        a.observe_native(wrong);
        a.converted_terminal(false);
        a.observe_antigravity_buffered(b"{}");
        a.complete_antigravity_buffered();
        assert!(row(&store).finalized_at.is_none());
        a.observe_buffered_body(&body(
            HttpUsageFormat::Chat,
            json!({"prompt_tokens":11,"completion_tokens":7}),
            "stop",
        ));
        a.complete_buffered();
        assert_eq!(row(&store).prompt_tokens, Some(11));
    }

    #[test]
    fn bh2_bh4_buffered_lifecycle_quality_and_unknown_extensions_are_bounded() {
        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_chunk(
            event(
                "unknown.future",
                json!({"usage":{"input_tokens":99,"output_tokens":88}}),
            )
            .as_bytes(),
        );
        a.observe_buffered_chunk(
            b"data: {\"type\":\"response.output_text.delta\",\"delta\":\"\"}\n",
        );
        a.stop("failed", "stream_incomplete");
        assert!(row(&store).prompt_tokens.is_none());
        assert!(row(&store).first_output_ms.is_none());

        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_chunk(
            event(
                "response.in_progress",
                json!({"usage":{"input_tokens":-1,"output_tokens":5}}),
            )
            .as_bytes(),
        );
        a.observe_buffered_chunk(
            event(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":3,"output_tokens":2}}),
            )
            .as_bytes(),
        );
        a.observe_buffered_body(b"");
        a.complete_buffered();
        assert_eq!(row(&store).usage_status, "complete");
        assert_eq!(row(&store).prompt_tokens, Some(3));

        let (_dir, store, mut a) = begin(HttpUsageFormat::Responses, true, json!({}));
        a.observe_buffered_chunk(
            event(
                "response.in_progress",
                json!({"usage":{"input_tokens":3,"output_tokens":2}}),
            )
            .as_bytes(),
        );
        a.observe_buffered_chunk(&vec![b'x'; crate::collection::MAX_BYTES]);
        a.observe_buffered_chunk(
            event(
                "response.completed",
                json!({"status":"completed","usage":{"input_tokens":99,"output_tokens":88}}),
            )
            .as_bytes(),
        );
        a.stop("failed", "stream_observer_limit");
        let got = row(&store);
        assert_eq!(got.outcome, "failed");
        assert_eq!(got.prompt_tokens, Some(3));
        assert_eq!(got.usage_status, "partial");
        assert!(got.estimated_cost_usd.is_none());
    }

    #[test]
    fn bh4_buffered_line_retention_respects_collection_capacity() {
        let transcript = event(
            "response.completed",
            json!({
                "status":"completed","opaque":"x".repeat(10 * 1024 * 1024),
                "usage":{"input_tokens":3,"output_tokens":2}
            }),
        );
        assert!(transcript.len() < crate::collection::MAX_BYTES);
        assert!(crate::responses::reassemble_sse(&transcript).is_ok());
        let mut observation =
            super::BufferedObservation::new(HttpUsageFormat::Responses, Some(1), true);
        let first_fragment = 9 * 1024 * 1024;
        observation.chunk(&transcript.as_bytes()[..first_fragment], 1);
        observation.chunk(&transcript.as_bytes()[first_fragment..], 2);
        assert_eq!(observation.outcome, Some("succeeded"));
        assert_eq!(
            (observation.prompt, observation.completion),
            (Some(3), Some(2))
        );
        // This is the explicit retained-memory contract, including spare Vec
        // capacity after the valid terminal line has been parsed and cleared.
        assert!(
            observation.line.capacity() <= crate::collection::MAX_BYTES,
            "retained line allocation {} exceeds collection bound {}",
            observation.line.capacity(),
            crate::collection::MAX_BYTES
        );
    }
}

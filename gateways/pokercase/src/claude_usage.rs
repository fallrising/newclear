//! Accounting for an identified Claude Code reply phase, before wire conversion.
//! Four numeric buckets and fixed classifications are retained; no CLI text or
//! whole-session `result` payload is accepted by this observer.
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;

use crate::proxy::UpstreamAttemptError;
use crate::store::{ClaudeReportedUsage, ResolvedTarget, Store, StreamFinalization};

#[derive(Clone)]
pub struct RequestContext {
    store: Store,
    request_id: String,
    public_model: String,
    connection_id: String,
    upstream_model: String,
}

impl RequestContext {
    pub fn new(
        store: &Store,
        request_id: &str,
        public_model: &str,
        target: &ResolvedTarget,
    ) -> Self {
        Self {
            store: store.clone(),
            request_id: request_id.into(),
            public_model: public_model.into(),
            connection_id: target.connection.id.clone(),
            upstream_model: target.upstream_model.clone(),
        }
    }

    /// Call separately before every selected spawn, user input or tool-result dispatch.
    pub fn begin(&self) -> Result<Attempt, UpstreamAttemptError> {
        let start = Instant::now();
        let id = self
            .store
            .begin_stream_attempt_with_source(
                &self.request_id,
                &self.public_model,
                &self.connection_id,
                &self.upstream_model,
                "claude_code_stream_event_v1",
            )
            .map_err(|_| UpstreamAttemptError {
                status: 503,
                body: "usage reservation failed".into(),
                retryable: false,
            })?;
        Ok(Attempt(Arc::new(Mutex::new(Observation {
            store: self.store.clone(),
            id,
            start,
            usage: ClaudeReportedUsage::default(),
            invalid_usage: false,
            ready: false,
            first_output_ms: None,
            stop_reason: None,
            terminal_usage_seen: false,
            terminal: None,
            settled: false,
        }))))
    }
}

/// Shared by the original reply channel's producer and consumer, never looked up
/// through a reusable process after the reply has detached. Dropping a clone does
/// not settle the attempt; the consumer explicitly settles or stops its reply.
#[derive(Clone)]
pub struct Attempt(Arc<Mutex<Observation>>);

impl Attempt {
    pub fn ready(&self) {
        let mut o = self.0.lock().unwrap();
        if o.ready || o.settled {
            return;
        }
        o.ready = true;
        if o.store.observe_cli_ready(&o.id, o.elapsed()).is_err() {
            tracing::warn!("usage_cli_ready_write_failed");
        }
    }

    #[cfg(test)]
    pub fn observe_event(&self, event: &Value) {
        self.observe_filtered_event(event, true);
    }

    /// Counters and terminal metadata come from the untouched raw event. Output
    /// timing also requires EventFilter to have accepted a caller-visible record.
    pub fn observe_filtered_event(&self, event: &Value, accepted: bool) {
        self.0.lock().unwrap().observe(event, accepted);
    }

    pub fn stop(&self, outcome: &'static str, error: &'static str) {
        self.0.lock().unwrap().settle(outcome, Some(error), false);
    }

    pub fn eof(&self) {
        self.0
            .lock()
            .unwrap()
            .settle("failed", Some("stream_incomplete"), false);
    }

    pub fn converted_terminal(&self, failed: bool) {
        self.0.lock().unwrap().settle(
            "failed",
            Some(if failed {
                "stream_conversion_failed"
            } else {
                "stream_incomplete"
            }),
            failed,
        );
    }

    /// ClaudeRun yields complete SSE records. This reads only their event kind to
    /// settle before the terminal bytes are yielded; counters come from raw events.
    pub fn passthrough(&self, bytes: &[u8]) {
        if bytes.starts_with(b"event: message_stop\n") || bytes.starts_with(b"event: error\n") {
            self.eof();
        }
    }
}

struct Terminal {
    outcome: &'static str,
    error: Option<&'static str>,
    elapsed_ms: i64,
    usage_ended: bool,
}

struct Observation {
    store: Store,
    id: String,
    start: Instant,
    usage: ClaudeReportedUsage,
    invalid_usage: bool,
    ready: bool,
    first_output_ms: Option<i64>,
    stop_reason: Option<&'static str>,
    terminal_usage_seen: bool,
    terminal: Option<Terminal>,
    settled: bool,
}

impl Observation {
    fn elapsed(&self) -> i64 {
        self.start.elapsed().as_millis().min(i64::MAX as u128) as i64
    }

    fn observe(&mut self, event: &Value, accepted: bool) {
        if self.settled || self.terminal.is_some() {
            return;
        }
        match event.get("type").and_then(Value::as_str) {
            Some("message_start") => {
                if let Some(usage) = event.get("message").and_then(|m| m.get("usage")) {
                    self.usage(usage);
                }
            }
            Some("message_delta") => {
                if let Some(usage) = event.get("usage") {
                    self.usage(usage);
                }
                if let Some(reason) = event.get("delta").and_then(|d| d.get("stop_reason")) {
                    if !reason.is_null() {
                        self.terminal_usage_seen = event
                            .get("usage")
                            .and_then(|u| u.get("output_tokens"))
                            .and_then(Value::as_i64)
                            .is_some_and(|n| n >= 0);
                        self.stop_reason = Some(match reason.as_str() {
                            Some("end_turn" | "tool_use" | "stop_sequence") => "succeeded",
                            Some("max_tokens") => "incomplete",
                            _ => "unknown",
                        });
                    }
                }
            }
            Some("content_block_start") => {
                if let Some(block) = event.get("content_block") {
                    let visible = match block.get("type").and_then(Value::as_str) {
                        Some("text") => block
                            .get("text")
                            .and_then(Value::as_str)
                            .is_some_and(|v| !v.is_empty()),
                        Some("tool_use") => {
                            block.get("name").and_then(Value::as_str).is_some_and(|v| {
                                v.starts_with(crate::claude_mcp::PREFIX)
                                    && v.len() > crate::claude_mcp::PREFIX.len()
                            })
                        }
                        _ => false,
                    };
                    if visible && accepted {
                        self.first_output();
                    }
                }
            }
            Some("content_block_delta") => {
                let delta = &event["delta"];
                if accepted
                    && delta["type"] == "text_delta"
                    && delta["text"].as_str().is_some_and(|v| !v.is_empty())
                {
                    self.first_output();
                }
            }
            Some("message_stop") => {
                self.terminal = Some(Terminal {
                    outcome: self.stop_reason.unwrap_or("unknown"),
                    error: None,
                    elapsed_ms: self.elapsed(),
                    usage_ended: self.terminal_usage_seen,
                });
            }
            Some("error") => {
                self.terminal = Some(Terminal {
                    outcome: "failed",
                    error: Some("stream_error"),
                    elapsed_ms: self.elapsed(),
                    usage_ended: false,
                });
                // A raw failure cannot become success through conversion. Persist
                // now, even if the CLI remains alive or no client record was emitted.
                self.settle("failed", Some("stream_error"), false);
            }
            _ => {}
        }
    }

    fn first_output(&mut self) {
        if self.first_output_ms.is_none() {
            self.first_output_ms = Some(self.elapsed());
        }
    }

    fn usage(&mut self, usage: &Value) {
        if usage.is_null() {
            return;
        }
        if !usage.is_object() {
            self.invalid_usage = true;
            return;
        }
        for (key, dst, cumulative) in [
            ("input_tokens", &mut self.usage.input_tokens, false),
            ("output_tokens", &mut self.usage.output_tokens, true),
            (
                "cache_read_input_tokens",
                &mut self.usage.cache_read_input_tokens,
                false,
            ),
            (
                "cache_creation_input_tokens",
                &mut self.usage.cache_creation_input_tokens,
                false,
            ),
        ] {
            let Some(value) = usage.get(key).filter(|v| !v.is_null()) else {
                continue;
            };
            let Some(n) = value.as_i64().filter(|n| *n >= 0) else {
                self.invalid_usage = true;
                continue;
            };
            if dst.is_some_and(|old| if cumulative { n < old } else { n != old }) {
                self.invalid_usage = true;
            } else {
                *dst = Some(n);
            }
        }
        if self.usage.input_tokens.is_some()
            && self.usage.cache_read_input_tokens.is_some()
            && self.usage.cache_creation_input_tokens.is_some()
            && self.usage.prompt_total().is_none()
        {
            self.invalid_usage = true;
        }
    }

    fn settle(
        &mut self,
        fallback: &'static str,
        error: Option<&'static str>,
        conversion_failed: bool,
    ) {
        if self.settled {
            return;
        }
        self.settled = true; // A failed write stays pending; do not retry inference or this write.
                             // Translating a source error into client error bytes does not change its cause.
        let conversion_failed = conversion_failed
            && !self
                .terminal
                .as_ref()
                .is_some_and(|t| matches!(t.outcome, "failed" | "cancelled" | "timeout"));
        let outcome = if conversion_failed {
            "failed"
        } else {
            self.terminal.as_ref().map_or(fallback, |t| t.outcome)
        };
        let total_observed_ms = if conversion_failed {
            self.elapsed()
        } else {
            self.terminal
                .as_ref()
                .map_or_else(|| self.elapsed(), |t| t.elapsed_ms)
        };
        let prompt = self.usage.prompt_total();
        let usage_status = if self.invalid_usage {
            "invalid"
        } else if self.terminal.as_ref().is_some_and(|t| t.usage_ended)
            && prompt.is_some()
            && self.usage.output_tokens.is_some()
        {
            "complete"
        } else if !self.usage.is_empty() {
            "partial"
        } else {
            "missing"
        };
        let reason = if conversion_failed {
            error
        } else if let Some(terminal) = &self.terminal {
            terminal.error
        } else {
            error
        };
        let finalization = StreamFinalization {
            outcome,
            usage_status,
            error: reason.or(self.invalid_usage.then_some("stream_invalid_usage")),
            prompt_tokens: prompt,
            completion_tokens: self.usage.output_tokens,
            estimated_cost_usd: None,
            first_output_ms: self.first_output_ms,
            total_observed_ms,
        };
        if self
            .store
            .finalize_claude_attempt(&self.id, &finalization, &self.usage)
            .is_err()
        {
            tracing::warn!("usage_finalization_failed");
        }
    }
}

impl Drop for Observation {
    fn drop(&mut self) {
        self.settle("cancelled", Some("stream_cancelled"), false);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn context(store: &Store) -> RequestContext {
        let connection = serde_json::from_value(json!({
            "id":"synthetic","name":"synthetic","base_url":"","api_key":"",
            "default_model":null,"priority":0,"enabled":true,
            "input_price_per_m":1.0,"output_price_per_m":1.0,"auth_type":"oauth_import",
            "oauth":null,"created_at":"synthetic","updated_at":"synthetic"
        }))
        .unwrap();
        RequestContext::new(
            store,
            "generated-request",
            "public",
            &ResolvedTarget {
                connection,
                upstream_model: "requested-sonnet".into(),
            },
        )
    }

    fn start(a: &Attempt, usage: Value) {
        a.observe_event(&json!({"type":"message_start","message":{"usage":usage}}));
        a.ready();
    }

    fn finish(a: &Attempt, reason: &str, output: Value) {
        a.observe_event(&json!({"type":"message_delta","delta":{"stop_reason":reason},"usage":{"output_tokens":output}}));
        a.observe_event(&json!({"type":"message_stop"}));
    }

    fn row(store: &Store) -> crate::store::UsageEvent {
        store.recent_usage(1).unwrap().remove(0)
    }

    #[test]
    fn cs3_raw_error_is_durable_without_another_event_or_consumer_poll() {
        for started in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            if started {
                start(&a, json!({"input_tokens":4,"output_tokens":0}));
            }
            a.observe_filtered_event(
                &json!({"type":"error","error":{"message":"synthetic-private-error"}}),
                false,
            );
            let before = serde_json::to_value(row(&store)).unwrap();
            assert!(
                before["finalized_at"].is_string(),
                "a known raw failure cannot remain pending while CLI stays alive"
            );
            assert_eq!(before["outcome"], "failed");
            assert_eq!(before["error"], "stream_error");
            assert!(!before.to_string().contains("synthetic-private-error"));
            a.stop("timeout", "stream_timeout");
            a.converted_terminal(true);
            assert_eq!(serde_json::to_value(row(&store)).unwrap(), before);
        }
    }

    #[test]
    fn cs2_raw_counts_are_retained_without_inventing_missing_cache_buckets() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = context(&store).begin().unwrap();
        start(&a, json!({"input_tokens":12,"output_tokens":0}));
        a.observe_event(&json!({"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"never persist"}}));
        assert!(a.0.lock().unwrap().first_output_ms.is_none());
        a.observe_event(
            &json!({"type":"content_block_delta","delta":{"type":"text_delta","text":"visible"}}),
        );
        finish(&a, "end_turn", json!(5));
        assert!(
            row(&store).finalized_at.is_none(),
            "producer terminal is observed, consumer owns settlement"
        );
        a.passthrough(b"event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n");
        let r = row(&store);
        assert_eq!(r.outcome, "succeeded");
        assert_eq!(r.usage_status, "partial");
        assert!(r.prompt_tokens.is_none());
        assert_eq!(r.completion_tokens, Some(5));
        assert_eq!(r.reported_usage.unwrap().input_tokens, Some(12));
        assert!(r.estimated_cost_usd.is_none() && r.status.is_none() && r.headers_ms.is_none());
        assert!(r.cli_ready_ms.is_some() && r.first_output_ms.is_some());
        assert!(r.cli_ready_ms <= r.total_observed_ms && r.first_output_ms <= r.total_observed_ms);
        let before = serde_json::to_value(store.recent_usage(1).unwrap()).unwrap();
        a.stop("cancelled", "stream_cancelled");
        a.converted_terminal(true);
        drop(a);
        assert_eq!(
            serde_json::to_value(store.recent_usage(1).unwrap()).unwrap(),
            before
        );
        let csv = store.usage_csv(1).unwrap();
        assert!(!csv.contains("visible") && !csv.contains("never persist"));
        assert!(csv.lines().next().unwrap().ends_with("cli_ready_ms,reported_input_tokens,reported_output_tokens,reported_cache_read_input_tokens,reported_cache_creation_input_tokens"));
        let fields: Vec<_> = csv.lines().nth(1).unwrap().split(',').collect();
        assert_eq!(&fields[21..], &["12", "5", "", ""]);
    }

    #[test]
    fn cs2_cumulative_output_replaces_and_explicit_disjoint_buckets_sum_once() {
        for input in [0, 12] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            start(
                &a,
                json!({"input_tokens":input,"cache_read_input_tokens":input,"cache_creation_input_tokens":input,"output_tokens":0}),
            );
            a.observe_event(&json!({"type":"message_delta","usage":{"output_tokens":input}}));
            finish(&a, "max_tokens", json!(input));
            a.converted_terminal(false);
            let r = row(&store);
            assert_eq!(r.prompt_tokens, Some(input * 3));
            assert_eq!(r.completion_tokens, Some(input));
            assert_eq!(r.usage_status, "complete");
            assert_eq!(r.outcome, "incomplete");
            assert!(r.estimated_cost_usd.is_none());
        }
    }

    #[test]
    fn cs2_missing_raw_only_partial_and_invalid_counts_never_become_zero() {
        for (usage, quality) in [
            (json!({}), "missing"),
            (Value::Null, "missing"),
            (json!({"input_tokens":3}), "partial"),
            (json!({"input_tokens":null,"output_tokens":null}), "missing"),
            (json!({"output_tokens":-1}), "invalid"),
            (json!({"output_tokens":"4"}), "invalid"),
            (json!({"output_tokens":1.5}), "invalid"),
            (json!({"output_tokens":u64::MAX}), "invalid"),
            (
                json!({"input_tokens":i64::MAX,"cache_read_input_tokens":1,"cache_creation_input_tokens":0}),
                "invalid",
            ),
            (json!([]), "invalid"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            start(&a, usage);
            finish(&a, "end_turn", Value::Null);
            a.converted_terminal(false);
            let r = row(&store);
            assert_eq!(r.usage_status, quality);
            assert!(r.prompt_tokens.is_none());
            assert!(r.completion_tokens.is_none() && r.estimated_cost_usd.is_none());
            assert_eq!(r.outcome, "succeeded");
        }
    }

    #[test]
    fn cs2_initial_or_progress_output_is_partial_without_terminal_usage() {
        for progress in [None, Some(2)] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            start(
                &a,
                json!({"input_tokens":1,"cache_read_input_tokens":0,"cache_creation_input_tokens":0,"output_tokens":0}),
            );
            if let Some(output) = progress {
                a.observe_event(&json!({"type":"message_delta","usage":{"output_tokens":output}}));
            }
            finish(&a, "end_turn", Value::Null);
            a.converted_terminal(false);
            let r = row(&store);
            assert_eq!(r.usage_status, "partial");
            assert_eq!(r.completion_tokens, Some(progress.unwrap_or(0)));
            assert_eq!(r.outcome, "succeeded");
        }
    }

    #[test]
    fn cs2_invalid_decreases_and_input_conflicts_keep_prior_valid_observations() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = context(&store).begin().unwrap();
        start(&a, json!({"input_tokens":5,"output_tokens":3}));
        a.observe_event(
            &json!({"type":"message_delta","usage":{"input_tokens":6,"output_tokens":2}}),
        );
        finish(&a, "tool_use", json!(4));
        a.converted_terminal(false);
        let r = row(&store);
        assert_eq!(r.usage_status, "invalid");
        assert_eq!(r.reported_usage.unwrap().input_tokens, Some(5));
        assert_eq!(r.completion_tokens, Some(4));
    }

    #[test]
    fn cs3_terminal_and_consumer_failure_precedence_is_once_only() {
        for (raw_stop, conversion_failed, expected) in [
            (false, false, "cancelled"),
            (true, false, "succeeded"),
            (true, true, "failed"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            start(&a, json!({"input_tokens":1}));
            if raw_stop {
                finish(&a, "end_turn", json!(2));
            }
            if conversion_failed {
                a.converted_terminal(true);
            } else {
                a.stop("cancelled", "stream_cancelled");
            }
            a.eof();
            a.stop("timeout", "stream_timeout");
            assert_eq!(row(&store).outcome, expected);
        }
    }

    #[test]
    fn cs3_error_and_eof_are_failures_and_unrecognized_stop_is_unknown() {
        for (terminal, expected, error) in [
            (
                json!({"type":"error","error":{"message":"sensitive canary"}}),
                "failed",
                Some("stream_error"),
            ),
            (json!({"type":"message_stop"}), "unknown", None),
            (
                json!({"type":"result","usage":{"input_tokens":900,"output_tokens":900}}),
                "failed",
                Some("stream_incomplete"),
            ),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            start(&a, json!({"output_tokens":2}));
            a.observe_event(&terminal);
            if expected == "failed" && error == Some("stream_error") {
                a.converted_terminal(true);
            }
            a.eof();
            let r = row(&store);
            assert_eq!(r.outcome, expected);
            assert_eq!(r.error.as_deref(), error);
            assert_eq!(r.completion_tokens, Some(2));
            assert!(!store.usage_csv(1).unwrap().contains("sensitive canary"));
        }
    }

    #[test]
    fn cs3_clone_drop_cannot_finish_another_owner_and_last_drop_retains_terminal() {
        for completed in [false, true] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            let producer = a.clone();
            start(&a, json!({"output_tokens":0}));
            if completed {
                finish(&a, "end_turn", json!(3));
            }
            drop(producer);
            assert!(row(&store).finalized_at.is_none());
            drop(a);
            assert_eq!(
                row(&store).outcome,
                if completed { "succeeded" } else { "cancelled" }
            );
        }
    }

    #[test]
    fn cs4_store_failures_leave_one_pending_attempt_for_explicit_restart_recovery() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let store = Store::open(&path, None).unwrap();
        let db = rusqlite::Connection::open(&path).unwrap();
        db.execute_batch("CREATE TRIGGER deny_reservation BEFORE INSERT ON usage_events BEGIN SELECT RAISE(ABORT, 'synthetic'); END;").unwrap();
        let result = context(&store).begin();
        assert!(matches!(
            result,
            Err(UpstreamAttemptError {
                status: 503,
                retryable: false,
                ..
            })
        ));
        assert!(store.recent_usage(10).unwrap().is_empty());
        db.execute_batch("DROP TRIGGER deny_reservation;").unwrap();
        let a = context(&store).begin().unwrap();
        start(&a, json!({"output_tokens":1}));
        finish(&a, "end_turn", json!(2));
        db.execute_batch("CREATE TRIGGER deny_final BEFORE UPDATE ON usage_events WHEN NEW.finalized_at IS NOT NULL BEGIN SELECT RAISE(ABORT, 'synthetic'); END;").unwrap();
        a.converted_terminal(false);
        assert!(row(&store).finalized_at.is_none());
        db.execute_batch("DROP TRIGGER deny_final;").unwrap();
        a.eof();
        drop(a);
        assert!(
            row(&store).finalized_at.is_none(),
            "failed finalization is not retried"
        );
        let reopened = Store::open(&path, None).unwrap();
        assert!(row(&reopened).finalized_at.is_none());
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 1);
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 0);
        let r = row(&reopened);
        assert_eq!(r.outcome, "interrupted");
        assert_eq!(r.usage_status, "missing");
        assert!(
            r.reported_usage.is_none()
                && r.prompt_tokens.is_none()
                && r.completion_tokens.is_none()
        );
        assert!(
            r.total_observed_ms.is_none()
                && r.first_output_ms.is_none()
                && r.estimated_cost_usd.is_none()
        );
        assert_eq!(store.recent_usage(10).unwrap().len(), 1);
    }
}

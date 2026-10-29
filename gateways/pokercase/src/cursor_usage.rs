//! Raw Cursor result accounting for one owned runtime dispatch.
//! Input/cache relationships remain unverified: retain raw counters separately,
//! never use the synthetic Messages usage or infer a cache-inclusive prompt total.
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;

use crate::proxy::UpstreamAttemptError;
use crate::store::{
    ClaudeReportedUsage as ReportedUsage, ResolvedTarget, Store, StreamFinalization,
};

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

    /// Reserve only after non-dispatch validation and before the runtime spawn.
    pub fn begin(&self) -> Result<Attempt, UpstreamAttemptError> {
        let start = Instant::now();
        let id = self
            .store
            .begin_stream_attempt_with_source(
                &self.request_id,
                &self.public_model,
                &self.connection_id,
                &self.upstream_model,
                "cursor_cli_result_v1",
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
            usage: ReportedUsage::default(),
            invalid_usage: false,
            ready: false,
            first_output_ms: None,
            terminal: None,
            settled: false,
        }))))
    }
}

/// This clone belongs to one process/channel. The consumer owns final settlement;
/// producer clones only observe raw events and immediately persist known failures.
#[derive(Clone)]
pub struct Attempt(Arc<Mutex<Observation>>);

impl Attempt {
    pub fn ready(&self) {
        let mut o = self.0.lock().unwrap();
        if o.ready || o.settled || o.terminal.is_some() {
            return;
        }
        o.ready = true;
        if o.store.observe_cli_ready(&o.id, o.elapsed()).is_err() {
            tracing::warn!("usage_cli_ready_write_failed");
        }
    }

    /// `visible` and `success` come from the same Translate invocation as the raw
    /// line: only accepted nonempty text sets output timing; Translate owns the
    /// existing exact result-shape validation. No translated counters are read.
    pub fn observe_line(&self, event: &Value, visible: bool, success: bool) {
        self.0.lock().unwrap().observe(event, visible, success);
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

    /// The Cursor bridge yields one complete Messages SSE record per chunk.
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
}

struct Observation {
    store: Store,
    id: String,
    start: Instant,
    usage: ReportedUsage,
    invalid_usage: bool,
    ready: bool,
    first_output_ms: Option<i64>,
    terminal: Option<Terminal>,
    settled: bool,
}

impl Observation {
    fn elapsed(&self) -> i64 {
        self.start.elapsed().as_millis().min(i64::MAX as u128) as i64
    }

    fn observe(&mut self, event: &Value, visible: bool, success: bool) {
        if self.settled || self.terminal.is_some() {
            return;
        }
        if visible && self.first_output_ms.is_none() {
            self.first_output_ms = Some(self.elapsed());
        }
        if event.get("type").and_then(Value::as_str) != Some("result") {
            return;
        }
        if let Some(usage) = event.get("usage").filter(|v| !v.is_null()) {
            if !usage.is_object() {
                self.invalid_usage = true;
            } else {
                for (key, dst) in [
                    ("inputTokens", &mut self.usage.input_tokens),
                    ("outputTokens", &mut self.usage.output_tokens),
                    ("cacheReadTokens", &mut self.usage.cache_read_input_tokens),
                    (
                        "cacheWriteTokens",
                        &mut self.usage.cache_creation_input_tokens,
                    ),
                ] {
                    let Some(value) = usage.get(key).filter(|v| !v.is_null()) else {
                        continue;
                    };
                    if let Some(n) = value.as_i64().filter(|n| *n >= 0) {
                        *dst = Some(n);
                    } else {
                        self.invalid_usage = true;
                    }
                }
            }
        }
        self.terminal = Some(Terminal {
            outcome: if success { "succeeded" } else { "failed" },
            error: (!success).then_some("stream_error"),
            elapsed_ms: self.elapsed(),
        });
        // Failed terminal cannot be rescued by conversion or another source line.
        // Its ledger result must not wait for stderr drainage/runtime cleanup.
        if !success {
            self.settle("failed", Some("stream_error"), false);
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
        self.settled = true; // Exactly one write attempt; failure stays pending for recovery.
        let conversion_failed = conversion_failed
            && !self
                .terminal
                .as_ref()
                .is_some_and(|t| t.outcome == "failed");
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
        let error = if conversion_failed {
            error
        } else {
            self.terminal.as_ref().map_or(error, |t| t.error)
        };
        let usage_status = if self.invalid_usage {
            "invalid"
        } else if self.usage.is_empty() {
            "missing"
        } else {
            "partial"
        };
        let finalization = StreamFinalization {
            outcome,
            usage_status,
            error: error.or(self.invalid_usage.then_some("stream_invalid_usage")),
            // Cursor's cache relationship is unknown; raw input is kept separately.
            prompt_tokens: None,
            completion_tokens: self.usage.output_tokens,
            estimated_cost_usd: None,
            first_output_ms: self.first_output_ms,
            total_observed_ms,
        };
        if self
            .store
            .finalize_cursor_attempt(&self.id, &finalization, &self.usage)
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
            "request",
            "public",
            &ResolvedTarget {
                connection,
                upstream_model: "requested-auto".into(),
            },
        )
    }

    fn row(store: &Store) -> crate::store::UsageEvent {
        store.recent_usage(1).unwrap().remove(0)
    }

    fn result(a: &Attempt, usage: Value, success: bool) {
        a.observe_line(
            &json!({"type":"result","usage":usage,"result":"PRIVATE-RESULT",
            "subtype":if success {"success"} else {"error"},"is_error":!success}),
            false,
            success,
        );
    }

    #[test]
    fn cu2_raw_cache_fields_never_form_a_guessed_total_or_cost() {
        for input in [0, 12, i64::MAX] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            a.ready();
            a.observe_line(&json!({"type":"assistant"}), true, false);
            result(
                &a,
                json!({"inputTokens":input,"outputTokens":3,
                "cacheReadTokens":5,"cacheWriteTokens":0}),
                true,
            );
            assert!(row(&store).finalized_at.is_none());
            a.passthrough(b"event: message_stop\ndata: {}\n\n");
            let r = row(&store);
            assert_eq!(r.usage_source, "cursor_cli_result_v1");
            assert_eq!(r.outcome, "succeeded");
            assert_eq!(r.usage_status, "partial");
            assert!(r.prompt_tokens.is_none() && r.estimated_cost_usd.is_none());
            assert_eq!(r.completion_tokens, Some(3));
            assert!(r.status.is_none() && r.headers_ms.is_none());
            assert!(r.cli_ready_ms.is_some() && r.first_output_ms.is_some());
            assert!(
                r.cli_ready_ms <= r.first_output_ms && r.first_output_ms <= r.total_observed_ms
            );
            assert_eq!(
                r.reported_usage.unwrap(),
                ReportedUsage {
                    input_tokens: Some(input),
                    output_tokens: Some(3),
                    cache_read_input_tokens: Some(5),
                    cache_creation_input_tokens: Some(0),
                }
            );
            let fields: Vec<_> = store
                .usage_csv(1)
                .unwrap()
                .lines()
                .nth(1)
                .unwrap()
                .split(',')
                .map(str::to_owned)
                .collect();
            assert_eq!(
                &fields[21..],
                &[input.to_string(), "3".into(), "5".into(), "0".into()]
            );
        }
    }

    #[test]
    fn cu2_missing_zero_invalid_and_partial_are_distinct() {
        for (usage, quality, output) in [
            (Value::Null, "missing", None),
            (json!({}), "missing", None),
            (
                json!({"inputTokens":null,"outputTokens":null}),
                "missing",
                None,
            ),
            (json!({"inputTokens":0}), "partial", None),
            (json!({"outputTokens":0}), "partial", Some(0)),
            (json!({"cacheReadTokens":0}), "partial", None),
            (
                json!({"inputTokens":-1,"outputTokens":3}),
                "invalid",
                Some(3),
            ),
            (json!({"outputTokens":"4"}), "invalid", None),
            (json!({"outputTokens":true}), "invalid", None),
            (json!({"outputTokens":1.5}), "invalid", None),
            (json!({"outputTokens":u64::MAX}), "invalid", None),
            (json!([]), "invalid", None),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            result(&a, usage, true);
            a.converted_terminal(false);
            let r = row(&store);
            assert_eq!(r.outcome, "succeeded");
            assert_eq!(r.usage_status, quality);
            assert_eq!(r.completion_tokens, output);
            assert!(r.prompt_tokens.is_none() && r.estimated_cost_usd.is_none());
        }
    }

    #[test]
    fn cu2_only_first_result_supplies_usage_and_filtered_output_is_not_timed() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = context(&store).begin().unwrap();
        for kind in ["system", "thinking", "tool_call", "assistant"] {
            a.observe_line(
                &json!({"type":kind,"usage":{"inputTokens":900,"outputTokens":900}}),
                false,
                false,
            );
        }
        result(&a, json!({"inputTokens":2,"outputTokens":4}), true);
        result(&a, json!({"inputTokens":200,"outputTokens":400}), true);
        a.eof();
        let r = row(&store);
        assert!(r.first_output_ms.is_none());
        assert_eq!(r.reported_usage.unwrap().input_tokens, Some(2));
        assert_eq!(r.completion_tokens, Some(4));
        assert_eq!(store.recent_usage(10).unwrap().len(), 1);
    }

    #[test]
    fn cu3_failed_result_is_durable_immediately_without_another_poll() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = context(&store).begin().unwrap();
        result(&a, json!({"inputTokens":8,"outputTokens":2}), false);
        let before = serde_json::to_value(row(&store)).unwrap();
        assert!(before["finalized_at"].is_string());
        assert_eq!(before["outcome"], "failed");
        assert_eq!(before["error"], "stream_error");
        assert_eq!(before["completion_tokens"], 2);
        assert!(!before.to_string().contains("PRIVATE-RESULT"));
        result(&a, json!({"outputTokens":999}), true);
        a.stop("cancelled", "stream_cancelled");
        a.converted_terminal(true);
        assert_eq!(serde_json::to_value(row(&store)).unwrap(), before);
    }

    #[test]
    fn cu3_success_survives_drop_but_unaccepted_conversion_can_fail() {
        for (terminal, conversion_failed, expected) in [
            (false, false, "cancelled"),
            (true, false, "succeeded"),
            (true, true, "failed"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            if terminal {
                result(&a, json!({"outputTokens":3}), true);
            }
            if conversion_failed {
                a.converted_terminal(true);
            }
            drop(a);
            let r = row(&store);
            assert_eq!(r.outcome, expected);
            if conversion_failed {
                assert_eq!(r.error.as_deref(), Some("stream_conversion_failed"));
            }
        }
    }

    #[test]
    fn cu3_eof_timeout_and_cancel_are_distinct_and_settle_once() {
        for (outcome, error) in [
            ("failed", "stream_incomplete"),
            ("timeout", "stream_timeout"),
            ("cancelled", "stream_cancelled"),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let store = Store::open(&dir.path().join("db"), None).unwrap();
            let a = context(&store).begin().unwrap();
            if outcome == "failed" {
                a.eof();
            } else {
                a.stop(outcome, error);
            }
            a.stop("cancelled", "stream_cancelled");
            let r = row(&store);
            assert_eq!(r.outcome, outcome);
            assert_eq!(r.error.as_deref(), Some(error));
        }
    }

    #[test]
    fn cu4_failed_finalization_is_not_retried_and_restart_recovers_pending_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let store = Store::open(&path, None).unwrap();
        let db = rusqlite::Connection::open(&path).unwrap();
        let a = context(&store).begin().unwrap();
        db.execute_batch("CREATE TRIGGER reject_final BEFORE UPDATE ON usage_events WHEN NEW.finalized_at IS NOT NULL BEGIN SELECT RAISE(FAIL, 'synthetic storage failure'); END;").unwrap();
        result(&a, json!({"inputTokens":8,"outputTokens":2}), true);
        a.converted_terminal(false);
        assert!(row(&store).finalized_at.is_none());
        db.execute_batch("DROP TRIGGER reject_final;").unwrap();
        a.eof();
        drop(a);
        assert!(
            row(&store).finalized_at.is_none(),
            "no repeated finalization attempt"
        );
        drop(store);
        let reopened = Store::open(&path, None).unwrap();
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 1);
        assert_eq!(reopened.recover_stream_attempts().unwrap(), 0);
        let r = row(&reopened);
        assert_eq!(r.outcome, "interrupted");
        assert!(
            r.prompt_tokens.is_none()
                && r.completion_tokens.is_none()
                && r.reported_usage.is_none()
        );
        assert!(r.first_output_ms.is_none() && r.total_observed_ms.is_none());
    }

    #[test]
    fn cu1_failed_reservation_has_no_row_and_is_not_retryable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("db");
        let store = Store::open(&path, None).unwrap();
        rusqlite::Connection::open(&path).unwrap().execute_batch(
            "CREATE TRIGGER reject_insert BEFORE INSERT ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic reservation failure'); END;"
        ).unwrap();
        let error = match context(&store).begin() {
            Ok(_) => panic!("reservation must fail"),
            Err(e) => e,
        };
        assert_eq!(
            (error.status, error.body.as_str(), error.retryable),
            (503, "usage reservation failed", false)
        );
        assert!(store.recent_usage(1).unwrap().is_empty());
    }

    #[test]
    fn cu4_store_enforces_cursor_source_and_normalization_invariants() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("db"), None).unwrap();
        let a = context(&store).begin().unwrap();
        let id = row(&store).attempt_id.unwrap();
        let reported = ReportedUsage {
            input_tokens: Some(7),
            output_tokens: Some(2),
            ..Default::default()
        };
        let finalization = StreamFinalization {
            outcome: "succeeded",
            usage_status: "partial",
            completion_tokens: Some(2),
            ..Default::default()
        };
        for invalid in [
            StreamFinalization {
                prompt_tokens: Some(7),
                ..finalization.clone()
            },
            StreamFinalization {
                completion_tokens: Some(3),
                ..finalization.clone()
            },
            StreamFinalization {
                usage_status: "complete",
                ..finalization.clone()
            },
            StreamFinalization {
                estimated_cost_usd: Some(0.0),
                ..finalization.clone()
            },
        ] {
            assert!(store
                .finalize_cursor_attempt(&id, &invalid, &reported)
                .is_err());
        }
        let http = store
            .begin_stream_attempt("request", "model", "connection", "upstream")
            .unwrap();
        assert!(!store
            .finalize_cursor_attempt(&http, &finalization, &reported)
            .unwrap());
        assert!(store
            .finalize_cursor_attempt(&id, &finalization, &reported)
            .unwrap());
        assert!(!store
            .finalize_cursor_attempt(&id, &finalization, &reported)
            .unwrap());
        drop(a);
    }
}

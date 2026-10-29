//! NH integration through real refresh/forward/stream code and controlled loopback only.
use super::*;
use axum::extract::{Request, State};
use http_body_util::BodyExt;
use std::sync::atomic::{AtomicBool, AtomicUsize};
use tempfile::TempDir;

struct Mock {
    store: Store,
    inference: AtomicUsize,
    refresh: AtomicUsize,
    reserved: AtomicBool,
    mode: &'static str,
}

async fn endpoint(State(mock): State<Arc<Mock>>, req: Request) -> Response {
    let path = req.uri().path();
    if matches!(path, "/api/accounts/oauth/token" | "/oauth2/token") {
        mock.refresh.fetch_add(1, Ordering::SeqCst);
        // Refresh has no active inference attempt, even after a model401.
        assert!(mock
            .store
            .recent_usage(10)
            .unwrap()
            .iter()
            .all(|r| r.finalized_at.is_some()));
        if mock.mode == "refresh-fails" {
            return (StatusCode::UNAUTHORIZED, "synthetic refresh failure").into_response();
        }
        return axum::Json(json!({"access_token":"fresh-synthetic", "refresh_token":"rotated-synthetic", "expires_in":3600})).into_response();
    }
    assert_eq!(
        path, "/v1/responses",
        "unexpected destination rejected by controlled server"
    );
    mock.inference.fetch_add(1, Ordering::SeqCst);
    let rows = mock.store.recent_usage(10).unwrap();
    mock.reserved.fetch_and(
        rows.iter()
            .filter(|r| r.finalized_at.is_none() && r.attempt_id.is_some())
            .count()
            == 1,
        Ordering::SeqCst,
    );
    if mock.mode == "preheaders-stall" {
        return std::future::pending().await;
    }
    let fresh = req
        .headers()
        .get("authorization")
        .is_some_and(|v| v == "Bearer fresh-synthetic");
    if !fresh || mock.mode == "always-401" {
        return (StatusCode::UNAUTHORIZED, "synthetic model401").into_response();
    }
    ([ ("content-type", "text/event-stream") ],
        "event: response.output_text.delta\ndata: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture\"}\n\nevent: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"output\":[],\"usage\":{\"input_tokens\":11,\"output_tokens\":7}}}\n\n").into_response()
}

struct Harness {
    dir: TempDir,
    state: ProxyState,
    target: ResolvedTarget,
    mock: Arc<Mock>,
    server: tokio::task::JoinHandle<()>,
}
impl Drop for Harness {
    fn drop(&mut self) {
        self.server.abort();
    }
}
impl Harness {
    async fn new(provider: &str, proactive: bool, mode: &'static str) -> Self {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("fixture.db"), None).unwrap();
        let mock = Arc::new(Mock {
            store: store.clone(),
            inference: AtomicUsize::new(0),
            refresh: AtomicUsize::new(0),
            reserved: AtomicBool::new(true),
            mode,
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = axum::Router::new()
            .fallback(endpoint)
            .with_state(mock.clone());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let connection = store
            .upsert_oauth_connection(
                None,
                "fixture",
                &format!("{base}/v1"),
                provider,
                "old-synthetic",
                Some("refresh-synthetic"),
                if proactive { Some("0") } else { None },
                Some(r#"{"client_id":"oaiapp_synthetic"}"#),
                Some("fixture"),
                100,
                true,
            )
            .unwrap();
        let state = ProxyState {
            http: Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap(),
            store,
            cooldown: CooldownMap::new(),
            rr_counter: Arc::new(AtomicU64::new(0)),
            sse_stall_secs: 5,
            token_saver: false,
            token_saver_max_chars: 2000,
            provider_base_overrides: vec![(provider.into(), base.clone())],
            claude_code: crate::claude_code::ClaudeCode::new(
                Some("/nonexistent-fixture-claude".into()),
                dir.path(),
                1,
            ),
            cursor_cli: crate::cursor_cli::CursorCli::new(
                Some("/nonexistent-fixture-cursor".into()),
                dir.path(),
                1,
            ),
            refresh_transport: Some(crate::oauth_refresh::TestTransport::loopback(&base)),
            agy_transport: None,
        };
        Self {
            dir,
            state,
            target: ResolvedTarget {
                connection,
                upstream_model: "fixture".into(),
            },
            mock,
            server,
        }
    }

    async fn request(&self, proto: usize, targets: Vec<ResolvedTarget>) -> AppResult<Response> {
        let body = Bytes::from(json!({"model":"fixture","stream":true,"max_tokens":64,"messages":[{"role":"user","content":"fixture"}],"input":"fixture"}).to_string());
        let (guard, cancel) = crate::cancel::CancelOnDrop::new();
        match proto {
            0 => {
                handle_chat_with_fallback(
                    &self.state,
                    "fixture",
                    body,
                    true,
                    targets,
                    "fallback",
                    cancel,
                    guard,
                )
                .await
            }
            1 => {
                handle_anthropic_messages(
                    &self.state,
                    "fixture",
                    body,
                    true,
                    targets,
                    "fallback",
                    cancel,
                    guard,
                )
                .await
            }
            _ => {
                handle_responses(
                    &self.state,
                    "fixture",
                    body,
                    true,
                    targets,
                    "fallback",
                    cancel,
                    guard,
                )
                .await
            }
        }
    }
}

#[tokio::test]
async fn nh1_proactive_and_401_refresh_have_only_actual_inference_attempts() {
    for provider in ["siwc", "grok"] {
        for proactive in [true, false] {
            for proto in 0..3 {
                let h = Harness::new(provider, proactive, "success").await;
                let response = h.request(proto, vec![h.target.clone()]).await.unwrap();
                let wire = response.into_body().collect().await.unwrap().to_bytes();
                assert!(String::from_utf8_lossy(&wire).contains("fixture"));
                let rows = h.state.store.recent_usage(10).unwrap();
                let expected = if proactive { 1 } else { 2 };
                assert_eq!(h.mock.inference.load(Ordering::SeqCst), expected);
                assert_eq!(h.mock.refresh.load(Ordering::SeqCst), 1);
                assert!(h.mock.reserved.load(Ordering::SeqCst));
                assert_eq!(rows.len(), expected);
                let final_row = &rows[0];
                assert_eq!(final_row.outcome, "succeeded");
                assert_eq!(
                    (final_row.prompt_tokens, final_row.completion_tokens),
                    (Some(11), Some(7))
                );
                assert_eq!(final_row.usage_source, "openai_responses_v1");
                assert!(final_row.estimated_cost_usd.is_none());
                for row in &rows {
                    assert_eq!(row.request_id, final_row.request_id);
                    assert!(row.finalized_at.is_some());
                    assert!(row.headers_ms <= row.total_observed_ms);
                }
                if !proactive {
                    assert_ne!(rows[1].attempt_id, final_row.attempt_id);
                    assert_eq!(rows[1].status, Some(401));
                    assert_eq!(rows[1].outcome, "failed");
                    assert!(rows[1].prompt_tokens.is_none() && rows[1].first_output_ms.is_none());
                }
                let stored = h
                    .state
                    .store
                    .get_connection(&h.target.connection.id)
                    .unwrap()
                    .unwrap()
                    .oauth
                    .unwrap();
                assert_eq!(stored.refresh_token.as_deref(), Some("rotated-synthetic"));
            }
        }
    }
}

#[tokio::test]
async fn nh1_refresh_failure_and_second401_do_not_add_retries_or_usage() {
    for provider in ["siwc", "grok"] {
        for mode in ["refresh-fails", "always-401"] {
            let h = Harness::new(provider, false, mode).await;
            assert_eq!(
                h.request(0, vec![h.target.clone()])
                    .await
                    .unwrap_err()
                    .status_code(),
                401
            );
            let expected = if mode == "refresh-fails" { 1 } else { 2 };
            assert_eq!(h.mock.inference.load(Ordering::SeqCst), expected);
            assert_eq!(h.mock.refresh.load(Ordering::SeqCst), 1);
            let rows = h.state.store.recent_usage(10).unwrap();
            assert_eq!(rows.len(), expected);
            for row in &rows {
                assert_eq!(row.status, Some(401));
                assert_eq!(row.outcome, "failed");
                assert!(row.prompt_tokens.is_none() && row.estimated_cost_usd.is_none());
                assert_eq!(row.request_id, rows[0].request_id);
            }
        }
    }
}

#[tokio::test]
async fn nh4_failed_reservation_prevents_retry_and_route_fallback() {
    for fail_first in [true, false] {
        let h = Harness::new("siwc", false, "success").await;
        let sql = rusqlite::Connection::open(h.dir.path().join("fixture.db")).unwrap();
        sql.execute_batch(&format!("CREATE TRIGGER fixture_reserve BEFORE INSERT ON usage_events WHEN {} BEGIN SELECT RAISE(FAIL, 'synthetic reserve failure'); END;",if fail_first {"1"} else {"EXISTS (SELECT 1 FROM usage_events)"})).unwrap();
        let error = h
            .request(0, vec![h.target.clone(), h.target.clone()])
            .await
            .unwrap_err();
        assert_eq!(error.status_code(), 503);
        assert_eq!(
            h.mock.inference.load(Ordering::SeqCst),
            usize::from(!fail_first)
        );
        assert_eq!(
            h.mock.refresh.load(Ordering::SeqCst),
            usize::from(!fail_first)
        );
        assert_eq!(
            h.state.store.recent_usage(10).unwrap().len(),
            usize::from(!fail_first)
        );
    }
}

#[tokio::test]
async fn nh4_finalization_failure_recovers_once_without_replay() {
    let h = Harness::new("grok", true, "success").await;
    let sql = rusqlite::Connection::open(h.dir.path().join("fixture.db")).unwrap();
    sql.execute_batch("CREATE TRIGGER fixture_finalize BEFORE UPDATE OF finalized_at ON usage_events BEGIN SELECT RAISE(FAIL, 'synthetic finalization failure'); END;").unwrap();
    h.request(2, vec![h.target.clone()])
        .await
        .unwrap()
        .into_body()
        .collect()
        .await
        .unwrap();
    assert_eq!(h.mock.inference.load(Ordering::SeqCst), 1);
    assert!(h.state.store.recent_usage(10).unwrap()[0]
        .finalized_at
        .is_none());
    sql.execute_batch("DROP TRIGGER fixture_finalize;").unwrap();
    let reopened = Store::open(&h.dir.path().join("fixture.db"), None).unwrap();
    assert_eq!(reopened.recover_stream_attempts().unwrap(), 1);
    assert_eq!(reopened.recover_stream_attempts().unwrap(), 0);
    let rows = reopened.recent_usage(10).unwrap();
    assert_eq!(rows[0].outcome, "interrupted");
    assert!(rows[0].prompt_tokens.is_none() && rows[0].total_observed_ms.is_none());
    assert_eq!(h.mock.inference.load(Ordering::SeqCst), 1);
}

fn raw_attempt(h: &Harness) -> crate::stream_usage::StreamAttempt {
    crate::stream_usage::StreamAttempt::begin_http(
        &h.state.store,
        "generated-fixture-request",
        "fixture",
        &h.target,
        b"{}",
        crate::stream_usage::HttpUsageFormat::Responses,
        false,
    )
    .unwrap()
}
fn complete_frame() -> &'static str {
    "event: response.completed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":11,\"output_tokens\":7}}}\n\n"
}

#[tokio::test]
async fn nh3_native_rejection_and_terminal_settle_before_yield_without_lookahead() {
    for bad in [false, true] {
        let h = Harness::new("siwc", false, "success").await;
        let first = if bad {
            "event: response.failed\ndata: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\"}}\n\n"
        } else {
            complete_frame()
        };
        let raw = format!("{first}{}", complete_frame().replace("11", "999"));
        let source = futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from(raw))]);
        let response = stream_body_observed(
            source,
            5,
            StreamMode::NativeResponses,
            Some(raw_attempt(&h)),
        )
        .await
        .unwrap();
        let mut body = response.into_body();
        assert!(body.frame().await.unwrap().is_ok());
        let rows = h.state.store.recent_usage(10).unwrap();
        assert!(
            rows[0].finalized_at.is_some(),
            "settlement before terminal output"
        );
        assert_eq!(rows[0].outcome, if bad { "failed" } else { "succeeded" });
        assert_eq!(rows[0].prompt_tokens, if bad { None } else { Some(11) });
        drop(body);
        assert_eq!(
            h.state.store.recent_usage(10).unwrap()[0].finalized_at,
            rows[0].finalized_at
        );
    }
}

#[tokio::test]
async fn nh3_native_unpolled_drop_cr_terminal_and_truncation_settle_once() {
    for case in ["unpolled", "cr-eof", "cr-read", "truncated"] {
        let h = Harness::new("grok", false, "success").await;
        let raw = if case == "truncated" {
            "data: {\"type\":\"response.output_text.delta\",\"delta\":\"fixture\"}\n\n".into()
        } else {
            complete_frame().replace('\n', "\r")
        };
        let mut chunks = vec![Ok::<_, std::io::Error>(Bytes::from(raw))];
        if case == "cr-read" {
            chunks.push(Err(std::io::Error::other("synthetic-read")));
        }
        let response = stream_body_observed(
            futures_util::stream::iter(chunks),
            5,
            StreamMode::NativeResponses,
            Some(raw_attempt(&h)),
        )
        .await
        .unwrap();
        if case == "unpolled" {
            drop(response);
        } else {
            response.into_body().collect().await.unwrap();
        }
        let rows = h.state.store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 1);
        assert!(rows[0].finalized_at.is_some());
        assert_eq!(
            rows[0].outcome,
            match case {
                "unpolled" => "cancelled",
                "truncated" => "failed",
                _ => "succeeded",
            }
        );
        if case.starts_with("cr-") {
            assert_eq!(rows[0].prompt_tokens, Some(11));
            assert_eq!(rows[0].usage_status, "complete");
        }
    }
}

#[tokio::test]
async fn nh3_responses_converter_failure_cannot_consume_later_success() {
    for mode in [
        StreamMode::ResponsesToChat("fixture".into()),
        StreamMode::ResponsesToAnthropic("fixture".into()),
    ] {
        let h = Harness::new("grok", false, "success").await;
        let mut raw = String::new();
        // Every unique function item retains an item-id and output-index entry.
        for i in 0..=2048 {
            raw.push_str(&format!("data: {}\n\n",json!({"type":"response.output_item.added","output_index":i,"item":{"type":"function_call","id":format!("fixture{i}"),"call_id":format!("call{i}"),"name":"fixture","arguments":""}})));
        }
        raw.push_str(complete_frame());
        let response = stream_body_observed(
            futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from(raw))]),
            5,
            mode,
            Some(raw_attempt(&h)),
        )
        .await
        .unwrap();
        let mut body = response.into_body();
        assert!(body.frame().await.unwrap().is_ok());
        let row = &h.state.store.recent_usage(10).unwrap()[0];
        assert!(row.finalized_at.is_some());
        assert_eq!(row.outcome, "failed");
        assert_eq!(row.error.as_deref(), Some("stream_conversion_failed"));
        assert!(
            row.prompt_tokens.is_none(),
            "later success usage must not be consumed"
        );
    }
}

#[tokio::test]
async fn nh3_named_preheaders_timeout_and_cancel_have_one_unknown_usage_attempt() {
    for cancel in [false, true] {
        let mut h = Harness::new("grok", true, "preheaders-stall").await;
        h.state.http = Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_millis(250))
            .build()
            .unwrap();
        if cancel {
            {
                let request = h.request(2, vec![h.target.clone()]);
                tokio::pin!(request);
                tokio::select! {
                    result = &mut request => panic!("unexpected completion: {result:?}"),
                    _ = tokio::time::timeout(Duration::from_secs(2), async {
                        while h.mock.inference.load(Ordering::SeqCst) == 0 {
                            tokio::time::sleep(Duration::from_millis(1)).await;
                        }
                    }) => assert_eq!(h.mock.inference.load(Ordering::SeqCst), 1),
                }
                // Dropping the handler future models a disconnected client before headers.
            }
        } else {
            assert_eq!(
                h.request(2, vec![h.target.clone()])
                    .await
                    .unwrap_err()
                    .status_code(),
                502
            );
        }
        assert_eq!(h.mock.inference.load(Ordering::SeqCst), 1);
        let rows = h.state.store.recent_usage(10).unwrap();
        assert_eq!(rows.len(), 1);
        let row = &rows[0];
        assert_eq!(row.outcome, if cancel { "cancelled" } else { "timeout" });
        assert!(row.status.is_none() && row.headers_ms.is_none() && row.first_output_ms.is_none());
        assert!(row.total_observed_ms.is_some() && row.finalized_at.is_some());
        assert!(row.prompt_tokens.is_none() && row.completion_tokens.is_none());
    }
}

#[tokio::test]
async fn nh1_unchanged_borrowed401_does_not_refresh_retry_or_write_file() {
    let mut h = Harness::new("grok", false, "always-401").await;
    let parent = h.dir.path().join(".grok");
    std::fs::create_dir(&parent).unwrap();
    let path = parent.join("auth.json");
    let contents = r#"{"synthetic":{"key":"borrowed-synthetic"}}"#;
    std::fs::write(&path, contents).unwrap();
    h.target.connection.oauth.as_mut().unwrap().meta = Some(json!({"source":path}).to_string());
    assert_eq!(
        h.request(0, vec![h.target.clone()])
            .await
            .unwrap_err()
            .status_code(),
        401
    );
    assert_eq!(h.mock.inference.load(Ordering::SeqCst), 1);
    assert_eq!(h.mock.refresh.load(Ordering::SeqCst), 0);
    assert_eq!(std::fs::read_to_string(path).unwrap(), contents);
    let rows = h.state.store.recent_usage(10).unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].outcome, "failed");
    assert_eq!(rows[0].status, Some(401));
    assert!(rows[0].finalized_at.is_some() && rows[0].prompt_tokens.is_none());
}

#[tokio::test]
async fn nh3_converted_bom_line_does_not_override_actual_consumed_terminal() {
    for mode in [
        StreamMode::ResponsesToChat("fixture".into()),
        StreamMode::ResponsesToAnthropic("fixture".into()),
    ] {
        let h = Harness::new("grok", false, "success").await;
        let first = "\u{feff}data: {\"type\":\"response.completed\",\"response\":{\"status\":\"completed\",\"usage\":{\"input_tokens\":11,\"output_tokens\":7}}}\n\n";
        let raw = format!(
            "{first}{}",
            complete_frame().replace("11", "99").replace("7", "88")
        );
        let response = stream_body_observed(
            futures_util::stream::iter([Ok::<_, std::io::Error>(Bytes::from(raw))]),
            5,
            mode,
            Some(raw_attempt(&h)),
        )
        .await
        .unwrap();
        response.into_body().collect().await.unwrap();
        let row = &h.state.store.recent_usage(10).unwrap()[0];
        assert_eq!(row.outcome, "succeeded");
        assert_eq!(
            (row.prompt_tokens, row.completion_tokens),
            (Some(99), Some(88))
        );
        assert!(row.first_output_ms.is_none());
    }
}

#[tokio::test]
async fn nh1_named_allowlist_preflight_does_not_create_an_inference_attempt() {
    let mut h = Harness::new("siwc", false, "success").await;
    h.target.connection.base_url = "https://unapproved.invalid/v1".into();
    assert_eq!(
        h.request(2, vec![h.target.clone()])
            .await
            .unwrap_err()
            .status_code(),
        500
    );
    assert_eq!(h.mock.inference.load(Ordering::SeqCst), 0);
    assert_eq!(h.mock.refresh.load(Ordering::SeqCst), 0);
    assert!(h.state.store.recent_usage(10).unwrap().is_empty());
}

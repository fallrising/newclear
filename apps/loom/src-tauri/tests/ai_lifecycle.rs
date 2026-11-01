use loom_core::ai::config::AiSettings;
use loom_core::ai::{AiChunk, AiError, AiService};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;

fn service(base: &str) -> Arc<AiService> {
    Arc::new(AiService::with_settings(
        AiSettings::resolve(|name| match name {
            "LOOM_AI_PROVIDER" => Some("openai".into()),
            "LOOM_AI_BASE_URL" => Some(base.into()),
            "OPENAI_API_KEY" => Some("synthetic-test-key".into()),
            _ => None,
        })
        .unwrap(),
    ))
}

async fn listener() -> (TcpListener, Arc<AiService>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let svc = service(&format!("http://{}", listener.local_addr().unwrap()));
    (listener, svc)
}

#[tokio::test]
async fn cancellation_before_first_poll_prevents_http_and_output() {
    let (listener, svc) = listener().await;
    let events = Arc::new(Mutex::new(Vec::new()));
    let sink = events.clone();
    let request = svc.run("early".into(), "prompt".into(), None, vec![], move |e| {
        sink.lock().unwrap().push(e);
    });
    assert!(
        svc.cancel("early"),
        "request must register before first poll"
    );
    assert!(matches!(request.await, Err(AiError::Cancelled(id)) if id == "early"));
    assert!(events.lock().unwrap().is_empty());
    assert!(!svc.cancel("early"));
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn aborting_running_future_releases_its_registration() {
    let (listener, svc) = listener().await;
    let runner = svc.clone();
    let task = tokio::spawn(async move {
        runner
            .run("aborted".into(), "prompt".into(), None, vec![], |_| {})
            .await
    });
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
        .await
        .unwrap()
        .unwrap();
    task.abort();
    assert!(task.await.unwrap_err().is_cancelled());
    assert!(
        !svc.cancel("aborted"),
        "aborted future leaked its registration"
    );
}

#[tokio::test]
async fn admitted_request_and_unpolled_futures_release_ownership_on_drop() {
    let (_listener, svc) = listener().await;
    let admitted = svc.admit("drop".into()).unwrap();
    assert!(svc.cancel("drop"));
    drop(admitted);
    assert!(!svc.cancel("drop"));

    let future = svc
        .admit("drop".into())
        .unwrap()
        .run("prompt".into(), None, vec![], |_| {});
    assert!(svc.cancel("drop"));
    drop(future);
    assert!(!svc.cancel("drop"));

    let future = svc.run("drop".into(), "prompt".into(), None, vec![], |_| {});
    assert!(svc.cancel("drop"));
    drop(future);
    assert!(!svc.cancel("drop"));
}

#[tokio::test]
async fn duplicate_admission_does_not_replace_or_cancel_original() {
    let (listener, svc) = listener().await;
    let original = svc.admit("same".into()).unwrap();
    assert!(matches!(svc.admit("same".into()), Err(AiError::DuplicateRequest(id)) if id == "same"));
    let task = tokio::spawn(original.run("prompt".into(), None, vec![], |_| {}));
    // The original still starts HTTP; rejecting its duplicate did not cancel it.
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
        .await
        .unwrap()
        .unwrap();
    assert!(svc.cancel("same"));
    assert!(matches!(
        svc.admit("same".into()),
        Err(AiError::DuplicateRequest(_))
    ));
    assert!(matches!(task.await.unwrap(), Err(AiError::Cancelled(id)) if id == "same"));
    assert!(!svc.cancel("same"));
    let replacement = svc.admit("same".into()).unwrap();
    assert!(svc.cancel("same"));
    drop(replacement);
    assert!(!svc.cancel("same"));
}

#[tokio::test]
async fn cancelling_one_request_preserves_another_and_reused_ids() {
    let (listener, svc) = listener().await;
    let first = svc.admit("first".into()).unwrap();
    let second = svc.admit("second".into()).unwrap();
    assert!(svc.cancel("first"));
    assert!(matches!(
        first.run("prompt".into(), None, vec![], |_| {}).await,
        Err(AiError::Cancelled(_))
    ));
    let replacement = svc.admit("first".into()).unwrap();
    let task = tokio::spawn(second.run("prompt".into(), None, vec![], |_| {}));
    let (_socket, _) = tokio::time::timeout(Duration::from_secs(2), listener.accept())
        .await
        .unwrap()
        .unwrap();
    assert!(svc.cancel("second"));
    assert!(matches!(task.await.unwrap(), Err(AiError::Cancelled(_))));
    assert!(!svc.cancel("second"));
    assert!(svc.cancel("first"));
    drop(replacement);
    assert!(!svc.cancel("first"));
}

#[tokio::test]
async fn duplicate_legacy_run_does_not_release_original_registration() {
    let (_listener, svc) = listener().await;
    let original = svc.run("same".into(), "prompt".into(), None, vec![], |_| {});
    let duplicate = svc.run("same".into(), "prompt".into(), None, vec![], |_| {});
    assert!(matches!(duplicate.await, Err(AiError::DuplicateRequest(_))));
    assert!(svc.cancel("same"));
    assert!(matches!(original.await, Err(AiError::Cancelled(_))));
    assert!(!svc.cancel("same"));
}

#[tokio::test]
async fn explicit_admission_honors_cancellation_before_execution() {
    let (listener, svc) = listener().await;
    let request = svc.admit("admitted".into()).unwrap();
    assert!(svc.cancel("admitted"));
    assert!(matches!(
        request
            .run("prompt".into(), None, vec![], |_| panic!(
                "cancelled admission emitted output"
            ))
            .await,
        Err(AiError::Cancelled(_))
    ));
    assert!(!svc.cancel("admitted"));
    assert!(
        tokio::time::timeout(Duration::from_millis(50), listener.accept())
            .await
            .is_err()
    );
}

#[tokio::test]
async fn configuration_errors_release_admission_without_emitting_started() {
    let svc = AiService::with_settings(AiSettings::resolve(|_| None).unwrap());
    let request = svc.admit("invalid".into()).unwrap();
    assert!(matches!(
        request
            .run("prompt".into(), None, vec![], |_| panic!(
                "invalid configuration emitted output"
            ))
            .await,
        Err(AiError::MissingApiKey)
    ));
    assert!(!svc.cancel("invalid"));
    drop(svc.admit("invalid".into()).unwrap());
}

#[tokio::test]
async fn terminal_success_and_error_release_registration_and_allow_reuse() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (listener, svc) = listener().await;
    let server = tokio::spawn(async move {
        for (status, body) in [
            (200, "data: {\"choices\":[{\"delta\":{\"content\":\"hello\"}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2}}\n\ndata: [DONE]\n\n"),
            (401, "synthetic-test-key rejected"),
            (200, "data: [DONE]\n\n"),
        ] {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buffer = [0; 4096];
            assert!(socket.read(&mut buffer).await.unwrap() > 0);
            socket.write_all(format!("HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
        }
    });
    for index in 0..3 {
        let events = Arc::new(Mutex::new(Vec::new()));
        let sink = events.clone();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            svc.admit("reuse".into())
                .unwrap()
                .run("prompt".into(), None, vec![], move |event| {
                    sink.lock().unwrap().push(event)
                }),
        )
        .await
        .unwrap();
        let events = events.lock().unwrap();
        assert!(matches!(events.first(), Some(AiChunk::Started { .. })));
        if index == 1 {
            let error = result.unwrap_err();
            assert!(matches!(error, AiError::Api { status: 401, .. }));
            assert!(!error.to_string().contains("synthetic-test-key"));
            assert!(!events
                .iter()
                .any(|event| matches!(event, AiChunk::Done { .. })));
        } else {
            result.unwrap();
            assert_eq!(
                events
                    .iter()
                    .filter(|event| matches!(event, AiChunk::Done { .. }))
                    .count(),
                1
            );
            if index == 0 {
                assert!(matches!(&events[1], AiChunk::Text { delta, .. } if delta == "hello"));
                assert!(
                    matches!(events.last(), Some(AiChunk::Done { usage, .. }) if usage.input_tokens == 3 && usage.output_tokens == 2)
                );
            }
        }
        assert!(!svc.cancel("reuse"));
    }
    server.await.unwrap();
}

#[tokio::test]
async fn done_commits_completion_before_callback_and_old_cleanup_preserves_reuse() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (listener, svc) = listener().await;
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut buffer = [0; 4096];
        assert!(socket.read(&mut buffer).await.unwrap() > 0);
        let body = "data: [DONE]\n\n";
        socket.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).as_bytes()).await.unwrap();
    });
    let callback_service = svc.clone();
    let replacement = Arc::new(Mutex::new(None));
    let callback_replacement = replacement.clone();
    tokio::time::timeout(
        Duration::from_secs(2),
        svc.run("same".into(), "prompt".into(), None, vec![], move |event| {
            if matches!(event, AiChunk::Done { .. }) {
                assert!(
                    !callback_service.cancel("same"),
                    "successful terminal must commit before invoking its callback"
                );
                *callback_replacement.lock().unwrap() =
                    Some(callback_service.admit("same".into()).unwrap());
            }
        }),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(
        svc.cancel("same"),
        "old cleanup removed the replacement registration"
    );
    drop(replacement.lock().unwrap().take().unwrap());
    assert!(!svc.cancel("same"));
    server.await.unwrap();
}

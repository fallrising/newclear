//! Bounds for successful non-stream bodies and shared Claude/Cursor transcripts.
use bytes::Bytes;
use futures_util::{Stream, StreamExt};
use tokio_util::sync::CancellationToken;

use crate::error::{AppError, AppResult};

pub(crate) const MAX_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const MAX_RECORDS: usize = 65_536;
pub(crate) const LIMIT_MESSAGE: &str = "upstream response collection limit exceeded";

fn limit_error() -> AppError {
    AppError::Upstream {
        status: 502,
        body: LIMIT_MESSAGE.into(),
    }
}

/// Count received bytes, never a declared Content-Length. The source and partial
/// buffer are owned here and dropped before any error reaches the caller.
pub(crate) async fn body<S, E>(source: S, cancel: &CancellationToken) -> AppResult<Bytes>
where
    S: Stream<Item = Result<Bytes, E>>,
    E: std::fmt::Display,
{
    let mut source = Box::pin(source);
    let mut out = Vec::new();
    loop {
        let next = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(AppError::BadRequest("client disconnected".into())),
            next = source.next() => next,
        };
        let Some(chunk) = next else {
            return Ok(Bytes::from(out));
        };
        let chunk =
            chunk.map_err(|e| AppError::Internal(anyhow::anyhow!("read upstream body: {e}")))?;
        if chunk.len() > MAX_BYTES - out.len() {
            return Err(limit_error());
        }
        let required = out.len() + chunk.len();
        if required > out.capacity() {
            let capacity = required
                .max(out.capacity().saturating_mul(2))
                .min(MAX_BYTES);
            out.reserve_exact(capacity - out.len());
        }
        out.extend_from_slice(&chunk);
    }
}

// Credential/metadata envelope, independent of model output and diagnostics.
pub(crate) const MAX_TOKEN_BYTES: usize = 1024 * 1024;
pub(crate) const TOKEN_LIMIT_MESSAGE: &str = "token response body exceeds 1 MiB";

#[derive(Debug, thiserror::Error)]
pub(crate) enum TokenBodyError {
    #[error("{TOKEN_LIMIT_MESSAGE}")]
    TooLarge,
    #[error("token response body read failed")]
    Read,
}

/// Own the source and partial buffer, including while pending. Never parse a
/// prefix or use Content-Length; dropping this future also drops its source.
pub(crate) async fn token_body<S, E>(source: S) -> Result<Bytes, TokenBodyError>
where
    S: Stream<Item = Result<Bytes, E>>,
{
    let mut source = Box::pin(source);
    let mut out = Vec::new();
    while let Some(chunk) = source.next().await {
        let chunk = chunk.map_err(|_| TokenBodyError::Read)?;
        if chunk.len() > MAX_TOKEN_BYTES - out.len() {
            return Err(TokenBodyError::TooLarge);
        }
        let required = out.len() + chunk.len();
        if required > out.capacity() {
            let capacity = required
                .max(out.capacity().saturating_mul(2))
                .min(MAX_TOKEN_BYTES);
            out.reserve_exact(capacity - out.len());
        }
        out.extend_from_slice(&chunk);
    }
    Ok(Bytes::from(out))
}

pub(crate) const MAX_DIAGNOSTIC_BYTES: usize = 64 * 1024;
pub(crate) const DIAGNOSTIC_LIMIT_MESSAGE: &str = "upstream error body exceeds 64 KiB";

pub(crate) enum DiagnosticBody {
    Complete(Bytes),
    TooLarge,
}
impl DiagnosticBody {
    pub(crate) fn into_text(self) -> String {
        match self {
            Self::Complete(bytes) => String::from_utf8_lossy(&bytes).into_owned(),
            Self::TooLarge => DIAGNOSTIC_LIMIT_MESSAGE.into(),
        }
    }
}

/// Bound raw diagnostics before decoding/parsing. Read failures keep the old
/// empty-body fallback; an oversize body is replaced in full, never truncated.
pub(crate) async fn diagnostic<S, E>(source: S) -> DiagnosticBody
where
    S: Stream<Item = Result<Bytes, E>>,
{
    let mut source = Box::pin(source);
    let mut out = Vec::new();
    while let Some(chunk) = source.next().await {
        let Ok(chunk) = chunk else {
            return DiagnosticBody::Complete(Bytes::new());
        };
        if chunk.len() > MAX_DIAGNOSTIC_BYTES - out.len() {
            return DiagnosticBody::TooLarge;
        }
        let required = out.len() + chunk.len();
        if required > out.capacity() {
            let capacity = required
                .max(out.capacity().saturating_mul(2))
                .min(MAX_DIAGNOSTIC_BYTES);
            out.reserve_exact(capacity - out.len());
        }
        out.extend_from_slice(&chunk);
    }
    DiagnosticBody::Complete(Bytes::from(out))
}

pub(crate) async fn diagnostic_text(resp: reqwest::Response) -> String {
    diagnostic(resp.bytes_stream()).await.into_text()
}

#[derive(Default)]
pub(crate) struct Records {
    bytes: usize,
    records: Vec<String>,
}
impl Records {
    pub(crate) fn push(&mut self, record: String) -> AppResult<()> {
        let charge = record.len().checked_add(2).ok_or_else(limit_error)?;
        if self.records.len() == MAX_RECORDS || charge > MAX_BYTES - self.bytes {
            return Err(limit_error());
        }
        self.bytes += charge;
        self.records.push(record);
        Ok(())
    }
    pub(crate) fn as_slice(&self) -> &[String] {
        &self.records
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        pin::Pin,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        task::{Context, Poll},
    };

    // Retains ownership even after returning None: verifies actual destruction.
    struct Source {
        chunks: VecDeque<Result<Bytes, std::io::Error>>,
        pending: bool,
        dropped: Arc<AtomicBool>,
    }
    impl Stream for Source {
        type Item = Result<Bytes, std::io::Error>;
        fn poll_next(mut self: Pin<&mut Self>, _: &mut Context<'_>) -> Poll<Option<Self::Item>> {
            match self.chunks.pop_front() {
                Some(item) => Poll::Ready(Some(item)),
                None if self.pending => Poll::Pending,
                None => Poll::Ready(None),
            }
        }
    }
    impl Drop for Source {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }
    fn source(
        chunks: Vec<Result<Bytes, std::io::Error>>,
        pending: bool,
    ) -> (Source, Arc<AtomicBool>) {
        let dropped = Arc::new(AtomicBool::new(false));
        (
            Source {
                chunks: chunks.into(),
                pending,
                dropped: dropped.clone(),
            },
            dropped,
        )
    }
    #[tokio::test]
    async fn tk1_token_boundaries_release_and_errors() {
        for size in [
            0,
            1,
            MAX_TOKEN_BYTES - 1,
            MAX_TOKEN_BYTES,
            MAX_TOKEN_BYTES + 1,
        ] {
            for fragmented in [false, true] {
                let bytes = Bytes::from(vec![b'x'; size]);
                let chunks = if fragmented {
                    bytes
                        .chunks(4093)
                        .map(|b| Ok(Bytes::copy_from_slice(b)))
                        .collect()
                } else {
                    vec![Ok(bytes.clone())]
                };
                let (source, dropped) = source(chunks, size > MAX_TOKEN_BYTES);
                let result =
                    tokio::time::timeout(std::time::Duration::from_secs(1), token_body(source))
                        .await
                        .unwrap();
                assert!(dropped.load(Ordering::SeqCst));
                if size > MAX_TOKEN_BYTES {
                    assert!(matches!(result, Err(TokenBodyError::TooLarge)));
                } else {
                    assert_eq!(result.unwrap(), bytes);
                }
            }
        }
        let (source, dropped) = source(
            vec![
                Ok(Bytes::from_static(b"partial-secret")),
                Err(std::io::Error::other("PRIVATE_READ")),
            ],
            false,
        );
        let error = token_body(source).await.unwrap_err();
        assert_eq!(error.to_string(), "token response body read failed");
        assert!(dropped.load(Ordering::SeqCst));
        let text = "令牌".as_bytes();
        let (source, dropped) = self::source(
            text.iter()
                .map(|b| Ok(Bytes::copy_from_slice(&[*b])))
                .collect(),
            false,
        );
        assert_eq!(token_body(source).await.unwrap().as_ref(), text);
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn tk1_token_pending_future_drop_releases_source() {
        for size in [0, MAX_TOKEN_BYTES] {
            let (source, dropped) = source(vec![Ok(Bytes::from(vec![b' '; size]))], true);
            let mut read = Box::pin(token_body(source));
            assert!(futures_util::poll!(&mut read).is_pending());
            assert!(!dropped.load(Ordering::SeqCst));
            drop(read);
            assert!(dropped.load(Ordering::SeqCst));
        }
    }

    fn assert_limit(e: AppError) {
        match e {
            AppError::Upstream { status: 502, body } => assert_eq!(body, LIMIT_MESSAGE),
            other => panic!("{other:?}"),
        }
    }
    #[tokio::test]
    async fn dg1_diagnostic_boundaries_drop_and_decoding() {
        for size in [
            0,
            1,
            MAX_DIAGNOSTIC_BYTES - 1,
            MAX_DIAGNOSTIC_BYTES,
            MAX_DIAGNOSTIC_BYTES + 1,
        ] {
            for fragmented in [false, true] {
                let bytes = Bytes::from(vec![b'x'; size]);
                let chunks = if fragmented {
                    bytes
                        .chunks(4093)
                        .map(|b| Ok(Bytes::copy_from_slice(b)))
                        .collect()
                } else {
                    vec![Ok(bytes)]
                };
                let (source, dropped) = source(chunks, size > MAX_DIAGNOSTIC_BYTES);
                let result =
                    tokio::time::timeout(std::time::Duration::from_secs(1), diagnostic(source))
                        .await
                        .unwrap();
                assert!(dropped.load(Ordering::SeqCst));
                if size > MAX_DIAGNOSTIC_BYTES {
                    assert_eq!(result.into_text(), DIAGNOSTIC_LIMIT_MESSAGE);
                } else {
                    assert_eq!(result.into_text(), "x".repeat(size));
                }
            }
        }
        for chunks in [
            vec![
                Ok(Bytes::from_static(&[0xc3])),
                Ok(Bytes::from_static(&[0xa9])),
            ],
            vec![Ok(Bytes::from_static(&[0xff]))],
        ] {
            let bytes: Vec<_> = chunks
                .iter()
                .flat_map(|r| r.as_ref().unwrap().iter().copied())
                .collect();
            let (source, dropped) = source(chunks, false);
            assert_eq!(
                diagnostic(source).await.into_text(),
                String::from_utf8_lossy(&bytes)
            );
            assert!(dropped.load(Ordering::SeqCst));
        }
        let (source, dropped) = source(
            vec![
                Ok(Bytes::from_static(b"PRIVATE_PARTIAL")),
                Err(std::io::Error::other("PRIVATE_READ")),
            ],
            true,
        );
        assert_eq!(diagnostic(source).await.into_text(), "");
        assert!(dropped.load(Ordering::SeqCst));
    }

    #[tokio::test]
    async fn bc1_http_actual_byte_boundaries_release_source() {
        for size in [0, 7, MAX_BYTES - 1, MAX_BYTES, MAX_BYTES + 1] {
            for fragmented in [false, true] {
                let bytes = Bytes::from(vec![b'x'; size]);
                let chunks = if fragmented {
                    bytes
                        .chunks(65_537)
                        .map(|b| Ok(Bytes::copy_from_slice(b)))
                        .collect()
                } else {
                    vec![Ok(bytes)]
                };
                let (source, dropped) = source(chunks, size > MAX_BYTES);
                let result = tokio::time::timeout(
                    std::time::Duration::from_secs(2),
                    body(source, &CancellationToken::new()),
                )
                .await
                .unwrap();
                assert!(dropped.load(Ordering::SeqCst));
                if size > MAX_BYTES {
                    assert_limit(result.unwrap_err());
                } else {
                    assert_eq!(result.unwrap(), vec![b'x'; size]);
                }
            }
        }
    }
    #[tokio::test]
    async fn bc3_body_cancellation_and_read_errors_preserved() {
        for pre_cancel in [true, false] {
            let cancel = CancellationToken::new();
            let (source, dropped) = source(vec![Ok(Bytes::from_static(b"partial"))], true);
            if pre_cancel {
                cancel.cancel();
            }
            let future = body(source, &cancel);
            tokio::pin!(future);
            if !pre_cancel {
                assert!(futures_util::poll!(&mut future).is_pending());
                cancel.cancel();
            }
            assert!(
                matches!(future.await,Err(AppError::BadRequest(s)) if s == "client disconnected")
            );
            assert!(dropped.load(Ordering::SeqCst));
        }
        let (source, dropped) = source(
            vec![
                Ok(Bytes::from_static(b"partial")),
                Err(std::io::Error::other("fixture read error")),
            ],
            true,
        );
        assert!(
            matches!(body(source,&CancellationToken::new()).await,Err(AppError::Internal(e)) if e.to_string() == "read upstream body: fixture read error")
        );
        assert!(dropped.load(Ordering::SeqCst));
    }
    #[test]
    fn bc2_records_count_utf8_framing_and_empty_entries() {
        let mut records = Records::default();
        records.push("é".repeat((MAX_BYTES - 2) / 2)).unwrap();
        assert_eq!(records.bytes, MAX_BYTES);
        assert_limit(records.push(String::new()).unwrap_err());
        assert_eq!(records.as_slice().len(), 1);
        let mut records = Records::default();
        for _ in 0..MAX_RECORDS {
            records.push(String::new()).unwrap();
        }
        assert_eq!(records.bytes, 2 * MAX_RECORDS);
        assert_limit(records.push(String::new()).unwrap_err());
        assert_eq!(records.as_slice().len(), MAX_RECORDS);
    }
}

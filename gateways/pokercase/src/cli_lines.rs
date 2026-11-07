//! Cancellation-safe raw stdout line bounds for the CLI producers.
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub(crate) const MAX_LINE_BYTES: usize = 16 * 1024 * 1024;
pub(crate) const LIMIT_MESSAGE: &str = "CLI stdout record exceeds 16 MiB";

#[derive(Debug, PartialEq)]
pub(crate) enum LineError {
    TooLarge,
    Read,
}

pub(crate) struct Lines<R> {
    source: R,
    partial: Vec<u8>,
    finished: bool,
}
impl<R: AsyncBufRead + Unpin> Lines<R> {
    pub(crate) fn new(source: R) -> Self {
        Self {
            source,
            partial: Vec::new(),
            finished: false,
        }
    }

    /// Partial bytes live on self, not the future: select! cancellation cannot
    /// lose consumed input. LF is a delimiter; CR counts toward the raw limit.
    pub(crate) async fn next_line(&mut self) -> Result<Option<String>, LineError> {
        if self.finished {
            return Ok(None);
        }
        loop {
            let data = match self.source.fill_buf().await {
                Ok(data) => data,
                Err(_) => {
                    self.finished = true;
                    self.partial = Vec::new();
                    return Err(LineError::Read);
                }
            };
            if data.is_empty() {
                self.finished = true;
                return if self.partial.is_empty() {
                    Ok(None)
                } else {
                    self.finish_line(false)
                };
            }
            let lf = data.iter().position(|b| *b == b'\n');
            let n = lf.unwrap_or(data.len());
            if n > MAX_LINE_BYTES - self.partial.len() {
                self.finished = true;
                self.partial = Vec::new();
                return Err(LineError::TooLarge);
            }
            let required = self.partial.len() + n;
            if required > self.partial.capacity() {
                let capacity = required
                    .max(self.partial.capacity().saturating_mul(2))
                    .min(MAX_LINE_BYTES);
                self.partial.reserve_exact(capacity - self.partial.len());
            }
            self.partial.extend_from_slice(&data[..n]);
            self.source.consume(n + usize::from(lf.is_some()));
            if lf.is_some() {
                return self.finish_line(true);
            }
        }
    }

    fn finish_line(&mut self, terminated: bool) -> Result<Option<String>, LineError> {
        let mut bytes = std::mem::take(&mut self.partial);
        if terminated && bytes.last() == Some(&b'\r') {
            bytes.pop();
        }
        match String::from_utf8(bytes) {
            Ok(line) => Ok(Some(line)),
            Err(_) => {
                self.finished = true;
                Err(LineError::Read)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        pin::Pin,
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        task::{Context, Poll},
    };
    use tokio::io::{AsyncRead, AsyncWriteExt, BufReader, ReadBuf};

    struct Witness<R> {
        inner: R,
        dropped: Arc<AtomicBool>,
    }
    impl<R: AsyncRead + Unpin> AsyncRead for Witness<R> {
        fn poll_read(
            mut self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            buf: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            Pin::new(&mut self.inner).poll_read(cx, buf)
        }
    }
    impl<R> Drop for Witness<R> {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }

    #[tokio::test]
    async fn lb1_lb2_line_boundaries_and_compatibility() {
        // Raw size includes CR, excluding LF. Exercise fragmented and single reads.
        for raw_size in [0, 1, MAX_LINE_BYTES - 1, MAX_LINE_BYTES, MAX_LINE_BYTES + 1] {
            for ending in ["lf", "crlf", "eof"] {
                if raw_size == 0 && ending == "crlf" {
                    continue;
                }
                for capacity in [4093, MAX_LINE_BYTES + 2] {
                    let mut input = vec![b'x'; raw_size];
                    if ending == "crlf" {
                        *input.last_mut().unwrap() = b'\r';
                    }
                    if ending != "eof" {
                        input.push(b'\n');
                    }
                    let dropped = Arc::new(AtomicBool::new(false));
                    let witness = Witness {
                        inner: std::io::Cursor::new(input),
                        dropped: dropped.clone(),
                    };
                    let mut lines = Lines::new(BufReader::with_capacity(capacity, witness));
                    let result = lines.next_line().await;
                    if raw_size > MAX_LINE_BYTES {
                        assert_eq!(result, Err(LineError::TooLarge));
                        assert_eq!(lines.partial.capacity(), 0);
                    } else if raw_size == 0 && ending == "eof" {
                        assert_eq!(result, Ok(None));
                    } else {
                        let text = result.unwrap().unwrap();
                        assert_eq!(text.len(), raw_size - usize::from(ending == "crlf"));
                        assert!(text.bytes().all(|b| b == b'x'));
                    }
                    assert_eq!(lines.next_line().await, Ok(None));
                    drop(lines);
                    assert!(dropped.load(Ordering::SeqCst));
                }
            }
        }
        for capacity in [1, 2, 64] {
            let mut lines = Lines::new(BufReader::with_capacity(
                capacity,
                std::io::Cursor::new("a\r\n\n令牌\nlast\r".as_bytes()),
            ));
            for expected in ["a", "", "令牌", "last\r"] {
                assert_eq!(lines.next_line().await.unwrap().as_deref(), Some(expected));
            }
            assert_eq!(lines.next_line().await, Ok(None));
        }
        let mut lines = Lines::new(BufReader::new(std::io::Cursor::new(vec![0xff, b'\n'])));
        assert_eq!(lines.next_line().await, Err(LineError::Read));
        assert!(lines.partial.is_empty());
    }

    #[tokio::test]
    async fn lb2_cancelled_next_line_retains_split_utf8_and_drops_source() {
        let (read, mut write) = tokio::io::duplex(64);
        let dropped = Arc::new(AtomicBool::new(false));
        let mut lines = Lines::new(BufReader::with_capacity(
            2,
            Witness {
                inner: read,
                dropped: dropped.clone(),
            },
        ));
        write.write_all(&[0xe4]).await.unwrap();
        {
            let mut pending = Box::pin(lines.next_line());
            assert!(futures_util::poll!(&mut pending).is_pending());
        }
        assert_eq!(lines.partial, &[0xe4]);
        write.write_all(&[0xbb, 0xa4, b'\r']).await.unwrap();
        {
            let mut pending = Box::pin(lines.next_line());
            assert!(futures_util::poll!(&mut pending).is_pending());
        }
        assert_eq!(lines.partial, "令\r".as_bytes());
        write.write_all(b"\nnext\n").await.unwrap();
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("令"));
        assert_eq!(lines.next_line().await.unwrap().as_deref(), Some("next"));
        drop(lines);
        assert!(dropped.load(Ordering::SeqCst));
    }

    // Retains the source even when its buffer is exhausted, then stays pending
    // or reports an I/O error. This distinguishes early bound rejection from EOF.
    struct OpenSource {
        bytes: Vec<u8>,
        offset: usize,
        error: bool,
        dropped: Arc<AtomicBool>,
    }
    impl AsyncRead for OpenSource {
        fn poll_read(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
            _: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            unreachable!("direct AsyncBufRead fixture")
        }
    }
    impl AsyncBufRead for OpenSource {
        fn poll_fill_buf(
            self: Pin<&mut Self>,
            _: &mut Context<'_>,
        ) -> Poll<std::io::Result<&[u8]>> {
            let me = self.get_mut();
            if me.offset < me.bytes.len() {
                Poll::Ready(Ok(&me.bytes[me.offset..]))
            } else if me.error {
                Poll::Ready(Err(std::io::Error::other("PRIVATE_READ")))
            } else {
                Poll::Pending
            }
        }
        fn consume(self: Pin<&mut Self>, amount: usize) {
            self.get_mut().offset += amount;
        }
    }
    impl Drop for OpenSource {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }
    #[tokio::test]
    async fn lb1_lb2_open_source_bound_and_read_failure() {
        for size in [MAX_LINE_BYTES, MAX_LINE_BYTES + 1] {
            let dropped = Arc::new(AtomicBool::new(false));
            let mut lines = Lines::new(OpenSource {
                bytes: vec![b'x'; size],
                offset: 0,
                error: false,
                dropped: dropped.clone(),
            });
            if size == MAX_LINE_BYTES {
                {
                    let mut pending = Box::pin(lines.next_line());
                    assert!(futures_util::poll!(&mut pending).is_pending());
                }
                assert_eq!(lines.partial.len(), MAX_LINE_BYTES);
                assert!(lines.partial.capacity() <= MAX_LINE_BYTES);
            } else {
                assert_eq!(lines.next_line().await, Err(LineError::TooLarge));
                assert_eq!(lines.partial.capacity(), 0);
            }
            drop(lines);
            assert!(dropped.load(Ordering::SeqCst));
        }
        let dropped = Arc::new(AtomicBool::new(false));
        let mut lines = Lines::new(OpenSource {
            bytes: b"private-partial".to_vec(),
            offset: 0,
            error: true,
            dropped: dropped.clone(),
        });
        assert_eq!(lines.next_line().await, Err(LineError::Read));
        assert_eq!(lines.partial.capacity(), 0);
        drop(lines);
        assert!(dropped.load(Ordering::SeqCst));
    }
}

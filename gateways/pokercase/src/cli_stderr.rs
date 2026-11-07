//! Bounded diagnostic prefix with an owned, continuously draining task.
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncReadExt};
use tokio::task::JoinHandle;

const PREFIX_BYTES: usize = 4096;

pub(crate) struct Drain {
    prefix: Arc<Mutex<Vec<u8>>>,
    task: Option<JoinHandle<()>>,
}

impl Drain {
    pub(crate) fn new(mut source: impl AsyncRead + Unpin + Send + 'static) -> Self {
        let prefix = Arc::new(Mutex::new(Vec::new()));
        let retained = prefix.clone();
        let task = tokio::spawn(async move {
            let mut chunk = [0u8; 1024];
            loop {
                let n = match source.read(&mut chunk).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => n,
                };
                let mut bytes = retained.lock().unwrap();
                let keep = n.min(PREFIX_BYTES - bytes.len());
                bytes.extend_from_slice(&chunk[..keep]);
            }
        });
        Self {
            prefix,
            task: Some(task),
        }
    }

    /// Preserve the old bounded EOF wait for no-reply diagnostics. The handle
    /// remains owned even if this future is cancelled while awaiting it.
    pub(crate) async fn diagnostic(&mut self) -> String {
        if let Some(task) = self.task.as_mut() {
            if tokio::time::timeout(Duration::from_secs(2), task)
                .await
                .is_ok()
            {
                self.task.take();
            }
        }
        self.stop().await;
        String::from_utf8_lossy(&self.prefix.lock().unwrap()).into_owned()
    }

    pub(crate) async fn stop(&mut self) {
        if let Some(task) = self.task.as_mut() {
            task.abort();
            let _ = task.await;
            self.task.take();
        }
    }
}

impl Drop for Drain {
    fn drop(&mut self) {
        if let Some(task) = &self.task {
            task.abort();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::pin::Pin;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::task::{Context, Poll};
    use tokio::io::{AsyncWriteExt, ReadBuf};

    struct Witness {
        source: tokio::io::DuplexStream,
        dropped: Arc<AtomicBool>,
    }
    impl AsyncRead for Witness {
        fn poll_read(
            mut self: Pin<&mut Self>,
            cx: &mut Context<'_>,
            buf: &mut ReadBuf<'_>,
        ) -> Poll<std::io::Result<()>> {
            Pin::new(&mut self.source).poll_read(cx, buf)
        }
    }
    impl Drop for Witness {
        fn drop(&mut self) {
            self.dropped.store(true, Ordering::SeqCst);
        }
    }
    async fn released(flag: &AtomicBool) {
        tokio::time::timeout(Duration::from_secs(1), async {
            while !flag.load(Ordering::SeqCst) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("owned stderr source released");
    }

    #[tokio::test]
    async fn sd2_prefix_bound_and_utf8_preserve_draining() {
        for len in [0, 4095, 4096, 4097, 1024 * 1024] {
            let (mut writer, source) = tokio::io::duplex(64);
            let mut drain = Drain::new(source);
            let bytes = vec![b'x'; len];
            tokio::time::timeout(Duration::from_secs(2), writer.write_all(&bytes))
                .await
                .unwrap()
                .unwrap();
            // Writer completing while still open proves discarded bytes drain.
            drop(writer);
            assert_eq!(
                drain.diagnostic().await.as_bytes(),
                &bytes[..len.min(PREFIX_BYTES)]
            );
            drain.stop().await; // completion is safe to clean up again
        }
        for bytes in [
            b"hello\xffworld".to_vec(),
            [vec![b'x'; 4095], "界".as_bytes().to_vec()].concat(),
            "界".repeat(1365).into_bytes(),
        ] {
            let expected =
                String::from_utf8_lossy(&bytes[..bytes.len().min(PREFIX_BYTES)]).into_owned();
            let mut drain = Drain::new(std::io::Cursor::new(bytes));
            assert_eq!(drain.diagnostic().await, expected);
        }
    }

    #[tokio::test]
    async fn sd3_stop_drop_and_cancelled_diagnostic_release_open_source() {
        for mode in 0..3 {
            let (mut writer, source) = tokio::io::duplex(64);
            let dropped = Arc::new(AtomicBool::new(false));
            let mut drain = Drain::new(Witness {
                source,
                dropped: dropped.clone(),
            });
            writer.write_all(b"open stderr").await.unwrap();
            if mode == 0 {
                drain.stop().await;
            }
            if mode == 2 {
                assert!(
                    tokio::time::timeout(Duration::from_millis(20), drain.diagnostic())
                        .await
                        .is_err()
                );
            }
            drop(drain);
            released(&dropped).await;
            assert!(writer.write_all(b"closed").await.is_err());
        }
    }

    #[tokio::test]
    async fn sd2_open_stderr_wait_is_bounded_and_read_errors_release_source() {
        let (mut writer, source) = tokio::io::duplex(64);
        let dropped = Arc::new(AtomicBool::new(false));
        let mut drain = Drain::new(Witness {
            source,
            dropped: dropped.clone(),
        });
        writer.write_all(b"not logged in").await.unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(3), drain.diagnostic())
                .await
                .unwrap(),
            "not logged in"
        );
        assert!(dropped.load(Ordering::SeqCst));
        struct Broken;
        impl AsyncRead for Broken {
            fn poll_read(
                self: Pin<&mut Self>,
                _: &mut Context<'_>,
                _: &mut ReadBuf<'_>,
            ) -> Poll<std::io::Result<()>> {
                Poll::Ready(Err(std::io::Error::other("fixture read error")))
            }
        }
        let mut drain = Drain::new(Broken);
        assert_eq!(drain.diagnostic().await, "");
    }
}

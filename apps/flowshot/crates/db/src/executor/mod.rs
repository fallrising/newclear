use crate::types::{Sources, internal};
use crate::*;
use std::{
    panic::{AssertUnwindSafe, catch_unwind},
    path::{Path, PathBuf},
    sync::{
        Arc, Condvar, Mutex,
        mpsc::{self, Receiver, SyncSender, TrySendError},
    },
    thread::{self, JoinHandle},
    time::{SystemTime, UNIX_EPOCH},
};
#[derive(Clone, Copy, Debug)]
pub struct Config {
    pub write_capacity: usize,
    pub read_connections: usize,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            write_capacity: 64,
            read_connections: 4,
        }
    }
}
struct SystemClock;
impl Clock for SystemClock {
    fn now(&self) -> Millis {
        Millis(
            i64::try_from(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_millis(),
            )
            .unwrap_or(i64::MAX),
        )
    }
}
struct SystemIds;
impl IdSource for SystemIds {
    fn next(&self) -> uuid::Uuid {
        uuid::Uuid::now_v7()
    }
}

thread_local! {static REDACT_PANIC:std::cell::Cell<bool>=const {std::cell::Cell::new(false)};}
// Keep the host hook for all other threads/callbacks; user payloads never enter DB logs.
fn redacted_catch<T>(f: impl FnOnce() -> T) -> std::thread::Result<T> {
    static HOOK: std::sync::Once = std::sync::Once::new();
    struct Restore(bool);
    impl Drop for Restore {
        fn drop(&mut self) {
            REDACT_PANIC.set(self.0);
        }
    }
    HOOK.call_once(|| {
        let previous = std::panic::take_hook();
        std::panic::set_hook(Box::new(move |info| {
            if !REDACT_PANIC.get() {
                previous(info);
            }
        }));
    });
    let guard = Restore(REDACT_PANIC.replace(true));
    let result = catch_unwind(AssertUnwindSafe(f));
    drop(guard);
    result
}

static NEXT_ID: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(1);
type Job = Box<dyn FnOnce(&mut rusqlite::Connection, &Sources) + Send>;
struct ReadState {
    connections: Vec<rusqlite::Connection>,
    accepted: usize,
    closed: bool,
}
struct Readers {
    state: Mutex<ReadState>,
    available: Condvar,
}
thread_local! { static ACTIVE_READER:std::cell::Cell<Option<usize>>=const { std::cell::Cell::new(None) }; }
struct ReadContext(Option<usize>);
impl Drop for ReadContext {
    fn drop(&mut self) {
        ACTIVE_READER.set(self.0);
    }
}

pub struct DbRuntime {
    writer_id: thread::ThreadId,
    runtime_id: usize,
    sender: Mutex<Option<SyncSender<Job>>>,
    writer: Mutex<Option<JoinHandle<()>>>,
    readers: Readers,
}
/// Owned completion. Waiting blocks the calling thread; use a blocking adapter.
pub struct Completion<T>(Receiver<Result<T>>, thread::ThreadId);
impl<T> Completion<T> {
    pub fn wait(self) -> Result<T> {
        if thread::current().id() == self.1 {
            return Err(internal());
        }
        self.0
            .recv()
            .unwrap_or_else(|_| Err(DbError::new(ErrorCode::Closed)))
    }
}
impl DbRuntime {
    pub fn open(path: &Path) -> Result<Self> {
        Self::with_config(
            path,
            Config::default(),
            Arc::new(SystemClock),
            Arc::new(SystemIds),
        )
    }
    pub fn with_config(
        path: &Path,
        config: Config,
        clock: Arc<dyn Clock>,
        ids: Arc<dyn IdSource>,
    ) -> Result<Self> {
        if config.write_capacity == 0 || config.read_connections == 0 {
            return Err(types::invalid());
        }
        let path = if path == Path::new(":memory:") {
            PathBuf::from(format!(
                "file:flowshot-{}?mode=memory&cache=shared",
                uuid::Uuid::now_v7()
            ))
        } else {
            path.to_path_buf()
        };
        let sources = Sources { clock, ids };
        let (sender, receiver) = mpsc::sync_channel::<Job>(config.write_capacity);
        let (ready, initialized) = mpsc::sync_channel(1);
        let writer = thread::Builder::new()
            .name("flowshot-db-writer".into())
            .spawn(move || {
                let init = (|| {
                    let mut conn = connection::open(&path)?;
                    migrations::run(&mut conn, sources.now()?)?;
                    let mut readers = Vec::with_capacity(config.read_connections);
                    for _ in 0..config.read_connections {
                        readers.push(connection::open(&path)?);
                    }
                    Ok((conn, readers))
                })();
                match init {
                    Ok((mut conn, readers)) => {
                        if ready.send(Ok(readers)).is_err() {
                            return;
                        }
                        for job in receiver {
                            job(&mut conn, &sources);
                        }
                    }
                    Err(e) => {
                        let _ = ready.send(Err(e));
                    }
                }
            })
            .map_err(|_| internal())?;
        let readers = match initialized.recv() {
            Ok(Ok(readers)) => readers,
            other => {
                let _ = writer.join();
                return Err(other
                    .ok()
                    .and_then(std::result::Result::err)
                    .unwrap_or_else(internal));
            }
        };
        Ok(Self {
            writer_id: writer.thread().id(),
            runtime_id: NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed),
            sender: Mutex::new(Some(sender)),
            writer: Mutex::new(Some(writer)),
            readers: Readers {
                state: Mutex::new(ReadState {
                    connections: readers,
                    accepted: 0,
                    closed: false,
                }),
                available: Condvar::new(),
            },
        })
    }
    pub fn submit<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Transaction<'_>) -> Result<T> + Send + 'static,
    ) -> Result<Completion<T>> {
        self.check_context()?;
        let (result, completion) = mpsc::sync_channel(1);
        let job: Job = Box::new(move |conn, sources| {
            let started = std::time::Instant::now();
            let outcome = redacted_catch(|| {
                let tx =
                    conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
                let answer = f(&mut Transaction { conn: &tx, sources })?;
                tx.commit()?;
                Ok(answer)
            })
            .unwrap_or_else(|_| Err(internal()));
            eprintln!(
                "{{\"operation\":\"transaction\",\"duration_us\":{},\"result\":\"{}\"}}",
                started.elapsed().as_micros(),
                if outcome.is_ok() { "ok" } else { "error" }
            );
            let _ = result.send(outcome);
        });
        let guard = self.sender.lock().map_err(|_| internal())?;
        let sender = guard
            .as_ref()
            .ok_or_else(|| DbError::new(ErrorCode::Closed))?;
        sender.try_send(job).map_err(|e| {
            DbError::new(match e {
                TrySendError::Full(_) => ErrorCode::Overload,
                TrySendError::Disconnected(_) => ErrorCode::Closed,
            })
        })?;
        Ok(Completion(completion, self.writer_id))
    }
    pub fn transaction<T: Send + 'static>(
        &self,
        f: impl FnOnce(&mut Transaction<'_>) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        self.submit(f)?.wait()
    }
    fn check_context(&self) -> Result<()> {
        if thread::current().id() == self.writer_id || ACTIVE_READER.get() == Some(self.runtime_id)
        {
            Err(internal())
        } else {
            Ok(())
        }
    }
    pub fn read<T>(&self, f: impl FnOnce(&Repository<'_>) -> Result<T>) -> Result<T> {
        self.check_context()?;
        let mut pool = self.readers.state.lock().map_err(|_| internal())?;
        if pool.closed {
            return Err(DbError::new(ErrorCode::Closed));
        }
        pool.accepted += 1;
        while pool.connections.is_empty() {
            pool = self.readers.available.wait(pool).map_err(|_| internal())?;
        }
        let conn = pool.connections.pop().ok_or_else(internal)?;
        drop(pool);
        let context = ReadContext(ACTIVE_READER.replace(Some(self.runtime_id)));
        let result =
            redacted_catch(|| f(&Repository { conn: &conn })).unwrap_or_else(|_| Err(internal()));
        drop(context);
        let mut pool = self.readers.state.lock().map_err(|_| internal())?;
        pool.connections.push(conn);
        pool.accepted -= 1;
        self.readers.available.notify_all();
        result
    }
    pub fn shutdown(&self) -> Result<()> {
        self.check_context()?;
        self.sender.lock().map_err(|_| internal())?.take();
        {
            let mut pool = self.readers.state.lock().map_err(|_| internal())?;
            pool.closed = true;
        }
        let mut handle = self.writer.lock().map_err(|_| internal())?;
        if let Some(writer) = handle.take() {
            writer.join().map_err(|_| internal())?;
        }
        let mut pool = self.readers.state.lock().map_err(|_| internal())?;
        while pool.accepted != 0 {
            pool = self.readers.available.wait(pool).map_err(|_| internal())?;
        }
        pool.connections.clear();
        Ok(())
    }
}
impl Drop for DbRuntime {
    fn drop(&mut self) {
        let _ = self.shutdown();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pragmas(c: &rusqlite::Connection) -> (i64, String, i64, i64) {
        (
            c.query_row("PRAGMA foreign_keys", [], |r| r.get(0))
                .unwrap(),
            c.query_row("PRAGMA journal_mode", [], |r| r.get(0))
                .unwrap(),
            c.query_row("PRAGMA synchronous", [], |r| r.get(0)).unwrap(),
            c.query_row("PRAGMA busy_timeout", [], |r| r.get(0))
                .unwrap(),
        )
    }
    #[test]
    fn required_pragmas_apply_to_every_connection() {
        let path = std::env::temp_dir().join(format!("pragma-{}.sqlite3", uuid::Uuid::now_v7()));
        let db = DbRuntime::open(&path).unwrap();
        assert_eq!(
            db.transaction(|tx| Ok(pragmas(tx.conn))).unwrap(),
            (1, "wal".into(), 1, 5000)
        );
        for c in &db.readers.state.lock().unwrap().connections {
            assert_eq!(pragmas(c), (1, "wal".into(), 1, 5000));
            assert!(
                c.execute(
                    "INSERT INTO document_tags VALUES('missing','missing',0)",
                    []
                )
                .is_err()
            );
        }
        let mem = DbRuntime::open(Path::new(":memory:")).unwrap();
        assert_eq!(
            mem.transaction(|tx| Ok(pragmas(tx.conn))).unwrap(),
            (1, "memory".into(), 1, 5000)
        );
    }
}
#[cfg(test)]
mod shutdown_tests {
    use super::*;
    #[test]
    fn shutdown_drains_readers_and_closes_connections() {
        let db = Arc::new(
            DbRuntime::with_config(
                Path::new(":memory:"),
                Config {
                    write_capacity: 2,
                    read_connections: 1,
                },
                Arc::new(SystemClock),
                Arc::new(SystemIds),
            )
            .unwrap(),
        );
        let (start, start_rx) = mpsc::channel();
        let (release, release_rx) = mpsc::channel();
        let rdb = db.clone();
        let first = thread::spawn(move || {
            rdb.read(|_| {
                start.send(()).unwrap();
                release_rx.recv().unwrap();
                Ok(())
            })
            .unwrap();
        });
        start_rx.recv().unwrap();
        let rdb = db.clone();
        let second = thread::spawn(move || rdb.read(|_| Ok(())).unwrap());
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(2);
        while db.readers.state.lock().unwrap().accepted != 2 {
            assert!(std::time::Instant::now() < deadline);
            thread::yield_now();
        }
        let (done, done_rx) = mpsc::channel();
        let sdb = db.clone();
        let shutdown = thread::spawn(move || {
            sdb.shutdown().unwrap();
            done.send(()).unwrap();
        });
        while !db.readers.state.lock().unwrap().closed {
            assert!(std::time::Instant::now() < deadline);
            thread::yield_now();
        }
        assert!(done_rx.try_recv().is_err());
        release.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
        done_rx
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        shutdown.join().unwrap();
        let state = db.readers.state.lock().unwrap();
        assert_eq!(state.accepted, 0);
        assert!(state.connections.is_empty());
    }
}

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::process::{Child, Command};
use std::thread;
use std::time::{Duration, Instant};

const TIMEOUT: Duration = Duration::from_secs(5);
const KEYS: usize = 64;

struct Server {
    port: u16,
    child: Child,
}

impl Server {
    fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).expect("reserve ephemeral port");
        let port = listener.local_addr().expect("listener address").port();
        drop(listener);
        let child = Command::new(env!("CARGO_BIN_EXE_rudis"))
            .args([
                "--port",
                &port.to_string(),
                "--workers",
                "4",
                "--shards",
                "4",
            ])
            .spawn()
            .expect("start rudis");
        // Construct the guard before any readiness assertion so failure also reaps it.
        let mut server = Self { port, child };
        let deadline = Instant::now() + TIMEOUT;
        loop {
            if let Some(status) = server.child.try_wait().expect("poll server") {
                panic!("server exited before listening: {status}");
            }
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("server readiness timed out");
            let probe_timeout = remaining.min(Duration::from_millis(100));
            let probe = TcpStream::connect_timeout(&([127, 0, 0, 1], port).into(), probe_timeout)
                .and_then(|mut stream| {
                    stream.set_read_timeout(Some(probe_timeout))?;
                    stream.set_write_timeout(Some(probe_timeout))?;
                    stream.write_all(&command(&["PING"]))?;
                    let mut reply = [0; 7];
                    stream.read_exact(&mut reply)?;
                    Ok(reply)
                });
            if let Ok(reply) = probe {
                assert_eq!(&reply, b"+PONG\r\n", "unexpected readiness response");
                break;
            }
            // A TCP connect can complete while reuseport listeners are still
            // starting. Retry only this startup probe; command checks stay strict.
            assert!(Instant::now() < deadline, "server readiness timed out");
            thread::sleep(Duration::from_millis(10));
        }
        server
    }

    fn connect(&self) -> Client {
        Client::new(
            TcpStream::connect_timeout(&([127, 0, 0, 1], self.port).into(), TIMEOUT)
                .expect("connect"),
        )
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Debug, PartialEq, Eq)]
enum Reply {
    Simple(Vec<u8>),
    Error(Vec<u8>),
    Integer(i64),
    Bulk(Vec<u8>),
    Null,
    Array(Vec<Reply>),
}

struct Client {
    stream: BufReader<TcpStream>,
}

impl Client {
    fn new(stream: TcpStream) -> Self {
        stream
            .set_read_timeout(Some(TIMEOUT))
            .expect("read timeout");
        stream
            .set_write_timeout(Some(TIMEOUT))
            .expect("write timeout");
        stream.set_nodelay(true).expect("TCP_NODELAY");
        Self {
            stream: BufReader::new(stream),
        }
    }

    fn send(&mut self, bytes: &[u8]) {
        self.stream.get_mut().write_all(bytes).expect("write RESP");
    }

    fn expect(&mut self, expected: &[Reply]) {
        // A pipeline has one overall deadline, rather than a new timeout per frame.
        let deadline = Instant::now() + TIMEOUT;
        for (index, reply) in expected.iter().enumerate() {
            let remaining = deadline
                .checked_duration_since(Instant::now())
                .expect("pipeline reply deadline exceeded");
            self.stream
                .get_mut()
                .set_read_timeout(Some(remaining))
                .expect("pipeline read timeout");
            assert_eq!(&self.read_reply(), reply, "reply at pipeline index {index}");
        }
        self.stream
            .get_mut()
            .set_read_timeout(Some(TIMEOUT))
            .expect("restore read timeout");
    }

    fn read_line(&mut self) -> Vec<u8> {
        let mut line = Vec::new();
        (&mut self.stream)
            .take(4096)
            .read_until(b'\n', &mut line)
            .expect("read RESP line");
        assert!(line.ends_with(b"\r\n"), "unterminated RESP line: {line:?}");
        line.truncate(line.len() - 2);
        line
    }

    fn read_reply(&mut self) -> Reply {
        let mut prefix = [0];
        self.stream.read_exact(&mut prefix).expect("read RESP type");
        let line = self.read_line();
        let number = || {
            std::str::from_utf8(&line)
                .expect("numeric RESP header")
                .parse::<i64>()
                .expect("RESP number")
        };
        match prefix[0] {
            b'+' => Reply::Simple(line),
            b'-' => Reply::Error(line),
            b':' => Reply::Integer(number()),
            b'$' | b'*' if number() == -1 => Reply::Null,
            b'$' => {
                let len = usize::try_from(number()).expect("nonnegative bulk length");
                assert!(len <= 1024 * 1024, "unexpected bulk length: {len}");
                let mut value = vec![0; len];
                self.stream.read_exact(&mut value).expect("read RESP bulk");
                let mut end = [0; 2];
                self.stream.read_exact(&mut end).expect("read bulk CRLF");
                assert_eq!(&end, b"\r\n", "bulk terminator");
                Reply::Bulk(value)
            }
            b'*' => {
                let len = usize::try_from(number()).expect("nonnegative array length");
                assert!(len <= 4096, "unexpected array length: {len}");
                Reply::Array((0..len).map(|_| self.read_reply()).collect())
            }
            other => panic!("unexpected RESP type {other:?}"),
        }
    }
}

fn command(args: &[&str]) -> Vec<u8> {
    let mut bytes = format!("*{}\r\n", args.len()).into_bytes();
    for arg in args {
        bytes.extend_from_slice(format!("${}\r\n", arg.len()).as_bytes());
        bytes.extend_from_slice(arg.as_bytes());
        bytes.extend_from_slice(b"\r\n");
    }
    bytes
}

fn keys() -> Vec<String> {
    (0..KEYS).map(|i| format!("batch-key-{i}")).collect()
}

fn append(pipeline: &mut Vec<u8>, expected: &mut Vec<Reply>, args: &[&str], reply: Reply) {
    pipeline.extend(command(args));
    expected.push(reply);
}

fn ok() -> Reply {
    Reply::Simple(b"OK".to_vec())
}

fn pong() -> Reply {
    Reply::Simple(b"PONG".to_vec())
}

fn assert_shard_spread(client: &mut Client) {
    // Other workers publish counters on their expire ticker, not on this INFO.
    let deadline = Instant::now() + TIMEOUT;
    loop {
        client.send(&command(&["INFO", "STATS"]));
        let Reply::Bulk(stats) = client.read_reply() else {
            panic!("INFO STATS must return a bulk string");
        };
        let stats = String::from_utf8(stats).expect("INFO UTF-8");
        let counts: Vec<u64> = (0..4)
            .map(|shard| {
                let name = format!("rudis_shard_{shard}_commands:");
                stats
                    .split("\r\n")
                    .find_map(|line| line.strip_prefix(&name))
                    .unwrap_or_else(|| panic!("missing {name} in INFO"))
                    .parse()
                    .expect("shard command count")
            })
            .collect();
        if counts.iter().all(|&count| count > 0) {
            return;
        }
        assert!(
            Instant::now() < deadline,
            "test keys did not exercise all shards: {counts:?}"
        );
        thread::sleep(Duration::from_millis(10));
        // Completion reactors can sleep past the expire tick. Wake every owner
        // with read-only work so its batched counters are published too.
        let mut reads = Vec::new();
        for key in keys() {
            reads.extend(command(&["GET", &key]));
        }
        client.send(&reads);
        for _ in 0..KEYS {
            assert!(matches!(client.read_reply(), Reply::Bulk(_)));
        }
    }
}

#[test]
fn batched_same_key_operations_and_immediate_replies_remain_fifo() {
    let server = Server::start();
    let mut client = server.connect();
    let mut pipeline = Vec::new();
    let mut expected = Vec::new();
    for key in keys() {
        append(&mut pipeline, &mut expected, &["SET", &key, "0"], ok());
        append(&mut pipeline, &mut expected, &["PING"], pong());
        for value in 1..=3 {
            append(
                &mut pipeline,
                &mut expected,
                &["INCR", &key],
                Reply::Integer(value),
            );
            append(
                &mut pipeline,
                &mut expected,
                &["GET", &key],
                Reply::Bulk(value.to_string().into_bytes()),
            );
        }
        let value = format!("{key}\r\n\0bulk");
        append(&mut pipeline, &mut expected, &["SET", &key, &value], ok());
        append(
            &mut pipeline,
            &mut expected,
            &["GET", &key],
            Reply::Bulk(value.into_bytes()),
        );
        append(&mut pipeline, &mut expected, &["PING"], pong());
    }
    client.send(&pipeline);
    client.expect(&expected);
    assert_shard_spread(&mut client);
}

#[test]
fn idle_workers_wake_for_fragmented_cross_shard_pipeline() {
    let server = Server::start();
    let mut client = server.connect();
    let keys = keys();
    for key in &keys {
        client.send(&command(&["SET", key, key]));
        client.expect(&[ok()]);
    }
    assert_shard_spread(&mut client);
    for _ in 0..8 {
        // Let every worker become idle before sending new cross-worker work.
        thread::sleep(Duration::from_millis(25));
        let mut pipeline = Vec::new();
        let mut expected = Vec::new();
        for key in &keys {
            append(
                &mut pipeline,
                &mut expected,
                &["GET", key],
                Reply::Bulk(key.as_bytes().to_vec()),
            );
            append(&mut pipeline, &mut expected, &["PING"], pong());
        }
        client.send(&pipeline[..1]);
        thread::sleep(Duration::from_millis(5));
        for chunk in pipeline[1..].chunks(31) {
            client.send(chunk);
        }
        // Read the whole pipeline without another command to trigger progress.
        client.expect(&expected);
    }
}

#[test]
fn abandoned_cross_shard_replies_do_not_reach_reconnected_clients() {
    let server = Server::start();
    let mut control = server.connect();
    let keys = keys();
    for key in &keys {
        control.send(&command(&["SET", key, "abandoned-reply"]));
        control.expect(&[ok()]);
    }
    assert_shard_spread(&mut control);
    for round in 0..24 {
        let mut abandoned = server.connect();
        let mut pipeline = Vec::new();
        for key in &keys {
            pipeline.extend(command(&["GET", key]));
        }
        abandoned.send(&pipeline);
        // Leave replies unread and promptly replace the connection. Execution of
        // commands abandoned at disconnect is deliberately not an assertion.
        let _ = abandoned.stream.get_ref().shutdown(Shutdown::Both);
        drop(abandoned);

        let mut replacement = server.connect();
        let sentinel = format!("replacement-{round}");
        let mut pipeline = command(&["PING"]);
        pipeline.extend(command(&["SET", "replacement-key", &sentinel]));
        pipeline.extend(command(&["GET", "replacement-key"]));
        pipeline.extend(command(&["PING"]));
        replacement.send(&pipeline);
        replacement.expect(&[pong(), ok(), Reply::Bulk(sentinel.into_bytes()), pong()]);
    }
    control.send(&command(&["PING"]));
    control.expect(&[pong()]);
}

#[test]
fn idle_multikey_helpers_progress_without_another_socket_event() {
    let server = Server::start();
    let mut client = server.connect();
    let keys = keys();
    let mut args = vec!["MSET"];
    for key in &keys {
        args.push(key.as_str());
        args.push(key.as_str());
    }
    client.send(&command(&args));
    client.expect(&[ok()]);
    thread::sleep(Duration::from_millis(25));
    let mut args = vec!["MGET"];
    args.extend(keys.iter().map(String::as_str));
    client.send(&command(&args));
    client.expect(&[Reply::Array(
        keys.iter()
            .map(|k| Reply::Bulk(k.as_bytes().to_vec()))
            .collect(),
    )]);
    assert_shard_spread(&mut client);
    for key in ["set-left", "set-right"] {
        client.send(&command(&["SADD", key, "shared", key]));
        client.expect(&[Reply::Integer(2)]);
    }
    thread::sleep(Duration::from_millis(25));
    client.send(&command(&[
        "SINTERSTORE",
        "set-result",
        "set-left",
        "set-right",
    ]));
    client.expect(&[Reply::Integer(1)]);
    client.send(&command(&["SMEMBERS", "set-result"]));
    client.expect(&[Reply::Array(vec![Reply::Bulk(b"shared".to_vec())])]);
    client.send(&command(&["PING"]));
    client.expect(&[pong()]);
}

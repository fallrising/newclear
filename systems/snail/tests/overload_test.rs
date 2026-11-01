use std::io::{Read, Write};
use std::net::{TcpListener, TcpStream};
use std::process::{Child, Command};
use std::thread;
use std::time::Duration;

const CONNECTIONS: usize = 64;
const PIPELINE: usize = 1000;

struct Server {
    port: u16,
    child: Child,
}

impl Server {
    fn start(workers: u16) -> Self {
        let port = TcpListener::bind("127.0.0.1:0")
            .and_then(|l| l.local_addr())
            .expect("ephemeral port")
            .port();
        let child = Command::new(env!("CARGO_BIN_EXE_rudis"))
            .args([
                "--port",
                &port.to_string(),
                "--workers",
                &workers.to_string(),
                "--shards",
                &workers.to_string(),
            ])
            .spawn()
            .expect("start rudis");
        thread::sleep(Duration::from_millis(500));
        Self { port, child }
    }

    fn connect(&self) -> TcpStream {
        let stream = TcpStream::connect(("127.0.0.1", self.port)).expect("connect");
        stream.set_read_timeout(Some(Duration::from_secs(10))).ok();
        stream
    }
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

/// Writes `PIPELINE` INCRs in one burst and reads until every reply line arrived.
fn pipelined_incr(mut stream: TcpStream) {
    let cmd = "*2\r\n$4\r\nINCR\r\n$3\r\nhot\r\n".repeat(PIPELINE);
    stream.write_all(cmd.as_bytes()).expect("write pipeline");
    let mut replies = 0;
    let mut buf = vec![0u8; 64 * 1024];
    while replies < PIPELINE {
        let n = stream.read(&mut buf).expect("read replies");
        assert!(n > 0, "server closed the connection");
        replies += buf[..n].iter().filter(|&&b| b == b'\n').count();
    }
}

#[test]
fn pipelined_cross_shard_writes_all_apply_under_load() {
    let server = Server::start(4);
    let clients: Vec<_> = (0..CONNECTIONS)
        .map(|_| {
            let stream = server.connect();
            thread::spawn(move || pipelined_incr(stream))
        })
        .collect();
    for client in clients {
        client.join().expect("client thread");
    }

    let mut stream = server.connect();
    stream
        .write_all(b"*2\r\n$3\r\nGET\r\n$3\r\nhot\r\n")
        .expect("write GET");
    let mut buf = [0u8; 64];
    let n = stream.read(&mut buf).expect("read GET");
    let expected = (CONNECTIONS * PIPELINE).to_string();
    assert_eq!(
        String::from_utf8_lossy(&buf[..n]),
        format!("${}\r\n{}\r\n", expected.len(), expected),
        "some pipelined INCRs were rejected instead of applied"
    );
}

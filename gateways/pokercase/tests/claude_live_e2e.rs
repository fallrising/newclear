//! Live Claude Code runs across requests: a tool call's result goes back to the same
//! process through the MCP helper and the gateway callback. A Python stand-in for
//! Claude Code really starts the helper from `--mcp-config` and calls `tools/call`.

#![cfg(unix)]

use std::os::unix::fs::PermissionsExt;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::TcpListener;

/// Per user message: with tools, stream a get_weather call, call it over MCP, then
/// answer with the result in a second message; told a `[tool result` (a new run told
/// the whole conversation), answer "Hello there". Records starts and user messages.
const FAKE_CLAUDE: &str = r#"#!/usr/bin/env python3
import json, os, re, subprocess, sys, time, uuid
d = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
trace_enabled = os.path.exists(os.path.join(d, "trace-stages"))
def trace(stage):
    if not trace_enabled: return
    with open(os.path.join(d, "stages.txt"), "a") as f: f.write(str(time.time_ns()) + " " + str(os.getpid()) + " " + stage + "\n")
trace("process-start")
with open(os.path.join(d, "starts.txt"), "a") as f: f.write("start\n")
with open(os.path.join(d, "args.txt"), "w") as f: f.write("\n".join(args))
# Sessions are saved like Claude Code: <config>/projects/<cwd with non-alnum as ->/<id>.jsonl
proj = os.path.join(os.environ["CLAUDE_CONFIG_DIR"], "projects", re.sub(r"[^A-Za-z0-9]", "-", os.getcwd()))
os.makedirs(proj, exist_ok=True)
if "--resume" in args:
    sid = args[args.index("--resume") + 1]
    if not os.path.exists(os.path.join(proj, sid + ".jsonl")) or os.path.exists(os.path.join(d, "refuse_resume")):
        sys.stderr.write("No conversation found with session ID: " + sid + "\n")
        sys.exit(1)
    with open(os.path.join(d, "resumes.txt"), "a") as f: f.write(sid + "\n")
else:
    sid = str(uuid.uuid4())
# Saturate stderr before reading stdin to expose mutual pipe backpressure.
if os.path.exists(os.path.join(d, "stderr-start")):
    with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
    sys.stderr.buffer.write(b"START_DIAGNOSTIC" + b"x" * (1024 * 1024)); sys.stderr.flush()
    if open(os.path.join(d, "stderr-start")).read() == "fail-input":
        os.close(0)
        while True: time.sleep(60)
# T-0423 gates the first read before helper startup or any stdout. Only byte
# counts are recorded; the parent verifies the admitted input exceeds capacity.
if os.path.exists(os.path.join(d, "input-gate")):
    import array, fcntl, termios
    capacity = fcntl.fcntl(0, fcntl.F_GETPIPE_SZ)
    queued = array.array("i", [0])
    deadline = time.monotonic() + 3
    while queued[0] == 0:
        fcntl.ioctl(0, termios.FIONREAD, queued, True)
        if time.monotonic() >= deadline: raise RuntimeError("initial input not queued")
        time.sleep(0.001)
    with open(os.path.join(d, "input-ready.json"), "w") as f:
        json.dump({"capacity": capacity, "queued": queued[0]}, f)
    with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
    while os.path.exists(os.path.join(d, "input-gate")): time.sleep(0.001)
helper = None
if "--mcp-config" in args:
    cfg = json.load(open(args[args.index("--mcp-config") + 1]))["mcpServers"]["thinrouter"]
    helper = subprocess.Popen([cfg["command"]] + cfg["args"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    def rpc(i, method, params=None):
        trace("rpc-send-" + method)
        msg = {"jsonrpc": "2.0", "id": i, "method": method}
        if params is not None: msg["params"] = params
        helper.stdin.write(json.dumps(msg) + "\n"); helper.stdin.flush()
        while True:
            r = json.loads(helper.stdout.readline())
            if r.get("id") == i:
                trace("rpc-reply-" + method)
                if method == "tools/call":
                    result = r.get("result", {})
                    text = " ".join(c.get("text", "") for c in result.get("content", []))
                    category = "success"
                    if result.get("isError"):
                        category = "other-error"
                        if text == "no matching tool call is pending": category = "not-registered"
                        if text == "the client did not return a tool result in time": category = "tool-timeout"
                    trace("rpc-outcome-" + category)
                return r
    rpc(1, "initialize", {"protocolVersion": "2025-06-18"})
    helper.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); helper.stdin.flush()
    tools = rpc(2, "tools/list")["result"]["tools"]
def out(o): sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
def ev(e): out({"type": "stream_event", "event": e})
def hang(text):
    if "STATE_EXACT" in text:
        for index in range(4095): ev({"type":"content_block_start","index":index,"content_block":{"type":"thinking"}})
        return
    if "SD_FLOOD" in text:
        with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
        if "SD_PARTIAL" in text:
            ev({"type":"message_start","message":{"id":"msg_sd","type":"message","role":"assistant","content":[],"usage":{"input_tokens":1}}})
            ev({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})
            ev({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}})
        prefix = b"z" * (4096 - len(b"not logged in")) + b"not logged in"
        sys.stderr.buffer.write(prefix + b"UNRETAINED_SECRET" + b"x" * (1024 * 1024)); sys.stderr.flush()
        if "SD_EXIT" in text: sys.exit(1)
        if "SD_RESULT" in text:
            out({"type":"result","subtype":"error","is_error":True,"result":"explicit failure"})
            sys.exit(1)
    if "LINE_EXACT" in text:
        sys.stdout.write('{"type":"ignored"}'.ljust(16 * 1024 * 1024) + "\n"); sys.stdout.flush()
        return
    if "HANG_" not in text: return
    with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
    if "HANG_COLLECT" in text:
        ev({"type":"message_start","message":{"id":"msg_collect","type":"message","role":"assistant","content":[],"usage":{"input_tokens":1}}})
        ev({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})
        for _ in range(17):
            ev({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x" * (1024 * 1024)}})
    if "HANG_AFTER" in text:
        ev({"type":"message_start","message":{"id":"msg_hang","type":"message","role":"assistant","content":[],"usage":{"input_tokens":1}}})
        ev({"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}})
        ev({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}})
    if "HANG_STATE_TEXT" in text:
        for _ in range(16): ev({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"x" * (1024 * 1024)}})
    elif "HANG_STATE" in text:
        for index in range(4097): ev({"type":"content_block_start","index":index,"content_block":{"type":"thinking"}})
    if "HANG_LINE" in text:
        sys.stdout.write('{"PRIVATE_STDOUT":"' + 'x' * (16 * 1024 * 1024)); sys.stdout.flush()
    while True: time.sleep(60)
def message(mid, blocks, stop):
    trace("message-" + mid + "-" + stop)
    ev({"type": "message_start", "message": {"id": mid, "type": "message", "role": "assistant", "model": "claude-x", "content": [], "usage": {"input_tokens": 10, "output_tokens": 0}}})
    for i, b in enumerate(blocks):
        if b[0] == "text":
            ev({"type": "content_block_start", "index": i, "content_block": {"type": "text", "text": ""}})
            ev({"type": "content_block_delta", "index": i, "delta": {"type": "text_delta", "text": b[1]}})
        else:
            ev({"type": "content_block_start", "index": i, "content_block": {"type": "tool_use", "id": b[1], "name": b[2], "input": {}}})
            ev({"type": "content_block_delta", "index": i, "delta": {"type": "input_json_delta", "partial_json": json.dumps(b[3])}})
        ev({"type": "content_block_stop", "index": i})
    ev({"type": "message_delta", "delta": {"stop_reason": stop}, "usage": {"output_tokens": 3}})
    ev({"type": "message_stop"})
out({"type": "system", "subtype": "init", "session_id": sid})
n = 0
for line in sys.stdin:
    n += 1
    trace("input-" + str(n))
    with open(os.path.join(d, "turns.txt"), "a") as f: f.write(line)
    with open(os.path.join(proj, sid + ".jsonl"), "a") as f: f.write(line)
    text = json.dumps(json.loads(line))
    hang(text)
    if helper is None or "[tool result" in text:
        message("msg_t%d" % n, [("text", "Hello there")], "end_turn")
    else:
        tid = "toolu_%d_%d" % (os.getpid(), n)
        blocks = [("text", "Checking."), ("tool", tid, "mcp__thinrouter__get_weather", {"city": "Taipei"})]
        if n == 2 and os.path.exists(os.path.join(d, "late-completion")):
            message("msg_a%d" % n, blocks, "tool_use")
            r = {"result":{"content":[{"text":"synthetic expired tool phase"}],"isError":True}}
        elif n == 2 and os.path.exists(os.path.join(d, "early-callback")):
            import threading
            logfile = os.path.join(d, "gateway.log")
            offset = os.path.getsize(logfile)
            replies = []
            pending = threading.Thread(target=lambda: replies.append(rpc(10 + n, "tools/call", {"name": "get_weather", "arguments": {"city": "Taipei"}})), daemon=True)
            pending.start()
            deadline = time.monotonic() + 3
            while True:
                with open(logfile) as f:
                    f.seek(offset)
                    observed = f.read()
                # Coordinate at callback admission, before publishing the matching event.
                if "mcp_not_registered" in observed or "mcp_wait_announcement" in observed: break
                if time.monotonic() >= deadline: raise RuntimeError("callback admission barrier timed out")
                time.sleep(0.001)
            trace("early-callback-admitted-before-announcement")
            message("msg_a%d" % n, blocks, "tool_use")
            pending.join(3)
            if not replies: raise RuntimeError("callback did not resolve after announcement")
            r = replies[0]
        else:
            message("msg_a%d" % n, blocks, "tool_use")
            r = rpc(10 + n, "tools/call", {"name": "get_weather", "arguments": {"city": "Taipei"}})
        res = r["result"]["content"][0]["text"]
        hang(res)
        message("msg_b%d" % n, [("text", "Result: " + res + (" (error)" if r["result"].get("isError") else ""))], "end_turn")
    out({"type": "result", "subtype": "success", "is_error": False, "result": "ok"})
    if "STATE_AFTER_DONE" in text:
        with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
        for index in range(4097): ev({"type":"content_block_start","index":index,"content_block":{"type":"thinking"}})
        while True: time.sleep(60)
    if "LINE_AFTER_DONE" in text:
        with open(os.path.join(d, "hanging.pid"), "w") as f: f.write(str(os.getpid()))
        sys.stdout.write('{"PRIVATE_STDOUT":"' + 'x' * (16 * 1024 * 1024)); sys.stdout.flush()
        while True: time.sleep(60)
"#;

struct Env {
    base: String,
    client: reqwest::Client,
    bin_dir: TempDir,
    child: tokio::process::Child,
    dir: TempDir,
    config_dir: TempDir,
    extra: Vec<String>,
    key: String,
}

/// Start the gateway on an existing data dir and Claude config dir.
async fn gateway(
    dir: &TempDir,
    bin_dir: &TempDir,
    config_dir: &TempDir,
    extra: &[String],
) -> (tokio::process::Child, String) {
    let bin = bin_dir.path().join("claude");
    let port = {
        let l = TcpListener::bind("127.0.0.1:0").await.unwrap();
        l.local_addr().unwrap().port()
    };
    let mut cmd = tokio::process::Command::new(env!("CARGO_BIN_EXE_thinrouter"));
    cmd.args([
        "serve",
        "--port",
        &port.to_string(),
        "--data-dir",
        dir.path().to_str().unwrap(),
        "--claude-bin",
        bin.to_str().unwrap(),
    ])
    .args(extra)
    .env("RUST_LOG", "thinrouter::claude_lifecycle=debug")
    .env_remove("THINROUTER_ADMIN_TOKEN")
    .env_remove("THINROUTER_SECRETS_KEY")
    .env("CLAUDE_CONFIG_DIR", config_dir.path())
    .kill_on_drop(true)
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::from(
        std::fs::File::create(bin_dir.path().join("gateway.log")).unwrap(),
    ));
    let child = cmd.spawn().unwrap();
    let base = format!("http://127.0.0.1:{port}");
    let plain = reqwest::Client::builder().no_proxy().build().unwrap();
    for _ in 0..100 {
        if plain
            .get(format!("{base}/health"))
            .send()
            .await
            .is_ok_and(|r| r.status().is_success())
        {
            break;
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    (child, base)
}

impl Env {
    async fn start(extra: &[&str]) -> Self {
        let bin_dir = tempfile::tempdir().unwrap();
        let bin = bin_dir.path().join("claude");
        std::fs::write(&bin, FAKE_CLAUDE).unwrap();
        std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let config_dir = tempfile::tempdir().unwrap();
        let extra: Vec<String> = extra.iter().map(|s| s.to_string()).collect();
        let (child, base) = gateway(&dir, &bin_dir, &config_dir, &extra).await;
        let plain = reqwest::Client::builder().no_proxy().build().unwrap();
        let admin = std::fs::read_to_string(dir.path().join("admin-token")).unwrap();
        let post = |path: &str, body: Value| {
            plain
                .post(format!("{base}{path}"))
                .header("x-admin-token", admin.trim())
                .json(&body)
                .send()
        };
        let r = post(
            "/admin/api/connections/oauth/import",
            json!({"name": "cc", "provider": "claude", "access_token": "", "default_model": "sonnet"}),
        )
        .await
        .unwrap();
        assert_eq!(r.status(), 201);
        let key: Value = post("/admin/api/keys", json!({"name": "t"}))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
        let mut headers = reqwest::header::HeaderMap::new();
        headers.insert(
            "authorization",
            format!("Bearer {}", key["secret"].as_str().unwrap())
                .parse()
                .unwrap(),
        );
        let client = reqwest::Client::builder()
            .no_proxy()
            .default_headers(headers)
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap();
        Self {
            base,
            client,
            bin_dir,
            child,
            dir,
            config_dir,
            extra,
            key: key["secret"].as_str().unwrap().to_owned(),
        }
    }

    /// Stop the gateway like Ctrl-C / SIGTERM would, and start it again on the same
    /// database and Claude config folder.
    async fn restart(&mut self) {
        let pid = self.child.id().unwrap();
        std::process::Command::new("kill")
            .args(["-TERM", &pid.to_string()])
            .status()
            .unwrap();
        tokio::time::timeout(Duration::from_secs(15), self.child.wait())
            .await
            .expect("gateway shuts down")
            .unwrap();
        let (child, base) = gateway(&self.dir, &self.bin_dir, &self.config_dir, &self.extra).await;
        self.child = child;
        self.base = base;
    }

    /// Saved session files in the Claude config folder.
    fn session_files(&self) -> Vec<std::path::PathBuf> {
        let projects = self.config_dir.path().join("projects");
        std::fs::read_dir(projects)
            .into_iter()
            .flatten()
            .flatten()
            .flat_map(|p| std::fs::read_dir(p.path()).into_iter().flatten().flatten())
            .map(|e| e.path())
            .filter(|p| p.extension().is_some_and(|x| x == "jsonl"))
            .collect()
    }

    fn file(&self, name: &str) -> String {
        std::fs::read_to_string(self.bin_dir.path().join(name)).unwrap_or_default()
    }

    fn starts(&self) -> usize {
        self.file("starts.txt").lines().count()
    }

    async fn chat_stage(&self, stage: &str, body: Value) -> Value {
        let started = Instant::now();
        eprintln!("SC-3 begin {stage}");
        let result = self
            .client
            .post(format!("{}/v1/chat/completions", self.base))
            .json(&body)
            .send()
            .await;
        let response = result.unwrap_or_else(|error| {
            panic!(
                "SC-3 {stage}: {error:?}; fixture stages:\n{}\ngateway:\n{}",
                self.file("stages.txt"),
                self.file("gateway.log")
            )
        });
        assert_eq!(
            response.status(),
            200,
            "SC-3 {stage}; fixture stages:\n{}",
            self.file("stages.txt")
        );
        let body = response.json().await.unwrap_or_else(|error| {
            panic!(
                "SC-3 {stage} body: {error:?}; fixture stages:\n{}",
                self.file("stages.txt")
            )
        });
        eprintln!(
            "SC-3 done {stage} after {:?}; fixture stages:\n{}",
            started.elapsed(),
            self.file("stages.txt")
        );
        body
    }

    async fn chat(&self, body: Value) -> Value {
        let r = self
            .client
            .post(format!("{}/v1/chat/completions", self.base))
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(r.status(), 200);
        r.json().await.unwrap()
    }
}

fn tools() -> Value {
    json!([{"type": "function", "function": {"name": "get_weather", "description": "weather",
        "parameters": {"type": "object", "properties": {"city": {"type": "string"}}}}}])
}

fn history(id: &str, result: &str) -> Value {
    json!({"model": "cc", "tools": tools(), "messages": [
        {"role": "user", "content": "weather?"},
        {"role": "assistant", "content": "Checking.", "tool_calls": [{"id": id, "type": "function",
            "function": {"name": "get_weather", "arguments": "{\"city\":\"Taipei\"}"}}]},
        {"role": "tool", "tool_call_id": id, "content": result}
    ]})
}

fn first_call(v: &Value) -> String {
    let call = &v["choices"][0]["message"]["tool_calls"][0];
    assert_eq!(call["function"]["name"], "get_weather");
    assert_eq!(v["choices"][0]["finish_reason"], "tool_calls");
    call["id"].as_str().unwrap().to_string()
}

#[tokio::test]
async fn tool_result_goes_back_to_the_same_claude_code_process() {
    let env = Env::start(&[]).await;
    let ask = json!({"model": "cc", "tools": tools(), "messages": [{"role": "user", "content": "weather?"}]});

    let v = env.chat(ask.clone()).await;
    let id = first_call(&v);
    assert_eq!(env.starts(), 1);

    // The result is answered over MCP in the same process; nothing is sent again.
    let started = Instant::now();
    let v = env.chat(history(&id, "sunny")).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Result: sunny");
    assert!(started.elapsed() < Duration::from_secs(10));
    assert_eq!(env.starts(), 1, "same process");
    assert_eq!(
        env.file("turns.txt").lines().count(),
        1,
        "one user message written"
    );

    // Results that no run waits for start a new run told the whole conversation.
    let v = env.chat(history("toolu_unknown", "rainy")).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(env.starts(), 2);
    let turns = env.file("turns.txt");
    assert!(turns.contains("[tool result id=toolu_unknown]"));

    // The token for the callback is in a 0600 file, never on Claude Code's command line.
    let args = env.file("args.txt");
    assert!(args.contains("--mcp-config"));
    assert!(!args.contains("x-thinrouter-run-token"));

    // Streaming continuation: chat chunks of the same run's second message.
    let v = env.chat(ask.clone()).await;
    let id = first_call(&v);
    let r = env
        .client
        .post(format!("{}/v1/chat/completions", env.base))
        .json(&{
            let mut h = history(&id, "windy");
            h["stream"] = json!(true);
            h
        })
        .send()
        .await
        .unwrap();
    let text = r.text().await.unwrap();
    let content: String = text
        .lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .filter_map(|d| serde_json::from_str::<Value>(d).ok())
        .filter_map(|c| {
            c.pointer("/choices/0/delta/content")
                .and_then(|t| t.as_str())
                .map(str::to_string)
        })
        .collect();
    assert_eq!(content, "Result: windy");
    assert!(text.trim_end().ends_with("data: [DONE]"));
    assert_eq!(env.starts(), 3);
}

#[tokio::test]
async fn waiting_runs_expire_and_make_room() {
    let env = Env::start(&["--claude-idle-secs", "1", "--claude-max-runs", "1"]).await;
    let ask = json!({"model": "cc", "tools": tools(), "messages": [{"role": "user", "content": "weather?"}]});

    // Expired: the late result starts a new run instead of hanging.
    let id = first_call(&env.chat(ask.clone()).await);
    tokio::time::sleep(Duration::from_millis(2500)).await;
    let v = env.chat(history(&id, "late")).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(env.starts(), 2);

    // One slot: a new conversation ends the waiting run rather than queueing behind it.
    let id = first_call(&env.chat(ask.clone()).await);
    let started = Instant::now();
    let other = json!({"model": "cc", "messages": [{"role": "user", "content": "hi"}]});
    let v = env.chat(other).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert!(started.elapsed() < Duration::from_secs(8));
    // The evicted run's result then goes to a new run.
    let v = env.chat(history(&id, "x")).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
}

#[tokio::test]
async fn callback_needs_a_live_run_token() {
    let env = Env::start(&[]).await;
    let plain = reqwest::Client::builder().no_proxy().build().unwrap();
    let url = format!("{}/_thinrouter/claude-mcp", env.base);
    let r = plain
        .post(&url)
        .json(&json!({"name": "get_weather"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
    let r = plain
        .post(&url)
        .header("x-thinrouter-run-token", "guess")
        .json(&json!({"name": "get_weather"}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 404);
    let r = plain
        .post(&url)
        .header("x-thinrouter-run-token", "guess")
        .header("x-forwarded-for", "1.2.3.4")
        .json(&json!({}))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), 401);
}

#[tokio::test]
async fn next_user_turn_goes_on_in_the_idle_run() {
    let env = Env::start(&[]).await;
    let turn1 = json!({"model": "cc", "messages": [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi"}]});
    let v = env.chat(turn1).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");

    // Same conversation plus a new user message: written to the same process, alone.
    let turn2 = json!({"model": "cc", "messages": [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hello there"},
        {"role": "user", "content": "and again"}]});
    let v = env.chat(turn2).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(env.starts(), 1, "same process");
    let turns: Vec<Value> = env
        .file("turns.txt")
        .lines()
        .map(|l| serde_json::from_str(l).unwrap())
        .collect();
    assert_eq!(turns.len(), 2);
    assert_eq!(turns[1]["message"]["content"][0]["text"], "and again");

    // Edited history, or other instructions: a new run told the whole conversation.
    let edited = json!({"model": "cc", "messages": [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "something else"},
        {"role": "user", "content": "and again"}]});
    env.chat(edited).await;
    assert_eq!(env.starts(), 2);
    let other_system = json!({"model": "cc", "messages": [
        {"role": "system", "content": "be verbose"},
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hello there"},
        {"role": "user", "content": "x"}]});
    env.chat(other_system).await;
    assert_eq!(env.starts(), 3);
}

#[tokio::test]
async fn idle_runs_expire() {
    let env = Env::start(&["--claude-idle-secs", "1"]).await;
    env.chat(json!({"model": "cc", "messages": [{"role": "user", "content": "hi"}]}))
        .await;
    tokio::time::sleep(Duration::from_millis(2500)).await;
    env.chat(json!({"model": "cc", "messages": [
        {"role": "user", "content": "hi"},
        {"role": "assistant", "content": "Hello there"},
        {"role": "user", "content": "later"}]}))
        .await;
    assert_eq!(env.starts(), 2, "an expired run's process is not reused");
}

fn two_turns(last: &str) -> (Value, Value) {
    let first = json!({"model": "cc", "messages": [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi zebra-quokka"}]});
    let next = json!({"model": "cc", "messages": [
        {"role": "system", "content": "be brief"},
        {"role": "user", "content": "hi zebra-quokka"},
        {"role": "assistant", "content": "Hello there"},
        {"role": "user", "content": last}]});
    (first, next)
}

fn last_turn(env: &Env) -> Value {
    let turns = env.file("turns.txt");
    serde_json::from_str(turns.lines().last().unwrap()).unwrap()
}

#[tokio::test]
async fn ended_idle_run_resumes_from_its_saved_session() {
    let env = Env::start(&["--claude-idle-secs", "1"]).await;
    let (first, next) = two_turns("later");
    env.chat(first).await;
    tokio::time::sleep(Duration::from_millis(2500)).await; // idle run ended → shelved
    assert_eq!(
        env.session_files().len(),
        1,
        "session kept for the next turn"
    );
    let v = env.chat(next).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(env.starts(), 2);
    assert_eq!(env.file("resumes.txt").lines().count(), 1, "--resume used");
    assert!(env.file("args.txt").contains("--resume"));
    // Told only the new message, not the conversation again.
    assert_eq!(last_turn(&env)["message"]["content"][0]["text"], "later");
    // The database keeps hashes, never the conversation text.
    let db = std::fs::read(env.dir.path().join("thinrouter.db")).unwrap();
    assert!(!String::from_utf8_lossy(&db).contains("zebra-quokka"));
}

#[tokio::test]
async fn saved_sessions_survive_a_restart() {
    let mut env = Env::start(&[]).await;
    let (first, next) = two_turns("after restart");
    env.chat(first).await;
    // A session file no shelf entry names (a crashed run's) is swept at startup.
    let project = env.session_files()[0].parent().unwrap().to_path_buf();
    std::fs::write(project.join("orphan-1.jsonl"), "{}").unwrap();
    env.restart().await; // shutdown shelves the idle run
    assert!(!project.join("orphan-1.jsonl").exists());
    assert_eq!(env.session_files().len(), 1, "the shelved session is kept");
    let v = env.chat(next).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(env.file("resumes.txt").lines().count(), 1);
    assert_eq!(
        last_turn(&env)["message"]["content"][0]["text"],
        "after restart"
    );
}

#[tokio::test]
async fn unresumable_session_falls_back_to_the_whole_conversation() {
    let env = Env::start(&["--claude-idle-secs", "1"]).await;
    let (first, next) = two_turns("again");
    env.chat(first).await;
    tokio::time::sleep(Duration::from_millis(2500)).await;
    std::fs::write(env.bin_dir.path().join("refuse_resume"), "").unwrap();
    let v = env.chat(next).await;
    assert_eq!(v["choices"][0]["message"]["content"], "Hello there");
    assert_eq!(env.starts(), 3, "failed resume, then a new run");
    assert!(env.file("resumes.txt").is_empty());
    let told = last_turn(&env).to_string();
    assert!(told.contains("conversation_history"), "{told}");
    assert!(told.contains("zebra-quokka"));
}

#[tokio::test]
async fn responses_stream_from_claude_code_carries_the_tool_call() {
    let env = Env::start(&[]).await;
    let r = env
        .client
        .post(format!("{}/v1/responses", env.base))
        .json(&json!({"model": "cc", "stream": true, "input": "weather?",
            "tools": [{"type": "function", "name": "get_weather", "parameters": {"type": "object"}}]}))
        .send()
        .await
        .unwrap();
    let text = r.text().await.unwrap();
    let events: Vec<Value> = text
        .lines()
        .filter_map(|l| l.strip_prefix("data: "))
        .map(|d| serde_json::from_str(d).unwrap())
        .collect();
    let done = &events.last().unwrap()["response"];
    assert_eq!(events.last().unwrap()["type"], "response.completed");
    let call = done["output"]
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["type"] == "function_call")
        .unwrap();
    assert_eq!(call["name"], "get_weather");
    assert_eq!(call["arguments"], "{\"city\": \"Taipei\"}");
    assert!(call["call_id"].as_str().unwrap().starts_with("toolu_"));
}

// Process-reaping evidence uses Linux procfs; other platforms retain the existing tests.
#[cfg(target_os = "linux")]
mod disconnect_tests {
    use super::*;
    // Kill only our exact fixture on a failing assertion, so RED does not orphan it.
    struct HangingFixture {
        pid: i32,
        bin: std::path::PathBuf,
    }
    impl Drop for HangingFixture {
        fn drop(&mut self) {
            let cmd = std::fs::read(format!("/proc/{}/cmdline", self.pid)).unwrap_or_default();
            if cmd
                .split(|b| *b == 0)
                .any(|arg| arg == self.bin.as_os_str().as_encoded_bytes())
            {
                unsafe {
                    libc::kill(self.pid, libc::SIGKILL);
                }
            }
        }
    }
    async fn hanging_fixture(env: &Env) -> HangingFixture {
        let pid = tokio::time::timeout(Duration::from_secs(3), async {
            loop {
                if let Ok(raw) = std::fs::read_to_string(env.bin_dir.path().join("hanging.pid")) {
                    if let Ok(pid) = raw.parse::<i32>() {
                        break pid;
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fixture reached its silent active turn");
        HangingFixture {
            pid,
            bin: env.bin_dir.path().join("claude"),
        }
    }
    async fn assert_reaped(fixture: &HangingFixture) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while std::path::Path::new(&format!("/proc/{}", fixture.pid)).exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("disconnected silent Claude process is reaped before stall/idle expiry");
    }
    fn hanging_request(path: &str, stream: bool) -> Value {
        if path == "/v1/responses" {
            json!({"model":"cc","stream":stream,"input":"HANG_AFTER"})
        } else {
            json!({"model":"cc","stream":stream,"max_tokens":50,"messages":[{"role":"user","content":"HANG_AFTER"}]})
        }
    }
    #[tokio::test]
    async fn sd1_stderr_before_stdin_does_not_block_any_client_api() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [false, true] {
                let env = Env::start(&["--claude-max-runs", "1"]).await;
                std::fs::write(env.bin_dir.path().join("stderr-start"), "").unwrap();
                let text = "q".repeat(1024 * 1024);
                let body = if path == "/v1/responses" {
                    json!({"model":"cc","stream":stream,"input":text})
                } else {
                    json!({"model":"cc","stream":stream,"max_tokens":30,"messages":[{"role":"user","content":text}]})
                };
                let request = env.client.post(format!("{}{path}", env.base)).json(&body);
                let pending = tokio::spawn(async move {
                    let r = request.send().await.unwrap();
                    (r.status(), r.text().await.unwrap())
                });
                let _fixture = hanging_fixture(&env).await;
                let (status, text) = tokio::time::timeout(Duration::from_secs(4), pending)
                    .await
                    .expect("stderr must drain before stdin can complete")
                    .unwrap();
                assert_eq!(status, 200, "{path}/{stream}: {text}");
                assert!(text.contains("Hello"));
                assert!(!text.contains("START_DIAGNOSTIC"));
            }
        }
    }

    fn owned_run_dirs(env: &Env) -> Vec<std::path::PathBuf> {
        std::fs::read_dir(env.dir.path().join("claude-work/runs"))
            .into_iter()
            .flatten()
            .map(|entry| entry.unwrap().path())
            .filter(|path| path.file_name().unwrap() != "keep")
            .collect()
    }

    async fn assert_no_run_dirs(env: &Env) {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !owned_run_dirs(env).is_empty() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("owned run directory removed");
    }

    fn startup_body(path: &str, stream: bool, with_tools: bool) -> Value {
        let text = "q".repeat(1024 * 1024);
        let mut body = if path == "/v1/responses" {
            json!({"model":"cc","stream":stream,"input":text})
        } else {
            json!({"model":"cc","stream":stream,"max_tokens":50,"messages":[{"role":"user","content":text}]})
        };
        if with_tools {
            body["tools"] = match path {
                "/v1/messages" => {
                    json!([{"name":"get_weather","input_schema":{"type":"object","properties":{}}}])
                }
                "/v1/responses" => {
                    json!([{"type":"function","name":"get_weather","parameters":{"type":"object","properties":{}}}])
                }
                _ => tools(),
            };
        }
        body
    }

    async fn raw_startup_request(
        env: &Env,
        path: &str,
        body: &Value,
        connection_close: bool,
    ) -> tokio::net::TcpStream {
        use tokio::io::AsyncWriteExt;
        let address = env.base.strip_prefix("http://").unwrap();
        let mut socket = tokio::time::timeout(
            Duration::from_secs(3),
            tokio::net::TcpStream::connect(address),
        )
        .await
        .expect("loopback connection established")
        .unwrap();
        let body = serde_json::to_vec(body).unwrap();
        let connection = if connection_close {
            "Connection: close\r\n"
        } else {
            ""
        };
        let headers = format!(
            "POST {path} HTTP/1.1\r\nHost: {address}\r\nAuthorization: Bearer {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{connection}\r\n",
            env.key, body.len()
        );
        tokio::time::timeout(Duration::from_secs(3), async {
            socket.write_all(headers.as_bytes()).await.unwrap();
            socket.write_all(&body).await.unwrap();
        })
        .await
        .expect("complete HTTP request delivered");
        socket
    }

    async fn blocked_startup(env: &Env, with_tools: bool) -> HangingFixture {
        let fixture = hanging_fixture(env).await;
        let marker: Value = serde_json::from_str(&env.file("input-ready.json")).unwrap();
        assert!(marker["queued"].as_u64().unwrap() > 0);
        assert!(marker["capacity"].as_u64().unwrap() < 1024 * 1024);
        assert!(marker["queued"].as_u64().unwrap() <= marker["capacity"].as_u64().unwrap());
        assert!(
            env.file("turns.txt").is_empty(),
            "no complete initial line was consumed"
        );
        assert_eq!(
            env.starts(),
            1,
            "one admitted process, not an HTTP body-limit rejection"
        );
        assert_eq!(owned_run_dirs(env).len(), usize::from(with_tools));
        fixture
    }

    async fn assert_startup_reaped(env: &Env, fixture: &HangingFixture) {
        let reaped = tokio::time::timeout(Duration::from_secs(3), async {
            while std::path::Path::new(&format!("/proc/{}", fixture.pid)).exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await;
        if reaped.is_err() {
            let stat =
                std::fs::read_to_string(format!("/proc/{}/stat", fixture.pid)).unwrap_or_default();
            let state = stat
                .rsplit_once(')')
                .and_then(|(_, rest)| rest.split_whitespace().next())
                .unwrap_or("absent");
            panic!("initial-write disconnect not reaped in 3s: state={state}, owned_dirs={}, starts={}, startup_cancel_stage={}, reader_cleanup_stage={}", owned_run_dirs(env).len(), env.starts(), env.file("gateway.log").contains("startup_input_cancelled"), env.file("gateway.log").contains("reader_cleanup"));
        }
    }

    async fn startup_replacement(env: &Env) {
        let reply = tokio::time::timeout(
            Duration::from_secs(3),
            env.chat(json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]})),
        )
        .await
        .expect("released one-slot capacity admits replacement");
        assert_eq!(reply["choices"][0]["message"]["content"], "Hello there");
        assert_eq!(env.starts(), 2, "cancelled input was never replayed");
        assert_eq!(env.file("turns.txt").lines().count(), 1);
    }

    #[tokio::test]
    async fn hd1_http_connection_close_during_initial_write_releases_resources() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [false, true] {
                for with_tools in [false, true] {
                    eprintln!("HD-1 {path} stream={stream} tools={with_tools}");
                    let env =
                        Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
                    let sibling = env.dir.path().join("claude-work/runs/keep");
                    std::fs::create_dir_all(&sibling).unwrap();
                    std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
                    let gate = env.bin_dir.path().join("input-gate");
                    std::fs::write(&gate, "").unwrap();
                    let socket = raw_startup_request(
                        &env,
                        path,
                        &startup_body(path, stream, with_tools),
                        true,
                    )
                    .await;
                    let fixture = blocked_startup(&env, with_tools).await;
                    // Own and close the entire socket. No write-half shutdown or
                    // client task abort is used; no TCP RST is claimed.
                    drop(socket);
                    assert_startup_reaped(&env, &fixture).await;
                    assert_no_run_dirs(&env).await;
                    assert_eq!(std::fs::read(sibling.join("sentinel")).unwrap(), b"keep");
                    std::fs::remove_file(gate).unwrap();
                    startup_replacement(&env).await;
                }
            }
        }
    }

    #[tokio::test]
    async fn hd2_keep_alive_close_initial_write() {
        let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
        std::fs::write(env.bin_dir.path().join("input-gate"), "").unwrap();
        let socket = raw_startup_request(
            &env,
            "/v1/chat/completions",
            &startup_body("/v1/chat/completions", false, true),
            false,
        )
        .await;
        let fixture = blocked_startup(&env, true).await;
        drop(socket);
        assert_startup_reaped(&env, &fixture).await;
        assert_no_run_dirs(&env).await;
    }

    #[tokio::test]
    async fn hd2_reqwest_abort_initial_write() {
        let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
        std::fs::write(env.bin_dir.path().join("input-gate"), "").unwrap();
        let request = env
            .client
            .post(format!("{}/v1/chat/completions", env.base))
            .json(&startup_body("/v1/chat/completions", false, true));
        let pending = tokio::spawn(async move { request.send().await });
        let fixture = blocked_startup(&env, true).await;
        pending.abort();
        let _ = pending.await;
        assert_startup_reaped(&env, &fixture).await;
        assert_no_run_dirs(&env).await;
    }

    #[tokio::test]
    async fn hd3_gated_large_input_and_completed_response_preserve_reuse() {
        use tokio::io::AsyncReadExt;
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [false, true] {
                eprintln!("HD-3 {path} stream={stream}");
                let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
                let gate = env.bin_dir.path().join("input-gate");
                std::fs::write(&gate, "").unwrap();
                let mut socket =
                    raw_startup_request(&env, path, &startup_body(path, stream, false), true).await;
                let _fixture = blocked_startup(&env, false).await;
                std::fs::remove_file(gate).unwrap();
                let mut response = Vec::new();
                tokio::time::timeout(Duration::from_secs(3), socket.read_to_end(&mut response))
                    .await
                    .expect("gated input and response complete")
                    .unwrap();
                let response = String::from_utf8(response).unwrap();
                assert!(response.starts_with("HTTP/1.1 200"));
                assert!(response.contains("Hello there"));
                assert_eq!(env.file("turns.txt").lines().count(), 1);
                let next = env
                    .chat(json!({"model":"cc","messages":[
                        {"role":"user","content":"q".repeat(1024*1024)},
                        {"role":"assistant","content":"Hello there"},
                        {"role":"user","content":"thanks"}
                    ]}))
                    .await;
                assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
                assert_eq!(
                    env.starts(),
                    1,
                    "completed response keeps same process reusable"
                );
                assert_eq!(env.file("turns.txt").lines().count(), 2);
                assert!(owned_run_dirs(&env).is_empty());
            }
        }
    }

    #[tokio::test]
    async fn sc1_initial_input_failure_removes_tool_files() {
        let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
        let sibling = env.dir.path().join("claude-work/runs/keep");
        std::fs::create_dir_all(&sibling).unwrap();
        std::fs::write(sibling.join("sentinel"), b"keep").unwrap();
        let marker = env.bin_dir.path().join("stderr-start");
        std::fs::write(&marker, "fail-input").unwrap();
        let request = env.client.post(format!("{}/v1/chat/completions", env.base)).json(
            &json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"q".repeat(1024*1024)}]}));
        let pending = tokio::spawn(async move { request.send().await });
        let fixture = hanging_fixture(&env).await;
        let response = tokio::time::timeout(Duration::from_secs(4), pending)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), 502);
        assert!(response.text().await.unwrap().contains("Claude Code input"));
        assert!(
            owned_run_dirs(&env).is_empty(),
            "write failure cleans before return"
        );
        assert_reaped(&fixture).await;
        assert_eq!(std::fs::read(sibling.join("sentinel")).unwrap(), b"keep");
        std::fs::remove_file(marker).unwrap();
        let reply = tokio::time::timeout(
            Duration::from_secs(3),
            env.chat(json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]})),
        )
        .await
        .unwrap();
        assert_eq!(reply["choices"][0]["message"]["content"], "Hello there");
        assert_eq!(env.starts(), 2);
        assert!(
            owned_run_dirs(&env).is_empty(),
            "no-tools replacement creates no bridge directory"
        );
    }

    #[tokio::test]
    async fn sc3_tool_files_survive_continuation_then_expire() {
        tool_files_sequence(false).await;
    }

    #[tokio::test]
    async fn tc1_callback_before_stdout_registration_keeps_tool_continuation() {
        tool_files_sequence(true).await;
    }

    #[tokio::test]
    async fn tc4_late_tool_result_uses_replacement_after_completed_phase() {
        let mut env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
        std::fs::write(env.bin_dir.path().join("trace-stages"), "").unwrap();
        std::fs::write(env.bin_dir.path().join("late-completion"), "").unwrap();
        let first=env.chat_stage("first-tool",json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"weather?"}]})).await;
        let mut next = history(&first_call(&first), "sunny");
        let second = env.chat_stage("first-result", next.clone()).await;
        next["messages"]
            .as_array_mut()
            .unwrap()
            .push(second["choices"][0]["message"].clone());
        next["messages"]
            .as_array_mut()
            .unwrap()
            .push(json!({"role":"user","content":"thanks"}));
        let third = env.chat_stage("next-user", next.clone()).await;
        let old_dirs = owned_run_dirs(&env);
        assert_eq!(old_dirs.len(), 1);
        tokio::time::timeout(Duration::from_secs(3), async {
            while env.file("gateway.log").matches("reader_end_turn").count() < 2 {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("unsolicited completion processed");
        next["messages"]
            .as_array_mut()
            .unwrap()
            .push(third["choices"][0]["message"].clone());
        next["messages"]
            .as_array_mut()
            .unwrap()
            .push(json!({"role":"tool","tool_call_id":first_call(&third),"content":"late"}));
        let reply =
            tokio::time::timeout(Duration::from_secs(3), env.chat_stage("late-result", next))
                .await
                .expect("late result cannot attach to a producerless receiver");
        assert_eq!(reply["choices"][0]["message"]["content"], "Hello there");
        assert_eq!(env.starts(), 2);
        assert!(
            !old_dirs[0].exists(),
            "one-slot replacement cleans previous run"
        );
        env.restart().await;
        assert_no_run_dirs(&env).await;
    }

    async fn tool_files_sequence(early_callback: bool) {
        let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "2"]).await;
        std::fs::write(env.bin_dir.path().join("trace-stages"), "").unwrap();
        if early_callback {
            std::fs::write(env.bin_dir.path().join("early-callback"), "").unwrap();
        }
        let first = env.chat_stage("first-tool", json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"weather?"}]})).await;
        let dirs = owned_run_dirs(&env);
        assert_eq!(dirs.len(), 1);
        for file in ["tools.json", "callback.json", "mcp.json"] {
            let path = dirs[0].join(file);
            assert!(path.is_file());
            assert_eq!(
                std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        let next = history(&first_call(&first), "sunny");
        let second = env.chat_stage("first-result", next.clone()).await;
        assert!(second["choices"][0]["message"]["content"]
            .as_str()
            .unwrap()
            .contains("sunny"));
        let mut third = next;
        third["messages"]
            .as_array_mut()
            .unwrap()
            .push(second["choices"][0]["message"].clone());
        third["messages"]
            .as_array_mut()
            .unwrap()
            .push(json!({"role":"user","content":"thanks"}));
        let reply = env.chat_stage("next-user", third.clone()).await;
        assert_eq!(reply["choices"][0]["message"]["content"], "Checking.");
        assert!(!first_call(&reply).is_empty());
        assert_eq!(env.starts(), 1, "tool and idle continuation share process");
        assert_eq!(owned_run_dirs(&env), dirs);
        third["messages"]
            .as_array_mut()
            .unwrap()
            .push(reply["choices"][0]["message"].clone());
        third["messages"]
            .as_array_mut()
            .unwrap()
            .push(json!({"role":"tool","tool_call_id":first_call(&reply),"content":"done"}));
        let completed = env.chat_stage("final-result", third).await;
        assert!(completed["choices"][0]["message"]["content"]
            .as_str()
            .unwrap()
            .contains("done"));
        assert_eq!(env.starts(), 1);
        assert_eq!(owned_run_dirs(&env), dirs);
        assert_no_run_dirs(&env).await;
    }

    #[tokio::test]
    async fn sd3_failed_initial_input_reaps_process_and_releases_slot() {
        let env = Env::start(&["--claude-max-runs", "1"]).await;
        std::fs::write(env.bin_dir.path().join("stderr-start"), "fail-input").unwrap();
        let request = env
            .client
            .post(format!("{}/v1/chat/completions", env.base))
            .json(
                &json!({"model":"cc","messages":[{"role":"user","content":"q".repeat(1024*1024)}]}),
            );
        let pending = tokio::spawn(async move { request.send().await.unwrap() });
        let fixture = hanging_fixture(&env).await;
        let response = tokio::time::timeout(Duration::from_secs(4), pending)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(response.status(), 502);
        assert!(response.text().await.unwrap().contains("Claude Code input"));
        assert_reaped(&fixture).await;
        std::fs::remove_file(env.bin_dir.path().join("stderr-start")).unwrap();
        let reply = tokio::time::timeout(
            Duration::from_secs(3),
            env.chat(json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]})),
        )
        .await
        .unwrap();
        assert_eq!(reply["choices"][0]["message"]["content"], "Hello there");
        assert_eq!(env.starts(), 2);
    }

    #[tokio::test]
    async fn sd1_sd3_stderr_drain_survives_idle_and_tool_reuse() {
        for tool in [false, true] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let next = if tool {
                let first=env.chat(json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"weather?"}]})).await;
                history(&first_call(&first), "SD_FLOOD")
            } else {
                let (first, next) = two_turns("SD_FLOOD");
                env.chat(first).await;
                next
            };
            let reply = tokio::time::timeout(Duration::from_secs(4), env.chat(next))
                .await
                .unwrap();
            assert!(reply["choices"][0]["message"]["content"]
                .as_str()
                .unwrap()
                .contains(if tool { "Result:" } else { "Hello" }));
            assert_eq!(env.starts(), 1, "stderr drain belongs to reusable process");
        }
    }

    #[tokio::test]
    async fn sd2_sd3_stderr_failure_precedence_and_cancel_cleanup() {
        for (phase, status, needle) in [
            ("SD_FLOOD SD_EXIT", 401, "not logged in"),
            ("SD_FLOOD SD_RESULT", 502, "explicit failure"),
            ("SD_FLOOD SD_PARTIAL SD_EXIT", 200, "partial"),
            (
                "SD_FLOOD HANG_LINE",
                502,
                "CLI stdout record exceeds 16 MiB",
            ),
            ("SD_FLOOD HANG_BEFORE", 0, ""),
        ] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let request=env.client.post(format!("{}/v1/chat/completions",env.base)).json(&json!({"model":"cc","stream":true,"messages":[{"role":"user","content":phase}]}));
            let pending = tokio::spawn(async move {
                let r = request.send().await.unwrap();
                (r.status(), r.text().await.unwrap())
            });
            let fixture = hanging_fixture(&env).await;
            if status == 0 {
                pending.abort();
                let _ = pending.await;
            } else {
                let (actual, text) = tokio::time::timeout(Duration::from_secs(4), pending)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(actual.as_u16(), status, "{phase}: {text}");
                assert!(text.contains(needle), "{phase}: {text}");
                assert!(!text.contains("UNRETAINED_SECRET"));
                if phase.contains("SD_PARTIAL") {
                    assert!(!text.contains("\"finish_reason\":\"stop\""));
                }
            }
            assert_reaped(&fixture).await;
            let reply = tokio::time::timeout(
                Duration::from_secs(3),
                env.chat(
                    json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}),
                ),
            )
            .await
            .unwrap();
            assert_eq!(reply["choices"][0]["message"]["content"], "Hello there");
            assert_eq!(env.starts(), 2);
        }
    }

    #[tokio::test]
    async fn cf1_cf3_streamed_text_state_overflow_all_apis() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let phase = "HANG_AFTER HANG_STATE_TEXT";
            let body = if path == "/v1/responses" {
                json!({"model":"cc","stream":true,"input":phase})
            } else {
                json!({"model":"cc","stream":true,"max_tokens":30,"messages":[{"role":"user","content":phase}]})
            };
            let request = env.client.post(format!("{}{path}", env.base)).json(&body);
            let pending = tokio::spawn(async move {
                let r = request.send().await.unwrap();
                (r.status(), r.text().await.unwrap())
            });
            let fixture = hanging_fixture(&env).await;
            let (status, text) = tokio::time::timeout(Duration::from_secs(10), pending)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(status, 200);
            assert!(text.contains("Claude event state limit exceeded"), "{path}");
            assert!(!text.contains("response.completed") && !text.contains("message_stop"));
            assert_reaped(&fixture).await;
            let replacement = tokio::time::timeout(
                Duration::from_secs(3),
                env.chat(
                    json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}),
                ),
            )
            .await
            .unwrap();
            assert_eq!(
                replacement["choices"][0]["message"]["content"],
                "Hello there"
            );
        }
    }

    #[tokio::test]
    async fn cf3_claude_reused_and_completed_state_failure_is_not_shelved() {
        for phase in ["idle-turn", "tool-turn", "completed"] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let replacement = if phase == "completed" {
                let first=env.chat(json!({"model":"cc","messages":[{"role":"user","content":"STATE_AFTER_DONE"}]})).await;
                assert_eq!(first["choices"][0]["message"]["content"], "Hello there");
                json!({"model":"cc","messages":[{"role":"user","content":"STATE_AFTER_DONE"},{"role":"assistant","content":"Hello there"},{"role":"user","content":"replacement"}]})
            } else {
                let next = if phase == "tool-turn" {
                    let first=env.chat(json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"weather?"}]})).await;
                    history(&first_call(&first), "HANG_STATE")
                } else {
                    let (first, next) = two_turns("HANG_STATE");
                    env.chat(first).await;
                    next
                };
                let request = env
                    .client
                    .post(format!("{}/v1/chat/completions", env.base))
                    .json(&next);
                let pending = tokio::spawn(async move { request.send().await.unwrap() });
                let fixture = hanging_fixture(&env).await;
                let response = tokio::time::timeout(Duration::from_secs(4), pending)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(response.status(), 502);
                assert!(response
                    .text()
                    .await
                    .unwrap()
                    .contains("Claude event state limit exceeded"));
                assert_reaped(&fixture).await;
                json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]})
            };
            let fixture = hanging_fixture(&env).await;
            assert_reaped(&fixture).await;
            assert_eq!(
                env.starts(),
                1,
                "overflow belongs to the reused or completed run"
            );
            let next = tokio::time::timeout(Duration::from_secs(3), env.chat(replacement))
                .await
                .unwrap();
            assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
            assert_eq!(
                env.starts(),
                2,
                "overflow session must not be resumed then retried"
            );
            assert!(!env.bin_dir.path().join("resumes.txt").exists());
        }
    }

    #[tokio::test]
    async fn cf1_cf3_claude_event_state_http_and_cleanup() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [false, true] {
                for phase in ["HANG_STATE", "HANG_AFTER HANG_STATE", "STATE_EXACT"] {
                    let env =
                        Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
                    let body = if path == "/v1/responses" {
                        json!({"model":"cc","stream":stream,"input":phase})
                    } else {
                        json!({"model":"cc","stream":stream,"max_tokens":30,"messages":[{"role":"user","content":phase}]})
                    };
                    let request = env.client.post(format!("{}{path}", env.base)).json(&body);
                    let pending = tokio::spawn(async move {
                        let response = request.send().await.unwrap();
                        let status = response.status();
                        (status, response.text().await.unwrap())
                    });
                    let fixture = if phase == "STATE_EXACT" {
                        None
                    } else {
                        Some(hanging_fixture(&env).await)
                    };
                    let (status, text) = tokio::time::timeout(Duration::from_secs(4), pending)
                        .await
                        .expect("Event state overflow must fail without EOF")
                        .unwrap();
                    let after = phase.contains("HANG_AFTER");
                    if phase == "STATE_EXACT" {
                        assert_eq!(status, 200);
                        assert!(text.contains("Hello"));
                        assert!(!text.contains("Claude event state limit"));
                        continue;
                    }
                    assert_eq!(
                        status,
                        if stream && after { 200 } else { 502 },
                        "{path}/{stream}/{phase}: {text}"
                    );
                    assert!(text.contains("Claude event state limit exceeded"), "{text}");
                    assert!(!text.contains("PRIVATE_STDOUT"));
                    assert!(!text.contains("xxxxx"));
                    assert!(!text.contains("message_stop"));
                    assert!(!text.contains("response.completed"));
                    for v in text
                        .lines()
                        .filter_map(|l| l.strip_prefix("data: "))
                        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                    {
                        assert_ne!(v.pointer("/choices/0/finish_reason"), Some(&json!("stop")));
                    }
                    assert_reaped(fixture.as_ref().unwrap()).await;
                    let next=tokio::time::timeout(Duration::from_secs(3),env.chat(json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}))).await.unwrap();
                    assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
                    assert_eq!(env.starts(), 2);
                }
            }
        }
    }

    #[tokio::test]
    async fn lb3_claude_reused_and_completed_run_overflow_is_not_shelved() {
        for phase in ["idle-turn", "tool-turn", "completed"] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let replacement = if phase == "completed" {
                let first=env.chat(json!({"model":"cc","messages":[{"role":"user","content":"LINE_AFTER_DONE"}]})).await;
                assert_eq!(first["choices"][0]["message"]["content"], "Hello there");
                json!({"model":"cc","messages":[{"role":"user","content":"LINE_AFTER_DONE"},{"role":"assistant","content":"Hello there"},{"role":"user","content":"replacement"}]})
            } else {
                let next = if phase == "tool-turn" {
                    let first=env.chat(json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"weather?"}]})).await;
                    history(&first_call(&first), "HANG_LINE")
                } else {
                    let (first, next) = two_turns("HANG_LINE");
                    env.chat(first).await;
                    next
                };
                let request = env
                    .client
                    .post(format!("{}/v1/chat/completions", env.base))
                    .json(&next);
                let pending = tokio::spawn(async move { request.send().await.unwrap() });
                let fixture = hanging_fixture(&env).await;
                let response = tokio::time::timeout(Duration::from_secs(4), pending)
                    .await
                    .unwrap()
                    .unwrap();
                assert_eq!(response.status(), 502);
                assert!(response
                    .text()
                    .await
                    .unwrap()
                    .contains("CLI stdout record exceeds 16 MiB"));
                assert_reaped(&fixture).await;
                json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]})
            };
            let fixture = hanging_fixture(&env).await;
            assert_reaped(&fixture).await;
            assert_eq!(
                env.starts(),
                1,
                "overflow belongs to the reused or completed run"
            );
            let next = tokio::time::timeout(Duration::from_secs(3), env.chat(replacement))
                .await
                .unwrap();
            assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
            assert_eq!(
                env.starts(),
                2,
                "overflow session must not be resumed then retried"
            );
            assert!(!env.bin_dir.path().join("resumes.txt").exists());
        }
    }

    #[tokio::test]
    async fn lb1_lb3_claude_stdout_bound_http_and_cleanup() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [false, true] {
                for phase in ["HANG_LINE", "HANG_AFTER HANG_LINE", "LINE_EXACT"] {
                    let env =
                        Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
                    let body = if path == "/v1/responses" {
                        json!({"model":"cc","stream":stream,"input":phase})
                    } else {
                        json!({"model":"cc","stream":stream,"max_tokens":30,"messages":[{"role":"user","content":phase}]})
                    };
                    let request = env.client.post(format!("{}{path}", env.base)).json(&body);
                    let pending = tokio::spawn(async move {
                        let response = request.send().await.unwrap();
                        let status = response.status();
                        (status, response.text().await.unwrap())
                    });
                    let fixture = if phase == "LINE_EXACT" {
                        None
                    } else {
                        Some(hanging_fixture(&env).await)
                    };
                    let (status, text) = tokio::time::timeout(Duration::from_secs(4), pending)
                        .await
                        .expect("CLI stdout overflow must fail without newline/EOF")
                        .unwrap();
                    let after = phase.contains("HANG_AFTER");
                    if phase == "LINE_EXACT" {
                        assert_eq!(status, 200);
                        assert!(text.contains("Hello"));
                        assert!(!text.contains("CLI stdout record exceeds"));
                        continue;
                    }
                    assert_eq!(
                        status,
                        if stream && after { 200 } else { 502 },
                        "{path}/{stream}/{phase}: {text}"
                    );
                    assert!(text.contains("CLI stdout record exceeds 16 MiB"), "{text}");
                    assert!(!text.contains("PRIVATE_STDOUT"));
                    assert!(!text.contains("xxxxx"));
                    assert!(!text.contains("message_stop"));
                    assert!(!text.contains("response.completed"));
                    for v in text
                        .lines()
                        .filter_map(|l| l.strip_prefix("data: "))
                        .filter_map(|l| serde_json::from_str::<Value>(l).ok())
                    {
                        assert_ne!(v.pointer("/choices/0/finish_reason"), Some(&json!("stop")));
                    }
                    assert_reaped(fixture.as_ref().unwrap()).await;
                    let next=tokio::time::timeout(Duration::from_secs(3),env.chat(json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}))).await.unwrap();
                    assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
                    assert_eq!(env.starts(), 2);
                }
            }
        }
    }

    #[tokio::test]
    async fn bc2_bc3_collection_limit_reaps_active_cli_and_releases_slot() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let body = if path == "/v1/responses" {
                json!({"model":"cc","input":"HANG_COLLECT"})
            } else {
                json!({"model":"cc","max_tokens":30,"messages":[{"role":"user","content":"HANG_COLLECT"}]})
            };
            let request = env.client.post(format!("{}{path}", env.base)).json(&body);
            let pending = tokio::spawn(async move { request.send().await });
            let fixture = hanging_fixture(&env).await;
            let response = tokio::time::timeout(Duration::from_secs(10), pending)
                .await
                .unwrap()
                .unwrap()
                .unwrap();
            assert_eq!(response.status(), 502);
            let text = response.text().await.unwrap();
            assert!(text.contains("upstream response collection limit exceeded"));
            assert!(!text.contains("xxxxx"));
            assert_reaped(&fixture).await;
            let next = tokio::time::timeout(
                Duration::from_secs(3),
                env.chat(
                    json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}),
                ),
            )
            .await
            .unwrap();
            assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
            assert_eq!(env.starts(), 2);
        }
    }
    #[tokio::test]
    async fn dc1_silent_claude_disconnect_releases_process_and_slot() {
        for path in ["/v1/chat/completions", "/v1/messages", "/v1/responses"] {
            for stream in [true, false] {
                let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
                let request = env
                    .client
                    .post(format!("{}{path}", env.base))
                    .json(&hanging_request(path, stream));
                let pending = tokio::spawn(async move { request.send().await });
                let fixture = hanging_fixture(&env).await;
                if stream {
                    let mut response = pending.await.unwrap().unwrap();
                    assert_eq!(response.status(), 200);
                    assert!(response.chunk().await.unwrap().is_some());
                    drop(response);
                } else {
                    pending.abort();
                    let _ = pending.await;
                }
                assert_reaped(&fixture).await;
                let next = tokio::time::timeout(
                    Duration::from_secs(3),
                    env.chat(
                        json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}),
                    ),
                )
                .await
                .expect("released run slot accepts next request");
                assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
                assert_eq!(env.starts(), 2);
            }
        }
    }
    #[tokio::test]
    async fn dc2_reused_claude_turn_disconnect_before_output_releases_run() {
        for tool in [false, true] {
            let env = Env::start(&["--claude-max-runs", "1", "--claude-idle-secs", "60"]).await;
            let next = if tool {
                let first=env.chat(json!({"model":"cc","tools":tools(),"messages":[{"role":"user","content":"weather?"}]})).await;
                history(&first_call(&first), "HANG_BEFORE")
            } else {
                let (first, next) = two_turns("HANG_BEFORE");
                env.chat(first).await;
                next
            };
            let request = env
                .client
                .post(format!("{}/v1/chat/completions", env.base))
                .json(&next);
            let pending = tokio::spawn(async move { request.send().await });
            let fixture = hanging_fixture(&env).await;
            assert_eq!(env.starts(), 1, "same completed run was reused");
            pending.abort();
            let _ = pending.await;
            assert_reaped(&fixture).await;
            let next = tokio::time::timeout(
                Duration::from_secs(3),
                env.chat(
                    json!({"model":"cc","messages":[{"role":"user","content":"replacement"}]}),
                ),
            )
            .await
            .unwrap();
            assert_eq!(next["choices"][0]["message"]["content"], "Hello there");
        }
    }
}

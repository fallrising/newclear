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
import json, os, re, subprocess, sys, uuid
d = os.path.dirname(os.path.abspath(__file__))
args = sys.argv[1:]
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
helper = None
if "--mcp-config" in args:
    cfg = json.load(open(args[args.index("--mcp-config") + 1]))["mcpServers"]["thinrouter"]
    helper = subprocess.Popen([cfg["command"]] + cfg["args"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, bufsize=1)
    def rpc(i, method, params=None):
        msg = {"jsonrpc": "2.0", "id": i, "method": method}
        if params is not None: msg["params"] = params
        helper.stdin.write(json.dumps(msg) + "\n"); helper.stdin.flush()
        while True:
            r = json.loads(helper.stdout.readline())
            if r.get("id") == i: return r
    rpc(1, "initialize", {"protocolVersion": "2025-06-18"})
    helper.stdin.write(json.dumps({"jsonrpc": "2.0", "method": "notifications/initialized"}) + "\n"); helper.stdin.flush()
    tools = rpc(2, "tools/list")["result"]["tools"]
def out(o): sys.stdout.write(json.dumps(o) + "\n"); sys.stdout.flush()
def ev(e): out({"type": "stream_event", "event": e})
def message(mid, blocks, stop):
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
    with open(os.path.join(d, "turns.txt"), "a") as f: f.write(line)
    with open(os.path.join(proj, sid + ".jsonl"), "a") as f: f.write(line)
    text = json.dumps(json.loads(line))
    if helper is None or "[tool result" in text:
        message("msg_t%d" % n, [("text", "Hello there")], "end_turn")
    else:
        tid = "toolu_%d_%d" % (os.getpid(), n)
        message("msg_a%d" % n, [("text", "Checking."), ("tool", tid, "mcp__thinrouter__get_weather", {"city": "Taipei"})], "tool_use")
        r = rpc(10 + n, "tools/call", {"name": "get_weather", "arguments": {"city": "Taipei"}})
        res = r["result"]["content"][0]["text"]
        message("msg_b%d" % n, [("text", "Result: " + res + (" (error)" if r["result"].get("isError") else ""))], "end_turn")
    out({"type": "result", "subtype": "success", "is_error": False, "result": "ok"})
"#;

struct Env {
    base: String,
    client: reqwest::Client,
    bin_dir: TempDir,
    child: tokio::process::Child,
    dir: TempDir,
    config_dir: TempDir,
    extra: Vec<String>,
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
    .env_remove("THINROUTER_ADMIN_TOKEN")
    .env_remove("THINROUTER_SECRETS_KEY")
    .env("CLAUDE_CONFIG_DIR", config_dir.path())
    .kill_on_drop(true)
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null());
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

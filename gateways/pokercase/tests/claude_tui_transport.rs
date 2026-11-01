#[allow(dead_code)]
#[path = "../src/claude_tui.rs"]
mod transport;

use serde_json::{json, Value};
use transport::{interactive_args, paste_text, session_id, transcript_path, Lines, Tap};

fn args() -> Vec<String> {
    [
        "-p",
        "--input-format",
        "stream-json",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--verbose",
        "--model",
        "selected-model",
        "--tools",
        "",
        "--strict-mcp-config",
        "--setting-sources",
        "",
        "--mcp-config",
        "/owned/mcp.json",
        "--allowedTools",
        "mcp__owned__Read",
    ]
    .map(str::to_string)
    .to_vec()
}
const SID: &str = "11111111-1111-4111-8111-111111111111";

#[test]
fn interactive_keeps_scope_and_never_bypasses_permissions() {
    let out = interactive_args(&args(), SID).unwrap();
    for omitted in ["-p", "--input-format", "--output-format", "--verbose"] {
        assert!(!out.iter().any(|v| v == omitted));
    }
    for pair in [
        ["--model", "selected-model"],
        ["--tools", ""],
        ["--setting-sources", ""],
        ["--mcp-config", "/owned/mcp.json"],
        ["--allowedTools", "mcp__owned__Read"],
        ["--permission-mode", "default"],
        ["--session-id", SID],
    ] {
        assert!(out.windows(2).any(|p| p == pair));
    }
    for flag in [
        "--dangerously-skip-permissions",
        "--allow-dangerously-skip-permissions",
        "--no-session-persistence",
        "--permission-mode=bypassPermissions",
        "--print=payload",
    ] {
        let mut a = args();
        a.push(flag.into());
        assert!(interactive_args(&a, SID).is_err());
    }
}

#[test]
fn resume_and_transcript_are_exact_and_confined() {
    let mut a = args();
    a.extend(["--resume".into(), SID.into()]);
    assert_eq!(session_id(&a).unwrap(), SID);
    let out = interactive_args(&a, SID).unwrap();
    assert!(!out.iter().any(|s| s == "--session-id"));
    assert_eq!(
        transcript_path(
            std::path::Path::new("/profile"),
            std::path::Path::new("/owned/work_dir"),
            SID
        )
        .unwrap(),
        std::path::Path::new("/profile/projects/-owned-work-dir").join(format!("{SID}.jsonl"))
    );
    assert!(transcript_path(
        std::path::Path::new("/profile"),
        std::path::Path::new("/work"),
        "../../private"
    )
    .is_err());
    a.push("--resume".into());
    a.push(SID.into());
    assert!(session_id(&a).is_err());
}

#[test]
fn paste_never_becomes_terminal_or_cli_command() {
    for text in ["\x1b[201~!rm\r", "hello\0world", "x\u{85}y", "\u{7f}"] {
        assert!(paste_text(text).is_err());
    }
    for text in ["/login", "  !command", "\n#memory", " &background"] {
        assert!(paste_text(text).unwrap().starts_with("[user message]\n"));
    }
    assert_eq!(
        paste_text("繁體\r\n測試\r下一行").unwrap(),
        "繁體\n測試\n下一行"
    );
    assert!(paste_text(" \n\t").is_err());
}

#[test]
fn split_json_rows_never_drop_partial_or_malformed_input() {
    let mut lines = Lines::default();
    assert!(lines.push(b"{\"type\":").unwrap().is_empty());
    assert!(lines.finish().is_err());
    assert_eq!(
        lines.push(b"\"event\"}\n").unwrap(),
        vec![json!({"type":"event"})]
    );
    lines.finish().unwrap();
    assert!(lines.push(b"broken\n").is_err());
}

fn open(t: &mut Tap, n: u64, id: &str) -> Vec<Value> {
    t.row(json!({"tap":"on"}), SID).unwrap();
    t.row(json!({"s":n,"open":true}), SID).unwrap();
    t.row(json!({"s":n,"e":{"type":"message_start","message":{"id":id,"usage":{"input_tokens":3,"cache_read_input_tokens":4,"cache_creation_input_tokens":0}}}}), SID).unwrap()
}

#[test]
fn tap_streams_real_deltas_and_preserves_usage_but_waits_for_clean_terminal() {
    let mut t = Tap::default();
    let start = open(&mut t, 1, "msg1");
    assert_eq!(
        start[0]["event"]["message"]["usage"]["cache_read_input_tokens"],
        4
    );
    let event = json!({"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"incremental"}});
    assert_eq!(
        t.row(json!({"s":1,"e":event}), SID).unwrap()[0]["event"],
        event
    );
    let terminal = json!({"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":9}});
    assert_eq!(
        t.row(json!({"s":1,"e":terminal}), SID).unwrap()[0]["event"],
        terminal
    );
    assert!(t
        .row(json!({"s":1,"e":{"type":"message_stop"}}), SID)
        .unwrap()
        .is_empty());
    assert!(t.finish().is_err());
    assert_eq!(
        t.row(json!({"s":1,"end":"done"}), SID).unwrap()[0]["event"]["type"],
        "message_stop"
    );
    t.finish().unwrap();
    assert!(t.row(json!({"s":1,"end":"done"}), SID).unwrap().is_empty());
}

#[test]
fn tap_cut_absence_errors_and_duplicate_messages_cannot_forge_success() {
    let mut t = Tap::default();
    assert!(t.row(json!({"tap":"none"}), SID).is_err());
    assert!(t.row(json!({"s":1,"open":true}), SID).is_err());
    open(&mut t, 1, "msg1");
    assert!(t.row(json!({"s":1,"end":"cut"}), SID).is_err());
    assert!(t.row(json!({"s":1,"end":"done"}), SID).is_err());
    let error = t
        .row(
            json!({"s":1,"e":{"type":"error","error":{"message":"secret payload"}}}),
            SID,
        )
        .unwrap_err();
    assert!(!error.to_string().contains("secret"));
    // A failed transport is retired; prove dedup on a separate clean stream.
    let mut t = Tap::default();
    open(&mut t, 1, "msg1");
    t.row(
        json!({"s":1,"e":{"type":"message_delta","delta":{"stop_reason":"end_turn"}}}),
        SID,
    )
    .unwrap();
    t.row(json!({"s":1,"e":{"type":"message_stop"}}), SID)
        .unwrap();
    t.row(json!({"s":1,"end":"done"}), SID).unwrap();
    assert!(open(&mut t, 2, "msg1").is_empty());
    assert!(t
        .row(
            json!({"s":2,"e":{"type":"message_delta","delta":{"stop_reason":"tool_use"}}}),
            SID
        )
        .unwrap()
        .is_empty());
    assert!(t
        .row(json!({"s":2,"e":{"type":"message_stop"}}), SID)
        .unwrap()
        .is_empty());
    assert!(t.row(json!({"s":2,"end":"done"}), SID).unwrap().is_empty());
}

#[test]
fn synthetic_node_tap_preserves_requests_and_split_sse_and_rejects_truncation() {
    let dir = tempfile::tempdir().unwrap();
    let tap = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/claude_tui/tap.js");
    let out = dir.path().join("tap.jsonl");
    std::fs::write(&out, "").unwrap();
    let script = r#"
const assert = require('assert');
const fs = require('fs');
let originalInput, originalInit;
const valid = 'data: {"type":"message_start","message":{"id":"m","usage":{"input_tokens":1}}}\r\n\r\n' +
 'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"繁體"}}\r\n\r\n' +
 'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":2}}\r\n\r\n' +
 'data: {"type":"message_stop"}\r\n\r\n';
let payload=valid, status=200;
const rejected=new Error('PRIVATE_REJECTION_CANARY');
class Real {async fetch(input,init) {
 assert.strictEqual(input,originalInput);assert.strictEqual(init,originalInit);
 if(status===0) throw rejected;
 const bytes=new TextEncoder().encode(payload);
 return new Response(new ReadableStream({start(c){for(const b of bytes)c.enqueue(new Uint8Array([b]));c.close();}}),{status,headers:{'content-type':'text/event-stream'}});
}}
globalThis.Bun={FetchSession:Real};
require(process.argv[1]);
assert.strictEqual(process.env.THINROUTER_CLAUDE_TAP,undefined);
assert.strictEqual(process.env.BUN_OPTIONS,undefined);
(async()=>{
 for(const text of [valid,'data: {"type":"message_start"}']) {
  payload=text;originalInput='https://synthetic.invalid/v1/messages';
  originalInit={headers:{'x-claude-code-request-class':'main','authorization':'synthetic-only'},body:'unchanged'};
  const response=await new Bun.FetchSession().fetch(originalInput,originalInit);
  assert.strictEqual(await response.text(),text);
 }
 for (const code of [401,429]) {
  status=code;payload='PRIVATE_RESPONSE_CANARY';
  const response=await new Bun.FetchSession().fetch(originalInput,originalInit);
  assert.strictEqual(await response.text(),payload);
 }
 await new Promise(r=>setTimeout(r,20));
 const rows=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(JSON.parse);
 assert(rows.some(r=>r.http_status===401));
 assert(rows.some(r=>r.http_status===429));
 assert(!JSON.stringify(rows).includes('PRIVATE_RESPONSE_CANARY'));
 status=0;
 await assert.rejects(new Bun.FetchSession().fetch(originalInput,originalInit),e=>e===rejected);
 const last=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(JSON.parse).at(-1);
 assert.deepStrictEqual(last,{tap:'request_failed'});
 assert.deepStrictEqual(rows[0],{tap:'on'});
 assert.strictEqual(rows.filter(r=>r.s===1&&r.e).length,4);
 assert(rows.some(r=>r.s===1&&r.e?.delta?.text==='繁體'));
 assert(rows.some(r=>r.s===1&&r.end==='done'));
 assert(rows.some(r=>r.s===2&&r.end==='cut'));
 assert(!rows.some(r=>r.s===2&&r.end==='done'));
})().catch(error=>{console.error(error);process.exitCode=1});
"#;
    let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|p| p.join("node"))
        .find(|p| p.is_file())
        .expect("installed Node is on PATH");
    let result = std::process::Command::new(node)
        .arg("-e")
        .arg(script)
        .arg(tap)
        .arg(&out)
        .env_clear()
        .env("THINROUTER_CLAUDE_TAP", &out)
        .env("BUN_OPTIONS", "--preload thinrouter-claude-tui-test")
        .output()
        .expect("installed Node runs synthetic observer test");
    assert!(
        result.status.success(),
        "synthetic Node response tap failed: {}",
        String::from_utf8_lossy(&result.stderr)
    );
}

#[test]
fn tap_budget_exhaustion_leaves_a_fixed_failure_record() {
    let dir = tempfile::tempdir().unwrap();
    let tap = dir.path().join("tap.js");
    // Scale only the file budget in a private harness copy; production has no
    // environment override. Exercise the same writer and asynchronous reader.
    let source = include_str!("../src/claude_tui/tap.js");
    assert!(source.contains("64 * 1024 * 1024 - 1024"));
    std::fs::write(&tap, source.replace("64 * 1024 * 1024 - 1024", "1024")).unwrap();
    let out = dir.path().join("tap.jsonl");
    std::fs::write(&out, "").unwrap();
    let script = r#"
const assert = require('assert'), fs = require('fs');
const data='data: '+JSON.stringify({type:'content_block_delta',delta:{text:'x'.repeat(2000)}})+'\n\n';
globalThis.Bun={FetchSession:class {async fetch(){return new Response(data,{headers:{'content-type':'text/event-stream'}})}}};
require(process.argv[1]);
(async()=>{
 const response=await new Bun.FetchSession().fetch('https://synthetic.invalid/v1/messages',{headers:{'x-claude-code-request-class':'main'}});
 assert.strictEqual(await response.text(),data);
 await new Promise(r=>setTimeout(r,20));
 const rows=fs.readFileSync(process.argv[2],'utf8').trim().split('\n').map(JSON.parse);
 assert.deepStrictEqual(rows.at(-1),{tap:'limit'});
 assert.strictEqual(rows.filter(r=>r.tap==='limit').length,1);
 assert(!rows.some(r=>r.end==='done'));
})().catch(e=>{console.error(e);process.exitCode=1});
"#;
    let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|p| p.join("node"))
        .find(|p| p.is_file())
        .expect("installed Node is on PATH");
    let result = std::process::Command::new(node)
        .args(["-e", script])
        .arg(tap)
        .arg(&out)
        .env_clear()
        .env("THINROUTER_CLAUDE_TAP", &out)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(Tap::default().row(json!({"tap":"limit"}), SID).is_err());
}

#[test]
fn overlapping_streams_fail_closed_and_known_statuses_are_redacted() {
    let mut tap = Tap::default();
    open(&mut tap, 1, "first");
    assert!(tap.row(json!({"s":2,"open":true}), SID).is_err());
    for (status, expected) in [
        (401, "authentication"),
        (429, "usage limit"),
        (403, "upstream request failed"),
    ] {
        let mut tap = Tap::default();
        tap.row(json!({"tap":"on"}), SID).unwrap();
        tap.row(json!({"s":1,"open":true}), SID).unwrap();
        let error = tap
            .row(
                json!({"s":1,"http_status":status,"body":"PRIVATE_CANARY"}),
                SID,
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains(expected));
        assert!(!error.contains("PRIVATE_CANARY"));
    }
}

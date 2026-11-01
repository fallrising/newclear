//! Process cuts around production Store calls, not HTTP or provider execution.

use super::{ClaudeReportedUsage, Store, StreamFinalization};
use rusqlite::{types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Map, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Read;
use std::os::unix::process::ExitStatusExt;
use std::path::Path;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

const TEST: &str = "store::crash_recovery_tests::m10_storage_boundaries_survive_sigkill";
const CHILD_ENV: &str = "THINROUTER_M10_STORAGE_CHILD";
const DEADLINE: Duration = Duration::from_secs(10);

struct OwnedChild(Child);

impl Drop for OwnedChild {
    fn drop(&mut self) {
        if self.0.try_wait().ok().flatten().is_none() {
            let _ = self.0.kill();
        }
        let _ = self.0.wait();
    }
}

fn owner_file(db: &Path) -> File {
    OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(db.with_extension("usage-lock"))
        .unwrap()
}

fn source(family: &str) -> &'static str {
    match family {
        "http" => "openai_chat_v1",
        "claude" => "claude_code_stream_event_v1",
        "cursor" => "cursor_cli_result_v1",
        _ => panic!("invalid storage family"),
    }
}

fn terminal(family: &str) -> (StreamFinalization, ClaudeReportedUsage) {
    let reported = ClaudeReportedUsage {
        input_tokens: Some(5),
        output_tokens: Some(0),
        cache_read_input_tokens: Some(0),
        cache_creation_input_tokens: Some(2),
    };
    let result = StreamFinalization {
        outcome: "succeeded",
        usage_status: if family == "cursor" {
            "partial"
        } else {
            "complete"
        },
        prompt_tokens: match family {
            "http" => Some(11),
            "claude" => Some(7),
            "cursor" => None,
            _ => panic!("invalid storage family"),
        },
        completion_tokens: Some(0),
        estimated_cost_usd: (family == "http").then_some(0.0),
        first_output_ms: Some(0),
        total_observed_ms: 31,
        ..Default::default()
    };
    (result, reported)
}

fn finalize(
    store: &Store,
    family: &str,
    attempt: &str,
    result: &StreamFinalization,
    raw: &ClaudeReportedUsage,
) {
    let changed = match family {
        "http" => store.finalize_stream_attempt(attempt, result),
        "claude" => store.finalize_claude_attempt(attempt, result, raw),
        "cursor" => store.finalize_cursor_attempt(attempt, result, raw),
        _ => panic!("invalid storage family"),
    };
    assert!(changed.unwrap());
}

// The child acknowledges the exact call boundary, then cannot continue until
// the parent's pipe is released. The test always kills it instead of releasing.
fn barrier(dir: &Path, family: &str, phase: &str, request: &str, attempt: &str) {
    let ack = json!({
        "family": family, "phase": phase, "pid": std::process::id(),
        "request_id": request, "attempt_id": attempt,
    });
    fs::write(dir.join("ack.tmp"), serde_json::to_vec(&ack).unwrap()).unwrap();
    fs::rename(dir.join("ack.tmp"), dir.join("ack.json")).unwrap();
    let mut byte = [0];
    std::io::stdin().read_exact(&mut byte).unwrap();
    panic!("storage barrier must terminate with SIGKILL");
}

fn child_case(dir: &Path, family: &str, phase: &str) {
    assert!(dir.is_absolute() && dir.is_dir());
    assert!(matches!(
        phase,
        "reserved" | "pre_finalize" | "post_finalize"
    ));
    let db = dir.join("synthetic.db");
    let owner = owner_file(&db);
    owner.try_lock().unwrap();
    let store = Store::open(&db, None).unwrap();
    assert_eq!(store.recover_stream_attempts().unwrap(), 0);
    let request = format!("synthetic-{family}-{phase}");
    let history = store
        .begin_stream_attempt(&request, "history", "synthetic-history", "synthetic")
        .unwrap();
    store.observe_stream_headers(&history, 200, 5).unwrap();
    assert!(store
        .finalize_stream_attempt(
            &history,
            &StreamFinalization {
                outcome: "succeeded",
                usage_status: "complete",
                prompt_tokens: Some(0),
                completion_tokens: Some(7),
                estimated_cost_usd: Some(1.25),
                first_output_ms: Some(0),
                total_observed_ms: 29,
                ..Default::default()
            },
        )
        .unwrap());
    let attempt = store
        .begin_stream_attempt_with_source(
            &request,
            "target",
            "synthetic-target",
            "synthetic-upstream",
            source(family),
        )
        .unwrap();
    if phase == "reserved" {
        barrier(dir, family, phase, &request, &attempt);
    }
    // Synthetic observations exercise persistence only. No dispatch occurs.
    if family == "http" {
        store.observe_stream_headers(&attempt, 200, 8).unwrap();
    } else {
        store.observe_cli_ready(&attempt, 7).unwrap();
    }
    let (result, raw) = terminal(family);
    if phase == "pre_finalize" {
        barrier(dir, family, phase, &request, &attempt);
    }
    finalize(&store, family, &attempt, &result, &raw);
    barrier(dir, family, "post_finalize", &request, &attempt);
}

// A separate read-only connection proves committed SQLite values, independent
// of Store::recent_usage and the child's in-memory finalization observations.
fn rows(db: &Path) -> Vec<Value> {
    let conn = Connection::open_with_flags(db, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
    let mut stmt = conn
        .prepare("SELECT * FROM usage_events ORDER BY id")
        .unwrap();
    let names: Vec<String> = stmt
        .column_names()
        .iter()
        .map(|s| (*s).to_owned())
        .collect();
    let result = stmt
        .query_map([], |row| {
            let mut result = Map::new();
            for (i, name) in names.iter().enumerate() {
                let value = match row.get_ref(i)? {
                    ValueRef::Null => Value::Null,
                    ValueRef::Integer(n) => json!(n),
                    ValueRef::Real(n) => json!(n),
                    ValueRef::Text(s) => json!(std::str::from_utf8(s).unwrap()),
                    ValueRef::Blob(_) => panic!("unexpected usage blob"),
                };
                result.insert(name.clone(), value);
            }
            Ok(Value::Object(result))
        })
        .unwrap()
        .collect::<rusqlite::Result<Vec<_>>>()
        .unwrap();
    result
}

fn await_ack(child: &mut Child, dir: &Path) -> Value {
    let deadline = Instant::now() + DEADLINE;
    loop {
        assert!(
            child.try_wait().unwrap().is_none(),
            "storage child exited before barrier"
        );
        if let Ok(bytes) = fs::read(dir.join("ack.json")) {
            return serde_json::from_slice(&bytes).unwrap();
        }
        assert!(Instant::now() < deadline, "storage barrier deadline");
        // Poll only for an explicit acknowledgement, never infer a cut by time.
        std::thread::sleep(Duration::from_millis(5));
    }
}

fn recover_once(db: &Path) -> (usize, Vec<Value>) {
    let owner = owner_file(db);
    owner.try_lock().unwrap();
    let store = Store::open(db, None).unwrap();
    let count = store.recover_stream_attempts().unwrap();
    let snapshot = rows(db);
    drop(store);
    drop(owner);
    (count, snapshot)
}

fn assert_target(row: &Value, family: &str, phase: &str) {
    assert_eq!(row["public_model"], "target");
    assert_eq!(row["connection_id"], "synthetic-target");
    assert_eq!(row["upstream_model"], "synthetic-upstream");
    assert_eq!(row["usage_source"], source(family));
    let observed = phase != "reserved";
    assert_eq!(
        row["status"],
        if observed && family == "http" {
            json!(200)
        } else {
            Value::Null
        }
    );
    assert_eq!(
        row["headers_ms"],
        if observed && family == "http" {
            json!(8)
        } else {
            Value::Null
        }
    );
    assert_eq!(
        row["cli_ready_ms"],
        if observed && family != "http" {
            json!(7)
        } else {
            Value::Null
        }
    );
    assert_eq!(
        row["latency_ms"],
        if !observed {
            Value::Null
        } else if family == "http" {
            json!(8)
        } else {
            json!(7)
        }
    );
    let finalized = phase == "post_finalize";
    for field in [
        "prompt_tokens",
        "completion_tokens",
        "estimated_cost_usd",
        "first_output_ms",
        "total_observed_ms",
        "reported_input_tokens",
        "reported_output_tokens",
        "reported_cache_read_input_tokens",
        "reported_cache_creation_input_tokens",
    ] {
        if !finalized {
            assert!(row[field].is_null(), "pending {field} must remain unknown");
        }
    }
    assert!(row["error"].is_null());
    if finalized {
        assert!(row["finalized_at"].is_string());
        assert_eq!(row["outcome"], "succeeded");
        assert_eq!(
            row["usage_status"],
            if family == "cursor" {
                "partial"
            } else {
                "complete"
            }
        );
        assert_eq!(
            row["prompt_tokens"],
            match family {
                "http" => json!(11),
                "claude" => json!(7),
                _ => Value::Null,
            }
        );
        assert_eq!(row["completion_tokens"], 0);
        assert_eq!(
            row["estimated_cost_usd"],
            if family == "http" {
                json!(0.0)
            } else {
                Value::Null
            }
        );
        assert_eq!(row["first_output_ms"], 0);
        assert_eq!(row["total_observed_ms"], 31);
        for (field, expected) in [
            ("reported_input_tokens", 5),
            ("reported_output_tokens", 0),
            ("reported_cache_read_input_tokens", 0),
            ("reported_cache_creation_input_tokens", 2),
        ] {
            assert_eq!(
                row[field],
                if family == "http" {
                    Value::Null
                } else {
                    json!(expected)
                }
            );
        }
    } else {
        assert!(row["finalized_at"].is_null());
        assert_eq!(row["outcome"], "unknown");
        assert_eq!(row["usage_status"], "missing");
    }
}

fn run_case(family: &str, phase: &str) -> Value {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("synthetic.db");
    let mut child = OwnedChild(
        Command::new(std::env::current_exe().unwrap())
            .args(["--exact", TEST, "--nocapture", "--test-threads=1"])
            .env_clear()
            .env(CHILD_ENV, "1")
            .env("THINROUTER_M10_DIR", dir.path())
            .env("THINROUTER_M10_FAMILY", family)
            .env("THINROUTER_M10_PHASE", phase)
            .env("HOME", dir.path())
            .current_dir(dir.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap(),
    );
    let ack = await_ack(&mut child.0, dir.path());
    assert_eq!(ack["pid"], child.0.id());
    assert_eq!(ack["family"], family);
    assert_eq!(ack["phase"], phase);
    assert_eq!(ack["request_id"], format!("synthetic-{family}-{phase}"));
    let before = rows(&db);
    assert_eq!(before.len(), 2);
    assert_eq!(before[1]["attempt_id"], ack["attempt_id"]);
    assert_eq!(before[0]["request_id"], ack["request_id"]);
    assert_eq!(before[1]["request_id"], ack["request_id"]);
    assert_ne!(before[0]["attempt_id"], before[1]["attempt_id"]);
    assert_eq!(before[0]["prompt_tokens"], 0);
    assert_eq!(before[0]["completion_tokens"], 7);
    assert_eq!(before[0]["estimated_cost_usd"], 1.25);
    assert_target(&before[1], family, phase);
    let contender = owner_file(&db);
    assert!(
        matches!(contender.try_lock(), Err(std::fs::TryLockError::WouldBlock)),
        "live owner must exclude recovery"
    );
    assert_eq!(rows(&db), before);
    drop(contender);
    assert!(child.0.try_wait().unwrap().is_none());
    child.0.kill().unwrap(); // std Child::kill is SIGKILL on Unix.
    let exit = child.0.wait().unwrap();
    assert_eq!(exit.signal(), Some(libc::SIGKILL));
    let after_kill = rows(&db);
    assert_eq!(after_kill, before, "SIGKILL must not create observations");
    let (first_count, after) = recover_once(&db);
    let (second_count, second) = recover_once(&db);
    assert_eq!(first_count, usize::from(phase != "post_finalize"));
    assert_eq!(second_count, 0);
    assert_eq!(after, second);
    assert_eq!(after[0], before[0], "finalized history must not change");
    let mut expected = before[1].clone();
    if phase != "post_finalize" {
        assert!(after[1]["finalized_at"].is_string());
        expected["finalized_at"] = after[1]["finalized_at"].clone();
        expected["outcome"] = json!("interrupted");
        expected["usage_status"] = json!("missing");
        expected["error"] = json!("stream_interrupted");
    }
    assert_eq!(after[1], expected, "recover only unresolved fields once");
    drop(child);
    let path = dir.path().to_owned();
    dir.close().unwrap();
    assert!(!path.exists());
    json!({
        "name": format!("{family}_{phase}"), "family": family, "phase": phase,
        "ack": ack, "before_rows": before, "after_kill_rows": after_kill,
        "after_rows": after, "second_rows": second,
        "recovery_counts": [first_count, second_count],
        "lock_denied_while_child_alive": true, "signal": exit.signal(),
        "owned_child_reaped": true, "history_unchanged": true,
        "temporary_state_removed": !path.exists(),
    })
}

#[test]
fn m10_storage_boundaries_survive_sigkill() {
    if std::env::var(CHILD_ENV).as_deref() == Ok("1") {
        child_case(
            Path::new(&std::env::var("THINROUTER_M10_DIR").unwrap()),
            &std::env::var("THINROUTER_M10_FAMILY").unwrap(),
            &std::env::var("THINROUTER_M10_PHASE").unwrap(),
        );
        unreachable!("storage child must be killed");
    }
    let mut cases = Vec::new();
    for family in ["http", "claude", "cursor"] {
        for phase in ["reserved", "pre_finalize", "post_finalize"] {
            cases.push(run_case(family, phase));
        }
    }
    if let Some(path) = std::env::var_os("THINROUTER_M10_REPORT_PATH") {
        let report = json!({
            "schema_version": 1, "kind": "storage_process", "status": "passed",
            "compiled_manifest_dir": env!("CARGO_MANIFEST_DIR"),
            "compiled_source_file": file!(),
            "cases": cases, "no_http_inference": true,
            "dispatch_basis": "production_store_calls_only_no_dispatch",
            "live_client_version_provider_verified": false,
            "whole_round_metrics": null,
        });
        fs::write(path, serde_json::to_vec_pretty(&report).unwrap()).unwrap();
    }
}

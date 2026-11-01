use codebox_event_store::{BeginSubmission, SubmissionStore, SubmissionStoreError};
use serde_json::{Value, json};
use std::os::unix::fs::PermissionsExt;
use std::sync::{Arc, Barrier};
use tempfile::{TempDir, tempdir};
use uuid::Uuid;
fn root() -> TempDir {
    let root = tempdir().unwrap();
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    root
}
fn key() -> String {
    Uuid::new_v4().to_string()
}
fn request() -> Value {
    json!({"project_id":"00000000-0000-4000-8000-000000000001", "base_sha":"a".repeat(40), "profile_revision":"00000000-0000-4000-8000-000000000004","title":"task", "goal":"do work"})
}
fn run() -> Value {
    json!({"id":"00000000-0000-4000-8000-000000000003", "task_id":"00000000-0000-4000-8000-000000000002", "base_sha":"a".repeat(40), "profile_revision":request()["profile_revision"], "goal":"do work", "state":"queued", "state_version":1,"last_event_seq":1,"cleanup_state":"pending","result":null})
}
fn receipt() -> Value {
    json!({"task":{"id":run()["task_id"],"project_id":request()["project_id"],"title":"task"},"run":run()})
}
#[test]
fn admission_is_durable_before_dispatch_and_reopen_preserves_receipt() {
    let root = root();
    let path = root.path().join("submissions.db");
    let key = key();
    let store = SubmissionStore::open(path.clone()).unwrap();
    assert_eq!(
        store.begin("alice", &key, &request()).unwrap(),
        BeginSubmission::Started
    );
    drop(store);
    let store = SubmissionStore::open(path.clone()).unwrap();
    let list = store.list("alice").unwrap();
    assert_eq!(list["blocked"], true);
    assert_eq!(list["items"][0]["request"], request());
    assert_eq!(list["items"][0]["state"], "unknown");
    store.confirm("alice", &key, &receipt()).unwrap();
    drop(store);
    let store = SubmissionStore::open(path).unwrap();
    assert_eq!(
        store.list("alice").unwrap()["items"][0]["receipt"],
        receipt()
    );
    assert!(matches!(
        store.begin("alice", &key, &request()).unwrap(),
        BeginSubmission::Existing(_)
    ));
}
#[test]
fn concurrent_duplicate_claims_have_exactly_one_winner() {
    let root = root();
    let path = root.path().join("submissions.db");
    SubmissionStore::open(path.clone()).unwrap();
    let barrier = Arc::new(Barrier::new(8));
    let key = key();
    let threads: Vec<_> = (0..8)
        .map(|_| {
            let path = path.clone();
            let barrier = barrier.clone();
            let key = key.clone();
            std::thread::spawn(move || {
                let store = SubmissionStore::open(path).unwrap();
                barrier.wait();
                store.begin("alice", &key, &request()).unwrap()
            })
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(
        results
            .iter()
            .filter(|r| **r == BeginSubmission::Started)
            .count(),
        1
    );
}
#[test]
fn payload_conflict_unknown_barrier_owner_isolation_and_rejection() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    let first = key();
    store.begin("alice", &first, &request()).unwrap();
    let mut changed = request();
    changed["goal"] = json!("different");
    assert_eq!(
        store.begin("alice", &first, &changed),
        Err(SubmissionStoreError::Conflict)
    );
    assert_eq!(
        store.begin("alice", &key(), &request()).unwrap(),
        BeginSubmission::BlockedUnknown
    );
    assert_eq!(
        store.begin("bob", &first, &request()).unwrap(),
        BeginSubmission::Started
    );
    assert_eq!(store.list("charlie").unwrap()["items"], json!([]));
    store.reject("alice", &first).unwrap();
    assert!(matches!(
        store.begin("alice", &first, &request()).unwrap(),
        BeginSubmission::Existing(_)
    ));
    assert_eq!(
        store.begin("alice", &key(), &request()).unwrap(),
        BeginSubmission::Started
    );
    assert_eq!(
        store.confirm("alice", &first, &receipt()),
        Err(SubmissionStoreError::Conflict)
    );
}
#[test]
fn receipt_identity_and_unique_run_binding_cannot_change() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    let first = key();
    store.begin("alice", &first, &request()).unwrap();
    let mut bad = receipt();
    bad["run"]["base_sha"] = json!("b".repeat(40));
    assert!(store.confirm("alice", &first, &bad).is_err());
    store.confirm("alice", &first, &receipt()).unwrap();
    store.confirm("alice", &first, &receipt()).unwrap();
    let second = key();
    store.begin("alice", &second, &request()).unwrap();
    assert_eq!(
        store.confirm("alice", &second, &receipt()),
        Err(SubmissionStoreError::Conflict)
    );
    let mut changed = receipt();
    changed["run"]["id"] = json!(key());
    assert_eq!(
        store.confirm("alice", &first, &changed),
        Err(SubmissionStoreError::Conflict)
    );
}
#[test]
fn projection_reopens_ignores_stale_and_preserves_immutable_result() {
    let root = root();
    let path = root.path().join("submissions.db");
    let store = SubmissionStore::open(path.clone()).unwrap();
    let first = store.observe("alice", &run()).unwrap();
    assert_eq!(first["cursor"], 1);
    assert_eq!(store.observe("alice", &run()).unwrap(), first);
    let mut result = run();
    result["state_version"] = json!(2);
    result["last_event_seq"] = json!(2);
    result["state"] = json!("succeeded");
    result["result"] = json!({"diff":"exact\nbytes","checks":["ok"]});
    let saved = store.observe("alice", &result).unwrap();
    assert_eq!(saved["cursor"], 2);
    assert_eq!(store.observe("alice", &run()).unwrap(), saved);
    drop(store);
    let store = SubmissionStore::open(path).unwrap();
    assert_eq!(store.observe("alice", &result).unwrap(), saved);
    let mut changed = result.clone();
    changed["result"]["diff"] = json!("changed");
    assert_eq!(
        store.observe("alice", &changed),
        Err(SubmissionStoreError::Conflict)
    );
    changed = result.clone();
    changed["base_sha"] = json!("b".repeat(40));
    assert_eq!(
        store.observe("alice", &changed),
        Err(SubmissionStoreError::Conflict)
    );
    result["cleanup_state"] = json!("complete");
    result["last_event_seq"] = json!(3);
    assert_eq!(store.observe("alice", &result).unwrap()["cursor"], 3);
    assert_eq!(store.list("alice").unwrap()["items"], json!([]));
}
#[test]
fn observation_history_is_bounded_with_monotonic_cursor_and_owner_isolation() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    let mut snapshot = run();
    let mut observed = Value::Null;
    for version in 1..=140 {
        snapshot["state_version"] = json!(version);
        snapshot["last_event_seq"] = json!(version);
        observed = store.observe("alice", &snapshot).unwrap();
    }
    assert_eq!(observed["cursor"], 140);
    assert_eq!(observed["events"].as_array().unwrap().len(), 128);
    assert_eq!(observed["events"][0]["cursor"], 13);
    assert_eq!(observed["history_truncated"], true);
    assert_eq!(store.observe("bob", &run()).unwrap()["cursor"], 1);
}
#[test]
fn paths_schema_and_errors_fail_closed_without_secret_disclosure() {
    let root = root();
    let path = root.path().join("submissions.db");
    assert!(SubmissionStore::open("relative-secret.db".into()).is_err());
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o755)).unwrap();
    assert!(SubmissionStore::open(path.clone()).is_err());
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    std::fs::write(&path, b"not sqlite SECRET").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let error = SubmissionStore::open(path.clone()).unwrap_err();
    assert!(!format!("{error:?} {error}").contains("SECRET"));
    std::fs::remove_file(&path).unwrap();
    SubmissionStore::open(path.clone()).unwrap();
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch("DROP TABLE submissions;")
        .unwrap();
    assert!(SubmissionStore::open(path).is_err());
}
#[test]
fn invalid_or_oversized_inputs_never_create_intents() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    assert!(store.begin("alice", "invalid", &request()).is_err());
    let mut body = request();
    body["password"] = json!("secret");
    assert!(store.begin("alice", &key(), &body).is_err());
    body = request();
    body["goal"] = json!("x".repeat(65536));
    assert!(store.begin("alice", &key(), &body).is_err());
    assert_eq!(store.list("alice").unwrap()["items"], json!([]));
}

#[test]
fn confirmation_cannot_rebind_an_observed_legacy_run() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    store.observe("alice", &run()).unwrap();
    let intent = key();
    store.begin("alice", &intent, &request()).unwrap();
    let mut changed = receipt();
    changed["task"]["id"] = json!(key());
    changed["run"]["task_id"] = changed["task"]["id"].clone();
    assert_eq!(
        store.confirm("alice", &intent, &changed),
        Err(SubmissionStoreError::Conflict)
    );
}
#[test]
fn different_key_race_has_one_winner_and_one_unknown_barrier() {
    let root = root();
    let path = root.path().join("submissions.db");
    let store = SubmissionStore::open(path).unwrap();
    let barrier = Arc::new(Barrier::new(2));
    let threads: Vec<_> = (0..2)
        .map(|_| {
            let store = store.clone();
            let barrier = barrier.clone();
            std::thread::spawn(move || {
                barrier.wait();
                store.begin("alice", &key(), &request()).unwrap()
            })
        })
        .collect();
    let results: Vec<_> = threads.into_iter().map(|t| t.join().unwrap()).collect();
    assert_eq!(
        results
            .iter()
            .filter(|r| **r == BeginSubmission::Started)
            .count(),
        1
    );
    assert_eq!(
        results
            .iter()
            .filter(|r| **r == BeginSubmission::BlockedUnknown)
            .count(),
        1
    );
}
#[test]
fn recent_page_limit_does_not_hide_an_older_unknown() {
    let root = root();
    let path = root.path().join("submissions.db");
    let store = SubmissionStore::open(path.clone()).unwrap();
    for _ in 0..101 {
        let key = key();
        store.begin("alice", &key, &request()).unwrap();
        store.reject("alice", &key).unwrap();
    }
    // Simulate a retained historic unresolved row independently of admission ordering.
    rusqlite::Connection::open(path)
        .unwrap()
        .execute(
            "UPDATE submissions SET state='unknown' WHERE sequence=1",
            [],
        )
        .unwrap();
    let page = store.list("alice").unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 100);
    assert_eq!(page["blocked"], true);
    assert_eq!(
        store.begin("alice", &key(), &request()).unwrap(),
        BeginSubmission::BlockedUnknown
    );
}
#[test]
fn equal_version_result_arrival_advances_once_and_oversize_is_rejected() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    let mut snapshot = run();
    store.observe("alice", &snapshot).unwrap();
    snapshot["result"] = json!({"diff":"bytes"});
    let saved = store.observe("alice", &snapshot).unwrap();
    assert_eq!(saved["cursor"], 2);
    assert_eq!(store.observe("alice", &snapshot).unwrap(), saved);
    snapshot["result"] = json!({"diff":"x".repeat(2*1024*1024)});
    assert_eq!(
        store.observe("alice", &snapshot),
        Err(SubmissionStoreError::InvalidInput)
    );
}
#[test]
fn busy_writer_times_out_without_claiming_or_leaking_errors() {
    let root = root();
    let path = root.path().join("submissions.db");
    let store = SubmissionStore::open(path.clone()).unwrap();
    let blocker = rusqlite::Connection::open(path).unwrap();
    blocker.execute_batch("BEGIN IMMEDIATE").unwrap();
    let start = std::time::Instant::now();
    assert_eq!(
        store.begin("alice", &key(), &request()),
        Err(SubmissionStoreError::Busy)
    );
    assert!(start.elapsed() < std::time::Duration::from_secs(8));
    blocker.execute_batch("ROLLBACK").unwrap();
    assert_eq!(store.list("alice").unwrap()["items"], json!([]));
}
#[test]
fn incompatible_schema_symlink_open_file_and_removed_database_fail_closed() {
    let root = root();
    let path = root.path().join("submissions.db");
    let store = SubmissionStore::open(path.clone()).unwrap();
    let link = root.path().join("link.db");
    std::os::unix::fs::symlink(&path, &link).unwrap();
    assert_eq!(
        SubmissionStore::open(link).unwrap_err(),
        SubmissionStoreError::InvalidPath
    );
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(
        SubmissionStore::open(path.clone()).unwrap_err(),
        SubmissionStoreError::InvalidPath
    );
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
    rusqlite::Connection::open(&path)
        .unwrap()
        .execute_batch("PRAGMA application_id=1128421425")
        .unwrap();
    assert_eq!(
        SubmissionStore::open(path.clone()).unwrap_err(),
        SubmissionStoreError::Incompatible
    );
    std::fs::remove_file(&path).unwrap();
    assert_eq!(store.list("alice"), Err(SubmissionStoreError::Storage));
    assert!(!path.exists());
}

#[test]
fn list_has_aggregate_byte_bound_without_hiding_unresolved_flag() {
    let root = root();
    let path = root.path().join("submissions.db");
    let store = SubmissionStore::open(path.clone()).unwrap();
    let old = key();
    store.begin("alice", &old, &request()).unwrap();
    store.reject("alice", &old).unwrap();
    for _ in 0..2 {
        let intent = key();
        let mut reply = receipt();
        reply["run"]["id"] = json!(key());
        reply["task"]["id"] = json!(key());
        reply["run"]["task_id"] = reply["task"]["id"].clone();
        reply["run"]["result"] = json!({"diff":"x".repeat(1100 * 1024)});
        store.begin("alice", &intent, &request()).unwrap();
        store.confirm("alice", &intent, &reply).unwrap();
    }
    rusqlite::Connection::open(path)
        .unwrap()
        .execute("UPDATE submissions SET state='unknown' WHERE key=?1", [old])
        .unwrap();
    let page = store.list("alice").unwrap();
    assert!(serde_json::to_vec(&page).unwrap().len() <= 2 * 1024 * 1024);
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["history_truncated"], true);
    assert_eq!(page["blocked"], true);
}

#[test]
fn history_events_remain_compact_while_snapshot_preserves_large_reason() {
    let root = root();
    let store = SubmissionStore::open(root.path().join("submissions.db")).unwrap();
    let mut snapshot = run();
    snapshot["reason"] = json!("r".repeat(512 * 1024));
    let observed = store.observe("alice", &snapshot).unwrap();
    assert_eq!(observed["run"], snapshot);
    assert!(serde_json::to_vec(&observed["events"][0]).unwrap().len() <= 2048);
    snapshot["state"] = json!("s".repeat(65));
    assert_eq!(
        store.observe("alice", &snapshot),
        Err(SubmissionStoreError::InvalidInput)
    );
}

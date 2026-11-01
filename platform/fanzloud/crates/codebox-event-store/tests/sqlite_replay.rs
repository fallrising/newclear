use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use chrono::{TimeZone, Utc};
use codebox_domain::{
    DOMAIN_EVENT_SCHEMA_V1, DomainEvent, DomainEventEnvelope, EventSeq, NewDomainEvent, SessionId,
};
use codebox_event_store::{
    CorruptStoreStage, EventStoreError, MAX_EVENT_PAYLOAD_BYTES, MAX_REPLAY_EVENTS,
    SQLITE_BUSY_TIMEOUT, SqliteEventStore, StorageErrorKind, StorageOperation,
};
use proptest::prelude::*;
use rusqlite::{Connection, params};
use tempfile::{TempDir, tempdir};
use tokio::time::{sleep, timeout};
use uuid::Uuid;

fn private_root() -> TempDir {
    let root = tempdir().expect("private temporary root");
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
        .expect("private root permissions");
    root
}

fn database_path(root: &TempDir) -> PathBuf {
    root.path().join("events.sqlite")
}

fn event(seed: u64) -> NewDomainEvent {
    NewDomainEvent {
        schema_version: DOMAIN_EVENT_SCHEMA_V1,
        occurred_at: Utc
            .timestamp_opt((seed % 1_000_000) as i64, (seed % 1_000_000_000) as u32)
            .single()
            .expect("valid fixed timestamp"),
        causation_id: Some(Uuid::from_u128(u128::from(seed) + 10)),
        correlation_id: Uuid::from_u128(u128::from(seed) + 20),
        payload: if seed.is_multiple_of(2) {
            DomainEvent::ProvisioningFailed
        } else {
            DomainEvent::SessionCreated
        },
    }
}

async fn append_history(
    store: &SqliteEventStore,
    stream: SessionId,
    count: usize,
) -> Vec<DomainEventEnvelope> {
    let inputs = (1..=count)
        .map(|seed| event(seed as u64))
        .collect::<Vec<_>>();
    store
        .append(stream, EventSeq::initial(), inputs)
        .await
        .expect("append replay history")
}

fn sequence_bytes(sequence: u64) -> [u8; 8] {
    sequence.to_be_bytes()
}

#[derive(Debug, Eq, PartialEq)]
struct StoredRow {
    event_id: Vec<u8>,
    stream_id: Vec<u8>,
    seq: Vec<u8>,
    schema_version: i64,
    occurred_at: String,
    causation_id: Option<Vec<u8>>,
    correlation_id: Vec<u8>,
    payload: Vec<u8>,
}

fn stored_rows(path: &Path) -> Vec<StoredRow> {
    let connection = Connection::open(path).expect("open fingerprint connection");
    let mut statement = connection
        .prepare(
            "SELECT event_id, stream_id, seq, schema_version, occurred_at, causation_id,
                    correlation_id, payload
             FROM events
             ORDER BY stream_id, seq",
        )
        .expect("prepare fingerprint");
    statement
        .query_map([], |row| {
            Ok(StoredRow {
                event_id: row.get(0)?,
                stream_id: row.get(1)?,
                seq: row.get(2)?,
                schema_version: row.get(3)?,
                occurred_at: row.get(4)?,
                causation_id: row.get(5)?,
                correlation_id: row.get(6)?,
                payload: row.get(7)?,
            })
        })
        .expect("query fingerprint")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect fingerprint")
}

async fn seeded_store() -> (TempDir, PathBuf, SqliteEventStore, SessionId) {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 1).await;
    (root, path, store, stream)
}

#[tokio::test]
async fn load_after_rejects_zero_limit_without_database_access() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    std::fs::remove_file(&path).expect("remove isolated database");

    assert_eq!(
        store
            .load_after(SessionId::new(), EventSeq::initial(), 0)
            .await,
        Err(EventStoreError::InvalidReplayLimit {
            max: MAX_REPLAY_EVENTS,
            actual: 0,
        })
    );
    assert!(!path.exists());
}

#[tokio::test]
async fn load_after_rejects_limit_above_max_without_database_access() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    std::fs::remove_file(&path).expect("remove isolated database");

    assert_eq!(
        store
            .load_after(SessionId::new(), EventSeq::initial(), MAX_REPLAY_EVENTS + 1,)
            .await,
        Err(EventStoreError::InvalidReplayLimit {
            max: MAX_REPLAY_EVENTS,
            actual: MAX_REPLAY_EVENTS + 1,
        })
    );
    assert!(!path.exists());
}

#[tokio::test]
async fn load_after_empty_stream_and_after_high_water_return_empty() {
    let root = private_root();
    let store = SqliteEventStore::open(database_path(&root))
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 2).await;

    assert!(
        store
            .load_after(SessionId::new(), EventSeq::initial(), 8)
            .await
            .expect("unknown stream")
            .is_empty()
    );
    assert!(
        store
            .load_after(stream, EventSeq::new(2), 8)
            .await
            .expect("after high-water")
            .is_empty()
    );
    assert!(
        store
            .load_after(stream, EventSeq::new(u64::MAX), 8)
            .await
            .expect("after domain maximum")
            .is_empty()
    );
}

#[tokio::test]
async fn empty_replay_is_not_stable_end_of_stream() {
    let root = private_root();
    let store = SqliteEventStore::open(database_path(&root))
        .await
        .expect("open store");
    let stream = SessionId::new();

    assert!(
        store
            .load_after(stream, EventSeq::initial(), 8)
            .await
            .expect("initial empty replay")
            .is_empty()
    );
    append_history(&store, stream, 1).await;
    assert_eq!(
        store
            .load_after(stream, EventSeq::initial(), 8)
            .await
            .expect("later replay")
            .len(),
        1
    );
}

#[tokio::test]
async fn load_after_returns_one_and_many_in_strict_sequence_order() {
    let root = private_root();
    let store = SqliteEventStore::open(database_path(&root))
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 4).await;

    let one = store
        .load_after(stream, EventSeq::initial(), 1)
        .await
        .expect("one event");
    assert_eq!(one.len(), 1);
    assert_eq!(one[0].seq, EventSeq::new(1));

    let many = store
        .load_after(stream, EventSeq::new(1), 8)
        .await
        .expect("many events");
    assert_eq!(
        many.iter().map(|item| item.seq.value()).collect::<Vec<_>>(),
        vec![2, 3, 4]
    );
}

#[tokio::test]
async fn load_after_limit_pages_without_duplicates_or_gaps() {
    let root = private_root();
    let store = SqliteEventStore::open(database_path(&root))
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 7).await;

    let mut after = EventSeq::initial();
    let mut observed = Vec::new();
    loop {
        let page = store
            .load_after(stream, after, 2)
            .await
            .expect("bounded page");
        if page.is_empty() {
            break;
        }
        after = page.last().expect("non-empty page").seq;
        observed.extend(page.into_iter().map(|item| item.seq.value()));
    }
    assert_eq!(observed, (1..=7).collect::<Vec<_>>());
}

#[tokio::test]
async fn load_after_isolates_streams() {
    let root = private_root();
    let store = SqliteEventStore::open(database_path(&root))
        .await
        .expect("open store");
    let first = SessionId::new();
    let second = SessionId::new();
    append_history(&store, first, 3).await;
    append_history(&store, second, 2).await;

    let first_page = store
        .load_after(first, EventSeq::initial(), 8)
        .await
        .expect("first stream");
    let second_page = store
        .load_after(second, EventSeq::initial(), 8)
        .await
        .expect("second stream");
    assert_eq!(first_page.len(), 3);
    assert_eq!(second_page.len(), 2);
    assert!(first_page.iter().all(|item| item.stream_id == first));
    assert!(second_page.iter().all(|item| item.stream_id == second));
}

#[tokio::test]
async fn load_after_preserves_every_envelope_field_across_restart() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    let appended = append_history(&store, stream, 3).await;
    drop(store);

    let reopened = SqliteEventStore::open(path).await.expect("reopen store");
    let replayed = reopened
        .load_after(stream, EventSeq::initial(), 8)
        .await
        .expect("replay after restart");
    assert_eq!(replayed, appended);
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(16))]

    #[test]
    fn load_after_page_model_matches_committed_history(
        count in 1usize..32,
        page_limit in 1usize..9,
    ) {
        let runtime = tokio::runtime::Runtime::new().expect("test runtime");
        runtime.block_on(async move {
            let root = private_root();
            let store = SqliteEventStore::open(database_path(&root)).await.expect("open store");
            let stream = SessionId::new();
            let model = append_history(&store, stream, count).await;
            let mut replayed = Vec::new();
            let mut after = EventSeq::initial();

            loop {
                let page = store
                    .load_after(stream, after, page_limit)
                    .await
                    .expect("model page");
                if page.is_empty() {
                    break;
                }
                after = page.last().expect("non-empty page").seq;
                replayed.extend(page);
            }
            assert_eq!(replayed, model);
        });
    }
}

#[tokio::test]
async fn load_after_rejects_unsupported_persisted_schema() {
    let (_root, path, store, stream) = seeded_store().await;
    Connection::open(path)
        .expect("open corruption connection")
        .execute("UPDATE events SET schema_version = 2", [])
        .expect("install unsupported stored version");

    assert_eq!(
        store.load_after(stream, EventSeq::initial(), 8).await,
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::SchemaVersion,
        })
    );
}

#[tokio::test]
async fn load_after_rejects_corrupt_rows_by_bounded_stage() {
    let cases = [
        (
            "UPDATE events SET event_id = zeroblob(16)",
            CorruptStoreStage::EventId,
        ),
        ("UPDATE events SET seq = X'01'", CorruptStoreStage::Sequence),
        (
            "UPDATE events SET occurred_at = 'not-rfc3339'",
            CorruptStoreStage::Timestamp,
        ),
        (
            "UPDATE events SET causation_id = X'01'",
            CorruptStoreStage::CausationId,
        ),
        (
            "UPDATE events SET correlation_id = X'01'",
            CorruptStoreStage::CorrelationId,
        ),
        (
            "UPDATE events SET payload = X'7B'",
            CorruptStoreStage::Payload,
        ),
    ];

    for (statement, stage) in cases {
        let (_root, path, store, stream) = seeded_store().await;
        let connection = Connection::open(path).expect("open corruption connection");
        connection
            .execute_batch("PRAGMA ignore_check_constraints = ON")
            .expect("allow isolated malformed row");
        connection
            .execute(statement, [])
            .expect("install isolated malformed row");
        assert_eq!(
            store.load_after(stream, EventSeq::initial(), 8).await,
            Err(EventStoreError::CorruptStore { stage }),
            "corruption statement: {statement}"
        );
    }
}

#[tokio::test]
async fn load_after_rejects_oversize_payload_and_timestamp_before_body_allocation() {
    let cases = [
        (
            true,
            CorruptStoreStage::Payload,
            MAX_EVENT_PAYLOAD_BYTES + 1,
        ),
        (false, CorruptStoreStage::Timestamp, 65),
    ];
    for (payload_case, stage, size) in cases {
        let (_root, path, store, stream) = seeded_store().await;
        let connection = Connection::open(path).expect("open corruption connection");
        if payload_case {
            connection
                .execute("UPDATE events SET payload = ?1", params![vec![b'x'; size]])
                .expect("install oversized payload");
        } else {
            connection
                .execute(
                    "UPDATE events SET occurred_at = ?1",
                    params!["x".repeat(size)],
                )
                .expect("install oversized timestamp");
        }
        assert_eq!(
            store.load_after(stream, EventSeq::initial(), 8).await,
            Err(EventStoreError::CorruptStore { stage })
        );
    }
}

#[tokio::test]
async fn load_after_rejects_gap_or_noncontiguous_page() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 3).await;
    Connection::open(path)
        .expect("open corruption connection")
        .execute(
            "UPDATE events SET seq = ?1 WHERE stream_id = ?2 AND seq = ?3",
            params![
                sequence_bytes(4).as_slice(),
                stream.as_uuid().as_bytes().as_slice(),
                sequence_bytes(2).as_slice(),
            ],
        )
        .expect("install sequence gap");

    assert_eq!(
        store.load_after(stream, EventSeq::initial(), 8).await,
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Sequence,
        })
    );
}

#[tokio::test]
async fn load_after_error_and_debug_do_not_expose_persisted_bytes_or_path() {
    let (_root, path, store, stream) = seeded_store().await;
    let payload_canary = b"secret-replay-payload-canary";
    Connection::open(&path)
        .expect("open corruption connection")
        .execute(
            "UPDATE events SET payload = ?1",
            params![payload_canary.as_slice()],
        )
        .expect("install canary payload");

    let error = store
        .load_after(stream, EventSeq::initial(), 8)
        .await
        .expect_err("invalid payload must fail");
    let error_debug = format!("{error:?}");
    let store_debug = format!("{store:?}");
    assert!(error_debug.len() < 256);
    assert!(!error_debug.contains("secret-replay-payload-canary"));
    assert!(!error_debug.contains(&path.to_string_lossy().to_string()));
    assert!(!store_debug.contains(&path.to_string_lossy().to_string()));
}

#[tokio::test(flavor = "current_thread")]
async fn load_after_statement_snapshot_never_exposes_uncommitted_rows() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 1).await;

    let mut writer = Connection::open(path).expect("open concurrent writer");
    let transaction = writer.transaction().expect("begin uncommitted append");
    let second = event(2);
    let payload = serde_json::to_vec(&second.payload).expect("encode second payload");
    transaction
        .execute(
            "INSERT INTO events (
                event_id, stream_id, seq, schema_version, occurred_at, causation_id,
                correlation_id, payload
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                Uuid::from_u128(900).as_bytes().as_slice(),
                stream.as_uuid().as_bytes().as_slice(),
                sequence_bytes(2).as_slice(),
                i64::from(second.schema_version),
                second
                    .occurred_at
                    .to_rfc3339_opts(chrono::SecondsFormat::Nanos, true),
                second
                    .causation_id
                    .as_ref()
                    .map(|value| value.as_bytes().as_slice()),
                second.correlation_id.as_bytes().as_slice(),
                payload,
            ],
        )
        .expect("insert uncommitted second event");

    let before_commit = store
        .load_after(stream, EventSeq::initial(), 8)
        .await
        .expect("statement snapshot before commit");
    assert_eq!(before_commit.len(), 1);

    transaction.commit().expect("commit second event");
    let after_commit = store
        .load_after(stream, EventSeq::initial(), 8)
        .await
        .expect("statement snapshot after commit");
    assert_eq!(
        after_commit
            .iter()
            .map(|item| item.seq.value())
            .collect::<Vec<_>>(),
        vec![1, 2]
    );
}

#[tokio::test]
async fn load_after_does_not_mutate_committed_events() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 4).await;
    let before = stored_rows(&path);

    let page = store
        .load_after(stream, EventSeq::new(1), 2)
        .await
        .expect("E0 replay");
    assert_eq!(page.len(), 2);
    assert_eq!(stored_rows(&path), before);
}

#[tokio::test]
async fn load_after_busy_timeout_is_retriable_and_non_mutating() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 1).await;
    let before = stored_rows(&path);

    let lock = Connection::open(&path).expect("open exclusive lock connection");
    lock.execute_batch(
        "PRAGMA wal_checkpoint(TRUNCATE);
         PRAGMA journal_mode = DELETE;
         PRAGMA locking_mode = EXCLUSIVE;
         BEGIN EXCLUSIVE;",
    )
    .expect("hold exclusive database lock");
    let result = timeout(
        SQLITE_BUSY_TIMEOUT + Duration::from_secs(2),
        store.load_after(stream, EventSeq::initial(), 8),
    )
    .await
    .expect("read busy timeout remains bounded");
    assert_eq!(result, Err(EventStoreError::Busy));
    lock.execute_batch("ROLLBACK; PRAGMA locking_mode = NORMAL;")
        .expect("release exclusive lock");
    drop(lock);
    assert_eq!(stored_rows(&path), before);
}

#[tokio::test]
async fn load_after_missing_database_returns_bounded_storage_without_recreation() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    std::fs::remove_file(&path).expect("remove isolated database");

    assert_eq!(
        store
            .load_after(SessionId::new(), EventSeq::initial(), 8)
            .await,
        Err(EventStoreError::Storage {
            operation: StorageOperation::Open,
            kind: StorageErrorKind::Io,
        })
    );
    assert!(!path.exists());
}

#[tokio::test]
async fn load_after_cancellation_has_no_effect() {
    let root = private_root();
    let path = database_path(&root);
    let store = SqliteEventStore::open(path.clone())
        .await
        .expect("open store");
    let stream = SessionId::new();
    append_history(&store, stream, 32).await;
    let before = stored_rows(&path);

    let cancelled_store = store.clone();
    let operation = tokio::spawn(async move {
        cancelled_store
            .load_after(stream, EventSeq::initial(), MAX_REPLAY_EVENTS)
            .await
    });
    operation.abort();
    let _ = operation.await;
    sleep(Duration::from_millis(50)).await;

    assert_eq!(stored_rows(&path), before);
    assert_eq!(
        store
            .load_after(stream, EventSeq::initial(), MAX_REPLAY_EVENTS)
            .await
            .expect("replay after cancellation")
            .len(),
        32
    );
}

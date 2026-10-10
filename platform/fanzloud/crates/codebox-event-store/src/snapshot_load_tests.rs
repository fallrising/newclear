//! Public CU-EVT-03 and A/B/C/D composition oracles (SPEC-T030C C01–C12).
use super::*;
use chrono::{DateTime, TimeZone, Utc};
use codebox_domain::{ApprovalDecision, ApprovalId, DomainEvent, SandboxId, TurnId};
use rusqlite::types::{Value, ValueRef};
use std::collections::BTreeSet;
use std::os::unix::fs::{PermissionsExt, symlink};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Barrier, Mutex, mpsc};
use tempfile::{TempDir, tempdir};

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(4)
        .enable_all()
        .build()
        .unwrap()
        .block_on(future)
}
struct Fixture {
    _root: TempDir,
    path: PathBuf,
    store: SqliteEventStore,
    stream: SessionId,
    history: Vec<DomainEventEnvelope>,
    snapshot: SessionSnapshot,
}
fn event(seq: u64, payload: DomainEvent) -> NewDomainEvent {
    NewDomainEvent {
        schema_version: 1,
        occurred_at: Utc.timestamp_opt(seq as i64, 0).single().unwrap(),
        causation_id: None,
        correlation_id: Uuid::from_u128(42),
        payload,
    }
}
fn reducer(stream: SessionId, events: &[DomainEventEnvelope]) -> SessionReducer {
    events.iter().fold(SessionReducer::new(stream), |r, e| {
        r.apply(e).expect("independent legal reduction")
    })
}
fn snapshot(stream: SessionId, events: &[DomainEventEnvelope]) -> SessionSnapshot {
    SessionSnapshot::from_projection(reducer(stream, events).projection().unwrap().clone()).unwrap()
}
fn fixture(count: usize) -> Fixture {
    let root = tempdir().unwrap();
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    let path = root.path().join("events.sqlite");
    let store = run(SqliteEventStore::open(path.clone())).unwrap();
    let stream = SessionId::new();
    let sandbox = SandboxId::new();
    let mut history = Vec::new();
    for start in (0..count).step_by(256) {
        let inputs = (start..(start + 256).min(count))
            .map(|i| {
                event(
                    i as u64 + 1,
                    match i {
                        0 => DomainEvent::SessionCreated,
                        1 => DomainEvent::SandboxProvisioned {
                            sandbox_id: sandbox,
                        },
                        _ if i % 2 == 0 => DomainEvent::SessionIdled,
                        _ => DomainEvent::SessionResumed,
                    },
                )
            })
            .collect();
        history.extend(run(store.append(stream, EventSeq::new(start as u64), inputs)).unwrap());
    }
    let snapshot = snapshot(stream, &history);
    Fixture {
        _root: root,
        path,
        store,
        stream,
        history,
        snapshot,
    }
}
fn saved(count: usize) -> Fixture {
    let f = fixture(count);
    run(f
        .store
        .save_snapshot(f.snapshot.clone(), EventSeq::new(count as u64)))
    .unwrap();
    f
}
fn hooked(
    store: &SqliteEventStore,
    hook: impl Fn(LoadPoint) -> Result<(), EventStoreError> + Send + Sync + 'static,
) -> SqliteEventStore {
    let mut store = store.clone();
    store.load_hook = Some(Arc::new(hook));
    store
}
fn load(f: &Fixture) -> Result<Option<SessionSnapshot>, EventStoreError> {
    run(f.store.load_snapshot(f.stream))
}
// Raw typed rows include malformed disposable values, other streams, schema and identities.
#[derive(Debug, PartialEq)]
enum Cell {
    Null,
    Integer(i64),
    Real(u64),
    Text(Vec<u8>),
    Blob(Vec<u8>),
}
fn cell(value: ValueRef<'_>) -> Cell {
    match value {
        ValueRef::Null => Cell::Null,
        ValueRef::Integer(n) => Cell::Integer(n),
        ValueRef::Real(n) => Cell::Real(n.to_bits()),
        ValueRef::Text(bytes) => Cell::Text(bytes.to_vec()),
        ValueRef::Blob(bytes) => Cell::Blob(bytes.to_vec()),
    }
}
fn fingerprint(path: &Path) -> Vec<Vec<Cell>> {
    let c = Connection::open(path).unwrap();
    let mut result = Vec::new();
    for (sql, width) in [
        ("SELECT * FROM events ORDER BY stream_id,seq", 8),
        ("SELECT * FROM snapshots ORDER BY stream_id", 4),
        (
            "SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name",
            4,
        ),
        ("PRAGMA application_id", 1),
        ("PRAGMA user_version", 1),
        ("PRAGMA index_list(events)", 5),
        ("PRAGMA index_list(snapshots)", 5),
    ] {
        let mut statement = c.prepare(sql).unwrap();
        result.extend(
            statement
                .query_map([], |r| (0..width).map(|i| r.get_ref(i).map(cell)).collect())
                .unwrap()
                .collect::<Result<Vec<Vec<Cell>>, _>>()
                .unwrap(),
        );
    }
    result
}
fn unchanged(f: &Fixture, expected: Result<Option<SessionSnapshot>, EventStoreError>) {
    let before = fingerprint(&f.path);
    assert_eq!(load(f), expected);
    assert_eq!(fingerprint(&f.path), before);
}
fn inject(f: &Fixture, seq: u64, body: Vec<u8>) {
    Connection::open(&f.path)
        .unwrap()
        .execute(
            "INSERT OR REPLACE INTO snapshots VALUES(?1,?2,1,?3)",
            params![
                f.stream.as_uuid().as_bytes().as_slice(),
                seq.to_be_bytes().as_slice(),
                body
            ],
        )
        .unwrap();
}
fn sql(f: &Fixture, sql: &str) {
    Connection::open(&f.path)
        .unwrap()
        .execute_batch(sql)
        .unwrap();
}
fn page_observer(f: &Fixture) -> (SqliteEventStore, Arc<Mutex<Vec<usize>>>) {
    let pages = Arc::new(Mutex::new(Vec::new()));
    let seen = pages.clone();
    let store = hooked(&f.store, move |point| {
        if let LoadPoint::Page(n) = point {
            seen.lock().unwrap().push(n);
        }
        Ok(())
    });
    (store, pages)
}
fn typed_error(stage: CorruptStoreStage) -> Result<Option<SessionSnapshot>, EventStoreError> {
    Err(EventStoreError::CorruptStore { stage })
}
fn private_fault() -> EventStoreError {
    EventStoreError::Storage {
        operation: StorageOperation::SnapshotRead,
        kind: StorageErrorKind::Io,
    }
}

#[test]
fn snapshot_value_bounds_precede_database_access() {
    let f = fixture(1);
    let (store, pages) = page_observer(&f);
    for seq in [0, 4097, u64::MAX] {
        let mut body = encode_snapshot(&f.snapshot);
        body[24..32].copy_from_slice(&seq.to_be_bytes());
        inject(&f, seq, body.to_vec());
        assert_eq!(run(store.load_snapshot(f.stream)), Ok(None));
    }
    assert!(pages.lock().unwrap().is_empty());
    inject(&f, 1, encode_snapshot(&f.snapshot).to_vec());
    assert_eq!(
        run(store.load_snapshot(f.stream)),
        Ok(Some(f.snapshot.clone()))
    );
    assert_eq!(*pages.lock().unwrap(), vec![1]);
    // No full-u64 limitation is applied to A/B; this suffix is intentionally not a valid prefix.
    sql(&f, "UPDATE events SET seq=x'ffffffffffffffff'");
    assert_eq!(
        run(f.store.load_after(f.stream, EventSeq::new(u64::MAX - 1), 1)).unwrap()[0]
            .seq
            .value(),
        u64::MAX
    );
}

#[test]
fn snapshot_body_gated_before_allocation() {
    let f = saved(1);
    let (store, pages) = page_observer(&f);
    for value in [
        Value::Null,
        Value::Integer(1),
        Value::Real(1.5),
        Value::Text("canary".repeat(10000)),
        Value::Blob(Vec::new()),
        Value::Blob(vec![0; 95]),
        Value::Blob(vec![0; 97]),
        Value::Blob(vec![0; 1_000_000]),
    ] {
        let c = Connection::open(&f.path).unwrap();
        c.execute("UPDATE snapshots SET body=?1", params![value])
            .unwrap();
        let projected: Option<Vec<u8>> = c
            .query_row(
                SNAPSHOT_QUERY,
                params![f.stream.as_uuid().as_bytes().as_slice()],
                |r| r.get(2),
            )
            .unwrap();
        assert_eq!(projected, None, "SQL must gate before Rust body copy");
        let before = fingerprint(&f.path);
        assert_eq!(run(store.load_snapshot(f.stream)), Ok(None));
        assert_eq!(fingerprint(&f.path), before);
    }
    assert!(pages.lock().unwrap().is_empty());
    inject(&f, 1, encode_snapshot(&f.snapshot).to_vec());
    assert_eq!(
        run(store.load_snapshot(f.stream)),
        Ok(Some(f.snapshot.clone()))
    );
}

#[test]
fn snapshot_all_projection_fields_match_persisted_prefix() {
    let f = saved(2);
    for offset in [8, 24, 32, 33, 50, 67, 84, 92] {
        let mut body = encode_snapshot(&f.snapshot);
        match offset {
            8 => body[8..24].copy_from_slice(SessionId::new().as_uuid().as_bytes()),
            24 => {
                body[24..32].copy_from_slice(&1u64.to_be_bytes());
            }
            32 => body[32] = 0,
            33 | 50 => {
                body[offset] = 1;
                body[offset + 1..offset + 17].copy_from_slice(Uuid::new_v4().as_bytes());
            }
            67 => body[offset + 1..offset + 17].copy_from_slice(Uuid::new_v4().as_bytes()),
            84 => body[84..92].copy_from_slice(&99i64.to_be_bytes()),
            92 => body[92..96].copy_from_slice(&123u32.to_be_bytes()),
            _ => unreachable!(),
        }
        inject(&f, if offset == 24 { 1 } else { 2 }, body.to_vec());
        unchanged(&f, Ok(None));
    }
    let sandbox = SandboxId::new();
    let turn = TurnId::new();
    let approval = ApprovalId::new();
    let histories = [
        vec![DomainEvent::SessionCreated, DomainEvent::ProvisioningFailed],
        vec![
            DomainEvent::SessionCreated,
            DomainEvent::SandboxProvisioned {
                sandbox_id: sandbox,
            },
            DomainEvent::TurnStarted { turn_id: turn },
            DomainEvent::ApprovalRequested {
                turn_id: turn,
                approval_id: approval,
            },
            DomainEvent::ApprovalResolved {
                turn_id: turn,
                approval_id: approval,
                decision: ApprovalDecision::Approved,
            },
            DomainEvent::TurnCancellationRequested { turn_id: turn },
            DomainEvent::TurnCancelled { turn_id: turn },
            DomainEvent::SessionIdled,
            DomainEvent::SessionArchivingStarted,
            DomainEvent::SessionArchived,
        ],
    ];
    let mut statuses = BTreeSet::new();
    for payloads in histories {
        let f = fixture(1);
        let stream = SessionId::new();
        let mut events = Vec::new();
        for payload in payloads {
            events.extend(
                run(f.store.append(
                    stream,
                    EventSeq::new(events.len() as u64),
                    vec![event(events.len() as u64 + 1, payload)],
                ))
                .unwrap(),
            );
            let value = snapshot(stream, &events);
            statuses.insert(encode_snapshot(&value)[32]);
            run(f
                .store
                .save_snapshot(value.clone(), value.projection().last_seq()))
            .unwrap();
            let before = fingerprint(&f.path);
            assert_eq!(run(f.store.load_snapshot(stream)), Ok(Some(value)));
            assert_eq!(fingerprint(&f.path), before);
        }
    }
    assert_eq!(
        statuses.into_iter().collect::<Vec<_>>(),
        (0..=8).collect::<Vec<_>>()
    );
    for timestamp in [
        DateTime::<Utc>::MIN_UTC,
        DateTime::<Utc>::MAX_UTC,
        Utc.timestamp_opt(-1, 1_999_999_999).single().unwrap(),
        Utc.timestamp_opt(59, 1_000_000_000).single().unwrap(),
    ] {
        let f = fixture(1);
        let stream = SessionId::new();
        let mut input = event(1, DomainEvent::SessionCreated);
        input.occurred_at = timestamp;
        let events = run(f.store.append(stream, EventSeq::initial(), vec![input])).unwrap();
        let value = snapshot(stream, &events);
        run(f.store.save_snapshot(value.clone(), EventSeq::new(1))).unwrap();
        let loaded = run(f.store.load_snapshot(stream)).unwrap().unwrap();
        assert_eq!(loaded, value);
        assert_eq!(loaded.projection().last_activity(), timestamp);
    }
}

#[test]
fn snapshot_corrupt_history_never_becomes_cache_miss() {
    for (mutation, stage) in [
        (
            "DELETE FROM events WHERE seq=x'0000000000000002'",
            CorruptStoreStage::Sequence,
        ),
        (
            "UPDATE events SET event_id=zeroblob(16) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::EventId,
        ),
        (
            "UPDATE events SET schema_version=2 WHERE seq=x'0000000000000001'",
            CorruptStoreStage::SchemaVersion,
        ),
        (
            "UPDATE events SET occurred_at='secret-canary' WHERE seq=x'0000000000000001'",
            CorruptStoreStage::Timestamp,
        ),
        (
            "UPDATE events SET occurred_at=printf('%065d',1) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::Timestamp,
        ),
        (
            "UPDATE events SET causation_id=zeroblob(15) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::CausationId,
        ),
        (
            "UPDATE events SET correlation_id=zeroblob(15) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::CorrelationId,
        ),
        (
            "UPDATE events SET payload=x'00' WHERE seq=x'0000000000000001'",
            CorruptStoreStage::Payload,
        ),
        (
            "UPDATE events SET payload=zeroblob(65537) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::Payload,
        ),
    ] {
        let f = saved(3);
        sql(
            &f,
            &format!(
                "PRAGMA ignore_check_constraints=ON; {mutation}; PRAGMA ignore_check_constraints=OFF"
            ),
        );
        unchanged(&f, typed_error(stage));
    }
    // Missing final cached target remains an observed error because a later durable head exists.
    let f = saved(2);
    run(f.store.append(
        f.stream,
        EventSeq::new(2),
        vec![event(3, DomainEvent::SessionIdled)],
    ))
    .unwrap();
    sql(&f, "DELETE FROM events WHERE seq=x'0000000000000002'");
    unchanged(&f, typed_error(CorruptStoreStage::Sequence));
    for reason in [
        InvalidEventHistoryReason::MissingCreation,
        InvalidEventHistoryReason::Transition,
        InvalidEventHistoryReason::TurnIdentity,
        InvalidEventHistoryReason::ApprovalIdentity,
    ] {
        let f = fixture(1);
        let stream = SessionId::new();
        let turn = TurnId::new();
        let approval = ApprovalId::new();
        let payloads = [
            DomainEvent::SessionCreated,
            DomainEvent::SandboxProvisioned {
                sandbox_id: SandboxId::new(),
            },
            DomainEvent::TurnStarted { turn_id: turn },
            DomainEvent::ApprovalRequested {
                turn_id: turn,
                approval_id: approval,
            },
            DomainEvent::ApprovalResolved {
                turn_id: turn,
                approval_id: approval,
                decision: ApprovalDecision::Approved,
            },
        ];
        let events = run(f.store.append(
            stream,
            EventSeq::initial(),
            payloads
                .into_iter()
                .enumerate()
                .map(|(i, p)| event(i as u64 + 1, p))
                .collect(),
        ))
        .unwrap();
        let value = snapshot(stream, &events);
        run(f.store.save_snapshot(value, EventSeq::new(5))).unwrap();
        let (seq, wrong): (u64, DomainEvent) = match reason {
            InvalidEventHistoryReason::MissingCreation => (1, DomainEvent::ProvisioningFailed),
            InvalidEventHistoryReason::Transition => (2, DomainEvent::SessionCreated),
            InvalidEventHistoryReason::TurnIdentity => (
                4,
                DomainEvent::ApprovalRequested {
                    turn_id: TurnId::new(),
                    approval_id: approval,
                },
            ),
            _ => (
                5,
                DomainEvent::ApprovalResolved {
                    turn_id: turn,
                    approval_id: ApprovalId::new(),
                    decision: ApprovalDecision::Approved,
                },
            ),
        };
        Connection::open(&f.path)
            .unwrap()
            .execute(
                "UPDATE events SET payload=?1 WHERE stream_id=?2 AND seq=?3",
                params![
                    serde_json::to_vec(&wrong).unwrap(),
                    stream.as_uuid().as_bytes().as_slice(),
                    seq.to_be_bytes().as_slice()
                ],
            )
            .unwrap();
        let before = fingerprint(&f.path);
        assert_eq!(
            run(f.store.load_snapshot(stream)),
            Err(EventStoreError::InvalidEventHistory {
                seq: EventSeq::new(seq),
                reason
            })
        );
        assert_eq!(fingerprint(&f.path), before);
    }
}

#[test]
fn snapshot_verification_has_page_and_total_bounds() {
    let f = saved(4096);
    let (store, pages) = page_observer(&f);
    for head in [4096, 4097, u64::MAX] {
        if head == 4097 {
            run(f.store.append(
                f.stream,
                EventSeq::new(4096),
                vec![event(4097, DomainEvent::SessionIdled)],
            ))
            .unwrap();
        }
        if head == u64::MAX {
            sql(
                &f,
                "UPDATE events SET seq=x'ffffffffffffffff',payload=x'00' WHERE seq=x'0000000000001001'",
            );
        }
        pages.lock().unwrap().clear();
        assert_eq!(
            run(store.load_snapshot(f.stream)),
            Ok(Some(f.snapshot.clone()))
        );
        assert_eq!(*pages.lock().unwrap(), vec![256; 16]);
        if head > 4096 {
            let first = snapshot(f.stream, &f.history[..1]);
            inject(&f, 1, encode_snapshot(&first).to_vec());
            pages.lock().unwrap().clear();
            assert_eq!(run(store.load_snapshot(f.stream)), Ok(Some(first)));
            assert_eq!(*pages.lock().unwrap(), vec![1]);
            inject(&f, 4096, encode_snapshot(&f.snapshot).to_vec());
        }
    }
    let body = encode_snapshot(&f.snapshot);
    for seq in [0, 4097, u64::MAX] {
        let mut bad = body;
        bad[24..32].copy_from_slice(&seq.to_be_bytes());
        inject(&f, seq, bad.to_vec());
        pages.lock().unwrap().clear();
        assert_eq!(run(store.load_snapshot(f.stream)), Ok(None));
        assert!(pages.lock().unwrap().is_empty());
    }
    // Cache4096 is ahead of head4095: no verification is admitted.
    sql(&f, "DELETE FROM events WHERE seq>=x'0000000000001000'");
    inject(&f, 4096, body.to_vec());
    assert_eq!(run(store.load_snapshot(f.stream)), Ok(None));
    assert!(pages.lock().unwrap().is_empty());
    let first = snapshot(f.stream, &f.history[..1]);
    inject(&f, 1, encode_snapshot(&first).to_vec());
    assert_eq!(run(store.load_snapshot(f.stream)), Ok(Some(first)));
    assert_eq!(*pages.lock().unwrap(), vec![1]);
}

#[test]
fn snapshot_load_absent_stale_corrupt_unsupported_is_e0() {
    let f = fixture(2);
    let other = SessionId::new();
    run(f.store.append(
        other,
        EventSeq::initial(),
        vec![event(1, DomainEvent::SessionCreated)],
    ))
    .unwrap();
    Connection::open(&f.path)
        .unwrap()
        .execute(
            "INSERT INTO snapshots VALUES(?1,NULL,NULL,NULL)",
            params![other.as_uuid().as_bytes().as_slice()],
        )
        .unwrap();
    unchanged(&f, Ok(None));
    let before = fingerprint(&f.path);
    assert_eq!(run(f.store.load_snapshot(SessionId::new())), Ok(None));
    assert_eq!(fingerprint(&f.path), before);
    let empty = saved(1);
    sql(&empty, "DELETE FROM events");
    unchanged(&empty, Ok(None));
    let (store, pages) = page_observer(&empty);
    assert_eq!(run(store.load_snapshot(empty.stream)), Ok(None));
    assert!(pages.lock().unwrap().is_empty());
    run(f.store.save_snapshot(f.snapshot.clone(), EventSeq::new(2))).unwrap();
    unchanged(&f, Ok(Some(f.snapshot.clone())));
    run(f.store.append(
        f.stream,
        EventSeq::new(2),
        vec![event(3, DomainEvent::SessionIdled)],
    ))
    .unwrap();
    unchanged(&f, Ok(Some(f.snapshot.clone())));
    for seq in [0u64, 4, 4097] {
        let mut body = encode_snapshot(&f.snapshot);
        body[24..32].copy_from_slice(&seq.to_be_bytes());
        inject(&f, seq, body.to_vec());
        unchanged(&f, Ok(None));
    }
    for offset in [0, 4, 6, 8, 32, 33, 50, 67, 92] {
        let mut body = encode_snapshot(&f.snapshot);
        body[offset] = 255;
        inject(&f, 2, body.to_vec());
        unchanged(&f, Ok(None));
    }
}

#[test]
fn snapshot_load_prefix_does_not_hide_corrupt_suffix() {
    for semantic in [false, true] {
        let f = saved(2);
        let payload = if semantic {
            DomainEvent::SessionCreated
        } else {
            DomainEvent::SessionIdled
        };
        run(f
            .store
            .append(f.stream, EventSeq::new(2), vec![event(3, payload)]))
        .unwrap();
        if !semantic {
            sql(
                &f,
                "UPDATE events SET payload=x'00' WHERE seq=x'0000000000000003'",
            );
        }
        unchanged(&f, Ok(Some(f.snapshot.clone())));
        let suffix = run(f.store.load_after(f.stream, EventSeq::new(2), 256));
        if semantic {
            assert!(
                reducer(f.stream, &f.history)
                    .apply(&suffix.unwrap()[0])
                    .is_err()
            );
        } else {
            assert_eq!(
                suffix,
                Err(EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::Payload
                })
            );
        }
        sql(&f, "UPDATE snapshots SET body=NULL");
        unchanged(&f, Ok(None));
        let full = run(f.store.load_after(f.stream, EventSeq::initial(), 256));
        if semantic {
            let mut own = SessionReducer::new(f.stream);
            let mut error = false;
            for e in full.unwrap() {
                match own.apply(&e) {
                    Ok(next) => own = next,
                    Err(_) => {
                        error = true;
                        break;
                    }
                }
            }
            assert!(error);
        } else {
            assert_eq!(
                full,
                Err(EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::Payload
                })
            );
        }
    }
}

#[test]
fn snapshot_load_returns_replayed_projection_without_restore() {
    let f = saved(257);
    let loaded = load(&f).unwrap().unwrap();
    assert_eq!(loaded, snapshot(f.stream, &f.history));
    let mut own = reducer(f.stream, &f.history);
    run(f.store.append(
        f.stream,
        EventSeq::new(257),
        vec![event(258, DomainEvent::SessionResumed)],
    ))
    .unwrap();
    for e in run(f
        .store
        .load_after(f.stream, loaded.projection().last_seq(), 256))
    .unwrap()
    {
        own = own.apply(&e).unwrap();
    }
    assert_eq!(own.last_seq(), EventSeq::new(258));
    let domain = include_str!("../../codebox-domain/src/reducer.rs");
    for forbidden in [
        "pub fn restore",
        "pub fn from_projection",
        "pub fn set_",
        "Deserialize",
    ] {
        assert!(!domain.contains(forbidden));
    }
    let source = include_str!("sqlite.rs");
    let verifier = source
        .split("fn verify_prefix(")
        .nth(1)
        .unwrap()
        .split("fn history_reason")
        .next()
        .unwrap();
    assert!(!verifier.contains("load_after"));
    assert!(verifier.contains("SessionReducer::new(stream)"));
    assert!(!include_str!("snapshot.rs").contains("Deserialize"));
}

#[test]
fn snapshot_malformed_value_columns_preserve_open_and_event_access() {
    for column in ["seq", "codec_version", "body"] {
        let mut values = vec![
            Value::Null,
            Value::Integer(-1),
            Value::Real(1.5),
            Value::Text("bad-canary".into()),
            Value::Blob(vec![0; 2]),
        ];
        match column {
            "seq" => values.extend([
                Value::Blob(0u64.to_be_bytes().to_vec()),
                Value::Blob(4097u64.to_be_bytes().to_vec()),
                Value::Blob(vec![1; 9]),
            ]),
            "codec_version" => values.extend([Value::Integer(65536), Value::Integer(2)]),
            _ => values.extend([
                Value::Blob(vec![0; 95]),
                Value::Blob(vec![0; 97]),
                Value::Blob(vec![0; 1_000_000]),
            ]),
        }
        for value in values {
            let f = saved(2);
            let c = Connection::open(&f.path).unwrap();
            c.execute(&format!("UPDATE snapshots SET {column}=?1"), params![value])
                .unwrap();
            validate_integrity(&c).unwrap();
            let reopened = run(SqliteEventStore::open(f.path.clone())).unwrap();
            unchanged(&f, Ok(None));
            assert_eq!(
                run(reopened.load_after(f.stream, EventSeq::initial(), 256)).unwrap(),
                f.history
            );
            let before_save = fingerprint(&f.path);
            assert!(matches!(
                run(f.store.save_snapshot(f.snapshot.clone(), EventSeq::new(2))),
                Err(EventStoreError::InvalidSnapshotCache { .. })
            ));
            assert_eq!(fingerprint(&f.path), before_save);
            let before = fingerprint(&f.path);
            assert_eq!(run(reopened.load_snapshot(f.stream)), Ok(None));
            assert_eq!(fingerprint(&f.path), before);
            assert_eq!(
                run(reopened.append(
                    f.stream,
                    EventSeq::new(2),
                    vec![event(3, DomainEvent::SessionIdled)]
                ))
                .unwrap()[0]
                    .seq,
                EventSeq::new(3)
            );
        }
    }
}

#[test]
fn snapshot_read_transaction_sees_old_or_complete_new() {
    let f = saved(257);
    let pin = Arc::new(Barrier::new(2));
    let pin_release = Arc::new(Barrier::new(2));
    let page = Arc::new(Barrier::new(2));
    let page_release = Arc::new(Barrier::new(2));
    let pages = Arc::new(Mutex::new(Vec::new()));
    let (p, pr, q, qr, counts) = (
        pin.clone(),
        pin_release.clone(),
        page.clone(),
        page_release.clone(),
        pages.clone(),
    );
    let reader = hooked(&f.store, move |point| {
        if point == LoadPoint::Pinned {
            p.wait();
            pr.wait();
        }
        if let LoadPoint::Page(n) = point {
            let mut counts = counts.lock().unwrap();
            counts.push(n);
            let first = counts.len() == 1;
            drop(counts);
            if first {
                q.wait();
                qr.wait();
            }
        }
        Ok(())
    });
    let stream = f.stream;
    let reading = std::thread::spawn(move || run(reader.load_snapshot(stream)));
    pin.wait();
    let tail = run(f.store.append(
        stream,
        EventSeq::new(257),
        vec![event(258, DomainEvent::SessionResumed)],
    ))
    .unwrap();
    let mut all = f.history.clone();
    all.extend(tail);
    let newer = snapshot(stream, &all);
    let written = Arc::new(Barrier::new(2));
    let write_release = Arc::new(Barrier::new(2));
    let (w, wr, path, value) = (
        written.clone(),
        write_release.clone(),
        f.path.clone(),
        newer.clone(),
    );
    let writing = std::thread::spawn(move || {
        save_with_hook(&path, value, EventSeq::new(258), |point| {
            if point == SavePoint::Written {
                w.wait();
                wr.wait();
            }
            Ok(())
        })
    });
    written.wait();
    // A newly pinned public reader sees only the old whole cache while save is uncommitted.
    assert_eq!(load(&f), Ok(Some(f.snapshot.clone())));
    pin_release.wait();
    page.wait();
    write_release.wait();
    writing.join().unwrap().unwrap();
    let after_writer = fingerprint(&f.path);
    page_release.wait();
    assert_eq!(reading.join().unwrap(), Ok(Some(f.snapshot.clone())));
    assert_eq!(*pages.lock().unwrap(), vec![256, 1]);
    assert_eq!(fingerprint(&f.path), after_writer);
    assert_eq!(load(&f), Ok(Some(newer)));
    // Initially absent cache is also pinned, even if the first cache commits before its lookup.
    let f = fixture(1);
    let enter = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let (a, b) = (enter.clone(), release.clone());
    let reader = hooked(&f.store, move |point| {
        if point == LoadPoint::Pinned {
            a.wait();
            b.wait();
        }
        Ok(())
    });
    let stream = f.stream;
    let reading = std::thread::spawn(move || run(reader.load_snapshot(stream)));
    enter.wait();
    run(f.store.save_snapshot(f.snapshot.clone(), EventSeq::new(1))).unwrap();
    release.wait();
    assert_eq!(reading.join().unwrap(), Ok(None));
    unchanged(&f, Ok(Some(f.snapshot.clone())));
}

#[test]
fn snapshot_load_disposition_order_preserves_observed_store_errors() {
    for (mutation, unsupported) in [
        ("PRAGMA application_id=7", true),
        ("PRAGMA user_version=3", true),
        ("DROP TABLE snapshots", false),
        ("CREATE INDEX intruder ON events(seq)", false),
        ("CREATE VIEW intruder AS SELECT * FROM events", false),
        (
            "CREATE TRIGGER intruder AFTER INSERT ON events BEGIN SELECT 1; END",
            false,
        ),
        ("ALTER TABLE snapshots ADD COLUMN intruder ANY", false),
    ] {
        for malformed in [false, true] {
            let f = saved(2);
            sql(
                &f,
                if malformed {
                    "UPDATE snapshots SET body=NULL"
                } else {
                    "DELETE FROM snapshots"
                },
            );
            sql(&f, mutation);
            let before_events = event_rows(&f.path);
            let before_bytes = std::fs::read(&f.path).unwrap();
            let error = load(&f).unwrap_err();
            if unsupported {
                assert!(matches!(
                    error,
                    EventStoreError::UnsupportedDatabaseSchema { .. }
                ));
            } else {
                assert_eq!(
                    error,
                    EventStoreError::CorruptStore {
                        stage: CorruptStoreStage::Schema
                    }
                );
            }
            assert_eq!(event_rows(&f.path), before_events);
            assert_eq!(std::fs::read(&f.path).unwrap(), before_bytes);
        }
    }
    for malformed in [false, true] {
        let f = saved(2);
        sql(
            &f,
            if malformed {
                "UPDATE snapshots SET body=NULL"
            } else {
                "DELETE FROM snapshots"
            },
        );
        sql(
            &f,
            "PRAGMA ignore_check_constraints=ON; UPDATE events SET seq=x'ff' WHERE seq=x'0000000000000002'; PRAGMA ignore_check_constraints=OFF",
        );
        unchanged(&f, typed_error(CorruptStoreStage::Sequence));
    }
    let f = saved(2);
    sql(
        &f,
        "UPDATE snapshots SET body=NULL; UPDATE events SET payload=x'00'",
    );
    let (store, pages) = page_observer(&f);
    assert_eq!(run(store.load_snapshot(f.stream)), Ok(None));
    assert!(pages.lock().unwrap().is_empty());
    inject(&f, 2, encode_snapshot(&f.snapshot).to_vec());
    let mut wrong = encode_snapshot(&f.snapshot);
    wrong[32] = 0;
    inject(&f, 2, wrong.to_vec());
    unchanged(&f, typed_error(CorruptStoreStage::Payload));
    // Bad lookup key on a different row cannot be hidden behind an absent selected stream.
    let f = saved(1);
    sql(
        &f,
        "PRAGMA ignore_check_constraints=ON; UPDATE snapshots SET stream_id=x'00'; PRAGMA ignore_check_constraints=OFF",
    );
    unchanged(&f, typed_error(CorruptStoreStage::Schema));
    assert_eq!(
        run(f.store.load_snapshot(SessionId::new())),
        typed_error(CorruptStoreStage::Schema)
    );
    // Actual key NOT NULL/type and physical page damage, retaining exact schema identity.
    for mode in ["null", "text", "physical"] {
        let f = saved(1);
        let c = Connection::open(&f.path).unwrap();
        let page: i64 = c
            .query_row(
                "SELECT rootpage FROM sqlite_schema WHERE name='snapshots'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let size: i64 = c.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
        c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
        drop(c);
        let mut bytes = std::fs::read(&f.path).unwrap();
        let base = ((page - 1) * size) as usize;
        assert_eq!(bytes[base], 10);
        if mode == "physical" {
            bytes[base] = 255;
        } else {
            let cell = base
                + usize::from(u16::from_be_bytes(
                    bytes[base + 8..base + 10].try_into().unwrap(),
                ));
            assert_eq!(bytes[cell] as usize, 126);
            assert_eq!(bytes[cell + 2], 44);
            if mode == "text" {
                bytes[cell + 2] = 45;
            } else {
                let mut record = vec![110, 6, 0, 28, 9, 129, 76];
                record.extend_from_slice(&bytes[cell + 23..cell + 127]);
                let offset = u16::try_from(size as usize - record.len()).unwrap();
                let start = base + usize::from(offset);
                bytes[start..base + size as usize].copy_from_slice(&record);
                bytes[base + 5..base + 7].copy_from_slice(&offset.to_be_bytes());
                bytes[base + 8..base + 10].copy_from_slice(&offset.to_be_bytes());
            }
        }
        std::fs::write(&f.path, &bytes).unwrap();
        let before = event_rows(&f.path);
        assert_eq!(load(&f), typed_error(CorruptStoreStage::Schema));
        assert_eq!(std::fs::read(&f.path).unwrap(), bytes);
        assert_eq!(event_rows(&f.path), before);
        assert_eq!(
            run(SqliteEventStore::open(f.path.clone())).unwrap_err(),
            EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema
            }
        );
    }
}
fn event_rows(path: &Path) -> Vec<Vec<Cell>> {
    let c = Connection::open(path).unwrap();
    let mut s = c
        .prepare("SELECT * FROM events ORDER BY stream_id,seq")
        .unwrap();
    s.query_map([], |r| (0..8).map(|i| r.get_ref(i).map(cell)).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}

#[test]
fn snapshot_load_busy_storage_and_worker_failures_are_e0() {
    let f = saved(257);
    let before = fingerprint(&f.path);
    // DELETE journal + EXCLUSIVE creates an actually incompatible reader lock. Normal WAL writers do not.
    let c = Connection::open(&f.path).unwrap();
    c.execute_batch("PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE")
        .unwrap();
    let started = std::time::Instant::now();
    assert_eq!(load(&f), Err(EventStoreError::Busy));
    assert!(started.elapsed() >= Duration::from_secs(4));
    assert!(started.elapsed() < Duration::from_secs(12));
    c.execute_batch("ROLLBACK; PRAGMA journal_mode=WAL")
        .unwrap();
    drop(c);
    assert_eq!(fingerprint(&f.path), before);
    for point in [
        LoadPoint::Pinned,
        LoadPoint::Cache,
        LoadPoint::Page(256),
        LoadPoint::Verified,
    ] {
        for kind in [StorageErrorKind::Io, StorageErrorKind::Full] {
            let fault = EventStoreError::Storage {
                operation: StorageOperation::SnapshotVerify,
                kind,
            };
            let expected = fault.clone();
            let store = hooked(&f.store, move |at| {
                if at == point {
                    Err(fault.clone())
                } else {
                    Ok(())
                }
            });
            assert_eq!(run(store.load_snapshot(f.stream)), Err(expected));
            assert_eq!(fingerprint(&f.path), before);
            unchanged(&f, Ok(Some(f.snapshot.clone())));
        }
    }
    let store = hooked(&f.store, |point| {
        if point == LoadPoint::BeforeOpen {
            panic!("private worker failure");
        }
        Ok(())
    });
    assert_eq!(
        run(store.load_snapshot(f.stream)),
        Err(EventStoreError::WorkerUnavailable)
    );
    assert_eq!(fingerprint(&f.path), before);
    unchanged(&f, Ok(Some(f.snapshot.clone())));
}

#[test]
fn snapshot_load_cancelled_or_timed_out_future_is_e0() {
    for deadline in [false, true] {
        for phase in [
            LoadPoint::BeforeOpen,
            LoadPoint::Pinned,
            LoadPoint::Page(256),
            LoadPoint::Verified,
        ] {
            let f = saved(257);
            let before = fingerprint(&f.path);
            let (entered_tx, entered_rx) = mpsc::channel();
            let release = Arc::new(Barrier::new(2));
            let r = release.clone();
            let (done_tx, done_rx) = mpsc::channel();
            let starts = Arc::new(AtomicUsize::new(0));
            let s = starts.clone();
            let store = hooked(&f.store, move |point| {
                if point == LoadPoint::BeforeOpen {
                    s.fetch_add(1, Ordering::SeqCst);
                }
                if point == phase {
                    entered_tx.send(()).unwrap();
                    r.wait();
                }
                if point == LoadPoint::Finished {
                    done_tx.send(()).unwrap();
                }
                Ok(())
            });
            run(async {
                let stream = f.stream;
                let handle = tokio::spawn(async move { store.load_snapshot(stream).await });
                entered_rx.recv_timeout(Duration::from_secs(5)).unwrap();
                if deadline {
                    // Deadline is owned by caller; timing out the JoinHandle does not cancel the reader.
                    let mut handle = handle;
                    assert!(
                        tokio::time::timeout(Duration::from_millis(1), &mut handle)
                            .await
                            .is_err()
                    );
                    handle.abort();
                } else {
                    handle.abort();
                }
                // While blocking work is held, no mutation occurred and a caller may append independently.
                assert_eq!(fingerprint(&f.path), before);
                release.wait();
                done_rx.recv_timeout(Duration::from_secs(5)).unwrap();
            });
            assert_eq!(starts.load(Ordering::SeqCst), 1, "no implicit retry");
            assert_eq!(fingerprint(&f.path), before);
            unchanged(&f, Ok(Some(f.snapshot.clone())));
            let new_event = run(f.store.append(
                f.stream,
                EventSeq::new(257),
                vec![event(258, DomainEvent::SessionResumed)],
            ))
            .unwrap();
            let mut full = f.history.clone();
            full.extend(new_event);
            let newer = snapshot(f.stream, &full);
            run(f.store.save_snapshot(newer.clone(), EventSeq::new(258))).unwrap();
            assert_eq!(
                load(&f),
                Ok(Some(newer)),
                "explicit E0 read may observe newer state"
            );
        }
    }
}

#[test]
fn snapshot_load_missing_file_does_not_recreate_or_upgrade() {
    let f = saved(1);
    std::fs::remove_file(&f.path).unwrap();
    assert_eq!(
        load(&f),
        Err(EventStoreError::Storage {
            operation: StorageOperation::Open,
            kind: StorageErrorKind::Io
        })
    );
    assert!(!f.path.exists());
    let f = saved(2);
    sql(&f, "DROP TABLE snapshots; PRAGMA user_version=1");
    let before = event_rows(&f.path);
    let bytes = std::fs::read(&f.path).unwrap();
    assert_eq!(
        load(&f),
        Err(EventStoreError::UnsupportedDatabaseSchema {
            expected_application_id: APPLICATION_ID,
            actual_application_id: APPLICATION_ID,
            expected_user_version: 2,
            actual_user_version: 1
        })
    );
    assert_eq!(event_rows(&f.path), before);
    assert_eq!(std::fs::read(&f.path).unwrap(), bytes);
    let c = Connection::open(&f.path).unwrap();
    assert_eq!(pragma_u32(&c, "user_version").unwrap(), 1);
    assert_eq!(
        c.query_row(
            "SELECT count(*) FROM sqlite_schema WHERE name='snapshots'",
            [],
            |r| r.get::<_, i64>(0)
        )
        .unwrap(),
        0
    );
}

#[test]
fn snapshot_paths_and_debug_remain_private_and_bounded() {
    let f = saved(1);
    assert!(
        run(SqliteEventStore::open(PathBuf::from(
            "secret-canary.sqlite"
        )))
        .is_err()
    );
    let link = f.path.with_file_name("secret-canary-link");
    symlink(&f.path, &link).unwrap();
    assert!(run(SqliteEventStore::open(link)).is_err());
    std::fs::set_permissions(&f.path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(run(SqliteEventStore::open(f.path.clone())).is_err());
    std::fs::set_permissions(&f.path, std::fs::Permissions::from_mode(0o600)).unwrap();
    let loaded = load(&f).unwrap().unwrap();
    assert_eq!(
        format!("{loaded:?}"),
        "SessionSnapshot { projection: \"<redacted>\" }"
    );
    let store = hooked(&f.store, |p| {
        if p == LoadPoint::Cache {
            Err(private_fault())
        } else {
            Ok(())
        }
    });
    let mut errors = vec![run(store.load_snapshot(f.stream)).unwrap_err()];
    sql(&f, "UPDATE events SET occurred_at='secret-canary'");
    errors.push(load(&f).unwrap_err());
    sql(&f, "PRAGMA application_id=7");
    errors.push(load(&f).unwrap_err());
    for e in errors {
        let text = format!("{e:?}: {e}");
        assert!(text.len() < 512);
        for secret in [
            "secret-canary",
            f.path.to_str().unwrap(),
            &f.stream.to_string(),
            "UPDATE events",
        ] {
            assert!(!text.contains(secret));
        }
    }
    let source = include_str!("sqlite.rs");
    let load = source
        .split("fn load_snapshot_transaction(")
        .nth(1)
        .unwrap()
        .split("async fn await_replay_worker")
        .next()
        .unwrap();
    for forbidden in [
        "open_connection(",
        "validate_and_prepare(",
        "initialize_database(",
        "execute(",
        "execute_batch(",
    ] {
        assert!(!load.contains(forbidden));
    }
    assert!(load.contains("open_read_connection(path)"));
}

#[test]
fn snapshot_load_subprocess_probe() {
    let Ok(path) = std::env::var("CODEBOX_LOAD_PROBE_PATH") else {
        return;
    };
    let path = PathBuf::from(path);
    let stream = SessionId::try_from_uuid(
        Uuid::parse_str(&std::env::var("CODEBOX_LOAD_PROBE_STREAM").unwrap()).unwrap(),
    )
    .unwrap();
    let mode = std::env::var("CODEBOX_LOAD_PROBE_PHASE").unwrap();
    let store = run(SqliteEventStore::open(path)).unwrap();
    let store = hooked(&store, move |point| {
        let exit = matches!(
            (mode.as_str(), point),
            ("pin", LoadPoint::Pinned)
                | ("page", LoadPoint::Page(256))
                | ("verified", LoadPoint::Verified)
                | ("reply", LoadPoint::Finished)
        );
        if exit {
            std::process::exit(73);
        }
        Ok(())
    });
    let _ = run(store.load_snapshot(stream));
    panic!("probe did not reach selected public load phase");
}
fn interrupt(f: &Fixture, mode: &str) {
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "sqlite::snapshot_load_tests::snapshot_load_subprocess_probe",
            "--nocapture",
        ])
        .env("CODEBOX_LOAD_PROBE_PATH", &f.path)
        .env("CODEBOX_LOAD_PROBE_STREAM", f.stream.to_string())
        .env("CODEBOX_LOAD_PROBE_PHASE", mode)
        .output()
        .unwrap();
    assert_eq!(
        status.status.code(),
        Some(73),
        "{}",
        String::from_utf8_lossy(&status.stderr)
    );
}
#[test]
fn snapshot_load_restart_and_process_interruption_preserve_state() {
    let f = saved(257);
    run(f.store.append(
        f.stream,
        EventSeq::new(257),
        vec![event(258, DomainEvent::SessionResumed)],
    ))
    .unwrap();
    let before = fingerprint(&f.path);
    for mode in ["pin", "page", "verified", "reply"] {
        interrupt(&f, mode);
        assert_eq!(fingerprint(&f.path), before);
        let reopened = run(SqliteEventStore::open(f.path.clone())).unwrap();
        assert_eq!(
            run(reopened.load_snapshot(f.stream)),
            Ok(Some(f.snapshot.clone()))
        );
        assert_eq!(fingerprint(&f.path), before);
    }
    for absent in [true, false] {
        sql(
            &f,
            if absent {
                "DELETE FROM snapshots"
            } else {
                "INSERT OR REPLACE INTO snapshots SELECT stream_id,seq,1,NULL FROM events WHERE seq=x'0000000000000001'"
            },
        );
        let before = fingerprint(&f.path);
        let reopened = run(SqliteEventStore::open(f.path.clone())).unwrap();
        assert_eq!(run(reopened.load_snapshot(f.stream)), Ok(None));
        assert_eq!(fingerprint(&f.path), before);
    }
    let f = saved(1);
    sql(
        &f,
        "PRAGMA ignore_check_constraints=ON; UPDATE events SET correlation_id=x'00'; PRAGMA ignore_check_constraints=OFF",
    );
    let before = fingerprint(&f.path);
    assert_eq!(
        run(SqliteEventStore::open(f.path.clone())).unwrap_err(),
        EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema
        }
    );
    assert_eq!(fingerprint(&f.path), before);
}

#[test]
fn snapshot_load_page_partition_and_repeated_reads_are_equal() {
    for count in [1, 255, 256, 257, 4096] {
        let f = saved(count);
        let (store, pages) = page_observer(&f);
        let before = fingerprint(&f.path);
        for _ in 0..2 {
            pages.lock().unwrap().clear();
            assert_eq!(
                run(store.load_snapshot(f.stream)),
                Ok(Some(f.snapshot.clone()))
            );
            let counts = pages.lock().unwrap();
            assert!(counts.iter().all(|n| *n <= 256));
            assert_eq!(counts.iter().sum::<usize>(), count);
            assert!(counts.len() <= 16);
        }
        for limit in [1, 255, 256] {
            let mut own = SessionReducer::new(f.stream);
            loop {
                let page = run(f.store.load_after(f.stream, own.last_seq(), limit)).unwrap();
                if page.is_empty() {
                    break;
                }
                for e in page {
                    own = own.apply(&e).unwrap();
                }
            }
            assert_eq!(own.projection(), Some(f.snapshot.projection()));
        }
        assert_eq!(fingerprint(&f.path), before);
    }
}

#[test]
fn snapshot_model_never_changes_history_or_regresses_cache() {
    let f = fixture(1);
    let streams = [SessionId::new(), SessionId::new(), SessionId::new()];
    let mut histories: Vec<Vec<DomainEventEnvelope>> = vec![Vec::new(); 3];
    let mut caches: Vec<Option<SessionSnapshot>> = vec![None; 3];
    let mut seed = 0x5adf_1123u64;
    for _ in 0..120 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        let index = ((seed >> 32) % 3) as usize;
        let choice = seed % 4;
        match choice {
            0 | 1 => {
                let seq = histories[index].len() as u64;
                let payload = match seq {
                    0 => DomainEvent::SessionCreated,
                    1 => DomainEvent::SandboxProvisioned {
                        sandbox_id: SandboxId::new(),
                    },
                    n if n % 2 == 0 => DomainEvent::SessionIdled,
                    _ => DomainEvent::SessionResumed,
                };
                let page = run(f.store.append(
                    streams[index],
                    EventSeq::new(seq),
                    vec![event(seq + 1, payload)],
                ))
                .unwrap();
                histories[index].extend(page);
            }
            2 if !histories[index].is_empty() => {
                let value = snapshot(streams[index], &histories[index]);
                if let Some(previous) = &caches[index] {
                    assert!(value.projection().last_seq() >= previous.projection().last_seq());
                }
                run(f
                    .store
                    .save_snapshot(value.clone(), value.projection().last_seq()))
                .unwrap();
                let before = fingerprint(&f.path);
                run(f
                    .store
                    .save_snapshot(value.clone(), value.projection().last_seq()))
                .unwrap();
                assert_eq!(fingerprint(&f.path), before, "equal bytes immutable");
                caches[index] = Some(value);
            }
            _ => {
                let before = fingerprint(&f.path);
                let got = run(f.store.load_snapshot(streams[index])).unwrap();
                assert_eq!(got, caches[index]);
                if let Some(value) = got {
                    let seq = value.projection().last_seq().value() as usize;
                    assert_eq!(value, snapshot(streams[index], &histories[index][..seq]));
                }
                assert_eq!(fingerprint(&f.path), before);
            }
        }
    }
    for (index, stream) in streams.into_iter().enumerate() {
        assert_eq!(
            run(f.store.load_after(stream, EventSeq::initial(), 256)).unwrap(),
            histories[index]
        );
    }
}

#[test]
fn snapshot_design_and_runtime_acceptance_are_distinct() {
    assert!(
        include_str!("../../../docs/acceptance/T030C-design.acceptance.md")
            .contains("decision: accepted")
    );
    let d = include_str!("../../../docs/acceptance/T030D.acceptance.md");
    assert!(d.contains("decision: accepted"));
    let spec = include_str!("../../../docs/specs/SPEC-T030C-sqlite-snapshot-load.md");
    assert!(spec.contains("C12 — Independent acceptance"));
    assert!(spec.contains("Parent T030 acceptance MUST separately"));
    let parent = include_str!("../../../docs/tasks/T030.task.md");
    for name in [
        "event_store_snapshot_composition_survives_restart",
        "event_store_snapshot_miss_keeps_durable_replay_authoritative",
        "event_store_snapshot_failure_preserves_append_replay_and_other_streams",
    ] {
        assert!(parent.contains(name));
    }
    assert!(include_str!("sqlite.rs").contains("pub async fn load_snapshot"));
    // Draft/design/runtime/parent are independent report artifacts; final decisions belong to reviewer.
    let c = include_str!("../../../docs/tasks/T030C.task.md");
    assert!(c.contains("SPEC-T030C"));
    assert!(c.contains("independent"));
    let docs = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../docs");
    if c.lines().any(|line| line == "status: accepted") {
        assert!(
            std::fs::read_to_string(docs.join("acceptance/T030C.acceptance.md"))
                .unwrap()
                .lines()
                .any(|line| line == "decision: accepted"),
            "C design alone cannot imply runtime acceptance"
        );
    }
    if parent.lines().any(|line| line == "status: accepted") {
        for child in ["T030A", "T030B", "T030C", "T030D"] {
            assert!(
                std::fs::read_to_string(docs.join(format!("tasks/{child}.task.md")))
                    .unwrap()
                    .lines()
                    .any(|line| line == "status: accepted")
            );
        }
        assert!(
            std::fs::read_to_string(docs.join("acceptance/T030.acceptance.md"))
                .unwrap()
                .lines()
                .any(|line| line == "decision: accepted")
        );
    }
    assert!(spec.contains("compiling fixed-failure skeleton"));
    assert!(spec.contains("No public domain object is"));
}

#[test]
fn event_store_snapshot_composition_survives_restart() {
    let f = saved(257);
    let other = SessionId::new();
    let other_events = run(f.store.append(
        other,
        EventSeq::initial(),
        vec![event(1, DomainEvent::SessionCreated)],
    ))
    .unwrap();
    let other_snapshot = snapshot(other, &other_events);
    run(f
        .store
        .save_snapshot(other_snapshot.clone(), EventSeq::new(1)))
    .unwrap();
    let prefix = load(&f).unwrap().unwrap();
    assert_eq!(prefix, f.snapshot);
    let suffix = run(f.store.append(
        f.stream,
        EventSeq::new(257),
        vec![event(258, DomainEvent::SessionResumed)],
    ))
    .unwrap();
    let reopened = run(SqliteEventStore::open(f.path.clone())).unwrap();
    assert_eq!(
        run(reopened.load_snapshot(f.stream)),
        Ok(Some(prefix.clone()))
    );
    assert_eq!(run(reopened.load_snapshot(other)), Ok(Some(other_snapshot)));
    let mut own = SessionReducer::new(f.stream);
    let mut all = Vec::new();
    loop {
        let page = run(reopened.load_after(f.stream, own.last_seq(), 256)).unwrap();
        if page.is_empty() {
            break;
        }
        for e in page {
            own = own.apply(&e).unwrap();
            all.push(e);
        }
    }
    let mut expected = f.history.clone();
    expected.extend(suffix);
    assert_eq!(all, expected);
    assert_eq!(own.last_seq(), EventSeq::new(258));
    let current = SessionSnapshot::from_projection(own.projection().unwrap().clone()).unwrap();
    run(reopened.save_snapshot(current.clone(), EventSeq::new(258))).unwrap();
    assert_eq!(run(reopened.load_snapshot(f.stream)), Ok(Some(current)));
    let c = Connection::open(&f.path).unwrap();
    validate_identity(&c, true).unwrap();
    validate_integrity(&c).unwrap();
    assert_eq!(pragma_u32(&c, "user_version").unwrap(), 2);
    assert_eq!(
        run(reopened.load_after(other, EventSeq::initial(), 256)).unwrap(),
        other_events
    );
}

#[test]
fn event_store_snapshot_miss_keeps_durable_replay_authoritative() {
    let f = saved(257);
    sql(
        &f,
        "UPDATE snapshots SET seq=NULL,codec_version='unsupported',body=zeroblob(1000000)",
    );
    let before = fingerprint(&f.path);
    unchanged(&f, Ok(None));
    let reopened = run(SqliteEventStore::open(f.path.clone())).unwrap();
    assert_eq!(run(reopened.load_snapshot(f.stream)), Ok(None));
    let mut own = SessionReducer::new(f.stream);
    let mut exact = Vec::new();
    loop {
        let page = run(reopened.load_after(f.stream, own.last_seq(), 256)).unwrap();
        if page.is_empty() {
            break;
        }
        for e in page {
            own = own.apply(&e).unwrap();
            exact.push(e);
        }
    }
    assert_eq!(exact, f.history);
    assert_eq!(own.projection(), Some(f.snapshot.projection()));
    assert_eq!(fingerprint(&f.path), before);
    assert!(matches!(
        run(reopened.save_snapshot(f.snapshot.clone(), EventSeq::new(257))),
        Err(EventStoreError::InvalidSnapshotCache { .. })
    ));
    assert_eq!(fingerprint(&f.path), before);
    let next = run(reopened.append(
        f.stream,
        EventSeq::new(257),
        vec![event(258, DomainEvent::SessionResumed)],
    ))
    .unwrap();
    assert_eq!(next[0].seq, EventSeq::new(258));
    assert_eq!(
        run(reopened.load_after(f.stream, EventSeq::new(257), 256)).unwrap(),
        next
    );
}

#[test]
fn event_store_snapshot_failure_preserves_append_replay_and_other_streams() {
    let f = saved(2);
    let other = SessionId::new();
    let events = run(f.store.append(
        other,
        EventSeq::initial(),
        vec![event(1, DomainEvent::SessionCreated)],
    ))
    .unwrap();
    let other_value = snapshot(other, &events);
    run(f.store.save_snapshot(other_value.clone(), EventSeq::new(1))).unwrap();
    run(f.store.append(
        f.stream,
        EventSeq::new(2),
        vec![event(3, DomainEvent::SessionIdled)],
    ))
    .unwrap();
    let before = fingerprint(&f.path);
    assert_eq!(
        run(f.store.save_snapshot(f.snapshot.clone(), EventSeq::new(2))),
        Err(EventStoreError::SequenceConflict {
            expected: EventSeq::new(2),
            actual: EventSeq::new(3)
        })
    );
    assert_eq!(fingerprint(&f.path), before);
    sql(
        &f,
        "UPDATE events SET payload=x'00' WHERE seq=x'0000000000000002'",
    );
    let before = fingerprint(&f.path);
    assert_eq!(load(&f), typed_error(CorruptStoreStage::Payload));
    assert_eq!(fingerprint(&f.path), before);
    assert_eq!(
        run(f.store.load_snapshot(other)),
        Ok(Some(other_value.clone()))
    );
    assert_eq!(
        run(f.store.load_after(other, EventSeq::initial(), 256)).unwrap(),
        events
    );
    run(f.store.save_snapshot(other_value, EventSeq::new(1))).unwrap();
    assert_eq!(fingerprint(&f.path), before);
    // Structural load failure leaves raw application state unchanged. Independent access resumes after explicit test repair.
    sql(&f, "PRAGMA application_id=7");
    let before = fingerprint(&f.path);
    assert!(matches!(
        load(&f),
        Err(EventStoreError::UnsupportedDatabaseSchema { .. })
    ));
    assert_eq!(fingerprint(&f.path), before);
    sql(&f, "PRAGMA application_id=1128421425");
    let next = run(f.store.append(
        other,
        EventSeq::new(1),
        vec![event(2, DomainEvent::ProvisioningFailed)],
    ))
    .unwrap();
    assert_eq!(next[0].seq, EventSeq::new(2));
    let value = snapshot(other, &[events, next].concat());
    run(f.store.save_snapshot(value.clone(), EventSeq::new(2))).unwrap();
    assert_eq!(run(f.store.load_snapshot(other)), Ok(Some(value)));
}

// ADR-0006: the existing writer's signed-year output must survive append readback and replay.
#[test]
fn canonical_extended_timestamp_roundtrip_preserves_legacy_rfc3339() {
    for timestamp in [
        DateTime::<Utc>::MIN_UTC,
        DateTime::<Utc>::MAX_UTC,
        Utc.with_ymd_and_hms(-1, 1, 1, 0, 0, 0).single().unwrap(),
        Utc.with_ymd_and_hms(0, 1, 1, 0, 0, 0).single().unwrap(),
        Utc.with_ymd_and_hms(9999, 12, 31, 23, 59, 59)
            .single()
            .unwrap(),
        Utc.with_ymd_and_hms(10000, 1, 1, 0, 0, 0).single().unwrap(),
        Utc.timestamp_opt(-1, 1_999_999_999).single().unwrap(),
        Utc.timestamp_opt(59, 1_000_000_000).single().unwrap(),
    ] {
        let f = fixture(1);
        let stream = SessionId::new();
        let mut input = event(1, DomainEvent::SessionCreated);
        input.occurred_at = timestamp;
        let before = event_rows(&f.path);
        let result = run(f.store.append(stream, EventSeq::initial(), vec![input]));
        if result.is_err() {
            assert_eq!(
                event_rows(&f.path),
                before,
                "failed readback rolls back append"
            );
        }
        let events = result.expect("canonical writer timestamp must roundtrip before COMMIT");
        assert_eq!(events[0].occurred_at, timestamp);
        let value = snapshot(stream, &events);
        run(f.store.save_snapshot(value.clone(), EventSeq::new(1))).unwrap();
        let reopened = run(SqliteEventStore::open(f.path.clone())).unwrap();
        assert_eq!(
            run(reopened.load_after(stream, EventSeq::initial(), 256)).unwrap(),
            events
        );
        let loaded = run(reopened.load_snapshot(stream)).unwrap().unwrap();
        assert_eq!(loaded, value);
        assert_eq!(loaded.projection().last_activity(), timestamp);
    }
    // Existing strict RFC3339 offsets and fractional forms remain accepted without canonicalization.
    for legacy in [
        "2000-01-01T01:00:00+01:00",
        "2000-01-01T00:00:00.12Z",
        "2016-12-31T23:59:60Z",
    ] {
        let f = fixture(1);
        Connection::open(&f.path)
            .unwrap()
            .execute("UPDATE events SET occurred_at=?1", params![legacy])
            .unwrap();
        let expected = DateTime::parse_from_rfc3339(legacy)
            .unwrap()
            .with_timezone(&Utc);
        let events = run(f.store.load_after(f.stream, EventSeq::initial(), 256)).unwrap();
        assert_eq!(events[0].occurred_at, expected);
        let value = snapshot(f.stream, &events);
        run(f.store.save_snapshot(value.clone(), EventSeq::new(1))).unwrap();
        unchanged(&f, Ok(Some(value)));
    }
    for rejected in [
        " +10000-01-01T00:00:00.000000000Z",
        "+10000-01-01 00:00:00.000000000Z",
        "+10000-01-01T00:00:00Z",
        "+10000-01-01T00:00:00.000Z",
        "+10000-01-01T00:00:00.000000000+00:00",
        "+10000-01-01T00:00:00.000000000z",
        "+10000-01-01T00:00:00.000000000Zjunk",
        "+010000-01-01T00:00:00.000000000Z",
        "++10000-01-01T00:00:00.000000000Z",
        "+10000-02-30T00:00:00.000000000Z",
        "+262143-01-01T00:00:00.000000000Z",
        "+10000-01-01T00:00:00.2000000000Z",
    ] {
        let f = saved(1);
        Connection::open(&f.path)
            .unwrap()
            .execute("UPDATE events SET occurred_at=?1", params![rejected])
            .unwrap();
        let before = fingerprint(&f.path);
        assert_eq!(
            run(f.store.load_after(f.stream, EventSeq::initial(), 256)),
            Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Timestamp
            })
        );
        unchanged(&f, typed_error(CorruptStoreStage::Timestamp));
        assert_eq!(fingerprint(&f.path), before);
    }
    for mutation in [
        "UPDATE events SET occurred_at=printf('%065d',1)",
        "UPDATE events SET occurred_at=CAST(x'80' AS TEXT)",
        "UPDATE events SET occurred_at=''",
        "UPDATE events SET occurred_at=1",
    ] {
        let f = saved(1);
        sql(&f, mutation);
        let before = fingerprint(&f.path);
        assert_eq!(
            run(f.store.load_after(f.stream, EventSeq::initial(), 256)),
            Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Timestamp
            })
        );
        unchanged(&f, typed_error(CorruptStoreStage::Timestamp));
        assert_eq!(fingerprint(&f.path), before);
    }
}

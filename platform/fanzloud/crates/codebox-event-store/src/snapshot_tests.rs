use super::*;
use crate::snapshot::{MAX_SNAPSHOT_BYTES, MAX_SNAPSHOT_PREFIX_EVENTS};
use chrono::{DateTime, TimeZone, Utc};
use codebox_domain::{ApprovalDecision, ApprovalId, DomainEvent, SandboxId, TurnId};
use std::os::unix::fs::{PermissionsExt, symlink};
use std::process::Command;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Barrier, Mutex};
use tempfile::{TempDir, tempdir};

fn run<T>(future: impl std::future::Future<Output = T>) -> T {
    tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .max_blocking_threads(4)
        .enable_all()
        .build()
        .expect("runtime")
        .block_on(future)
}
fn root() -> TempDir {
    let root = tempdir().expect("root");
    std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
    root
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
fn reduce(stream: SessionId, events: &[DomainEventEnvelope]) -> SessionSnapshot {
    let mut reducer = SessionReducer::new(stream);
    for envelope in events {
        reducer = reducer.apply(envelope).expect("legal history");
    }
    SessionSnapshot::from_projection(reducer.projection().unwrap().clone())
        .expect("bounded projection")
}
fn fabricated(stream: SessionId, payloads: Vec<DomainEvent>) -> SessionSnapshot {
    let events = payloads
        .into_iter()
        .enumerate()
        .map(|(index, payload)| {
            let e = event(index as u64 + 1, payload);
            DomainEventEnvelope {
                event_id: Uuid::from_u128(index as u128 + 10),
                stream_id: stream,
                seq: EventSeq::new(index as u64 + 1),
                schema_version: 1,
                occurred_at: e.occurred_at,
                causation_id: e.causation_id,
                correlation_id: e.correlation_id,
                payload: e.payload,
            }
        })
        .collect::<Vec<_>>();
    reduce(stream, &events)
}
fn fixture(count: usize) -> (TempDir, PathBuf, SqliteEventStore, SessionSnapshot) {
    let root = root();
    let path = root.path().join("events.sqlite");
    let store = run(SqliteEventStore::open(path.clone())).unwrap();
    let stream = SessionId::new();
    let sandbox = SandboxId::new();
    let mut history = Vec::new();
    let mut head = EventSeq::initial();
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
        let page = run(store.append(stream, head, inputs)).unwrap();
        head = page.last().unwrap().seq;
        history.extend(page);
    }
    let snapshot = reduce(stream, &history);
    (root, path, store, snapshot)
}
fn save(path: &Path, snapshot: SessionSnapshot) -> Result<(), EventStoreError> {
    let seq = snapshot.projection().last_seq();
    save_with_hook(path, snapshot, seq, |_| Ok(()))
}
fn cache(path: &Path, stream: SessionId) -> Option<(EventSeq, [u8; 96])> {
    read_snapshot_row(&Connection::open(path).unwrap(), stream).unwrap()
}
fn fingerprint(path: &Path) -> Vec<Vec<rusqlite::types::Value>> {
    let c = Connection::open(path).unwrap();
    let mut q = c
        .prepare("SELECT * FROM events ORDER BY stream_id,seq")
        .unwrap();
    q.query_map([], |r| (0..8).map(|i| r.get(i)).collect())
        .unwrap()
        .collect::<Result<_, _>>()
        .unwrap()
}
fn inject(path: &Path, snapshot: &SessionSnapshot, body: [u8; 96]) {
    let c = Connection::open(path).unwrap();
    c.execute(
        "INSERT OR REPLACE INTO snapshots VALUES(?1,?2,1,?3)",
        params![
            snapshot
                .projection()
                .session_id()
                .as_uuid()
                .as_bytes()
                .as_slice(),
            sequence_bytes(snapshot.projection().last_seq()).as_slice(),
            body.as_slice()
        ],
    )
    .unwrap();
}
fn fault() -> EventStoreError {
    EventStoreError::Storage {
        operation: StorageOperation::SnapshotWrite,
        kind: StorageErrorKind::Io,
    }
}
fn v1(path: &Path) {
    let c = Connection::open(path).unwrap();
    c.execute_batch(EVENTS_SCHEMA_SQL).unwrap();
    c.execute_batch(
        "PRAGMA application_id=1128421425; PRAGMA user_version=1; PRAGMA journal_mode=WAL",
    )
    .unwrap();
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
}

#[test]
fn snapshot_value_bounds_precede_database_access() {
    assert_eq!(
        validate_sequence(0),
        Err(EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::Empty
        })
    );
    assert_eq!(
        validate_sequence(4097),
        Err(EventStoreError::SnapshotPrefixTooLarge {
            max: 4096,
            actual: 4097
        })
    );
    for seq in [1, 4096] {
        assert_eq!(validate_sequence(seq), Ok(()));
    }
    let (_root, path, store, snapshot) = fixture(1);
    std::fs::remove_file(&path).unwrap();
    assert_eq!(
        run(store.save_snapshot(snapshot, EventSeq::new(2))),
        Err(EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::ExpectedSequenceMismatch
        })
    );
    assert!(!path.exists());
    // Build above-budget state solely using public reducer, without any projection setter.
    let stream = SessionId::new();
    let mut reducer = SessionReducer::new(stream);
    for i in 1..=4097 {
        let e = event(
            i,
            if i == 1 {
                DomainEvent::SessionCreated
            } else if i == 2 {
                DomainEvent::SandboxProvisioned {
                    sandbox_id: SandboxId::new(),
                }
            } else if i % 2 == 1 {
                DomainEvent::SessionIdled
            } else {
                DomainEvent::SessionResumed
            },
        );
        reducer = reducer
            .apply(&DomainEventEnvelope {
                event_id: Uuid::from_u128(i as u128),
                stream_id: stream,
                seq: EventSeq::new(i),
                schema_version: 1,
                occurred_at: e.occurred_at,
                causation_id: None,
                correlation_id: e.correlation_id,
                payload: e.payload,
            })
            .unwrap();
    }
    assert_eq!(
        SessionSnapshot::from_projection(reducer.projection().unwrap().clone()),
        Err(EventStoreError::SnapshotPrefixTooLarge {
            max: 4096,
            actual: 4097
        })
    );
}
#[test]
fn snapshot_codec_is_exact_canonical_96_bytes() {
    let stream = SessionId::new();
    let sandbox = SandboxId::new();
    let turn = TurnId::new();
    let approval = ApprovalId::new();
    let histories = vec![
        vec![DomainEvent::SessionCreated],
        vec![
            DomainEvent::SessionCreated,
            DomainEvent::SandboxProvisioned {
                sandbox_id: sandbox,
            },
        ],
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
    let mut statuses = std::collections::BTreeSet::new();
    for history in histories {
        for end in 1..=history.len() {
            let snapshot = fabricated(stream, history[..end].to_vec());
            let body = encode_snapshot(&snapshot);
            statuses.insert(body[32]);
            assert_eq!(body.len(), MAX_SNAPSHOT_BYTES);
            assert_eq!(&body[..8], b"CBS1\0\x01\0\x01");
            assert_eq!(&body[8..24], stream.as_uuid().as_bytes());
            assert_eq!(
                validate_body(
                    &body,
                    stream.as_uuid().as_bytes(),
                    &sequence_bytes(snapshot.projection().last_seq())
                ),
                Ok(())
            );
            assert_eq!(
                &body[84..92],
                &snapshot
                    .projection()
                    .last_activity()
                    .timestamp()
                    .to_be_bytes()
            );
            assert_eq!(
                body[33],
                u8::from(snapshot.projection().active_turn().is_some())
            );
            assert_eq!(
                body[50],
                u8::from(snapshot.projection().pending_approval().is_some())
            );
            assert_eq!(
                body[67],
                u8::from(snapshot.projection().sandbox_id().is_some())
            );
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
        let e = DomainEventEnvelope {
            event_id: Uuid::new_v4(),
            stream_id: stream,
            seq: EventSeq::new(1),
            schema_version: 1,
            occurred_at: timestamp,
            causation_id: None,
            correlation_id: Uuid::new_v4(),
            payload: DomainEvent::SessionCreated,
        };
        let body = encode_snapshot(&reduce(stream, &[e]));
        assert_eq!(
            validate_body(&body, stream.as_uuid().as_bytes(), &1u64.to_be_bytes()),
            Ok(())
        );
        assert_eq!(
            DateTime::<Utc>::from_timestamp(
                i64::from_be_bytes(body[84..92].try_into().unwrap()),
                u32::from_be_bytes(body[92..].try_into().unwrap())
            ),
            Some(timestamp)
        );
    }
    let snapshot = fabricated(stream, vec![DomainEvent::SessionCreated]);
    let body = encode_snapshot(&snapshot);
    for (offset, value) in [
        (0, 0),
        (4, 2),
        (6, 2),
        (32, 9),
        (33, 2),
        (34, 1),
        (50, 1),
        (67, 1),
    ] {
        let mut bad = body;
        bad[offset] = value;
        assert!(validate_body(&bad, stream.as_uuid().as_bytes(), &1u64.to_be_bytes()).is_err());
    }
    let mut extra = body.to_vec();
    extra.push(0);
    assert_eq!(
        validate_body(&extra, stream.as_uuid().as_bytes(), &1u64.to_be_bytes()),
        Err(SnapshotCacheReason::Width)
    );
    let mut bad = body;
    bad[92..].copy_from_slice(&2_000_000_000u32.to_be_bytes());
    assert_eq!(
        validate_body(&bad, stream.as_uuid().as_bytes(), &1u64.to_be_bytes()),
        Err(SnapshotCacheReason::Timestamp)
    );
}
#[test]
fn snapshot_body_gated_before_allocation() {
    let (_root, path, _store, snapshot) = fixture(1);
    let stream = snapshot.projection().session_id();
    inject(&path, &snapshot, encode_snapshot(&snapshot));
    let c = Connection::open(&path).unwrap();
    for value in [
        rusqlite::types::Value::Null,
        rusqlite::types::Value::Integer(1),
        rusqlite::types::Value::Text("canary".repeat(10_000)),
        rusqlite::types::Value::Blob(vec![7; 1_000_000]),
    ] {
        c.execute("UPDATE snapshots SET body=?1", params![value])
            .unwrap();
        let projected: Option<Vec<u8>> = c
            .query_row(
                SNAPSHOT_QUERY,
                params![stream.as_uuid().as_bytes().as_slice()],
                |row| row.get(2),
            )
            .unwrap();
        assert_eq!(projected, None);
        assert!(matches!(
            save(&path, snapshot.clone()),
            Err(EventStoreError::InvalidSnapshotCache { .. })
        ));
    }
}
#[test]
fn snapshot_expected_sequence_is_durable_head() {
    let (_root, path, store, snapshot) = fixture(1);
    let before = fingerprint(&path);
    assert_eq!(
        run(store.save_snapshot(snapshot.clone(), EventSeq::new(2))),
        Err(EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::ExpectedSequenceMismatch
        })
    );
    let absent = fabricated(SessionId::new(), vec![DomainEvent::SessionCreated]);
    assert_eq!(
        save(&path, absent),
        Err(EventStoreError::SequenceConflict {
            expected: EventSeq::new(1),
            actual: EventSeq::new(0)
        })
    );
    let ahead = fabricated(
        snapshot.projection().session_id(),
        vec![DomainEvent::SessionCreated, DomainEvent::ProvisioningFailed],
    );
    assert_eq!(
        save(&path, ahead),
        Err(EventStoreError::SequenceConflict {
            expected: EventSeq::new(2),
            actual: EventSeq::new(1)
        })
    );
    assert_eq!(fingerprint(&path), before);
    assert_eq!(cache(&path, snapshot.projection().session_id()), None);
}
#[test]
fn snapshot_append_race_obeys_writer_order() {
    for save_first in [true, false] {
        let (_root, path, store, snapshot) = fixture(1);
        let stream = snapshot.projection().session_id();
        let before = fingerprint(&path);
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        if save_first {
            let (e, r, p, s) = (
                entered.clone(),
                release.clone(),
                path.clone(),
                snapshot.clone(),
            );
            let saver = std::thread::spawn(move || {
                save_with_hook(&p, s, EventSeq::new(1), |point| {
                    if point == SavePoint::Locked {
                        e.wait();
                        r.wait();
                    }
                    Ok(())
                })
            });
            entered.wait();
            let writer = std::thread::spawn(move || {
                run(store.append(
                    stream,
                    EventSeq::new(1),
                    vec![event(2, DomainEvent::ProvisioningFailed)],
                ))
            });
            release.wait();
            assert_eq!(saver.join().unwrap(), Ok(()));
            assert_eq!(writer.join().unwrap().unwrap()[0].seq, EventSeq::new(2));
            assert_eq!(cache(&path, stream).unwrap().0, EventSeq::new(1));
        } else {
            let mut c = open_connection(&path).unwrap();
            let tx = c
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            let prepared = prepare_batch(
                stream,
                EventSeq::new(1),
                vec![event(2, DomainEvent::ProvisioningFailed)],
                &Uuid::new_v4,
            )
            .unwrap();
            insert_event(&tx, &prepared[0]).unwrap();
            let (e, p, s) = (entered.clone(), path.clone(), snapshot.clone());
            let saver = std::thread::spawn(move || {
                e.wait();
                save(&p, s)
            });
            entered.wait();
            tx.commit().unwrap();
            assert_eq!(
                saver.join().unwrap(),
                Err(EventStoreError::SequenceConflict {
                    expected: EventSeq::new(1),
                    actual: EventSeq::new(2)
                })
            );
            assert_eq!(cache(&path, stream), None);
        }
        assert_eq!(&fingerprint(&path)[..1], before.as_slice());
    }
}
#[test]
fn snapshot_fabricated_legal_projection_is_rejected() {
    let (_root, path, _store, snapshot) = fixture(2);
    let stream = snapshot.projection().session_id();
    let fake = fabricated(
        stream,
        vec![
            DomainEvent::SessionCreated,
            DomainEvent::SandboxProvisioned {
                sandbox_id: SandboxId::new(),
            },
        ],
    );
    assert_eq!(
        save(&path, fake),
        Err(EventStoreError::SnapshotHistoryMismatch {
            seq: EventSeq::new(2)
        })
    );
    assert_eq!(cache(&path, stream), None);
}
#[test]
fn snapshot_all_projection_fields_match_persisted_prefix() {
    let (_root, path, store, _snapshot) = fixture(2);
    let stream = run(store.load_after(SessionId::new(), EventSeq::initial(), 1)).unwrap();
    assert!(stream.is_empty());
    // Mutate each canonical field of an existing equal-head cache independently. Save must
    // compare complete bytes after provenance, and never repair the conflicting row.
    let stream = Connection::open(&path)
        .unwrap()
        .query_row("SELECT stream_id FROM events LIMIT 1", [], |r| {
            r.get::<_, Vec<u8>>(0)
        })
        .unwrap();
    let stream = SessionId::try_from(Uuid::from_slice(&stream).unwrap()).unwrap();
    let events = run(store.load_after(stream, EventSeq::initial(), 256)).unwrap();
    let snapshot = reduce(stream, &events);
    let original = encode_snapshot(&snapshot);
    for offset in [8, 24, 32, 33, 50, 67, 84, 92] {
        let mut bad = original;
        bad[offset] ^= 1;
        inject(&path, &snapshot, bad);
        let before = fingerprint(&path);
        let outcome = save(&path, snapshot.clone());
        assert!(matches!(
            outcome,
            Err(EventStoreError::SnapshotConflict {
                reason: SnapshotConflictReason::DifferentContent,
                ..
            }) | Err(EventStoreError::InvalidSnapshotCache { .. })
        ));
        assert_eq!(fingerprint(&path), before);
        let actual: Vec<u8> = Connection::open(&path)
            .unwrap()
            .query_row("SELECT body FROM snapshots", [], |r| r.get(0))
            .unwrap();
        assert_eq!(actual, bad);
    }
    let mut changed = events;
    changed[1].occurred_at = Utc.timestamp_opt(99, 0).single().unwrap();
    assert_eq!(
        save(&path, reduce(stream, &changed)),
        Err(EventStoreError::SnapshotHistoryMismatch {
            seq: EventSeq::new(2)
        })
    );
    // Candidate equality uses every domain getter: histories are legal and share the durable
    // stream/head, but differ in sandbox, active turn, pending approval, status or last activity.
    let root = root();
    let path = root.path().join("fields.sqlite");
    let store = run(SqliteEventStore::open(path.clone())).unwrap();
    let stream = SessionId::new();
    let sandbox = SandboxId::new();
    let turn = TurnId::new();
    let approval = ApprovalId::new();
    let payloads = vec![
        DomainEvent::SessionCreated,
        DomainEvent::SandboxProvisioned {
            sandbox_id: sandbox,
        },
        DomainEvent::TurnStarted { turn_id: turn },
        DomainEvent::ApprovalRequested {
            turn_id: turn,
            approval_id: approval,
        },
    ];
    let events = run(store.append(
        stream,
        EventSeq::initial(),
        payloads
            .iter()
            .cloned()
            .enumerate()
            .map(|(i, p)| event(i as u64 + 1, p))
            .collect(),
    ))
    .unwrap();
    let snapshot = reduce(stream, &events);
    assert_eq!(save(&path, snapshot.clone()), Ok(()));
    let original = cache(&path, stream);
    let history = fingerprint(&path);
    let mut variants = Vec::new();
    let mut sandbox_variant = payloads.clone();
    sandbox_variant[1] = DomainEvent::SandboxProvisioned {
        sandbox_id: SandboxId::new(),
    };
    variants.push(fabricated(stream, sandbox_variant));
    let other_turn = TurnId::new();
    let mut turn_variant = payloads.clone();
    turn_variant[2] = DomainEvent::TurnStarted {
        turn_id: other_turn,
    };
    turn_variant[3] = DomainEvent::ApprovalRequested {
        turn_id: other_turn,
        approval_id: approval,
    };
    variants.push(fabricated(stream, turn_variant));
    let mut approval_variant = payloads.clone();
    approval_variant[3] = DomainEvent::ApprovalRequested {
        turn_id: turn,
        approval_id: ApprovalId::new(),
    };
    variants.push(fabricated(stream, approval_variant));
    let mut status_variant = payloads.clone();
    status_variant[3] = DomainEvent::TurnCancellationRequested { turn_id: turn };
    variants.push(fabricated(stream, status_variant));
    let mut no_turn_variant = payloads.clone();
    no_turn_variant[3] = DomainEvent::TurnCompleted { turn_id: turn };
    variants.push(fabricated(stream, no_turn_variant));
    let mut timestamp_variant = events.clone();
    timestamp_variant[3].occurred_at = Utc.timestamp_opt(-1, 1_500_000_000).single().unwrap();
    variants.push(reduce(stream, &timestamp_variant));
    for candidate in variants {
        assert_eq!(
            save(&path, candidate),
            Err(EventStoreError::SnapshotHistoryMismatch {
                seq: EventSeq::new(4)
            })
        );
        assert_eq!(cache(&path, stream), original);
        assert_eq!(fingerprint(&path), history);
    }
    assert_eq!(
        save(&path, fabricated(SessionId::new(), payloads.clone())),
        Err(EventStoreError::SequenceConflict {
            expected: EventSeq::new(4),
            actual: EventSeq::new(0)
        })
    );
    assert_eq!(
        run(store.save_snapshot(fabricated(stream, payloads[..3].to_vec()), EventSeq::new(4))),
        Err(EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::ExpectedSequenceMismatch
        })
    );
}
#[test]
fn snapshot_corrupt_history_never_becomes_cache_miss() {
    for sql in [
        "DELETE FROM events WHERE seq=x'0000000000000002'",
        "UPDATE events SET schema_version=2 WHERE seq=x'0000000000000001'",
        "UPDATE events SET payload=x'00' WHERE seq=x'0000000000000001'",
        "UPDATE events SET occurred_at='secret-canary' WHERE seq=x'0000000000000001'",
        "UPDATE events SET payload=x'7b2274797065223a2273657373696f6e5f63726561746564227d' WHERE seq=x'0000000000000002'",
    ] {
        let (_root, path, _store, snapshot) = fixture(3);
        Connection::open(&path).unwrap().execute_batch(sql).unwrap();
        let before = fingerprint(&path);
        assert!(matches!(
            save(&path, snapshot.clone()),
            Err(EventStoreError::CorruptStore { .. })
                | Err(EventStoreError::InvalidEventHistory { .. })
        ));
        assert_eq!(fingerprint(&path), before);
        assert_eq!(cache(&path, snapshot.projection().session_id()), None);
    }
    let (_root, path, _store, snapshot) = fixture(2);
    let c = Connection::open(&path).unwrap();
    c.execute_batch("DELETE FROM events WHERE seq=x'0000000000000002'")
        .unwrap();
    // Direct prefix observer detects missing final row even though ordinary EOF is empty.
    assert_eq!(
        verify_prefix(
            &c,
            snapshot.projection().session_id(),
            EventSeq::new(2),
            &|_| Ok(())
        ),
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Sequence
        })
    );
    for (sql, stage) in [
        (
            "UPDATE events SET event_id=zeroblob(16) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::EventId,
        ),
        (
            "UPDATE events SET correlation_id=zeroblob(15) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::CorrelationId,
        ),
        (
            "UPDATE events SET causation_id=zeroblob(15) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::CausationId,
        ),
        (
            "UPDATE events SET occurred_at=printf('%065d',1) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::Timestamp,
        ),
        (
            "UPDATE events SET payload=zeroblob(65537) WHERE seq=x'0000000000000001'",
            CorruptStoreStage::Payload,
        ),
        (
            "UPDATE events SET schema_version=2 WHERE seq=x'0000000000000001'",
            CorruptStoreStage::SchemaVersion,
        ),
    ] {
        let (_root, path, _store, snapshot) = fixture(2);
        Connection::open(&path)
            .unwrap()
            .execute_batch(&format!(
                "PRAGMA ignore_check_constraints=ON; {sql}; PRAGMA ignore_check_constraints=OFF"
            ))
            .unwrap();
        let before = fingerprint(&path);
        assert_eq!(
            save(&path, snapshot),
            Err(EventStoreError::CorruptStore { stage })
        );
        assert_eq!(fingerprint(&path), before);
    }
    for reason in [
        InvalidEventHistoryReason::MissingCreation,
        InvalidEventHistoryReason::TurnIdentity,
        InvalidEventHistoryReason::ApprovalIdentity,
    ] {
        let root = root();
        let path = root.path().join("semantic.sqlite");
        let store = run(SqliteEventStore::open(path.clone())).unwrap();
        let stream = SessionId::new();
        let sandbox = SandboxId::new();
        let turn = TurnId::new();
        let approval = ApprovalId::new();
        let mut payloads = [
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
        ];
        let events = run(store.append(
            stream,
            EventSeq::initial(),
            payloads
                .iter()
                .cloned()
                .enumerate()
                .map(|(i, p)| event(i as u64 + 1, p))
                .collect(),
        ))
        .unwrap();
        let snapshot = reduce(stream, &events);
        let seq = match reason {
            InvalidEventHistoryReason::MissingCreation => {
                payloads[0] = DomainEvent::ProvisioningFailed;
                1
            }
            InvalidEventHistoryReason::TurnIdentity => {
                payloads[3] = DomainEvent::ApprovalRequested {
                    turn_id: TurnId::new(),
                    approval_id: approval,
                };
                4
            }
            _ => {
                payloads[4] = DomainEvent::ApprovalResolved {
                    turn_id: turn,
                    approval_id: ApprovalId::new(),
                    decision: ApprovalDecision::Approved,
                };
                5
            }
        };
        let c = Connection::open(&path).unwrap();
        c.execute(
            "UPDATE events SET payload=?1 WHERE seq=?2",
            params![
                serde_json::to_vec(&payloads[seq - 1]).unwrap(),
                (seq as u64).to_be_bytes().as_slice()
            ],
        )
        .unwrap();
        let before = fingerprint(&path);
        assert_eq!(
            save(&path, snapshot),
            Err(EventStoreError::InvalidEventHistory {
                seq: EventSeq::new(seq as u64),
                reason
            })
        );
        assert_eq!(fingerprint(&path), before);
        assert_eq!(cache(&path, stream), None);
    }
    let (_root, path, _store, snapshot) = fixture(1);
    let c = Connection::open(&path).unwrap();
    c.execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE events SET seq=zeroblob(1000000); PRAGMA ignore_check_constraints=OFF").unwrap();
    assert_eq!(
        save(&path, snapshot),
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Sequence
        })
    );
}
#[test]
fn snapshot_verification_has_page_and_total_bounds() {
    let (_root, path, _store, snapshot) = fixture(4096);
    let pages = Mutex::new(Vec::new());
    assert_eq!(
        save_with_hook(&path, snapshot.clone(), EventSeq::new(4096), |point| {
            if let SavePoint::Page(n) = point {
                pages.lock().unwrap().push(n);
            }
            Ok(())
        }),
        Ok(())
    );
    assert_eq!(*pages.lock().unwrap(), vec![256; 16]);
    assert_eq!(
        cache(&path, snapshot.projection().session_id()).unwrap().0,
        EventSeq::new(4096)
    );
    assert_eq!(MAX_SNAPSHOT_PREFIX_EVENTS, 4096);
    let c = Connection::open(&path).unwrap();
    c.execute_batch("UPDATE events SET payload=zeroblob(65537) WHERE seq=x'0000000000000001'")
        .unwrap();
    assert_eq!(
        save(&path, snapshot),
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Payload
        })
    );
}
#[test]
fn snapshot_same_head_identical_savers_are_idempotent() {
    let (_root, path, _store, snapshot) = fixture(2);
    let barrier = Arc::new(Barrier::new(3));
    let writes = Arc::new(AtomicUsize::new(0));
    let mut workers = Vec::new();
    for _ in 0..2 {
        let (b, w, p, s) = (
            barrier.clone(),
            writes.clone(),
            path.clone(),
            snapshot.clone(),
        );
        workers.push(std::thread::spawn(move || {
            b.wait();
            save_with_hook(&p, s, EventSeq::new(2), |point| {
                if point == SavePoint::Written {
                    w.fetch_add(1, Ordering::SeqCst);
                }
                Ok(())
            })
        }));
    }
    barrier.wait();
    for worker in workers {
        assert_eq!(worker.join().unwrap(), Ok(()));
    }
    assert_eq!(writes.load(Ordering::SeqCst), 1);
    assert_eq!(
        cache(&path, snapshot.projection().session_id()).unwrap().1,
        encode_snapshot(&snapshot)
    );
}
#[test]
fn snapshot_same_head_different_savers_do_not_overwrite() {
    let (_root, path, _store, snapshot) = fixture(2);
    let stream = snapshot.projection().session_id();
    let fake = fabricated(
        stream,
        vec![DomainEvent::SessionCreated, DomainEvent::ProvisioningFailed],
    );
    let b = Arc::new(Barrier::new(3));
    let mut workers = Vec::new();
    for s in [snapshot.clone(), fake] {
        let (b, p) = (b.clone(), path.clone());
        workers.push(std::thread::spawn(move || {
            b.wait();
            save(&p, s)
        }));
    }
    b.wait();
    assert_eq!(workers.remove(0).join().unwrap(), Ok(()));
    assert_eq!(
        workers.remove(0).join().unwrap(),
        Err(EventStoreError::SnapshotHistoryMismatch {
            seq: EventSeq::new(2)
        })
    );
    let mut body = encode_snapshot(&snapshot);
    body[92..].copy_from_slice(&1u32.to_be_bytes());
    inject(&path, &snapshot, body);
    assert_eq!(
        save(&path, snapshot),
        Err(EventStoreError::SnapshotConflict {
            candidate_seq: EventSeq::new(2),
            stored_seq: EventSeq::new(2),
            reason: SnapshotConflictReason::DifferentContent
        })
    );
    assert_eq!(cache(&path, stream).unwrap().1, body);
}
#[test]
fn snapshot_identical_retry_rechecks_head_and_history() {
    let (_root, path, store, snapshot) = fixture(2);
    save(&path, snapshot.clone()).unwrap();
    let verified = AtomicUsize::new(0);
    save_with_hook(&path, snapshot.clone(), EventSeq::new(2), |p| {
        assert_ne!(p, SavePoint::Written);
        if p == SavePoint::Verified {
            verified.fetch_add(1, Ordering::SeqCst);
        }
        Ok(())
    })
    .unwrap();
    assert_eq!(verified.load(Ordering::SeqCst), 1);
    Connection::open(&path)
        .unwrap()
        .execute_batch("UPDATE events SET payload=x'00' WHERE seq=x'0000000000000001'")
        .unwrap();
    assert!(matches!(
        save(&path, snapshot.clone()),
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Payload
        })
    ));
    run(store.append(
        snapshot.projection().session_id(),
        EventSeq::new(2),
        vec![event(3, DomainEvent::SessionIdled)],
    ))
    .unwrap();
    assert_eq!(
        save(&path, snapshot),
        Err(EventStoreError::SequenceConflict {
            expected: EventSeq::new(2),
            actual: EventSeq::new(3)
        })
    );
}
#[test]
fn snapshot_regression_and_invalid_old_row_fail_closed() {
    let (_root, path, _store, snapshot) = fixture(2);
    let stream = snapshot.projection().session_id();
    let newer = fabricated(
        stream,
        vec![
            DomainEvent::SessionCreated,
            DomainEvent::ProvisioningFailed,
            DomainEvent::SessionArchivingStarted,
        ],
    );
    inject(&path, &newer, encode_snapshot(&newer));
    assert_eq!(
        save(&path, snapshot.clone()),
        Err(EventStoreError::SnapshotConflict {
            candidate_seq: EventSeq::new(2),
            stored_seq: EventSeq::new(3),
            reason: SnapshotConflictReason::Regression
        })
    );
    let old = fabricated(stream, vec![DomainEvent::SessionCreated]);
    inject(&path, &old, encode_snapshot(&old));
    save(&path, snapshot.clone()).unwrap();
    assert_eq!(cache(&path, stream).unwrap().0, EventSeq::new(2));
    Connection::open(&path)
        .unwrap()
        .execute_batch("UPDATE snapshots SET seq=x'0000000000000000'")
        .unwrap();
    assert!(matches!(
        save(&path, snapshot),
        Err(EventStoreError::InvalidSnapshotCache { .. })
    ));
}
#[test]
fn snapshot_statement_failure_rolls_back_complete_row() {
    for seed_old in [false, true] {
        let (_root, path, _store, snapshot) = fixture(2);
        let stream = snapshot.projection().session_id();
        if seed_old {
            let old = fabricated(stream, vec![DomainEvent::SessionCreated]);
            inject(&path, &old, encode_snapshot(&old));
        }
        let other = fabricated(SessionId::new(), vec![DomainEvent::SessionCreated]);
        inject(&path, &other, encode_snapshot(&other));
        let original = cache(&path, stream);
        let before = fingerprint(&path);
        assert_eq!(
            save_with_hook(&path, snapshot, EventSeq::new(2), |point| {
                if point == SavePoint::Written {
                    Err(fault())
                } else {
                    Ok(())
                }
            }),
            Err(fault())
        );
        assert_eq!(cache(&path, stream), original);
        assert_eq!(
            cache(&path, other.projection().session_id()).unwrap().1,
            encode_snapshot(&other)
        );
        assert_eq!(fingerprint(&path), before);
        // A failing SQL statement does not itself roll back earlier writes. The guard must.
        let mut c = open_connection(&path).unwrap();
        {
            let tx = c
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .unwrap();
            tx.execute("DELETE FROM snapshots", []).unwrap();
            assert!(
                tx.execute("INSERT INTO snapshots(stream_id) VALUES (x'00')", [])
                    .is_err()
            );
        }
        assert_eq!(cache(&path, stream), original);
        assert!(cache(&path, other.projection().session_id()).is_some());
    }
}
#[test]
fn snapshot_read_transaction_sees_old_or_complete_new() {
    let (_root, path, store, snapshot) = fixture(257);
    let stream = snapshot.projection().session_id();
    let old = fabricated(stream, vec![DomainEvent::SessionCreated]);
    inject(&path, &old, encode_snapshot(&old));
    let mut c = open_read_connection(&path).unwrap();
    let reader = c.transaction().unwrap();
    let oldrow = read_snapshot_row(&reader, stream).unwrap();
    let head = read_high_water(&reader, stream).unwrap();
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let (e, r, p, s) = (
        entered.clone(),
        release.clone(),
        path.clone(),
        snapshot.clone(),
    );
    let writer = std::thread::spawn(move || {
        save_with_hook(&p, s, EventSeq::new(257), |point| {
            if point == SavePoint::Written {
                e.wait();
                r.wait();
            }
            Ok(())
        })
    });
    entered.wait();
    assert_eq!(cache(&path, stream), oldrow);
    assert_eq!(read_snapshot_row(&reader, stream).unwrap(), oldrow);
    release.wait();
    writer.join().unwrap().unwrap();
    run(store.append(
        stream,
        EventSeq::new(257),
        vec![event(258, DomainEvent::SessionResumed)],
    ))
    .unwrap();
    assert_eq!(read_snapshot_row(&reader, stream).unwrap(), oldrow);
    assert_eq!(read_high_water(&reader, stream).unwrap(), head);
    let mut pages = 0;
    assert_eq!(
        verify_prefix(&reader, stream, head, &|p| {
            if let SavePoint::Page(_) = p {}
            Ok(())
        })
        .unwrap(),
        *snapshot.projection()
    );
    // Explicit read pages remain pinned after both snapshot and event commits.
    let mut q = reader
        .prepare("SELECT seq FROM events WHERE stream_id=?1 ORDER BY seq LIMIT 256 OFFSET ?2")
        .unwrap();
    for offset in [0, 256] {
        let n = q
            .query_map(
                params![stream.as_uuid().as_bytes().as_slice(), offset],
                |r| r.get::<_, Vec<u8>>(0),
            )
            .unwrap()
            .count();
        assert_eq!(n, if offset == 0 { 256 } else { 1 });
        pages += 1;
    }
    assert_eq!(pages, 2);
    assert_eq!(cache(&path, stream).unwrap().1, encode_snapshot(&snapshot));
}
#[test]
fn snapshot_busy_storage_and_worker_failures_preserve_history() {
    let (_root, path, _store, snapshot) = fixture(1);
    let before = fingerprint(&path);
    let c = open_connection(&path).unwrap();
    c.execute_batch("BEGIN IMMEDIATE").unwrap();
    assert_eq!(save(&path, snapshot.clone()), Err(EventStoreError::Busy));
    c.execute_batch("ROLLBACK").unwrap();
    for point in [SavePoint::Locked, SavePoint::Written, SavePoint::Committed] {
        let s = snapshot.clone();
        let p = path.clone();
        let result = run(async move {
            task::spawn_blocking(move || {
                save_with_hook(&p, s, EventSeq::new(1), |p| {
                    if p == point {
                        Err(EventStoreError::Storage {
                            operation: StorageOperation::Commit,
                            kind: StorageErrorKind::Io,
                        })
                    } else {
                        Ok(())
                    }
                })
            })
            .await
            .unwrap()
        });
        assert!(matches!(result, Err(EventStoreError::Storage { .. })));
        assert_eq!(fingerprint(&path), before);
        let row = cache(&path, snapshot.projection().session_id());
        assert!(row.is_none() || row.unwrap().1 == encode_snapshot(&snapshot));
    }
    let worker = run(async {
        let worker = task::spawn_blocking(|| -> Result<(), EventStoreError> {
            panic!("private worker failure")
        });
        await_replay_worker(worker).await
    });
    assert_eq!(worker, Err(EventStoreError::WorkerUnavailable));
    assert_eq!(fingerprint(&path), before);
    std::fs::remove_file(&path).unwrap();
    assert!(matches!(
        save(&path, snapshot),
        Err(EventStoreError::Storage {
            operation: StorageOperation::Open,
            ..
        })
    ));
    assert!(!path.exists());
}
#[test]
fn snapshot_cancelled_future_requires_explicit_reconciliation() {
    for point in [SavePoint::Written, SavePoint::Committed] {
        let (_root, path, store, snapshot) = fixture(1);
        let before = fingerprint(&path);
        let entered = Arc::new(Barrier::new(2));
        let release = Arc::new(Barrier::new(2));
        let writes = Arc::new(AtomicUsize::new(0));
        let done = Arc::new(Barrier::new(2));
        run(async {
            let (e, r, d, p, s, w) = (
                entered.clone(),
                release.clone(),
                done.clone(),
                path.clone(),
                snapshot.clone(),
                writes.clone(),
            );
            let handle = task::spawn_blocking(move || {
                let result = save_with_hook(&p, s, EventSeq::new(1), |p| {
                    if p == SavePoint::Written {
                        w.fetch_add(1, Ordering::SeqCst);
                    }
                    if p == point {
                        e.wait();
                        r.wait();
                    }
                    Ok(())
                });
                d.wait();
                result
            });
            // Awaiting future dropped while worker is held at a precise commit boundary.
            let waiter = tokio::spawn(handle);
            entered.wait();
            waiter.abort();
            release.wait();
            done.wait();
            let _ = waiter.await;
        });
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        assert_eq!(
            cache(&path, snapshot.projection().session_id()).unwrap().1,
            encode_snapshot(&snapshot)
        );
        assert_eq!(fingerprint(&path), before);
        save(&path, snapshot.clone()).unwrap();
        assert_eq!(writes.load(Ordering::SeqCst), 1);
        run(store.append(
            snapshot.projection().session_id(),
            EventSeq::new(1),
            vec![event(2, DomainEvent::ProvisioningFailed)],
        ))
        .unwrap();
        assert_eq!(
            save(&path, snapshot),
            Err(EventStoreError::SequenceConflict {
                expected: EventSeq::new(1),
                actual: EventSeq::new(2)
            })
        );
    }
}
// The exact executable runs this helper in a subprocess; process::exit skips Rust/SQLite drops.
#[test]
fn snapshot_subprocess_crash_probe() {
    let Ok(mode) = std::env::var("FANZLOUD_SNAPSHOT_CRASH_MODE") else {
        return;
    };
    let path = PathBuf::from(std::env::var("FANZLOUD_SNAPSHOT_CRASH_PATH").unwrap());
    if mode.starts_with("schema-") {
        let point = match mode.as_str() {
            "schema-events" => SchemaPoint::Events,
            "schema-snapshots" => SchemaPoint::Snapshots,
            "schema-version" => SchemaPoint::Version,
            _ => SchemaPoint::Committed,
        };
        initialize_with_hook(&path, |p| {
            if p == point {
                std::process::exit(77);
            }
            Ok(())
        })
        .unwrap();
    } else {
        let c = Connection::open(&path).unwrap();
        let stream: Vec<u8> = c
            .query_row(
                "SELECT stream_id FROM events ORDER BY stream_id LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        let stream = SessionId::try_from(Uuid::from_slice(&stream).unwrap()).unwrap();
        let p = verify_prefix(&c, stream, EventSeq::new(2), &|_| Ok(())).unwrap();
        let snapshot = SessionSnapshot::from_projection(p).unwrap();
        save_with_hook(&path, snapshot, EventSeq::new(2), |p| {
            if p == if mode == "save-before" {
                SavePoint::Written
            } else {
                SavePoint::Committed
            } {
                std::process::exit(77);
            }
            Ok(())
        })
        .unwrap();
    }
    panic!("crash seam not reached");
}
fn crash(path: &Path, mode: &str) {
    let status = Command::new(std::env::current_exe().unwrap())
        .args([
            "--exact",
            "sqlite::snapshot_tests::snapshot_subprocess_crash_probe",
            "--nocapture",
        ])
        .env("FANZLOUD_SNAPSHOT_CRASH_MODE", mode)
        .env("FANZLOUD_SNAPSHOT_CRASH_PATH", path)
        .status()
        .unwrap();
    assert_eq!(status.code(), Some(77));
}
#[test]
fn snapshot_lost_reply_and_crash_restart_are_atomic() {
    for mode in ["save-before", "save-after"] {
        let (_root, path, _store, snapshot) = fixture(2);
        let before = fingerprint(&path);
        crash(&path, mode);
        let store = run(SqliteEventStore::open(path.clone())).unwrap();
        let row = cache(&path, snapshot.projection().session_id());
        if mode == "save-before" {
            assert_eq!(row, None);
        } else {
            assert_eq!(row.unwrap().1, encode_snapshot(&snapshot));
        }
        assert_eq!(fingerprint(&path), before);
        run(store.save_snapshot(snapshot.clone(), EventSeq::new(2))).unwrap();
        assert_eq!(
            cache(&path, snapshot.projection().session_id()).unwrap().1,
            encode_snapshot(&snapshot)
        );
        assert_eq!(fingerprint(&path), before);
    }
}
#[test]
fn snapshot_schema_identity_rejects_spoof_and_drift() {
    for sql in [
        "PRAGMA application_id=7",
        "PRAGMA user_version=3",
        "DROP TABLE snapshots",
        "CREATE TABLE intruder(x)",
        "CREATE INDEX intruder ON events(seq)",
        "CREATE VIEW intruder AS SELECT * FROM events",
        "CREATE TRIGGER intruder AFTER INSERT ON events BEGIN SELECT 1; END",
        "ALTER TABLE snapshots ADD COLUMN intruder ANY",
    ] {
        let (_root, path, store, snapshot) = fixture(1);
        let c = Connection::open(&path).unwrap();
        c.execute_batch(sql).unwrap();
        let before = fingerprint(&path);
        let version = pragma_u32(&c, "user_version").unwrap();
        assert!(run(SqliteEventStore::open(path.clone())).is_err());
        assert!(
            run(store.load_after(snapshot.projection().session_id(), EventSeq::initial(), 1))
                .is_err()
        );
        assert!(save(&path, snapshot).is_err());
        assert_eq!(fingerprint(&path), before);
        assert_eq!(pragma_u32(&c, "user_version").unwrap(), version);
    }
    let (_root, path, _store, snapshot) = fixture(1);
    inject(&path, &snapshot, encode_snapshot(&snapshot));
    let c = Connection::open(&path).unwrap();
    c.execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE snapshots SET stream_id=x'00'; PRAGMA ignore_check_constraints=OFF").unwrap();
    assert_eq!(
        save(&path, snapshot),
        Err(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema
        })
    );
    assert_eq!(
        run(SqliteEventStore::open(path)).unwrap_err(),
        EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema
        }
    );
    // Corrupt only the disposable table's leaf bytes after checkpoint. This creates a
    // NULL/text key while retaining exact sqlite_schema identities, and never edits events.
    for mode in ["null", "text", "physical"] {
        let (_root, path, _store, snapshot) = fixture(1);
        inject(&path, &snapshot, encode_snapshot(&snapshot));
        let before = fingerprint(&path);
        let c = Connection::open(&path).unwrap();
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
        let mut bytes = std::fs::read(&path).unwrap();
        let base = ((page - 1) * size) as usize;
        assert_eq!(bytes[base], 10);
        if mode == "physical" {
            bytes[base] = 255;
        } else {
            let cell = base
                + usize::from(u16::from_be_bytes(
                    bytes[base + 8..base + 10].try_into().unwrap(),
                ));
            let payload = bytes[cell] as usize;
            let header = bytes[cell + 1] as usize;
            assert_eq!(payload, 126);
            assert_eq!(bytes[cell + 2], 44);
            if mode == "text" {
                bytes[cell + 2] = 45;
            } else {
                assert_eq!(header, 6);
                assert_eq!(
                    u16::from_be_bytes(bytes[base + 3..base + 5].try_into().unwrap()),
                    1
                );
                let mut record = vec![110, 6, 0, 28, 9, 129, 76];
                record.extend_from_slice(&bytes[cell + 23..cell + 127]);
                assert_eq!(record.len(), 111);
                let offset = u16::try_from(size as usize - record.len()).unwrap();
                let start = base + usize::from(offset);
                bytes[start..base + size as usize].copy_from_slice(&record);
                bytes[base + 5..base + 7].copy_from_slice(&offset.to_be_bytes());
                bytes[base + 8..base + 10].copy_from_slice(&offset.to_be_bytes());
            }
        }
        std::fs::write(&path, &bytes).unwrap();
        if mode != "physical" {
            let c = Connection::open(&path).unwrap();
            let kind: String = c
                .query_row("SELECT typeof(stream_id) FROM snapshots", [], |r| r.get(0))
                .unwrap();
            assert_eq!(kind, mode);
            if mode == "null" {
                let integrity: String = c
                    .query_row("PRAGMA integrity_check(1)", [], |r| r.get(0))
                    .unwrap();
                assert_eq!(integrity, "NULL value in snapshots.stream_id");
            }
        }
        assert_eq!(
            save(&path, snapshot),
            Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema
            })
        );
        assert_eq!(fingerprint(&path), before);
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(
            run(SqliteEventStore::open(path.clone())).unwrap_err(),
            EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema
            }
        );
        assert_eq!(fingerprint(&path), before);
    }
    // Actual authoritative unique-index page damage is rejected by full enabled integrity.
    let (_root, path, _store, _snapshot) = fixture(1);
    let c = Connection::open(&path).unwrap();
    let page: i64 = c
        .query_row(
            "SELECT rootpage FROM sqlite_schema WHERE name='sqlite_autoindex_events_2'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    let size: i64 = c.query_row("PRAGMA page_size", [], |r| r.get(0)).unwrap();
    c.execute_batch("PRAGMA wal_checkpoint(TRUNCATE)").unwrap();
    drop(c);
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[((page - 1) * size) as usize] = 255;
    std::fs::write(&path, &bytes).unwrap();
    assert_eq!(
        run(SqliteEventStore::open(path)).unwrap_err(),
        EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema
        }
    );
}
#[test]
fn snapshot_malformed_value_columns_preserve_open_and_event_access() {
    use rusqlite::types::Value;
    let generic = vec![
        Value::Null,
        Value::Integer(-1),
        Value::Real(1.5),
        Value::Text("bad-canary".into()),
        Value::Blob(vec![0; 2]),
    ];
    for column in ["seq", "codec_version", "body"] {
        let mut values = generic.clone();
        match column {
            "seq" => {
                values.push(Value::Blob(0u64.to_be_bytes().to_vec()));
                values.push(Value::Blob(vec![1; 9]));
            }
            "codec_version" => {
                values.push(Value::Integer(65536));
                values.push(Value::Integer(2));
            }
            _ => {
                values.push(Value::Blob(vec![0; 97]));
                values.push(Value::Blob(vec![0; 1_000_000]));
            }
        }
        for value in values {
            let (_root, path, store, snapshot) = fixture(2);
            inject(&path, &snapshot, encode_snapshot(&snapshot));
            let c = Connection::open(&path).unwrap();
            let query = match column {
                "seq" => "UPDATE snapshots SET seq=?1",
                "codec_version" => "UPDATE snapshots SET codec_version=?1",
                _ => "UPDATE snapshots SET body=?1",
            };
            c.execute(query, params![value]).unwrap();
            validate_integrity(&c).unwrap();
            run(SqliteEventStore::open(path.clone())).unwrap();
            let before = fingerprint(&path);
            assert_eq!(
                run(store.load_after(snapshot.projection().session_id(), EventSeq::initial(), 256))
                    .unwrap()
                    .len(),
                2
            );
            assert!(matches!(
                save(&path, snapshot.clone()),
                Err(EventStoreError::InvalidSnapshotCache { .. })
            ));
            assert_eq!(fingerprint(&path), before);
            run(store.append(
                snapshot.projection().session_id(),
                EventSeq::new(2),
                vec![event(3, DomainEvent::SessionIdled)],
            ))
            .unwrap();
            assert_eq!(&fingerprint(&path)[..2], before.as_slice());
        }
    }
    let (_root, path, _store, snapshot) = fixture(1);
    for offset in [0, 4, 6, 8] {
        let mut body = encode_snapshot(&snapshot);
        body[offset] ^= 1;
        inject(&path, &snapshot, body);
        assert!(matches!(
            save(&path, snapshot.clone()),
            Err(EventStoreError::InvalidSnapshotCache { .. })
        ));
    }
}
#[test]
fn snapshot_event_integrity_still_rejects_reopen() {
    for version in [1, 2] {
        for corruption in [0, 1, 2] {
            let root = root();
            let path = root.path().join("events.sqlite");
            v1(&path);
            if version == 2 {
                initialize_database(&path).unwrap();
            }
            let c = Connection::open(&path).unwrap();
            // Scratch relaxed DDL admits malformed authoritative rows, then restores the exact
            // accepted SQL identity. No production integrity suppression or schema rewrite exists.
            c.execute_batch("PRAGMA writable_schema=ON").unwrap();
            let relaxed = EVENTS_SCHEMA_SQL
                .replace(" NOT NULL", "")
                .replace(
                    "CHECK (typeof(seq) = 'blob' AND length(seq) = 8)",
                    "CHECK (1)",
                )
                .replace("CHECK (schema_version BETWEEN 0 AND 65535)", "CHECK (1)")
                .replace("STRICT, WITHOUT ROWID", "WITHOUT ROWID");
            c.execute(
                "UPDATE sqlite_schema SET sql=?1 WHERE name='events'",
                params![relaxed],
            )
            .unwrap();
            c.execute_batch("PRAGMA schema_version=99; PRAGMA writable_schema=OFF")
                .unwrap();
            drop(c);
            let c = Connection::open(&path).unwrap();
            let seq = if corruption == 0 {
                rusqlite::types::Value::Blob(vec![1])
            } else {
                rusqlite::types::Value::Blob(1u64.to_be_bytes().to_vec())
            };
            let schema = if corruption == 1 {
                rusqlite::types::Value::Text("wrong".into())
            } else {
                rusqlite::types::Value::Integer(1)
            };
            let time = if corruption == 2 {
                rusqlite::types::Value::Null
            } else {
                rusqlite::types::Value::Text("1970-01-01T00:00:01Z".into())
            };
            c.execute(
                "INSERT INTO events VALUES(?1,?2,?3,?4,?5,NULL,?6,?7)",
                params![
                    Uuid::new_v4().as_bytes().as_slice(),
                    SessionId::new().as_uuid().as_bytes().as_slice(),
                    seq,
                    schema,
                    time,
                    Uuid::new_v4().as_bytes().as_slice(),
                    b"{\"type\":\"session_created\"}".as_slice()
                ],
            )
            .unwrap();
            c.execute_batch("PRAGMA writable_schema=ON").unwrap();
            c.execute(
                "UPDATE sqlite_schema SET sql=?1 WHERE name='events'",
                params![EVENTS_SCHEMA_SQL],
            )
            .unwrap();
            c.execute_batch("PRAGMA schema_version=100; PRAGMA writable_schema=OFF")
                .unwrap();
            drop(c);
            assert_eq!(
                run(SqliteEventStore::open(path.clone())).unwrap_err(),
                EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::Schema
                }
            );
            assert_eq!(
                pragma_u32(&Connection::open(path).unwrap(), "user_version").unwrap(),
                version
            );
        }
    }
}
#[test]
fn snapshot_open_new_and_exact_v1_upgrade_to_v2() {
    let (_root, path, _store, _snapshot) = fixture(2);
    let before = fingerprint(&path);
    let c = Connection::open(&path).unwrap();
    c.execute_batch("DROP TABLE snapshots; PRAGMA user_version=1")
        .unwrap();
    drop(c);
    run(SqliteEventStore::open(path.clone())).unwrap();
    let c = Connection::open(&path).unwrap();
    assert_eq!(pragma_u32(&c, "user_version").unwrap(), 2);
    validate_identity(&c, true).unwrap();
    assert_eq!(fingerprint(&path), before);
    let sql: String = c
        .query_row(
            "SELECT sql FROM sqlite_schema WHERE name='events'",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(sql, EVENTS_SCHEMA_SQL);
    assert_eq!(
        std::fs::metadata(&path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let schema_version: i64 = c
        .query_row("PRAGMA schema_version", [], |r| r.get(0))
        .unwrap();
    drop(c);
    run(SqliteEventStore::open(path.clone())).unwrap();
    let c = Connection::open(&path).unwrap();
    assert_eq!(
        c.query_row("PRAGMA schema_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        schema_version
    );
    assert_eq!(fingerprint(&path), before);
}
#[test]
fn snapshot_concurrent_open_rechecks_identity_under_lock() {
    for existing in [false, true] {
        let root = root();
        let path = root.path().join("events.sqlite");
        if existing {
            v1(&path);
        }
        let barrier = Arc::new(Barrier::new(3));
        let mut workers = Vec::new();
        for _ in 0..2 {
            let (b, p) = (barrier.clone(), path.clone());
            workers.push(std::thread::spawn(move || {
                b.wait();
                run(SqliteEventStore::open(p))
            }));
        }
        barrier.wait();
        for worker in workers {
            let outcome = worker.join().unwrap();
            assert!(outcome.is_ok() || matches!(outcome, Err(EventStoreError::Busy)));
        }
        assert!(path.exists());
        validate_identity(&Connection::open(&path).unwrap(), true).unwrap();
    }
    let root = root();
    let path = root.path().join("events.sqlite");
    v1(&path);
    let locked = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let (l, r, p) = (locked.clone(), release.clone(), path.clone());
    let first = std::thread::spawn(move || {
        initialize_with_hook(&p, |point| {
            if point == SchemaPoint::Snapshots {
                l.wait();
                r.wait();
            }
            Ok(())
        })
    });
    locked.wait();
    let p = path.clone();
    let second = std::thread::spawn(move || run(SqliteEventStore::open(p)));
    release.wait();
    first.join().unwrap().unwrap();
    second.join().unwrap().unwrap();
    validate_identity(&Connection::open(path).unwrap(), true).unwrap();
}
#[test]
fn snapshot_schema_upgrade_fault_and_crash_leave_old_or_complete() {
    for existing in [false, true] {
        for point in [
            SchemaPoint::Events,
            SchemaPoint::Snapshots,
            SchemaPoint::Version,
        ] {
            if existing && point == SchemaPoint::Events {
                continue;
            }
            let root = root();
            let path = root.path().join("events.sqlite");
            if existing {
                v1(&path);
            } else {
                crate::path::validate_and_prepare(path.clone()).unwrap();
            }
            assert_eq!(
                initialize_with_hook(&path, |p| if p == point { Err(fault()) } else { Ok(()) }),
                Err(fault())
            );
            let c = Connection::open(&path).unwrap();
            assert_eq!(
                pragma_u32(&c, "user_version").unwrap(),
                if existing { 1 } else { 0 }
            );
            let tables: i64 = c
                .query_row(
                    "SELECT COUNT(*) FROM sqlite_schema WHERE type='table'",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(tables, if existing { 1 } else { 0 });
            drop(c);
            run(SqliteEventStore::open(path)).unwrap();
        }
    }
    for existing in [false, true] {
        for mode in [
            "schema-events",
            "schema-snapshots",
            "schema-version",
            "schema-after",
        ] {
            if existing && mode == "schema-events" {
                continue;
            }
            let root = root();
            let path = root.path().join("events.sqlite");
            if existing {
                v1(&path);
            } else {
                crate::path::validate_and_prepare(path.clone()).unwrap();
            }
            crash(&path, mode);
            let c = Connection::open(&path).unwrap();
            assert_eq!(
                pragma_u32(&c, "user_version").unwrap(),
                if mode == "schema-after" {
                    2
                } else if existing {
                    1
                } else {
                    0
                }
            );
            drop(c);
            run(SqliteEventStore::open(path)).unwrap();
        }
    }
    for sql in ["CREATE TABLE foreign_data(x)", "PRAGMA application_id=7"] {
        let root = root();
        let path = root.path().join("events.sqlite");
        let c = Connection::open(&path).unwrap();
        c.execute_batch(sql).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(run(SqliteEventStore::open(path.clone())).is_err());
        assert_eq!(pragma_u32(&c, "user_version").unwrap(), 0);
    }
}
#[test]
fn snapshot_v2_preserves_append_replay_and_rejects_downgrade() {
    let (_root, path, store, snapshot) = fixture(1);
    let stream = snapshot.projection().session_id();
    save(&path, snapshot).unwrap();
    let before = fingerprint(&path);
    let c = Connection::open(&path).unwrap();
    // Pinned v1 constructor identity contract rejects v2; optionally exercise the actual
    // archived baseline binary supplied by the orchestrator (independent artifact).
    assert_ne!(pragma_u32(&c, "user_version").unwrap(), 1);
    if let Ok(binary) = std::env::var("FANZLOUD_LEGACY_OPEN_BIN") {
        let status = Command::new(binary).arg(&path).status().unwrap();
        assert_eq!(status.code(), Some(42));
    }
    assert_eq!(pragma_u32(&c, "user_version").unwrap(), 2);
    assert_eq!(fingerprint(&path), before);
    c.execute(
        "UPDATE events SET seq=?1",
        params![(u64::MAX - 1).to_be_bytes().as_slice()],
    )
    .unwrap();
    let appended = run(store.append(
        stream,
        EventSeq::new(u64::MAX - 1),
        vec![event(2, DomainEvent::ProvisioningFailed)],
    ))
    .unwrap();
    assert_eq!(appended[0].seq, EventSeq::new(u64::MAX));
    assert_eq!(
        run(store.load_after(stream, EventSeq::new(u64::MAX - 2), 256))
            .unwrap()
            .iter()
            .map(|e| e.seq.value())
            .collect::<Vec<_>>(),
        vec![u64::MAX - 1, u64::MAX]
    );
    assert_eq!(
        run(store.append(
            stream,
            EventSeq::new(u64::MAX),
            vec![event(3, DomainEvent::SessionArchived)]
        )),
        Err(EventStoreError::SequenceOverflow {
            expected: EventSeq::new(u64::MAX),
            count: 1
        })
    );
    c.execute_batch("PRAGMA user_version=99").unwrap();
    assert!(run(store.load_after(stream, EventSeq::new(u64::MAX - 2), 1)).is_err());
    assert_eq!(pragma_u32(&c, "user_version").unwrap(), 99);
}
#[test]
fn snapshot_legacy_inflight_event_io_survives_additive_upgrade() {
    let (_root, path, store, snapshot) = fixture(1);
    let stream = snapshot.projection().session_id();
    let c = Connection::open(&path).unwrap();
    c.execute_batch("DROP TABLE snapshots; PRAGMA user_version=1")
        .unwrap();
    drop(c);
    let mut reader = open_read_connection(&path).unwrap();
    let pinned = reader.transaction().unwrap();
    let before: Vec<u8> = pinned
        .query_row("SELECT seq FROM events", [], |r| r.get(0))
        .unwrap();
    validate_identity(&pinned, false).unwrap();
    let mut writer = open_connection(&path).unwrap();
    let admitted = writer
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .unwrap();
    validate_identity(&admitted, false).unwrap();
    let prepared = prepare_batch(
        stream,
        EventSeq::new(1),
        vec![event(2, DomainEvent::ProvisioningFailed)],
        &Uuid::new_v4,
    )
    .unwrap();
    insert_event(&admitted, &prepared[0]).unwrap();
    let b = Arc::new(Barrier::new(2));
    let (p, b2) = (path.clone(), b.clone());
    let upgrader = std::thread::spawn(move || {
        b2.wait();
        run(SqliteEventStore::open(p))
    });
    b.wait();
    admitted.commit().unwrap();
    upgrader.join().unwrap().unwrap();
    assert_eq!(
        pinned
            .query_row("SELECT seq FROM events", [], |r| r.get::<_, Vec<u8>>(0))
            .unwrap(),
        before
    );
    assert_eq!(
        pinned
            .query_row("SELECT COUNT(*) FROM events", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        1
    );
    assert_eq!(
        run(store.load_after(stream, EventSeq::initial(), 256))
            .unwrap()
            .len(),
        2
    );
    validate_identity(&Connection::open(path).unwrap(), true).unwrap();
    drop(pinned);
    drop(reader);
    drop(writer);
    let root = root();
    let path = root.path().join("identity-race.sqlite");
    v1(&path);
    let store = run(SqliteEventStore::open(path.clone())).unwrap();
    let stream = SessionId::new();
    run(store.append(
        stream,
        EventSeq::initial(),
        vec![event(1, DomainEvent::SessionCreated)],
    ))
    .unwrap();
    let c = Connection::open(&path).unwrap();
    c.execute_batch("DROP TABLE snapshots; PRAGMA user_version=1")
        .unwrap();
    drop(c);
    let entered = Arc::new(Barrier::new(2));
    let release = Arc::new(Barrier::new(2));
    let (e, r, p) = (entered.clone(), release.clone(), path.clone());
    let admitted = std::thread::spawn(move || {
        load_page_with_hook(&p, stream, EventSeq::initial(), 1, || {
            e.wait();
            r.wait();
            Ok(())
        })
    });
    entered.wait();
    run(SqliteEventStore::open(path.clone())).unwrap();
    release.wait();
    let page = admitted.join().unwrap().unwrap();
    assert_eq!(page.len(), 1);
    assert_eq!(page[0].seq, EventSeq::new(1));
    assert_eq!(page[0].payload, DomainEvent::SessionCreated);
    validate_identity(&Connection::open(path).unwrap(), true).unwrap();
}
#[test]
fn snapshot_paths_and_debug_remain_private_and_bounded() {
    let (_root, path, _store, snapshot) = fixture(1);
    assert_eq!(
        format!("{snapshot:?}"),
        "SessionSnapshot { projection: \"<redacted>\" }"
    );
    assert!(
        run(SqliteEventStore::open(PathBuf::from(
            "secret-canary.sqlite"
        )))
        .is_err()
    );
    let link = path.with_file_name("secret-canary-link");
    symlink(&path, &link).unwrap();
    assert!(run(SqliteEventStore::open(link)).is_err());
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert!(run(SqliteEventStore::open(path.clone())).is_err());
    let errors = [
        EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::Empty,
        },
        EventStoreError::SnapshotHistoryMismatch {
            seq: EventSeq::new(4096),
        },
        EventStoreError::InvalidEventHistory {
            seq: EventSeq::new(1),
            reason: InvalidEventHistoryReason::TurnIdentity,
        },
        EventStoreError::InvalidSnapshotCache {
            reason: SnapshotCacheReason::Identity,
        },
        EventStoreError::SnapshotConflict {
            candidate_seq: EventSeq::new(1),
            stored_seq: EventSeq::new(2),
            reason: SnapshotConflictReason::Regression,
        },
        map_sqlite(
            rusqlite::Error::SqliteFailure(
                rusqlite::ffi::Error::new(10),
                Some("secret-canary".into()),
            ),
            StorageOperation::SnapshotWrite,
        ),
    ];
    for error in errors {
        let text = format!("{error:?}: {error}");
        assert!(text.len() < 512);
        assert!(!text.contains("secret-canary"));
        assert!(!text.contains(path.to_str().unwrap()));
    }
    assert!(!include_str!("snapshot.rs").contains("Deserialize"));
}
#[test]
fn snapshot_model_never_changes_history_or_regresses_cache() {
    for seed in 1..=12u64 {
        let root = root();
        let path = root.path().join("events.sqlite");
        let store = run(SqliteEventStore::open(path.clone())).unwrap();
        let streams = [SessionId::new(), SessionId::new(), SessionId::new()];
        let mut histories = [Vec::new(), Vec::new(), Vec::new()];
        let mut cached = [None, None, None];
        let mut random = seed;
        for _ in 0..96 {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            let index = (random % 3) as usize;
            let history = &mut histories[index];
            let head = history.len() as u64;
            if random & 4 == 0 || head == 0 {
                let payload = if head == 0 {
                    DomainEvent::SessionCreated
                } else if head == 1 {
                    DomainEvent::SandboxProvisioned {
                        sandbox_id: SandboxId::new(),
                    }
                } else if head.is_multiple_of(2) {
                    DomainEvent::SessionIdled
                } else {
                    DomainEvent::SessionResumed
                };
                history.extend(
                    run(store.append(
                        streams[index],
                        EventSeq::new(head),
                        vec![event(head + 1, payload)],
                    ))
                    .unwrap(),
                );
            } else {
                let snapshot = reduce(streams[index], history);
                let before = fingerprint(&path);
                save(&path, snapshot.clone()).unwrap();
                assert_eq!(fingerprint(&path), before);
                let row = cache(&path, streams[index]).unwrap();
                if let Some((seq, bytes)) = cached[index] {
                    assert!(row.0 >= seq);
                    if row.0 == seq {
                        assert_eq!(row.1, bytes);
                    }
                }
                cached[index] = Some(row);
                assert_eq!(row.1, encode_snapshot(&snapshot));
            }
            for i in 0..3 {
                assert_eq!(
                    run(store.load_after(streams[i], EventSeq::initial(), 256)).unwrap(),
                    histories[i]
                );
                if let Some(row) = cached[i] {
                    assert_eq!(cache(&path, streams[i]), Some(row));
                }
            }
        }
    }
}
#[test]
fn snapshot_design_and_runtime_acceptance_are_distinct() {
    let design = include_str!("../../../docs/acceptance/T030D-design.acceptance.md");
    assert!(design.contains("decision: accepted"));
    assert!(design.contains("Accepted for design only"));
    let spec = include_str!("../../../docs/specs/SPEC-T030D-sqlite-snapshot-save.md");
    assert!(spec.contains("D MUST NOT implement public load"));
    assert!(spec.contains("T030C"));
    let task = include_str!("../../../docs/tasks/T030D.task.md");
    assert!(
        task.contains("status: ready")
            || task.contains("status: implemented")
            || task.contains("status: accepted")
    );
    let library = include_str!("sqlite.rs");
    assert!(!library.contains("pub async fn load_snapshot"));
    assert!(!include_str!("../../codebox-domain/src/reducer.rs").contains("pub fn restore"));
}

#[test]
fn mid_transaction_failure_rolls_back_entire_batch() {
    let (_root, path, _store, snapshot) = fixture(1);
    let before = fingerprint(&path);
    let stream = SessionId::new();
    let mut prepared = prepare_batch(
        stream,
        EventSeq::initial(),
        vec![
            event(1, DomainEvent::SessionCreated),
            event(2, DomainEvent::ProvisioningFailed),
        ],
        &Uuid::new_v4,
    )
    .unwrap();
    // Test-only fault occurs after normal preparation. Preflight sees neither ID stored;
    // first INSERT succeeds and second hits the actual unique index, forcing whole rollback.
    prepared[1].event_id = prepared[0].event_id;
    assert_eq!(
        append_prepared(&path, stream, EventSeq::initial(), prepared),
        Err(EventStoreError::Storage {
            operation: StorageOperation::Insert,
            kind: StorageErrorKind::Constraint
        })
    );
    assert_eq!(fingerprint(&path), before);
    assert_eq!(cache(&path, snapshot.projection().session_id()), None);
}

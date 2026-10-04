use std::collections::HashSet;
use std::fmt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use codebox_domain::{
    DOMAIN_EVENT_SCHEMA_V1, DomainEventEnvelope, EventSeq, NewDomainEvent, SessionId,
    SessionReducer, SessionReducerError,
};
use rusqlite::{
    Connection, OpenFlags, OptionalExtension, Transaction, TransactionBehavior, params,
};
use tokio::task;
use uuid::Uuid;

use crate::codec::{
    EncodedNewEvent, bounded_raw_event_from_row, decode_event, decode_sequence, encode_new,
    raw_event_from_row, sequence_bytes,
};
use crate::path::validate_and_prepare;
use crate::snapshot::{encode as encode_snapshot, validate_body, validate_sequence};
use crate::{
    CorruptStoreStage, EventStoreError, InvalidEventHistoryReason, InvalidSnapshotReason,
    SessionSnapshot, SnapshotCacheReason, SnapshotConflictReason, StorageErrorKind,
    StorageOperation,
};

/// Maximum semantic events accepted in one atomic append.
///
/// Contract: `CU-EVT-01`. The bound is checked before database access.
pub const MAX_APPEND_EVENTS: usize = 256;

/// Maximum serialized version-1 payload bytes accepted for one event.
///
/// Contract: `CU-EVT-01`. Large outputs belong in artifacts, not event rows.
pub const MAX_EVENT_PAYLOAD_BYTES: usize = 65_536;

/// Maximum committed events returned by one replay page.
///
/// Contract: `CU-EVT-02`. Values outside `1..=MAX_REPLAY_EVENTS` fail before database access.
pub const MAX_REPLAY_EVENTS: usize = 256;

/// Maximum SQLite lock wait for one connection.
///
/// Contract: `CU-EVT-01`. Expiration returns `EventStoreError::Busy`.
pub const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

const APPLICATION_ID: u32 = 0x4342_5831;
const DATABASE_SCHEMA_VERSION: u32 = 2;
pub(crate) const MAX_STORED_TIMESTAMP_BYTES: usize = 64;
const EVENTS_SCHEMA_SQL: &str = "CREATE TABLE events (
                    event_id BLOB NOT NULL PRIMARY KEY
                        CHECK (typeof(event_id) = 'blob' AND length(event_id) = 16),
                    stream_id BLOB NOT NULL
                        CHECK (typeof(stream_id) = 'blob' AND length(stream_id) = 16),
                    seq BLOB NOT NULL
                        CHECK (typeof(seq) = 'blob' AND length(seq) = 8),
                    schema_version INTEGER NOT NULL
                        CHECK (schema_version BETWEEN 0 AND 65535),
                    occurred_at TEXT NOT NULL,
                    causation_id BLOB
                        CHECK (causation_id IS NULL OR
                               (typeof(causation_id) = 'blob' AND length(causation_id) = 16)),
                    correlation_id BLOB NOT NULL
                        CHECK (typeof(correlation_id) = 'blob' AND length(correlation_id) = 16),
                    payload BLOB NOT NULL,
                    UNIQUE (stream_id, seq)
                ) STRICT, WITHOUT ROWID";
const REPLAY_QUERY: &str = "
    SELECT
        CASE WHEN typeof(event_id) = 'blob' AND length(event_id) = 16
             THEN event_id END,
        CASE WHEN typeof(stream_id) = 'blob' AND length(stream_id) = 16
             THEN stream_id END,
        CASE WHEN typeof(seq) = 'blob' AND length(seq) = 8
             THEN seq END,
        CASE WHEN typeof(schema_version) = 'integer'
                       AND schema_version BETWEEN 0 AND 65535
             THEN schema_version END,
        CASE WHEN typeof(occurred_at) = 'text'
                       AND length(CAST(occurred_at AS BLOB)) BETWEEN 1 AND ?4
             THEN CAST(occurred_at AS BLOB) END,
        causation_id IS NULL,
        CASE WHEN typeof(causation_id) = 'blob' AND length(causation_id) = 16
             THEN causation_id END,
        CASE WHEN typeof(correlation_id) = 'blob' AND length(correlation_id) = 16
             THEN correlation_id END,
        CASE WHEN typeof(payload) = 'blob' AND length(payload) <= ?5
             THEN payload END
    FROM events
    WHERE stream_id = ?1 AND seq > ?2
    ORDER BY seq ASC
    LIMIT ?3";

type EventIdSource = Arc<dyn Fn() -> Uuid + Send + Sync>;

/// The private P1 SQLite event-store adapter.
///
/// Contracts: `CU-EVT-01`, `CU-EVT-02`. T030A provides atomic append and T030B provides bounded
/// replay; CU-EVT-04 provides verified snapshot save. Public snapshot load remains T030C.
/// Debug output never reveals the administrator
/// database path.
#[derive(Clone)]
pub struct SqliteEventStore {
    database_path: Arc<PathBuf>,
    event_id_source: EventIdSource,
}

impl fmt::Debug for SqliteEventStore {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("SqliteEventStore")
            .field("database_path", &"<redacted>")
            .finish_non_exhaustive()
    }
}

impl SqliteEventStore {
    /// Opens or atomically upgrades one private version-2 SQLite event database.
    ///
    /// Contract: `CU-EVT-01`. The path is validated as an administrator-owned private local file;
    /// incompatible or corrupt schema state fails closed with a typed redacted error.
    pub async fn open(database_path: PathBuf) -> Result<Self, EventStoreError> {
        Self::open_with_source(database_path, Arc::new(Uuid::new_v4)).await
    }

    async fn open_with_source(
        database_path: PathBuf,
        event_id_source: EventIdSource,
    ) -> Result<Self, EventStoreError> {
        let validated = task::spawn_blocking(move || {
            let validated = validate_and_prepare(database_path)?;
            initialize_database(&validated.path)?;
            Ok::<_, EventStoreError>(validated.path)
        })
        .await
        .map_err(|_| EventStoreError::WorkerUnavailable)??;

        Ok(Self {
            database_path: Arc::new(validated),
            event_id_source,
        })
    }

    /// Atomically appends one non-empty event batch at the exact expected stream sequence.
    ///
    /// Contract: `CU-EVT-01`. Success assigns globally unique event IDs and contiguous sequences;
    /// conflict returns the actual committed high-water and every failure leaves no partial batch.
    pub async fn append(
        &self,
        stream: SessionId,
        expected_seq: EventSeq,
        events: Vec<NewDomainEvent>,
    ) -> Result<Vec<DomainEventEnvelope>, EventStoreError> {
        let prepared = prepare_batch(stream, expected_seq, events, self.event_id_source.as_ref())?;
        let database_path = Arc::clone(&self.database_path);

        task::spawn_blocking(move || {
            append_prepared(&database_path, stream, expected_seq, prepared)
        })
        .await
        .map_err(|_| EventStoreError::WorkerUnavailable)?
    }

    /// Saves one current-head cache after replaying its complete persisted prefix.
    ///
    /// Contract: CU-EVT-04 (E1). Changing saves commit one whole row; identical retries verify
    /// history without rewriting. Dropping this future does not cancel the blocking worker.
    /// Unknown completion requires explicit same-input reconciliation; there is no internal retry.
    pub async fn save_snapshot(
        &self,
        snapshot: SessionSnapshot,
        expected_seq: EventSeq,
    ) -> Result<(), EventStoreError> {
        validate_snapshot_input(&snapshot, expected_seq)?;
        let path = Arc::clone(&self.database_path);
        task::spawn_blocking(move || {
            #[cfg(test)]
            {
                save_with_hook(&path, snapshot, expected_seq, |_| Ok(()))
            }
            #[cfg(not(test))]
            {
                save_transaction(&path, snapshot, expected_seq)
            }
        })
        .await
        .map_err(|_| EventStoreError::WorkerUnavailable)?
    }

    /// Loads one bounded, immutable page of committed events after `after`.
    ///
    /// Contract: `CU-EVT-02`. Success contains only `stream`, in contiguous ascending sequence
    /// order, from one SQLite statement snapshot. Invalid limits fail before database access and
    /// every query, decode, cancellation, or worker failure is E0.
    pub async fn load_after(
        &self,
        stream: SessionId,
        after: EventSeq,
        limit: usize,
    ) -> Result<Vec<DomainEventEnvelope>, EventStoreError> {
        if limit == 0 || limit > MAX_REPLAY_EVENTS {
            return Err(EventStoreError::InvalidReplayLimit {
                max: MAX_REPLAY_EVENTS,
                actual: limit,
            });
        }
        if after.value() == u64::MAX {
            return Ok(Vec::new());
        }

        let database_path = Arc::clone(&self.database_path);
        let worker = task::spawn_blocking(move || load_page(&database_path, stream, after, limit));
        await_replay_worker(worker).await
    }
}

async fn await_replay_worker<T>(
    worker: task::JoinHandle<Result<T, EventStoreError>>,
) -> Result<T, EventStoreError> {
    worker
        .await
        .map_err(|_| EventStoreError::WorkerUnavailable)?
}

struct PreparedEvent {
    event_id: Uuid,
    stream_id: SessionId,
    seq: EventSeq,
    encoded: EncodedNewEvent,
}

fn prepare_batch(
    stream: SessionId,
    expected_seq: EventSeq,
    events: Vec<NewDomainEvent>,
    event_id_source: &(dyn Fn() -> Uuid + Send + Sync),
) -> Result<Vec<PreparedEvent>, EventStoreError> {
    if events.is_empty() {
        return Err(EventStoreError::EmptyBatch);
    }
    if events.len() > MAX_APPEND_EVENTS {
        return Err(EventStoreError::BatchTooLarge {
            max: MAX_APPEND_EVENTS,
            actual: events.len(),
        });
    }

    let count = events.len();
    let mut next = expected_seq;
    let mut event_ids = HashSet::with_capacity(count);
    let mut prepared = Vec::with_capacity(count);
    for (index, event) in events.into_iter().enumerate() {
        if event.schema_version != DOMAIN_EVENT_SCHEMA_V1 {
            return Err(EventStoreError::UnsupportedEventSchema {
                index,
                supported: DOMAIN_EVENT_SCHEMA_V1,
                actual: event.schema_version,
            });
        }
        let encoded = encode_new(&event, index)?;
        next = next
            .checked_next()
            .map_err(|_| EventStoreError::SequenceOverflow {
                expected: expected_seq,
                count,
            })?;
        let event_id = event_id_source();
        if event_id.is_nil() || !event_ids.insert(event_id) {
            return Err(EventStoreError::DuplicateEventId);
        }
        prepared.push(PreparedEvent {
            event_id,
            stream_id: stream,
            seq: next,
            encoded,
        });
    }
    Ok(prepared)
}

fn append_prepared(
    database_path: &Path,
    stream: SessionId,
    expected_seq: EventSeq,
    prepared: Vec<PreparedEvent>,
) -> Result<Vec<DomainEventEnvelope>, EventStoreError> {
    let mut connection = open_connection(database_path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| map_sqlite(error, StorageOperation::Begin))?;
    validate_identity(&transaction, false)?;
    let actual = read_high_water(&transaction, stream)?;
    if actual != expected_seq {
        return Err(EventStoreError::SequenceConflict {
            expected: expected_seq,
            actual,
        });
    }

    for event in &prepared {
        if event_id_exists(&transaction, event.event_id)? {
            return Err(EventStoreError::DuplicateEventId);
        }
    }

    for event in &prepared {
        insert_event(&transaction, event)?;
    }

    let mut envelopes = Vec::with_capacity(prepared.len());
    for event in &prepared {
        envelopes.push(read_event_by_id(&transaction, event.event_id)?);
    }

    transaction
        .commit()
        .map_err(|error| map_sqlite(error, StorageOperation::Commit))?;
    Ok(envelopes)
}

fn load_page(
    database_path: &Path,
    stream: SessionId,
    after: EventSeq,
    limit: usize,
) -> Result<Vec<DomainEventEnvelope>, EventStoreError> {
    #[cfg(test)]
    {
        load_page_with_hook(database_path, stream, after, limit, || Ok(()))
    }
    #[cfg(not(test))]
    {
        load_page_transaction(database_path, stream, after, limit)
    }
}
#[cfg(test)]
fn load_page_with_hook(
    database_path: &Path,
    stream: SessionId,
    after: EventSeq,
    limit: usize,
    hook: impl Fn() -> Result<(), EventStoreError>,
) -> Result<Vec<DomainEventEnvelope>, EventStoreError> {
    load_page_transaction(database_path, stream, after, limit, &hook)
}
fn load_page_transaction(
    database_path: &Path,
    stream: SessionId,
    after: EventSeq,
    limit: usize,
    #[cfg(test)] hook: &impl Fn() -> Result<(), EventStoreError>,
) -> Result<Vec<DomainEventEnvelope>, EventStoreError> {
    let mut connection = open_read_connection(database_path)?;
    let transaction = connection
        .transaction()
        .map_err(|error| map_sqlite(error, StorageOperation::Begin))?;
    identity_transaction(
        &transaction,
        false,
        #[cfg(test)]
        hook,
    )?;
    let mut statement = transaction
        .prepare(REPLAY_QUERY)
        .map_err(|error| map_sqlite(error, StorageOperation::Replay))?;
    let query_limit = i64::try_from(limit).map_err(|_| EventStoreError::InvalidReplayLimit {
        max: MAX_REPLAY_EVENTS,
        actual: limit,
    })?;
    let timestamp_limit =
        i64::try_from(MAX_STORED_TIMESTAMP_BYTES).map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Timestamp,
        })?;
    let payload_limit =
        i64::try_from(MAX_EVENT_PAYLOAD_BYTES).map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Payload,
        })?;
    let mut rows = statement
        .query(params![
            stream.as_uuid().as_bytes().as_slice(),
            sequence_bytes(after).as_slice(),
            query_limit,
            timestamp_limit,
            payload_limit,
        ])
        .map_err(|error| map_sqlite(error, StorageOperation::Replay))?;

    let mut expected = after.value().checked_add(1).map(EventSeq::new);
    let mut page = Vec::with_capacity(limit);
    while let Some(row) = rows
        .next()
        .map_err(|error| map_sqlite(error, StorageOperation::Replay))?
    {
        let envelope = decode_event(bounded_raw_event_from_row(row)?)?;
        let expected_seq = expected.ok_or(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Sequence,
        })?;
        if envelope.stream_id != stream {
            return Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::StreamId,
            });
        }
        if envelope.seq != expected_seq {
            return Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Sequence,
            });
        }
        expected = envelope.seq.value().checked_add(1).map(EventSeq::new);
        page.push(envelope);
    }
    Ok(page)
}

fn validate_snapshot_input(
    snapshot: &SessionSnapshot,
    expected: EventSeq,
) -> Result<(), EventStoreError> {
    validate_sequence(snapshot.projection().last_seq().value())?;
    if snapshot.projection().last_seq() != expected {
        return Err(EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::ExpectedSequenceMismatch,
        });
    }
    Ok(())
}
#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SavePoint {
    Locked,
    Page(usize),
    Verified,
    Written,
    Committed,
}
#[cfg(test)]
fn save_with_hook(
    path: &Path,
    snapshot: SessionSnapshot,
    expected: EventSeq,
    hook: impl Fn(SavePoint) -> Result<(), EventStoreError>,
) -> Result<(), EventStoreError> {
    save_transaction(path, snapshot, expected, &hook)
}
macro_rules! at_test_point {
    ($hook:ident, $point:expr) => {
        #[cfg(test)]
        {
            $hook($point)?;
        }
    };
}
fn save_transaction(
    path: &Path,
    snapshot: SessionSnapshot,
    expected: EventSeq,
    #[cfg(test)] hook: &impl Fn(SavePoint) -> Result<(), EventStoreError>,
) -> Result<(), EventStoreError> {
    validate_snapshot_input(&snapshot, expected)?;
    let mut connection = open_connection(path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| map_sqlite(error, StorageOperation::Begin))?;
    validate_identity(&transaction, true)?;
    validate_snapshot_keys(&transaction)?;
    at_test_point!(hook, SavePoint::Locked);
    let stream = snapshot.projection().session_id();
    let actual = read_high_water(&transaction, stream)?;
    if actual != expected {
        return Err(EventStoreError::SequenceConflict { expected, actual });
    }
    let projection = verify_prefix(
        &transaction,
        stream,
        actual,
        #[cfg(test)]
        hook,
    )?;
    if projection != *snapshot.projection() {
        return Err(EventStoreError::SnapshotHistoryMismatch { seq: actual });
    }
    at_test_point!(hook, SavePoint::Verified);
    let body = encode_snapshot(&snapshot);
    if let Some((stored, previous)) = read_snapshot_row(&transaction, stream)? {
        if stored > expected {
            return Err(EventStoreError::SnapshotConflict {
                candidate_seq: expected,
                stored_seq: stored,
                reason: SnapshotConflictReason::Regression,
            });
        }
        if stored == expected {
            if previous != body {
                return Err(EventStoreError::SnapshotConflict {
                    candidate_seq: expected,
                    stored_seq: stored,
                    reason: SnapshotConflictReason::DifferentContent,
                });
            }
            // Drop explicitly owns rollback of the admitted transaction, with no row write.
            return Ok(());
        }
    }
    transaction.execute("INSERT INTO snapshots(stream_id, seq, codec_version, body) VALUES (?1, ?2, 1, ?3) ON CONFLICT(stream_id) DO UPDATE SET seq=excluded.seq, codec_version=excluded.codec_version, body=excluded.body",
        params![stream.as_uuid().as_bytes().as_slice(), sequence_bytes(expected).as_slice(), body.as_slice()])
        .map_err(|error| map_sqlite(error, StorageOperation::SnapshotWrite))?;
    at_test_point!(hook, SavePoint::Written);
    transaction
        .commit()
        .map_err(|error| map_sqlite(error, StorageOperation::Commit))?;
    at_test_point!(hook, SavePoint::Committed);
    Ok(())
}
const SNAPSHOT_QUERY: &str = "SELECT
    CASE WHEN typeof(seq) = 'blob' AND length(seq) = 8 THEN seq END,
    CASE WHEN typeof(codec_version) = 'integer' AND codec_version BETWEEN 0 AND 65535 THEN codec_version END,
    CASE WHEN typeof(body) = 'blob' AND length(body) = 96 THEN body END
    FROM snapshots WHERE stream_id = ?1";
fn validate_snapshot_keys(connection: &Connection) -> Result<(), EventStoreError> {
    let invalid: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM snapshots WHERE stream_id IS NULL OR typeof(stream_id) != 'blob' OR length(stream_id) != 16)", [], |row| row.get(0))
        .map_err(|error| map_sqlite(error, StorageOperation::SnapshotRead))?;
    if invalid {
        return schema_corrupt();
    }
    Ok(())
}
fn read_snapshot_row(
    connection: &Connection,
    stream: SessionId,
) -> Result<Option<(EventSeq, [u8; 96])>, EventStoreError> {
    let row = connection
        .query_row(
            SNAPSHOT_QUERY,
            params![stream.as_uuid().as_bytes().as_slice()],
            |row| {
                Ok((
                    row.get::<_, Option<Vec<u8>>>(0)?,
                    row.get::<_, Option<i64>>(1)?,
                    row.get::<_, Option<Vec<u8>>>(2)?,
                ))
            },
        )
        .optional()
        .map_err(|error| map_sqlite(error, StorageOperation::SnapshotRead))?;
    let Some((seq, version, body)) = row else {
        return Ok(None);
    };
    let invalid = |reason| EventStoreError::InvalidSnapshotCache { reason };
    let seq = seq.ok_or_else(|| invalid(SnapshotCacheReason::Type))?;
    let version = version.ok_or_else(|| invalid(SnapshotCacheReason::Type))?;
    let body = body.ok_or_else(|| invalid(SnapshotCacheReason::Width))?;
    if version != 1 {
        return Err(invalid(SnapshotCacheReason::Version));
    }
    validate_body(&body, stream.as_uuid().as_bytes(), &seq).map_err(invalid)?;
    let stored = decode_sequence(&seq).map_err(|_| invalid(SnapshotCacheReason::Sequence))?;
    let body = body
        .try_into()
        .map_err(|_| invalid(SnapshotCacheReason::Width))?;
    Ok(Some((stored, body)))
}
fn verify_prefix(
    connection: &Connection,
    stream: SessionId,
    target: EventSeq,
    #[cfg(test)] hook: &impl Fn(SavePoint) -> Result<(), EventStoreError>,
) -> Result<codebox_domain::SessionProjection, EventStoreError> {
    validate_sequence(target.value())?;
    let mut reducer = SessionReducer::new(stream);
    let mut verified = 0u64;
    while verified < target.value() {
        let limit = (target.value() - verified).min(MAX_REPLAY_EVENTS as u64);
        let mut statement = connection
            .prepare(REPLAY_QUERY)
            .map_err(|error| map_sqlite(error, StorageOperation::SnapshotVerify))?;
        let mut rows = statement
            .query(params![
                stream.as_uuid().as_bytes().as_slice(),
                sequence_bytes(EventSeq::new(verified)).as_slice(),
                limit as i64,
                MAX_STORED_TIMESTAMP_BYTES as i64,
                MAX_EVENT_PAYLOAD_BYTES as i64
            ])
            .map_err(|error| map_sqlite(error, StorageOperation::SnapshotVerify))?;
        let mut page = 0;
        while let Some(row) = rows
            .next()
            .map_err(|error| map_sqlite(error, StorageOperation::SnapshotVerify))?
        {
            let envelope = decode_event(bounded_raw_event_from_row(row)?)?;
            let next = verified
                .checked_add(1)
                .filter(|seq| *seq <= target.value())
                .ok_or(EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::Sequence,
                })?;
            if envelope.stream_id != stream {
                return Err(EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::StreamId,
                });
            }
            if envelope.seq.value() != next {
                return Err(EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::Sequence,
                });
            }
            reducer =
                reducer
                    .apply(&envelope)
                    .map_err(|error| EventStoreError::InvalidEventHistory {
                        seq: envelope.seq,
                        reason: history_reason(error),
                    })?;
            verified = next;
            page += 1;
        }
        if page == 0 {
            return Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Sequence,
            });
        }
        at_test_point!(hook, SavePoint::Page(page));
    }
    reducer
        .projection()
        .cloned()
        .ok_or(EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Sequence,
        })
}
fn history_reason(error: SessionReducerError) -> InvalidEventHistoryReason {
    match error {
        SessionReducerError::WrongStream { .. } => InvalidEventHistoryReason::WrongStream,
        SessionReducerError::UnexpectedSequence { .. } => InvalidEventHistoryReason::Sequence,
        SessionReducerError::UnsupportedSchemaVersion { .. } => {
            InvalidEventHistoryReason::SchemaVersion
        }
        SessionReducerError::SessionNotCreated { .. } => InvalidEventHistoryReason::MissingCreation,
        SessionReducerError::InvalidTransition { .. } => InvalidEventHistoryReason::Transition,
        SessionReducerError::ActiveTurnMismatch { .. } => InvalidEventHistoryReason::TurnIdentity,
        SessionReducerError::PendingApprovalMismatch { .. } => {
            InvalidEventHistoryReason::ApprovalIdentity
        }
        SessionReducerError::SequenceOverflow { .. } => InvalidEventHistoryReason::Overflow,
    }
}

const SNAPSHOTS_SCHEMA_SQL: &str = "CREATE TABLE snapshots (
    stream_id BLOB NOT NULL PRIMARY KEY
        CHECK (typeof(stream_id) = 'blob' AND length(stream_id) = 16),
    seq ANY,
    codec_version ANY,
    body ANY
) STRICT, WITHOUT ROWID";

fn initialize_database(path: &Path) -> Result<(), EventStoreError> {
    #[cfg(test)]
    {
        initialize_with_hook(path, |_| Ok(()))
    }
    #[cfg(not(test))]
    {
        initialize_transaction(path)
    }
}

#[cfg(test)]
fn initialize_with_hook(
    path: &Path,
    hook: impl Fn(SchemaPoint) -> Result<(), EventStoreError>,
) -> Result<(), EventStoreError> {
    initialize_transaction(path, &hook)
}
fn initialize_transaction(
    path: &Path,
    #[cfg(test)] hook: &impl Fn(SchemaPoint) -> Result<(), EventStoreError>,
) -> Result<(), EventStoreError> {
    let mut connection = open_connection(path)?;
    let transaction = connection
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|error| map_sqlite(error, StorageOperation::Begin))?;
    let application_id = pragma_u32(&transaction, "application_id")?;
    let version = pragma_u32(&transaction, "user_version")?;
    let count: u32 = transaction
        .query_row("SELECT COUNT(*) FROM sqlite_schema", [], |row| row.get(0))
        .map_err(|error| map_sqlite(error, StorageOperation::Initialize))?;
    if application_id == 0 && version == 0 && count == 0 {
        transaction
            .execute_batch(EVENTS_SCHEMA_SQL)
            .map_err(|error| map_sqlite(error, StorageOperation::Initialize))?;
        at_test_point!(hook, SchemaPoint::Events);
        transaction
            .execute_batch(SNAPSHOTS_SCHEMA_SQL)
            .map_err(|error| map_sqlite(error, StorageOperation::SchemaUpgrade))?;
        at_test_point!(hook, SchemaPoint::Snapshots);
        transaction
            .execute_batch("PRAGMA application_id = 1128421425; PRAGMA user_version = 2;")
            .map_err(|error| map_sqlite(error, StorageOperation::SchemaUpgrade))?;
    } else {
        validate_identity(&transaction, false)?;
        validate_integrity(&transaction)?;
        if version == 1 {
            transaction
                .execute_batch(SNAPSHOTS_SCHEMA_SQL)
                .map_err(|error| map_sqlite(error, StorageOperation::SchemaUpgrade))?;
            at_test_point!(hook, SchemaPoint::Snapshots);
            transaction
                .execute_batch("PRAGMA user_version = 2;")
                .map_err(|error| map_sqlite(error, StorageOperation::SchemaUpgrade))?;
        }
    }
    at_test_point!(hook, SchemaPoint::Version);
    validate_identity(&transaction, true)?;
    validate_integrity(&transaction)?;
    transaction
        .commit()
        .map_err(|error| map_sqlite(error, StorageOperation::Commit))?;
    at_test_point!(hook, SchemaPoint::Committed);
    Ok(())
}
#[cfg(test)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SchemaPoint {
    Events,
    Snapshots,
    Version,
    Committed,
}

fn open_connection(path: &Path) -> Result<Connection, EventStoreError> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|error| map_sqlite(error, StorageOperation::Open))?;
    connection
        .busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(|error| map_sqlite(error, StorageOperation::Configure))?;
    connection
        .execute_batch("PRAGMA journal_mode = WAL; PRAGMA synchronous = FULL;")
        .map_err(|error| map_sqlite(error, StorageOperation::Configure))?;
    Ok(connection)
}

fn open_read_connection(path: &Path) -> Result<Connection, EventStoreError> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_NO_MUTEX
            | OpenFlags::SQLITE_OPEN_URI,
    )
    .map_err(|error| map_sqlite(error, StorageOperation::Open))?;
    connection
        .busy_timeout(SQLITE_BUSY_TIMEOUT)
        .map_err(|error| map_sqlite(error, StorageOperation::Configure))?;
    Ok(connection)
}

fn validate_integrity(connection: &Connection) -> Result<(), EventStoreError> {
    let integrity: String = connection
        .query_row("PRAGMA integrity_check(1)", [], |row| row.get(0))
        .map_err(|error| map_sqlite(error, StorageOperation::Initialize))?;
    if integrity != "ok" {
        return schema_corrupt();
    }
    Ok(())
}
fn schema_corrupt<T>() -> Result<T, EventStoreError> {
    Err(EventStoreError::CorruptStore {
        stage: CorruptStoreStage::Schema,
    })
}
fn validate_identity(connection: &Connection, snapshot: bool) -> Result<(), EventStoreError> {
    identity_transaction(
        connection,
        snapshot,
        #[cfg(test)]
        &|| Ok(()),
    )
}
fn identity_transaction(
    connection: &Connection,
    snapshot: bool,
    #[cfg(test)] hook: &impl Fn() -> Result<(), EventStoreError>,
) -> Result<(), EventStoreError> {
    let app = pragma_u32(connection, "application_id")?;
    let version = pragma_u32(connection, "user_version")?;
    #[cfg(test)]
    hook()?;
    if app != APPLICATION_ID || !(version == 2 || (!snapshot && version == 1)) {
        return Err(EventStoreError::UnsupportedDatabaseSchema {
            expected_application_id: APPLICATION_ID,
            actual_application_id: app,
            expected_user_version: DATABASE_SCHEMA_VERSION,
            actual_user_version: version,
        });
    }
    let mut statement = connection
        .prepare("SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY name")
        .map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
    let mut rows = statement
        .query([])
        .map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
    let mut count = 0;
    while let Some(row) = rows.next().map_err(|_| EventStoreError::CorruptStore {
        stage: CorruptStoreStage::Schema,
    })? {
        let kind: String = row.get(0).map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
        let name: String = row.get(1).map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
        let table: String = row.get(2).map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
        let sql: Option<String> = row.get(3).map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
        let valid = match name.as_str() {
            "events" => {
                kind == "table" && table == "events" && sql.as_deref() == Some(EVENTS_SCHEMA_SQL)
            }
            "snapshots" if version == 2 => {
                kind == "table"
                    && table == "snapshots"
                    && sql.as_deref() == Some(SNAPSHOTS_SCHEMA_SQL)
            }
            "sqlite_autoindex_events_2" => kind == "index" && table == "events" && sql.is_none(),
            _ => false,
        };
        if !valid {
            return schema_corrupt();
        }
        count += 1;
    }
    if count != if version == 2 { 3 } else { 2 } {
        return schema_corrupt();
    }
    validate_indexes(
        connection,
        "events",
        &[
            ("sqlite_autoindex_events_2", "u", &["stream_id", "seq"]),
            ("sqlite_autoindex_events_1", "pk", &["event_id"]),
        ],
    )?;
    if version == 2 {
        validate_indexes(
            connection,
            "snapshots",
            &[("sqlite_autoindex_snapshots_1", "pk", &["stream_id"])],
        )?;
    }
    Ok(())
}
fn validate_indexes(
    connection: &Connection,
    table: &str,
    expected: &[(&str, &str, &[&str])],
) -> Result<(), EventStoreError> {
    let query = match table {
        "events" => "PRAGMA index_list(events)",
        "snapshots" => "PRAGMA index_list(snapshots)",
        _ => return schema_corrupt(),
    };
    let mut statement = connection
        .prepare(query)
        .map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
    let entries = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })
        .map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
    let mut count = 0;
    for entry in entries {
        let (name, unique, origin, partial) = entry.map_err(|_| EventStoreError::CorruptStore {
            stage: CorruptStoreStage::Schema,
        })?;
        let Some((_, _, columns)) = expected
            .iter()
            .find(|(n, o, _)| *n == name && *o == origin && unique == 1 && partial == 0)
        else {
            return schema_corrupt();
        };
        let query = match name.as_str() {
            "sqlite_autoindex_events_1" => "PRAGMA index_info(sqlite_autoindex_events_1)",
            "sqlite_autoindex_events_2" => "PRAGMA index_info(sqlite_autoindex_events_2)",
            "sqlite_autoindex_snapshots_1" => "PRAGMA index_info(sqlite_autoindex_snapshots_1)",
            _ => return schema_corrupt(),
        };
        let mut info = connection
            .prepare(query)
            .map_err(|_| EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema,
            })?;
        let actual = info
            .query_map([], |row| row.get::<_, String>(2))
            .map_err(|_| EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema,
            })?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema,
            })?;
        if actual.iter().map(String::as_str).collect::<Vec<_>>() != *columns {
            return schema_corrupt();
        }
        count += 1;
    }
    if count != expected.len() {
        return schema_corrupt();
    }
    Ok(())
}

fn pragma_u32(connection: &Connection, name: &str) -> Result<u32, EventStoreError> {
    let query = match name {
        "application_id" => "PRAGMA application_id",
        "user_version" => "PRAGMA user_version",
        _ => {
            return Err(EventStoreError::CorruptStore {
                stage: CorruptStoreStage::Schema,
            });
        }
    };
    let value: i64 = connection
        .query_row(query, [], |row| row.get(0))
        .map_err(|error| map_sqlite(error, StorageOperation::Initialize))?;
    u32::try_from(value).map_err(|_| EventStoreError::CorruptStore {
        stage: CorruptStoreStage::Schema,
    })
}

fn read_high_water(
    transaction: &Transaction<'_>,
    stream: SessionId,
) -> Result<EventSeq, EventStoreError> {
    let encoded: Option<Vec<u8>> = transaction
        .query_row(
            "SELECT CASE WHEN typeof(seq) = 'blob' AND length(seq) = 8 THEN seq END FROM events WHERE stream_id = ?1 ORDER BY seq DESC LIMIT 1",
            params![stream.as_uuid().as_bytes().as_slice()],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| match error { rusqlite::Error::InvalidColumnType(..) => EventStoreError::CorruptStore { stage: CorruptStoreStage::Sequence }, _ => map_sqlite(error, StorageOperation::ReadHighWater) })?;
    encoded
        .as_deref()
        .map(decode_sequence)
        .transpose()
        .map(|value| value.unwrap_or_else(EventSeq::initial))
}

fn event_id_exists(transaction: &Transaction<'_>, event_id: Uuid) -> Result<bool, EventStoreError> {
    transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM events WHERE event_id = ?1)",
            params![event_id.as_bytes().as_slice()],
            |row| row.get(0),
        )
        .map_err(|error| map_sqlite(error, StorageOperation::CheckEventId))
}

fn insert_event(
    transaction: &Transaction<'_>,
    event: &PreparedEvent,
) -> Result<(), EventStoreError> {
    transaction
        .execute(
            "INSERT INTO events (
                event_id, stream_id, seq, schema_version, occurred_at, causation_id,
                correlation_id, payload
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                event.event_id.as_bytes().as_slice(),
                event.stream_id.as_uuid().as_bytes().as_slice(),
                sequence_bytes(event.seq).as_slice(),
                i64::from(event.encoded.schema_version),
                event.encoded.occurred_at,
                event
                    .encoded
                    .causation_id
                    .as_ref()
                    .map(|value| value.as_slice()),
                event.encoded.correlation_id.as_slice(),
                event.encoded.payload,
            ],
        )
        .map(|_| ())
        .map_err(|error| map_sqlite(error, StorageOperation::Insert))
}

fn read_event_by_id(
    transaction: &Transaction<'_>,
    event_id: Uuid,
) -> Result<DomainEventEnvelope, EventStoreError> {
    let raw = transaction
        .query_row(
            "SELECT event_id, stream_id, seq, schema_version, occurred_at, causation_id,
                    correlation_id, payload
             FROM events
             WHERE event_id = ?1",
            params![event_id.as_bytes().as_slice()],
            raw_event_from_row,
        )
        .map_err(|error| map_sqlite(error, StorageOperation::VerifyInserted))?;
    decode_event(raw)
}

fn map_sqlite(error: rusqlite::Error, operation: StorageOperation) -> EventStoreError {
    if let rusqlite::Error::SqliteFailure(failure, _) = &error {
        match failure.extended_code & 0xff {
            5 | 6 => return EventStoreError::Busy,
            11 | 26 => {
                return EventStoreError::CorruptStore {
                    stage: CorruptStoreStage::Schema,
                };
            }
            _ => {}
        }
    }

    let kind = match error {
        rusqlite::Error::SqliteFailure(failure, _) => match failure.extended_code & 0xff {
            8 => StorageErrorKind::ReadOnly,
            10 | 14 => StorageErrorKind::Io,
            13 => StorageErrorKind::Full,
            19 => StorageErrorKind::Constraint,
            _ => StorageErrorKind::Other,
        },
        _ => StorageErrorKind::Other,
    };
    EventStoreError::Storage { operation, kind }
}

#[cfg(test)]
mod tests {
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use chrono::{DateTime, SecondsFormat, TimeZone, Utc};
    use codebox_domain::{DomainEvent, NewDomainEvent};
    use tempfile::tempdir;

    use super::*;
    use crate::codec::{decode_sequence, sequence_bytes};

    fn event(seed: u128) -> NewDomainEvent {
        NewDomainEvent {
            schema_version: DOMAIN_EVENT_SCHEMA_V1,
            occurred_at: Utc
                .timestamp_opt(seed as i64, 0)
                .single()
                .expect("valid fixed timestamp"),
            causation_id: Some(Uuid::from_u128(seed + 10)),
            correlation_id: Uuid::from_u128(seed + 20),
            payload: DomainEvent::SessionCreated,
        }
    }

    #[test]
    fn sqlite_sequence_codec_preserves_full_u64_order() {
        let values = [0, 1, i64::MAX as u64, i64::MAX as u64 + 1, u64::MAX];
        let encoded: Vec<_> = values
            .iter()
            .copied()
            .map(EventSeq::new)
            .map(sequence_bytes)
            .collect();
        assert!(encoded.windows(2).all(|pair| pair[0] < pair[1]));
        for (value, bytes) in values.into_iter().zip(encoded) {
            assert_eq!(
                decode_sequence(&bytes).expect("fixed-width sequence"),
                EventSeq::new(value)
            );
        }
    }

    #[test]
    fn canonical_timestamp_encoding_fits_replay_bound() {
        let values = [
            DateTime::<Utc>::MIN_UTC,
            Utc.timestamp_opt(0, 0).single().expect("Unix epoch"),
            DateTime::<Utc>::MAX_UTC,
        ];
        for value in values {
            let encoded = value.to_rfc3339_opts(SecondsFormat::Nanos, true);
            assert!(!encoded.is_empty());
            assert!(encoded.len() <= MAX_STORED_TIMESTAMP_BYTES);
        }
    }

    #[tokio::test]
    async fn sqlite_row_codec_preserves_every_envelope_field() {
        let root = tempdir().expect("private temp root");
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("private root mode");
        let store = SqliteEventStore::open(root.path().join("events.sqlite"))
            .await
            .expect("open store");
        let stream = SessionId::new();
        let input = event(1);
        let appended = store
            .append(stream, EventSeq::initial(), vec![input.clone()])
            .await
            .expect("append");
        assert_eq!(appended.len(), 1);
        let envelope = &appended[0];
        assert_eq!(envelope.stream_id, stream);
        assert_eq!(envelope.seq, EventSeq::new(1));
        assert_eq!(envelope.schema_version, input.schema_version);
        assert_eq!(envelope.occurred_at, input.occurred_at);
        assert_eq!(envelope.causation_id, input.causation_id);
        assert_eq!(envelope.correlation_id, input.correlation_id);
        assert_eq!(envelope.payload, input.payload);
        assert!(!envelope.event_id.is_nil());
    }

    #[tokio::test]
    async fn duplicate_event_id_rolls_back_entire_batch() {
        let root = tempdir().expect("private temp root");
        std::fs::set_permissions(root.path(), std::fs::Permissions::from_mode(0o700))
            .expect("private root mode");
        let event_ids = [
            Uuid::from_u128(500),
            Uuid::from_u128(501),
            Uuid::from_u128(500),
        ];
        let index = Arc::new(AtomicUsize::new(0));
        let source_index = Arc::clone(&index);
        let store = SqliteEventStore::open_with_source(
            root.path().join("events.sqlite"),
            Arc::new(move || event_ids[source_index.fetch_add(1, Ordering::SeqCst)]),
        )
        .await
        .expect("open store");
        let stream = SessionId::new();
        store
            .append(stream, EventSeq::initial(), vec![event(1)])
            .await
            .expect("seed existing event ID");
        let error = store
            .append(stream, EventSeq::new(1), vec![event(2), event(3)])
            .await
            .expect_err("duplicate source must fail");
        assert_eq!(error, EventStoreError::DuplicateEventId);
        let connection =
            Connection::open(root.path().join("events.sqlite")).expect("open test database");
        let count: i64 = connection
            .query_row("SELECT COUNT(*) FROM events", [], |row| row.get(0))
            .expect("count rows after duplicate");
        assert_eq!(count, 1);
    }

    #[tokio::test]
    async fn load_after_worker_join_failure_maps_to_bounded_error() {
        let worker = task::spawn_blocking(|| -> Result<(), EventStoreError> {
            panic!("test-only replay worker failure");
        });
        assert_eq!(
            await_replay_worker(worker).await,
            Err(EventStoreError::WorkerUnavailable)
        );
    }

    #[test]
    fn event_store_errors_have_bounded_safe_debug() {
        let path_canary = "/private/operator/events.sqlite";
        let payload_canary = "secret-event-payload";
        let errors = [
            EventStoreError::EmptyBatch,
            EventStoreError::SequenceConflict {
                expected: EventSeq::new(1),
                actual: EventSeq::new(2),
            },
            EventStoreError::InvalidDatabasePath {
                reason: crate::DatabasePathErrorKind::TargetSymlink,
            },
            EventStoreError::Storage {
                operation: StorageOperation::Commit,
                kind: StorageErrorKind::Io,
            },
        ];
        for error in errors {
            let debug = format!("{error:?}");
            assert!(debug.len() < 256);
            assert!(!debug.contains(path_canary));
            assert!(!debug.contains(payload_canary));
        }
    }
}

#[cfg(test)]
#[path = "snapshot_tests.rs"]
mod snapshot_tests;

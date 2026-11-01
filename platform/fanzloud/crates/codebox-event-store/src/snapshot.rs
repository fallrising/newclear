use std::fmt;

use chrono::{DateTime, Utc};
use codebox_domain::{SessionProjection, SessionStatus};
use uuid::Uuid;

use crate::{EventStoreError, InvalidSnapshotReason, SnapshotCacheReason};

/// Fixed canonical snapshot body size (CU-EVT-03/CU-EVT-04).
pub const MAX_SNAPSHOT_BYTES: usize = 96;
/// Maximum cache sequence verified by save/load (CU-EVT-03/CU-EVT-04), not an event-head cap.
pub const MAX_SNAPSHOT_PREFIX_EVENTS: u64 = 4096;

/// A private projection wrapper. Construction validates bounds, not persisted provenance.
///
/// Contracts: CU-EVT-03/CU-EVT-04. Save and usable load independently replay durable history.
/// Public construction proves bounds only, while load returns its freshly replayed projection.
/// This value provides no
/// reducer restoration capability. Debug omits all identifiers, timestamps and content.
#[derive(Clone, Eq, PartialEq)]
pub struct SessionSnapshot {
    projection: SessionProjection,
}
impl fmt::Debug for SessionSnapshot {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("SessionSnapshot")
            .field("projection", &"<redacted>")
            .finish()
    }
}
impl SessionSnapshot {
    /// Wraps an accepted projection within the nonzero 4096-event budget (CU-EVT-04).
    pub fn from_projection(projection: SessionProjection) -> Result<Self, EventStoreError> {
        validate_sequence(projection.last_seq().value())?;
        Ok(Self { projection })
    }
    /// Inspects the immutable projection without granting reducer restore authority.
    pub fn projection(&self) -> &SessionProjection {
        &self.projection
    }
}
pub(crate) fn validate_sequence(seq: u64) -> Result<(), EventStoreError> {
    if seq == 0 {
        return Err(EventStoreError::InvalidSnapshot {
            reason: InvalidSnapshotReason::Empty,
        });
    }
    if seq > MAX_SNAPSHOT_PREFIX_EVENTS {
        return Err(EventStoreError::SnapshotPrefixTooLarge {
            max: MAX_SNAPSHOT_PREFIX_EVENTS,
            actual: seq,
        });
    }
    Ok(())
}
pub(crate) fn encode(snapshot: &SessionSnapshot) -> [u8; MAX_SNAPSHOT_BYTES] {
    let p = snapshot.projection();
    let mut body = [0u8; MAX_SNAPSHOT_BYTES];
    body[..4].copy_from_slice(b"CBS1");
    body[4..6].copy_from_slice(&1u16.to_be_bytes());
    body[6..8].copy_from_slice(&1u16.to_be_bytes());
    body[8..24].copy_from_slice(p.session_id().as_uuid().as_bytes());
    body[24..32].copy_from_slice(&p.last_seq().value().to_be_bytes());
    body[32] = match p.status() {
        SessionStatus::Provisioning => 0,
        SessionStatus::Ready => 1,
        SessionStatus::Running => 2,
        SessionStatus::WaitingApproval => 3,
        SessionStatus::Cancelling => 4,
        SessionStatus::Idle => 5,
        SessionStatus::Failed => 6,
        SessionStatus::Archiving => 7,
        SessionStatus::Archived => 8,
    };
    for (offset, id) in [
        (33, p.active_turn().map(|id| id.as_uuid())),
        (50, p.pending_approval().map(|id| id.as_uuid())),
        (67, p.sandbox_id().map(|id| id.as_uuid())),
    ] {
        if let Some(id) = id {
            body[offset] = 1;
            body[offset + 1..offset + 17].copy_from_slice(id.as_bytes());
        }
    }
    body[84..92].copy_from_slice(&p.last_activity().timestamp().to_be_bytes());
    body[92..96].copy_from_slice(&p.last_activity().timestamp_subsec_nanos().to_be_bytes());
    body
}
// Decoding checks cache syntax only. No decoded value becomes a domain projection.
pub(crate) fn validate_body(
    body: &[u8],
    stream: &[u8],
    seq: &[u8],
) -> Result<(), SnapshotCacheReason> {
    if body.len() != 96 {
        return Err(SnapshotCacheReason::Width);
    }
    if &body[..4] != b"CBS1" || body[4..8] != [0, 1, 0, 1] {
        return Err(SnapshotCacheReason::Version);
    }
    if &body[8..24] != stream {
        return Err(SnapshotCacheReason::Identity);
    }
    let stream_id = Uuid::from_slice(&body[8..24]).map_err(|_| SnapshotCacheReason::Identity)?;
    if stream_id.is_nil() {
        return Err(SnapshotCacheReason::Identity);
    }
    if &body[24..32] != seq {
        return Err(SnapshotCacheReason::Sequence);
    }
    let value = u64::from_be_bytes(
        body[24..32]
            .try_into()
            .map_err(|_| SnapshotCacheReason::Width)?,
    );
    if value == 0 || value > MAX_SNAPSHOT_PREFIX_EVENTS {
        return Err(SnapshotCacheReason::Sequence);
    }
    if body[32] > 8 {
        return Err(SnapshotCacheReason::Status);
    }
    for offset in [33, 50, 67] {
        let id = Uuid::from_slice(&body[offset + 1..offset + 17])
            .map_err(|_| SnapshotCacheReason::Option)?;
        match body[offset] {
            0 if id.is_nil() => {}
            1 if !id.is_nil() => {}
            _ => return Err(SnapshotCacheReason::Option),
        }
    }
    let seconds = i64::from_be_bytes(
        body[84..92]
            .try_into()
            .map_err(|_| SnapshotCacheReason::Width)?,
    );
    let nanos = u32::from_be_bytes(
        body[92..96]
            .try_into()
            .map_err(|_| SnapshotCacheReason::Width)?,
    );
    DateTime::<Utc>::from_timestamp(seconds, nanos).ok_or(SnapshotCacheReason::Timestamp)?;
    Ok(())
}

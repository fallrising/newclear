//! CU-SES-03: pure version-1 command identity and zero/one event proposal.
//!
//! SPEC-T040A A01–A09 define a total E0 boundary. Operator labels and IDs grant no authority;
//! accepted proposals establish no durability, receipt, lease, execution or turn uniqueness.
//! No raw parser, I/O, clock, identifier generation, retry or shared mutable state is owned here.
use chrono::{DateTime, Utc};
use thiserror::Error;

use crate::{
    ApprovalDecision, ApprovalId, CommandId, DOMAIN_EVENT_SCHEMA_V1, DomainEvent, EventSeq,
    NewDomainEvent, SessionId, SessionReducer, SessionStatus, TurnId,
};

/// CU-SES-03 A01/A09: a label, without authentication or authorization semantics.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ActorRef {
    Operator,
}
/// CU-SES-03 A01: the sole bounded approval scope; durable provenance is not established.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalScope {
    Once,
}
/// CU-SES-03 A01: explicit approval reason, checked against the decision.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalReason {
    OperatorApproved,
    OperatorDenied,
}
/// CU-SES-03 A01/A02: caller-owned request; all fields participate in canonical identity.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandEnvelope<C> {
    pub command_id: CommandId,
    pub session_id: SessionId,
    pub expected_version: Option<u64>,
    pub actor: ActorRef,
    pub issued_at: DateTime<Utc>,
    pub payload: C,
}
/// CU-SES-03 A01: closed version-1 command domain, without arbitrary content or execution.
///
/// Identifiers remain distinct types:
/// ```compile_fail
/// use codebox_domain::{SessionCommand, SessionId};
/// let _ = SessionCommand::StartTurn { turn_id: SessionId::new() };
/// ```
/// ```compile_fail
/// use codebox_domain::{ApprovalDecision, ApprovalReason, ApprovalScope, SessionCommand, TurnId};
/// let _ = SessionCommand::ResolveApproval {
///     turn_id: TurnId::new(), approval_id: TurnId::new(),
///     decision: ApprovalDecision::Approved, scope: ApprovalScope::Once,
///     reason: ApprovalReason::OperatorApproved,
/// };
/// ```
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum SessionCommand {
    StartTurn {
        turn_id: TurnId,
    },
    ResolveApproval {
        turn_id: TurnId,
        approval_id: ApprovalId,
        decision: ApprovalDecision,
        scope: ApprovalScope,
        reason: ApprovalReason,
    },
    CancelTurn {
        turn_id: TurnId,
    },
}
/// CU-SES-03 A04/A08: bounded command classification used by WrongState.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CommandKind {
    StartTurn,
    ResolveApproval,
    CancelTurn,
}
/// CU-SES-03 A03–A08: immutable zero/one proposal or bounded rejection, never a receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CommandDecision {
    Accepted { event: Option<NewDomainEvent> },
    Rejected(CommandRejection),
}
/// CU-SES-03 A03/A08: exact ordered errors containing only bounded enums, IDs and numbers.
/// No rejection retries automatically; callers must correct routing/state/identity or await
/// a versioned cancellation amendment. Sequence exhaustion requires operator investigation.
#[derive(Clone, Debug, Error, Eq, PartialEq)]
pub enum CommandRejection {
    #[error("command belongs to a different session")]
    WrongSession {
        expected: SessionId,
        actual: SessionId,
    },
    #[error("session projection does not exist")]
    SessionNotFound,
    #[error("session is archived")]
    SessionArchived,
    #[error("expected version differs from current high-water")]
    ExpectedVersionConflict { expected: u64, actual: u64 },
    #[error("approval reason does not agree with decision")]
    InvalidApprovalReason,
    #[error("a turn is already running")]
    TurnAlreadyRunning { turn_id: TurnId },
    #[error("waiting-approval cancellation requires a versioned amendment")]
    CancellationRequiresVersionedAmendment,
    #[error("command is invalid for the current session state")]
    WrongState {
        command: CommandKind,
        state: SessionStatus,
    },
    #[error("command does not name the active turn")]
    ActiveTurnMismatch {
        expected: Option<TurnId>,
        actual: TurnId,
    },
    #[error("command does not name the pending approval")]
    PendingApprovalMismatch {
        expected: Option<ApprovalId>,
        actual: ApprovalId,
    },
    #[error("event sequence cannot advance beyond its representable maximum")]
    SequenceExhausted { head: EventSeq },
}
/// CU-SES-03 A02/A07: private immutable canonical identity and decision; no import constructor.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandPlan {
    canonical: Vec<u8>,
    decision: CommandDecision,
}
impl CommandPlan {
    /// CU-SES-03 A02: exact CBC1 bytes (77 or 96), available even on rejection.
    /// Equality proves request equality only, never authenticity or durable acceptance.
    pub fn canonical_command(&self) -> &[u8] {
        &self.canonical
    }
    /// CU-SES-03 A03–A08: read-only zero/one event proposal or rejection.
    pub fn decision(&self) -> &CommandDecision {
        &self.decision
    }
}
/// CU-SES-03 A01–A09, SPEC-T040A: total deterministic E0 planner on immutable typed inputs.
/// Checks session, existence, archived, version, reason, state, turn, approval, then overflow.
/// Matching cancellation in Cancelling emits no event and requires no next sequence.
/// WaitingApproval cancellation requires a separately accepted versioned amendment.
/// Proposed v1 events preserve issued_at and use command UUID for causation/correlation;
/// the caller assigns event ID/sequence and owns all append, authorization and effect behavior.
pub fn decide_session_command_v1(
    state: &SessionReducer,
    command: &CommandEnvelope<SessionCommand>,
) -> CommandPlan {
    CommandPlan {
        canonical: canonical_command(command),
        decision: match propose(state, command) {
            Ok(event) => CommandDecision::Accepted { event },
            Err(rejection) => CommandDecision::Rejected(rejection),
        },
    }
}

fn canonical_command(command: &CommandEnvelope<SessionCommand>) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(96);
    bytes.extend_from_slice(b"CBC1\x00\x01");
    bytes.extend_from_slice(command.command_id.as_uuid().as_bytes());
    bytes.extend_from_slice(command.session_id.as_uuid().as_bytes());
    bytes.push(u8::from(command.expected_version.is_some()));
    bytes.extend_from_slice(&command.expected_version.unwrap_or(0).to_be_bytes());
    bytes.push(match command.actor {
        ActorRef::Operator => 0,
    });
    bytes.extend_from_slice(&command.issued_at.timestamp().to_be_bytes());
    bytes.extend_from_slice(&command.issued_at.timestamp_subsec_nanos().to_be_bytes());
    match &command.payload {
        SessionCommand::StartTurn { turn_id } => {
            bytes.push(0);
            bytes.extend_from_slice(turn_id.as_uuid().as_bytes());
        }
        SessionCommand::ResolveApproval {
            turn_id,
            approval_id,
            decision,
            scope,
            reason,
        } => {
            bytes.push(1);
            bytes.extend_from_slice(turn_id.as_uuid().as_bytes());
            bytes.extend_from_slice(approval_id.as_uuid().as_bytes());
            bytes.push(match decision {
                ApprovalDecision::Approved => 0,
                ApprovalDecision::Denied => 1,
            });
            bytes.push(match scope {
                ApprovalScope::Once => 0,
            });
            bytes.push(match reason {
                ApprovalReason::OperatorApproved => 0,
                ApprovalReason::OperatorDenied => 1,
            });
        }
        SessionCommand::CancelTurn { turn_id } => {
            bytes.push(2);
            bytes.extend_from_slice(turn_id.as_uuid().as_bytes());
        }
    }
    bytes
}

fn propose(
    state: &SessionReducer,
    command: &CommandEnvelope<SessionCommand>,
) -> Result<Option<NewDomainEvent>, CommandRejection> {
    if command.session_id != state.stream_id() {
        return Err(CommandRejection::WrongSession {
            expected: state.stream_id(),
            actual: command.session_id,
        });
    }
    let projection = state
        .projection()
        .ok_or(CommandRejection::SessionNotFound)?;
    let status = projection.status();
    if status == SessionStatus::Archived {
        return Err(CommandRejection::SessionArchived);
    }
    if let Some(expected) = command.expected_version
        && expected != state.last_seq().value()
    {
        return Err(CommandRejection::ExpectedVersionConflict {
            expected,
            actual: state.last_seq().value(),
        });
    }
    if let SessionCommand::ResolveApproval {
        decision, reason, ..
    } = &command.payload
        && !matches!(
            (decision, reason),
            (ApprovalDecision::Approved, ApprovalReason::OperatorApproved)
                | (ApprovalDecision::Denied, ApprovalReason::OperatorDenied)
        )
    {
        return Err(CommandRejection::InvalidApprovalReason);
    }
    let require_turn = |actual| {
        if projection.active_turn() == Some(actual) {
            Ok(())
        } else {
            Err(CommandRejection::ActiveTurnMismatch {
                expected: projection.active_turn(),
                actual,
            })
        }
    };
    let payload = match &command.payload {
        SessionCommand::StartTurn { turn_id } => match (status, projection.active_turn()) {
            (SessionStatus::Ready, _) => DomainEvent::TurnStarted { turn_id: *turn_id },
            (
                SessionStatus::Running | SessionStatus::WaitingApproval | SessionStatus::Cancelling,
                Some(active),
            ) => return Err(CommandRejection::TurnAlreadyRunning { turn_id: active }),
            // Accepted T020 construction guarantees Some(active) in all three busy states.
            _ => {
                return Err(CommandRejection::WrongState {
                    command: CommandKind::StartTurn,
                    state: status,
                });
            }
        },
        SessionCommand::ResolveApproval {
            turn_id,
            approval_id,
            decision,
            ..
        } => {
            if status != SessionStatus::WaitingApproval {
                return Err(CommandRejection::WrongState {
                    command: CommandKind::ResolveApproval,
                    state: status,
                });
            }
            require_turn(*turn_id)?;
            if projection.pending_approval() != Some(*approval_id) {
                return Err(CommandRejection::PendingApprovalMismatch {
                    expected: projection.pending_approval(),
                    actual: *approval_id,
                });
            }
            DomainEvent::ApprovalResolved {
                turn_id: *turn_id,
                approval_id: *approval_id,
                decision: *decision,
            }
        }
        SessionCommand::CancelTurn { turn_id } => {
            match status {
                SessionStatus::WaitingApproval => {
                    return Err(CommandRejection::CancellationRequiresVersionedAmendment);
                }
                SessionStatus::Running | SessionStatus::Cancelling => {}
                _ => {
                    return Err(CommandRejection::WrongState {
                        command: CommandKind::CancelTurn,
                        state: status,
                    });
                }
            }
            require_turn(*turn_id)?;
            if status == SessionStatus::Cancelling {
                return Ok(None);
            }
            DomainEvent::TurnCancellationRequested { turn_id: *turn_id }
        }
    };
    state
        .last_seq()
        .checked_next()
        .map_err(|_| CommandRejection::SequenceExhausted {
            head: state.last_seq(),
        })?;
    let command_uuid = command.command_id.as_uuid();
    Ok(Some(NewDomainEvent {
        schema_version: DOMAIN_EVENT_SCHEMA_V1,
        occurred_at: command.issued_at,
        causation_id: Some(command_uuid),
        correlation_id: command_uuid,
        payload,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{DomainEvent, DomainEventEnvelope, SandboxId};
    use chrono::TimeZone;
    use uuid::Uuid;

    fn append(state: &SessionReducer, payload: DomainEvent) -> SessionReducer {
        let seq = state.last_seq().checked_next().unwrap();
        state
            .apply(&DomainEventEnvelope {
                event_id: Uuid::from_u128(100 + u128::from(seq.value())),
                stream_id: state.stream_id(),
                seq,
                schema_version: 1,
                occurred_at: Utc.timestamp_opt(1, 0).single().unwrap(),
                causation_id: None,
                correlation_id: Uuid::from_u128(200),
                payload,
            })
            .unwrap()
    }

    #[test]
    fn command_v1_sequence_exhaustion_is_safe() {
        let session = SessionId::try_from_uuid(Uuid::from_u128(1)).unwrap();
        let turn = TurnId::try_from_uuid(Uuid::from_u128(2)).unwrap();
        let approval = ApprovalId::try_from_uuid(Uuid::from_u128(3)).unwrap();
        let other_turn = TurnId::try_from_uuid(Uuid::from_u128(4)).unwrap();
        let other_approval = ApprovalId::try_from_uuid(Uuid::from_u128(5)).unwrap();
        let command_id = CommandId::try_from_uuid(Uuid::from_u128(6)).unwrap();
        let created = append(&SessionReducer::new(session), DomainEvent::SessionCreated);
        let ready = append(
            &created,
            DomainEvent::SandboxProvisioned {
                sandbox_id: SandboxId::try_from_uuid(Uuid::from_u128(7)).unwrap(),
            },
        );
        let running = append(&ready, DomainEvent::TurnStarted { turn_id: turn });
        let waiting = append(
            &running,
            DomainEvent::ApprovalRequested {
                turn_id: turn,
                approval_id: approval,
            },
        );
        let cancelling = append(
            &running,
            DomainEvent::TurnCancellationRequested { turn_id: turn },
        );
        let resolve = SessionCommand::ResolveApproval {
            turn_id: turn,
            approval_id: approval,
            decision: ApprovalDecision::Approved,
            scope: ApprovalScope::Once,
            reason: ApprovalReason::OperatorApproved,
        };
        let envelope = |payload| CommandEnvelope {
            command_id,
            session_id: session,
            expected_version: None,
            actor: ActorRef::Operator,
            issued_at: Utc.timestamp_opt(-1, 999_999_999).single().unwrap(),
            payload,
        };
        let head = EventSeq::new(u64::MAX);
        let exhausted = CommandRejection::SequenceExhausted { head };
        for (legal, payload) in [
            (ready.clone(), SessionCommand::StartTurn { turn_id: turn }),
            (
                running.clone(),
                SessionCommand::CancelTurn { turn_id: turn },
            ),
            (waiting.clone(), resolve.clone()),
        ] {
            let max = legal.command_test_at_head(head);
            let c = envelope(payload.clone());
            let before = (max.clone(), c.clone());
            assert_eq!(max.projection().unwrap().last_seq(), head);
            assert_eq!(
                decide_session_command_v1(&max, &c).decision(),
                &CommandDecision::Rejected(exhausted.clone())
            );
            assert_eq!((max.clone(), c.clone()), before);
            let near = legal.command_test_at_head(EventSeq::new(u64::MAX - 1));
            let plan = decide_session_command_v1(&near, &c);
            let CommandDecision::Accepted { event: Some(event) } = plan.decision() else {
                panic!("MAX-1 must permit one event")
            };
            let output = near
                .apply(&DomainEventEnvelope {
                    event_id: Uuid::from_u128(500),
                    stream_id: session,
                    seq: head,
                    schema_version: event.schema_version,
                    occurred_at: event.occurred_at,
                    causation_id: event.causation_id,
                    correlation_id: event.correlation_id,
                    payload: event.payload.clone(),
                })
                .unwrap();
            assert_eq!(output.last_seq(), head);
            assert_eq!(output.projection().unwrap().last_seq(), head);
        }
        let text = format!("{exhausted} {exhausted:?}");
        assert!(text.len() < 300);
        for forbidden in [
            "authorized",
            "authenticated",
            "durable success",
            "credential",
            "secret",
            "token=",
        ] {
            assert!(!text.contains(forbidden));
        }
        let max = cancelling.command_test_at_head(head);
        assert_eq!(
            decide_session_command_v1(
                &max,
                &envelope(SessionCommand::CancelTurn { turn_id: turn })
            )
            .decision(),
            &CommandDecision::Accepted { event: None }
        );
        assert_eq!(
            decide_session_command_v1(
                &max,
                &envelope(SessionCommand::CancelTurn {
                    turn_id: other_turn
                })
            )
            .decision(),
            &CommandDecision::Rejected(CommandRejection::ActiveTurnMismatch {
                expected: Some(turn),
                actual: other_turn
            })
        );

        // Reachable earlier errors win at exhausted high-water: routing, version, reason,
        // state and identities. MAX no-op is intentionally not an exhaustion failure.
        let max_ready = ready.command_test_at_head(head);
        let mut c = envelope(SessionCommand::StartTurn { turn_id: turn });
        c.session_id = SessionId::try_from_uuid(Uuid::from_u128(8)).unwrap();
        assert_eq!(
            decide_session_command_v1(&max_ready, &c).decision(),
            &CommandDecision::Rejected(CommandRejection::WrongSession {
                expected: session,
                actual: c.session_id
            })
        );
        c.session_id = session;
        c.expected_version = Some(u64::MAX - 1);
        assert_eq!(
            decide_session_command_v1(&max_ready, &c).decision(),
            &CommandDecision::Rejected(CommandRejection::ExpectedVersionConflict {
                expected: u64::MAX - 1,
                actual: u64::MAX
            })
        );
        let max_waiting = waiting.command_test_at_head(head);
        let mut c = envelope(resolve.clone());
        if let SessionCommand::ResolveApproval { reason, .. } = &mut c.payload {
            *reason = ApprovalReason::OperatorDenied;
        }
        assert_eq!(
            decide_session_command_v1(&max_waiting, &c).decision(),
            &CommandDecision::Rejected(CommandRejection::InvalidApprovalReason)
        );
        assert_eq!(
            decide_session_command_v1(
                &max_ready,
                &envelope(SessionCommand::CancelTurn {
                    turn_id: other_turn
                })
            )
            .decision(),
            &CommandDecision::Rejected(CommandRejection::WrongState {
                command: CommandKind::CancelTurn,
                state: SessionStatus::Ready
            })
        );
        let mut c = envelope(resolve.clone());
        if let SessionCommand::ResolveApproval {
            turn_id,
            approval_id,
            ..
        } = &mut c.payload
        {
            *turn_id = other_turn;
            *approval_id = other_approval;
        }
        assert_eq!(
            decide_session_command_v1(&max_waiting, &c).decision(),
            &CommandDecision::Rejected(CommandRejection::ActiveTurnMismatch {
                expected: Some(turn),
                actual: other_turn
            })
        );
        if let SessionCommand::ResolveApproval { turn_id, .. } = &mut c.payload {
            *turn_id = turn;
        }
        assert_eq!(
            decide_session_command_v1(&max_waiting, &c).decision(),
            &CommandDecision::Rejected(CommandRejection::PendingApprovalMismatch {
                expected: Some(approval),
                actual: other_approval
            })
        );
        assert_eq!(
            decide_session_command_v1(
                &max_waiting,
                &envelope(SessionCommand::CancelTurn {
                    turn_id: other_turn
                })
            )
            .decision(),
            &CommandDecision::Rejected(CommandRejection::CancellationRequiresVersionedAmendment)
        );
        let archived = append(
            &append(&ready, DomainEvent::SessionArchivingStarted),
            DomainEvent::SessionArchived,
        )
        .command_test_at_head(head);
        assert_eq!(
            decide_session_command_v1(
                &archived,
                &envelope(SessionCommand::StartTurn { turn_id: turn })
            )
            .decision(),
            &CommandDecision::Rejected(CommandRejection::SessionArchived)
        );
    }
}

use chrono::{DateTime, FixedOffset, TimeZone, Utc};
use codebox_domain::*;
use uuid::Uuid;

fn sid() -> SessionId {
    SessionId::try_from_uuid(Uuid::from_bytes([0x11; 16])).unwrap()
}
fn cid() -> CommandId {
    CommandId::try_from_uuid(Uuid::from_bytes([0x22; 16])).unwrap()
}
fn turn() -> TurnId {
    TurnId::try_from_uuid(Uuid::from_bytes([0x33; 16])).unwrap()
}
fn approval() -> ApprovalId {
    ApprovalId::try_from_uuid(Uuid::from_bytes([0x44; 16])).unwrap()
}
fn other_turn() -> TurnId {
    TurnId::try_from_uuid(Uuid::from_u128(99)).unwrap()
}
fn other_approval() -> ApprovalId {
    ApprovalId::try_from_uuid(Uuid::from_u128(98)).unwrap()
}
fn time() -> DateTime<Utc> {
    Utc.timestamp_opt(1, 2).single().unwrap()
}
fn request(payload: SessionCommand) -> CommandEnvelope<SessionCommand> {
    CommandEnvelope {
        command_id: cid(),
        session_id: sid(),
        expected_version: None,
        actor: ActorRef::Operator,
        issued_at: time(),
        payload,
    }
}
fn start() -> SessionCommand {
    SessionCommand::StartTurn { turn_id: turn() }
}
fn cancel() -> SessionCommand {
    SessionCommand::CancelTurn { turn_id: turn() }
}
fn resolve() -> SessionCommand {
    SessionCommand::ResolveApproval {
        turn_id: turn(),
        approval_id: approval(),
        decision: ApprovalDecision::Approved,
        scope: ApprovalScope::Once,
        reason: ApprovalReason::OperatorApproved,
    }
}
fn inconsistent() -> SessionCommand {
    SessionCommand::ResolveApproval {
        turn_id: other_turn(),
        approval_id: other_approval(),
        decision: ApprovalDecision::Approved,
        scope: ApprovalScope::Once,
        reason: ApprovalReason::OperatorDenied,
    }
}
fn append(state: &SessionReducer, payload: DomainEvent) -> SessionReducer {
    let seq = state.last_seq().checked_next().unwrap();
    state
        .apply(&DomainEventEnvelope {
            event_id: Uuid::from_u128(u128::from(seq.value()) + 100),
            stream_id: state.stream_id(),
            seq,
            schema_version: 1,
            occurred_at: time(),
            causation_id: None,
            correlation_id: Uuid::from_u128(200),
            payload,
        })
        .unwrap()
}
// Every fixture follows accepted public T020 transitions; no public restore seam is used.
fn state(status: SessionStatus) -> SessionReducer {
    let created = append(&SessionReducer::new(sid()), DomainEvent::SessionCreated);
    if status == SessionStatus::Provisioning {
        return created;
    }
    if status == SessionStatus::Failed {
        return append(&created, DomainEvent::ProvisioningFailed);
    }
    let ready = append(
        &created,
        DomainEvent::SandboxProvisioned {
            sandbox_id: SandboxId::try_from_uuid(Uuid::from_u128(5)).unwrap(),
        },
    );
    match status {
        SessionStatus::Ready => ready,
        SessionStatus::Running => append(&ready, DomainEvent::TurnStarted { turn_id: turn() }),
        SessionStatus::WaitingApproval => append(
            &append(&ready, DomainEvent::TurnStarted { turn_id: turn() }),
            DomainEvent::ApprovalRequested {
                turn_id: turn(),
                approval_id: approval(),
            },
        ),
        SessionStatus::Cancelling => append(
            &append(&ready, DomainEvent::TurnStarted { turn_id: turn() }),
            DomainEvent::TurnCancellationRequested { turn_id: turn() },
        ),
        SessionStatus::Idle => append(&ready, DomainEvent::SessionIdled),
        SessionStatus::Archiving => append(&ready, DomainEvent::SessionArchivingStarted),
        SessionStatus::Archived => append(
            &append(&ready, DomainEvent::SessionArchivingStarted),
            DomainEvent::SessionArchived,
        ),
        _ => unreachable!("handled above"),
    }
}
const STATUSES: [SessionStatus; 9] = [
    SessionStatus::Provisioning,
    SessionStatus::Ready,
    SessionStatus::Running,
    SessionStatus::WaitingApproval,
    SessionStatus::Cancelling,
    SessionStatus::Idle,
    SessionStatus::Failed,
    SessionStatus::Archiving,
    SessionStatus::Archived,
];
fn proposed(command: &CommandEnvelope<SessionCommand>, payload: DomainEvent) -> CommandDecision {
    CommandDecision::Accepted {
        event: Some(NewDomainEvent {
            schema_version: 1,
            occurred_at: command.issued_at,
            causation_id: Some(command.command_id.as_uuid()),
            correlation_id: command.command_id.as_uuid(),
            payload,
        }),
    }
}
fn rejected(
    state: &SessionReducer,
    command: &CommandEnvelope<SessionCommand>,
    expected: CommandRejection,
) {
    let before = (state.clone(), command.clone());
    let plan = decide_session_command_v1(state, command);
    assert_eq!(plan.decision(), &CommandDecision::Rejected(expected));
    assert_eq!((state.clone(), command.clone()), before);
    assert!(matches!(plan.canonical_command().len(), 77 | 96));
}
fn hex(s: &str) -> Vec<u8> {
    s.as_bytes()
        .chunks_exact(2)
        .map(|pair| u8::from_str_radix(std::str::from_utf8(pair).unwrap(), 16).unwrap())
        .collect()
}
// Independent literal fixtures: offsets 0/4/6/22/38/47/48/56/60/61.
fn fixture(tag: &str, payload: &str, version: &str) -> Vec<u8> {
    hex(&format!(
        "4342433100012222222222222222222222222222222211111111111111111111111111111111{version}00000000000000000100000002{tag}{payload}"
    ))
}
const TURN_HEX: &str = "33333333333333333333333333333333";
const RESOLVE_APPROVED_HEX: &str =
    "3333333333333333333333333333333344444444444444444444444444444444000000";
const RESOLVE_DENIED_HEX: &str =
    "3333333333333333333333333333333344444444444444444444444444444444010001";

#[test]
fn command_v1_inputs_are_closed_typed_and_authority_free() {
    // Exhaustive matches become compile errors if unreviewed actor/scope/reason variants appear.
    fn actor(v: ActorRef) -> u8 {
        match v {
            ActorRef::Operator => 0,
        }
    }
    fn scope(v: ApprovalScope) -> u8 {
        match v {
            ApprovalScope::Once => 0,
        }
    }
    fn reason(v: ApprovalReason) -> u8 {
        match v {
            ApprovalReason::OperatorApproved => 0,
            ApprovalReason::OperatorDenied => 1,
        }
    }
    assert_eq!(
        (
            actor(ActorRef::Operator),
            scope(ApprovalScope::Once),
            reason(ApprovalReason::OperatorDenied)
        ),
        (0, 0, 1)
    );
    assert!(CommandId::try_from_uuid(Uuid::nil()).is_err());
    assert!(SessionId::try_from_uuid(Uuid::nil()).is_err());
    assert!(TurnId::try_from_uuid(Uuid::nil()).is_err());
    assert!(ApprovalId::try_from_uuid(Uuid::nil()).is_err());
    let ready = state(SessionStatus::Ready);
    let command = request(start());
    // Operator is merely a label: a proposal has no effect even when repeated.
    assert_eq!(
        decide_session_command_v1(&ready, &command).decision(),
        &proposed(&command, DomainEvent::TurnStarted { turn_id: turn() })
    );
    assert_eq!(ready.projection().unwrap().active_turn(), None);
}

#[test]
fn command_v1_canonical_bytes_cover_every_field() {
    let empty = SessionReducer::new(sid());
    for (payload, tag, bytes) in [
        (start(), "00", TURN_HEX),
        (cancel(), "02", TURN_HEX),
        (resolve(), "01", RESOLVE_APPROVED_HEX),
        (
            SessionCommand::ResolveApproval {
                turn_id: turn(),
                approval_id: approval(),
                decision: ApprovalDecision::Denied,
                scope: ApprovalScope::Once,
                reason: ApprovalReason::OperatorDenied,
            },
            "01",
            RESOLVE_DENIED_HEX,
        ),
    ] {
        for (version, encoded) in [
            (None, "000000000000000000"),
            (Some(0), "010000000000000000"),
            (Some(u64::MAX), "01ffffffffffffffff"),
        ] {
            let mut c = request(payload.clone());
            c.expected_version = version;
            assert_eq!(
                decide_session_command_v1(&empty, &c).canonical_command(),
                fixture(tag, bytes, encoded)
            );
        }
    }
    let original = request(resolve());
    let base = decide_session_command_v1(&empty, &original);
    let mut changes = Vec::new();
    let mut c = original.clone();
    c.command_id = CommandId::try_from_uuid(Uuid::from_u128(7)).unwrap();
    changes.push(c);
    let mut c = original.clone();
    c.session_id = SessionId::try_from_uuid(Uuid::from_u128(8)).unwrap();
    changes.push(c);
    let mut c = original.clone();
    c.expected_version = Some(0);
    changes.push(c);
    let mut c = original.clone();
    c.issued_at = Utc.timestamp_opt(2, 2).single().unwrap();
    changes.push(c);
    let mut c = original.clone();
    c.issued_at = Utc.timestamp_opt(1, 3).single().unwrap();
    changes.push(c);
    for index in 0..4 {
        let mut c = original.clone();
        if let SessionCommand::ResolveApproval {
            turn_id,
            approval_id,
            decision,
            reason,
            ..
        } = &mut c.payload
        {
            match index {
                0 => *turn_id = other_turn(),
                1 => *approval_id = other_approval(),
                2 => *decision = ApprovalDecision::Denied,
                _ => *reason = ApprovalReason::OperatorDenied,
            }
        }
        changes.push(c);
    }
    for c in changes {
        assert_ne!(
            decide_session_command_v1(&empty, &c).canonical_command(),
            base.canonical_command()
        );
    }
    // Actor and scope have one legal value; their exact zero bytes are asserted in the fixtures.
    assert_ne!(
        decide_session_command_v1(&empty, &request(start())).canonical_command(),
        decide_session_command_v1(&empty, &request(cancel())).canonical_command()
    );
}

#[test]
fn command_v1_canonical_bounds_and_timestamp_extrema() {
    let empty = SessionReducer::new(sid());
    let leap = Utc
        .timestamp_opt(1_483_228_799, 1_999_999_999)
        .single()
        .unwrap();
    for timestamp in [
        DateTime::<Utc>::MIN_UTC,
        DateTime::<Utc>::MAX_UTC,
        leap,
        time(),
    ] {
        for payload in [start(), resolve(), cancel()] {
            for version in [None, Some(0), Some(u64::MAX)] {
                let mut c = request(payload.clone());
                c.issued_at = timestamp;
                c.expected_version = version;
                let plan = decide_session_command_v1(&empty, &c);
                let b = plan.canonical_command();
                assert_eq!(
                    b.len(),
                    if matches!(payload, SessionCommand::ResolveApproval { .. }) {
                        96
                    } else {
                        77
                    }
                );
                assert_eq!(&b[..6], b"CBC1\x00\x01");
                assert_eq!(&b[6..22], cid().as_uuid().as_bytes());
                assert_eq!(&b[22..38], sid().as_uuid().as_bytes());
                assert_eq!(b[38], u8::from(version.is_some()));
                assert_eq!(
                    u64::from_be_bytes(b[39..47].try_into().unwrap()),
                    version.unwrap_or(0)
                );
                assert_eq!(b[47], 0);
                let seconds = i64::from_be_bytes(b[48..56].try_into().unwrap());
                let nanos = u32::from_be_bytes(b[56..60].try_into().unwrap());
                assert_eq!(
                    (seconds, nanos),
                    (timestamp.timestamp(), timestamp.timestamp_subsec_nanos())
                );
                assert_eq!(
                    Utc.timestamp_opt(seconds, nanos).single().unwrap(),
                    timestamp
                );
            }
        }
    }
    let equal = FixedOffset::east_opt(3600)
        .unwrap()
        .timestamp_opt(1, 2)
        .single()
        .unwrap()
        .with_timezone(&Utc);
    let mut c = request(start());
    c.issued_at = equal;
    assert_eq!(
        decide_session_command_v1(&empty, &c),
        decide_session_command_v1(&empty, &request(start()))
    );
}

#[test]
fn command_v1_decision_covers_all_states_and_commands() {
    // Independent 27-cell oracle, transcribed from A04 rather than planner predicates.
    let table = [
        ["W", "W", "W"],
        ["S", "W", "W"],
        ["T", "W", "C"],
        ["T", "R", "V"],
        ["T", "W", "N"],
        ["W", "W", "W"],
        ["W", "W", "W"],
        ["W", "W", "W"],
        ["A", "A", "A"],
    ];
    for (row, status) in STATUSES.into_iter().enumerate() {
        let s = state(status);
        for (column, (payload, kind)) in [
            (start(), CommandKind::StartTurn),
            (resolve(), CommandKind::ResolveApproval),
            (cancel(), CommandKind::CancelTurn),
        ]
        .into_iter()
        .enumerate()
        {
            let c = request(payload);
            let expected = match table[row][column] {
                "S" => proposed(&c, DomainEvent::TurnStarted { turn_id: turn() }),
                "R" => proposed(
                    &c,
                    DomainEvent::ApprovalResolved {
                        turn_id: turn(),
                        approval_id: approval(),
                        decision: ApprovalDecision::Approved,
                    },
                ),
                "C" => proposed(
                    &c,
                    DomainEvent::TurnCancellationRequested { turn_id: turn() },
                ),
                "N" => CommandDecision::Accepted { event: None },
                "T" => CommandDecision::Rejected(CommandRejection::TurnAlreadyRunning {
                    turn_id: turn(),
                }),
                "V" => CommandDecision::Rejected(
                    CommandRejection::CancellationRequiresVersionedAmendment,
                ),
                "A" => CommandDecision::Rejected(CommandRejection::SessionArchived),
                "W" => CommandDecision::Rejected(CommandRejection::WrongState {
                    command: kind,
                    state: status,
                }),
                _ => unreachable!(),
            };
            assert_eq!(
                decide_session_command_v1(&s, &c).decision(),
                &expected,
                "{status:?}/{kind:?}"
            );
        }
    }
    for payload in [start(), resolve(), cancel()] {
        rejected(
            &SessionReducer::new(sid()),
            &request(payload),
            CommandRejection::SessionNotFound,
        );
    }
}

#[test]
fn command_v1_rejection_precedence_is_exact() {
    let other_session = SessionId::try_from_uuid(Uuid::from_u128(9)).unwrap();
    // Check 1 with each co-reachable public check 2–8. Version/reason are independent fields;
    // identities are reachable only in R/C/N states. UUID/time order never overrides precedence.
    let cases = [
        (SessionReducer::new(sid()), resolve()),
        (state(SessionStatus::Archived), resolve()),
        (state(SessionStatus::Ready), start()),
        (state(SessionStatus::WaitingApproval), inconsistent()),
        (state(SessionStatus::Idle), cancel()),
        (
            state(SessionStatus::Running),
            SessionCommand::CancelTurn {
                turn_id: other_turn(),
            },
        ),
        (
            state(SessionStatus::WaitingApproval),
            SessionCommand::ResolveApproval {
                turn_id: turn(),
                approval_id: other_approval(),
                decision: ApprovalDecision::Approved,
                scope: ApprovalScope::Once,
                reason: ApprovalReason::OperatorApproved,
            },
        ),
    ];
    for (s, payload) in cases {
        let mut c = request(payload);
        c.session_id = other_session;
        c.expected_version = Some(u64::MAX);
        c.issued_at = DateTime::<Utc>::MIN_UTC;
        rejected(
            &s,
            &c,
            CommandRejection::WrongSession {
                expected: sid(),
                actual: other_session,
            },
        );
    }
    // 2<4,5 and 3<4,5. Absence and Archived cannot coexist: public apply installs
    // a projection at creation and never removes it. Overflow and other impossible pairs below.
    for (s, expected) in [
        (
            SessionReducer::new(sid()),
            CommandRejection::SessionNotFound,
        ),
        (
            state(SessionStatus::Archived),
            CommandRejection::SessionArchived,
        ),
    ] {
        let mut c = request(inconsistent());
        c.expected_version = Some(u64::MAX);
        rejected(&s, &c, expected);
    }
    // 4<5,6,7,8 (each individual identity/state failure plus a wrong version).
    for (s, payload) in [
        (state(SessionStatus::WaitingApproval), inconsistent()),
        (state(SessionStatus::Idle), start()),
        (
            state(SessionStatus::Running),
            SessionCommand::CancelTurn {
                turn_id: other_turn(),
            },
        ),
        (
            state(SessionStatus::WaitingApproval),
            SessionCommand::ResolveApproval {
                turn_id: turn(),
                approval_id: other_approval(),
                decision: ApprovalDecision::Approved,
                scope: ApprovalScope::Once,
                reason: ApprovalReason::OperatorApproved,
            },
        ),
    ] {
        let mut c = request(payload);
        c.expected_version = Some(u64::MAX);
        rejected(
            &s,
            &c,
            CommandRejection::ExpectedVersionConflict {
                expected: u64::MAX,
                actual: s.last_seq().value(),
            },
        );
    }
    // 5<6,7,8. Inconsistent carries both wrong identities; each is also varied separately.
    for status in [SessionStatus::Idle, SessionStatus::WaitingApproval] {
        for (t, a) in [
            (turn(), approval()),
            (other_turn(), approval()),
            (turn(), other_approval()),
            (other_turn(), other_approval()),
        ] {
            let mut c = request(inconsistent());
            if let SessionCommand::ResolveApproval {
                turn_id,
                approval_id,
                ..
            } = &mut c.payload
            {
                *turn_id = t;
                *approval_id = a;
            }
            rejected(&state(status), &c, CommandRejection::InvalidApprovalReason);
        }
    }
    // 7<8; exact payload assertions live in the identity test too.
    let c = request(SessionCommand::ResolveApproval {
        turn_id: other_turn(),
        approval_id: other_approval(),
        decision: ApprovalDecision::Approved,
        scope: ApprovalScope::Once,
        reason: ApprovalReason::OperatorApproved,
    });
    rejected(
        &state(SessionStatus::WaitingApproval),
        &c,
        CommandRejection::ActiveTurnMismatch {
            expected: Some(turn()),
            actual: other_turn(),
        },
    );
    // Unreachable simultaneous check failures: 2 with 3/6/7/8/9 (no projection);
    // 3 with 7/8/9 (Archived has no active turn or proposal); 6 with 7/8/9
    // (identity/exhaustion are gated by a permitting state rule). 8 exists only for R,
    // so cancellation/start cannot fail it. Check 9 and earlier max-head cases are unit-tested.
    assert!(SessionReducer::new(sid()).projection().is_none());
    for status in STATUSES {
        assert!(state(status).projection().is_some());
    }
    assert_eq!(
        state(SessionStatus::Archived)
            .projection()
            .unwrap()
            .active_turn(),
        None
    );
}

#[test]
fn command_v1_exact_turn_and_approval_identities_are_required() {
    for status in [SessionStatus::Running, SessionStatus::Cancelling] {
        rejected(
            &state(status),
            &request(SessionCommand::CancelTurn {
                turn_id: other_turn(),
            }),
            CommandRejection::ActiveTurnMismatch {
                expected: Some(turn()),
                actual: other_turn(),
            },
        );
    }
    for (t, a, expected) in [
        (
            other_turn(),
            approval(),
            CommandRejection::ActiveTurnMismatch {
                expected: Some(turn()),
                actual: other_turn(),
            },
        ),
        (
            turn(),
            other_approval(),
            CommandRejection::PendingApprovalMismatch {
                expected: Some(approval()),
                actual: other_approval(),
            },
        ),
        (
            other_turn(),
            other_approval(),
            CommandRejection::ActiveTurnMismatch {
                expected: Some(turn()),
                actual: other_turn(),
            },
        ),
    ] {
        rejected(
            &state(SessionStatus::WaitingApproval),
            &request(SessionCommand::ResolveApproval {
                turn_id: t,
                approval_id: a,
                decision: ApprovalDecision::Approved,
                scope: ApprovalScope::Once,
                reason: ApprovalReason::OperatorApproved,
            }),
            expected,
        );
    }
}

#[test]
fn command_v1_waiting_cancel_requires_amendment() {
    let s = state(SessionStatus::WaitingApproval);
    for t in [turn(), other_turn()] {
        rejected(
            &s,
            &request(SessionCommand::CancelTurn { turn_id: t }),
            CommandRejection::CancellationRequiresVersionedAmendment,
        );
        let event = DomainEventEnvelope {
            event_id: Uuid::from_u128(500),
            stream_id: sid(),
            seq: s.last_seq().checked_next().unwrap(),
            schema_version: 1,
            occurred_at: time(),
            causation_id: None,
            correlation_id: Uuid::from_u128(600),
            payload: DomainEvent::TurnCancellationRequested { turn_id: t },
        };
        assert_eq!(
            s.apply(&event),
            Err(SessionReducerError::InvalidTransition {
                state: SessionStatus::WaitingApproval,
                event: DomainEventKind::TurnCancellationRequested
            })
        );
    }
    assert_eq!(s.projection().unwrap().pending_approval(), Some(approval()));
}

#[test]
fn command_v1_accepted_events_match_existing_reducer() {
    for (status, payload, event_payload, result_status, pending) in [
        (
            SessionStatus::Ready,
            start(),
            DomainEvent::TurnStarted { turn_id: turn() },
            SessionStatus::Running,
            None,
        ),
        (
            SessionStatus::WaitingApproval,
            resolve(),
            DomainEvent::ApprovalResolved {
                turn_id: turn(),
                approval_id: approval(),
                decision: ApprovalDecision::Approved,
            },
            SessionStatus::Running,
            None,
        ),
        (
            SessionStatus::WaitingApproval,
            SessionCommand::ResolveApproval {
                turn_id: turn(),
                approval_id: approval(),
                decision: ApprovalDecision::Denied,
                scope: ApprovalScope::Once,
                reason: ApprovalReason::OperatorDenied,
            },
            DomainEvent::ApprovalResolved {
                turn_id: turn(),
                approval_id: approval(),
                decision: ApprovalDecision::Denied,
            },
            SessionStatus::Running,
            None,
        ),
        (
            SessionStatus::Running,
            cancel(),
            DomainEvent::TurnCancellationRequested { turn_id: turn() },
            SessionStatus::Cancelling,
            None,
        ),
    ] {
        let s = state(status);
        let before = s.clone();
        let mut c = request(payload);
        c.expected_version = Some(s.last_seq().value());
        c.issued_at = DateTime::<Utc>::MIN_UTC;
        let plan = decide_session_command_v1(&s, &c);
        assert_eq!(plan.decision(), &proposed(&c, event_payload.clone()));
        let CommandDecision::Accepted { event: Some(event) } = plan.decision() else {
            unreachable!()
        };
        let seq = s.last_seq().checked_next().unwrap();
        let output = s
            .apply(&DomainEventEnvelope {
                event_id: Uuid::from_u128(700),
                stream_id: sid(),
                seq,
                schema_version: event.schema_version,
                occurred_at: event.occurred_at,
                causation_id: event.causation_id,
                correlation_id: event.correlation_id,
                payload: event.payload.clone(),
            })
            .unwrap();
        let p = output.projection().unwrap();
        assert_eq!(
            (
                p.status(),
                p.active_turn(),
                p.pending_approval(),
                p.last_seq(),
                p.last_activity()
            ),
            (result_status, Some(turn()), pending, seq, c.issued_at)
        );
        assert_eq!(
            (p.session_id(), p.sandbox_id()),
            (sid(), s.projection().unwrap().sandbox_id())
        );
        assert_eq!(s, before);
    }
    assert_eq!(
        decide_session_command_v1(&state(SessionStatus::Cancelling), &request(cancel())).decision(),
        &CommandDecision::Accepted { event: None }
    );
    // A supplied old turn ID is legal again; this planner never reserves IDs.
    let ready_again = append(
        &state(SessionStatus::Running),
        DomainEvent::TurnCompleted { turn_id: turn() },
    );
    assert_eq!(
        decide_session_command_v1(&ready_again, &request(start())).decision(),
        &proposed(
            &request(start()),
            DomainEvent::TurnStarted { turn_id: turn() }
        )
    );
}

#[test]
fn command_v1_decision_is_deterministic_and_e0() {
    let mut s = state(SessionStatus::Ready);
    // Bounded deterministic generated legal histories including approval/deny/cancel/completion cycles.
    for cycle in 0..24 {
        for status in STATUSES {
            let fixture = state(status);
            for payload in [
                start(),
                resolve(),
                cancel(),
                inconsistent(),
                SessionCommand::CancelTurn {
                    turn_id: other_turn(),
                },
            ] {
                let mut c = request(payload);
                if cycle % 2 == 0 {
                    c.expected_version = Some(fixture.last_seq().value());
                }
                c.issued_at = Utc
                    .timestamp_opt(cycle - 12, (cycle as u32) * 123)
                    .single()
                    .unwrap();
                let before = (fixture.clone(), c.clone());
                let plan = decide_session_command_v1(&fixture, &c);
                assert_eq!(plan, decide_session_command_v1(&fixture, &c));
                assert_eq!((fixture.clone(), c.clone()), before);
                assert!(matches!(plan.canonical_command().len(), 77 | 96));
                std::thread::scope(|scope| {
                    let jobs: Vec<_> = (0..3)
                        .map(|_| scope.spawn(|| decide_session_command_v1(&fixture, &c)))
                        .collect();
                    for job in jobs {
                        assert_eq!(job.join().unwrap(), plan);
                    }
                });
            }
        }
        let c = request(start());
        let before = s.clone();
        let plan = decide_session_command_v1(&s, &c);
        assert_eq!(
            plan.decision(),
            &proposed(&c, DomainEvent::TurnStarted { turn_id: turn() })
        );
        assert_eq!(s, before);
        s = append(&s, DomainEvent::TurnStarted { turn_id: turn() });
        if cycle % 3 == 0 {
            s = append(
                &s,
                DomainEvent::ApprovalRequested {
                    turn_id: turn(),
                    approval_id: approval(),
                },
            );
            s = append(
                &s,
                DomainEvent::ApprovalResolved {
                    turn_id: turn(),
                    approval_id: approval(),
                    decision: if cycle % 2 == 0 {
                        ApprovalDecision::Approved
                    } else {
                        ApprovalDecision::Denied
                    },
                },
            );
        }
        if cycle % 2 == 0 {
            s = append(
                &s,
                DomainEvent::TurnCancellationRequested { turn_id: turn() },
            );
            s = append(&s, DomainEvent::TurnCancelled { turn_id: turn() });
        } else {
            s = append(&s, DomainEvent::TurnCompleted { turn_id: turn() });
        }
    }
}

#[test]
fn command_v1_rejections_and_debug_are_bounded() {
    let mut wrong_session = request(start());
    wrong_session.session_id = SessionId::try_from_uuid(Uuid::from_u128(9)).unwrap();
    let mut version = request(start());
    version.expected_version = Some(u64::MAX);
    let mut wrong_approval = request(resolve());
    if let SessionCommand::ResolveApproval { approval_id, .. } = &mut wrong_approval.payload {
        *approval_id = other_approval();
    }
    let cases = [
        (
            state(SessionStatus::Ready),
            wrong_session,
            CommandRejection::WrongSession {
                expected: sid(),
                actual: SessionId::try_from_uuid(Uuid::from_u128(9)).unwrap(),
            },
        ),
        (
            SessionReducer::new(sid()),
            request(start()),
            CommandRejection::SessionNotFound,
        ),
        (
            state(SessionStatus::Archived),
            request(start()),
            CommandRejection::SessionArchived,
        ),
        (
            state(SessionStatus::Ready),
            version,
            CommandRejection::ExpectedVersionConflict {
                expected: u64::MAX,
                actual: 2,
            },
        ),
        (
            state(SessionStatus::WaitingApproval),
            request(inconsistent()),
            CommandRejection::InvalidApprovalReason,
        ),
        (
            state(SessionStatus::Running),
            request(start()),
            CommandRejection::TurnAlreadyRunning { turn_id: turn() },
        ),
        (
            state(SessionStatus::WaitingApproval),
            request(cancel()),
            CommandRejection::CancellationRequiresVersionedAmendment,
        ),
        (
            state(SessionStatus::Idle),
            request(start()),
            CommandRejection::WrongState {
                command: CommandKind::StartTurn,
                state: SessionStatus::Idle,
            },
        ),
        (
            state(SessionStatus::Running),
            request(SessionCommand::CancelTurn {
                turn_id: other_turn(),
            }),
            CommandRejection::ActiveTurnMismatch {
                expected: Some(turn()),
                actual: other_turn(),
            },
        ),
        (
            state(SessionStatus::WaitingApproval),
            wrong_approval,
            CommandRejection::PendingApprovalMismatch {
                expected: Some(approval()),
                actual: other_approval(),
            },
        ),
    ];
    for (s, c, expected) in cases {
        rejected(&s, &c, expected.clone());
        let text = format!("{expected} {expected:?}");
        assert!(text.len() < 300);
        for forbidden in [
            "authorized",
            "authenticated",
            "durable success",
            "credential",
            "token=",
            "secret",
            "http://",
            "../",
        ] {
            assert!(!text.contains(forbidden));
        }
    }
    // Eleventh rejection must be triggered in private overflow test, not a public forged state.
}

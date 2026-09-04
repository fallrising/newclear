//! A0-3 acceptance: every `WriteCommand` variant must carry an `origin` field
//! in its serialized form. The compile-time check already lives in the struct
//! definitions (each variant explicitly destructures `origin: Origin`); this
//! test catches regressions if someone adds a variant via `#[serde(skip)]` or
//! a future Default-deriving shortcut.

use loom_contracts::*;
use serde_json::Value;

fn assert_origin_present(label: &str, cmd: &WriteCommand) {
    let v: Value = serde_json::to_value(cmd).expect("serialize WriteCommand");
    assert!(
        v.get("origin").is_some(),
        "WriteCommand::{label} missing `origin` in serialized form: {v}"
    );
}

#[test]
fn every_write_command_carries_origin() {
    let origin = Origin::User;
    let sid = SessionId("s1".into());
    let nid = NodeId("n1".into());
    let eid = EdgeId("e1".into());

    let cases: Vec<(&str, WriteCommand)> = vec![
        (
            "SpawnPty",
            WriteCommand::SpawnPty {
                origin: origin.clone(),
                cwd: "/".into(),
                cmd: None,
                shell: None,
            },
        ),
        (
            "KillPty",
            WriteCommand::KillPty {
                origin: origin.clone(),
                session_id: sid.clone(),
            },
        ),
        (
            "ResizePty",
            WriteCommand::ResizePty {
                origin: origin.clone(),
                session_id: sid.clone(),
                cols: 80,
                rows: 24,
            },
        ),
        (
            "AttachSessionView",
            WriteCommand::AttachSessionView {
                origin: origin.clone(),
                session_id: sid.clone(),
            },
        ),
        (
            "DetachSessionView",
            WriteCommand::DetachSessionView {
                origin: origin.clone(),
                session_id: sid.clone(),
            },
        ),
        (
            "WriteDocument",
            WriteCommand::WriteDocument {
                origin: origin.clone(),
                path: "a.md".into(),
                content: "x".into(),
                expected_hash: None,
            },
        ),
        (
            "CreateNode",
            WriteCommand::CreateNode {
                origin: origin.clone(),
                node_kind: NodeKind::Document {
                    path: "a.md".into(),
                },
                x: 0.0,
                y: 0.0,
            },
        ),
        (
            "UpdateNodePosition",
            WriteCommand::UpdateNodePosition {
                origin: origin.clone(),
                node_id: nid.clone(),
                x: 1.0,
                y: 2.0,
            },
        ),
        (
            "DeleteNode",
            WriteCommand::DeleteNode {
                origin: origin.clone(),
                node_id: nid.clone(),
            },
        ),
        (
            "CreateEdge",
            WriteCommand::CreateEdge {
                origin: origin.clone(),
                from: nid.clone(),
                to: nid.clone(),
                edge_kind: EdgeKind::Triggers,
            },
        ),
        (
            "DeleteEdge",
            WriteCommand::DeleteEdge {
                origin: origin.clone(),
                edge_id: eid.clone(),
            },
        ),
        (
            "InjectCommand",
            WriteCommand::InjectCommand {
                origin: origin.clone(),
                target: sid.clone(),
                command: "ls".into(),
            },
        ),
    ];

    for (label, cmd) in &cases {
        assert_origin_present(label, cmd);
    }
}

#[test]
fn origin_round_trip_all_kinds() {
    for o in [
        Origin::User,
        Origin::Ai,
        Origin::Remote,
        Origin::Plugin { id: "inbox".into() },
    ] {
        let s = serde_json::to_string(&o).unwrap();
        let back: Origin = serde_json::from_str(&s).unwrap();
        assert_eq!(o, back, "Origin round-trip lost data: {s}");
    }
}

#[test]
fn three_edge_kinds_present() {
    use EdgeKind::*;
    let all = [Triggers, FeedsOutputTo, ContextFor];
    for k in all {
        let s = serde_json::to_string(&k).unwrap();
        let back: EdgeKind = serde_json::from_str(&s).unwrap();
        assert_eq!(k, back);
    }
}

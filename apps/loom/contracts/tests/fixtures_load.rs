//! A0-7 acceptance: every contract-shaped fixture must deserialize cleanly
//! into the contracts crate's types. If a contract changes without updating
//! the fixtures, these tests fail and block downstream tracks (by design).

use std::fs;
use std::path::PathBuf;

use loom_contracts::{
    AgentStatusKind, AiChunk, Edge, EdgeKind, Event, FsChangeKind, NodeKind, Origin,
    PluginManifest, PluginPermission, PtyBatch, ReadCommand, SessionMeta, SessionState,
    TombstoneSubject, WriteCommand,
};
use serde::{Deserialize, Serialize};

fn fixture(rel: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../fixtures")
        .join(rel)
}

#[derive(Deserialize, Serialize)]
struct CanvasSidecar {
    version: u32,
    nodes: Vec<SidecarNode>,
    edges: Vec<Edge>,
}

#[derive(Deserialize, Serialize)]
struct SidecarNode {
    id: loom_contracts::NodeId,
    kind: NodeKind,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    group: Option<String>,
}

#[test]
fn canvas_basic_loads() {
    let raw = fs::read_to_string(fixture("canvas/basic.json")).expect("read basic.json");
    let s: CanvasSidecar = serde_json::from_str(&raw).expect("deserialize basic.json");
    assert_eq!(s.version, 1);
    assert_eq!(s.nodes.len(), 3);
    assert_eq!(s.edges.len(), 3);

    // One of each edge kind is present.
    let kinds: Vec<EdgeKind> = s.edges.iter().map(|e| e.kind.clone()).collect();
    assert!(kinds.contains(&EdgeKind::Triggers));
    assert!(kinds.contains(&EdgeKind::FeedsOutputTo));
    assert!(kinds.contains(&EdgeKind::ContextFor));

    // Tombstone carries restart metadata.
    let has_tombstone_terminal = s.nodes.iter().any(|n| {
        matches!(
            &n.kind,
            NodeKind::Tombstone {
                was: TombstoneSubject::Terminal { .. },
                ..
            }
        )
    });
    assert!(
        has_tombstone_terminal,
        "expected at least one tombstone node"
    );
}

#[test]
fn canvas_stress_has_more_than_ten_nodes() {
    let raw = fs::read_to_string(fixture("canvas/stress-12-nodes.json")).expect("read stress");
    let s: CanvasSidecar = serde_json::from_str(&raw).expect("deserialize stress");
    assert!(
        s.nodes.len() > 10,
        "C3 stress fixture must exceed 10 nodes; got {}",
        s.nodes.len()
    );
    assert_eq!(s.edges.len(), 12);
}

#[test]
fn edges_all_three_kinds_loads() {
    let raw =
        fs::read_to_string(fixture("edges/all-three-kinds.json")).expect("read edges fixture");
    let edges: Vec<Edge> = serde_json::from_str(&raw).expect("deserialize edges");
    assert_eq!(edges.len(), 3);
    let kinds: Vec<EdgeKind> = edges.iter().map(|e| e.kind.clone()).collect();
    for k in [
        EdgeKind::Triggers,
        EdgeKind::FeedsOutputTo,
        EdgeKind::ContextFor,
    ] {
        assert!(kinds.contains(&k), "missing edge kind {k:?}");
    }
}

#[test]
fn plugin_manifest_inbox_loads() {
    let raw = fs::read_to_string(fixture("plugin_manifest/inbox.json")).expect("read manifest");
    let m: PluginManifest = serde_json::from_str(&raw).expect("deserialize manifest");
    assert_eq!(m.id.0, "inbox");
    assert!(
        m.mcp.is_some(),
        "inbox plugin manifest declares an MCP backend"
    );
    assert!(m.subscribes.iter().any(|t| t == "plugin:inbox:item"));
    assert!(m.permissions.contains(&PluginPermission::ReadDocument));
}

#[test]
fn pty_stream_jsonl_loads_per_line() {
    let raw = fs::read_to_string(fixture("pty_stream/example.jsonl")).expect("read jsonl");
    let batches: Vec<PtyBatch> = raw
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("parse PtyBatch line"))
        .collect();
    assert_eq!(batches.len(), 4);

    // D-2: flood batch records dropped frames; non-flood batches do not.
    let dropped: Vec<u32> = batches.iter().map(|b| b.dropped_old).collect();
    assert_eq!(dropped, vec![0, 0, 0, 42]);
}

#[test]
fn fs_events_four_scenarios_load() {
    let raw = fs::read_to_string(fixture("fs_events/four-scenarios.json")).expect("read scenarios");
    let v: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let scenarios = v.as_object().expect("object root");
    assert_eq!(scenarios.len(), 4, "B2 needs all four echo-loop scenarios");

    // Every event inside each scenario must deserialize as an Event::FsChanged
    // when the loader strips the `_note_for_b2` debug field.
    for (name, arr) in scenarios {
        for raw_event in arr.as_array().expect("array per scenario") {
            let mut e = raw_event.clone();
            e.as_object_mut().unwrap().remove("_note_for_b2");
            let parsed: Event =
                serde_json::from_value(e).unwrap_or_else(|err| panic!("scenario {name}: {err}"));
            assert!(matches!(parsed, Event::FsChanged { .. }));
        }
    }
}

#[test]
fn document_fixture_has_block_id_and_run_in() {
    let body = fs::read_to_string(fixture("documents/with-runnable-block.md")).expect("read doc");
    assert!(
        body.contains("run_in:"),
        "C2 fixture must include run_in frontmatter (D-6)"
    );
    assert!(
        body.contains("^plan-2026-q2"),
        "C2 fixture must define a ^block-id (D-9)"
    );
    assert!(
        body.contains("[[result-summary.md#^last-build]]"),
        "C2 fixture must reference a block-id (D-9)"
    );
    assert!(
        body.contains("```bash run"),
        "C2 fixture must include a runnable block (§5.2)"
    );
}

#[test]
fn smoke_construct_one_of_each_contract_type() {
    // Belt-and-suspenders: every public type in contracts is constructible
    // and serde-roundtrippable.
    let origin = Origin::Plugin { id: "inbox".into() };
    let _: String = serde_json::to_string(&origin).unwrap();

    let cmd = WriteCommand::InjectCommand {
        origin: origin.clone(),
        target: loom_contracts::SessionId("s".into()),
        command: "ls".into(),
    };
    let _: String = serde_json::to_string(&cmd).unwrap();

    let _: String = serde_json::to_string(&ReadCommand::ListNodes).unwrap();
    let _: String = serde_json::to_string(&AiChunk::Done {
        stream_id: loom_contracts::StreamId("x".into()),
    })
    .unwrap();
    let _: String = serde_json::to_string(&FsChangeKind::Created).unwrap();
    let _: String = serde_json::to_string(&AgentStatusKind::Idle).unwrap();
    let _: String = serde_json::to_string(&SessionState::Spawning).unwrap();
    let _: String = serde_json::to_string(&SessionMeta {
        id: loom_contracts::SessionId("s".into()),
        cwd: "/".into(),
        cmd: None,
        shell: "zsh".into(),
        state: SessionState::Active,
        last_activity_ms: 0,
    })
    .unwrap();
}

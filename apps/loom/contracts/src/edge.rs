//! Three edge kinds drive the entire Edge Router (TDD §6).
//! D-6: `run_in:` frontmatter is declarative sugar — document loader materializes
//! a `RunInDirective` into a `Triggers` edge at load time; runtime only sees edges.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::{EdgeId, NodeId};

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(rename_all = "snake_case")]
pub enum EdgeKind {
    /// runnable block → terminal. `run_in:` frontmatter materializes into this.
    Triggers,
    /// terminal → document. Pin-output target.
    FeedsOutputTo,
    /// terminal | document → AI call site. Explicit override of viewport heuristic.
    ContextFor,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct Edge {
    pub id: EdgeId,
    pub from: NodeId,
    pub to: NodeId,
    pub kind: EdgeKind,
}

/// D-6 reserved type. The document loader (C2/E0 territory) reads
/// `run_in: <node-id>` frontmatter and materializes it into an `Edge {
/// kind: Triggers, from: doc_node, to: target_node }`. Runtime callers
/// (C4 Edge Router) only ever read materialized edges.
#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct RunInDirective {
    pub doc_node: NodeId,
    pub target_node: NodeId,
}

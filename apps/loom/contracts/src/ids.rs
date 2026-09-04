//! Typed string-newtype identifiers. Keeps callers from passing a NodeId where
//! a SessionId is expected, at near-zero runtime cost.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct SessionId(pub String);

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct NodeId(pub String);

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct EdgeId(pub String);

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct StreamId(pub String);

/// D-9: Obsidian-compatible `^block-id`. Stored without the caret.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct BlockId(pub String);

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct PluginId(pub String);

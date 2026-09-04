//! D-10: plugin = frontend bundle (required) + MCP backend (optional).
//! Core opens no back door for plugins. Real-world capabilities (fs, net,
//! external services) flow through the existing MCP permission model.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::ids::PluginId;

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct PluginManifest {
    pub id: PluginId,
    pub name: String,
    pub version: String,
    /// Path (relative to plugin dir) to the frontend entry bundle.
    pub frontend: String,
    pub mcp: Option<McpBackend>,
    /// `plugin:<id>:<topic>` channels this plugin subscribes to (D-11).
    pub subscribes: Vec<String>,
    /// Declared upfront; write categories still pass the approve gate at runtime.
    pub permissions: Vec<PluginPermission>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone)]
#[ts(export, export_to = "../../src/contracts/")]
pub struct McpBackend {
    pub command: String,
    pub args: Vec<String>,
}

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(rename_all = "snake_case")]
pub enum PluginPermission {
    ReadDocument,
    ReadCanvas,
    WriteDocument,
    WriteCanvas,
    InjectCommand,
}

/// §12.3: v1 publicly opens only the three extension points needed to
/// build Inbox (D2). Other points are recorded but not callable in v1.
#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(rename_all = "snake_case")]
pub enum ExtensionPoint {
    UiPanel,
    EventSubscription,
    McpBackend,
}

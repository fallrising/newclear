//! Loom IPC contract types — single source of truth for Rust↔TS.
//!
//! Frozen as of A0 (see FREEZE.md). Any change requires a Contract Change RFC
//! (see 01-collaboration-protocol.md §6).
//!
//! The three IPC forms (TDD §3.2):
//!   - `command::WriteCommand` / `command::ReadCommand` — TS → Rust, req/resp.
//!   - `event::Event`                                   — Rust → TS, push.
//!   - `stream::PtyBatch` / `stream::AiChunk`           — bidirectional, stream-id keyed.

pub mod command;
pub mod edge;
pub mod event;
pub mod ids;
pub mod node;
pub mod origin;
pub mod plugin;
pub mod session;
pub mod stream;

pub use command::{ReadCommand, WriteCommand};
pub use edge::{Edge, EdgeKind, RunInDirective};
pub use event::{AgentStatusKind, Event, FsChangeKind};
pub use ids::{BlockId, EdgeId, NodeId, PluginId, SessionId, StreamId};
pub use node::{Node, NodeKind, TombstoneSubject};
pub use origin::Origin;
pub use plugin::{ExtensionPoint, McpBackend, PluginManifest, PluginPermission};
pub use session::{SessionMeta, SessionState};
pub use stream::{AiChunk, PtyBatch};

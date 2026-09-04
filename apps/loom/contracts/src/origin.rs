//! D-3: every state-changing Command carries an Origin.
//! Common basis for the approve gate (B3), audit log, and fs echo-loop detection (D-7).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Serialize, Deserialize, TS, Debug, Clone, PartialEq, Eq, Hash)]
#[ts(export, export_to = "../../src/contracts/")]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Origin {
    User,
    Ai,
    Remote,
    Plugin { id: String },
}

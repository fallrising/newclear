use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Empty single-object request used by commands with no input fields.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
pub struct EmptyRequest {}

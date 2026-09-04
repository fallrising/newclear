use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use ts_rs::TS;

/// Stable machine-readable application error codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AppErrorCode {
    ValidationError,
    NotFound,
    Conflict,
    PathOutsideWorkspace,
    SymlinkForbidden,
    UnsupportedEncoding,
    DocumentTooLarge,
    AssetTooLarge,
    UnsupportedMediaType,
    ExportPathForbidden,
    RenderModelMismatch,
    UnsupportedModelVersion,
    IoError,
    DbError,
    MigrationError,
    Internal,
}

/// Safe error payload returned at the command boundary.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct AppErrorDto {
    pub code: AppErrorCode,
    pub message: String,
    pub retryable: bool,
    pub correlation_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[ts(optional, type = "Record<string, unknown>")]
    pub details: Option<BTreeMap<String, Value>>,
}

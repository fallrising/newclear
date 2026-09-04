use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{CommandContract, EmptyRequest};

/// Build metadata exposed by the desktop adapter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfoDto {
    pub version: String,
    pub git_sha: String,
    pub build_profile: String,
}

/// Type-level descriptor for the first Flowshot command.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GetBuildInfo;

impl CommandContract for GetBuildInfo {
    const NAME: &'static str = "get_build_info";
    type Request = EmptyRequest;
    type Response = BuildInfoDto;
}

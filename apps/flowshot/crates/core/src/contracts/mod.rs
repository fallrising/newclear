//! Rust-authoritative command contracts shared by every adapter.

mod build_info;
mod common;
mod error;

use serde::Serialize;
use ts_rs::{Config, TS};

pub use build_info::{BuildInfoDto, GetBuildInfo};
pub use common::EmptyRequest;
pub use error::{AppErrorCode, AppErrorDto};

/// Static command metadata consumed by contract generators and boundary checks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandDescriptor {
    pub name: &'static str,
    pub request_type: String,
    pub response_type: String,
}

/// Associates a stable command name with its single-object request and response.
pub trait CommandContract {
    const NAME: &'static str;
    type Request: Serialize + TS;
    type Response: Serialize + TS;

    #[must_use]
    fn descriptor(config: &Config) -> CommandDescriptor {
        CommandDescriptor {
            name: Self::NAME,
            request_type: Self::Request::name(config),
            response_type: Self::Response::name(config),
        }
    }
}

/// Returns every command in deterministic name order.
#[must_use]
pub fn command_descriptors(config: &Config) -> Vec<CommandDescriptor> {
    let mut commands = vec![GetBuildInfo::descriptor(config)];
    commands.sort_by(|left, right| left.name.cmp(right.name));
    commands
}

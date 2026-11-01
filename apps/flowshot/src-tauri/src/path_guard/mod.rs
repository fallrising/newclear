//! Handle-relative, no-follow workspace I/O. No validated path is reopened ambiently.
#![allow(clippy::wildcard_imports)]
use crate::workspace::{Result, error};
use flowshot_core::contracts::{AppErrorCode, direct_components};
#[cfg(unix)]
mod unix;
#[cfg(unix)]
pub(crate) use unix::{Guard, Stamp, retained_entries};
#[cfg(unix)]
pub use unix::{IoTrace, take_io_trace};
#[cfg(not(unix))]
mod unavailable {
    use super::*;
    pub(crate) struct Guard;
    impl Guard {
        pub fn open(_path: &std::path::Path) -> Result<Self> {
            Err(error(AppErrorCode::IoError, false))
        }
    }
}
#[cfg(not(unix))]
pub(crate) use unavailable::*;

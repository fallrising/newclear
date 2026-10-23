//! Typed blocking workspace service. Native async commands enter via `spawn_blocking`.
#![allow(
    clippy::missing_errors_doc,
    clippy::must_use_candidate,
    clippy::module_name_repetitions,
    clippy::wildcard_imports
)]
use flowshot_core::contracts::*;
use flowshot_db::{DbError, ErrorCode};
pub type Result<T> = std::result::Result<T, AppErrorDto>;
pub(crate) fn error(code: AppErrorCode, retryable: bool) -> AppErrorDto {
    AppErrorDto {
        code,
        message: match code {
            AppErrorCode::NotFound => "The document or directory is unavailable.",
            AppErrorCode::SymlinkForbidden => "Symbolic links cannot be opened.",
            AppErrorCode::PathOutsideWorkspace => "The path is outside the selected root.",
            AppErrorCode::DocumentTooLarge => "The document exceeds 20 MiB.",
            AppErrorCode::AssetTooLarge => "The image exceeds 10 MiB.",
            AppErrorCode::Conflict => "The directory changed; reload this page.",
            AppErrorCode::UnsupportedEncoding => "Only UTF-8 documents are supported.",
            AppErrorCode::UnsupportedMediaType => {
                "Only PNG, JPEG, GIF and WebP images are supported."
            }
            _ => "Workspace operation could not be completed.",
        }
        .into(),
        retryable,
        correlation_id: String::new(),
        details: None,
    }
}
pub(crate) fn db_error(e: DbError) -> AppErrorDto {
    error(
        match e.code {
            ErrorCode::NotFound => AppErrorCode::NotFound,
            ErrorCode::Conflict => AppErrorCode::Conflict,
            ErrorCode::Validation => AppErrorCode::ValidationError,
            _ => AppErrorCode::DbError,
        },
        matches!(
            e.code,
            ErrorCode::Busy | ErrorCode::Overload | ErrorCode::Conflict
        ),
    )
}
#[cfg(unix)]
pub use crate::path_guard::{IoTrace, take_io_trace};
#[cfg(unix)]
mod service;
#[cfg(unix)]
pub use service::WorkspaceService;
#[cfg(not(unix))]
mod unavailable {
    use super::*;
    use flowshot_db::DbRuntime;
    pub struct WorkspaceService<'a> {
        db: &'a DbRuntime,
    }
    impl<'a> WorkspaceService<'a> {
        pub fn new(db: &'a DbRuntime) -> Self {
            Self { db }
        }
        pub fn list_workspaces(&self, _request: ListWorkspacesRequest) -> Result<WorkspacePage> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn create_workspace(&self, _request: CreateWorkspaceRequest) -> Result<WorkspaceDto> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn add_root(&self, _request: AddWorkspaceRootRequest) -> Result<RootDto> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn detach_root(&self, _request: DetachWorkspaceRootRequest) -> Result<RootDto> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn list_directory(&self, _request: ListDirectoryRequest) -> Result<DirectoryPage> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn open_document(&self, _request: OpenDocumentRequest) -> Result<OpenDocumentResponse> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn resolve_link(
            &self,
            _request: ResolveLocalDocumentLinkRequest,
        ) -> Result<ResolvedDocumentLink> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn read_asset(&self, _request: ReadWorkspaceAssetRequest) -> Result<Vec<u8>> {
            Err(error(AppErrorCode::Internal, false))
        }
        pub fn recent_documents(
            &self,
            _request: ListRecentDocumentsRequest,
        ) -> Result<RecentDocumentsPage> {
            Err(error(AppErrorCode::Internal, false))
        }
    }
}
#[cfg(not(unix))]
pub use unavailable::WorkspaceService;
/// Native binary success framing; errors remain the normal `AppErrorDto`.
pub fn binary_asset_response(bytes: Vec<u8>) -> tauri::ipc::Response {
    tauri::ipc::Response::new(bytes)
}

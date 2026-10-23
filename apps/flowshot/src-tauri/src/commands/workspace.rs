//! All filesystem/database work is dispatched off the async runtime.
#![allow(clippy::missing_errors_doc, clippy::wildcard_imports)]
use crate::workspace::{Result, WorkspaceService, error};
use flowshot_core::contracts::*;
use flowshot_db::DbRuntime;
use std::{
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};
use tauri::{AppHandle, Manager, Runtime};
static SEQUENCE: AtomicU64 = AtomicU64::new(1);
async fn run<R: Runtime, T: Send + 'static>(
    app: AppHandle<R>,
    name: &'static str,
    f: impl FnOnce(&WorkspaceService<'_>) -> Result<T> + Send + 'static,
    metrics: impl FnOnce(&T) -> serde_json::Value + Send + 'static,
) -> Result<T> {
    tauri::async_runtime::spawn_blocking(move||{let start=Instant::now();let correlation=format!("flowshot-{}-{}",std::process::id(),SEQUENCE.fetch_add(1,Ordering::Relaxed));let result=app.try_state::<DbRuntime>().ok_or_else(||error(AppErrorCode::DbError,false)).and_then(|db|f(&WorkspaceService::new(db.inner()))).map_err(|mut e|{e.correlation_id.clone_from(&correlation);e});let code=result.as_ref().map_or_else(|e|serde_json::to_value(e.code).unwrap_or_default(),|_|serde_json::json!("OK"));let details=result.as_ref().map_or_else(|_|serde_json::json!({}),metrics);println!("{}",serde_json::json!({"event":"command_complete","command":name,"correlationId":correlation,"durationMs":start.elapsed().as_millis(),"resultCode":code,"metrics":details}));result}).await.map_err(|_|error(AppErrorCode::Internal,false))?
}
macro_rules! command {
    ($name:ident,$request:ty,$response:ty,$method:ident) => {
        #[tauri::command]
        pub async fn $name<R: Runtime>(app: AppHandle<R>, request: $request) -> Result<$response> {
            run(
                app,
                stringify!($name),
                move |service| service.$method(request),
                |_| serde_json::json!({}),
            )
            .await
        }
    };
}
command!(
    list_workspaces,
    ListWorkspacesRequest,
    WorkspacePage,
    list_workspaces
);
command!(
    create_workspace,
    CreateWorkspaceRequest,
    WorkspaceDto,
    create_workspace
);
#[tauri::command]
pub async fn add_workspace_root<R: Runtime>(
    app: AppHandle<R>,
    request: AddWorkspaceRootRequest,
) -> Result<RootDto> {
    let grant_app = app.clone();
    run(
        app,
        "add_workspace_root",
        move |service| {
            require_picker_grant(&grant_app, &request.selected_path)?;
            service.add_root(request)
        },
        |_| serde_json::json!({}),
    )
    .await
}
fn require_picker_grant<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<()> {
    use tauri_plugin_fs::FsExt;
    let scope = app
        .try_fs_scope()
        .ok_or_else(|| error(AppErrorCode::PathOutsideWorkspace, false))?;
    if !scope.is_allowed(path) {
        return Err(error(AppErrorCode::PathOutsideWorkspace, false));
    }
    Ok(())
}
command!(
    detach_workspace_root,
    DetachWorkspaceRootRequest,
    RootDto,
    detach_root
);
command!(
    resolve_local_document_link,
    ResolveLocalDocumentLinkRequest,
    ResolvedDocumentLink,
    resolve_link
);
command!(
    list_recent_documents,
    ListRecentDocumentsRequest,
    RecentDocumentsPage,
    recent_documents
);
#[tauri::command]
pub async fn list_directory<R: Runtime>(
    app: AppHandle<R>,
    request: ListDirectoryRequest,
) -> Result<DirectoryPage> {
    run(app,"list_directory",move|service|service.list_directory(request),|page|serde_json::json!({"entryCount":page.entries.len(),"visibleCount":page.visible_count,"truncated":page.truncated})).await
}
#[tauri::command]
pub async fn open_document<R: Runtime>(
    app: AppHandle<R>,
    request: OpenDocumentRequest,
) -> Result<OpenDocumentResponse> {
    run(app,"open_document",move|service|service.open_document(request),|reply|serde_json::json!({"bytes":reply.source.len(),"hashPrefix":&reply.observed_source_hash[..12]})).await
}
#[tauri::command]
pub async fn read_workspace_asset<R: Runtime>(
    app: AppHandle<R>,
    request: ReadWorkspaceAssetRequest,
) -> Result<tauri::ipc::Response> {
    let bytes = run(
        app,
        "read_workspace_asset",
        move |service| service.read_asset(request),
        |bytes| serde_json::json!({"bytes":bytes.len()}),
    )
    .await?;
    Ok(crate::workspace::binary_asset_response(bytes))
}

#[cfg(test)]
mod grant_tests {
    use super::*;
    use tauri_plugin_fs::FsExt;
    fn directory() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("picker-{}", uuid::Uuid::now_v7()));
        std::fs::create_dir(&path).unwrap();
        path
    }
    #[test]
    fn native_picker_scope_denies_unknown_paths_and_admits_granted_directory() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let selected = directory();
        assert!(require_picker_grant(app.handle(), selected.to_str().unwrap()).is_err());
        app.fs_scope().allow_directory(&selected, false).unwrap();
        require_picker_grant(app.handle(), selected.to_str().unwrap()).unwrap();
        let unrelated = directory();
        assert!(require_picker_grant(app.handle(), unrelated.to_str().unwrap()).is_err());
    }
    #[test]
    fn absent_picker_scope_fails_closed_and_capability_has_no_fs_permissions() {
        let app = tauri::test::mock_builder()
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        assert!(require_picker_grant(app.handle(), "/unknown").is_err());
        let capability: serde_json::Value = serde_json::from_str(include_str!(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/capabilities/main.json"
        )))
        .unwrap();
        assert!(
            capability["permissions"]
                .as_array()
                .unwrap()
                .iter()
                .all(|permission| !permission.as_str().unwrap().starts_with("fs:"))
        );
    }
}

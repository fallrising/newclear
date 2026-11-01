mod commands;
mod db;
mod path_guard;
pub mod workspace;

/// Runs the Flowshot desktop application.
///
/// # Panics
///
/// Panics if Tauri cannot initialize or run the native application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            db::initialize(app)?;
            let main = app
                .config()
                .app
                .windows
                .iter()
                .find(|window| window.label == "main")
                .ok_or_else(|| std::io::Error::other("main window configuration missing"))?;
            tauri::WebviewWindowBuilder::from_config(app, main)?.build()?;
            Ok(())
        })
        .append_invoke_initialization_script(commands::build_info::BUILD_INFO_INITIALIZATION_SCRIPT)
        .invoke_handler(tauri::generate_handler![
            commands::build_info::get_build_info,
            commands::workspace::list_workspaces,
            commands::workspace::create_workspace,
            commands::workspace::add_workspace_root,
            commands::workspace::detach_workspace_root,
            commands::workspace::list_directory,
            commands::workspace::open_document,
            commands::workspace::resolve_local_document_link,
            commands::workspace::read_workspace_asset,
            commands::workspace::list_recent_documents
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Flowshot");
}

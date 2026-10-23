mod commands;
mod db;

/// Runs the Flowshot desktop application.
///
/// # Panics
///
/// Panics if Tauri cannot initialize or run the native application.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            commands::build_info::get_build_info
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Flowshot");
}

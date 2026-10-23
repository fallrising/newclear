use std::{error::Error, fs, io, time::Instant};

use flowshot_db::DbRuntime;
use tauri::{App, Manager, Runtime};

/// Runs in Tauri's synchronous setup hook, before creating any webview.
/// The DB crate owns the executor, `SQLite` connections and migrations.
pub(crate) fn initialize<R: Runtime>(app: &App<R>) -> Result<(), Box<dyn Error>> {
    let started = Instant::now();
    let directory = app.path().app_data_dir()?;
    fs::create_dir_all(&directory)?;
    let runtime = DbRuntime::open(&directory.join("flowshot.sqlite3"))
        .map_err(|_| io::Error::other("database initialization failed"))?;
    app.manage(runtime);
    println!(
        "{}",
        serde_json::json!({
            "event": "database_ready",
            "durationMs": started.elapsed().as_millis(),
            "resultCode": "OK",
        })
    );
    Ok(())
}

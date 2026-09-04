use std::{
    io::{self, Write},
    process,
    sync::atomic::{AtomicU64, Ordering},
    time::Instant,
};

use flowshot_core::contracts::{AppErrorDto, BuildInfoDto, EmptyRequest};
use serde_json::{Value, json};

static NEXT_CORRELATION_ID: AtomicU64 = AtomicU64::new(1);

pub(crate) const BUILD_INFO_INITIALIZATION_SCRIPT: &str = r#";
(() => {
  const promise = window.__TAURI_INTERNALS__.invoke(
    "get_build_info",
    { request: {} }
  );
  void promise.catch(() => undefined);
  Object.defineProperty(window, "__FLOWSHOT_BUILD_INFO_PROMISE__", {
    value: promise
  });
})();
"#;

#[tauri::command]
#[allow(
    clippy::unnecessary_wraps,
    reason = "every frozen command returns Result<Response, AppErrorDto>"
)]
pub fn get_build_info(request: EmptyRequest) -> Result<BuildInfoDto, AppErrorDto> {
    let _ = request;
    let started_at = Instant::now();
    let correlation_id = next_correlation_id();
    let response = build_info();
    let duration_ms = u64::try_from(started_at.elapsed().as_millis()).unwrap_or(u64::MAX);
    let log = command_completion_log(&response, &correlation_id, duration_ms);

    drop(write_command_completion_log(&log));

    Ok(response)
}

fn build_info() -> BuildInfoDto {
    BuildInfoDto {
        version: env!("CARGO_PKG_VERSION").into(),
        git_sha: env!("FLOWSHOT_GIT_SHA").into(),
        build_profile: env!("FLOWSHOT_BUILD_PROFILE").into(),
    }
}

fn next_correlation_id() -> String {
    let sequence = NEXT_CORRELATION_ID.fetch_add(1, Ordering::Relaxed);
    format!("flowshot-{}-{sequence}", process::id())
}

fn command_completion_log(
    response: &BuildInfoDto,
    correlation_id: &str,
    duration_ms: u64,
) -> Value {
    json!({
        "event": "command_complete",
        "command": "get_build_info",
        "correlationId": correlation_id,
        "durationMs": duration_ms,
        "resultCode": "OK",
        "buildInfo": response,
    })
}

fn write_command_completion_log(log: &Value) -> io::Result<()> {
    let stdout = io::stdout();
    let mut output = stdout.lock();
    writeln!(output, "{log}")?;
    output.flush()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_returns_the_shared_serializable_dto() {
        let response =
            get_build_info(EmptyRequest::default()).expect("build info should be available");
        let value = serde_json::to_value(&response).expect("build info should serialize");
        let object = value.as_object().expect("build info should be an object");

        assert_eq!(object.len(), 3);
        assert_eq!(object["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(object["gitSha"], env!("FLOWSHOT_GIT_SHA"));
        assert_eq!(object["buildProfile"], env!("FLOWSHOT_BUILD_PROFILE"));
    }

    #[test]
    fn completion_log_contains_required_command_metadata() {
        let response = build_info();
        let value = command_completion_log(&response, "flowshot-test-1", 12);

        assert_eq!(value["event"], "command_complete");
        assert_eq!(value["command"], "get_build_info");
        assert_eq!(value["correlationId"], "flowshot-test-1");
        assert_eq!(value["durationMs"], 12);
        assert_eq!(value["resultCode"], "OK");
        assert_eq!(value["buildInfo"]["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(value["buildInfo"]["gitSha"], env!("FLOWSHOT_GIT_SHA"));
        assert_eq!(
            value["buildInfo"]["buildProfile"],
            env!("FLOWSHOT_BUILD_PROFILE")
        );
    }

    #[test]
    fn document_start_script_uses_the_frozen_command_and_payload() {
        assert!(BUILD_INFO_INITIALIZATION_SCRIPT.contains("\"get_build_info\""));
        assert!(BUILD_INFO_INITIALIZATION_SCRIPT.contains("{ request: {} }"));
        assert!(BUILD_INFO_INITIALIZATION_SCRIPT.contains("__FLOWSHOT_BUILD_INFO_PROMISE__"));
    }

    #[test]
    fn frozen_frontend_payload_reaches_the_tauri_command() {
        let app = tauri::test::mock_builder()
            .invoke_handler(tauri::generate_handler![get_build_info])
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("mock Tauri app should build");
        let webview = tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::default())
            .build()
            .expect("mock webview should build");

        let response = tauri::test::get_ipc_response(
            &webview,
            tauri::webview::InvokeRequest {
                cmd: "get_build_info".into(),
                callback: tauri::ipc::CallbackFn(0),
                error: tauri::ipc::CallbackFn(1),
                url: if cfg!(any(windows, target_os = "android")) {
                    "http://tauri.localhost"
                } else {
                    "tauri://localhost"
                }
                .parse()
                .expect("test URL should parse"),
                body: json!({ "request": {} }).into(),
                headers: tauri::http::HeaderMap::default(),
                invoke_key: tauri::test::INVOKE_KEY.to_string(),
            },
        )
        .expect("frozen payload should reach get_build_info")
        .deserialize::<Value>()
        .expect("build info response should be JSON");

        assert_eq!(response["version"], env!("CARGO_PKG_VERSION"));
        assert_eq!(response["gitSha"], env!("FLOWSHOT_GIT_SHA"));
        assert_eq!(response["buildProfile"], env!("FLOWSHOT_BUILD_PROFILE"));
    }
}

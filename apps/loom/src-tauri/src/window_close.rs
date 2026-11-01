//! The native gate is installed before frontend readiness. No listener or
//! successful event delivery is required to prevent the default destruction.
use tauri::Emitter;

pub const REQUEST_EVENT: &str = "loom:window-close-requested";

fn intercept_main_close(label: &str, prevent: impl FnOnce(), notify: impl FnOnce()) {
    if label == "main" {
        prevent();
        notify();
    }
}

pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
        intercept_main_close(
            window.label(),
            || api.prevent_close(),
            || {
                if let Err(error) = window.emit(REQUEST_EVENT, ()) {
                    tracing::warn!(%error, "window close notification failed; window remains open");
                }
            },
        );
    }
}

/// Frontend dispatches this only at its final commit point. `destroy` bypasses
/// CloseRequested, so approval cannot recursively open another prompt. The
/// injected calling window is the sole target; callers cannot supply a label.
#[tauri::command]
pub fn window_close_approved(window: tauri::WebviewWindow) -> Result<(), String> {
    if window.label() != "main" {
        return Err("Only the calling main window can approve its close".into());
    }
    window.destroy().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::intercept_main_close;
    use std::cell::RefCell;

    #[test]
    fn default_close_is_prevented_before_notification_without_frontend_readiness() {
        let calls = RefCell::new(Vec::new());
        for _ in 0..2 {
            intercept_main_close(
                "main",
                || calls.borrow_mut().push("prevent"),
                || calls.borrow_mut().push("notify-without-listener"),
            );
        }
        assert_eq!(
            *calls.borrow(),
            [
                "prevent",
                "notify-without-listener",
                "prevent",
                "notify-without-listener"
            ]
        );
    }

    #[test]
    fn unrelated_windows_do_not_receive_main_window_policy() {
        intercept_main_close("other", || panic!("prevent"), || panic!("notify"));
    }
}

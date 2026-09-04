// Prevent additional console window on Windows in release; intentional no-op
// on macOS / Linux.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    loom_core::run();
}

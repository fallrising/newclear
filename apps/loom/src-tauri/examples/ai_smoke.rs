//! Opt-in one-request live probe using the same service as Tauri IPC.
//! Configure the gateway/key/model/protocol in the launch environment.
use std::sync::{Arc, Mutex};
use std::time::Duration;

use loom_core::ai::{config::AiSettings, AiChunk, AiService};

#[tokio::main]
async fn main() {
    let settings = match AiSettings::resolve(|name| {
        if name == "LOOM_AI_MAX_TOKENS" {
            Some("256".to_owned())
        } else {
            std::env::var(name).ok()
        }
    }) {
        Ok(settings) if settings.provider().as_str() == "opencode" => settings,
        _ => {
            eprintln!("Configure the OpenCode provider, model, protocol and private key before running this probe.");
            std::process::exit(2);
        }
    };
    let service = AiService::with_settings(settings);
    let counts = Arc::new(Mutex::new((0usize, 0usize)));
    let observed = counts.clone();
    let request = service.run(
        "live-smoke".into(),
        "Write a Python function add(a, b) that returns a + b. Output only the short code.".into(),
        None,
        vec![],
        move |chunk| {
            let mut counts = observed.lock().expect("probe counters");
            match chunk {
                AiChunk::Text { delta, .. } => counts.0 += delta.len(),
                AiChunk::Done { .. } => counts.1 += 1,
                _ => {}
            }
        },
    );
    match tokio::time::timeout(Duration::from_secs(45), request).await {
        Ok(Ok(())) => {
            let counts = counts.lock().expect("probe counters");
            if counts.0 > 0 && counts.1 == 1 {
                println!("PASS: one OpenCode request returned text and one terminal completion (256-token cap). No response text recorded.");
            } else {
                eprintln!(
                    "FAIL: provider returned no visible text or an invalid terminal event count."
                );
                std::process::exit(1);
            }
        }
        Ok(Err(_)) => {
            // Deliberately do not print third-party response text or credentials.
            eprintln!("FAIL: OpenCode request failed. Verify model/protocol, key access and provider availability.");
            std::process::exit(1);
        }
        Err(_) => {
            service.cancel("live-smoke");
            eprintln!("FAIL: OpenCode request exceeded the 45-second probe limit; no retry sent.");
            std::process::exit(1);
        }
    }
}

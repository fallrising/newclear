use memvid_core::{WhisperConfig, WhisperTranscriber};
use serde_json::json;
use std::{env, path::PathBuf, process::ExitCode};

fn run() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<_> = env::args_os().collect();
    if args.len() != 2 {
        return Err("usage: memvid-lab-whisper AUDIO_FILE (requires prepared HF_HOME)".into());
    }
    let audio = PathBuf::from(&args[1]);
    if !audio.is_file() {
        return Err("audio fixture is missing".into());
    }
    let hf_home = PathBuf::from(env::var_os("HF_HOME").ok_or("HF_HOME must be set")?);
    // hf-hub's from_cache() reads cache.token() before with_token(None).
    // Reject every token directory entry, including dangling symlinks, first.
    match std::fs::symlink_metadata(hf_home.join("token")) {
        Ok(_) => return Err("HF_HOME contains a token entry; use a credential-free model cache".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(_) => return Err("unable to verify that the model cache is credential-free".into()),
    }
    for (repository, files) in [
        ("models--openai--whisper-tiny.en", vec!["config.json", "tokenizer.json", "model.safetensors"]),
    ] {
        let root = hf_home.join("hub").join(repository);
        let revision = std::fs::read_to_string(root.join("refs/main"))?;
        if revision != "87c7102498dcde7456f24cfd30239ca606ed9063" {
            return Err("model revision differs from the lab pin".into());
        }
        for file in files {
            if !root.join("snapshots").join(&revision).join(file).is_file() {
                return Err("model cache is incomplete; run prepare_assets.py first".into());
            }
        }
    }
    let config = WhisperConfig {
        model_name: "whisper-tiny-en".to_owned(),
        models_dir: hf_home,
        offline: true,
    };
    let mut transcriber = WhisperTranscriber::new(&config)?;
    let result = transcriber.transcribe_file(&audio)?;
    if result.text.trim().is_empty() || !result.duration_secs.is_finite() || result.duration_secs <= 0.0 {
        return Err("transcription did not produce nonempty text and positive duration".into());
    }
    let segments: Vec<_> = result.segments.iter().map(|s| json!({
        "start": s.start, "end": s.end, "text": s.text,
    })).collect();
    println!("{}", json!({
        "engine": "memvid-core::WhisperTranscriber",
        "core_version": "2.0.140",
        "core_patch": "local-model-cache-v1",
        "model": "whisper-tiny-en",
        "text": result.text,
        "duration_secs": result.duration_secs,
        "language": result.language,
        "segments": segments,
    }));
    Ok(())
}

fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}", json!({"status": "failed", "error": error.to_string()}));
            ExitCode::FAILURE
        }
    }
}

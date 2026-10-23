#![allow(clippy::wildcard_imports)]
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
fn component() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf()
}
fn boundary_errors(root: &Path) -> Vec<String> {
    let mut errors = Vec::new();
    for part in ["crates/core", "crates/xtask", "src-tauri"] {
        let base = root.join(part);
        let manifest = base.join("Cargo.toml");
        if let Ok(text) = std::fs::read_to_string(&manifest)
            && text.lines().any(|l| l.trim_start().starts_with("rusqlite"))
        {
            errors.push(manifest.display().to_string());
        }
        let mut pending = vec![base.join("src")];
        while let Some(dir) = pending.pop() {
            let Ok(entries) = std::fs::read_dir(dir) else {
                continue;
            };
            for e in entries {
                let path = e.unwrap().path();
                if path.is_dir() {
                    pending.push(path);
                } else if path.extension().is_some_and(|x| x == "rs") {
                    let text = std::fs::read_to_string(&path).unwrap();
                    if [
                        "rusqlite::",
                        "SELECT ",
                        "INSERT INTO ",
                        "UPDATE documents ",
                        "DELETE FROM ",
                        "CREATE TABLE ",
                    ]
                    .iter()
                    .any(|s| text.contains(s))
                    {
                        errors.push(path.display().to_string());
                    }
                }
            }
        }
    }
    errors
}
#[test]
fn raw_sql_stays_inside_database_crate() {
    assert_eq!(boundary_errors(&component()), Vec::<String>::new());
}
#[test]
fn boundary_rejection_names_offending_files() {
    let root = std::env::temp_dir().join(format!("boundary-{}", uuid::Uuid::now_v7()));
    let path = root.join("crates/core/src");
    std::fs::create_dir_all(&path).unwrap();
    std::fs::write(
        root.join("crates/core/Cargo.toml"),
        "[dependencies]\nrusqlite=\"0.1\"\n",
    )
    .unwrap();
    std::fs::write(
        path.join("bad.rs"),
        "fn bad(){let query=\"SELECT body FROM annotations\";}",
    )
    .unwrap();
    let errors = boundary_errors(&root);
    assert_eq!(errors.len(), 2);
    assert!(errors.iter().any(|s| s.ends_with("Cargo.toml")));
    assert!(errors.iter().any(|s| s.ends_with("bad.rs")));
    std::fs::remove_dir_all(root).unwrap();
}
fn source_digest(root: &Path, lock: &serde_json::Value) -> String {
    let mut digest = Sha256::new();
    for source in lock["source_files"].as_array().unwrap() {
        let path = source.as_str().unwrap();
        digest.update(path.as_bytes());
        digest.update([0]);
        digest.update(std::fs::read(root.join(path)).unwrap());
        digest.update([0]);
    }
    {
        use std::fmt::Write;
        digest.finalize().iter().fold(String::new(), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
    }
}
const SOURCES: &[&str] = &[
    "crates/db/Cargo.toml",
    "crates/db/src/connection.rs",
    "crates/db/src/executor/mod.rs",
    "crates/db/src/lib.rs",
    "crates/db/src/migrations/001.sql",
    "crates/db/src/migrations/mod.rs",
    "crates/db/src/repository.rs",
    "crates/db/src/transaction.rs",
    "crates/db/src/types.rs",
];
fn hex(bytes: impl AsRef<[u8]>) -> String {
    use std::fmt::Write;
    Sha256::digest(bytes.as_ref())
        .iter()
        .fold(String::new(), |mut s, b| {
            let _ = write!(s, "{b:02x}");
            s
        })
}
fn verify_lock(root: &Path, lock: &serde_json::Value) -> std::result::Result<(), String> {
    let spec = std::fs::read(root.join("SPEC.md")).map_err(|e| e.to_string())?;
    let spec_text = std::str::from_utf8(&spec).map_err(|e| e.to_string())?;
    let version = spec_text
        .lines()
        .find_map(|line| line.strip_prefix("version: "))
        .ok_or("spec version missing")?;
    let checks = [
        ("schema_version", serde_json::json!(1)),
        ("node_id", serde_json::json!("N01")),
        ("status", serde_json::json!("frozen")),
        ("spec_version", serde_json::json!(version)),
        ("spec_sha256", serde_json::json!(hex(&spec))),
        ("source_files", serde_json::json!(SOURCES)),
        (
            "source_hash_algorithm",
            serde_json::json!("sha256(path + NUL + bytes + NUL, in source_files order)"),
        ),
        ("commands", serde_json::json!([])),
        ("generator_version", serde_json::json!("n01-sha256-v1")),
    ];
    for (key, expected) in checks {
        if lock[key] != expected {
            return Err(format!("invalid {key}"));
        }
    }
    if lock["frozen_at"]
        .as_str()
        .is_none_or(|v| v.trim().is_empty())
    {
        return Err("invalid frozen_at".into());
    }
    if lock["source_sha256"] != source_digest(root, lock) {
        return Err("source drift".into());
    }
    Ok(())
}
#[test]
fn frozen_lock_has_zero_drift_and_tamper_fails() {
    let root = component();
    let lock: serde_json::Value = serde_json::from_str(
        &std::fs::read_to_string(root.join("contracts/locks/N01.json")).unwrap(),
    )
    .unwrap();
    verify_lock(&root, &lock).unwrap();
    for (key, value) in [
        ("schema_version", serde_json::json!(2)),
        ("node_id", serde_json::json!("N00")),
        ("status", serde_json::json!("planned")),
        ("spec_version", serde_json::json!("0")),
        ("spec_sha256", serde_json::json!("tampered")),
        ("source_files", serde_json::json!(["../bypass"])),
        ("source_hash_algorithm", serde_json::json!("none")),
        ("source_sha256", serde_json::json!("tampered")),
        ("commands", serde_json::json!(["escape"])),
        ("generator_version", serde_json::json!("unknown")),
        ("frozen_at", serde_json::json!(" ")),
    ] {
        let mut changed = lock.clone();
        changed[key] = value;
        assert!(
            verify_lock(&root, &changed).is_err(),
            "accepted {key} tamper"
        );
    }
    let temporary = std::env::temp_dir().join(format!("lock-drift-{}", uuid::Uuid::now_v7()));
    std::fs::create_dir_all(&temporary).unwrap();
    std::fs::copy(root.join("SPEC.md"), temporary.join("SPEC.md")).unwrap();
    for path in SOURCES {
        let target = temporary.join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(root.join(path), target).unwrap();
    }
    let changed = temporary.join(SOURCES[1]);
    let mut bytes = std::fs::read(&changed).unwrap();
    bytes.push(b'\n');
    std::fs::write(changed, bytes).unwrap();
    assert_eq!(verify_lock(&temporary, &lock).unwrap_err(), "source drift");
    std::fs::remove_dir_all(temporary).unwrap();
}

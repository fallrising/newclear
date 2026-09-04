use std::{env, process::Command};

fn main() {
    println!("cargo:rerun-if-env-changed=FLOWSHOT_GIT_SHA");
    println!("cargo:rerun-if-changed=../.git/HEAD");

    let git_sha = env::var("FLOWSHOT_GIT_SHA")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(git_sha_from_checkout)
        .unwrap_or_else(|| "unknown".into());
    let profile = env::var("PROFILE").unwrap_or_else(|_| "unknown".into());

    println!("cargo:rustc-env=FLOWSHOT_GIT_SHA={git_sha}");
    println!("cargo:rustc-env=FLOWSHOT_BUILD_PROFILE={profile}");
    tauri_build::build();
}

fn git_sha_from_checkout() -> Option<String> {
    let output = Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }

    let value = String::from_utf8(output.stdout).ok()?;
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_owned())
}

use std::{
    collections::{BTreeSet, HashMap, VecDeque},
    path::{Path, PathBuf},
    process::{Command, Stdio},
};

use serde::Deserialize;

const CORE_PACKAGE: &str = "flowshot-core";
const ALLOWED_DIRECT: [&str; 3] = ["serde", "serde_json", "ts-rs"];
const FORBIDDEN_EXACT: [&str; 12] = [
    "diesel",
    "flowshot-db",
    "flowshot-tauri",
    "hyper",
    "notify",
    "reqwest",
    "rusqlite",
    "sea-orm",
    "sqlx",
    "tauri",
    "tokio",
    "ureq",
];
const FORBIDDEN_PREFIXES: [&str; 2] = ["sqlx-", "tauri-"];

#[derive(Debug, Deserialize)]
struct Metadata {
    packages: Vec<Package>,
    resolve: Option<Resolve>,
}

#[derive(Debug, Deserialize)]
struct Package {
    id: String,
    name: String,
    dependencies: Vec<Dependency>,
}

#[derive(Debug, Deserialize)]
struct Dependency {
    name: String,
}

#[derive(Debug, Deserialize)]
struct Resolve {
    nodes: Vec<Node>,
}

#[derive(Debug, Deserialize)]
struct Node {
    id: String,
    dependencies: Vec<String>,
}

pub fn run(mut args: impl Iterator<Item = String>) -> Result<String, String> {
    if let Some(argument) = args.next() {
        return Err(format!("unknown check-boundaries option `{argument}`"));
    }

    let manifest = repository_root().join("Cargo.toml");
    check_manifest(&manifest, true)?;
    Ok("flowshot-core dependency boundary is valid".into())
}

fn repository_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn check_manifest(manifest: &Path, locked: bool) -> Result<(), String> {
    let mut command = Command::new(env!("CARGO"));
    command.args(["metadata", "--format-version", "1", "--manifest-path"]);
    command.arg(manifest);
    command.arg("--offline");
    if locked {
        command.arg("--locked");
    }
    command.stderr(Stdio::piped());

    let output = command
        .output()
        .map_err(|error| format!("failed to execute cargo metadata: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "cargo metadata failed for {}:\n{}",
            manifest.display(),
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }

    let metadata: Metadata = serde_json::from_slice(&output.stdout)
        .map_err(|error| format!("failed to parse cargo metadata: {error}"))?;
    analyze(&metadata)
}

fn analyze(metadata: &Metadata) -> Result<(), String> {
    let core = metadata
        .packages
        .iter()
        .find(|package| package.name == CORE_PACKAGE)
        .ok_or_else(|| format!("cargo metadata does not contain `{CORE_PACKAGE}`"))?;
    let resolve = metadata
        .resolve
        .as_ref()
        .ok_or_else(|| "cargo metadata did not include a resolved graph".to_owned())?;

    let mut violations = Vec::new();
    let direct = core
        .dependencies
        .iter()
        .map(|dependency| dependency.name.as_str())
        .collect::<BTreeSet<_>>();
    for dependency in direct {
        if !ALLOWED_DIRECT.contains(&dependency) {
            violations.push(format!(
                "direct dependency `{dependency}` is not in the core allow-list"
            ));
        }
    }

    let names = metadata
        .packages
        .iter()
        .map(|package| (package.id.as_str(), package.name.as_str()))
        .collect::<HashMap<_, _>>();
    let edges = resolve
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), node.dependencies.as_slice()))
        .collect::<HashMap<_, _>>();

    let mut parents: HashMap<&str, Option<&str>> = HashMap::from([(core.id.as_str(), None)]);
    let mut queue = VecDeque::from([core.id.as_str()]);

    while let Some(package_id) = queue.pop_front() {
        let Some(dependencies) = edges.get(package_id) else {
            continue;
        };
        for dependency_id in *dependencies {
            if parents.contains_key(dependency_id.as_str()) {
                continue;
            }
            parents.insert(dependency_id, Some(package_id));
            queue.push_back(dependency_id);

            let Some(name) = names.get(dependency_id.as_str()) else {
                violations.push(format!(
                    "resolved dependency `{dependency_id}` has no package metadata"
                ));
                continue;
            };
            if is_forbidden(name) {
                violations.push(format!(
                    "forbidden dependency path: {}",
                    dependency_path(dependency_id, &parents, &names)
                ));
            }
        }
    }

    if violations.is_empty() {
        Ok(())
    } else {
        violations.sort();
        violations.dedup();
        Err(format!(
            "flowshot-core boundary violations:\n- {}",
            violations.join("\n- ")
        ))
    }
}

fn is_forbidden(name: &str) -> bool {
    FORBIDDEN_EXACT.contains(&name)
        || FORBIDDEN_PREFIXES
            .iter()
            .any(|prefix| name.starts_with(prefix))
        || (name.starts_with("flowshot-") && name != CORE_PACKAGE)
}

fn dependency_path<'a>(
    leaf: &'a str,
    parents: &HashMap<&'a str, Option<&'a str>>,
    names: &HashMap<&'a str, &'a str>,
) -> String {
    let mut path = Vec::new();
    let mut cursor = Some(leaf);
    while let Some(package_id) = cursor {
        path.push(names.get(package_id).copied().unwrap_or(package_id));
        cursor = parents.get(package_id).copied().flatten();
    }
    path.reverse();
    path.join(" -> ")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    #[test]
    fn current_workspace_satisfies_the_core_policy() {
        check_manifest(&repository_root().join("Cargo.toml"), true)
            .expect("current workspace should satisfy the core boundary");
    }

    #[test]
    fn disposable_fixture_rejects_direct_rusqlite() {
        let fixture = Fixture::new("rusqlite");
        fixture.write(
            "core/Cargo.toml",
            r#"[package]
name = "flowshot-core"
version = "0.0.0"
edition = "2024"

[dependencies]
rusqlite = { path = "../forbidden" }
"#,
        );
        fixture.write("core/src/lib.rs", "");
        fixture.write(
            "forbidden/Cargo.toml",
            r#"[package]
name = "rusqlite"
version = "0.0.0"
edition = "2024"
"#,
        );
        fixture.write("forbidden/src/lib.rs", "");
        fixture.write_workspace(&["core", "forbidden"]);

        let error = check_manifest(&fixture.path.join("Cargo.toml"), false)
            .expect_err("rusqlite fixture must fail");
        assert!(error.contains("direct dependency `rusqlite`"));
        assert!(error.contains("flowshot-core -> rusqlite"));
    }

    #[test]
    fn disposable_fixture_rejects_transitive_tauri() {
        let fixture = Fixture::new("tauri");
        fixture.write(
            "core/Cargo.toml",
            r#"[package]
name = "flowshot-core"
version = "0.0.0"
edition = "2024"

[dependencies]
serde = { path = "../bridge" }
"#,
        );
        fixture.write("core/src/lib.rs", "");
        fixture.write(
            "bridge/Cargo.toml",
            r#"[package]
name = "serde"
version = "0.0.0"
edition = "2024"

[dependencies]
tauri = { path = "../forbidden" }
"#,
        );
        fixture.write("bridge/src/lib.rs", "");
        fixture.write(
            "forbidden/Cargo.toml",
            r#"[package]
name = "tauri"
version = "0.0.0"
edition = "2024"
"#,
        );
        fixture.write("forbidden/src/lib.rs", "");
        fixture.write_workspace(&["core", "bridge", "forbidden"]);

        let error = check_manifest(&fixture.path.join("Cargo.toml"), false)
            .expect_err("transitive Tauri fixture must fail");
        assert!(error.contains("flowshot-core -> serde -> tauri"));
    }

    struct Fixture {
        path: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nanos = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "flowshot-boundary-{label}-{}-{nanos}",
                std::process::id()
            ));
            fs::create_dir_all(&path).expect("fixture root should be created");
            Self { path }
        }

        fn write(&self, relative: &str, content: &str) {
            let path = self.path.join(relative);
            fs::create_dir_all(path.parent().expect("fixture file needs a parent"))
                .expect("fixture directory should be created");
            fs::write(path, content).expect("fixture file should be written");
        }

        fn write_workspace(&self, members: &[&str]) {
            let members = members
                .iter()
                .map(|member| format!("\"{member}\""))
                .collect::<Vec<_>>()
                .join(", ");
            self.write(
                "Cargo.toml",
                &format!("[workspace]\nmembers = [{members}]\nresolver = \"3\"\n"),
            );
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }
}

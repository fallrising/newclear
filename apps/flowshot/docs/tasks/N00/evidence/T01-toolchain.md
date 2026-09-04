---
document_type: evidence
node_id: N00
task_id: T01
title: Toolchain and red-baseline evidence
recorded_at: 2026-07-29
result: pass
---

# T01 toolchain and red-baseline evidence

## Initial red baseline

The repository preflight had no application scaffold. The expected commands
failed before implementation:

```text
$ node --version
bash: node: command not found

$ npm --version
bash: npm: command not found

$ cargo tauri --version
error: no such command: `tauri`
```

This is the required red state for N00 rather than a product regression.

## Selected versions

The implementation baseline uses:

| Tool | Version | Selection |
| --- | --- | --- |
| Rust | 1.97.1 | Current stable patch release on 2026-07-29 |
| Cargo | 1.97.1 | Installed with the selected Rust toolchain |
| rustfmt | 1.9.0-stable | Installed Rust component |
| Clippy | 0.1.97 | Installed Rust component |
| Node.js | 24.18.0 | Current Node 24 LTS release on 2026-07-29 |
| npm | 11.16.0 | Bundled with the selected Node release |
| Tauri CLI | project-local npm dependency | Added with the frontend scaffold |

Rust and Node decisions were checked against the official release pages:

- <https://blog.rust-lang.org/2026/07/16/Rust-1.97.1/>
- <https://nodejs.org/en/about/previous-releases>
- <https://nodejs.org/en/blog/release/v24.18.0>

Node was downloaded from the official distribution and its archive was checked
against the official `SHASUMS256.txt`:

```text
55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742  node-v24.18.0-linux-x64.tar.xz
```

The unpacked local tool is intentionally ignored under `.tools/`. The committed
project metadata will constrain supported versions; the binary itself is not
part of source control.

## Green toolchain check

With `.tools/node-v24.18.0-linux-x64/bin` prepended to `PATH`:

```text
rustc 1.97.1 (8bab26f4f 2026-07-14)
cargo 1.97.1 (c980f4866 2026-06-30)
rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14)
clippy 0.1.97 (8bab26f4f6 2026-07-14)
v24.18.0
11.16.0
```

## Platform route

The current host is `Linux 6.1.0-28-amd64 x86_64`. It has the basic compiler,
download, and file tools, but lacks `pkg-config` and the native Tauri/WebKit
development packages. Its restricted system configuration does not permit
installing them.

The Debian package set required by the official Tauri prerequisites is:

```text
libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev
libayatana-appindicator3-dev librsvg2-dev
```

Reference: <https://v2.tauri.app/start/prerequisites/>

Therefore:

1. Frontend, generated-contract, and platform-neutral Rust checks run locally.
2. Ubuntu CI installs the documented packages before the native Tauri build.
3. macOS CI performs the target-platform build.
4. A real macOS launch check remains mandatory before N00 is marked complete;
   CI build success alone will not be reported as launch evidence.

## Result

T01 passes because supported versions are available and the unavailable native
platform checks have an explicit verification route. No application scaffold or
production code was added by this task.

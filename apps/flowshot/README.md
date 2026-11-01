# Flowshot

> 主線、驗收條件、剩餘缺口與可用版本：[SUCCESS.md](SUCCESS.md)。


> **Development resumed 2026-10-23** by the owner’s [startup instruction](START_DEVELOPMENT_PROMPT.md). Linux Docker development acceptance and target-Mac release acceptance are tracked separately; see the [task board](docs/tasks/BOARD.md).


Active monorepo CI: [flowshot-ci.yml](../../.github/workflows/flowshot-ci.yml). The nested standalone workflow is historical.

Flowshot is the repository for **Markdown Annotator**, a local-first,
read-only desktop application for reading Markdown and keeping annotations
attached as documents evolve.

## Product promise

Flowshot treats a Markdown workspace as user-owned source material:

- Workspace files are never edited, renamed, deleted, or reformatted.
- Annotations, comments, tags, and document records are never silently lost.
- External edits trigger conservative re-anchoring.
- Uncertain matches become visible, manually recoverable orphans.
- Core reading and annotation workflows require no network connection.

## Planned v1

- Multiple local workspace roots with a lazy Markdown file tree
- Safe GFM rendering, syntax highlighting, TOC, and deterministic headings
- Persistent tabs and per-document scroll positions
- Range annotations, document notes, overlapping highlights, and comments
- Document and annotation tags with cross-document AND filtering
- File watching, conservative rename detection, and audited re-anchoring
- In-document search, command palette, wikilinks/backlinks, and Mermaid
- Versioned JSON and Markdown export outside workspace roots

The primary release target is macOS 13+ on Apple Silicon and Intel. Windows
and Linux should remain architecturally portable, but are not v1 release
gates.

## Architecture

- Tauri 2 desktop shell
- Rust stable backend and pure domain core
- React 19, TypeScript, and Vite frontend
- unified/remark/rehype Markdown document model
- SQLite with WAL and migration-backed repositories
- Rust-authored contracts with generated TypeScript bindings

## Current status

M0 development acceptance is complete: N00 foundation and N01 SQLite persistence passed Linux native verification. The repository now contains the Rust workspace, React/Tauri shell,
Rust-authored contract generator, frozen `get_build_info` contract, typed
command-to-UI slice, and executable core dependency boundary. The desktop app now initializes a checksummed SQLite schema in platform app-data before showing its main window; failed migration blocks startup. Typed repositories, WAL/restart tests and the release seed benchmark are covered in [M0 verification](docs/verification/N01.md). Workspace reading and annotation UI remain future nodes.

The documentation baseline is available in:

- [`SPEC.md`](SPEC.md): product, architecture, security, and data authority
- [`docs/graph.yaml`](docs/graph.yaml): machine-readable implementation DAG
- [`docs/nodes/`](docs/nodes/): independently executable SDD node specs
- [`docs/protocols/`](docs/protocols/): execution and document-change rules
- [`docs/templates/`](docs/templates/): plan, task, test, ADR, and verification templates

## Development

Use Rust 1.97.1 and Node.js 24.18.0. Before launching the desktop app, install
the official [Tauri platform prerequisites](https://v2.tauri.app/start/prerequisites/).
The primary macOS target also requires the Xcode command-line tools.

From the existing monorepo checkout (do not clone a second standalone repo):

```bash
cd apps/flowshot
make bootstrap
make ci
npm run tauri -- dev
```

`make ci` runs SDD integrity, contract drift/determinism, dependency boundaries,
Rust format/test/lint, and frontend lint/test/build. It also compiles, tests,
and builds the native Tauri adapter when the host prerequisites are detected;
otherwise it prints an explicit native-gate skip. GitHub Actions prepares those
dependencies and runs the same command on Ubuntu 24.04, macOS 15 Apple Silicon,
and macOS 15 Intel.

Focused commands:

- `make gen-contracts` regenerates TypeScript from Rust authority.
- `make check-contracts` checks generated output and the frozen lock.
- `make native-ci` requires a prepared Tauri host and never skips native work.

## Engineering approach

Development is specification-driven and test-first:

1. Freeze a node's contracts and test plan.
2. Split the node into small, independently verifiable tasks.
3. Preserve red-to-green evidence.
4. Run the complete CI gate.
5. Publish a verification report and node outcome.
6. Pass the milestone's real dogfood gate before advancing. Target-Mac launch acceptance separately blocks usable releases, as specified in SPEC §13.1.

Scope expansion such as Markdown editing, AI/RAG, cloud sync, accounts,
telemetry, plugins, terminal integration, or arbitrary web content is excluded
from v1.

## Shared build workspace

Run build/test commands through the common agent workspace launcher when available. It sets `CARGO_TARGET_DIR`, `AGENT_BUILD_DIR` and `AGENT_EVIDENCE_DIR`. Frontend TypeScript/Vite outputs and the Tauri `frontendDist` now use that build directory; the Mac probe uses the same Cargo target and saves evidence under `AGENT_EVIDENCE_DIR/macos-launch`. Explicit `FLOWSHOT_LAUNCH_ARTIFACT_DIR` takes precedence. A default checkout still uses `dist/` and `target/`. The Docker wrapper also redirects Tauri generated schemas to its build directory and keeps native application data/configuration under preserved artifacts. Install npm dependencies into an isolated task directory and link its node_modules into this source checkout when following the shared workspace policy; do not move existing dependency directories.

For target-Mac acceptance, run `make macos-launch-smoke` through the launcher (or equivalent explicit output variables), on the controlled macOS 13+ target. Both a PID-owned visible window and frontend command completion must arrive strictly before 1500 ms. The 15-second observation window is diagnostic only. Hosted or Linux checks cannot close this requirement.

M0 is merged in [PR #512](https://github.com/fallrising/newclear/pull/512), with board closure in [PR #513](https://github.com/fallrising/newclear/pull/513). N00 foundation and N01 SQLite persistence are verified. N02 workspace and N03 reader are partial implementations with passing integrated Linux checks; full reading/annotation/reanchor journeys remain incomplete. N03 performance is blocked; see [ADR-005](docs/adr/ADR-005-render-performance-decision.md). Controlled Mac acceptance remains a separate release gate.

## Linux Docker development gate

Build the test image with `docker build -f scripts/Dockerfile.linux -t flowshot-linux:20261023 scripts` through the shared launcher. Then run `bash scripts/linux-docker-check.sh` through the launcher from this component. The wrapper mounts only this isolated source checkout and that task's output directory, bounds CPU/memory, installs locked dependencies outside source, runs `make ci` and mandatory `make native-ci`, and verifies a PID-owned visible Xvfb window plus actual WebView `get_build_info` completion. The container runs as the invoking UID. Keep its evidence logs and `linux-native/run-*/result.json`; a 30-second functional timeout is not a replacement for the Mac 1500 ms performance oracle.

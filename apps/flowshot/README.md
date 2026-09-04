# Flowshot

[![CI](https://github.com/fallrising/flowshot/actions/workflows/ci.yml/badge.svg)](https://github.com/fallrising/flowshot/actions/workflows/ci.yml)

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

The specification baseline is complete and N00 foundation development is in
progress. The repository now contains the Rust workspace, React/Tauri shell,
Rust-authored contract generator, frozen `get_build_info` contract, typed
command-to-UI slice, and executable core dependency boundary.

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

A new checkout needs five commands:

```bash
git clone https://github.com/fallrising/flowshot.git
cd flowshot
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
6. Pass the milestone's real dogfood gate before advancing.

Scope expansion such as Markdown editing, AI/RAG, cloud sync, accounts,
telemetry, plugins, terminal integration, or arbitrary web content is excluded
from v1.

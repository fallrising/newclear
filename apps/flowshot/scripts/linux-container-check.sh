#!/usr/bin/env bash
set -euo pipefail
: "${AGENT_BUILD_DIR:?run through the shared workspace launcher}"
: "${AGENT_EVIDENCE_DIR:?}"
export CARGO_HOME="$AGENT_BUILD_DIR/cargo-home"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
mkdir -p "$AGENT_BUILD_DIR/frontend" "$CARGO_HOME"
mkdir -p "$AGENT_BUILD_DIR/tauri-gen"
if [[ ! -e src-tauri/gen && ! -L src-tauri/gen ]]; then
    ln -s "$AGENT_BUILD_DIR/tauri-gen" src-tauri/gen
elif [[ "$(readlink -f src-tauri/gen)" != "$AGENT_BUILD_DIR/tauri-gen" ]]; then
    echo "src-tauri/gen belongs to another build; use an isolated checkout or its original task directory" >&2
    exit 1
fi
cp package.json package-lock.json "$AGENT_BUILD_DIR/frontend/"
npm ci --prefix "$AGENT_BUILD_DIR/frontend" --no-audit --no-fund
if [[ ! -e node_modules && ! -L node_modules ]]; then
    ln -s "$AGENT_BUILD_DIR/frontend/node_modules" node_modules
elif [[ "$(readlink -f node_modules)" != "$AGENT_BUILD_DIR/frontend/node_modules" ]]; then
    echo "node_modules belongs to another installation; use an isolated checkout or its original task directory" >&2
    exit 1
fi
node --version
cargo --version
pkg-config --modversion webkit2gtk-4.1
cargo fetch --locked
xvfb-run -a dbus-run-session -- make ci
# Explicit target: a skipped native gate can never pass this development gate.
xvfb-run -a dbus-run-session -- make native-ci
xvfb-run -a dbus-run-session -- python3 scripts/linux-native-smoke.py
xvfb-run -a dbus-run-session -- python3 scripts/linux-db-smoke.py

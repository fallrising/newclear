#!/usr/bin/env bash
set -euo pipefail
: "${AGENT_WORKSPACE_TASK_DIR:?run through the shared workspace launcher}"
source_root="$(cd "$(dirname "$0")/../../.." && pwd)"
component="$source_root/apps/flowshot"
if [[ $# -eq 0 ]]; then
    set -- bash scripts/linux-container-check.sh
fi
docker run --rm --init --cpus=4 --memory=12g --shm-size=1g \
    --user "$(id -u):$(id -g)" \
    --mount "type=bind,src=$source_root,dst=$source_root" \
    --mount "type=bind,src=$AGENT_WORKSPACE_TASK_DIR,dst=$AGENT_WORKSPACE_TASK_DIR" \
    --workdir "$component" \
    -e AGENT_BUILD_DIR -e AGENT_EVIDENCE_DIR -e AGENT_ARTIFACTS_DIR \
    -e CARGO_TARGET_DIR -e TMPDIR -e PYTHONPYCACHEPREFIX \
    -e "CARGO_HOME=$AGENT_BUILD_DIR/cargo-home" \
    -e npm_config_cache -e NODE_COMPILE_CACHE \
    -e "FLOWSHOT_GIT_SHA=$(git -C "$source_root" rev-parse HEAD)" \
    -e "XDG_CACHE_HOME=$AGENT_BUILD_DIR/xdg-cache" \
    -e "XDG_CONFIG_HOME=$AGENT_ARTIFACTS_DIR/config" \
    -e "XDG_DATA_HOME=$AGENT_ARTIFACTS_DIR/app-data" \
    "${FLOWSHOT_LINUX_IMAGE:-flowshot-linux:20261023}" \
    "$@"

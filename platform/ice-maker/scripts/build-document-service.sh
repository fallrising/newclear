#!/usr/bin/env bash
set -Eeuo pipefail

if (( $# != 0 )); then
  echo "usage: scripts/build-document-service.sh" >&2
  exit 64
fi
command -v docker >/dev/null 2>&1 || { echo "Docker CLI is required" >&2; exit 69; }
if ! daemon_info=$(docker info --format '{{json .SecurityOptions}}|{{.CgroupVersion}}' 2>/dev/null); then
  echo "Docker daemon is unavailable" >&2
  exit 69
fi
if [[ "$daemon_info" != *seccomp* || "$daemon_info" != *apparmor* || "$daemon_info" != *'|2' ]]; then
  echo "Docker seccomp, AppArmor, and cgroup v2 are required" >&2
  exit 69
fi

project_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
required=(
  docker/document-service.Dockerfile
  pyproject.toml
  config/document-ingestion.json
  knowledge/90-meta/taxonomy.yaml
  scripts/loopback-uds-proxy.py
)
for relative in "${required[@]}"; do
  [[ -f "$project_root/$relative" && ! -L "$project_root/$relative" ]] || {
    echo "required build input is missing or linked" >&2
    exit 66
  }
done
if [[ -n $(find "$project_root/src/ice_maker" -type l -print -quit) ]]; then
  echo "linked source input is forbidden" >&2
  exit 66
fi

source_digest=$(
  cd "$project_root"
  {
    sha256sum "${required[@]}"
    find src/ice_maker -maxdepth 1 -type f -name '*.py' -print0 \
      | LC_ALL=C sort -z \
      | xargs -0 sha256sum
  } | sha256sum | cut -d' ' -f1
)
image='ice-maker/document-service:local'
if current=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image" 2>/dev/null) \
  && [[ "$current" == "$source_digest" ]]; then
  echo "reusing $image ($source_digest)"
  exit 0
fi

build_context=$(mktemp -d /tmp/ice-maker-build.XXXXXXXX)
cleanup() {
  case "$build_context" in
    /tmp/ice-maker-build.????????) chmod -R u+w "$build_context"; rm -rf -- "$build_context" ;;
    *) echo "refusing unsafe temporary cleanup" >&2; return 1 ;;
  esac
}
trap cleanup EXIT
mkdir -p "$build_context/config"
mkdir -p "$build_context/knowledge/90-meta"
mkdir -p "$build_context/scripts"
cp "$project_root/docker/document-service.Dockerfile" "$build_context/Dockerfile"
cp "$project_root/pyproject.toml" "$build_context/pyproject.toml"
cp "$project_root/config/document-ingestion.json" "$build_context/config/document-ingestion.json"
cp "$project_root/knowledge/90-meta/taxonomy.yaml" "$build_context/knowledge/90-meta/taxonomy.yaml"
cp "$project_root/scripts/loopback-uds-proxy.py" "$build_context/scripts/loopback-uds-proxy.py"
cp -R "$project_root/src" "$build_context/src"
find "$build_context/src" -type d -name __pycache__ -prune -exec rm -rf {} +

docker build --pull=false \
  --file "$build_context/Dockerfile" \
  --tag "$image" \
  --label "org.opencontainers.image.revision=$source_digest" \
  "$build_context"
built=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' "$image")
[[ "$built" == "$source_digest" ]] || { echo "built image label mismatch" >&2; exit 70; }
echo "built $image ($source_digest)"

#!/usr/bin/env bash
# Read-only first-rollout preflight. Never deploys or mutates Docker state.
set -euo pipefail

die() {
  printf '%s\n' "$*" >&2
  exit 1
}

is_full_sha() {
  local value="$1"
  [[ "$value" =~ ^[0-9a-f]{40}$ ]]
}

is_valid_hostname() {
  local host="$1"
  local len=${#host}
  if ((len < 1 || len > 253)); then
    return 1
  fi
  # Lowercase DNS labels only; no scheme, path, or uppercase.
  [[ "$host" =~ ^[a-z0-9.-]+$ ]] || return 1
  [[ "$host" != .* && "$host" != *. && "$host" != *..* ]] || return 1

  local -a labels
  local label llen
  IFS=. read -ra labels <<< "$host"
  for label in "${labels[@]}"; do
    llen=${#label}
    if ((llen < 1 || llen > 63)); then
      return 1
    fi
    # Label must start and end alnum; interior hyphens allowed.
    [[ "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]] || return 1
  done
  return 0
}

is_valid_ipv4() {
  local ip="$1"
  [[ "$ip" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]] || return 1
  local o
  for o in "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[4]}"; do
    if ((10#$o < 0 || 10#$o > 255)); then
      return 1
    fi
  done
  return 0
}

is_valid_container_name() {
  local name="$1"
  # Begin alphanumeric so the value cannot be parsed as a Docker option.
  [[ "$name" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]*$ ]]
}

is_absolute_path() {
  local path="$1"
  [[ "$path" == /* ]]
}

# ---------------------------------------------------------------------------
# Argument validation (no external commands yet)
# ---------------------------------------------------------------------------
if [[ "$#" -ne 3 ]]; then
  die "Usage: rollout-preflight.sh twitter-deck <release-full-sha> <rollback-full-sha>"
fi

APP_NAME="$1"
RELEASE_SHA="$2"
ROLLBACK_SHA="$3"
IMAGE_REPO="ghcr.io/fallrising/obechow"

if [[ "$APP_NAME" != "twitter-deck" ]]; then
  die "Error: unknown application '${APP_NAME}'. Expected 'twitter-deck'."
fi

if [[ -z "$RELEASE_SHA" ]]; then
  die "Error: release SHA is required and must be exactly 40 lowercase hex characters."
fi
if [[ -z "$ROLLBACK_SHA" ]]; then
  die "Error: rollback SHA is required and must be exactly 40 lowercase hex characters."
fi
if ! is_full_sha "$RELEASE_SHA"; then
  die "Error: invalid release SHA '${RELEASE_SHA}'. Must be exactly 40 lowercase hexadecimal characters."
fi
if ! is_full_sha "$ROLLBACK_SHA"; then
  die "Error: invalid rollback SHA '${ROLLBACK_SHA}'. Must be exactly 40 lowercase hexadecimal characters."
fi
if [[ "$RELEASE_SHA" == "$ROLLBACK_SHA" ]]; then
  die "Error: release and rollback SHAs must be distinct."
fi

# ---------------------------------------------------------------------------
# Required environment values (non-secret)
# ---------------------------------------------------------------------------
if [[ -z "${APP_HOST+x}" || -z "${APP_HOST}" ]]; then
  die "Error: APP_HOST is required (lowercase DNS hostname)."
fi
if [[ -z "${EXPECTED_DNS_IPV4+x}" || -z "${EXPECTED_DNS_IPV4}" ]]; then
  die "Error: EXPECTED_DNS_IPV4 is required (exact VPS IPv4)."
fi
if [[ -z "${TRAEFIK_CONTAINER+x}" || -z "${TRAEFIK_CONTAINER}" ]]; then
  die "Error: TRAEFIK_CONTAINER is required (running Traefik container name)."
fi

if ! is_valid_hostname "$APP_HOST"; then
  die "Error: invalid APP_HOST '${APP_HOST}'. Require lowercase DNS hostname with valid labels."
fi
if ! is_valid_ipv4 "$EXPECTED_DNS_IPV4"; then
  die "Error: invalid EXPECTED_DNS_IPV4 '${EXPECTED_DNS_IPV4}'. Require dotted IPv4 with octets 0..255."
fi
if ! is_valid_container_name "$TRAEFIK_CONTAINER"; then
  die "Error: invalid TRAEFIK_CONTAINER '${TRAEFIK_CONTAINER}'. Begin with an alphanumeric character; then use only letters, digits, '_', '.', and '-'."
fi

# ---------------------------------------------------------------------------
# Path defaults and absolute override validation
# ---------------------------------------------------------------------------
SCRIPT_PATH="${BASH_SOURCE[0]}"
if [[ "$SCRIPT_PATH" == */* ]]; then
  SCRIPT_DIR_INPUT="${SCRIPT_PATH%/*}"
else
  SCRIPT_DIR_INPUT="."
fi
SCRIPT_DIR="$(cd -- "$SCRIPT_DIR_INPUT" && pwd)"
DEFAULT_SOURCE_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

SOURCE_ROOT="${OBECHOW_SOURCE_ROOT-$DEFAULT_SOURCE_ROOT}"
DEPLOY_ROOT="${OBECHOW_DEPLOY_ROOT-/srv/apps}"
DEPLOY_SCRIPT="${OBECHOW_DEPLOY_SCRIPT-/srv/deploy.sh}"

if [[ -n "${OBECHOW_SOURCE_ROOT+x}" ]] && ! is_absolute_path "$SOURCE_ROOT"; then
  die "Error: OBECHOW_SOURCE_ROOT must be an absolute path."
fi
if [[ -n "${OBECHOW_DEPLOY_ROOT+x}" ]] && ! is_absolute_path "$DEPLOY_ROOT"; then
  die "Error: OBECHOW_DEPLOY_ROOT must be an absolute path."
fi
if [[ -n "${OBECHOW_DEPLOY_SCRIPT+x}" ]] && ! is_absolute_path "$DEPLOY_SCRIPT"; then
  die "Error: OBECHOW_DEPLOY_SCRIPT must be an absolute path."
fi
if ! is_absolute_path "$SOURCE_ROOT"; then
  die "Error: source root must be an absolute path."
fi
if ! is_absolute_path "$DEPLOY_ROOT"; then
  die "Error: deploy root must be an absolute path."
fi
if ! is_absolute_path "$DEPLOY_SCRIPT"; then
  die "Error: deploy script path must be an absolute path."
fi

APP_DIR="${DEPLOY_ROOT}/${APP_NAME}"
REVIEWED_COMPOSE="${SOURCE_ROOT}/ops/compose.yml"
REVIEWED_DEPLOY="${SOURCE_ROOT}/ops/deploy.sh"
INSTALLED_COMPOSE="${APP_DIR}/compose.yml"

# ---------------------------------------------------------------------------
# Artifact presence (builtins only; no external commands)
# ---------------------------------------------------------------------------
if [[ ! -d "$APP_DIR" ]]; then
  die "Error: application directory '${APP_DIR}' not found."
fi
if [[ ! -f "$INSTALLED_COMPOSE" ]]; then
  die "Error: installed Compose file '${INSTALLED_COMPOSE}' not found."
fi
if [[ ! -f "$DEPLOY_SCRIPT" ]]; then
  die "Error: deploy entrypoint '${DEPLOY_SCRIPT}' not found."
fi
if [[ ! -x "$DEPLOY_SCRIPT" ]]; then
  die "Error: deploy entrypoint '${DEPLOY_SCRIPT}' is not executable."
fi
if [[ ! -f "$REVIEWED_COMPOSE" ]]; then
  die "Error: reviewed Compose file '${REVIEWED_COMPOSE}' not found."
fi
if [[ ! -f "$REVIEWED_DEPLOY" ]]; then
  die "Error: reviewed deploy entrypoint '${REVIEWED_DEPLOY}' not found."
fi

# ---------------------------------------------------------------------------
# FR-02: reviewed-to-installed byte identity (before host/registry checks)
# ---------------------------------------------------------------------------
if ! cmp "$REVIEWED_COMPOSE" "$INSTALLED_COMPOSE"; then
  die "Error: installed Compose file differs from reviewed ops/compose.yml."
fi
if ! cmp "$REVIEWED_DEPLOY" "$DEPLOY_SCRIPT"; then
  die "Error: installed deploy entrypoint differs from reviewed ops/deploy.sh."
fi

# ---------------------------------------------------------------------------
# FR-03: Docker Engine and Compose capability
# ---------------------------------------------------------------------------
server_version="$(docker info --format '{{.ServerVersion}}')"
if [[ -z "$server_version" ]]; then
  die "Error: Docker Engine ServerVersion is empty."
fi

compose_version="$(docker compose version --short)"
if [[ -z "$compose_version" ]]; then
  die "Error: Docker Compose version is empty."
fi

compose_up_help="$(docker compose up --help)"
if [[ "$compose_up_help" != *"--wait"* ]]; then
  die "Error: docker compose up does not advertise --wait capability required by P05."
fi

# ---------------------------------------------------------------------------
# FR-04: edge network and Traefik prerequisites
# ---------------------------------------------------------------------------
edge_name="$(docker network inspect --format '{{.Name}}' edge)"
if [[ "$edge_name" != "edge" ]]; then
  die "Error: expected external network name 'edge', got '${edge_name}'."
fi

running_state="$(docker inspect --type container --format '{{.State.Running}}' "$TRAEFIK_CONTAINER")"
if [[ "$running_state" != "true" ]]; then
  die "Error: Traefik container '${TRAEFIK_CONTAINER}' is not running."
fi

edge_net_id="$(docker inspect --type container --format '{{with index .NetworkSettings.Networks "edge"}}{{.NetworkID}}{{end}}' "$TRAEFIK_CONTAINER")"
if [[ -z "$edge_net_id" ]]; then
  die "Error: Traefik container '${TRAEFIK_CONTAINER}' is not attached to the edge network."
fi

traefik_cmd="$(docker inspect --type container --format '{{range .Config.Cmd}}{{println .}}{{end}}' "$TRAEFIK_CONTAINER")"
resolver_found=0
while IFS= read -r cmd_arg || [[ -n "${cmd_arg}" ]]; do
  if [[ "$cmd_arg" == --certificatesresolvers.le.acme.* ]]; then
    resolver_found=1
    break
  fi
done <<< "$traefik_cmd"
if [[ "$resolver_found" -ne 1 ]]; then
  die "Error: Traefik command lacks certificatesresolvers.le.acme configuration."
fi

# ---------------------------------------------------------------------------
# FR-03 continued: exact Compose model for release SHA
# ---------------------------------------------------------------------------
cd -- "$APP_DIR"
export TAG="$RELEASE_SHA"

docker compose config --quiet

services="$(docker compose config --services)"
if [[ "$services" != "app" ]]; then
  die "Error: resolved Compose services must be exactly 'app', got '${services}'."
fi

images="$(docker compose config --images)"
expected_image="${IMAGE_REPO}:${RELEASE_SHA}"
if [[ "$images" != "$expected_image" ]]; then
  die "Error: resolved Compose image must be exactly '${expected_image}', got '${images}'."
fi

# ---------------------------------------------------------------------------
# FR-05: DNS A resolution and immutable image manifests
# ---------------------------------------------------------------------------
dns_out="$(getent ahostsv4 "$APP_HOST")"
dns_match=0
while read -r addr _rest || [[ -n "${addr:-}" ]]; do
  if [[ -n "${addr:-}" && "$addr" == "$EXPECTED_DNS_IPV4" ]]; then
    dns_match=1
    break
  fi
done <<< "$dns_out"
if [[ "$dns_match" -ne 1 ]]; then
  die "Error: DNS for '${APP_HOST}' does not resolve to expected address '${EXPECTED_DNS_IPV4}'."
fi

docker manifest inspect "${IMAGE_REPO}:${RELEASE_SHA}" >/dev/null
docker manifest inspect "${IMAGE_REPO}:${ROLLBACK_SHA}" >/dev/null

# ---------------------------------------------------------------------------
# FR-06: success report (no deployment performed)
# ---------------------------------------------------------------------------
printf 'rollout-preflight ok %s %s %s %s\n' \
  "$APP_NAME" "$RELEASE_SHA" "$ROLLBACK_SHA" "$APP_HOST"
printf 'No deployment performed\n'

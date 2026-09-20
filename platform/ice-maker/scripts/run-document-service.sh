#!/usr/bin/env bash
set -Eeuo pipefail

usage() { echo "usage: scripts/run-document-service.sh DATA_DIRECTORY [PORT]" >&2; exit 64; }
(( $# == 1 || $# == 2 )) || usage
requested_data_dir=$1
port=${2:-8080}
[[ "$requested_data_dir" == /* && "$requested_data_dir" != *$'\n'* ]] || {
  echo "data directory must be an absolute canonical path" >&2
  exit 64
}
[[ -d "$requested_data_dir" && ! -L "$requested_data_dir" ]] || {
  echo "data directory must be an existing ordinary directory" >&2
  exit 64
}
data_dir=$(cd "$requested_data_dir" && pwd -P)
[[ "$data_dir" == "$requested_data_dir" ]] || {
  echo "data directory may not contain links or aliases" >&2
  exit 64
}
operator_home=${HOME:-}
case "$data_dir" in
  /|/home|/root|"$operator_home") echo "refusing a broad or home data directory" >&2; exit 64 ;;
esac
[[ -w "$data_dir" ]] || { echo "data directory is not writable" >&2; exit 65; }
[[ "$port" =~ ^[1-9][0-9]{3,4}$ && "$port" -ge 1024 && "$port" -le 65535 ]] || {
  echo "port must be an unprivileged decimal value from 1024 through 65535" >&2
  exit 64
}

run_uid=$(id -u)
run_gid=$(id -g)
[[ "$run_uid" -ne 0 ]] || { echo "run as a non-root operator" >&2; exit 77; }
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
proxy_script="$project_root/scripts/loopback-uds-proxy.py"
[[ -f "$proxy_script" && ! -L "$proxy_script" ]] || {
  echo "loopback relay is missing or linked" >&2
  exit 69
}
python_candidate=$(command -v python3) || { echo "host Python 3 is required" >&2; exit 69; }
python_executable=$(readlink -f "$python_candidate")
[[ "$python_executable" == /* && -f "$python_executable" && -x "$python_executable" && ! -L "$python_executable" ]] || {
  echo "host Python 3 identity is unsafe" >&2
  exit 69
}

runtime_dir="$data_dir/.document-service-runtime"
if [[ ! -e "$runtime_dir" ]]; then
  mkdir -m 0700 -- "$runtime_dir"
fi
[[ -d "$runtime_dir" && ! -L "$runtime_dir" ]] || {
  echo "service runtime directory is unsafe" >&2
  exit 73
}
[[ $(cd "$runtime_dir" && pwd -P) == "$runtime_dir" ]] || {
  echo "service runtime directory contains an alias" >&2
  exit 73
}
runtime_identity=$(stat -c '%u|%g|%a|%h' "$runtime_dir")
[[ "$runtime_identity" == "$run_uid|$run_gid|700|2" ]] || {
  echo "service runtime directory ownership or mode is unsafe" >&2
  exit 73
}
unix_socket="$runtime_dir/service.sock"
pid_file="$runtime_dir/proxy.pid"

image='ice-maker/document-service:local'
image_info=$(docker image inspect --format '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{.Config.User}}' "$image" 2>/dev/null) || {
  echo "build the pinned image first" >&2
  exit 69
}
IFS='|' read -r image_id source_digest image_user <<<"$image_info"
[[ "$image_id" =~ ^sha256:[0-9a-f]{64}$ && "$source_digest" =~ ^[0-9a-f]{64}$ && "$image_user" == '65532:65532' ]] || {
  echo "image identity or user contract is invalid" >&2
  exit 69
}

proxy_digest=$(sha256sum "$proxy_script" | cut -d' ' -f1)
run_digest=$(sha256sum "${BASH_SOURCE[0]}" | cut -d' ' -f1)
data_digest=$(printf '%s' "$data_dir" | sha256sum | cut -d' ' -f1)
runtime_contract="cpu=2;memory=8g;swap=8g;pids=256;readonly=true;capdrop=ALL;nnp=true;network=none;proxy=$proxy_digest;run=$run_digest"
runtime_digest=$(printf '%s' "$runtime_contract" | sha256sum | cut -d' ' -f1)

name='ice-maker-document-service'
expected_meta="running|healthy|$image_id|$source_digest|$data_digest|$port|$runtime_digest"
inspect_format='{{.State.Status}}|{{.State.Health.Status}}|{{.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "ice-maker.data-digest"}}|{{index .Config.Labels "ice-maker.port"}}|{{index .Config.Labels "ice-maker.runtime"}}'
container_exists=false
if docker inspect "$name" >/dev/null 2>&1; then
  container_exists=true
  existing_meta=$(docker inspect --format "$inspect_format" "$name")
  existing_mount=$(docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{end}}' "$name")
  existing_limits=$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.PidsLimit}}|{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}' "$name")
  if [[ "$existing_meta" != "$expected_meta" \
    || "$existing_mount" != "bind|$data_dir|/data|true" \
    || "$existing_limits" != 'true|2000000000|8589934592|8589934592|256|none|{}' ]]; then
    echo "container name is occupied by a different or unhealthy runtime" >&2
    exit 73
  fi
fi

if [[ "$container_exists" == false ]]; then
  if [[ -e "$unix_socket" || -L "$unix_socket" || -e "$pid_file" || -L "$pid_file" ]]; then
    if ! "$python_executable" -c '
import os, socket, stat, sys
parent_path, expected_uid = sys.argv[1], int(sys.argv[2])
flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
parent = os.open(parent_path, flags)
try:
    try:
        pid_before = os.stat("proxy.pid", dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        pid_before = None
    if pid_before is not None:
        if not stat.S_ISREG(pid_before.st_mode) or pid_before.st_uid != expected_uid or pid_before.st_nlink != 1 or stat.S_IMODE(pid_before.st_mode) != 0o600:
            raise SystemExit(1)
        pid_fd = os.open("proxy.pid", os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent)
        try:
            content = os.read(pid_fd, 32)
            if os.read(pid_fd, 1) or os.fstat(pid_fd).st_ino != pid_before.st_ino:
                raise SystemExit(1)
        finally:
            os.close(pid_fd)
        try:
            pid = int(content)
        except ValueError:
            raise SystemExit(1)
        if pid <= 0 or os.path.exists(f"/proc/{pid}"):
            raise SystemExit(1)
        pid_after = os.stat("proxy.pid", dir_fd=parent, follow_symlinks=False)
        if (pid_before.st_dev, pid_before.st_ino, pid_before.st_uid) != (pid_after.st_dev, pid_after.st_ino, pid_after.st_uid):
            raise SystemExit(1)
        os.unlink("proxy.pid", dir_fd=parent)
    try:
        before = os.stat("service.sock", dir_fd=parent, follow_symlinks=False)
    except FileNotFoundError:
        before = None
    if before is not None:
        if not stat.S_ISSOCK(before.st_mode) or before.st_uid != expected_uid or before.st_nlink != 1:
            raise SystemExit(1)
        probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        probe.settimeout(1)
        try:
            probe.connect(f"/proc/self/fd/{parent}/service.sock")
        except (ConnectionRefusedError, FileNotFoundError):
            pass
        else:
            raise SystemExit(1)
        finally:
            probe.close()
        after = os.stat("service.sock", dir_fd=parent, follow_symlinks=False)
        if (before.st_dev, before.st_ino, before.st_uid) != (after.st_dev, after.st_ino, after.st_uid):
            raise SystemExit(1)
        os.unlink("service.sock", dir_fd=parent)
    os.fsync(parent)
finally:
    os.close(parent)
' "$runtime_dir" "$run_uid"; then
      echo "service socket exists without its owned container" >&2
      exit 73
    fi
  fi
  container_id=$(docker run --detach --init --restart=no --stop-timeout=30 \
    --name "$name" \
    --user "$run_uid:$run_gid" \
    --label "org.opencontainers.image.revision=$source_digest" \
    --label "ice-maker.data-digest=$data_digest" \
    --label "ice-maker.port=$port" \
    --label "ice-maker.runtime=$runtime_digest" \
    --network none \
    --cap-drop=ALL \
    --security-opt=no-new-privileges:true \
    --read-only \
    --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=512m,uid=$run_uid,gid=$run_gid,mode=1700" \
    --cpus=2 \
    --memory=8g \
    --memory-swap=8g \
    --pids-limit=256 \
    --mount "type=bind,src=$data_dir,dst=/data,readonly=false,bind-propagation=rprivate" \
    --pull=never \
    "$image_id")
  [[ "$container_id" =~ ^[0-9a-f]{64}$ ]] || { echo "container start returned invalid identity" >&2; exit 70; }
  for _ in {1..30}; do
    health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{end}}' "$name" 2>/dev/null || true)
    [[ "$health" == healthy ]] && break
    [[ "$health" != unhealthy ]] || break
    sleep 1
  done
  [[ ${health:-} == healthy ]] || {
    echo "container did not become healthy; inspect local container logs" >&2
    exit 70
  }
fi

[[ -S "$unix_socket" && ! -L "$unix_socket" ]] || {
  echo "container did not publish its fixed Unix socket" >&2
  exit 70
}
socket_identity=$(stat -c '%u|%g|%h' "$unix_socket")
[[ "$socket_identity" == "$run_uid|$run_gid|1" ]] || {
  echo "service socket ownership is unsafe" >&2
  exit 70
}

http_health() {
  "$python_executable" -c 'import http.client,sys; c=http.client.HTTPConnection("127.0.0.1",int(sys.argv[1]),timeout=2); c.request("GET","/healthz"); r=c.getresponse(); raise SystemExit(0 if r.status==200 and r.read()==b"{\"status\":\"ok\"}" else 1)' "$port" >/dev/null 2>&1
}

relay_name='ice-maker-document-relay'
relay_expected="running|$image_id|$source_digest|$data_digest|$port|$runtime_digest"
relay_format='{{.State.Status}}|{{.Image}}|{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "ice-maker.data-digest"}}|{{index .Config.Labels "ice-maker.port"}}|{{index .Config.Labels "ice-maker.runtime"}}'
if docker inspect "$relay_name" >/dev/null 2>&1; then
  relay_meta=$(docker inspect --format "$relay_format" "$relay_name")
  relay_mount=$(docker inspect --format '{{range .Mounts}}{{.Type}}|{{.Source}}|{{.Destination}}|{{.RW}}{{end}}' "$relay_name")
  relay_limits=$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}|{{.HostConfig.NanoCpus}}|{{.HostConfig.Memory}}|{{.HostConfig.MemorySwap}}|{{.HostConfig.PidsLimit}}|{{.HostConfig.NetworkMode}}|{{json .HostConfig.PortBindings}}|{{json .HostConfig.CapDrop}}|{{json .HostConfig.SecurityOpt}}' "$relay_name")
  if [[ "$relay_meta" == "$relay_expected" \
    && "$relay_mount" == "bind|$runtime_dir|/run/ice-maker|true" \
    && "$relay_limits" == 'true|250000000|134217728|134217728|64|host|{}|["ALL"]|["no-new-privileges:true"]' \
    && -f "$pid_file" && ! -L "$pid_file" \
    && $(stat -c '%u|%g|%a|%h' "$pid_file") == "$run_uid|$run_gid|600|1" \
    && http_health ]]; then
    echo "reusing healthy parser and relay on http://127.0.0.1:$port"
    exit 0
  fi
  echo "relay container name is occupied by a different or unhealthy runtime" >&2
  exit 73
fi

relay_id=$(docker run --detach --init --restart=no --stop-timeout=10 \
  --name "$relay_name" \
  --user "$run_uid:$run_gid" \
  --label "org.opencontainers.image.revision=$source_digest" \
  --label "ice-maker.data-digest=$data_digest" \
  --label "ice-maker.port=$port" \
  --label "ice-maker.runtime=$runtime_digest" \
  --network host \
  --no-healthcheck \
  --cap-drop=ALL \
  --security-opt=no-new-privileges:true \
  --read-only \
  --tmpfs "/tmp:rw,noexec,nosuid,nodev,size=16m,uid=$run_uid,gid=$run_gid,mode=1700" \
  --cpus=0.25 \
  --memory=128m \
  --memory-swap=128m \
  --pids-limit=64 \
  --mount "type=bind,src=$runtime_dir,dst=/run/ice-maker,readonly=false,bind-propagation=rprivate" \
  --entrypoint /usr/local/bin/python3 \
  --pull=never \
  "$image_id" \
  /opt/ice-maker/scripts/loopback-uds-proxy.py \
  --listen 127.0.0.1 --port "$port" \
  --unix-socket /run/ice-maker/service.sock \
  --pid-file /run/ice-maker/proxy.pid)
[[ "$relay_id" =~ ^[0-9a-f]{64}$ ]] || { echo "relay start returned invalid identity" >&2; exit 70; }
for _ in {1..30}; do
  relay_state=$(docker inspect --format '{{.State.Status}}' "$relay_name" 2>/dev/null || true)
  if [[ "$relay_state" == running && -f "$pid_file" && ! -L "$pid_file" ]] && http_health; then
    echo "started $name with network disabled on http://127.0.0.1:$port"
    exit 0
  fi
  [[ "$relay_state" != exited && "$relay_state" != dead ]] || break
  sleep 1
done
echo "loopback relay container did not become healthy" >&2
exit 70

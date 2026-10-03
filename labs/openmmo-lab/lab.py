#!/usr/bin/env python3
"""Pinned, local-only OpenMMO trial controller; Python standard library only."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]


def run(argv, **kwargs):
    if argv[:2] == ["docker", "compose"]:
        # Explicit workspace configuration wins over ambient shell overrides.
        kwargs["env"] = {k: v for k, v in os.environ.items()
                         if k not in {"GOOGLE_CLIENT_ID", "ADMIN_EMAILS"}
                         and not k.startswith("COMPOSE_")}
    return subprocess.run(argv, check=True, text=True, **kwargs)


def git(source, *args):
    return run(["git", "-C", str(source), *args], capture_output=True).stdout.strip()


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def load_lock(path=HERE / "upstream.lock.json"):
    lock = json.loads(path.read_text())
    if lock.get("schema") != 1:
        raise ValueError("unsupported lock schema")
    for key, length in [("commit", 40), ("asset_revision", 40), ("asset_lock_sha256", 64)]:
        if not re.fullmatch(f"[0-9a-f]{{{length}}}", lock.get(key, "")):
            raise ValueError(f"invalid {key}")
    if lock.get("repository") != "https://github.com/Julian-adv/OpenMMO.git":
        raise ValueError("unexpected upstream repository")
    if lock.get("license") != "PolyForm-Noncommercial-1.0.0":
        raise ValueError("upstream license must be reviewed before changing it")
    return lock


def verify_source(source, lock):
    source = source.resolve()
    if source == REPO or REPO in source.parents:
        raise ValueError("use a separate upstream checkout outside newclear")
    if Path(git(source, "rev-parse", "--show-toplevel")).resolve() != source:
        raise ValueError("source must be the root of its own Git checkout")
    if git(source, "rev-parse", "HEAD") != lock["commit"]:
        raise ValueError("upstream HEAD differs from lock; checkout the pinned commit")
    if git(source, "status", "--porcelain", "--untracked-files=no"):
        raise ValueError("upstream has tracked changes; baseline trial requires a clean checkout")
    if git(source, "ls-files", "--others", "--exclude-standard"):
        raise ValueError("upstream has untracked files; keep experiment files outside this checkout")
    asset_lock = source / "assets.lock"
    if digest(asset_lock) != lock["asset_lock_sha256"]:
        raise ValueError("assets.lock checksum differs from pin")
    lines = asset_lock.read_text().splitlines()
    if lines[:2] != [f"repo {lock['asset_repository']}", f"revision {lock['asset_revision']}"]:
        raise ValueError("asset dataset/revision differs from pin")
    for name in ["docker/server.Dockerfile", "docker/client.Dockerfile", "docker/terrain-bake.sh"]:
        if not (source / name).is_file():
            raise ValueError(f"missing build input: {name}")


def compose_document(source, workspace, port, lock):
    project = "openmmo-lab-" + hashlib.sha256(str(workspace).encode()).hexdigest()[:10]
    tag = lock["commit"][:12]
    server_image = f"local/openmmo-lab-server:{tag}"
    build = {"context": str(source), "dockerfile": "docker/server.Dockerfile", "target": "server"}
    return {
        "name": project,
        "services": {
            "terrain-init": {
                "image": server_image, "pull_policy": "never", "build": build,
                "entrypoint": ["/usr/local/bin/terrain-bake.sh"],
                "environment": {"TERRAIN_DIR": "/terrain", "TERRAIN_REGION_MIN": "-2", "TERRAIN_REGION_MAX": "1"},
                "volumes": ["terrain:/terrain"], "restart": "no",
            },
            "server": {
                "image": server_image, "pull_policy": "never", "build": build,
                "depends_on": {"terrain-init": {"condition": "service_completed_successfully"}},
                "environment": {"STATE_DIR": "/state", "NPC_DATA_DIR": "/npcs", "TERRAIN_DIR": "/terrain",
                    "GOOGLE_CLIENT_ID": "${GOOGLE_CLIENT_ID:?set your Google Web client ID}",
                    "ADMIN_EMAILS": "${ADMIN_EMAILS:-}", "RUST_LOG": "info"},
                "command": ["--bind", "0.0.0.0", "--api-bind", "0.0.0.0"],
                "volumes": ["state:/state", "npcs:/npcs", "terrain:/terrain"],
                "healthcheck": {"test": ["CMD", "curl", "-fsS", "http://localhost:10007/api/announcements"],
                    "interval": "5s", "timeout": "3s", "retries": 12, "start_period": "10s"},
                "restart": "no",
            },
            "client": {
                "image": f"local/openmmo-lab-client:{tag}", "pull_policy": "never",
                "build": {"context": str(source), "dockerfile": "docker/client.Dockerfile"},
                "depends_on": {"server": {"condition": "service_healthy"}},
                "environment": {"GOOGLE_CLIENT_ID": "${GOOGLE_CLIENT_ID:?set your Google Web client ID}"},
                "volumes": ["terrain:/terrain:ro"],
                "ports": [{"target": 80, "published": str(port), "host_ip": "127.0.0.1", "protocol": "tcp"}],
                "restart": "no",
            },
        },
        "volumes": {"state": {}, "npcs": {}, "terrain": {}},
    }


def render(source, workspace, port, lock):
    source, workspace = source.resolve(), workspace.resolve()
    verify_source(source, lock)
    if workspace == REPO or REPO in workspace.parents:
        raise ValueError("runtime workspace must be outside newclear")
    if workspace == source or source in workspace.parents:
        raise ValueError("runtime workspace must be outside the upstream checkout")
    if not 1024 <= port <= 65535:
        raise ValueError("choose a non-privileged port between 1024 and 65535")
    marker = {"source": str(source), "commit": lock["commit"], "port": port}
    manifest = workspace / "lab-state.json"
    expected = json.dumps(compose_document(source, workspace, port, lock), indent=2) + "\n"
    if workspace.exists() and any(workspace.iterdir()):
        if not manifest.is_file() or json.loads(manifest.read_text()) != marker:
            raise ValueError("refusing to overwrite an unowned or different workspace")
        for name in ["lab-state.json", "compose.json", ".env"]:
            if (workspace / name).is_symlink():
                raise ValueError("workspace files must not be symlinks")
        if (workspace / "compose.json").read_text() != expected:
            raise ValueError("compose.json was edited; use a new workspace")
    else:
        workspace.mkdir(parents=True, exist_ok=True)
        manifest.write_text(json.dumps(marker, indent=2) + "\n")
        (workspace / "compose.json").write_text(expected)
        env = workspace / ".env"
        env.write_text("GOOGLE_CLIENT_ID=\nADMIN_EMAILS=\n")
        env.chmod(0o600)
    return {"status": "rendered", "source_commit": lock["commit"], "workspace": str(workspace),
            "url": f"http://127.0.0.1:{port}", "runtime_started": False}


def read_workspace(workspace, lock):
    workspace = workspace.resolve()
    if workspace == REPO or REPO in workspace.parents:
        raise ValueError("runtime workspace must be outside newclear")
    for name in ["lab-state.json", "compose.json", ".env"]:
        if (workspace / name).is_symlink():
            raise ValueError("workspace files must not be symlinks")
    state = json.loads((workspace / "lab-state.json").read_text())
    source = Path(state["source"])
    if not source.is_absolute() or source.resolve() != source:
        raise ValueError("workspace source must be an absolute canonical path")
    if workspace == source or source in workspace.parents:
        raise ValueError("runtime workspace must be outside the upstream checkout")
    if type(state["port"]) is not int or not 1024 <= state["port"] <= 65535:
        raise ValueError("invalid workspace port")
    if state["commit"] != lock["commit"]:
        raise ValueError("workspace pin differs from lock")
    expected = compose_document(source, workspace, state["port"], lock)
    if json.loads((workspace / "compose.json").read_text()) != expected:
        raise ValueError("compose configuration drift; refusing to run it")
    return source


def asset_problems(source):
    problems = []
    for line in (source / "assets.lock").read_text().splitlines():
        if not line.startswith("file "):
            continue
        _, sha, name = line.split(" ", 2)
        if not name.startswith("client/public/"):
            continue
        path = (source / name).resolve()
        if source.resolve() not in path.parents:
            raise ValueError("asset path leaves upstream checkout")
        if not path.is_file():
            problems.append(f"missing: {name}")
        elif digest(path) != sha:
            problems.append(f"checksum mismatch: {name}")
    return problems


def compose_command(workspace, *args):
    project = "openmmo-lab-" + hashlib.sha256(str(workspace).encode()).hexdigest()[:10]
    return ["docker", "compose", "--project-name", project, "--project-directory", str(workspace),
            "--env-file", str(workspace / ".env"), "-f", str(workspace / "compose.json"), *args]


def doctor(workspace, lock):
    source = read_workspace(workspace, lock)
    verify_source(source, lock)
    problems = []
    if not shutil.which("docker"):
        problems.append("Docker CLI/engine and Compose v2 are required")
    else:
        for args in [["docker", "info", "--format", "{{.ServerVersion}}"], ["docker", "compose", "version", "--short"]]:
            try:
                run(args, capture_output=True, timeout=15)
            except (subprocess.SubprocessError, OSError):
                problems.append("Docker engine or Compose v2 is unavailable")
                break
    values = {}
    for line in (workspace / ".env").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            key, value = line.split("=", 1)
            values[key.strip()] = value.strip().strip("\"'")
    if not values.get("GOOGLE_CLIENT_ID", "").endswith(".apps.googleusercontent.com"):
        problems.append("set GOOGLE_CLIENT_ID in workspace .env (Google Web OAuth client)")
    assets = asset_problems(source)
    if assets:
        problems.append(f"{len(assets)} client assets missing or mismatched; run pinned tools/fetch-assets.sh")
    return {"status": "blocked" if problems else "ready-to-build", "problems": problems,
            "asset_problems": len(assets), "runtime_verified": False}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="action", required=True)
    sub.add_parser("check")
    renderer = sub.add_parser("render")
    renderer.add_argument("--source", type=Path, required=True)
    renderer.add_argument("--workspace", type=Path, required=True)
    renderer.add_argument("--port", type=int, default=18080)
    for name in ["doctor", "up", "down", "status"]:
        command = sub.add_parser(name)
        command.add_argument("--workspace", type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        lock = load_lock()
        if args.action == "check":
            result = {"status": "ok", "source_commit": lock["commit"], "runtime_verified": False}
        elif args.action == "render":
            result = render(args.source, args.workspace, args.port, lock)
        elif args.action in ["doctor", "up"]:
            workspace = args.workspace.resolve()
            result = doctor(workspace, lock)
            if result["problems"]:
                print(json.dumps(result, ensure_ascii=False, indent=2))
                return 2
            if args.action == "up":
                run(compose_command(workspace, "build"))
                run(compose_command(workspace, "up", "-d", "--no-build", "--pull", "never"))
                result = {"status": "started", "gameplay_acceptance": "pending"}
        else:
            workspace = args.workspace.resolve()
            read_workspace(workspace, lock)
            command = "down" if args.action == "down" else "ps"
            run(compose_command(workspace, command))
            result = {"status": "stopped-volumes-retained" if command == "down" else "listed"}
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except (ValueError, KeyError, OSError, subprocess.SubprocessError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())

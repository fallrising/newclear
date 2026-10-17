"""Smoke-test the actual Linux Compose package using disposable synthetic state.

Requires an already built --image, Docker Engine and Compose v2. Creates only
uniquely named/labeled containers. Keeps state and sanitized evidence; no prune.
"""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "deployment/docker/compose.yaml"
LABEL = "io.signalhub.instance"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="prebuilt local image tag or digest; never pulls or builds")
    parser.add_argument("--state-dir", required=True, help="new absolute private directory; parent must exist")
    parser.add_argument("--port", type=int, help="unused loopback port, 1024..65535; otherwise select an available port")
    args = parser.parse_args()
    if os.getuid() == 0 or os.getgid() == 0:
        parser.error("run as a non-root user with a non-root primary group")
    if args.port is not None and not 1024 <= args.port <= 65535:
        parser.error("port must be from 1024 through 65535")
    # Fail before creating state if prerequisites are missing.
    subprocess.run(["docker", "compose", "version"], check=True, capture_output=True)
    subprocess.run(["docker", "image", "inspect", args.image], check=True, capture_output=True)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", args.port or 0))
        port = listener.getsockname()[1]
    if not 1024 <= port <= 65535:
        parser.error("port must be from 1024 through 65535")
    state = Path(args.state_dir)
    subprocess.run([sys.executable, str(ROOT / "deployment/docker/init.py"), "--state-dir", str(state), "--port", str(port)], check=True, capture_output=True)
    evidence = state / "evidence"
    evidence.mkdir(mode=0o700)
    run_id = "signalhub-smoke-" + secrets.token_hex(8)
    env = {key: value for key, value in os.environ.items() if not key.startswith("SIGNALHUB_")}
    env.update(SIGNALHUB_IMAGE=args.image, SIGNALHUB_INSTANCE_LABEL=run_id)
    compose = ["docker", "compose", "--project-name", run_id, "--env-file", str(state / "compose.env"), "-f", str(COMPOSE)]
    owned = set()
    steps = []
    credentials = [(state / "secrets" / (role + ".token")).read_text().strip() for role in ("owner", "readonly", "source")]

    def redact(text):
        for token in credentials:
            text = text.replace(token, "[redacted]")
        return text

    def command(arguments, check=True):
        result = subprocess.run(arguments, env=env, capture_output=True, text=True, timeout=90)
        if check and result.returncode:
            raise RuntimeError("container command failed: " + redact(result.stderr[-2000:]))
        return result

    def inspect(container):
        return json.loads(command(["docker", "inspect", container]).stdout)[0]

    def own(container):
        info = inspect(container)
        if info["Config"]["Labels"].get(LABEL) != run_id:
            raise RuntimeError("refusing container without this smoke run's label")
        owned.add(info["Id"])
        return info

    def compose_container():
        ids = command(compose + ["ps", "--all", "--quiet", "hub"]).stdout.split()
        if len(ids) != 1:
            raise RuntimeError("expected one package container")
        return own(ids[0])

    def call(method, path, role=None, body=None, want=200):
        headers = {"Content-Type": "application/cloudevents+json"}
        if role:
            headers["Authorization"] = "Bearer " + (state / "secrets" / (role + ".token")).read_text().strip()
        connection = http.client.HTTPConnection("127.0.0.1", port, timeout=3)
        try:
            connection.request(method, path, body=body, headers=headers)
            response = connection.getresponse()
            raw = response.read()
            if response.status != want:
                raise AssertionError(f"{method} {path}: expected {want}, got {response.status}")
            if any(token.encode() in raw for token in credentials):
                raise AssertionError("credential found in response")
            return json.loads(raw)
        finally:
            connection.close()

    def wait_ready(container):
        for _ in range(100):
            if not inspect(container)["State"]["Running"]:
                raise RuntimeError("package container stopped before readiness")
            logs = command(["docker", "logs", container]).stderr
            if f"signalhub listening on 127.0.0.1:{port}" not in logs:
                time.sleep(0.1)
                continue
            try:
                call("GET", "/readyz")
                return
            except (OSError, http.client.HTTPException):
                time.sleep(0.1)
        raise RuntimeError("package readiness deadline exceeded")

    def digest(path):
        return hashlib.sha256(path.read_bytes()).hexdigest()

    try:
        command(compose + ["up", "--detach", "--no-build", "--pull", "never"])
        info = compose_container()
        container = info["Id"]
        wait_ready(container)
        host = info["HostConfig"]
        assert host["NetworkMode"] == "host" and host["ReadonlyRootfs"]
        assert f"127.0.0.1:{port}" in info["Config"]["Cmd"]
        assert "-backup-dir" in info["Config"]["Cmd"] and "-archive-dir" not in info["Config"]["Cmd"]
        assert host["RestartPolicy"]["Name"] == "unless-stopped"
        assert "ALL" in [cap.upper() for cap in host["CapDrop"]]
        assert any(value.startswith("no-new-privileges") for value in host["SecurityOpt"])
        assert info["Config"]["User"] == f"{os.getuid()}:{os.getgid()}"
        mounts = {mount["Destination"]: mount for mount in info["Mounts"]}
        for target, writable in (("/etc/signalhub", False), ("/run/secrets", False), ("/var/lib/signalhub", True), ("/var/backups/signalhub", True)):
            assert mounts[target]["Type"] == "bind" and mounts[target]["RW"] == writable
        assert host["Memory"] > 0 and host["NanoCpus"] > 0 and host["PidsLimit"] > 0
        assert host["LogConfig"]["Config"].get("max-size") and host["LogConfig"]["Config"].get("max-file")
        (evidence / "package-security.json").write_text(json.dumps({"network": host["NetworkMode"], "readonly_rootfs": host["ReadonlyRootfs"], "user": info["Config"]["User"], "cap_drop": host["CapDrop"], "security_opt": host["SecurityOpt"], "mounts": {target: mount["RW"] for target, mount in mounts.items()}}, indent=2) + "\n")
        steps.append("actual Compose security and four bind mounts")
        event = {"specversion": "1.0", "source": "urn:example:demo:docker", "id": run_id, "type": "demo.event.created", "time": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "summary": "synthetic personal Docker package smoke", "data": {"synthetic": True}}
        body = json.dumps(event).encode()
        call("POST", "/v1/events", body=body, want=401)
        call("POST", "/v1/events", "readonly", body, want=403)
        call("GET", "/v1/events", "source", want=403)
        first = call("POST", "/v1/events", "source", body, want=202)
        repeated = call("POST", "/v1/events", "source", body)
        assert repeated["seq"] == first["seq"] and repeated["duplicate"]
        steps.append("401/403 auth and 202/200 immutable seq")
        command(compose + ["up", "--detach", "--no-build", "--pull", "never", "--force-recreate"])
        recreated = compose_container()["Id"]
        assert recreated != container
        wait_ready(recreated)
        assert call("GET", "/v1/events/" + str(first["seq"]), "readonly")["item"]["event"] == event
        assert call("POST", "/v1/events", "source", body)["seq"] == first["seq"]
        steps.append("container recreation preserves event and original seq")
        for _ in range(50):
            automatic = list((state / "backups").glob("signalhub-*.sqlite.manifest.json"))
            if automatic:
                break
            time.sleep(0.1)
        assert automatic, "default backup-dir did not produce a startup snapshot pair"
        command(compose + ["exec", "--no-TTY", "hub", "/signalhub", "backup", "--db", "/var/lib/signalhub/events.sqlite", "--output", "/var/backups/signalhub/manual.sqlite"])
        snapshot = state / "backups/manual.sqlite"
        manifest_path = Path(str(snapshot) + ".manifest.json")
        before = (digest(snapshot), digest(manifest_path))
        manifest = json.loads(manifest_path.read_text())
        assert manifest["sha256"] == before[0] and manifest["size_bytes"] == snapshot.stat().st_size
        recovery = state / "recovery"
        subprocess.run([sys.executable, str(ROOT / "deployment/docker/init.py"), "--state-dir", str(recovery), "--port", "8080"], check=True, capture_output=True)
        credentials.extend(path.read_text().strip() for path in (recovery / "secrets").iterdir())
        assert json.loads((recovery / "config/config.json").read_text())["subscriptions"] == []
        common = ["docker", "run", "--label", LABEL + "=" + run_id, "--user", f"{os.getuid()}:{os.getgid()}", "--network", "none", "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges:true", "--memory", "512m", "--cpus", "1", "--pids-limit", "64"]
        restore_name = run_id + "-restore"
        # Add exact names before starting: cleanup can find an interrupted run.
        command(common + ["--name", restore_name, "--mount", f"type=bind,src={state / 'backups'},dst=/input,readonly", "--mount", f"type=bind,src={recovery / 'data'},dst=/data", args.image, "restore", "--backup", "/input/manual.sqlite", "--db", "/data/restored.sqlite", "--reason", "synthetic package smoke"])
        own(restore_name)
        query_name = run_id + "-query"
        command(common + ["--detach", "--name", query_name, "--mount", f"type=bind,src={recovery / 'data'},dst=/data", "--mount", f"type=bind,src={recovery / 'config'},dst=/etc/signalhub,readonly", "--mount", f"type=bind,src={recovery / 'secrets'},dst=/run/secrets,readonly", args.image, "-config", "/etc/signalhub/config.json", "-db", "/data/restored.sqlite", "-owner-token-ref", "file:/run/secrets/owner.token", "-readonly-token-ref", "file:/run/secrets/readonly.token", "-listen", "127.0.0.1:8080"])
        query = own(query_name)
        for _ in range(100):
            logs = command(["docker", "logs", query["Id"]]).stderr
            if "signalhub listening on 127.0.0.1:8080" in logs:
                break
            if not inspect(query["Id"])["State"]["Running"]:
                raise RuntimeError("isolated recovery daemon stopped")
            time.sleep(0.1)
        else:
            raise RuntimeError("isolated recovery startup deadline exceeded")
        assert inspect(query["Id"])["HostConfig"]["NetworkMode"] == "none"
        command(["docker", "stop", "--time", "20", query["Id"]])
        with sqlite3.connect((recovery / "data/restored.sqlite").as_uri() + "?mode=ro", uri=True) as db:
            row = db.execute("SELECT seq,raw_json FROM events WHERE source=? AND id=?", (event["source"], event["id"])).fetchone()
            assert row and row[0] == first["seq"] and json.loads(row[1]) == event
            assert db.execute("PRAGMA integrity_check").fetchone()[0] == "ok"
        assert before == (digest(snapshot), digest(manifest_path)), "original backup pair changed"
        steps.append("startup snapshot; manual consistent backup pair; network-none restore/startup with new credentials and no subscriptions; stopped copy queried via read-only SQLite; original pair preserved")
        (evidence / "result.json").write_text(json.dumps({"status": "passed", "checks": steps, "seq": first["seq"], "snapshot_sha256": before[0]}, indent=2) + "\n")
        print("PASS: Compose auth, recreation persistence, startup/manual backup and isolated restore/SQLite query; sanitized evidence retained in state-dir/evidence")
    except BaseException as error:
        (evidence / "result.json").write_text(json.dumps({"status": "failed", "checks_passed": steps, "error": redact(str(error))}, indent=2) + "\n")
        raise
    finally:
        # Discover only this unpredictable project/name, then require our label.
        found = command(compose + ["ps", "--all", "--quiet"], check=False)
        candidates = set(found.stdout.split()) | {run_id + "-restore", run_id + "-query"} | owned
        cleanup_errors = []
        for candidate in candidates:
            result = command(["docker", "inspect", candidate], check=False)
            if result.returncode:
                continue
            info = json.loads(result.stdout)[0]
            if info["Config"]["Labels"].get(LABEL) != run_id:
                cleanup_errors.append("refused container without this run label")
                continue
            identifier = info["Id"]
            logs = command(["docker", "logs", identifier], check=False)
            (evidence / (identifier[:12] + ".log")).write_text(redact(logs.stdout + logs.stderr))
            removed = command(["docker", "rm", "--force", identifier], check=False)
            if removed.returncode:
                cleanup_errors.append("exact smoke container removal failed")
        (evidence / "cleanup.json").write_text(json.dumps({"status": "failed" if cleanup_errors else "passed", "errors": cleanup_errors}, indent=2) + "\n")
        if cleanup_errors:
            raise RuntimeError("smoke cleanup incomplete; inspect evidence/cleanup.json")


if __name__ == "__main__":
    main()

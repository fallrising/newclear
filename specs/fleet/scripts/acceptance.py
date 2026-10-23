#!/usr/bin/env python3
"""Isolated real-Docker AC-02/04 acceptance. Run through the shared workspace launcher.

Requires prebuilt fleetd/fleet-agent/hello-healthz, Docker, Compose, and registry:2.
Uses no Cloudflare configuration. Never counts this run as AC-03 evidence.
State and logs are preserved; only this invocation's processes/containers are stopped.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import time
import urllib.error
import urllib.request


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bin-dir", type=Path, required=True)
    parser.add_argument("--source-id", required=True)
    args = parser.parse_args()
    evidence = Path(os.environ["AGENT_EVIDENCE_DIR"])
    build = Path(os.environ["AGENT_BUILD_DIR"])
    state = evidence / "state"
    state.mkdir(mode=0o700)  # Refuse to reuse potentially live state.
    agent_state = state / "agent"
    agent_state.mkdir(mode=0o700)
    run_id = "acceptance-" + secrets.token_hex(4)
    project = "fleet-" + run_id
    registry_name = project + "-registry"
    cp_port, registry_port = 18765, 15001
    for port in (cp_port, registry_port, 19600, 20000):
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", port))
    base = f"http://127.0.0.1:{cp_port}"
    op_token = "flt_op_" + secrets.token_hex(24)
    bs_token = "flt_bs_" + secrets.token_hex(24)
    image = f"127.0.0.1:{registry_port}/fleet-acceptance/hello:{run_id}"
    processes = {}
    logs = []
    results = {"source_id": args.source_id, "ac03": "not_run", "checks": [], "binaries": {}}
    before = []
    registry_created = False
    workload_created = False
    compose_file = agent_state / "services" / run_id / "docker-compose.yml"

    def record(name, **data):
        results["checks"].append({"name": name, "status": "passed", **data})
        (evidence / "acceptance.json").write_text(json.dumps(results, indent=2) + "\n")
        print("PASS", name, flush=True)

    def command(*argv):
        result = subprocess.run(argv, capture_output=True, text=True, timeout=120)
        with (evidence / "commands.log").open("a") as log:
            log.write(json.dumps(list(map(str, argv))) + "\n" + result.stdout + result.stderr)
        if result.returncode:
            raise RuntimeError(f"command failed ({result.returncode}): {argv[0:3]}")
        return result.stdout.strip()

    def api(path, method="GET", body=None, expected=(200,)):
        req = urllib.request.Request(base + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={"Authorization": "Bearer " + op_token, "Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(req, timeout=3)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            value = json.loads(response.read())
            if response.status not in expected:
                raise AssertionError(f"{method} {path}: HTTP {response.status}: {value}")
            return value

    def wait_for(label, check, timeout=60):
        deadline = time.monotonic() + timeout
        last = None
        while time.monotonic() < deadline:
            try:
                last = check()
                if last:
                    return last
            except (OSError, urllib.error.URLError, AssertionError) as exc:
                last = str(exc)
            time.sleep(0.25)
        raise AssertionError(f"timeout: {label}: {last}")

    def start(which):
        env = {k: v for k, v in os.environ.items() if not k.startswith(("FLEET", "CF_"))}
        if which == "fleetd":
            env.update(FLEETD_LISTEN=f"127.0.0.1:{cp_port}", FLEETD_DB=str(state / "fleet.db"),
                FLEET_UI_HOSTNAME="fleet.example.test", FLEET_API_HOSTNAME="fleet-api.example.test",
                FLEET_BASE_DOMAIN="example.test", FLEETD_BOOTSTRAP_OPERATOR_TOKEN=op_token,
                FLEETD_BOOTSTRAP_NODE_TOKEN=bs_token)
        else:
            env.update(FLEET_URL=base, FLEET_NODE_ID="acceptance-node", FLEET_STATE_DIR=str(agent_state),
                FLEET_TOKEN_FILE=str(agent_state / "agent.token"), FLEET_BOOTSTRAP_TOKEN=bs_token,
                FLEET_INTERVAL="1s")
        log = (evidence / (which + ".log")).open("ab")
        logs.append(log)
        processes[which] = subprocess.Popen([str(args.bin_dir / which)], env=env, stdout=log, stderr=log)

    def stop(which):
        proc = processes.pop(which, None)
        if proc is not None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)

    def catalog():
        return api("/api/v1/services/" + run_id)

    def converged(desired):
        view = catalog()
        return view if (view["desired_state"] == desired and view["actual_state"] == desired
            and view["generation"] == view["applied_generation"]
            and (desired != "running" or view["health"] == "healthy")) else False

    def container():
        return json.loads(command("docker", "inspect", project + "-app"))[0]

    try:
        for name in ("fleetd", "fleet-agent", "hello-healthz"):
            binary = args.bin_dir / name
            results["binaries"][name] = hashlib.sha256(binary.read_bytes()).hexdigest()
        before = command("docker", "ps", "-aq").splitlines()
        results["docker_version"] = command("docker", "version", "--format", "{{.Server.Version}}")
        results["compose_version"] = command("docker", "compose", "version", "--short")
        command("docker", "image", "inspect", "registry:2")
        command("docker", "run", "-d", "--name", registry_name,
                "-p", f"127.0.0.1:{registry_port}:5000", "registry:2")
        registry_created = True
        wait_for("registry", lambda: urllib.request.urlopen(f"http://127.0.0.1:{registry_port}/v2/", timeout=2).status == 200)
        context = build / "hello-image"
        context.mkdir()
        shutil.copy2(args.bin_dir / "hello-healthz", context / "hello-healthz")
        (context / "Dockerfile").write_text('FROM scratch\nCOPY hello-healthz /hello-healthz\nENTRYPOINT ["/hello-healthz"]\n')
        command("docker", "build", "-t", image, str(context))
        command("docker", "push", image)
        start("fleetd")
        wait_for("control plane", lambda: api("/healthz")["status"] == "ok")
        start("fleet-agent")
        wait_for("node online", lambda: api("/api/v1/nodes/acceptance-node")["status"] == "online")
        record("node_registration_and_heartbeat")
        literal_env = {"DOLLAR": "${DO_NOT_EXPAND}", "MULTILINE": "first\nEXTRA=literal",
            "QUOTE": "it's literal # text", "TAIL": "ends\\", "BACKSLASH": "one\\two", "EMPTY": ""}
        argv = ["true", "hello # world", "", "${DO_NOT_EXPAND}", "quote'\"", "one\ntwo"]
        doc = {"apiVersion": "fleet.catalog/v1", "kind": "Service", "metadata": {"name": run_id},
            "spec": {"node": "acceptance-node", "image": image, "args": argv, "env": literal_env,
            "expose": {"mode": "public", "port": 8080}, "resources": {"memory": "64M", "cpus": "0.10"}}}
        api("/api/v1/deploy", "POST", {"fleet": doc, "image": image, "git_sha": args.source_id}, (201,))
        workload_created = True
        view = wait_for("initial deploy", lambda: converged("running"))
        first = container()
        assert first["HostConfig"]["PortBindings"]["8080/tcp"][0]["HostIp"] == "127.0.0.1"
        assert not first["HostConfig"]["Privileged"] and first["HostConfig"]["NetworkMode"] != "host"
        env = dict(item.split("=", 1) for item in first["Config"]["Env"])
        assert all(env[key] == value for key, value in literal_env.items()), (env, literal_env)
        assert "EXTRA" not in env
        assert first["Config"]["Cmd"] == argv, first["Config"]["Cmd"]
        record("deploy_healthy_literal_env_argv_loopback", generation=view["generation"])
        time.sleep(4)
        assert container()["Id"] == first["Id"], "same generation keeps recreating"
        record("steady_generation_does_not_recreate")
        (compose_file.parent / "secrets.env").write_text("NODE_SECRET='synthetic test secret'\n")
        os.chmod(compose_file.parent / "secrets.env", 0o600)
        wait_for("secret merge applied", lambda: container()["Id"] != first["Id"])
        wait_for("secret merge healthy", lambda: converged("running"))
        merged = dict(item.split("=", 1) for item in container()["Config"]["Env"])
        assert all(merged[key] == value for key, value in literal_env.items())
        assert merged["NODE_SECRET"] == "synthetic test secret" and "EXTRA" not in merged
        record("node_secret_merge_preserves_literal_values")
        api("/api/v1/services/" + run_id + "/stop", "POST", {})
        wait_for("stop", lambda: converged("stopped"))
        assert not container()["State"]["Running"]
        record("stop_retains_container")
        api("/api/v1/services/" + run_id + "/start", "POST", {})
        wait_for("start", lambda: converged("running"))
        previous = container()["Id"]
        api("/api/v1/services/" + run_id + "/redeploy", "POST", {})
        wait_for("redeploy", lambda: converged("running"))
        assert container()["Id"] != previous
        stable = container()["Id"]
        time.sleep(3)
        assert container()["Id"] == stable
        record("start_and_same_image_redeploy_once")
        identity = (agent_state / "agent_instance_id").read_bytes()
        snapshot = catalog()
        reported = api("/api/v1/services/" + run_id + "/instance")["reported_at"]
        stop("fleet-agent")
        start("fleet-agent")
        wait_for("fresh agent report", lambda: api("/api/v1/services/" + run_id + "/instance")["reported_at"] > reported)
        wait_for("agent restart", lambda: converged("running"))
        time.sleep(3)
        assert (agent_state / "agent_instance_id").read_bytes() == identity
        assert container()["Id"] == stable
        record("agent_restart_identity_and_applied_state")
        stop("fleetd")
        command("docker", "stop", project + "-app")
        wait_for("offline running reconciliation", lambda: container()["State"]["Running"])
        stop("fleet-agent")
        command("docker", "stop", project + "-app")
        start("fleet-agent")
        wait_for("offline cached restart", lambda: container()["State"]["Running"])
        assert (agent_state / "agent_instance_id").read_bytes() == identity
        start("fleetd")
        wait_for("control plane restart", lambda: converged("running"))
        restored = catalog()
        for key in ("node", "image", "release_id", "generation", "host_port", "git_sha"):
            assert restored[key] == snapshot[key], key
        record("control_plane_outage_and_persisted_restart")
        api("/api/v1/services/" + run_id + "/stop", "POST", {})
        wait_for("stop before outage", lambda: converged("stopped"))
        stop("fleetd")
        command("docker", "start", project + "-app")
        wait_for("offline stop reconciliation", lambda: not container()["State"]["Running"])
        stop("fleet-agent")
        command("docker", "start", project + "-app")
        start("fleet-agent")
        wait_for("cached stopped restart", lambda: not container()["State"]["Running"])
        record("stopped_state_survives_outage_and_agent_restart")
        start("fleetd")
        wait_for("control plane restored", lambda: converged("stopped"))
        stop("fleet-agent")
        compose_file.rename(evidence / "saved-compose.yml")
        (compose_file.parent / ".env").rename(evidence / "saved.env")
        # Force the first apply to use the fetched tombstone, rather than letting
        # startup recovery restore files from a cached stopped assignment first.
        (agent_state / "desired.json").rename(evidence / "saved-desired.json")
        api("/api/v1/services/" + run_id, "DELETE", expected=(202,))
        start("fleet-agent")
        wait_for("uninstall acknowledgement", lambda: not api("/api/v1/services")["services"])
        assert not command("docker", "ps", "-aq", "--filter", "label=com.docker.compose.project=" + project)
        workload_created = False
        record("uninstall_acknowledged_after_compose_file_loss")
        results["status"] = "passed"
    except BaseException as exc:
        results["status"] = "failed"
        results["failure"] = str(exc)
        raise
    finally:
        cleanup_errors = []

        def cleanup(action):
            try:
                action()
            except Exception as exc:
                cleanup_errors.append(str(exc))

        cleanup(lambda: stop("fleet-agent"))
        cleanup(lambda: stop("fleetd"))
        if workload_created:
            if not compose_file.exists() and (evidence / "saved-compose.yml").exists():
                cleanup(lambda: shutil.copy2(evidence / "saved-compose.yml", compose_file))
                cleanup(lambda: shutil.copy2(evidence / "saved.env", compose_file.parent / ".env"))
            if compose_file.exists():
                cleanup(lambda: command("docker", "compose", "-p", project, "-f", str(compose_file), "down"))
        if registry_created:
            cleanup(lambda: command("docker", "stop", registry_name))
            cleanup(lambda: command("docker", "rm", registry_name))
        for log in logs:
            cleanup(log.close)
        try:
            after = command("docker", "ps", "-aq").splitlines()
            results["cleanup_container_set_restored"] = set(before) == set(after)
            if not results["cleanup_container_set_restored"]:
                cleanup_errors.append("container inventory differs after cleanup")
        except Exception as exc:
            cleanup_errors.append(str(exc))
        results["cleanup_status"] = "failed" if cleanup_errors else "passed"
        if cleanup_errors:
            results["status"] = "failed"
            results["cleanup_errors"] = cleanup_errors
        (evidence / "acceptance.json").write_text(json.dumps(results, indent=2) + "\n")
        if cleanup_errors:
            raise RuntimeError("acceptance cleanup failed; inspect preserved evidence")
        if results["status"] == "passed":
            print("PASS cleanup; state and logs preserved; AC-03 not tested", flush=True)


if __name__ == "__main__":
    main()

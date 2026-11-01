#!/usr/bin/env python3
"""Run one owned, bounded Phase 1 Compose acceptance fixture."""

import argparse
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import quote


MODULE = Path(__file__).resolve().parents[1]
DEPLOY = MODULE / "deploy"
LABEL = "org.prism.e2e.owner"
SERVICES = ("prismd", "clickhouse", "grafana")
SECRET_NAMES = ("clickhouse_password", "clickhouse_dsn", "ingest_api_key", "grafana_password", "jwt_secret")
EVIDENCE_PATH = None
MAX_EVIDENCE_BYTES = 128 * 1024


class FixtureError(RuntimeError):
    pass


def clean_environment(docker_host, values):
    if not docker_host.startswith("unix://") or not Path(docker_host[7:]).is_absolute():
        raise FixtureError("an explicit absolute local Docker Unix socket is required")
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith("PRISM_") and key not in
                   ("DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_TLS", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH")}
    environment["DOCKER_HOST"] = docker_host
    environment.update(values)
    return environment


def redact(value, secret_values):
    for secret_value in secret_values:
        value = value.replace(secret_value, "[REDACTED]")
    return value


def record_evidence(arguments, result, secret_values):
    if EVIDENCE_PATH is None:
        return
    command = redact(json.dumps(arguments), secret_values)
    stdout = result.stdout.decode("utf-8", "replace") if isinstance(result.stdout, bytes) else (result.stdout or "")
    stderr = result.stderr.decode("utf-8", "replace") if isinstance(result.stderr, bytes) else (result.stderr or "")
    entry = f"$ {command}\nexit={result.returncode}\n{redact((stdout + stderr)[:16384], secret_values)}\n"
    old_size = EVIDENCE_PATH.stat().st_size if EVIDENCE_PATH.exists() else 0
    remaining = MAX_EVIDENCE_BYTES - old_size
    if remaining <= 0:
        return
    with EVIDENCE_PATH.open("a", encoding="utf-8") as evidence:
        evidence.write(entry[:remaining])


def invoke(arguments, environment, timeout=90, secrets_to_redact=()):
    try:
        result = subprocess.run(arguments, env=environment, cwd=MODULE, capture_output=True,
                                text=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as error:
        record_evidence(arguments, subprocess.CompletedProcess(arguments, "timeout", stdout=error.stdout, stderr=error.stderr), secrets_to_redact)
        raise FixtureError(f"command timed out: {Path(arguments[0]).name}") from error
    record_evidence(arguments, result, secrets_to_redact)
    output = (result.stdout + result.stderr)[:16384]
    output = redact(output, secrets_to_redact)
    if result.returncode:
        raise FixtureError(f"{Path(arguments[0]).name} exited {result.returncode}: {output}")
    return result.stdout


def fixture_secrets(directory):
    values = {name: secrets.token_urlsafe(36) for name in SECRET_NAMES if name != "clickhouse_dsn"}
    values["clickhouse_dsn"] = "clickhouse://prism:" + quote(values["clickhouse_password"], safe="") + "@clickhouse:9000/prism"
    directory.mkdir(mode=0o711)
    for name, value in values.items():
        file = directory / name
        file.write_text(value + "\n", encoding="utf-8")
        file.chmod(0o444)  # disposable fixture only; container UIDs differ
    return values


def override_file(path, owner):
    # JSON is valid Compose YAML; no secret values enter this file.
    data = {"services": {service: {"labels": {LABEL: owner}} for service in SERVICES},
            "volumes": {name: {"labels": {LABEL: owner}} for name in ("ch-data", "grafana-data")},
            "networks": {"default": {"labels": {LABEL: owner}}}}
    data["services"]["clickhouse"]["ports"] = ["127.0.0.1:0:9000"]
    data["services"]["prismd"]["pull_policy"] = "never"
    path.write_text(json.dumps(data), encoding="utf-8")


def parse_port(output):
    lines = output.strip().splitlines()
    if len(lines) != 1:
        raise FixtureError("unexpected Compose published port")
    endpoint = lines[0]
    host, separator, port = endpoint.rpartition(":")
    if not separator or host not in ("127.0.0.1", "[::1]") or not port.isdigit() or not 1 <= int(port) <= 65535:
        raise FixtureError("unexpected Compose published port")
    return int(port)


def absent_inspect(result, kind, name):
    if result.returncode == 0:
        return False
    stdout = result.stdout.decode("utf-8", "replace") if isinstance(result.stdout, bytes) else (result.stdout or "")
    if stdout.strip() not in ("", "[]"):
        raise FixtureError("Docker inspect returned mixed output on failure")
    message = result.stderr.decode("utf-8", "replace") if isinstance(result.stderr, bytes) else (result.stderr or "")
    escaped = re.escape(name)
    patterns = {
        "network": (rf"Error response from daemon: network {escaped} not found",),
        "volume": (rf"Error response from daemon: get {escaped}: no such volume",
                   rf"Error response from daemon: no such volume: {escaped}"),
        "container": (rf"Error: No such container: {escaped}",
                      rf"Error response from daemon: No such container: {escaped}",
                      rf"Error: No such object: {escaped}"),
        "image": (rf"Error: No such image: {escaped}",
                  rf"Error response from daemon: No such image: {escaped}"),
    }
    if any(re.fullmatch(pattern, message.strip(), flags=re.IGNORECASE) for pattern in patterns[kind]):
        return True
    raise FixtureError("Docker inspect failed without a recognized absence result")


def inspect_resource(docker, environment, kind, name, secret_values):
    result = subprocess.run([docker, kind, "inspect", name], env=environment, cwd=MODULE,
                            capture_output=True, text=True, timeout=20, check=False)
    try:
        missing = absent_inspect(result, kind, name)
    except FixtureError:
        record_evidence([docker, kind, "inspect", name],
                        subprocess.CompletedProcess([], result.returncode, stdout="inspect failed without an explicit not-found result"), secret_values)
        raise
    if missing:
        record_evidence([docker, kind, "inspect", name],
                        subprocess.CompletedProcess([], result.returncode, stdout="explicit not-found result"), secret_values)
        return None
    try:
        item = json.loads(result.stdout)[0]
    except (ValueError, KeyError, IndexError, TypeError) as error:
        raise FixtureError(f"malformed {kind} inspection") from error
    labels = item.get("Config", {}).get("Labels", {}) if kind == "container" else item.get("Labels", {})
    state = item.get("State", {}) if kind == "container" else {}
    projection = {
        "id": item.get("Id") or item.get("ID"), "name": item.get("Name"),
        "labels": {key: labels.get(key) for key in (LABEL, "com.docker.compose.project")},
        "state": {key: state.get(key) for key in ("Running", "ExitCode", "OOMKilled")},
    }
    record_evidence([docker, kind, "inspect", name],
                    subprocess.CompletedProcess([], 0, stdout=json.dumps(projection)), secret_values)
    return item


def assert_project_clear(docker, environment, project, secret_values):
    if invoke([docker, "ps", "-aq", "--filter", f"label=com.docker.compose.project={project}"], environment, secrets_to_redact=secret_values).strip():
        raise FixtureError("project container collision before start")
    for kind, names in (("volume", [f"{project}_ch-data", f"{project}_grafana-data"]),
                        ("network", [f"{project}_default"])):
        for name in names:
            if inspect_resource(docker, environment, kind, name, secret_values) is not None:
                raise FixtureError(f"project {kind} collision before start")


def inspect_owned(docker, environment, project, owner, secret_values=()):
    identifiers = invoke([docker, "ps", "-aq", "--filter", f"label=com.docker.compose.project={project}"], environment).split()
    for kind, names in (("container", identifiers),
                        ("volume", [f"{project}_ch-data", f"{project}_grafana-data"]),
                        ("network", [f"{project}_default"])):
        for name in names:
            item = inspect_resource(docker, environment, kind, name, secret_values)
            if item is None:
                if kind == "container":
                    raise FixtureError("listed project container vanished during ownership check")
                continue
            try:
                labels = item["Config"]["Labels"] if kind == "container" else item["Labels"]
            except (ValueError, KeyError, IndexError, TypeError) as error:
                raise FixtureError(f"cannot verify {kind} ownership") from error
            if labels.get(LABEL) != owner or labels.get("com.docker.compose.project") != project:
                raise FixtureError(f"{kind} ownership mismatch; preserving fixture")


def assert_absent(docker, environment, project, secret_values=()):
    if invoke([docker, "ps", "-aq", "--filter", f"label=com.docker.compose.project={project}"], environment).strip():
        raise FixtureError("owned containers remain after teardown")
    for kind, names in (("volume", [f"{project}_ch-data", f"{project}_grafana-data"]),
                        ("network", [f"{project}_default"])):
        for name in names:
            if inspect_resource(docker, environment, kind, name, secret_values) is not None:
                raise FixtureError(f"owned {kind} remains after teardown")


def assert_graceful_exit(docker, environment, command, service, owner, secret_values):
    identifier = invoke(command + ["ps", "--all", "-q", service], environment, 20, secret_values).strip()
    if not identifier or "\n" in identifier:
        raise FixtureError(f"cannot identify stopped {service} container")
    item = inspect_resource(docker, environment, "container", identifier, secret_values)
    if item is None or item.get("Config", {}).get("Labels", {}).get(LABEL) != owner:
        raise FixtureError(f"cannot verify stopped {service} ownership")
    state = item.get("State", {})
    if state.get("Running") or state.get("ExitCode") != 0 or state.get("OOMKilled"):
        raise FixtureError(f"{service} did not exit gracefully: running={state.get('Running')} exit={state.get('ExitCode')} oom={state.get('OOMKilled')}")
    if EVIDENCE_PATH is not None:
        with EVIDENCE_PATH.open("a", encoding="utf-8") as evidence:
            evidence.write(f"{service} stopped: exit=0, running=false, oom=false; no kill requested\n")
    return identifier


def service_identity(docker, environment, command, service, project, owner, secret_values, running):
    """Capture verified container and mounted named-volume identity, without secrets."""
    identifier = invoke(command + ["ps", "--all", "-q", service], environment, 20, secret_values).strip()
    if not identifier or len(identifier.split()) != 1:
        raise FixtureError(f"cannot identify {service} container for restart")
    item = inspect_resource(docker, environment, "container", identifier, secret_values)
    if item is None or item.get("Id") != identifier:
        raise FixtureError(f"missing or mismatched {service} container identity")
    labels = item.get("Config", {}).get("Labels", {})
    if (labels.get(LABEL) != owner or labels.get("com.docker.compose.project") != project
            or labels.get("com.docker.compose.service") != service):
        raise FixtureError(f"{service} container ownership mismatch for restart")
    state = item.get("State", {})
    if state.get("Running") is not running:
        raise FixtureError(f"{service} has unexpected running state for restart")
    if running and state.get("Health", {}).get("Status") != "healthy":
        raise FixtureError(f"{service} is not healthy after restart")
    mounts = item.get("Mounts")
    if not isinstance(mounts, list) or any(not isinstance(mount, dict) for mount in mounts):
        raise FixtureError(f"cannot verify {service} mounted volumes")
    volumes = {}
    for mount in mounts:
        if mount.get("Type") != "volume":
            continue
        name, destination = mount.get("Name"), mount.get("Destination")
        if not name or not destination or destination in volumes:
            raise FixtureError(f"cannot verify {service} mounted volume identity")
        volume = inspect_resource(docker, environment, "volume", name, secret_values)
        if volume is None:
            raise FixtureError(f"missing {service} mounted volume")
        labels = volume.get("Labels", {})
        if labels.get(LABEL) != owner or labels.get("com.docker.compose.project") != project:
            raise FixtureError(f"{service} mounted volume ownership mismatch")
        identity = {key: volume.get(key) for key in ("Name", "Driver", "Mountpoint", "CreatedAt", "Scope")}
        if (any(not isinstance(value, str) or not value for value in identity.values())
                or identity["Name"] != name or identity["Mountpoint"] != mount.get("Source")):
            raise FixtureError(f"cannot verify {service} mounted volume identity")
        volumes[destination] = identity
    if service == "clickhouse" and volumes.get("/var/lib/clickhouse", {}).get("Name") != f"{project}_ch-data":
        raise FixtureError("missing expected ClickHouse named data volume")
    identity = {"container_id": identifier, "named_volumes": volumes}
    record_evidence(["restart-identity", service, "running" if running else "stopped"],
                    subprocess.CompletedProcess([], 0, stdout=json.dumps(identity, sort_keys=True)), secret_values)
    return identity


def restart_owned_service(docker, environment, command, service, project, owner, secret_values):
    graceful_identifier = assert_graceful_exit(docker, environment, command, service, owner, secret_values)
    stopped = service_identity(docker, environment, command, service, project, owner, secret_values, running=False)
    if stopped["container_id"] != graceful_identifier:
        raise FixtureError(f"{service} stopped container identity changed before restart")
    invoke(command + ["up", "--wait", "--no-recreate", "--no-deps", "--no-build", "--pull", "never", service],
           environment, 90, secret_values)
    restarted = service_identity(docker, environment, command, service, project, owner, secret_values, running=True)
    if restarted != stopped:
        raise FixtureError(f"{service} container or mounted named-volume identity changed during restart")


def remove_generated_secrets_after_failure(scratch, started, cleaned):
    # A preflight failure has created no resource; after verified cleanup the
    # generated credentials are no longer needed for diagnostics.
    if (not started or cleaned) and (scratch / "secrets").exists():
        shutil.rmtree(scratch / "secrets")


def diagnose_owned_failure(docker, command, environment, project, owner, secret_values):
    """Capture bounded owned-service evidence without changing cleanup decisions."""
    try:
        inspect_owned(docker, environment, project, owner, secret_values)
    except (FixtureError, OSError, subprocess.TimeoutExpired):
        # The later cleanup guard will preserve a resource whose ownership is
        # uncertain. Never read logs from an unverified container.
        return
    try:
        invoke(command + ["logs", "--no-color", "--tail", "80", "clickhouse", "prismd", "grafana"],
               environment, 30, secret_values)
    except (FixtureError, OSError, subprocess.TimeoutExpired):
        pass
    try:
        identifier = invoke(command + ["ps", "--all", "-q", "clickhouse"], environment, 20, secret_values).strip()
        if not identifier or "\n" in identifier:
            return
        item = inspect_resource(docker, environment, "container", identifier, secret_values)
        if item is None:
            return
        labels = item.get("Config", {}).get("Labels", {})
        if labels.get(LABEL) != owner or labels.get("com.docker.compose.project") != project:
            return
        invoke([docker, "exec", identifier, "tail", "-n", "80",
                "/var/log/clickhouse-server/clickhouse-server.err.log"], environment, 30, secret_values)
    except (FixtureError, OSError, subprocess.TimeoutExpired):
        pass


def compose_test_environment(command, environment, values, redactions):
    """Use current published loopback ports with the original fixture credentials."""
    ports = {name: parse_port(invoke(command + ["port", service, target], environment, 20, redactions))
             for name, service, target in (("http", "prismd", "9090"), ("grpc", "prismd", "4317"),
                                           ("grafana", "grafana", "3000"), ("clickhouse", "clickhouse", "9000"))}
    test_env = environment.copy()
    test_env.update({"PRISM_E2E_HTTP_URL": f"http://127.0.0.1:{ports['http']}",
                     "PRISM_E2E_GRPC_ADDRESS": f"127.0.0.1:{ports['grpc']}",
                     "PRISM_E2E_GRAFANA_URL": f"http://127.0.0.1:{ports['grafana']}",
                     "PRISM_E2E_CLICKHOUSE_DSN": "clickhouse://prism:" + quote(values["clickhouse_password"], safe="") + f"@127.0.0.1:{ports['clickhouse']}/prism",
                     "PRISM_E2E_API_KEY": values["ingest_api_key"],
                     "PRISM_E2E_GRAFANA_PASSWORD": values["grafana_password"]})
    return test_env


def main(argv=None):
    global EVIDENCE_PATH
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--docker-host", required=True)
    parser.add_argument("--compose-binary", default=os.getenv("PRISM_COMPOSE_BINARY", ""))
    parser.add_argument("--no-build", action="store_true")
    parser.add_argument("--image", required=True, help="unique already-built image tag")
    parser.add_argument("--go-test", default="go")
    parser.add_argument("--artifact-dir", type=Path)
    args = parser.parse_args(argv)
    if not args.no_build:
        parser.error("this runner requires a root-accepted unique prebuilt image; pass --no-build")
    if not args.image.startswith("prism/prismd:prism-e2e-"):
        parser.error("--image must be a unique prism/prismd:prism-e2e-* tag")
    scratch = None
    EVIDENCE_PATH = None
    redactions = ()
    started = False
    failure = None
    cleaned = False
    setup_stage = "local Docker Unix socket validation"
    try:
        environment = clean_environment(args.docker_host, {})
        setup_stage = "Docker executable lookup"
        docker = shutil.which("docker")
        if not docker:
            raise FixtureError("docker CLI unavailable")
        setup_stage = "private fixture directory creation"
        project = "prism-e2e-" + secrets.token_hex(6)
        owner = project + "-" + secrets.token_hex(8)
        if args.artifact_dir is not None:
            args.artifact_dir.mkdir(parents=True, exist_ok=True)
        scratch = Path(tempfile.mkdtemp(prefix=project + "-", dir=args.artifact_dir))
        scratch.chmod(0o700)
        setup_stage = "redacted evidence initialization"
        EVIDENCE_PATH = (args.artifact_dir / f"{project}.evidence.log") if args.artifact_dir else (scratch / "evidence.log")
        EVIDENCE_PATH.write_text("", encoding="utf-8")
        EVIDENCE_PATH.chmod(0o600)
        setup_stage = "fixture secret generation"
        values = fixture_secrets(scratch / "secrets")
        redactions = tuple(values.values())
        setup_stage = "fixture override initialization"
        override = scratch / "override.json"
        override_file(override, owner)
        environment.update({
            "PRISM_SECRETS_DIR": str(scratch / "secrets"), "PRISM_VERSION": args.image.split(":", 1)[1],
            "PRISM_HTTP_PORT": "0", "PRISM_GRPC_PORT": "0", "GRAFANA_HTTP_PORT": "0",
            "PRISM_DATASOURCE_TOKEN": values["ingest_api_key"],
        })
        compose = [args.compose_binary] if args.compose_binary else [docker, "compose"]
        command = compose + ["-f", str(DEPLOY / "docker-compose.yml"), "-f", str(override), "-p", project]
        setup_stage = None
        if not (DEPLOY / "docker-compose.yml").is_file():
            raise FixtureError("accepted Compose artifact unavailable")
        if inspect_resource(docker, environment, "image", args.image, redactions) is None:
            raise FixtureError("accepted unique daemon image is unavailable locally")
        assert_project_clear(docker, environment, project, redactions)
        invoke(command + ["config", "--quiet"], environment, 30, redactions)
        started = True
        checked = invoke(command + ["run", "--no-deps", "--rm", "prismd", "--config", "/etc/prism/prismd.yaml", "--config-check"], environment, 90, redactions)
        if "configuration valid" not in checked:
            raise FixtureError("container config-check did not confirm valid configuration")
        invoke(command + ["up", "--wait", "--no-build", "--detach"], environment, 240, redactions)
        test_env = compose_test_environment(command, environment, values, redactions)
        invoke([args.go_test, "test", "-tags=integration", "-race", "-count=1", "-timeout=5m",
                "-run", "^TestPhase1Compose$", "-v", "./test/e2e"], test_env, 330, redactions)
        for service in ("prismd", "clickhouse"):
            inspect_owned(docker, environment, project, owner, redactions)
            invoke(command + ["stop", "--timeout", "30", service], environment, 90, redactions)
            restart_owned_service(docker, environment, command, service, project, owner, redactions)
            test_env = compose_test_environment(command, environment, values, redactions)
            invoke([args.go_test, "test", "-tags=integration", "-race", "-count=1", "-timeout=1m",
                    "-run", "^TestPhase1ComposeRestart$", "-v", "./test/e2e"], test_env, 90, redactions)
    except (FixtureError, OSError, subprocess.TimeoutExpired) as error:
        # Partial secret generation may fail before values are returned; never
        # expose initialization exception text that could contain secret bytes.
        failure = FixtureError(f"fixture initialization failed at {setup_stage} ({type(error).__name__})") if setup_stage else error
    finally:
        if started:
            if failure is not None:
                diagnose_owned_failure(docker, command, environment, project, owner, redactions)
            try:
                inspect_owned(docker, environment, project, owner, redactions)
                invoke(command + ["down", "--volumes", "--remove-orphans", "--timeout", "30"], environment, 90, redactions)
                assert_absent(docker, environment, project, redactions)
                cleaned = True
            except (FixtureError, OSError, subprocess.TimeoutExpired) as error:
                failure = FixtureError(f"{failure}; cleanup: {error}" if failure else f"cleanup: {error}")
        if failure is not None and scratch is not None:
            try:
                remove_generated_secrets_after_failure(scratch, started, cleaned)
            except OSError as error:
                failure = FixtureError(f"{failure}; private fixture secret removal failed ({type(error).__name__})")
        if failure is None:
            if args.artifact_dir is None:
                print(EVIDENCE_PATH.read_text(encoding="utf-8")[:16384])
            try:
                shutil.rmtree(scratch)
            except OSError as error:
                failure = FixtureError(f"private fixture removal failed: {error}")
    if failure:
        print(f"Phase 1 Compose E2E failed: {failure}; redacted evidence: {EVIDENCE_PATH}", file=sys.stderr)
        if started and not cleaned:
            print(f"Owned fixture preserved for diagnosis: {scratch}", file=sys.stderr)
        return 1
    print(f"Phase 1 Compose E2E passed; owned resources and secrets removed; redacted evidence: {EVIDENCE_PATH}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

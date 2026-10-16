#!/usr/bin/env python3
"""Fixed one-shot protocol. Only observe, stop and stopped-container remove exist.

This trusted source is quoted literally by ssh_executor; it has no local imports.
The injection seams below are Python-only tests, never command-line options.
"""
import hashlib
import json
import math
import os
import re
import selectors
import signal
import stat
import subprocess
import sys
import time

MAX_BYTES = 65536
DEADLINE = 20
HEX = re.compile(r"[0-9a-f]{64}\Z")
OPID = re.compile(r"[0-9a-f]{32}\Z")
ROLES = {"M1": "H1", "M2": "H2", "M3": "H3", "R1": "H2", "R2": "H3", "R3": "H1", "A": "H4"}
REQUEST_KEYS = {"schema_version", "operation_id", "operation", "run_id", "plan_sha256",
                "bundle_sha256", "host", "machine_identity_sha256", "target"}
DOCKER = ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"]


class ProtocolError(Exception):
    """Fixed safe codes only; never Docker or SSH diagnostics."""


def require(value, code="invalid-protocol"):
    if not value:
        raise ProtocolError(code)


def shape(value, keys):
    require(type(value) is dict and set(value) == set(keys))


def canonical(value):
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii")
    except (ValueError, TypeError, RecursionError):
        raise ProtocolError("invalid-protocol") from None
    require(len(raw) <= MAX_BYTES, "output-limit")
    return raw


def decode(raw):
    require(type(raw) is bytes and len(raw) <= MAX_BYTES, "input-limit")
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "duplicate-key")
            value[key] = item
        return value
    def bad(_):
        raise ProtocolError("invalid-json")
    def finite(raw):
        value = float(raw)
        require(math.isfinite(value))
        return value
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs,
                          parse_constant=bad, parse_float=finite)
    except (ValueError, UnicodeError, RecursionError):
        raise ProtocolError("invalid-json") from None


def validate_request(req):
    shape(req, REQUEST_KEYS)
    require(type(req["schema_version"]) is int and req["schema_version"] == 1)
    require(type(req["operation_id"]) is str and OPID.fullmatch(req["operation_id"]))
    require(type(req["operation"]) is str and req["operation"] in {"observe", "stop", "remove"})
    require(type(req["run_id"]) is str and re.fullmatch(r"[a-z][a-z0-9-]{0,47}", req["run_id"]))
    for key in ("plan_sha256", "bundle_sha256", "machine_identity_sha256"):
        require(type(req[key]) is str and HEX.fullmatch(req[key]))
    shape(req["target"], {"role", "container_id"})
    role, rid = req["target"]["role"], req["target"]["container_id"]
    require(type(role) is str and role in ROLES)
    require(type(req["host"]) is str and req["host"] == ROLES[role])
    require(type(rid) is str and HEX.fullmatch(rid))
    canonical(req)
    return req


def labels(req):
    return {"io.mithril-research.run": req["run_id"],
            "io.mithril-research.plan": req["plan_sha256"],
            "io.mithril-research.bundle": req["bundle_sha256"],
            "io.mithril-research.role": req["target"]["role"]}


def bounded_run(argv, payload, deadline, limit):
    """Bound both pipes while running, including descendants holding pipes open."""
    require(type(payload) is bytes and len(payload) <= MAX_BYTES)
    require(type(deadline) in {int, float} and 0 < deadline <= 60)
    require(type(limit) is int and 0 < limit <= MAX_BYTES)
    proc = None
    selector = selectors.DefaultSelector()
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                stderr=subprocess.PIPE, shell=False, start_new_session=True,
                                env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
        streams = (proc.stdin, proc.stdout, proc.stderr)
        for stream in streams:
            os.set_blocking(stream.fileno(), False)
        if payload:
            selector.register(proc.stdin, selectors.EVENT_WRITE, "stdin")
        else:
            proc.stdin.close()
        selector.register(proc.stdout, selectors.EVENT_READ, "stdout")
        selector.register(proc.stderr, selectors.EVENT_READ, "stderr")
        sent, sizes, output = 0, {"stdout": 0, "stderr": 0}, bytearray()
        expires = time.monotonic() + deadline
        while selector.get_map():
            remaining = expires - time.monotonic()
            require(remaining > 0, "transport-deadline")
            for key, _ in selector.select(min(remaining, .1)):
                stream, kind = key.fileobj, key.data
                if kind == "stdin":
                    try:
                        sent += os.write(stream.fileno(), payload[sent:sent + 4096])
                    except BrokenPipeError:
                        raise ProtocolError("transport-failed") from None
                    if sent == len(payload):
                        selector.unregister(stream)
                        stream.close()
                else:
                    chunk = os.read(stream.fileno(), min(4096, limit + 1))
                    if not chunk:
                        selector.unregister(stream)
                        stream.close()
                        continue
                    sizes[kind] += len(chunk)
                    require(sizes[kind] <= limit, "transport-output-limit")
                    if kind == "stdout":
                        output.extend(chunk)
        remaining = expires - time.monotonic()
        require(remaining > 0, "transport-deadline")
        try:
            code = proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise ProtocolError("transport-deadline") from None
        require(code == 0, "transport-failed")
        return bytes(output)
    except OSError:
        raise ProtocolError("transport-failed") from None
    finally:
        selector.close()
        if proc is not None:
            # Killing the local group never claims remote cancellation.
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            for stream in (proc.stdin, proc.stdout, proc.stderr):
                if stream is not None and not stream.closed:
                    stream.close()
            try:
                proc.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass


def machine_bytes():
    fd = os.open("/etc/machine-id", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_size <= 33, "identity-unknown")
        return os.read(fd, 34)
    finally:
        os.close(fd)


def verify_machine(req, reader):
    raw = reader()
    require(type(raw) is bytes and re.fullmatch(rb"[0-9a-f]{32}\n?", raw), "identity-unknown")
    require(raw.rstrip(b"\n") != b"0" * 32, "identity-unknown")
    require(hashlib.sha256(raw).hexdigest() == req["machine_identity_sha256"], "identity-mismatch")


def observe(req, docker):
    rid = req["target"]["container_id"]
    raw = docker(["container", "ls", "--all", "--no-trunc", "--format", "{{.ID}}"])
    try:
        ids = raw.decode("ascii").splitlines()
    except UnicodeError:
        raise ProtocolError("observation-unknown") from None
    require(len(ids) <= 1024 and len(ids) == len(set(ids)) and
            all(HEX.fullmatch(item) for item in ids), "observation-unknown")
    if rid not in ids:
        return "absent"
    objects = decode(docker(["inspect", "--type", "container", rid]))
    require(type(objects) is list and len(objects) == 1, "observation-unknown")
    obj = objects[0]
    require(type(obj) is dict and type(obj.get("Config")) is dict and
            type(obj.get("State")) is dict, "observation-unknown")
    actual = obj["Config"].get("Labels")
    require(type(actual) is dict, "observation-unknown")
    if obj.get("Id") != rid or any(actual.get(k) != v for k, v in labels(req).items()):
        return "foreign"
    state = obj["State"]
    require(type(state.get("Status")) is str and type(state.get("Running")) is bool and state.get("Paused") is False and
            state.get("Restarting") is False, "observation-unknown")
    if state.get("Status") == "running" and state["Running"]:
        return "running"
    if state.get("Status") in {"exited", "created"} and not state["Running"]:
        return "stopped"
    return "unknown"


def handle(req, *, _runner=None, _machine=None):
    req = validate_request(req)
    origin = "mock-ssh" if _runner is not None or _machine is not None else "ssh"
    runner, reader = _runner or bounded_run, _machine or machine_bytes
    expires = time.monotonic() + DEADLINE
    def docker(args):
        remaining = expires - time.monotonic()
        require(remaining > 0, "transport-deadline")
        return runner(DOCKER + args, b"", remaining, MAX_BYTES)
    observation = "unknown"
    try:
        verify_machine(req, reader)
        observation = observe(req, docker)
        operation = req["operation"]
        if operation != "observe" and observation == "absent":
            # An effect needs a present, owned precondition. Only observe can
            # establish an already absent object without claiming a mutation.
            return dict(req, origin=origin, observation="unknown")
        if (operation == "stop" and observation == "running") or (operation == "remove" and observation == "stopped"):
            verify_machine(req, reader)
            # Fresh exact inspect is inside the same helper immediately before effect.
            fresh = observe(req, docker)
            require(fresh == observation, "observation-changed")
            args = ["stop", "--time", "10"] if operation == "stop" else ["rm"]
            docker(args + [req["target"]["container_id"]])
            observation = observe(req, docker)
    except (ProtocolError, OSError):
        observation = "unknown"
    return dict(req, origin=origin, observation=observation)


def main():
    try:
        request = decode(sys.stdin.buffer.read(MAX_BYTES + 1))
        result = handle(request)
        sys.stdout.buffer.write(canonical(result) + b"\n")
        return 0
    except (ProtocolError, OSError):
        print('{"schema_version":1,"result":"error","error":"helper-refused"}')
        return 2


if __name__ == "__main__":
    sys.exit(main())

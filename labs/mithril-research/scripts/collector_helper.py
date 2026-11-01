#!/usr/bin/env python3
"""Fixed read-only Redis collection helper, delivered as literal trusted source.

No repository imports, executable/command selection, mutation, or request logging.
"""
import datetime
import hashlib
import ipaddress
import json
import math
import os
import re
import selectors
import signal
import socket
import stat
import subprocess
import sys
import time

MAX_REQUEST_BYTES = 65536
MAX_RESPONSE_BYTES = 524288
MAX_DOCKER_BYTES = 65536
DEADLINE = 20
HEX = re.compile(r"[0-9a-f]{64}\Z")
OPID = re.compile(r"[0-9a-f]{32}\Z")
NODE_ID = re.compile(r"[0-9a-f]{40}\Z")
ROLES = {"M1": "H1", "M2": "H2", "M3": "H3", "R1": "H2", "R2": "H3", "R3": "H1"}
REQUEST_KEYS = {"schema_version", "operation_id", "collection_id", "operation", "run_id",
                "plan_sha256", "bundle_sha256", "host", "machine_identity_sha256", "target", "credential"}
TARGET_KEYS = {"role", "container_id", "node_id", "ipv4", "port", "bus_port"}
RECORD_KEYS = {"host", "role", "container_id", "machine_identity_sha256", "labels", "container_state",
               "process", "cluster_nodes", "cluster_info", "info_keyspace"}
DOCKER = ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"]


class ProtocolError(Exception):
    """Only constant public-safe codes; no diagnostics or input values."""


def require(value, code="collector-protocol-refused"):
    if not value:
        raise ProtocolError(code)


def shape(value, keys):
    require(type(value) is dict and set(value) == set(keys))


def canonical(value, limit=MAX_RESPONSE_BYTES):
    try:
        raw = json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("ascii")
    except (ValueError, TypeError, RecursionError):
        raise ProtocolError("collector-json-refused") from None
    require(len(raw) <= limit, "collector-size-limit")
    return raw


def decode(raw, limit=MAX_RESPONSE_BYTES):
    require(type(raw) is bytes and len(raw) <= limit, "collector-size-limit")
    def pairs(items):
        value = {}
        for key, item in items:
            require(key not in value, "collector-json-refused")
            value[key] = item
        return value
    def bad(_):
        raise ProtocolError("collector-json-refused")
    def finite(raw):
        value = float(raw)
        require(math.isfinite(value), "collector-json-refused")
        return value
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=pairs, parse_constant=bad, parse_float=finite)
    except (ValueError, UnicodeError, RecursionError):
        raise ProtocolError("collector-json-refused") from None


def validate_request(req):
    shape(req, REQUEST_KEYS)
    require(type(req["schema_version"]) is int and req["schema_version"] == 1)
    for key in ("operation_id", "collection_id"):
        require(type(req[key]) is str and OPID.fullmatch(req[key]))
    require(type(req["operation"]) is str and req["operation"] == "collect-redis")
    require(type(req["run_id"]) is str and re.fullmatch(r"[a-z][a-z0-9-]{0,47}", req["run_id"]))
    for key in ("plan_sha256", "bundle_sha256", "machine_identity_sha256"):
        require(type(req[key]) is str and HEX.fullmatch(req[key]))
    target = req["target"]
    shape(target, TARGET_KEYS)
    role = target["role"]
    require(type(role) is str and role in ROLES)
    require(type(req["host"]) is str and req["host"] == ROLES[role])
    require(type(target["container_id"]) is str and HEX.fullmatch(target["container_id"]))
    require(type(target["node_id"]) is str and NODE_ID.fullmatch(target["node_id"]))
    require(type(target["ipv4"]) is str)
    try:
        address = ipaddress.IPv4Address(target["ipv4"])
    except ipaddress.AddressValueError:
        raise ProtocolError("collector-endpoint-refused") from None
    require(str(address) == target["ipv4"] and address in ipaddress.IPv4Network("100.64.0.0/10"))
    port = 17001 if role.startswith("M") else 17002
    require(type(target["port"]) is int and target["port"] == port)
    require(type(target["bus_port"]) is int and target["bus_port"] == port + 10000)
    require(type(req["credential"]) is str and re.fullmatch(r"[A-Za-z0-9_-]{1,256}", req["credential"]))
    canonical(req, MAX_REQUEST_BYTES)
    return req


def labels(req):
    return {"io.mithril-research.run": req["run_id"], "io.mithril-research.plan": req["plan_sha256"],
            "io.mithril-research.bundle": req["bundle_sha256"], "io.mithril-research.role": req["target"]["role"]}


def validate_process(process):
    shape(process, {"started_at", "pid"})
    require(type(process["pid"]) is int and 1 <= process["pid"] <= 2 ** 31 - 1)
    started = process["started_at"]
    require(type(started) is str and len(started) <= 30)
    match = re.fullmatch(r"([0-9]{4})-([0-9]{2})-([0-9]{2})T([0-9]{2}):([0-9]{2}):([0-9]{2})(?:\.[0-9]{1,9})?Z", started)
    require(match is not None)
    try:
        components = tuple(int(value) for value in match.groups())
        datetime.datetime(*components)
    except ValueError:
        raise ProtocolError("collector-process-refused") from None
    require(components != (1, 1, 1, 0, 0, 0), "collector-process-refused")
    return process


def bounded_run(argv, payload, deadline, limit):
    """Read both pipes under one deadline, even if descendants hold them open."""
    require(type(payload) is bytes and len(payload) <= MAX_REQUEST_BYTES)
    require(type(deadline) in {int, float} and math.isfinite(deadline) and 0 < deadline <= 60)
    require(type(limit) is int and 0 < limit <= MAX_RESPONSE_BYTES)
    proc = None
    selector = selectors.DefaultSelector()
    expires = time.monotonic() + deadline
    try:
        proc = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                shell=False, start_new_session=True,
                                env={"PATH": "/usr/bin:/bin", "LANG": "C", "LC_ALL": "C"})
        for stream in (proc.stdin, proc.stdout, proc.stderr):
            os.set_blocking(stream.fileno(), False)
        if payload:
            selector.register(proc.stdin, selectors.EVENT_WRITE, "stdin")
        else:
            proc.stdin.close()
        selector.register(proc.stdout, selectors.EVENT_READ, "stdout")
        selector.register(proc.stderr, selectors.EVENT_READ, "stderr")
        sent, sizes, output = 0, {"stdout": 0, "stderr": 0}, bytearray()
        while selector.get_map():
            remaining = expires - time.monotonic()
            require(remaining > 0, "collector-deadline")
            for key, _ in selector.select(min(remaining, .1)):
                stream, kind = key.fileobj, key.data
                if kind == "stdin":
                    try:
                        sent += os.write(stream.fileno(), payload[sent:sent + 4096])
                    except BrokenPipeError:
                        raise ProtocolError("collector-transport-refused") from None
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
                    require(sizes[kind] <= limit, "collector-stream-limit")
                    if kind == "stdout":
                        output.extend(chunk)
        remaining = expires - time.monotonic()
        require(remaining > 0, "collector-deadline")
        try:
            code = proc.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            raise ProtocolError("collector-deadline") from None
        require(code == 0, "collector-transport-refused")
        return bytes(output)
    except OSError:
        raise ProtocolError("collector-transport-refused") from None
    finally:
        selector.close()
        if proc is not None:
            # This is local process cleanup, never proof of remote cancellation.
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
        require(stat.S_ISREG(info.st_mode) and info.st_size <= 33)
        return os.read(fd, 34)
    finally:
        os.close(fd)


def verify_machine(req, reader):
    raw = reader()
    require(type(raw) is bytes and re.fullmatch(rb"[0-9a-f]{32}\n?", raw))
    require(raw.rstrip(b"\n") != b"0" * 32)
    require(hashlib.sha256(raw).hexdigest() == req["machine_identity_sha256"])


def inspect(req, runner, remaining):
    raw = runner(DOCKER + ["inspect", "--type", "container", req["target"]["container_id"]],
                 b"", remaining(), MAX_DOCKER_BYTES)
    objects = decode(raw, MAX_DOCKER_BYTES)
    require(type(objects) is list and len(objects) == 1)
    obj = objects[0]
    require(type(obj) is dict and type(obj.get("Config")) is dict and type(obj.get("State")) is dict)
    require(type(obj.get("Id")) is str and obj["Id"] == req["target"]["container_id"])
    require(canonical(obj["Config"].get("Labels")) == canonical(labels(req)))
    state = obj["State"]
    require(state.get("Status") == "running" and state.get("Running") is True and
            state.get("Paused") is False and state.get("Restarting") is False)
    process = {"started_at": state.get("StartedAt"), "pid": state.get("Pid")}
    validate_process(process)
    remaining()
    return process


def connect(ipv4, port, remaining):
    """Canonical numeric IPv4 is validated before this boundary; no DNS lookup."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
    try:
        sock.settimeout(remaining)
        sock.connect((ipv4, port))
        return sock
    except BaseException:
        sock.close()
        raise


def _command(arguments):
    return b"*" + str(len(arguments)).encode("ascii") + b"\r\n" + b"".join(
        b"$" + str(len(arg)).encode("ascii") + b"\r\n" + arg + b"\r\n" for arg in arguments)


class Resp:
    """Sequential expected RESP2 replies; no speculative reads or arbitrary commands."""
    def __init__(self, sock, remaining):
        self.sock, self.remaining = sock, remaining

    def send(self, arguments):
        raw = _command(arguments)
        offset = 0
        while offset < len(raw):
            self.sock.settimeout(self.remaining())
            count = self.sock.send(raw[offset:])
            require(type(count) is int and 0 < count <= len(raw) - offset)
            offset += count
        self.remaining()

    def read(self, count):
        raw = bytearray()
        while len(raw) < count:
            self.sock.settimeout(self.remaining())
            chunk = self.sock.recv(min(4096, count - len(raw)))
            require(type(chunk) is bytes and 0 < len(chunk) <= count - len(raw), "collector-incomplete-frame")
            raw.extend(chunk)
        self.remaining()
        return bytes(raw)

    def bulk(self, limit):
        require(self.read(1) == b"$")
        header = bytearray()
        while True:
            byte = self.read(1)
            if byte == b"\r":
                require(self.read(1) == b"\n")
                break
            require(len(header) < 16 and b"0" <= byte <= b"9")
            header.extend(byte)
        require(re.fullmatch(rb"0|[1-9][0-9]{0,15}", header) is not None)
        count = int(header)
        require(0 < count <= limit, "collector-raw-limit")
        raw = self.read(count)
        require(self.read(2) == b"\r\n")
        require(all(byte in {10, 13} or 32 <= byte <= 126 for byte in raw))
        return raw.decode("ascii")

    def eof(self):
        self.sock.settimeout(self.remaining())
        self.sock.shutdown(socket.SHUT_WR)
        self.sock.settimeout(self.remaining())
        require(self.sock.recv(1) == b"", "collector-trailing-data")
        self.remaining()


def handle(req, *, _runner=None, _machine=None, _connect=None):
    req = validate_request(req)
    origin = "mock-ssh" if any(dep is not None for dep in (_runner, _machine, _connect)) else "ssh"
    result = {key: value for key, value in req.items() if key != "credential"}
    result.update(origin=origin, status="unknown", record=None)
    runner = _runner if _runner is not None else bounded_run
    reader = _machine if _machine is not None else machine_bytes
    connector = _connect if _connect is not None else connect
    expires = time.monotonic() + DEADLINE
    def remaining():
        value = expires - time.monotonic()
        require(value > 0, "collector-deadline")
        return value
    sock = None
    try:
        verify_machine(req, reader)
        before = inspect(req, runner, remaining)
        target = req["target"]
        sock = connector(target["ipv4"], target["port"], remaining())
        resp = Resp(sock, remaining)
        resp.send([b"AUTH", b"backend_operator", req["credential"].encode("ascii")])
        require(resp.read(5) == b"+OK\r\n", "collector-auth-refused")
        raw = {}
        for command, key, limit in [([b"CLUSTER", b"NODES"], "cluster_nodes", 65536),
                                    ([b"CLUSTER", b"INFO"], "cluster_info", 16384),
                                    ([b"INFO", b"keyspace"], "info_keyspace", 4096)]:
            resp.send(command)
            raw[key] = resp.bulk(limit)
        resp.eof()
        verify_machine(req, reader)
        after = inspect(req, runner, remaining)
        require(before == after, "collector-incarnation-drift")
        record = {"host": req["host"], "role": target["role"], "container_id": target["container_id"],
                  "machine_identity_sha256": req["machine_identity_sha256"], "labels": labels(req),
                  "container_state": "running", "process": before, **raw}
        result.update(status="complete", record=record)
        canonical(result)
    except (ProtocolError, OSError, ValueError, TypeError, RecursionError):
        result.update(status="unknown", record=None)
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass
    return result


def main():
    try:
        req = decode(sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1), MAX_REQUEST_BYTES)
        result = handle(req)
        sys.stdout.buffer.write(canonical(result) + b"\n")
        return 0
    except (ProtocolError, OSError, ValueError, TypeError, RecursionError, KeyboardInterrupt):
        print('{"schema_version":1,"result":"error","error":"collector-helper-refused"}')
        return 2


if __name__ == "__main__":
    sys.exit(main())

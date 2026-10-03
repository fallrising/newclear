"""Pinned SDK terminal seam: python3 -I guest_tool_client.py '<readonly JSON>'.

This standalone client has one fixed socket, no credentials and no retries. It
acknowledges a bounded, fully parsed result on its originating socket only.
"""

import json
import socket
import sys
import time
from uuid import UUID

SOCKET_PATH = "/var/lib/agent-platform/tools/request.sock"
MAX_REQUEST = 32768
MAX_RESULT = 1048576


class ToolError(ValueError):
    def __init__(self):
        super().__init__("tool_transport_unavailable")


def encode(value):
    return json.dumps(value, allow_nan=False, separators=(",", ":")).encode()


def decode(raw):
    def pairs(items):
        data = {}
        for key, value in items:
            if key in data:
                raise ValueError()
            data[key] = value
        return data

    def constant(_):
        raise ValueError()

    return json.loads(raw, object_pairs_hook=pairs, parse_constant=constant)


def call(payload, *, path=SOCKET_PATH, timeout=15):
    try:
        raw = encode(payload) + b"\n"
        if type(payload) is not dict or len(raw) > MAX_REQUEST or not 0 < timeout <= 15:
            raise ValueError()
        deadline = time.monotonic() + timeout
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as conn:
            conn.settimeout(timeout)
            conn.connect(path)
            conn.sendall(raw)
            response = bytearray()
            while len(response) <= MAX_RESULT + 128:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError()
                conn.settimeout(remaining)
                chunk = conn.recv(min(65536, MAX_RESULT + 129 - len(response)))
                if not chunk:
                    raise ValueError()
                response.extend(chunk)
                if b"\n" in chunk:
                    break
            if (
                not response.endswith(b"\n")
                or b"\n" in response[:-1]
                or len(response) > MAX_RESULT + 128
            ):
                raise ValueError()
            value = decode(response)
            if (
                type(value) is not dict
                or set(value) != {"operation_id", "result"}
                or type(value["operation_id"]) is not str
                or str(UUID(value["operation_id"])) != value["operation_id"]
                or type(value["result"]) is not dict
                or len(encode(value["result"])) > MAX_RESULT
            ):
                raise ValueError()
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError()
            conn.settimeout(remaining)
            conn.sendall(encode({"ack": value["operation_id"]}) + b"\n")
            return value["result"]
    except (ValueError, TypeError, KeyError, RecursionError, OSError):
        raise ToolError() from None


def main():
    try:
        if len(sys.argv) != 2 or len(sys.argv[1]) > MAX_REQUEST:
            raise ValueError()
        print(encode(call(decode(sys.argv[1]))).decode())
    except (ValueError, TypeError, RecursionError, OSError):
        print('{"error":"tool_transport_unavailable"}')
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

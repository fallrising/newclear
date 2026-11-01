"""Single-operation bounded mock HTTP transport and isolated future TLS dial guard."""

import http.client
import ipaddress
import json
import socket
import ssl
import threading
import time
from urllib.parse import urlsplit

from ..domain import Problem
from .policy import API_REVISION, MAX_HOPS, MAX_RESPONSE


def public_addresses(host, port):
    """Resolve once; reject the entire answer when any address is non-public."""
    if (host, port) != ("api.github.com", 443):
        raise Problem(403, "tool_destination_denied")
    try:
        answers = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
        addresses = []
        for family, kind, protocol, _, address in answers:
            ip = ipaddress.ip_address(address[0])
            if (
                not ip.is_global
                or ip.is_multicast
                or ip.is_reserved
                or getattr(ip, "ipv4_mapped", None)
                or getattr(ip, "sixtofour", None)
                or getattr(ip, "teredo", None)
                or (ip.version == 6 and ip in ipaddress.ip_network("64:ff9b::/96"))
                or (ip.version == 6 and ip in ipaddress.ip_network("64:ff9b:1::/48"))
            ):
                raise Problem(403, "tool_destination_denied")
            if family not in (socket.AF_INET, socket.AF_INET6) or kind != socket.SOCK_STREAM:
                raise Problem(403, "tool_destination_denied")
            addresses.append((family, kind, protocol, address))
        if not addresses:
            raise Problem(403, "tool_destination_denied")
        return addresses
    except (OSError, ValueError):
        raise Problem(502, "tool_dns_unavailable") from None


class PublicGitHubConnection(http.client.HTTPSConnection):
    """Future live guard, unreachable through mock Policy; no fallback or second DNS."""

    def __init__(self, timeout=5, *, context=None):
        context = context or ssl.create_default_context()
        if not context.check_hostname or context.verify_mode != ssl.CERT_REQUIRED:
            raise ValueError("TLS hostname and chain verification required")
        super().__init__("api.github.com", 443, timeout=timeout, context=context)

    def connect(self):
        family, kind, protocol, address = public_addresses(self.host, self.port)[0]
        sock = socket.socket(family, kind, protocol)
        try:
            sock.settimeout(self.timeout)
            sock.connect(address)
            self.sock = self._context.wrap_socket(sock, server_hostname=self.host)
        except BaseException:
            sock.close()
            raise


def interrupt(sock):
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate key")
        result[key] = value
    return result


class MockTransport:
    def __init__(self, policy, before_hop):
        self.policy = policy
        self.before_hop = before_hop
        self.deadline = time.monotonic() + policy.total_timeout
        self.http_calls = 0
        self.response_bytes = 0

    def remaining(self):
        remaining = self.deadline - time.monotonic()
        if remaining <= 0:
            raise Problem(504, "tool_timeout")
        return min(remaining, self.policy.idle_timeout)

    def get(self, path):
        self.policy.bind(path)
        if self.http_calls >= MAX_HOPS:
            raise Problem(502, "tool_http_limit")
        self.remaining()
        self.before_hop()
        # Admission locks have been released by callback before any socket work.
        timeout = self.remaining()
        self.http_calls += 1
        connection = http.client.HTTPConnection(
            "127.0.0.1", urlsplit(self.policy.origin).port, timeout=timeout
        )
        result, timer = None, None
        try:
            connection.connect()
            timer = threading.Timer(
                max(0, self.deadline - time.monotonic()), interrupt, args=(connection.sock,)
            )
            timer.daemon = True
            timer.start()
            connection.request(
                "GET",
                path,
                headers={
                    "Authorization": "Bearer " + self.policy.secret,
                    "Accept": "application/vnd.github+json",
                    "Accept-Encoding": "identity",
                    "X-GitHub-Api-Version": API_REVISION,
                    "User-Agent": "agent-platform-tool-broker-mock-v1",
                    "Connection": "close",
                },
            )
            result = connection.getresponse()
            if result.status != 200:
                raise Problem(
                    429 if result.status == 429 else 502,
                    "tool_rate_limited" if result.status == 429 else "tool_upstream_rejected",
                )
            lengths = result.headers.get_all("Content-Length", [])
            types = result.headers.get_all("Content-Type", [])
            if (
                len(lengths) != 1
                or len(lengths[0]) > 7
                or not lengths[0].isascii()
                or not lengths[0].isdigit()
                or not 0 < int(lengths[0]) <= MAX_RESPONSE - self.response_bytes
                or result.headers.get_all("Transfer-Encoding")
                or result.headers.get_all("Content-Encoding")
                or len(types) != 1
                or types[0].split(";")[0] != "application/json"
            ):
                raise Problem(502, "tool_upstream_framing")
            remaining = int(lengths[0])
            body = bytearray()
            while remaining:
                result.fp.raw._sock.settimeout(self.remaining())
                chunk = result.read1(min(65536, remaining))
                if not chunk:
                    raise Problem(502, "tool_upstream_truncated")
                body.extend(chunk)
                remaining -= len(chunk)
                self.response_bytes += len(chunk)
            self.remaining()
            try:
                value = json.loads(
                    body,
                    object_pairs_hook=unique_object,
                    parse_constant=lambda _: (_ for _ in ()).throw(ValueError()),
                )
            except (ValueError, UnicodeError, RecursionError):
                raise Problem(502, "tool_upstream_schema") from None
            if type(value) is not dict:
                raise Problem(502, "tool_upstream_schema")
            # Traverse parsed strings directly: re-serialization escapes quotes/backslashes
            # in a valid credential and would miss its exact decoded value. The input byte
            # cap bounds this iterative scan without adding a recursion failure path.
            pending = [value]
            while pending:
                item = pending.pop()
                if type(item) is str and self.policy.secret in item:
                    raise Problem(502, "tool_secret_echo")
                if type(item) is dict:
                    pending.extend(item.keys())
                    pending.extend(item.values())
                elif type(item) is list:
                    pending.extend(item)
            self.remaining()
            return value
        except (OSError, http.client.HTTPException, UnicodeError):
            raise Problem(502, "tool_upstream_unavailable") from None
        finally:
            if timer is not None:
                timer.cancel()
            if result is not None:
                result.close()
            connection.close()

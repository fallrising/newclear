"""Bounded HTTP transport; credentials never appear in diagnostic strings."""

import ipaddress
import json
import urllib.error
import urllib.parse
import urllib.request


class ProbeError(Exception):
    """A safe, stable error code for reports; never include upstream response bodies."""


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def validate_origin(origin: str) -> str:
    try:
        parsed = urllib.parse.urlsplit(origin)
        port = parsed.port
    except ValueError as exc:
        raise ProbeError("invalid_origin") from exc
    if (
        parsed.scheme not in {"http", "https"}
        or not parsed.hostname
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
        or (port is not None and port == 0)
    ):
        raise ProbeError("invalid_origin")
    # Do not resolve an arbitrary hostname and assume it remains loopback later.
    if parsed.scheme == "http":
        try:
            loopback = ipaddress.ip_address(parsed.hostname).is_loopback
        except ValueError:
            loopback = False
        if not loopback:
            raise ProbeError("cleartext_requires_literal_loopback")
    return origin.rstrip("/")


class HTTP:
    def __init__(self, origin: str, token: str, timeout: float = 10):
        self.origin = validate_origin(origin)
        if not token or any(ord(c) < 32 or ord(c) == 127 for c in token):
            raise ProbeError("invalid_session_token")
        if not 0 < timeout <= 120:
            raise ProbeError("invalid_timeout")
        self.token = token
        self.timeout = timeout
        # No environment proxy: credentials go only to the explicitly selected origin.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def request(self, method: str, path: str, body=None, *, auth: bool = True):
        if not path.startswith("/") or path.startswith("//"):
            raise ProbeError("invalid_request_path")
        data = None if body is None else json.dumps(body).encode()
        headers = {"Content-Type": "application/json"}
        if auth:
            headers["X-Session-API-Key"] = self.token
        request = urllib.request.Request(self.origin + path, data, headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                raw = response.read(8 * 1024 * 1024 + 1)
                if len(raw) > 8 * 1024 * 1024:
                    raise ProbeError("response_too_large")
                return response.status, json.loads(raw) if raw else None
        except urllib.error.HTTPError as exc:
            code = exc.code
            exc.close()
            return code, None
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            raise ProbeError("transport_unavailable") from exc
        except (ValueError, UnicodeError) as exc:
            raise ProbeError("invalid_json_response") from exc

    def expect(self, method: str, path: str, body=None, codes=(200,)):
        status, result = self.request(method, path, body)
        if status not in codes:
            raise ProbeError(f"unexpected_http_{status}")
        return result

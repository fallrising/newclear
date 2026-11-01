"""Fixed-origin, no-retry GitHub JSON transport for the isolated export worker."""

import json
import math
import re
import ssl
import time
from urllib.error import HTTPError
from urllib.parse import unquote, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, ProxyHandler, Request, build_opener

API_VERSION = "2026-03-10"
BODY_LIMIT = 8 * 1024 * 1024
TIMEOUT = 15


class GitHubError(Exception):
    """A bounded reason only; remote messages, paths and credentials stay private."""

    def __init__(self, code, *, uncertain=False):
        self.code = code
        self.uncertain = uncertain
        super().__init__(code)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError()
        result[key] = value
    return result


def _reject_constant(value):
    raise ValueError()


def _json_safe(value):
    pending, count = [value], 0
    while pending:
        item = pending.pop()
        count += 1
        if count > 1000000:
            raise ValueError()
        if type(item) is str:
            item.encode("utf-8")
        elif type(item) is dict:
            pending.extend(item.keys())
            pending.extend(item.values())
        elif type(item) is list:
            pending.extend(item)
        elif type(item) is float and not math.isfinite(item):
            raise ValueError()
        elif item is not None and type(item) not in (int, float, bool):
            raise ValueError()


def _valid_path(path):
    if type(path) is not str or not path.startswith("/repos/") or len(path) > 4096:
        return False
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or parsed.fragment or "#" in path:
        return False
    decoded = unquote(path)
    if (
        any(ord(char) <= 32 or ord(char) >= 127 for char in path)
        or any(ord(char) < 32 or ord(char) == 127 for char in decoded)
        or "\\" in decoded
        or "%" in decoded
        or "#" in decoded
        or any(part in ("", ".", "..") for part in unquote(parsed.path).split("/")[1:])
    ):
        return False
    return re.fullmatch(r"/repos/[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+(?:/.*)?", parsed.path) is not None


class GitHubClient:
    """Use a 15-second socket timeout and response deadline, without retries.

    A read already blocked when the response deadline passes may consume the
    remaining socket timeout. This is not a process-level wall-clock watchdog.
    """

    def __init__(self, token: str, *, opener=None):
        if type(token) is not str or not re.fullmatch(r"[A-Za-z0-9_.-]{1,4096}", token):
            raise GitHubError("github_config_invalid")
        self._token = token
        self.opener = (
            opener
            if opener is not None
            else build_opener(
                ProxyHandler({}), HTTPSHandler(context=ssl.create_default_context()), _NoRedirect()
            )
        )

    def request(self, method: str, path: str, payload=None):
        if (
            type(method) is not str
            or method not in {"GET", "POST"}
            or not _valid_path(path)
            or (method == "GET" and payload is not None)
        ):
            raise GitHubError("github_request_invalid")
        try:
            data = None
            if payload is not None:
                _json_safe(payload)
                data = json.dumps(
                    payload, ensure_ascii=True, allow_nan=False, separators=(",", ":")
                ).encode()
                if len(data) > BODY_LIMIT:
                    raise ValueError()
            request = Request(
                "https://api.github.com" + path,
                data=data,
                method=method,
                headers={
                    "Authorization": "Bearer " + self._token,
                    "Accept": "application/vnd.github+json",
                    "Content-Type": "application/json",
                    "Accept-Encoding": "identity",
                    "X-GitHub-Api-Version": API_VERSION,
                    "User-Agent": "agent-platform-export",
                },
            )
        except (TypeError, ValueError, UnicodeError, RecursionError):
            raise GitHubError("github_request_invalid") from None
        uncertain = method == "POST"
        try:
            deadline = time.monotonic() + TIMEOUT
            with self.opener.open(request, timeout=TIMEOUT) as response:
                status = response.status
                if type(status) is not int or status < 200 or status >= 300:
                    if method == "GET" and status == 404:
                        return None
                    raise GitHubError("github_http_error", uncertain=uncertain)
                headers = response.headers
                content_type = headers.get("Content-Type", "").split(";", 1)[0].strip().lower()
                if content_type not in {"application/json", "application/vnd.github+json"}:
                    raise ValueError()
                if headers.get("Content-Encoding", "identity").lower() != "identity":
                    raise ValueError()
                size = headers.get("Content-Length")
                if size is not None and (
                    not re.fullmatch(r"[0-9]{1,10}", size) or int(size) > BODY_LIMIT
                ):
                    raise ValueError()
                chunks, received = [], 0
                reader = getattr(response, "read1", response.read)
                while True:
                    if time.monotonic() >= deadline:
                        raise TimeoutError()
                    chunk = reader(min(65536, BODY_LIMIT + 1 - received))
                    if not chunk:
                        break
                    if type(chunk) is not bytes:
                        raise ValueError()
                    received += len(chunk)
                    if received > BODY_LIMIT:
                        raise ValueError()
                    chunks.append(chunk)
                if size is not None and received != int(size):
                    raise ValueError()
                value = json.loads(
                    b"".join(chunks).decode("utf-8"),
                    object_pairs_hook=_unique,
                    parse_constant=_reject_constant,
                )
                if type(value) not in (dict, list):
                    raise ValueError()
                _json_safe(value)
                return value
        except HTTPError as error:
            status = error.code
            error.close()
            if method == "GET" and status == 404:
                return None
            code = (
                "github_http_" + str(status)
                if status in {401, 403, 404, 409, 422, 429, 500, 502, 503, 504}
                else "github_http_error"
            )
            raise GitHubError(code, uncertain=uncertain) from None
        except GitHubError:
            raise
        except (ValueError, TypeError, UnicodeError, RecursionError):
            raise GitHubError("github_response_invalid", uncertain=uncertain) from None
        except Exception:
            raise GitHubError("github_transport_error", uncertain=uncertain) from None

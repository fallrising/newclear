"""Bounded fixed-destination HTTP fixture transport; never retries or redirects."""

import http.client
import socket
import threading
import time
from urllib.parse import urlsplit

from .domain import Problem
from .model_policy import MAX_RESPONSE, canonical

TOTAL_SECONDS = 10


def interrupt(sock):
    try:
        sock.shutdown(socket.SHUT_RDWR)
    except OSError:
        pass


class FixtureUpstream:
    def __init__(self, policy):
        self.policy = policy

    def complete(self, payload, *, mock_run_id=None):
        url = urlsplit(self.policy.origin)
        connection = http.client.HTTPConnection("127.0.0.1", url.port, timeout=5)
        result, watchdog = None, None
        try:
            deadline = time.monotonic() + TOTAL_SECONDS
            connection.connect()
            # A socket read timeout alone resets for every header byte. A watchdog
            # bounds slow-drip headers too, without leaving an orphan request thread.
            watchdog = threading.Timer(
                max(0, deadline - time.monotonic()), interrupt, args=(connection.sock,)
            )
            watchdog.daemon = True
            watchdog.start()
            headers = {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + self.policy.credential,
            }
            if mock_run_id is not None:
                # Local test contract only; never included in provider JSON or guest data.
                headers["X-Local-Mock-Run-Id"] = str(mock_run_id)
            connection.request(
                "POST",
                "/v1/chat/completions",
                body=canonical(payload),
                headers=headers,
            )
            result = connection.getresponse()
            if result.status != 200:
                raise Problem(
                    429 if result.status == 429 else 502,
                    "model_rate_limited" if result.status == 429 else "model_upstream_rejected",
                )
            lengths = result.headers.get_all("Content-Length", [])
            if (
                len(lengths) != 1
                or not lengths[0].isascii()
                or not lengths[0].isdigit()
                or not 0 < int(lengths[0]) <= MAX_RESPONSE
                or result.getheader("Transfer-Encoding")
                or result.getheader("Content-Encoding")
                or result.getheader("Content-Type", "").split(";")[0] != "application/json"
            ):
                raise Problem(502, "model_upstream_framing_invalid")
            remaining = int(lengths[0])
            body = bytearray()
            while remaining:
                timeout = deadline - time.monotonic()
                if timeout <= 0:
                    raise TimeoutError()
                # HTTP/1.0 may have detached the socket from HTTPConnection already.
                result.fp.raw._sock.settimeout(min(timeout, 5))
                chunk = result.read1(min(remaining, 65536))
                if not chunk:
                    raise Problem(502, "model_upstream_truncated")
                body.extend(chunk)
                remaining -= len(chunk)
            return bytes(body)
        except (OSError, http.client.HTTPException):
            raise Problem(502, "model_upstream_unavailable") from None
        finally:
            if watchdog is not None:
                watchdog.cancel()
            if result is not None:
                result.close()
            connection.close()

"""Pinned SDK boundary for a single explicitly selected sandboxd origin."""

import re
import urllib.parse
import urllib.request
from importlib.metadata import version

from cocoonsandbox import Client

from .contracts import SANDBOX_SDK_VERSION
from .transport import NoRedirect, ProbeError, validate_origin


class SingleNodeClient(Client):
    def __init__(self, origin: str, token: str):
        if version("cocoonstack-sandbox") != SANDBOX_SDK_VERSION:
            raise ProbeError("sandbox_sdk_version_mismatch")
        self.origin = validate_origin(origin)
        if not token or not token.isascii() or any(ord(c) < 33 or ord(c) == 127 for c in token):
            raise ProbeError("invalid_sandbox_token")
        super().__init__(self.origin, api_token=token, timeout=15, keep_alive=0)
        self._safe_opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({}),
            NoRedirect(),
            urllib.request.HTTPSHandler(context=self._tls()),
        )

    def _check_origin(self, addr):
        normalized = addr if "://" in addr else f"{self._scheme}://{addr}"
        if validate_origin(normalized) != self.origin:
            raise ProbeError("sandbox_origin_changed")

    def _open(self, req, timeout):
        parsed = urllib.parse.urlsplit(req.full_url)
        self._check_origin(f"{parsed.scheme}://{parsed.netloc}")
        return self._safe_opener.open(req, timeout=timeout)

    def _dial(self, addr, sandbox_id, token, deadline=None):
        self._check_origin(addr)
        return super()._dial(addr, sandbox_id, token, deadline)

    def _claim_from(self, addr, claim, path="/v1/claim", verb="claim", *, deadline=None):
        # The SDK's cluster fallback can retry an uncertain POST. M0 is single-node:
        # one allocation request, no placement redirect and no implicit retry.
        self._check_origin(addr)
        reply = self._post_json(addr, path, {**claim, "no_redirect": True}, verb, deadline=deadline)
        if reply.get("redirect"):
            raise ProbeError("sandbox_placement_redirect_refused")
        self._check_origin(reply.get("owner_addr") or addr)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,127}", reply.get("id", "")):
            raise ProbeError("invalid_sandbox_id")
        return self._handle_from(addr, reply, verb)

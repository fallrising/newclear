"""Treat guest output as data before it leaves the credential-owning connector.

Literal known-credential filtering is defense in depth, not a DLP guarantee against
encoding, splitting or deliberate exfiltration. It does not replace guest isolation.
"""

import hashlib
import json

from .domain import Problem

DIFF_LIMIT = 256 * 1024
RESULT_LIMIT = 2 * 1024 * 1024
VERIFICATION_REASON = "Fixed fixture assertion only; repository tests not configured."


class OutputPolicy:
    def __init__(self, service, row):
        # Node operator credential never belongs in a guest, but must also be covered
        # if an upstream bug echoes it. Empty optional fixture credentials are ignored.
        self.secrets = tuple(
            sorted(
                {
                    value
                    for value in (
                        service.token,
                        getattr(service.client, "api_token", None),
                        row.get("session_key"),
                        row.get("model_local_key"),
                        row.get("handle", {}).get("token"),
                        *row.get("model_tokens", []),
                    )
                    if isinstance(value, str) and value
                },
                key=len,
                reverse=True,
            )
        )

    def sensitive(self, value):
        if isinstance(value, str):
            return any(secret in value for secret in self.secrets)
        if isinstance(value, dict):
            return any(self.sensitive(k) or self.sensitive(v) for k, v in value.items())
        if isinstance(value, list):
            return any(self.sensitive(v) for v in value)
        return False

    def require_safe(self, value, code):
        if self.sensitive(value):
            raise Problem(409, code)

    def redact(self, value):
        # Walk decoded JSON BEFORE serializing; quotes, backslashes and non-ASCII
        # credentials must not evade checks through JSON escaping. Include map keys.
        if isinstance(value, str):
            for secret in self.secrets:
                value = value.replace(secret, "[redacted]")
            return value
        if isinstance(value, dict):
            return {self.redact(k): self.redact(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.redact(v) for v in value]
        return value

    def metadata(self, value, limit=256):
        if not isinstance(value, str) or not 0 < len(value) <= limit:
            raise Problem(409, "backend_metadata_invalid")
        # Changing an ID/cursor would break deduplication and replay. Reject instead.
        self.require_safe(value, "backend_sensitive_metadata")
        return value


def workspace_result(raw, row, policy):
    """Validate exact fixture schema and patch bytes; never silently edit a patch."""
    if not isinstance(raw, str) or len(raw.encode("utf-8")) > RESULT_LIMIT:
        raise Problem(409, "backend_result_too_large")
    try:
        value = json.loads(raw)
    except (ValueError, RecursionError):
        raise Problem(409, "backend_result_invalid") from None
    policy.require_safe(value, "backend_sensitive_result")
    if not isinstance(value, dict) or set(value) != {
        "base_sha",
        "diff",
        "diff_sha256",
        "diff_bytes",
        "verification",
        "workspace_value",
    }:
        raise Problem(409, "backend_result_invalid")
    diff = value["diff"]
    if not isinstance(diff, str):
        raise Problem(409, "backend_result_invalid")
    try:
        patch = diff.encode("utf-8")
    except UnicodeError:
        raise Problem(409, "backend_result_invalid") from None
    if (
        len(patch) > DIFF_LIMIT
        or type(value["diff_bytes"]) is not int
        or value["diff_bytes"] != len(patch)
        or value["diff_sha256"] != hashlib.sha256(patch).hexdigest()
        or value["base_sha"] != row["input"]["base_sha"]
    ):
        raise Problem(409, "backend_result_integrity_failed")
    verification = value["verification"]
    if not isinstance(verification, dict) or set(verification) != {
        "status",
        "name",
        "exit_code",
        "reason",
    }:
        raise Problem(409, "backend_verification_invalid")
    passed = verification["status"] == "passed"
    if (
        verification["status"] not in ("passed", "failed")
        or verification["name"] != "m2_fixture_workspace_assertion"
        or type(verification["exit_code"]) is not int
        or verification["exit_code"] != (0 if passed else 1)
        or verification["reason"] != VERIFICATION_REASON
        or value["workspace_value"] != (row["run_id"] + "\n" if passed else None)
    ):
        raise Problem(409, "backend_verification_invalid")
    return {
        **value,
        "execution_mode": "cocoon-fixture",
        "summary": "OpenHands 已在獨立 VM 執行固定的檔案修改驗收。",
    }

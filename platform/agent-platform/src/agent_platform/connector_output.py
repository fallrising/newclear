"""Treat guest output as data before it leaves the credential-owning connector.

Literal known-credential filtering is defense in depth, not a DLP guarantee against
encoding, splitting or deliberate exfiltration. It does not replace guest isolation.
"""

import hashlib
import json
import re

from .domain import Problem
from .verification import VerificationPolicy, contract_sha256

DIFF_LIMIT = 256 * 1024
RESULT_LIMIT = 2 * 1024 * 1024
VERIFICATION_REASON = "Fixed fixture assertion only; repository tests not configured."
CHECK_OUTPUT_LIMIT = 1024 * 1024
CHECK_REASONS = {
    "check_exit_zero",
    "check_exit_nonzero",
    "check_start_failed",
    "check_timeout",
    "check_output_limit",
    "check_execution_unconfirmed",
    "check_process_unconfirmed",
}


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
    try:
        contract = VerificationPolicy.model_validate(
            row["input"].get(
                "verification",
                {"mode": "fixture-m2", "revision": "profile-checks-v1", "checks": []},
            )
        )
    except (ValueError, TypeError):
        raise Problem(409, "backend_verification_policy_invalid") from None
    verification = value["verification"]
    if not isinstance(verification, dict):
        raise Problem(409, "backend_verification_invalid")
    if contract.mode == "fixture-m2":
        if set(verification) != {"status", "name", "exit_code", "reason"}:
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
    else:
        _validate_profile_verification(verification, contract, value, patch)
        if value["workspace_value"] is not None:
            raise Problem(409, "backend_verification_invalid")
    summary = (
        "OpenHands 已在獨立 VM 執行固定的檔案修改驗收。"
        if contract.mode == "fixture-m2"
        else "OpenHands 已在獨立 VM 執行此 profile 設定的驗證。"
        if contract.mode == "commands"
        else "OpenHands 已在獨立 VM 執行；此 profile 未設定驗證條件。"
    )
    return {
        **value,
        "execution_mode": "cocoon-fixture",
        "summary": summary,
    }


def _validate_profile_verification(verification, contract, result, patch):
    expected = {
        "status",
        "name",
        "revision",
        "contract_sha256",
        "diff_sha256",
        "checks",
        "reason",
    }
    if (
        set(verification) != expected
        or verification["name"] != "profile_verification"
        or not isinstance(verification["status"], str)
        or not isinstance(verification["reason"], str)
        or not isinstance(verification["revision"], str)
        or not isinstance(verification["contract_sha256"], str)
        or not isinstance(verification["diff_sha256"], str)
    ):
        raise Problem(409, "backend_verification_invalid")
    if (
        verification["revision"] != contract.revision
        or verification["contract_sha256"] != contract_sha256(contract)
        or verification["diff_sha256"] != hashlib.sha256(patch).hexdigest()
        or not isinstance(verification["checks"], list)
        or len(verification["checks"]) != len(contract.checks)
    ):
        raise Problem(409, "backend_verification_contract_mismatch")
    statuses = []
    for actual, expected_check in zip(verification["checks"], contract.checks, strict=True):
        if not isinstance(actual, dict) or set(actual) != {
            "id",
            "status",
            "exit_code",
            "duration_ms",
            "output_bytes",
            "output_sha256",
            "reason",
        }:
            raise Problem(409, "backend_verification_invalid")
        status, code, reason = actual["status"], actual["exit_code"], actual["reason"]
        if (
            actual["id"] != expected_check.id
            or not isinstance(status, str)
            or status not in {"passed", "failed", "unknown"}
            or type(actual["duration_ms"]) is not int
            or not 0 <= actual["duration_ms"] <= expected_check.timeout_seconds * 1000 + 2000
            or type(actual["output_bytes"]) is not int
            or not 0 <= actual["output_bytes"] <= CHECK_OUTPUT_LIMIT + 1
            or not isinstance(actual["output_sha256"], str)
            or not re.fullmatch(r"[a-f0-9]{64}", actual["output_sha256"])
            or not isinstance(reason, str)
            or reason not in CHECK_REASONS
            or (
                status == "passed"
                and (reason != "check_exit_zero" or type(code) is not int or code != 0)
            )
            or (
                status == "failed"
                and (
                    reason != "check_exit_nonzero" or type(code) is not int or not 1 <= code <= 255
                )
            )
            or (status == "unknown" and (reason == "check_exit_zero" or code is not None))
        ):
            raise Problem(409, "backend_verification_invalid")
        statuses.append(status)
    if contract.mode == "none":
        expected_status, expected_reason = "unknown", "verification_not_configured"
    elif verification["reason"] == "verification_modified_workspace":
        expected_status, expected_reason = "unknown", "verification_modified_workspace"
    elif all(status == "passed" for status in statuses):
        expected_status, expected_reason = "passed", "checks_passed"
    elif "unknown" in statuses:
        expected_status, expected_reason = "unknown", "check_outcome_unknown"
    else:
        expected_status, expected_reason = "failed", "check_failed"
    if verification["status"] != expected_status or verification["reason"] != expected_reason:
        raise Problem(409, "backend_verification_invalid")

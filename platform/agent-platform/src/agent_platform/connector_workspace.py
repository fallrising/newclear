"""Private run-bound workspace interface for a trusted external agent coordinator.

Only the AP worker forwards committed SQL leases. This endpoint never creates,
renews or transfers execution ownership and never exposes the node SDK handle.
"""

import hashlib
import json
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from .connector_isolation import CODE
from .connector_output import OutputPolicy, workspace_result
from .domain import Input, Problem

MAX_TEXT = 32768
MAX_OPERATIONS = 128
MAX_RECEIPTS = 4 * 1024 * 1024
HELPERS = ("guest_control.py", "guest_workspace.py", "guest_external.py", "guest_review.py")
REVISION = "external-workspace-v1"


class WorkspaceOperation(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)

    generation: int = Field(ge=1)
    operation_id: UUID
    action: Literal["read", "write", "exec"]
    path: str | None = Field(default=None, min_length=1, max_length=512)
    content: str | None = Field(default=None, max_length=MAX_TEXT)
    argv: list[str] | None = Field(default=None, min_length=1, max_length=32)
    timeout_seconds: int = Field(default=30, ge=1, le=60, strict=True)

    @model_validator(mode="after")
    def fields_for_action(self):
        if self.action == "exec":
            if self.path is not None or self.content is not None or not self.argv:
                raise ValueError("workspace_exec_arguments_invalid")
            if any(not value or len(value) > 4096 or "\x00" in value for value in self.argv):
                raise ValueError("workspace_exec_arguments_invalid")
            if sum(len(value.encode()) for value in self.argv) > MAX_TEXT:
                raise ValueError("workspace_exec_arguments_invalid")
        else:
            if not self.path or self.argv is not None:
                raise ValueError("workspace_file_arguments_invalid")
            parts = self.path.split("/")
            if (
                PurePosixPath(self.path).is_absolute()
                or any(part in {"", ".", ".."} for part in parts)
                or "\x00" in self.path
            ):
                raise ValueError("workspace_path_invalid")
            if self.action == "read" and self.content is not None:
                raise ValueError("workspace_read_arguments_invalid")
            if self.action == "write" and (
                self.content is None or len(self.content.encode()) > MAX_TEXT
            ):
                raise ValueError("workspace_write_arguments_invalid")
        return self


def validate_wire(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError("duplicate_workspace_field")
            value[key] = item
        return value

    json.loads(raw, object_pairs_hook=unique)


def is_external(row):
    return row.get("input", {}).get("external_workspace", False) is True


def prepare(service, row):
    try:
        return _prepare(service, row)
    except Exception as exc:
        # Private bounded diagnostics; preserve unknown intent and never replay it.
        failure = {
            "stage": row.get("external_prepare_stage", "initial"),
            "type": type(exc).__name__,
        }
        if type(getattr(exc, "code", None)) is int:
            failure["exit_code"] = exc.code
        stderr = getattr(exc, "stderr", None)
        if isinstance(stderr, str):
            failure["stderr"] = OutputPolicy(service, row).redact(stderr[:4096])
        row["external_prepare_failure"] = failure
        service.journal.write(row)
        raise


def _prepare(service, row):
    def stage(value):
        row["external_prepare_stage"] = value
        service.journal.write(row)

    stage("bundle")
    sb = service.handle(row)
    data = row["input"]
    service.guard(row)
    sb.exec("install", "-d", "-m", "0755", CODE, timeout=10)
    review = data.get("purpose") == "review"
    if review:
        from .review import candidate_bytes

        payload = candidate_bytes(
            data["review_candidate"].encode("utf-8"), data["candidate_sha256"]
        )
        sb.exec("install", "-d", "-m", "0755", "/var/lib/agent-platform", timeout=10)
        sb.exec("install", "-d", "-m", "0555", "/var/lib/agent-platform/review", timeout=10)
        sb.write_file("/var/lib/agent-platform/review/candidate.json", payload, mode=0o444)
    else:
        sb.write_file(
            CODE + "/source.bundle",
            service.bundle(service.entries[(data["canonical_repo"], data["base_sha"])]),
            mode=0o644,
        )
    stage("helpers")
    for name in HELPERS:
        service.guard(row)
        sb.write_file(CODE + "/" + name, Path(__file__).with_name(name).read_bytes(), mode=0o644)
    service.guard(row)
    stage("control_setup")
    sb.exec("python3", "-I", CODE + "/guest_control.py", '{"action":"setup"}', timeout=10)
    service.guard(row)
    stage("candidate" if review else "checkout")
    raw = sb.exec(
        "python3",
        "-I",
        CODE + ("/guest_review.py" if review else "/guest_external.py"),
        json.dumps(
            {"action": "verify", "candidate_sha256": data["candidate_sha256"]}
            if review
            else {"action": "checkout", "base_sha": data["base_sha"]}
        ),
        timeout=10 if review else 95,
    )
    checkout = json.loads(raw)
    expected = (
        {"candidate_sha256": data["candidate_sha256"]} if review else {"base_sha": data["base_sha"]}
    )
    if checkout != expected:
        raise Problem(409, "review_candidate_invalid" if review else "checkout_sha_mismatch")
    row["external_isolation_revision"] = REVISION
    service.journal.write(row)
    stage("attestation")
    service.isolation(row)
    return {"ref": row["run_id"], "external_workspace": True, **checkout}


def attest(service, row):
    if row.get("external_isolation_revision") != REVISION:
        raise Problem(409, "external_isolation_upgrade_required")
    sb = service.handle(row)
    files = {
        name: hashlib.sha256(Path(__file__).with_name(name).read_bytes()).hexdigest()
        for name in HELPERS
    }
    if (
        sb.exec("sha256sum", CODE + "/guest_control.py", timeout=5).split()[0]
        != files["guest_control.py"]
    ):
        raise Problem(409, "guest_isolation_probe_changed")
    proof = json.loads(
        sb.exec(
            "python3",
            "-I",
            CODE + "/guest_control.py",
            json.dumps({"action": "check", "files": files, "external_workspace": True}),
            timeout=5,
        )
    )
    if proof != {
        "revision": REVISION,
        "control_uid": 2001,
        "terminal_uid": 2000,
        "no_new_privileges": True,
        "private_workspace": True,
        "quiescent": True,
    }:
        raise Problem(409, "guest_isolation_unconfirmed")
    if row["input"].get("purpose") == "review":
        expected = row["input"]["candidate_sha256"]
        checked = json.loads(
            sb.exec(
                "python3",
                "-I",
                CODE + "/guest_review.py",
                json.dumps({"action": "verify", "candidate_sha256": expected}),
                timeout=5,
            )
        )
        if checked != {"candidate_sha256": expected}:
            raise Problem(409, "review_candidate_invalid")
    service.network(row)
    return proof


def exchange(service, run_id, request):
    from .connector import fingerprint

    with service.journal.locked(run_id):
        row = service.require(run_id, request.generation)
        service.guard(row)
        if not is_external(row):
            raise Problem(409, "external_workspace_not_enabled")
        if datetime.fromisoformat(row["input"]["deadline"]) <= datetime.now(UTC):
            raise Problem(409, "run_deadline_expired")
        review = row["input"].get("purpose") == "review"
        if review and (request.action != "read" or request.path != "candidate.json"):
            raise Problem(409, "review_tool_denied")
        operations = row["operations"]
        if "result" in operations or "release" in operations:
            raise Problem(409, "workspace_admission_closed")
        if operations.get("prepare", {}).get("state") != "completed":
            raise Problem(409, "connector_prerequisite_unconfirmed")
        if any(op["state"] != "completed" for op in operations.values()):
            raise Problem(409, "connector_operation_uncertain")
        key = "workspace:" + str(request.operation_id)
        if (
            key not in operations
            and sum(k.startswith("workspace:") for k in operations) >= MAX_OPERATIONS
        ):
            raise Problem(409, "workspace_operation_limit")
        if (
            key not in operations
            and len(json.dumps(operations).encode()) + 256 * 1024 > MAX_RECEIPTS
        ):
            raise Problem(409, "workspace_receipt_limit")
        payload = request.model_dump(mode="json")
        payload["generation"] = row["input"]["generation"]

        def effect():
            service.isolation(row)
            service.guard(row)
            remaining = (
                datetime.fromisoformat(row["input"]["deadline"]) - datetime.now(UTC)
            ).total_seconds()
            if remaining < request.timeout_seconds + 5:
                raise Problem(409, "workspace_deadline_too_close")
            raw = service.handle(row).exec(
                "python3",
                "-I",
                CODE + ("/guest_review.py" if review else "/guest_external.py"),
                json.dumps(
                    {
                        **request.model_dump(mode="json", exclude={"generation", "operation_id"}),
                        **(
                            {"candidate_sha256": row["input"]["candidate_sha256"]} if review else {}
                        ),
                    }
                ),
                timeout=request.timeout_seconds + 5,
            )
            # SDK timeout/ACK is never evidence of process termination.
            service.isolation(row)
            service.guard(row)
            if not isinstance(raw, str) or len(raw.encode()) > 256 * 1024:
                raise Problem(409, "workspace_output_invalid")
            try:
                value = json.loads(raw)
            except (ValueError, RecursionError):
                raise Problem(409, "workspace_output_invalid") from None
            if not isinstance(value, dict) or type(value.get("ok")) is not bool:
                raise Problem(409, "workspace_output_invalid")
            if len(json.dumps(value).encode()) > 256 * 1024:
                raise Problem(409, "workspace_output_invalid")
            OutputPolicy(service, row).require_safe(value, "backend_sensitive_result")
            return value

        return service.journal.operation(row, key, fingerprint(payload), effect)


def result(service, row):
    service.isolation(row)
    service.guard(row)
    if row["input"].get("purpose") == "review":
        return {
            "execution_mode": "cocoon-external",
            "summary": "Candidate-only review",
            "verification": {
                "status": "passed",
                "name": "candidate_integrity",
                "reason": "Exact readonly candidate hash verified; no coding checks executed.",
            },
        }
    verification = row["input"]["verification"]
    request = {
        "action": "result",
        "run_id": row["run_id"],
        "base_sha": row["input"]["base_sha"],
        "verification": verification,
    }
    timeout = min(
        180, max(90, 10 + sum(c["timeout_seconds"] for c in verification.get("checks", [])))
    )
    remaining = (
        datetime.fromisoformat(row["input"]["deadline"]) - datetime.now(UTC)
    ).total_seconds()
    if remaining < 10 + sum(c["timeout_seconds"] for c in verification.get("checks", [])):
        raise Problem(409, "workspace_deadline_too_close")
    raw = service.handle(row).exec(
        "python3",
        "-I",
        CODE + "/guest_external.py",
        json.dumps(request),
        timeout=min(timeout, int(remaining)),
    )
    service.isolation(row)
    service.guard(row)
    return workspace_result(raw, row, OutputPolicy(service, row))

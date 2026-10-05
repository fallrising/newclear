"""Explicit operator approval over immutable result bytes and an exact target."""

import hashlib
import json
from contextlib import nullcontext
from uuid import UUID, uuid4

from psycopg.errors import CheckViolation
from pydantic import BaseModel, ConfigDict, Field, field_validator

from .config import export_targets
from .domain import Problem
from .export_patch import patch_paths
from .result_archive import read_archive, require_run

FIELDS = (
    "id,run_id,artifact_id,artifact_sha256,target_repo,base_branch,base_sha,branch,"
    "state,reason,pr_url,created_at"
)
APPROVAL_FIELDS = (
    "run_id",
    "artifact_id",
    "artifact_sha256",
    "target_repo",
    "base_branch",
    "base_sha",
    "branch",
)


class PreviewInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    artifact_id: UUID
    artifact_sha256: str = Field(pattern=r"^[0-9a-f]{64}$")
    target_repo: str = Field(min_length=3, max_length=140)
    base_branch: str = Field(min_length=1, max_length=200)


class ApprovalInput(PreviewInput):
    base_sha: str = Field(pattern=r"^[0-9a-f]{40}$")
    branch: str = Field(min_length=1, max_length=200)
    approval_digest: str = Field(pattern=r"^[0-9a-f]{64}$")
    approved: bool = Field(strict=True)

    @field_validator("approved")
    @classmethod
    def explicit(cls, value):
        if value is not True:
            raise ValueError("explicit_approval_required")
        return value


class ReconcileInput(BaseModel):
    model_config = ConfigDict(extra="forbid")


def canonical_hash(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def require_target(targets, repo, branch):
    if {"repo": repo, "base_branch": branch} not in targets:
        raise Problem(409, "export_target_disabled")


def approved_fields(value):
    return {key: str(value[key]) for key in APPROVAL_FIELDS}


class _BoundTransaction:
    def __init__(self, conn):
        self.conn = conn

    def transaction(self):
        return nullcontext(self.conn)


def preview(db, targets, run_id, data, *, conn=None):
    require_target(targets, data.target_repo, data.base_branch)
    payload = read_archive(
        _BoundTransaction(conn) if conn is not None else db, run_id, data.artifact_id
    )
    if hashlib.sha256(payload).hexdigest() != data.artifact_sha256:
        raise Problem(409, "export_artifact_changed")
    artifact = json.loads(payload)
    result = artifact["result"]
    if len(artifact["base_sha"]) != 40:
        raise Problem(409, "export_base_unsupported")
    if not result.get("diff"):
        raise Problem(409, "export_patch_unsupported")
    paths = patch_paths(result["diff"])
    value = {
        "run_id": str(run_id),
        "artifact_id": str(data.artifact_id),
        "artifact_sha256": data.artifact_sha256,
        "target_repo": data.target_repo,
        "base_branch": data.base_branch,
        "base_sha": artifact["base_sha"],
    }
    value["branch"] = "agent-platform/export-" + canonical_hash(value)
    value["approval_digest"] = canonical_hash(approved_fields(value))
    return {
        **value,
        "verification_status": result["verification"]["status"],
        "files": paths,
        "diff": result["diff"],
    }


class ExportService:
    def __init__(self, db, targets):
        self.db = db
        self.targets = export_targets(targets)

    def preview(self, run_id, data):
        return preview(self.db, self.targets, run_id, data)

    def approve(self, conn, operator, run_id, data):
        expected = preview(self.db, self.targets, run_id, data, conn=conn)
        supplied = {**data.model_dump(mode="json"), "run_id": str(run_id)}
        if (
            approved_fields(expected) != approved_fields(supplied)
            or data.approval_digest != expected["approval_digest"]
            or data.approved is not True
        ):
            raise Problem(409, "export_approval_changed")
        try:
            row = conn.execute(
                f"INSERT INTO github_exports(id,run_id,artifact_id,artifact_sha256,target_repo,"
                f"base_branch,base_sha,branch,approval_digest,created_by) "
                f"VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s) "
                f"ON CONFLICT(approval_digest) DO NOTHING RETURNING {FIELDS}",
                (
                    uuid4(),
                    run_id,
                    data.artifact_id,
                    data.artifact_sha256,
                    data.target_repo,
                    data.base_branch,
                    data.base_sha,
                    data.branch,
                    data.approval_digest,
                    operator,
                ),
            ).fetchone()
        except CheckViolation as exc:
            if exc.diag.constraint_name == "github_export_archive_available":
                raise Problem(410, "artifact_expired") from None
            raise
        if row is None:
            row = conn.execute(
                f"SELECT {FIELDS} FROM github_exports WHERE approval_digest=%s",
                (data.approval_digest,),
            ).fetchone()
        return {"status": 202, "body": row}

    def list(self, run_id):
        with self.db.transaction() as conn:
            require_run(conn, run_id)
            return {
                "items": conn.execute(
                    f"SELECT {FIELDS} FROM github_exports WHERE run_id=%s ORDER BY created_at,id",
                    (run_id,),
                ).fetchall()
            }

    def reconcile(self, conn, run_id, operation_id):
        row = conn.execute(
            f"SELECT {FIELDS} FROM github_exports WHERE id=%s AND run_id=%s FOR UPDATE",
            (operation_id, run_id),
        ).fetchone()
        if row is None:
            raise Problem(404, "export_not_found")
        if row["state"] not in {"uncertain", "exporting"}:
            raise Problem(409, "export_reconcile_unavailable")
        conn.execute(
            "UPDATE github_exports SET reconcile_requested=true WHERE id=%s", (operation_id,)
        )
        return {"status": 202, "body": row}

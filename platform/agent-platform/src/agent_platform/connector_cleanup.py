"""One approved exact-capability release; journal replay only observes."""

import json
from datetime import UTC, datetime
from uuid import uuid4

from .connector_journal import private_file
from .connector_recovery import observe_sandbox, stopped
from .private_config import read_private_text
from .stale_cleanup_contract import (
    JOURNAL_LIMIT,
    canonical,
    digest,
    fail,
    hash_text,
    loads,
    parsed_time,
    require_time,
    timestamp,
    uuid_text,
    validate_plan,
)

ENVELOPE_FIELDS = {
    "schema_version",
    "connector_cleanup_identity",
    "enrolled_at",
    "ownership_digest",
    "issued_plans",
    "attempts",
    "tombstone",
}
CONTEXT_FIELDS = {
    "maintenance_id",
    "created_at",
    "expires_at",
    "run_id",
    "job_id",
    "binding_id",
    "node_id",
    "current_generation",
    "next_generation",
    "state_version",
    "terminal_state",
    "provider_handle",
    "archive_id",
    "archive_sha256",
    "db_digest",
    "result_digest",
}


def ownership(row):
    return digest(
        {
            "handle": row.get("handle"),
            "observed": row.get("observed"),
            "allocate": row.get("operations", {}).get("allocate"),
        }
    )


def envelope(row):
    if "stale_cleanup" not in row:
        if any(k.startswith("cleanup_") or k == "connector_cleanup_identity" for k in row):
            fail("enrollment_missing")
        return None
    value = row["stale_cleanup"]
    if type(value) is not dict or set(value) != ENVELOPE_FIELDS:
        fail("enrollment_invalid")
    if value["schema_version"] != "stale-cleanup-journal-v1":
        fail("enrollment_invalid")
    uuid_text(value["connector_cleanup_identity"])
    parsed_time(value["enrolled_at"])
    hash_text(value["ownership_digest"])
    if value["ownership_digest"] != ownership(row):
        fail("ownership_changed")
    plans, attempts = value["issued_plans"], value["attempts"]
    if type(plans) is not dict or not plans or type(attempts) is not dict:
        fail("enrollment_invalid")
    for key, plan in plans.items():
        validate_plan(plan, key)
        if (
            plan["run_id"] != row["run_id"]
            or plan["connector_cleanup_identity"] != value["connector_cleanup_identity"]
            or plan["ownership_digest"] != value["ownership_digest"]
        ):
            fail("enrollment_invalid")
    for key, attempt in attempts.items():
        uuid_text(key)
        if type(attempt) is not dict or set(attempt) != {
            "approval_digest",
            "generation",
            "started_at",
            "receipt",
        }:
            fail("attempt_invalid")
        plan = plans.get(attempt["approval_digest"])
        if (
            not plan
            or plan["attempt_id"] != key
            or attempt["generation"] != plan["next_generation"]
        ):
            fail("attempt_invalid")
        parsed_time(attempt["started_at"])
        receipt = attempt["receipt"]
        if receipt is not None:
            if type(receipt) is not dict or set(receipt) != {
                "attempt_id",
                "approval_digest",
                "connector_cleanup_identity",
                "observed_at",
                "status",
                "stop",
            }:
                fail("receipt_invalid")
            if (
                receipt["attempt_id"] != key
                or receipt["approval_digest"] != attempt["approval_digest"]
                or receipt["connector_cleanup_identity"] != value["connector_cleanup_identity"]
                or receipt["status"] != "stop_observed; reconciliation_pending"
                or not stopped(receipt["stop"])
            ):
                fail("receipt_invalid")
            parsed_time(receipt["observed_at"])
    tombstone = value["tombstone"]
    if tombstone is not None:
        if type(tombstone) is not dict or set(tombstone) != {
            "attempt_id",
            "approval_digest",
            "generation",
            "created_at",
        }:
            fail("tombstone_invalid")
        attempt = attempts.get(tombstone["attempt_id"])
        if (
            not attempt
            or tombstone["approval_digest"] != attempt["approval_digest"]
            or tombstone["generation"] != attempt["generation"]
            or tombstone["created_at"] != attempt["started_at"]
        ):
            fail("tombstone_invalid")
    elif attempts:
        fail("tombstone_missing")
    return value


def check_admission(row, *, stopping=False):
    value = envelope(row)
    if value and value["tombstone"] and not stopping:
        fail("run_stopping")


def read(service, run_id):
    path = service.journal.root / (uuid_text(str(run_id)) + ".json")
    try:
        path = private_file(path)
        if path.stat().st_size > JOURNAL_LIMIT or path.stat().st_nlink != 1:
            fail("journal_invalid")
        with path.open("rb") as stream:
            row = loads(stream.read(JOURNAL_LIMIT + 1), JOURNAL_LIMIT)
        if type(row) is not dict or row.get("run_id") != str(run_id):
            fail("journal_invalid")
        envelope(row)
        return row
    except (OSError, ValueError, KeyError, TypeError):
        fail("journal_invalid")


def write(service, row):
    envelope(row)
    canonical(row, JOURNAL_LIMIT)
    if len(json.dumps(row).encode()) > JOURNAL_LIMIT:
        fail("oversized")
    service.journal.write(row)


def require_original(service, row):
    operations = row.get("operations", {})
    if (
        any(
            operations.get(k, {}).get("state") != "completed"
            for k in ("allocate", "prepare", "prompt", "result")
        )
        or operations.get("release", {}).get("state") != "started"
        or any(v.get("state") != "completed" for k, v in operations.items() if k != "release")
        or not row.get("handle")
        or not row.get("observed")
    ):
        fail("original_intent_unconfirmed")
    try:
        root = read_private_text(service.config["sandbox_token_file"], max_bytes=65536).strip()
    except (KeyError, ValueError, OSError):
        fail("root_credential_unconfirmed")
    token = row["handle"].get("token")
    if not root or type(token) is not str or not token or token == root:
        fail("claim_credential_invalid")
    if row["handle"].get("id") != operations["allocate"]["result"].get("handle"):
        fail("ownership_changed")


def require_expired_fence(service, row, generation):
    with service.fences.journal.locked(row["run_id"]):
        fence = read_fence(service, row["run_id"])
        if fence["generation"] > generation or parsed_time_fence(
            fence["lease_until"]
        ) > datetime.now(UTC):
            fail("fence_live_or_newer")


def read_fence(service, run_id):
    try:
        path = private_file(service.fences.journal.root / (str(run_id) + ".json"))
        if path.stat().st_nlink != 1 or path.stat().st_size > 65536:
            fail("fence_invalid")
        with path.open("rb") as stream:
            fence = loads(stream.read(65537))
        if (
            type(fence) is not dict
            or set(fence) != {"run_id", "generation", "lease_until"}
            or fence["run_id"] != str(run_id)
            or type(fence["generation"]) is not int
            or fence["generation"] < 1
        ):
            fail("fence_invalid")
        parsed_time_fence(fence["lease_until"])
        return fence
    except (OSError, ValueError):
        fail("fence_missing_or_invalid")


def parsed_time_fence(value):
    try:
        parsed = datetime.fromisoformat(value)
        if parsed.tzinfo is None:
            fail("fence_invalid")
        return parsed
    except (TypeError, ValueError):
        fail("fence_invalid")


def preview(service, run_id, context):
    if type(context) is not dict or set(context) != CONTEXT_FIELDS:
        fail()
    with service.journal.locked(run_id):
        row = read(service, run_id)
        require_original(service, row)
        if row["generation"] != context["current_generation"]:
            fail("generation_changed")
        require_expired_fence(service, row, context["current_generation"])
        if row["handle"]["id"] != context["provider_handle"] or context["run_id"] != str(run_id):
            fail("ownership_changed")
        if digest(row["operations"]["result"]["result"]) != context["result_digest"]:
            fail("result_changed")
        if observe_sandbox(service, row) is not None:
            fail("already_stopped")
        require_expired_fence(service, row, context["current_generation"])
        value = envelope(row)
        identity = value["connector_cleanup_identity"] if value else str(uuid4())
        plan = {k: v for k, v in context.items() if k not in {"db_digest", "result_digest"}}
        plan.update(
            schema_version="stale-cleanup-v1",
            attempt_id=str(uuid4()),
            connector_cleanup_identity=identity,
            claim_ref=row["claim_ref"],
            ownership_digest=ownership(row),
            action="release-owned",
            precondition_digest=digest(
                {"db": context["db_digest"], "operations_digest": digest(row["operations"])}
            ),
        )
        plan["approval_digest"] = digest(plan)
        plan = validate_plan(plan)
        require_time(plan, datetime.now(UTC))
        if value is None:
            value = {
                "schema_version": "stale-cleanup-journal-v1",
                "connector_cleanup_identity": identity,
                "enrolled_at": plan["created_at"],
                "ownership_digest": plan["ownership_digest"],
                "issued_plans": {},
                "attempts": {},
                "tombstone": None,
            }
            row["stale_cleanup"] = value
        value["issued_plans"][plan["approval_digest"]] = plan
        write(service, row)
        return plan


def issued(service, plan):
    row = read(service, plan["run_id"])
    require_original(service, row)
    value = envelope(row)
    if (
        not value
        or value["issued_plans"].get(plan["approval_digest"]) != plan
        or value["connector_cleanup_identity"] != plan["connector_cleanup_identity"]
    ):
        fail("plan_not_issued")
    if row["handle"]["id"] != plan["provider_handle"] or row["claim_ref"] != plan["claim_ref"]:
        fail("ownership_changed")
    require_time(plan, datetime.now(UTC))
    return row, value


def lookup(service, plan, generation, lease_until, resume):
    plan = validate_plan(plan)
    with service.journal.locked(plan["run_id"]):
        row, value = issued(service, plan)
        started = plan["attempt_id"] in value["attempts"]
        if type(generation) is not int or row["generation"] > generation:
            fail("generation_changed")
        with service.fences.journal.locked(plan["run_id"]):
            fence = read_fence(service, plan["run_id"])
            if fence["generation"] > generation:
                fail("fence_missing_or_newer")
            until = parsed_time_fence(fence["lease_until"])
            if not started:
                if resume:
                    if (
                        generation != plan["next_generation"]
                        or lease_until is None
                        or parsed_time_fence(lease_until) <= datetime.now(UTC)
                        or until > parsed_time_fence(lease_until)
                        or (fence["generation"] < generation and until > datetime.now(UTC))
                    ):
                        fail("fence_live_or_newer")
                elif (
                    generation != plan["current_generation"]
                    or row["generation"] != generation
                    or until > datetime.now(UTC)
                ):
                    fail("fence_live_or_newer")
        return {"started": started, "operations_digest": digest(row["operations"])}


def grant(service, plan, lease_until):
    # Like Fences.grant, this never waits for the long run-operation lock.
    # Unlike ordinary grant, maintenance cannot create a missing fence.
    plan = validate_plan(plan)
    issued(service, plan)
    until = parsed_time_fence(lease_until)
    if not 0 < (until - datetime.now(UTC)).total_seconds() <= 35:
        fail("lease_invalid")
    with service.fences.journal.locked(plan["run_id"]):
        fence = read_fence(service, plan["run_id"])
        if fence["generation"] > plan["next_generation"]:
            fail("fence_missing_or_newer")
        if (
            fence["generation"] == plan["next_generation"]
            and parsed_time_fence(fence["lease_until"]) >= until
        ):
            return {"generation": plan["next_generation"]}
        service.fences.journal.write(
            {
                "run_id": plan["run_id"],
                "generation": plan["next_generation"],
                "lease_until": lease_until,
            }
        )
        return {"generation": plan["next_generation"]}


def observe_attempt(service, row, value, plan):
    attempt = value["attempts"][plan["attempt_id"]]
    if attempt["receipt"] is not None:
        return attempt["receipt"]
    try:
        proof = observe_sandbox(service, row)
    except Exception:
        proof = None
    if proof is None:
        return {"attempt_id": plan["attempt_id"], "status": "unknown"}
    receipt = {
        "attempt_id": plan["attempt_id"],
        "approval_digest": plan["approval_digest"],
        "connector_cleanup_identity": plan["connector_cleanup_identity"],
        "observed_at": timestamp(datetime.now(UTC)),
        "status": "stop_observed; reconciliation_pending",
        "stop": proof,
    }
    attempt["receipt"] = receipt
    write(service, row)
    return receipt


def apply(service, plan, generation, db_digest, *, observe_only=False):
    plan = validate_plan(plan)
    with service.journal.locked(plan["run_id"]):
        row, value = issued(service, plan)
        if (
            digest({"db": db_digest, "operations_digest": digest(row["operations"])})
            != plan["precondition_digest"]
        ):
            fail("precondition_changed")
        if plan["attempt_id"] in value["attempts"]:
            return observe_attempt(service, row, value, plan)
        if observe_only or type(generation) is not int or generation != plan["next_generation"]:
            fail("attempt_not_started")
        service.fences.require(plan["run_id"], generation)
        if row["generation"] > generation:
            fail("generation_changed")
        proof = observe_sandbox(service, row)
        require_time(plan, datetime.now(UTC))
        service.fences.require(plan["run_id"], generation)
        row["generation"] = generation
        now = timestamp(datetime.now(UTC))
        value["attempts"][plan["attempt_id"]] = {
            "approval_digest": plan["approval_digest"],
            "generation": generation,
            "started_at": now,
            "receipt": None,
        }
        if value["tombstone"] is None:
            value["tombstone"] = {
                "attempt_id": plan["attempt_id"],
                "approval_digest": plan["approval_digest"],
                "generation": generation,
                "created_at": now,
            }
        write(service, row)
        if proof is None:
            try:
                service.fences.require(plan["run_id"], generation)
                require_time(plan, datetime.now(UTC))
                service.handle(row).close()
                service.host.wait_removed(row["observed"])
            except Exception:
                pass  # Intent is durable. Neither transport failure nor replay repeats release.
        return observe_attempt(service, row, value, plan)

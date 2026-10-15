"""Trusted grant admission. No I/O and no trust taken from the request body."""

import math

from agent_workforce.domain import Registry, RegistryError, canonical_path

_OPERATIONS = {"execute", "review", "rework"}
_ORIGINS = {"operator", "agent", "replay"}


class AdmissionError(ValueError):
    """Admission rejected the request."""

    def __init__(self, reason):
        self.reason = reason
        super().__init__(reason)


def _malformed():
    raise AdmissionError("malformed")


def _text(value):
    if not isinstance(value, str) or value == "":
        _malformed()
    return value


def _positive_int(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        _malformed()
    return value


def _nonnegative_int(value):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        _malformed()
    return value


def _finite(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _malformed()
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        _malformed()
    return value


def _bool(value):
    if not isinstance(value, bool):
        _malformed()
    return value


def _canonical(value):
    try:
        return canonical_path(value)
    except RegistryError:
        _malformed()


def _json_value(value, depth=0):
    if depth > 40:
        _malformed()
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            _malformed()
        return value
    if isinstance(value, list):
        return [_json_value(item, depth + 1) for item in value]
    if isinstance(value, dict):
        copied = {}
        for key, item in value.items():
            if not isinstance(key, str):
                _malformed()
            copied[key] = _json_value(item, depth + 1)
        return copied
    _malformed()


def _string_list(value, *, allow_empty):
    if not isinstance(value, list):
        _malformed()
    if not allow_empty and not value:
        _malformed()
    copied = []
    for item in value:
        copied.append(_text(item))
    return copied


def _scope_map(value):
    if not isinstance(value, dict):
        _malformed()
    copied = {}
    for resource_id, spec in value.items():
        resource_id = _text(resource_id)
        if not isinstance(spec, dict) or "read" not in spec or "write" not in spec:
            _malformed()
        copied[resource_id] = {
            "read": [_canonical(path) for path in _require_list(spec.get("read"))],
            "write": [_canonical(path) for path in _require_list(spec.get("write"))],
        }
    return copied


def _require_list(value):
    if not isinstance(value, list):
        _malformed()
    return value


def _operations(value):
    copied = _string_list(value, allow_empty=False)
    if any(item not in _OPERATIONS for item in copied):
        _malformed()
    return copied


def _usage(usage):
    if usage is None:
        usage = {}
    if not isinstance(usage, dict):
        _malformed()
    turns = usage.get("turns", 0)
    messages = usage.get("messages", 0)
    turns = _nonnegative_int(turns)
    messages = _nonnegative_int(messages)
    if "provider_tokens" not in usage or usage["provider_tokens"] is None:
        tokens = None
    else:
        tokens = usage["provider_tokens"]
        if isinstance(tokens, bool) or not isinstance(tokens, int) or tokens < 0:
            _malformed()
    if "provider_cost" not in usage or usage["provider_cost"] is None:
        cost = None
    else:
        cost = _finite(usage["provider_cost"])
        if cost < 0:
            _malformed()
    return turns, messages, tokens, cost


def _normalize_grant(grant):
    if not isinstance(grant, dict):
        _malformed()
    return {
        "grant_id": _text(grant.get("grant_id")),
        "revision": _positive_int(grant.get("revision")),
        "issuer": _text(grant.get("issuer")),
        "job_id": _text(grant.get("job_id")),
        "worker_id": _text(grant.get("worker_id")),
        "route_ids": _string_list(grant.get("route_ids"), allow_empty=False),
        "resource_scopes": _scope_map(grant.get("resource_scopes")),
        "operations": _operations(grant.get("operations")),
        "allowed_steps": _string_list(grant.get("allowed_steps"), allow_empty=False),
        "input_revision": _positive_int(grant.get("input_revision")),
        "ac_revision": _positive_int(grant.get("ac_revision")),
        "expires_at": _finite(grant.get("expires_at")),
        "revocation_epoch": _nonnegative_int(grant.get("revocation_epoch")),
        "revoked": _bool(grant.get("revoked")),
        "max_turns": _positive_int(grant.get("max_turns")),
        "max_messages": _positive_int(grant.get("max_messages")),
        "max_hops": _nonnegative_int(grant.get("max_hops")),
        "allow_agent_trigger": _bool(grant.get("allow_agent_trigger")),
        "allowed_callers": _string_list(grant.get("allowed_callers"), allow_empty=True),
    }


def _normalize_request(request, caller):
    if not isinstance(request, dict):
        _malformed()
    sender = _text(request.get("sender"))
    if sender != caller:
        raise AdmissionError("forged_sender")
    for key in ("caller", "claimed_caller"):
        if key in request:
            claimed = _text(request.get(key))
            if claimed != caller:
                raise AdmissionError("forged_caller")
    origin = _text(request.get("origin"))
    if origin not in _ORIGINS:
        _malformed()
    operation = _text(request.get("operation"))
    if operation not in _OPERATIONS:
        _malformed()
    normalized = {
        "sender": sender,
        "caller": caller,
        "origin": origin,
        "grant_id": _text(request.get("grant_id")),
        "job_id": _text(request.get("job_id")),
        "step_id": _text(request.get("step_id")),
        "input": _json_value(request.get("input")) if "input" in request else _malformed(),
        "input_revision": _positive_int(request.get("input_revision")),
        "ac_revision": _positive_int(request.get("ac_revision")),
        "worker_id": _text(request.get("worker_id")),
        "route_id": _text(request.get("route_id")),
        "route_revision": _positive_int(request.get("route_revision")),
        "worker_revision": _positive_int(request.get("worker_revision")),
        "account_revision": _positive_int(request.get("account_revision")),
        "entitlement_revision": _positive_int(request.get("entitlement_revision")),
        "profile_revision": _positive_int(request.get("profile_revision")),
        "operation": operation,
        "resource_scopes": _scope_map(request.get("resource_scopes")),
        "session_binding_id": _text(request.get("session_binding_id")),
        "hop": _nonnegative_int(request.get("hop")),
    }
    if "recipients" in request:
        normalized["recipients"] = _string_list(request.get("recipients"), allow_empty=True)
    return normalized


def _need(record):
    if record is None:
        raise AdmissionError("missing")
    return record


def _contained(path, allowed):
    for root in allowed:
        if root == ".":
            return True
        if path == ".":
            continue
        if path == root or path.startswith(root + "/"):
            return True
    return False


def _scopes_contained(requested, allowed):
    for path in requested:
        if not _contained(path, allowed):
            return False
    return True


def admit(registry, grant, request, *, authenticated_caller, now, usage=None, phase="accept"):
    """Admit one request against a trusted registry snapshot and grant."""
    if not isinstance(registry, Registry):
        _malformed()
    if phase not in ("accept", "dispatch"):
        _malformed()
    caller = _text(authenticated_caller)
    _finite(now)
    turns, messages, tokens, cost = _usage(usage)
    normalized_request = _normalize_request(request, caller)
    normalized_grant = _normalize_grant(grant)

    if normalized_grant["issuer"] not in registry.trusted_issuers:
        raise AdmissionError("untrusted_issuer")
    if normalized_request["grant_id"] != normalized_grant["grant_id"]:
        raise AdmissionError("forged_grant")
    if normalized_request["job_id"] != normalized_grant["job_id"]:
        raise AdmissionError("identity_mismatch")
    if normalized_request["worker_id"] != normalized_grant["worker_id"]:
        raise AdmissionError("identity_mismatch")
    if normalized_request["route_id"] not in normalized_grant["route_ids"]:
        raise AdmissionError("route_mismatch")
    if normalized_request["step_id"] not in normalized_grant["allowed_steps"]:
        raise AdmissionError("expansion")
    if normalized_request["operation"] not in normalized_grant["operations"]:
        raise AdmissionError("expansion")
    recipients = normalized_request.get("recipients")
    if recipients is not None and any(item not in normalized_grant["allowed_callers"] for item in recipients):
        raise AdmissionError("expansion")

    job = _need(registry.get("jobs", normalized_grant["job_id"]))
    route = _need(registry.get("routes", normalized_request["route_id"]))
    if route["worker_id"] != normalized_grant["worker_id"]:
        raise AdmissionError("route_mismatch")
    worker = _need(registry.get("workers", route["worker_id"]))
    product = _need(registry.get("products", route["product_id"]))
    account = _need(registry.get("accounts", route["account_ref"]))
    entitlement = _need(registry.get("entitlements", route["entitlement_ref"]))
    profile = _need(registry.get("profiles", route["profile_id"]))
    if account["product_id"] != route["product_id"] or entitlement["account_ref"] != route["account_ref"]:
        raise AdmissionError("route_mismatch")

    grant_resources = {}
    for resource_id in normalized_grant["resource_scopes"]:
        grant_resources[resource_id] = _need(registry.get("resources", resource_id))
    for resource_id in normalized_request["resource_scopes"]:
        if resource_id not in normalized_grant["resource_scopes"]:
            raise AdmissionError("scope_escape")

    if worker["lifecycle"] != "active":
        raise AdmissionError("inactive_worker")
    if account["lifecycle"] != "active":
        raise AdmissionError("inactive_account")

    owners = {
        job["owner"],
        worker["owner"],
        route["owner"],
        account["owner"],
        entitlement["owner"],
        profile["owner"],
        product["owner"],
    }
    owners.update(resource["owner"] for resource in grant_resources.values())
    if len(owners) != 1:
        raise AdmissionError("owner_mismatch")

    if (
        normalized_request["route_revision"] != route["revision"]
        or normalized_request["worker_revision"] != worker["revision"]
        or normalized_request["account_revision"] != account["revision"]
        or normalized_request["entitlement_revision"] != entitlement["revision"]
        or normalized_request["profile_revision"] != profile["revision"]
        or normalized_request["input_revision"] != job["input_revision"]
        or normalized_request["ac_revision"] != job["ac_revision"]
        or normalized_grant["input_revision"] != job["input_revision"]
        or normalized_grant["ac_revision"] != job["ac_revision"]
    ):
        raise AdmissionError("stale_revision")
    if normalized_grant["revocation_epoch"] != job["revocation_epoch"]:
        raise AdmissionError("epoch_mismatch")

    evidence = route["evidence"]
    if (
        evidence.get("route_revision") != route["revision"]
        or evidence.get("worker_revision") != worker["revision"]
        or evidence.get("account_revision") != account["revision"]
        or evidence.get("entitlement_revision") != entitlement["revision"]
        or evidence.get("profile_revision") != profile["revision"]
    ):
        raise AdmissionError("stale_evidence")
    if not (
        route["harness_version"] == product["harness_version"] == evidence.get("harness_version")
    ):
        raise AdmissionError("harness_mismatch")
    if route["model"] != evidence.get("model"):
        raise AdmissionError("model_mismatch")
    if route["runtime_status"] != "verified":
        raise AdmissionError("runtime_unverified")
    if route["policy_review"] != "supported_for_scope":
        raise AdmissionError("policy_review")
    if entitlement["actual_entitlement"] != "verified":
        raise AdmissionError("unverified_entitlement")
    if normalized_grant["revoked"]:
        raise AdmissionError("revoked")
    if not now < normalized_grant["expires_at"]:
        raise AdmissionError("expired_grant")
    if not now < job["deadline"]:
        raise AdmissionError("expired_job")
    if not now < entitlement["expires_at"]:
        raise AdmissionError("expired_entitlement")

    origin = normalized_request["origin"]
    if origin == "replay":
        raise AdmissionError("replay")
    if origin == "operator" and caller != normalized_grant["issuer"]:
        raise AdmissionError("operator_caller")
    if origin == "agent":
        if entitlement["billing_class"] != "api":
            raise AdmissionError("personal_agent")
        if caller == normalized_grant["issuer"]:
            raise AdmissionError("forged_caller")
        if not normalized_grant["allow_agent_trigger"]:
            raise AdmissionError("agent_trigger")
        if caller not in normalized_grant["allowed_callers"]:
            raise AdmissionError("agent_caller")
    if normalized_request["hop"] > normalized_grant["max_hops"]:
        raise AdmissionError("budget_hop")
    if normalized_request["operation"] not in profile["capabilities"]:
        raise AdmissionError("capability")

    requested = normalized_request["resource_scopes"]
    if worker["role"] == "reviewer" and any(spec["write"] for spec in requested.values()):
        raise AdmissionError("reviewer_write")
    for resource_id, spec in requested.items():
        granted = normalized_grant["resource_scopes"][resource_id]
        resource = grant_resources[resource_id]
        pairs = (
            (spec["read"], granted["read"], profile["read_paths"], resource["read_paths"]),
            (spec["write"], granted["write"], profile["write_paths"], resource["write_paths"]),
        )
        for paths, grant_paths, profile_paths, resource_paths in pairs:
            if not (
                _scopes_contained(paths, grant_paths)
                and _scopes_contained(paths, profile_paths)
                and _scopes_contained(paths, resource_paths)
            ):
                raise AdmissionError("scope_escape")

    if turns >= normalized_grant["max_turns"]:
        raise AdmissionError("budget_turns")
    if (phase == "accept" and messages >= normalized_grant["max_messages"]) or (
        phase == "dispatch" and messages > normalized_grant["max_messages"]
    ):
        raise AdmissionError("budget_messages")
    remaining = entitlement["quota_remaining"]
    if remaining is not None and remaining <= 0:
        raise AdmissionError("quota_exhausted")

    return {
        "route": route,
        "account": account,
        "entitlement": entitlement,
        "profile": profile,
        "worker": worker,
        "job": job,
        "grant": normalized_grant,
        "request": normalized_request,
        "usage": {
            "turns": turns,
            "messages": messages,
            "provider_tokens": tokens,
            "provider_cost": cost,
            "quota_remaining": remaining,
        },
    }

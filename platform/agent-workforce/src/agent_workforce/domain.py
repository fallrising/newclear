"""Defensive registry snapshot and canonical path rules.

Records are copied in. Evidence mismatches are stored as given and rejected
later by admission; this module does not repair them and does not execute
strings.
"""

import copy
import math

_CATEGORIES = (
    "workers",
    "products",
    "accounts",
    "entitlements",
    "profiles",
    "resources",
    "routes",
    "jobs",
    "sessions",
)
_LIFECYCLES = {"draft", "configured", "verified", "active", "suspended", "retired"}
_ROLES = {"writer", "reviewer"}
_BILLING = {"personal", "api"}
_ENTITLEMENT_STATES = {"verified", "unknown"}


class RegistryError(ValueError):
    """Invalid registry data or path."""


def canonical_path(value):
    """Return value when it is already a canonical relative scope."""
    if not isinstance(value, str) or value == "":
        raise RegistryError("path")
    if "\\" in value or "\x00" in value or value != value.strip():
        raise RegistryError("path")
    if value.startswith("/") or value.startswith("~"):
        raise RegistryError("path")
    if value == ".":
        return "."
    parts = value.split("/")
    if any(part == "" or part in {".", "..", "~"} or part != part.strip() for part in parts):
        raise RegistryError("path")
    return value


def paths_overlap(left, right):
    """True when canonical paths are equal, nested, or covered by root ``.``."""
    left_path = canonical_path(left)
    right_path = canonical_path(right)
    if left_path == "." or right_path == ".":
        return True
    left_parts = left_path.split("/")
    right_parts = right_path.split("/")
    if len(left_parts) > len(right_parts):
        left_parts, right_parts = right_parts, left_parts
    return right_parts[: len(left_parts)] == left_parts


def _text(value, field):
    if not isinstance(value, str) or value == "":
        raise RegistryError(field)
    return value


def _positive_int(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 1:
        raise RegistryError(field)
    return value


def _nonnegative_int(value, field):
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise RegistryError(field)
    return value


def _finite(value, field):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise RegistryError(field)
    try:
        finite = math.isfinite(value)
    except OverflowError:
        finite = False
    if not finite:
        raise RegistryError(field)
    return value


def _positive_finite(value, field):
    number = _finite(value, field)
    if number <= 0:
        raise RegistryError(field)
    return number


def _plain(value, field, depth=0):
    if depth > 40:
        raise RegistryError(field)
    if value is None or isinstance(value, str):
        return value
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        if not math.isfinite(value):
            raise RegistryError(field)
        return value
    if isinstance(value, list):
        return [_plain(item, field, depth + 1) for item in value]
    if isinstance(value, dict):
        copied = {}
        for key, item in value.items():
            if not isinstance(key, str):
                raise RegistryError(field)
            copied[key] = _plain(item, field, depth + 1)
        return copied
    raise RegistryError(field)


def _path_list(value, field):
    if not isinstance(value, list):
        raise RegistryError(field)
    return [canonical_path(item) for item in value]


def _string_list(value, field):
    if not isinstance(value, list):
        raise RegistryError(field)
    copied = []
    for item in value:
        copied.append(_text(item, field))
    return copied


def _choice(value, allowed, field):
    if not isinstance(value, str) or value not in allowed:
        raise RegistryError(field)
    return value


def _quota(value, field):
    if value is None:
        return None
    return _finite(value, field)


def _evidence(value):
    plain = _plain(value, "evidence")
    if not isinstance(plain, dict):
        raise RegistryError("evidence")
    for field in (
        "route_revision",
        "worker_revision",
        "account_revision",
        "entitlement_revision",
        "profile_revision",
    ):
        _positive_int(plain.get(field), field)
    _text(plain.get("harness_version"), "harness_version")
    _text(plain.get("model"), "model")
    return plain


def _with_extras(source, normalized):
    plain = _plain(source, "record")
    for key, value in plain.items():
        if key not in normalized:
            normalized[key] = value
    return normalized


def _normalize_record(category, record):
    if category == "workers":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "role": _choice(record.get("role"), _ROLES, "role"),
            "lifecycle": _choice(record.get("lifecycle"), _LIFECYCLES, "lifecycle"),
        }
    elif category == "products":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "harness": _text(record.get("harness"), "harness"),
            "harness_version": _text(record.get("harness_version"), "harness_version"),
        }
    elif category == "accounts":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "product_id": _text(record.get("product_id"), "product_id"),
            "lifecycle": _choice(record.get("lifecycle"), _LIFECYCLES, "lifecycle"),
            "concurrency_limit": _positive_int(record.get("concurrency_limit"), "concurrency_limit"),
        }
    elif category == "entitlements":
        if "quota_remaining" not in record:
            raise RegistryError("quota_remaining")
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "account_ref": _text(record.get("account_ref"), "account_ref"),
            "quota_pool_ref": _text(record.get("quota_pool_ref"), "quota_pool_ref"),
            "billing_class": _choice(record.get("billing_class"), _BILLING, "billing_class"),
            "actual_entitlement": _choice(
                record.get("actual_entitlement"), _ENTITLEMENT_STATES, "actual_entitlement"
            ),
            "expires_at": _finite(record.get("expires_at"), "expires_at"),
            "concurrency_limit": _positive_int(record.get("concurrency_limit"), "concurrency_limit"),
            "quota_remaining": _quota(record.get("quota_remaining"), "quota_remaining"),
        }
    elif category == "profiles":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "read_paths": _path_list(record.get("read_paths"), "read_paths"),
            "write_paths": _path_list(record.get("write_paths"), "write_paths"),
            "timeout_seconds": _positive_finite(record.get("timeout_seconds"), "timeout_seconds"),
            "capabilities": _string_list(record.get("capabilities"), "capabilities"),
        }
    elif category == "resources":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "kind": _text(record.get("kind"), "kind"),
            "read_paths": _path_list(record.get("read_paths"), "read_paths"),
            "write_paths": _path_list(record.get("write_paths"), "write_paths"),
        }
        if "binding_key" in record:
            normalized["binding_key"] = _text(record["binding_key"], "binding_key")
    elif category == "routes":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "worker_id": _text(record.get("worker_id"), "worker_id"),
            "product_id": _text(record.get("product_id"), "product_id"),
            "account_ref": _text(record.get("account_ref"), "account_ref"),
            "entitlement_ref": _text(record.get("entitlement_ref"), "entitlement_ref"),
            "profile_id": _text(record.get("profile_id"), "profile_id"),
            "model": _text(record.get("model"), "model"),
            "harness_version": _text(record.get("harness_version"), "harness_version"),
            "runtime_status": _text(record.get("runtime_status"), "runtime_status"),
            "policy_review": _text(record.get("policy_review"), "policy_review"),
            "evidence": _evidence(record.get("evidence")),
        }
    elif category == "jobs":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
            "input_revision": _positive_int(record.get("input_revision"), "input_revision"),
            "ac_revision": _positive_int(record.get("ac_revision"), "ac_revision"),
            "revocation_epoch": _nonnegative_int(record.get("revocation_epoch"), "revocation_epoch"),
            "deadline": _finite(record.get("deadline"), "deadline"),
            "max_concurrency": _positive_int(record.get("max_concurrency"), "max_concurrency"),
        }
        if "step_hops" in record:
            hops = record["step_hops"]
            if not isinstance(hops, dict):
                raise RegistryError("step_hops")
            normalized["step_hops"] = {
                _text(step, "step_hops"): _nonnegative_int(hop, "step_hops")
                for step, hop in hops.items()
            }
    elif category == "sessions":
        normalized = {
            "owner": _text(record.get("owner"), "owner"),
            "revision": _positive_int(record.get("revision"), "revision"),
        }
        for field in ("worker_id", "job_id", "route_id", "account_ref", "workspace_ref", "binding_key"):
            normalized[field] = _text(record.get(field), field)
    else:
        raise RegistryError(category)
    return _with_extras(record, normalized)


def _check_consistency(stored):
    products = stored["products"]
    accounts = stored["accounts"]
    for account in accounts.values():
        product = products.get(account["product_id"])
        if product is None or product["owner"] != account["owner"]:
            raise RegistryError("account_product")
    for entitlement in stored["entitlements"].values():
        account = accounts.get(entitlement["account_ref"])
        if account is None or account["owner"] != entitlement["owner"]:
            raise RegistryError("entitlement_account")
    for route in stored["routes"].values():
        worker = stored["workers"].get(route["worker_id"])
        product = products.get(route["product_id"])
        account = accounts.get(route["account_ref"])
        entitlement = stored["entitlements"].get(route["entitlement_ref"])
        profile = stored["profiles"].get(route["profile_id"])
        if None in (worker, product, account, entitlement, profile):
            raise RegistryError("route_reference")
        owners = {
            route["owner"],
            worker["owner"],
            product["owner"],
            account["owner"],
            entitlement["owner"],
            profile["owner"],
        }
        if len(owners) != 1:
            raise RegistryError("owner")
        if account["product_id"] != route["product_id"]:
            raise RegistryError("route_product")
        if entitlement["account_ref"] != route["account_ref"]:
            raise RegistryError("route_account")
    for session in stored["sessions"].values():
        references = [
            stored["workers"].get(session["worker_id"]),
            stored["jobs"].get(session["job_id"]),
            stored["routes"].get(session["route_id"]),
            accounts.get(session["account_ref"]),
            stored["resources"].get(session["workspace_ref"]),
        ]
        if any(row is None for row in references):
            raise RegistryError("session_reference")
        if any(row["owner"] != session["owner"] for row in references):
            raise RegistryError("session_owner")
        workspace = references[4]
        if workspace["kind"] != "workspace":
            raise RegistryError("session_workspace")
        _text(workspace.get("binding_key"), "binding_key")
        route = references[2]
        if route["worker_id"] != session["worker_id"] or route["account_ref"] != session["account_ref"]:
            raise RegistryError("session_route")


class Registry:
    """Immutable defensive snapshot of workforce records and trusted issuers."""

    def __init__(self, records, trusted_issuers=()):
        if not isinstance(records, dict):
            raise RegistryError("records")
        if set(records) - set(_CATEGORIES):
            raise RegistryError("category")
        if isinstance(trusted_issuers, (str, bytes)) or not isinstance(trusted_issuers, (list, tuple)):
            raise RegistryError("trusted_issuers")
        self._trusted_issuers = tuple(_text(issuer, "trusted_issuers") for issuer in trusted_issuers)
        stored = {category: {} for category in _CATEGORIES}
        for category in _CATEGORIES:
            items = records.get(category, {})
            if not isinstance(items, dict):
                raise RegistryError(category)
            for key, record in items.items():
                _text(key, category)
                if not isinstance(record, dict):
                    raise RegistryError(category)
                stored[category][key] = _normalize_record(category, record)
        _check_consistency(stored)
        self._records = stored

    @property
    def trusted_issuers(self):
        return self._trusted_issuers

    def get(self, kind, identifier):
        if kind not in _CATEGORIES:
            raise RegistryError(kind)
        record = self._records[kind].get(identifier)
        if record is None:
            return None
        return copy.deepcopy(record)

    def snapshot(self):
        return copy.deepcopy(self._records)

"""Validate a private owner receipt after manual provider-console reimage."""
import base64
from datetime import datetime, timedelta, timezone
import hashlib
import json
import os
from pathlib import Path
import uuid

from labops import digest


REQUIRED_FIELDS = {
    "schema_version", "provider_api_used", "plan_id", "plan_sha256",
    "provider_resource_ref", "os_image_ref", "target", "erase_scope",
    "replacement", "provider_console_action_ref", "console_completed_at",
    "owner_confirmed", "owner_reviewed_at", "host_key_verified_via",
    "host_key_fingerprints",
}
HOST_KEY_TYPES = {"ssh-ed25519", "ecdsa-sha2-nistp256", "ssh-rsa"}
EXPECTED_REVIEW_BLOCKERS = {
    "Owner console reimage, receipt and replacement-host verification are separate manual stages",
    "Safe resume, generation commit and recovery executor are not implemented",
}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("reimage receipt contains a duplicate field")
        result[key] = value
    return result


def _timestamp(value, label):
    if not isinstance(value, str):
        raise ValueError(label + " must be a timezone-aware ISO-8601 timestamp")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(label + " must be a valid ISO-8601 timestamp") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(label + " must include a timezone")
    return parsed.astimezone(timezone.utc)


def _text(value, label, limit=160):
    if (not isinstance(value, str) or not value or value != value.strip()
            or len(value) > limit or any(ord(char) < 32 for char in value)):
        raise ValueError(label + " must be an exact non-empty string")
    return value


def _boot_id(value, label):
    value = _text(value, label, 64)
    try:
        parsed = uuid.UUID(value)
    except ValueError as exc:
        raise ValueError(label + " must be a UUID") from exc
    if str(parsed) != value.lower():
        raise ValueError(label + " must be a canonical UUID")
    return str(parsed)


def _fingerprints(value):
    if not isinstance(value, dict) or not value or not set(value) <= HOST_KEY_TYPES:
        raise ValueError("host key fingerprints must use supported SSH key algorithms")
    normalized = {}
    for key_type, fingerprint in value.items():
        fingerprint = _text(fingerprint, key_type + " fingerprint", 64)
        if not fingerprint.startswith("SHA256:"):
            raise ValueError(key_type + " fingerprint must use SHA256 format")
        encoded = fingerprint.removeprefix("SHA256:")
        try:
            decoded = base64.b64decode(encoded + "=" * ((4 - len(encoded) % 4) % 4), validate=True)
        except ValueError as exc:
            raise ValueError(key_type + " fingerprint is not valid base64") from exc
        if len(decoded) != 32 or base64.b64encode(decoded).decode().rstrip("=") != encoded:
            raise ValueError(key_type + " fingerprint must encode a SHA-256 digest")
        normalized[key_type] = "SHA256:" + encoded
    if "ssh-ed25519" not in normalized:
        raise ValueError("owner must verify the replacement Ed25519 host key out of band")
    return normalized


def verify_local_hostkeys(alias, fingerprints, known_hosts_dir):
    """Require the owner's OOB fingerprint to match the already trusted alias key."""
    if alias not in {"ckc-disposable-02", "ckc-disposable-03", "ckc-disposable-04"}:
        raise ValueError("replacement host key is not bound to a reviewed worker SSH alias")
    expected = _fingerprints(fingerprints)
    directory = Path(known_hosts_dir)
    path = directory / alias.removeprefix("ckc-")
    if (directory.is_symlink() or not directory.is_dir()
            or path.is_symlink() or not path.is_file()):
        raise ValueError("dedicated trusted host-key file is missing or unsafe")
    raw = path.read_bytes()
    if not raw or len(raw) > 65536:
        raise ValueError("dedicated trusted host-key file is empty or exceeds 64 KiB")
    actual = {}
    for line in raw.decode("utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        fields = line.split()
        if len(fields) != 3 or fields[1] not in HOST_KEY_TYPES:
            raise ValueError("dedicated trusted host-key file has an unsupported entry")
        key_type, encoded = fields[1], fields[2]
        if key_type in actual:
            raise ValueError("dedicated trusted host-key file has duplicate key algorithms")
        try:
            key_blob = base64.b64decode(encoded, validate=True)
        except ValueError as exc:
            raise ValueError("dedicated trusted host-key file has invalid public-key data") from exc
        actual[key_type] = "SHA256:" + base64.b64encode(hashlib.sha256(key_blob).digest()).decode().rstrip("=")
    if actual != expected:
        raise ValueError("dedicated trusted host-key fingerprints differ from the owner receipt")
    return {"alias": alias, "host_key_fingerprints": actual, "path": path.name,
            "file_sha256": hashlib.sha256(raw).hexdigest()}


def load_receipt(project, receipt_file, *, plan, plan_sha256, now=None):
    """Validate an owner attestation against a stored, review-only provider plan."""
    project = Path(project).resolve()
    supplied = Path(receipt_file)
    candidate = project / supplied if not supplied.is_absolute() else supplied
    candidate = Path(os.path.abspath(candidate))
    try:
        logical_path = candidate.relative_to(project)
    except ValueError as exc:
        raise ValueError("reimage receipt must be under private/reimage-receipts/") from exc
    if (len(logical_path.parts) != 3
            or logical_path.parts[:2] != ("private", "reimage-receipts")
            or logical_path.suffix != ".json"):
        raise ValueError("reimage receipt must be under private/reimage-receipts/")
    path = candidate.resolve()
    receipt_root = project / "private/reimage-receipts"
    if (receipt_root.is_symlink() or not receipt_root.is_dir()
            or candidate.is_symlink() or not path.is_relative_to(receipt_root.resolve())
            or not path.is_file()):
        raise ValueError("reimage receipt must be a regular JSON file under private/reimage-receipts/")
    raw = path.read_bytes()
    if len(raw) > 65536:
        raise ValueError("reimage receipt exceeds 64 KiB")
    data = json.loads(raw, object_pairs_hook=_unique_object)
    if not isinstance(data, dict) or set(data) != REQUIRED_FIELDS:
        raise ValueError("reimage receipt must contain exactly the reviewed schema fields")
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise ValueError("unsupported reimage receipt schema")
    if data["provider_api_used"] is not False:
        raise ValueError("provider API must not be used for manual reimage receipt")
    if data["owner_confirmed"] is not True:
        raise ValueError("owner confirmation is required")

    if (plan.get("operation") != "rebuild-node" or plan.get("rebuild_mode") != "provider-reimage"
            or plan.get("executable") is not False):
        raise ValueError("receipt requires a review-only provider-reimage plan")
    if digest(plan) != plan_sha256:
        raise ValueError("provider reimage plan hash mismatch")
    intent = plan.get("provider_reimage_intent")
    binding = plan.get("bindings", {}).get("provider_reimage_intent")
    if not isinstance(intent, dict) or not isinstance(binding, dict):
        raise ValueError("provider reimage plan lacks a bound owner-reviewed intent")
    if binding.get("sha256") is None or not binding.get("path"):
        raise ValueError("provider reimage intent binding is incomplete")
    blockers = plan.get("blockers")
    if (not isinstance(blockers, list) or any(not isinstance(item, str) for item in blockers)
            or len(blockers) != len(EXPECTED_REVIEW_BLOCKERS)
            or set(blockers) != EXPECTED_REVIEW_BLOCKERS):
        raise ValueError("provider reimage plan has unresolved preflight blockers")
    targets = plan.get("targets")
    if not isinstance(targets, list) or targets:
        raise ValueError("ERU workloads must be migrated before recording reimage completion")

    target = intent.get("target")
    if not isinstance(target, dict) or set(target) != {"alias", "node", "machine_id"}:
        raise ValueError("bound plan target identity is incomplete")
    alias, node, old_machine_id = target["alias"], target["node"], target["machine_id"]
    inventory = plan.get("bindings", {}).get("inventory", [])
    if not isinstance(inventory, list):
        raise ValueError("receipt target differs from the bound worker inventory")
    matching_hosts = [host for host in inventory if isinstance(host, dict) and host.get("node") == node]
    if (plan.get("node") != node or len(matching_hosts) != 1
            or matching_hosts[0].get("alias") != alias or matching_hosts[0].get("role") != "worker"):
        raise ValueError("receipt target differs from the bound worker inventory")
    old_host = plan.get("snapshot", {}).get("hosts", {}).get(alias)
    if not isinstance(old_host, dict) or old_host.get("machine_id") != old_machine_id:
        raise ValueError("plan snapshot does not match the bound old machine identity")
    old_boot_id = _boot_id(old_host.get("boot_id"), "old boot ID")

    if data["plan_id"] != plan.get("id") or data["plan_sha256"] != plan_sha256:
        raise ValueError("receipt is not bound to this exact provider reimage plan")
    provider_ref = _text(data["provider_resource_ref"], "provider resource reference")
    image_ref = _text(data["os_image_ref"], "OS image reference")
    if (provider_ref != intent.get("provider_resource_ref")
            or image_ref != intent.get("os_image_ref")
            or data["erase_scope"] != intent.get("erase_scope")):
        raise ValueError("receipt provider resource, OS image or erase scope differs from the reviewed intent")
    if data["target"] != target:
        raise ValueError("receipt old target identity differs from the reviewed plan")

    replacement = data["replacement"]
    if not isinstance(replacement, dict) or set(replacement) != {"machine_id", "boot_id", "os_release"}:
        raise ValueError("replacement identity, boot ID and OS release are required")
    new_machine_id = _text(replacement["machine_id"], "replacement machine ID", 128)
    if new_machine_id == old_machine_id:
        raise ValueError("replacement machine ID must differ from the old host")
    new_boot_id = _boot_id(replacement["boot_id"], "replacement boot ID")
    if new_boot_id == old_boot_id:
        raise ValueError("replacement boot ID must differ from the old host")
    os_release = _text(replacement["os_release"], "replacement OS release", 256)
    action_ref = _text(data["provider_console_action_ref"], "provider console action reference")
    if data["host_key_verified_via"] != "provider-console":
        raise ValueError("replacement host keys must be verified out of band via provider console")
    fingerprints = _fingerprints(data["host_key_fingerprints"])

    completed = _timestamp(data["console_completed_at"], "console completion time")
    reviewed = _timestamp(data["owner_reviewed_at"], "owner review time")
    created = _timestamp(plan.get("created_at"), "plan creation time")
    current = now or datetime.now(timezone.utc)
    if current.tzinfo is None or current.utcoffset() is None:
        raise ValueError("current time must be timezone-aware")
    current = current.astimezone(timezone.utc)
    if not created <= completed <= reviewed <= current:
        raise ValueError("console completion and owner review times are out of order")
    if completed - created > timedelta(hours=24):
        raise ValueError("provider reimage must use a fresh plan completed within 24 hours")
    if current - reviewed > timedelta(days=7):
        raise ValueError("owner reimage receipt must be reviewed within the last 7 days")

    normalized = {
        "schema_version": 1,
        "provider_api_used": False,
        "plan_id": plan["id"],
        "plan_sha256": plan_sha256,
        "provider_resource_ref": provider_ref,
        "os_image_ref": image_ref,
        "target": {"alias": alias, "node": node, "machine_id": old_machine_id},
        "erase_scope": intent["erase_scope"],
        "replacement": {"machine_id": new_machine_id, "boot_id": new_boot_id,
                        "os_release": os_release},
        "provider_console_action_ref": action_ref,
        "console_completed_at": completed.isoformat(),
        "owner_confirmed": True,
        "owner_reviewed_at": reviewed.isoformat(),
        "host_key_verified_via": "provider-console",
        "host_key_fingerprints": fingerprints,
    }
    return {
        "receipt": normalized,
        "path": logical_path.as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }

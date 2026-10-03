"""Validate owner-reviewed, provider-console-only ERU worker reimage intent."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path


REQUIRED_FIELDS = {
    "schema_version", "provider_api_used", "provider_resource_ref", "os_image_ref",
    "target", "erase_scope", "reviewed_at",
}


def _unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("reimage intent contains a duplicate field")
        result[key] = value
    return result


def _reference(value, label):
    if (not isinstance(value, str) or not value.strip() or len(value) > 160
            or any(ord(char) < 32 for char in value)
            or value.strip() == "*" or value.strip().casefold() == "all"):
        raise ValueError(label + " must be an exact, non-empty reference")
    return value.strip()


def load_intent(project, intent_file, *, node, alias, machine_id, now=None):
    """Load an exact private intent file and bind it to the current worker incarnation."""
    project = Path(project).resolve()
    supplied = Path(intent_file)
    candidate = project / supplied if not supplied.is_absolute() else supplied
    candidate = Path(os.path.abspath(candidate))
    try:
        logical_path = candidate.relative_to(project)
    except ValueError as exc:
        raise ValueError("reimage intent must be under private/reimage-intents/") from exc
    if (logical_path.parts[:2] != ("private", "reimage-intents")
            or logical_path.suffix != ".json"):
        raise ValueError("reimage intent must be under private/reimage-intents/")
    path = candidate.resolve()
    intents = (project / "private/reimage-intents").resolve()
    if (candidate.is_symlink() or not path.is_relative_to(intents) or not path.is_file()):
        raise ValueError("reimage intent must be a regular JSON file under private/reimage-intents/")
    raw = path.read_bytes()
    data = json.loads(raw, object_pairs_hook=_unique_object)
    if not isinstance(data, dict) or set(data) != REQUIRED_FIELDS:
        raise ValueError("reimage intent must contain exactly the reviewed schema fields")
    if type(data["schema_version"]) is not int or data["schema_version"] != 1:
        raise ValueError("unsupported reimage intent schema")
    if data["provider_api_used"] is not False:
        raise ValueError("provider API must not be used for this manual reimage path")
    provider_ref = _reference(data["provider_resource_ref"], "provider resource reference")
    image_ref = _reference(data["os_image_ref"], "OS image reference")

    target = data["target"]
    if not isinstance(target, dict) or set(target) != {"alias", "node", "machine_id"}:
        raise ValueError("reimage target identity is incomplete")
    if target != {"alias": alias, "node": node, "machine_id": machine_id}:
        raise ValueError("reimage intent target does not match the current host identity")

    erase = data["erase_scope"]
    if not isinstance(erase, dict) or set(erase) != {"boot_volume_ref", "additional_volume_refs"}:
        raise ValueError("reimage intent must enumerate the exact boot and attached volume scope")
    boot_volume = _reference(erase["boot_volume_ref"], "boot volume reference")
    additional = erase["additional_volume_refs"]
    if (not isinstance(additional, list)
            or any(not isinstance(item, str) for item in additional)):
        raise ValueError("additional volume references must be a list of exact IDs")
    additional = [_reference(item, "additional volume reference") for item in additional]
    if boot_volume in additional or len(set(additional)) != len(additional):
        raise ValueError("reimage volume references must be unique")

    reviewed_at = data["reviewed_at"]
    if not isinstance(reviewed_at, str):
        raise ValueError("review timestamp must include a timezone")
    try:
        reviewed = datetime.fromisoformat(reviewed_at.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("review timestamp must be a valid ISO-8601 timestamp") from exc
    if reviewed.tzinfo is None or reviewed.utcoffset() is None:
        raise ValueError("review timestamp must include a timezone")
    current = now or datetime.now(timezone.utc)
    age = (current - reviewed.astimezone(timezone.utc)).total_seconds()
    if not 0 <= age <= 30 * 24 * 60 * 60:
        raise ValueError("reimage intent must be reviewed within the last 30 days")

    normalized = {
        "schema_version": 1,
        "provider_api_used": False,
        "provider_resource_ref": provider_ref,
        "os_image_ref": image_ref,
        "target": {"alias": alias, "node": node, "machine_id": machine_id},
        "erase_scope": {
            "boot_volume_ref": boot_volume,
            "additional_volume_refs": additional,
        },
        "reviewed_at": reviewed.astimezone(timezone.utc).isoformat(),
    }
    return {
        "intent": normalized,
        "path": logical_path.as_posix(),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }

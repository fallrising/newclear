"""Explicit private inventory identity; no deployment-specific alias defaults."""
import ipaddress
import json
from pathlib import Path
import re

LOGICAL_TOPOLOGY = tuple(("worker-" + str(i), "core" if i == 1 else "worker")
                         for i in range(1, 5))
WORKER_NODES = tuple(node for node, role in LOGICAL_TOPOLOGY if role == "worker")
_ALIAS = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


def valid_alias(value):
    return isinstance(value, str) and _ALIAS.fullmatch(value) is not None


def evidence_name(alias):
    """Preserve the existing optional SSH prefix convention in local filenames."""
    if not valid_alias(alias):
        raise ValueError('invalid inventory alias')
    return alias.removeprefix('ckc-') or alias


def topology(rows):
    if not isinstance(rows, (list, tuple)) or len(rows) != 4:
        raise ValueError("inventory must contain exactly four reviewed hosts")
    result = []
    seen = set()
    for row, (node, role) in zip(rows, LOGICAL_TOPOLOGY):
        if (not isinstance(row, dict) or row.get("node") != node or row.get("role") != role
                or not valid_alias(row.get("alias")) or row["alias"] in seen):
            raise ValueError("inventory alias, logical node or role differs from reviewed topology")
        seen.add(row["alias"])
        result.append((row["alias"], node, role))
    if len({evidence_name(alias) for alias, _node, _role in result}) != 4:
        raise ValueError('inventory aliases collide in evidence filenames')
    return tuple(result)


def aliases(rows):
    return tuple(alias for alias, _node, _role in topology(rows))


def workers(rows):
    return {node: alias for alias, node, role in topology(rows) if role == "worker"}


def key_aliases(keys):
    if (not isinstance(keys, dict) or len(keys) != 4
            or any(not valid_alias(alias) for alias in keys)):
        raise ValueError("four explicit reviewed host aliases required")
    return tuple(keys)


def validate_inventory(rows):
    topology(rows)
    result = []
    for row in rows:
        value = row.get("ip")
        try:
            if not isinstance(value, str) or str(ipaddress.IPv4Address(value)) != value:
                raise ValueError()
        except (ValueError, ipaddress.AddressValueError):
            raise ValueError("inventory requires canonical IPv4 endpoints") from None
        result.append({key: row[key] for key in ("alias", "node", "role", "ip")})
    if len({row["ip"] for row in result}) != 4:
        raise ValueError("inventory endpoints must be distinct")
    return result


def _unique(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("private inventory contains duplicate fields")
        result[key] = value
    return result


def load_inventory(project):
    return load_inventory_file(Path(project) / "private/deployment-plan.json")


def load_inventory_file(path):
    path = Path(path)
    if any(part.is_symlink() for part in (path.absolute(), *path.absolute().parents)) or not path.is_file() or path.stat().st_size > 16 * 1024 * 1024:
        raise ValueError("private inventory is missing or unsafe")
    try:
        rows = json.loads(path.read_text(), object_pairs_hook=_unique)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise ValueError("private inventory is unreadable or invalid") from exc
    return validate_inventory(rows)

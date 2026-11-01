"""Literal history filters and bounded, query-scoped keyset cursor transport."""

import base64
import binascii
import hashlib
import json
from datetime import datetime
from typing import Literal
from uuid import UUID

from .domain import Problem

TaskState = Literal[
    "queued",
    "provisioning",
    "running",
    "awaiting_approval",
    "pausing",
    "paused",
    "resuming",
    "finalizing",
    "cancelling",
    "interrupted",
    "succeeded",
    "failed",
    "cancelled",
]


def scope_key(q, project_id, state):
    normalized = {
        "q": q.strip(),
        "project_id": str(project_id) if project_id else None,
        "state": state,
    }
    if not any(normalized.values()):
        return None
    return hashlib.sha256(json.dumps(normalized, sort_keys=True).encode()).hexdigest()


def literal_pattern(q):
    return "%" + q.replace("!", "!!").replace("%", "!%").replace("_", "!_") + "%"


def decode_cursor(cursor, scope):
    try:
        if not isinstance(cursor, str) or not 1 <= len(cursor) <= 512:
            raise ValueError()
        value = json.loads(
            base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        )
        if scope is not None:
            if (
                not isinstance(value, dict)
                or set(value) != {"v", "scope", "after"}
                or type(value["v"]) is not int
                or value["v"] != 1
                or value["scope"] != scope
            ):
                raise ValueError()
            value = value["after"]
        if (
            not isinstance(value, list)
            or len(value) != 2
            or any(not isinstance(item, str) for item in value)
        ):
            raise ValueError()
        stamp, identifier = datetime.fromisoformat(value[0]), UUID(value[1])
        if stamp.tzinfo is None or stamp.utcoffset() is None:
            raise ValueError()
        return stamp, identifier
    except (ValueError, TypeError, UnicodeDecodeError, binascii.Error, OverflowError):
        raise Problem(422, "invalid_cursor") from None


def encode_cursor(row, scope):
    after = [row["created_at"].isoformat(), str(row["id"])]
    value = {"v": 1, "scope": scope, "after": after} if scope is not None else after
    return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip("=")

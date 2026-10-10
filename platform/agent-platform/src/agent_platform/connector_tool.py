"""Fixture-only host-pulled tool transport with durable, once-only effects."""

import hashlib
import json
import re
import socket
from contextlib import contextmanager
from typing import Literal
from uuid import UUID

from pydantic import ConfigDict, Field, model_validator

from agent_platform_m0.transport import HTTP

from .connector_output import OutputPolicy
from .domain import Input, Problem

MAX_RESULT = 1024 * 1024
IDENTITY = {"instance_id", "run_id", "binding_id", "generation"}


class ToolExchange(Input):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=False)
    generation: int = Field(ge=1, strict=True)
    binding_id: UUID
    action: Literal["bind", "poll", "deliver", "ack", "close"]
    operation_id: UUID | None = None
    result: dict | None = None
    receipt: str | None = Field(default=None, pattern=r"^[A-Za-z0-9_-]{43}$", repr=False)

    @model_validator(mode="after")
    def shape(self):
        required = {"generation", "binding_id", "action"}
        if self.action in {"deliver", "ack"}:
            required.add("operation_id")
        if self.action == "deliver":
            required.update({"result", "receipt"})
        if self.model_fields_set != required or any(getattr(self, k) is None for k in required):
            raise ValueError("tool_exchange_invalid")
        return self


def validate_wire(raw):
    def pairs(items):
        value = {}
        for key, item in items:
            if key in value:
                raise ValueError("duplicate_key")
            value[key] = item
        return value

    def invalid(_):
        raise ValueError("nonfinite_number")

    json.loads(raw, object_pairs_hook=pairs, parse_constant=invalid)


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def digest(value):
    return hashlib.sha256(encoded(value)).hexdigest()


@contextmanager
def relay(service, row):
    listener = service.handle(row).proxy_port("127.0.0.1:0", 18081)
    try:
        yield HTTP(
            f"http://127.0.0.1:{listener.getsockname()[1]}", row["tool_relay_key"], timeout=2
        )
    finally:
        try:
            listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        listener.close()


def validate_poll(value, identity):
    if (
        not isinstance(value, dict)
        or set(value) != {"instance_id", "pending", "ack"}
        or value["instance_id"] != identity["instance_id"]
        or (value["pending"] is not None and value["ack"] is not None)
    ):
        raise Problem(409, "tool_mailbox_identity_mismatch")
    for field, extra in (("pending", {"payload"}), ("ack", {"receipt"})):
        item = value[field]
        if item is None:
            continue
        if (
            not isinstance(item, dict)
            or set(item) != IDENTITY | {"operation_id"} | extra
            or any(item[k] != v for k, v in identity.items())
            or type(item["generation"]) is not int
        ):
            raise Problem(409, "tool_mailbox_identity_mismatch")
        UUID(item["operation_id"])
        if field == "pending":
            if not isinstance(item["payload"], dict) or len(encoded(item["payload"])) > 32768:
                raise Problem(409, "tool_request_invalid")
        elif not isinstance(item["receipt"], str) or not re.fullmatch(
            r"[A-Za-z0-9_-]{43}", item["receipt"]
        ):
            raise Problem(409, "tool_receipt_invalid")


def exchange(service, run_id, data):
    with service.journal.locked(run_id):
        row = service.require(run_id, data.generation)
        if not row["input"].get("tool_transport"):
            raise Problem(409, "tool_transport_not_configured")
        service.guard(row, stopping=data.action == "close")
        service.isolation(row)
        if row["operations"].get("release"):
            raise Problem(409, "sandbox_release_started")
        channel = row.get("tool_channel")
        if data.action == "bind":
            if channel is not None:
                raise Problem(409, "tool_channel_unavailable")
        elif (
            not channel
            or channel["epoch"] != service.tool_epoch
            or channel["state"] != "bound"
            or channel["identity"]["binding_id"] != str(data.binding_id)
            or channel["identity"]["generation"] != data.generation
        ):
            raise Problem(409, "tool_channel_unavailable")
        try:
            with relay(service, row) as http:
                return _exchange(service, row, data, channel, http)
        except Exception as exc:
            if row.get("tool_channel"):
                row["tool_channel"]["state"] = "closed"
                service.journal.write(row)
            if isinstance(exc, Problem):
                raise
            raise Problem(409, "tool_exchange_uncertain") from None


def _exchange(service, row, data, channel, http):
    if data.action == "bind":
        value = http.expect("GET", "/mailbox")
        if not isinstance(value, dict) or set(value) != {"instance_id", "pending", "ack"}:
            raise Problem(409, "tool_mailbox_identity_mismatch")
        instance = str(UUID(value["instance_id"]))
        if value["pending"] is not None or value["ack"] is not None:
            raise Problem(409, "tool_channel_unavailable")
        identity = {
            "instance_id": instance,
            "run_id": row["run_id"],
            "binding_id": str(data.binding_id),
            "generation": data.generation,
        }
        row["tool_channel"] = {
            "identity": identity,
            "epoch": service.tool_epoch,
            "state": "binding",
            "current": None,
        }
        service.journal.write(row)  # Crash after bind cannot silently resume this channel.
        if http.expect("POST", "/bind", identity) != identity:
            raise Problem(409, "tool_binding_unconfirmed")
        row["tool_channel"]["state"] = "bound"
        service.journal.write(row)
        return identity
    identity = channel["identity"]
    policy = OutputPolicy(service, row)
    if data.action == "poll":
        value = http.expect("GET", "/mailbox")
        validate_poll(value, identity)
        item = value["pending"] or value["ack"]
        if item:
            current = channel["current"]
            if value["pending"]:
                policy.require_safe(item["payload"], "tool_sensitive_request")
                hashed = digest(item["payload"])
                if current and (
                    current["operation_id"] != item["operation_id"]
                    or current["payload_hash"] != hashed
                ):
                    raise Problem(409, "tool_operation_conflict")
                if current is None:
                    channel["current"] = {
                        "operation_id": item["operation_id"],
                        "payload_hash": hashed,
                        "state": "pending",
                    }
                    service.journal.write(row)
            elif (
                not current
                or current["state"] != "delivered"
                or current["operation_id"] != item["operation_id"]
                or current["receipt_hash"] != digest(item["receipt"])
            ):
                raise Problem(409, "tool_ack_unconfirmed")
        elif channel["current"] is not None:
            raise Problem(409, "tool_delivery_uncertain")
        return value
    if data.action == "close":
        channel["state"] = "closed"
        service.journal.write(row)
        if http.expect("POST", "/close", identity) != {"closed": True}:
            raise Problem(409, "tool_close_unconfirmed")
        return {"closed": True}
    current = channel["current"]
    if not current or current["operation_id"] != str(data.operation_id):
        raise Problem(409, "tool_operation_conflict")
    payload = {**identity, "operation_id": str(data.operation_id)}
    if data.action == "deliver":
        if current["state"] != "pending":
            raise Problem(409, "tool_delivery_uncertain")
        policy.require_safe(data.result, "tool_sensitive_response")
        if len(encoded(data.result)) > MAX_RESULT:
            raise Problem(422, "tool_response_too_large")
        payload.update(result=data.result, receipt=data.receipt)
        path = "/response"
        current.update(state="delivering", receipt_hash=digest(data.receipt))
    else:
        if current["state"] != "delivered":
            raise Problem(409, "tool_ack_unconfirmed")
        path = "/ack"
        current["state"] = "acking"
    service.journal.write(row)  # Metadata only, persisted before every uncertain effect.
    service.guard(row)
    if http.expect("POST", path, payload) != {"accepted": True}:
        raise Problem(409, "tool_delivery_uncertain")
    if data.action == "ack":
        channel["current"] = None
    else:
        current["state"] = "delivered"
    service.journal.write(row)
    return {"accepted": True}

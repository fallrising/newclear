"""Pure strict closure-proof validation. No I/O.

A passing result is a detached copy of one subreaper-v1 closure object.
It does not certify journal origin or effect resolution. The caller supplies
the private durable proof already bound to the immutable request and ready
identity.
"""

_PROTOCOL = "subreaper-v1"
_REASONS = frozenset(("exited", "timeout", "cancelled"))
_FIELDS = frozenset((
    "protocol",
    "operation_id",
    "request_digest",
    "nonce",
    "helper_identity",
    "admitted",
    "fork_gate_closed",
    "wait_echild",
    "leader_exit_code",
    "reason",
    "effects_resolved",
))
_IDENTITY_FIELDS = frozenset(("pid", "start_ticks", "boot_id"))
_HEX = frozenset("0123456789abcdef")


class StopProofError(ValueError):
    """A closure proof is malformed or does not match the trusted request."""


def validate_closure(proof, *, operation_id, request_digest, nonce, helper_identity):
    """Return a detached closure bound to the trusted helper request."""
    if type(proof) is not dict or any(type(key) is not str for key in proof):
        raise StopProofError("closure proof must be an object")
    if set(proof) != _FIELDS:
        raise StopProofError("closure proof fieldset")

    got_operation = _operation_id(proof["operation_id"])
    want_operation = _operation_id(operation_id)
    if got_operation != want_operation:
        raise StopProofError("operation_id mismatch")

    got_digest = _hex_text(proof["request_digest"], 64, "request_digest")
    want_digest = _hex_text(request_digest, 64, "request_digest")
    if got_digest != want_digest:
        raise StopProofError("request_digest mismatch")

    got_nonce = _hex_text(proof["nonce"], 32, "nonce")
    want_nonce = _hex_text(nonce, 32, "nonce")
    if got_nonce != want_nonce:
        raise StopProofError("nonce mismatch")

    got_identity = _helper_identity(proof["helper_identity"])
    want_identity = _helper_identity(helper_identity)
    if got_identity != want_identity:
        raise StopProofError("helper_identity mismatch")

    if type(proof["protocol"]) is not str or proof["protocol"] != _PROTOCOL:
        raise StopProofError("protocol")
    for name in ("admitted", "fork_gate_closed", "wait_echild"):
        if type(proof[name]) is not bool or proof[name] is not True:
            raise StopProofError(name)
    if type(proof["effects_resolved"]) is not bool or proof["effects_resolved"] is not False:
        raise StopProofError("effects_resolved")

    code = proof["leader_exit_code"]
    if type(code) is not int or code < -255 or code > 255:
        raise StopProofError("leader_exit_code")
    reason = proof["reason"]
    if type(reason) is not str or reason not in _REASONS:
        raise StopProofError("reason")

    return {
        "protocol": _PROTOCOL,
        "operation_id": want_operation,
        "request_digest": want_digest,
        "nonce": want_nonce,
        "helper_identity": got_identity,
        "admitted": True,
        "fork_gate_closed": True,
        "wait_echild": True,
        "leader_exit_code": code,
        "reason": reason,
        "effects_resolved": False,
    }


def _operation_id(value):
    if type(value) is not str or value == "" or "\0" in value:
        raise StopProofError("operation_id")
    try:
        encoded = value.encode("utf-8")
    except UnicodeError as exc:
        raise StopProofError("operation_id") from exc
    if len(encoded) > 256:
        raise StopProofError("operation_id")
    return value


def _hex_text(value, size, label):
    if type(value) is not str or len(value) != size or any(char not in _HEX for char in value):
        raise StopProofError(label)
    return value


def _helper_identity(value):
    if type(value) is not dict or any(type(key) is not str for key in value):
        raise StopProofError("helper_identity")
    if set(value) != _IDENTITY_FIELDS:
        raise StopProofError("helper_identity")
    pid = value["pid"]
    ticks = value["start_ticks"]
    boot_id = value["boot_id"]
    if type(pid) is not int or pid <= 0:
        raise StopProofError("helper_identity.pid")
    if type(ticks) is not int or ticks < 0:
        raise StopProofError("helper_identity.start_ticks")
    if (type(boot_id) is not str or boot_id == "" or len(boot_id) > 128
            or "\0" in boot_id):
        raise StopProofError("helper_identity.boot_id")
    return {"pid": pid, "start_ticks": ticks, "boot_id": boot_id}

"""Canonical CBOR codec for secure MQTT envelopes."""

from __future__ import annotations

import struct
from typing import Any

import cbor2

from secure_mqtt.errors import EnvelopeFormatError, PayloadTooLargeError
from secure_mqtt.protocol.constants import (
    ENVELOPE_KEYS,
    MAX_CONTENT_TYPE_LEN,
    MAX_ENVELOPE_SIZE,
    MAX_KID_LEN,
    MAX_SCHEMA_ID_LEN,
    MAX_SENDER_ID_LEN,
    MSG_ID_SIZE,
    NONCE_SIZE,
    PROTECTED_HEADER_KEYS,
    SIGNATURE_SIZE,
)


def uint32_be(value: int) -> bytes:
    """Encode unsigned 32-bit integer big-endian."""
    if value < 0 or value > 0xFFFFFFFF:
        msg = "Value out of uint32 range"
        raise EnvelopeFormatError(msg)
    return struct.pack(">I", value)


def encode_canonical_cbor(value: Any) -> bytes:
    """Encode value as canonical CBOR."""
    return cbor2.dumps(value, canonical=True)


def decode_cbor(data: bytes) -> Any:
    """Decode CBOR bytes."""
    try:
        return cbor2.loads(data)
    except Exception as exc:
        raise EnvelopeFormatError("Invalid CBOR encoding") from exc


def _validate_text_field(name: str, value: Any, max_len: int) -> str:
    if not isinstance(value, str):
        msg = f"Field {name} must be text"
        raise EnvelopeFormatError(msg)
    encoded = value.encode("utf-8")
    if len(encoded) > max_len:
        msg = f"Field {name} exceeds maximum length"
        raise PayloadTooLargeError(msg)
    return value


def _validate_bytes_field(name: str, value: Any, exact_len: int | None = None) -> bytes:
    if not isinstance(value, bytes):
        msg = f"Field {name} must be a byte string"
        raise EnvelopeFormatError(msg)
    if exact_len is not None and len(value) != exact_len:
        msg = f"Field {name} has invalid length"
        raise EnvelopeFormatError(msg)
    return value


def _validate_uint_field(name: str, value: Any) -> int:
    if not isinstance(value, int) or value < 0:
        msg = f"Field {name} must be a non-negative integer"
        raise EnvelopeFormatError(msg)
    return value


def parse_envelope_map(
    data: bytes,
    *,
    max_size: int = MAX_ENVELOPE_SIZE,
) -> dict[str, Any]:
    """Parse and validate envelope CBOR map before cryptographic work."""
    if len(data) > max_size:
        raise PayloadTooLargeError("Envelope exceeds maximum size")
    if len(data) == 0:
        raise EnvelopeFormatError("Empty envelope")

    obj = decode_cbor(data)
    if not isinstance(obj, dict):
        raise EnvelopeFormatError("Envelope must be a CBOR map")

    keys = set(obj.keys())
    if keys != ENVELOPE_KEYS:
        extra = keys - ENVELOPE_KEYS
        missing = ENVELOPE_KEYS - keys
        if extra or missing:
            raise EnvelopeFormatError("Envelope contains invalid or missing fields")

    return obj


def extract_protected_header(envelope_map: dict[str, Any]) -> dict[str, Any]:
    """Validate and extract protected header fields from envelope map."""
    header: dict[str, Any] = {}
    for key in sorted(PROTECTED_HEADER_KEYS):
        header[key] = envelope_map[key]

    v = header["v"]
    if not isinstance(v, int) or v != 1:
        raise EnvelopeFormatError("Invalid protocol version")

    suite = _validate_text_field("suite", header["suite"], 64)
    kid = _validate_text_field("kid", header["kid"], MAX_KID_LEN)
    sender_id = _validate_text_field("sender_id", header["sender_id"], MAX_SENDER_ID_LEN)
    sig_kid = _validate_text_field("sig_kid", header["sig_kid"], MAX_KID_LEN)
    msg_id = _validate_bytes_field("msg_id", header["msg_id"], MSG_ID_SIZE)
    seq = _validate_uint_field("seq", header["seq"])
    iat_ms = _validate_uint_field("iat_ms", header["iat_ms"])
    exp_ms = _validate_uint_field("exp_ms", header["exp_ms"])
    content_type = _validate_text_field(
        "content_type",
        header["content_type"],
        MAX_CONTENT_TYPE_LEN,
    )
    schema_id = _validate_text_field("schema_id", header["schema_id"], MAX_SCHEMA_ID_LEN)

    if exp_ms <= iat_ms:
        raise EnvelopeFormatError("exp_ms must be greater than iat_ms")

    return {
        "v": v,
        "suite": suite,
        "kid": kid,
        "sender_id": sender_id,
        "sig_kid": sig_kid,
        "msg_id": msg_id,
        "seq": seq,
        "iat_ms": iat_ms,
        "exp_ms": exp_ms,
        "content_type": content_type,
        "schema_id": schema_id,
    }


def build_envelope_map(
    protected: dict[str, Any],
    *,
    nonce: bytes,
    ciphertext: bytes,
    signature: bytes,
) -> dict[str, Any]:
    """Build full envelope map from protected header and binary fields."""
    _validate_bytes_field("nonce", nonce, NONCE_SIZE)
    _validate_bytes_field("ciphertext", ciphertext)
    _validate_bytes_field("signature", signature, SIGNATURE_SIZE)

    result = dict(protected)
    result["nonce"] = nonce
    result["ciphertext"] = ciphertext
    result["signature"] = signature
    return result


def encode_envelope(envelope_map: dict[str, Any]) -> bytes:
    """Encode envelope map as canonical CBOR."""
    return encode_canonical_cbor(envelope_map)

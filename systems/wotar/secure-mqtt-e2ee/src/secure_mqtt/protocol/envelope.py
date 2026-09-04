"""Secure MQTT envelope seal and open."""

from __future__ import annotations

import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey

from secure_mqtt.crypto import aead, signing
from secure_mqtt.errors import (
    EnvelopeFormatError,
    ExpiredMessageError,
    FutureMessageError,
    PayloadTooLargeError,
    UnsupportedProtocolError,
)
from secure_mqtt.protocol import codec
from secure_mqtt.protocol.constants import (
    AAD_DOMAIN,
    CIPHER_SUITE,
    DEFAULT_CLOCK_SKEW_SECONDS,
    DEFAULT_MAX_TTL_SECONDS,
    DEFAULT_MESSAGE_TTL_SECONDS,
    MAX_PLAINTEXT_SIZE,
    NONCE_SIZE,
    PROTOCOL_VERSION,
    SIGN_DOMAIN,
)


@dataclass(frozen=True)
class ProtectedHeader:
    """Protected header fields bound into AAD."""

    v: int
    suite: str
    kid: str
    sender_id: str
    sig_kid: str
    msg_id: bytes
    seq: int
    iat_ms: int
    exp_ms: int
    content_type: str
    schema_id: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "v": self.v,
            "suite": self.suite,
            "kid": self.kid,
            "sender_id": self.sender_id,
            "sig_kid": self.sig_kid,
            "msg_id": self.msg_id,
            "seq": self.seq,
            "iat_ms": self.iat_ms,
            "exp_ms": self.exp_ms,
            "content_type": self.content_type,
            "schema_id": self.schema_id,
        }


@dataclass(frozen=True)
class SealedEnvelope:
    """Sealed envelope ready for MQTT publish."""

    protected: ProtectedHeader
    nonce: bytes
    ciphertext: bytes
    signature: bytes
    wire_bytes: bytes


@dataclass(frozen=True)
class OpenedEnvelope:
    """Successfully verified and decrypted envelope."""

    protected: ProtectedHeader
    plaintext: bytes
    topic: str


def build_aad(topic: str, protected: dict[str, Any]) -> bytes:
    """Build AAD from topic and protected header."""
    topic_bytes = topic.encode("utf-8")
    protected_cbor = codec.encode_canonical_cbor(protected)
    return AAD_DOMAIN + codec.uint32_be(len(topic_bytes)) + topic_bytes + protected_cbor


def build_signature_input(aad: bytes, nonce: bytes, ciphertext: bytes) -> bytes:
    """Build Ed25519 signature input."""
    return SIGN_DOMAIN + codec.uint32_be(len(aad)) + aad + nonce + ciphertext


def _utc_now_ms() -> int:
    return int(datetime.now(UTC).timestamp() * 1000)


def _validate_ttl(
    ttl_seconds: int,
    *,
    max_ttl_seconds: int = DEFAULT_MAX_TTL_SECONDS,
) -> None:
    if ttl_seconds <= 0 or ttl_seconds > max_ttl_seconds:
        msg = "TTL out of allowed range"
        raise EnvelopeFormatError(msg)


def validate_time_window(
    iat_ms: int,
    exp_ms: int,
    *,
    now_ms: int | None = None,
    clock_skew_seconds: int = DEFAULT_CLOCK_SKEW_SECONDS,
    max_ttl_seconds: int = DEFAULT_MAX_TTL_SECONDS,
) -> None:
    """Validate message issue and expiry times."""
    if now_ms is None:
        now_ms = _utc_now_ms()
    skew_ms = clock_skew_seconds * 1000
    if iat_ms > now_ms + skew_ms:
        raise FutureMessageError("Message issued in the future")
    if exp_ms < now_ms - skew_ms:
        raise ExpiredMessageError("Message has expired")
    ttl_ms = exp_ms - iat_ms
    if ttl_ms > max_ttl_seconds * 1000:
        msg = "Message TTL exceeds maximum"
        raise EnvelopeFormatError(msg)


def seal(
    *,
    topic: str,
    plaintext: bytes,
    dek: bytes,
    signing_key: Ed25519PrivateKey,
    kid: str,
    sender_id: str,
    sig_kid: str,
    seq: int,
    schema_id: str,
    content_type: str,
    msg_id: bytes | None = None,
    nonce: bytes | None = None,
    iat_ms: int | None = None,
    ttl_seconds: int | None = None,
    max_plaintext_size: int = MAX_PLAINTEXT_SIZE,
) -> SealedEnvelope:
    """Seal plaintext into a signed encrypted envelope."""
    if len(plaintext) > max_plaintext_size:
        raise PayloadTooLargeError("Plaintext exceeds maximum size")

    ttl = ttl_seconds if ttl_seconds is not None else DEFAULT_MESSAGE_TTL_SECONDS
    _validate_ttl(ttl)

    iat = iat_ms if iat_ms is not None else _utc_now_ms()
    exp = iat + ttl * 1000
    mid = msg_id if msg_id is not None else uuid.uuid4().bytes

    protected = ProtectedHeader(
        v=PROTOCOL_VERSION,
        suite=CIPHER_SUITE,
        kid=kid,
        sender_id=sender_id,
        sig_kid=sig_kid,
        msg_id=mid,
        seq=seq,
        iat_ms=iat,
        exp_ms=exp,
        content_type=content_type,
        schema_id=schema_id,
    )
    protected_dict = protected.to_dict()

    if protected.suite != CIPHER_SUITE:
        raise UnsupportedProtocolError("Unsupported cipher suite")

    aad = build_aad(topic, protected_dict)
    n = nonce if nonce is not None else secrets.token_bytes(NONCE_SIZE)
    ciphertext = aead.encrypt(dek, n, plaintext, aad)
    sig_input = build_signature_input(aad, n, ciphertext)
    sig = signing.sign(signing_key, sig_input)

    envelope_map = codec.build_envelope_map(
        protected_dict,
        nonce=n,
        ciphertext=ciphertext,
        signature=sig,
    )
    wire = codec.encode_envelope(envelope_map)
    return SealedEnvelope(
        protected=protected,
        nonce=n,
        ciphertext=ciphertext,
        signature=sig,
        wire_bytes=wire,
    )


def open_envelope(
    *,
    topic: str,
    wire_bytes: bytes,
    dek: bytes,
    public_key: Ed25519PublicKey,
    now_ms: int | None = None,
    clock_skew_seconds: int = DEFAULT_CLOCK_SKEW_SECONDS,
    max_ttl_seconds: int = DEFAULT_MAX_TTL_SECONDS,
    max_plaintext_size: int = MAX_PLAINTEXT_SIZE,
) -> OpenedEnvelope:
    """Verify signature, validate times, and decrypt envelope."""
    envelope_map = codec.parse_envelope_map(wire_bytes)
    protected_dict = codec.extract_protected_header(envelope_map)

    if protected_dict["suite"] != CIPHER_SUITE:
        raise UnsupportedProtocolError("Unsupported cipher suite")

    nonce = codec._validate_bytes_field("nonce", envelope_map["nonce"], NONCE_SIZE)  # noqa: SLF001
    ciphertext = codec._validate_bytes_field("ciphertext", envelope_map["ciphertext"])  # noqa: SLF001
    signature = codec._validate_bytes_field(  # noqa: SLF001
        "signature", envelope_map["signature"], 64
    )

    aad = build_aad(topic, protected_dict)
    sig_input = build_signature_input(aad, nonce, ciphertext)
    signing.verify(public_key, signature, sig_input)

    validate_time_window(
        protected_dict["iat_ms"],
        protected_dict["exp_ms"],
        now_ms=now_ms,
        clock_skew_seconds=clock_skew_seconds,
        max_ttl_seconds=max_ttl_seconds,
    )

    plaintext = aead.decrypt(dek, nonce, ciphertext, aad)
    if len(plaintext) > max_plaintext_size:
        raise PayloadTooLargeError("Plaintext exceeds maximum size")

    protected = ProtectedHeader(**protected_dict)
    return OpenedEnvelope(protected=protected, plaintext=plaintext, topic=topic)

"""Ed25519 signing and verification."""

from __future__ import annotations

from cryptography.exceptions import InvalidSignature as CryptoInvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey,
    Ed25519PublicKey,
)

from secure_mqtt.errors import InvalidSignatureError


def sign(private_key: Ed25519PrivateKey, message: bytes) -> bytes:
    """Sign message with Ed25519 private key."""
    return private_key.sign(message)


def verify(public_key: Ed25519PublicKey, signature: bytes, message: bytes) -> None:
    """Verify Ed25519 signature; raise InvalidSignatureError on failure."""
    try:
        public_key.verify(signature, message)
    except CryptoInvalidSignature as exc:
        raise InvalidSignatureError("Signature verification failed") from exc


def private_key_from_seed(seed: bytes) -> Ed25519PrivateKey:
    """Load Ed25519 private key from 32-byte seed."""
    return Ed25519PrivateKey.from_private_bytes(seed)


def public_key_from_bytes(raw: bytes) -> Ed25519PublicKey:
    """Load Ed25519 public key from 32-byte raw encoding."""
    return Ed25519PublicKey.from_public_bytes(raw)

"""AES-256-GCM-SIV AEAD wrapper."""

from __future__ import annotations

from secure_mqtt.errors import ConfigurationError, DecryptionError
from secure_mqtt.protocol.constants import DEK_SIZE, NONCE_SIZE

try:
    from cryptography.hazmat.primitives.ciphers.aead import AESGCMSIV
except ImportError as exc:
    raise ConfigurationError(
        "AESGCMSIV is not available; install cryptography>=42. No cipher downgrade."
    ) from exc


def _validate_key(key: bytes) -> None:
    if len(key) != DEK_SIZE:
        msg = f"DEK must be {DEK_SIZE} bytes"
        raise ConfigurationError(msg)


def _validate_nonce(nonce: bytes) -> None:
    if len(nonce) != NONCE_SIZE:
        msg = f"Nonce must be {NONCE_SIZE} bytes"
        raise ConfigurationError(msg)


def encrypt(dek: bytes, nonce: bytes, plaintext: bytes, aad: bytes) -> bytes:
    """Encrypt plaintext with AES-256-GCM-SIV."""
    _validate_key(dek)
    _validate_nonce(nonce)
    aead = AESGCMSIV(dek)
    return aead.encrypt(nonce, plaintext, aad)


def decrypt(dek: bytes, nonce: bytes, ciphertext: bytes, aad: bytes) -> bytes:
    """Decrypt ciphertext with AES-256-GCM-SIV."""
    _validate_key(dek)
    _validate_nonce(nonce)
    aead = AESGCMSIV(dek)
    try:
        return aead.decrypt(nonce, ciphertext, aad)
    except Exception as exc:
        raise DecryptionError("AEAD decryption failed") from exc

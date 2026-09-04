"""Key provider protocol and key lifecycle states."""

from __future__ import annotations

from enum import StrEnum
from typing import Protocol

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from secure_mqtt.crypto.key_material import KeyMaterial


class KeyState(StrEnum):
    """Lifecycle state for encryption or signing keys."""

    ACTIVE = "active"
    DECRYPT_ONLY = "decrypt_only"
    RETIRED = "retired"
    REVOKED = "revoked"


class KeyProvider(Protocol):
    """Provides DEK keyring and signing material for a local endpoint."""

    @property
    def sender_id(self) -> str:
        """Logical sender identity for outbound messages."""
        ...

    @property
    def sig_kid(self) -> str:
        """Active signing key identifier."""
        ...

    def get_active_dek(self, topic_group: str) -> KeyMaterial:
        """Return ACTIVE DEK for sealing new messages."""
        ...

    def get_dek_for_decrypt(self, topic_group: str, kid: str) -> KeyMaterial:
        """Return DEK for decryption when state allows."""
        ...

    def get_signing_key(self) -> Ed25519PrivateKey:
        """Return active Ed25519 private signing key."""
        ...

    def has_active_dek(self, topic_group: str) -> bool:
        """Return True when topic_group has an ACTIVE DEK."""
        ...

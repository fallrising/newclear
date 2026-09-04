"""In-memory key provider for unit tests."""

from __future__ import annotations

from dataclasses import dataclass, field

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from secure_mqtt.crypto import signing
from secure_mqtt.crypto.key_material import KeyMaterial
from secure_mqtt.errors import InvalidKeyStateError, UnknownKeyError
from secure_mqtt.keys.provider import KeyState


@dataclass
class _TopicGroupKeys:
    active_kid: str | None = None
    keys: dict[str, tuple[bytes, KeyState]] = field(default_factory=dict)


@dataclass
class InMemoryKeyProvider:
    """Mutable in-memory keyring for tests and local harnesses."""

    sender_id: str
    sig_kid: str
    signing_seed: bytes
    topic_groups: dict[str, _TopicGroupKeys] = field(default_factory=dict)
    _signing_key: Ed25519PrivateKey | None = field(default=None, repr=False)

    def add_dek(
        self,
        topic_group: str,
        kid: str,
        dek: bytes,
        state: KeyState = KeyState.ACTIVE,
    ) -> None:
        """Register a DEK for a topic group."""
        group = self.topic_groups.setdefault(topic_group, _TopicGroupKeys())
        if state == KeyState.ACTIVE:
            group.active_kid = kid
        group.keys[kid] = (dek, state)

    def get_signing_key(self) -> Ed25519PrivateKey:
        if self._signing_key is None:
            self._signing_key = signing.private_key_from_seed(self.signing_seed)
        return self._signing_key

    def has_active_dek(self, topic_group: str) -> bool:
        group = self.topic_groups.get(topic_group)
        return group is not None and group.active_kid is not None

    def get_active_dek(self, topic_group: str) -> KeyMaterial:
        group = self.topic_groups.get(topic_group)
        if group is None or group.active_kid is None:
            raise UnknownKeyError(f"No active DEK for topic group {topic_group}")
        kid = group.active_kid
        dek, state = group.keys[kid]
        if state != KeyState.ACTIVE:
            raise InvalidKeyStateError(f"DEK {kid} is not active")
        return KeyMaterial(kid=kid, secret=dek)

    def get_dek_for_decrypt(self, topic_group: str, kid: str) -> KeyMaterial:
        group = self.topic_groups.get(topic_group)
        if group is None or kid not in group.keys:
            raise UnknownKeyError(f"Unknown DEK {kid} for topic group {topic_group}")
        dek, state = group.keys[kid]
        if state not in (KeyState.ACTIVE, KeyState.DECRYPT_ONLY):
            raise InvalidKeyStateError(f"DEK {kid} cannot decrypt")
        return KeyMaterial(kid=kid, secret=dek)

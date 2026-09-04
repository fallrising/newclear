"""Trusted signing public-key registry."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

from secure_mqtt.errors import UnknownSenderError
from secure_mqtt.keys.provider import KeyState


@dataclass(frozen=True)
class SigningPublicKeyRecord:
    """Trusted publisher signing key metadata."""

    sig_kid: str
    sender_id: str
    public_key: Ed25519PublicKey
    state: KeyState = KeyState.ACTIVE
    not_before: datetime | None = None
    not_after: datetime | None = None

    def __post_init__(self) -> None:
        for name, value in (("not_before", self.not_before), ("not_after", self.not_after)):
            if value is not None and value.tzinfo is None:
                msg = f"{name} must include a UTC offset"
                raise ValueError(msg)
        if (
            self.not_before is not None
            and self.not_after is not None
            and self.not_after < self.not_before
        ):
            raise ValueError("not_after must not be earlier than not_before")

    def is_usable(self) -> bool:
        return self.state in (KeyState.ACTIVE, KeyState.DECRYPT_ONLY)

    def is_valid_at(self, issued_at_ms: int) -> bool:
        """Return whether a message issue time falls within the key validity interval."""
        if self.not_before is not None and issued_at_ms < self.not_before.timestamp() * 1000:
            return False
        return self.not_after is None or issued_at_ms <= self.not_after.timestamp() * 1000


class SigningPublicKeyRegistry:
    """Lookup trusted publisher keys by sig_kid or sender_id."""

    def __init__(self, records: list[SigningPublicKeyRecord] | None = None) -> None:
        self._by_sig_kid: dict[str, SigningPublicKeyRecord] = {}
        self._by_sender_id: dict[str, SigningPublicKeyRecord] = {}
        if records:
            for record in records:
                self.register(record)

    def register(self, record: SigningPublicKeyRecord) -> None:
        self._by_sig_kid[record.sig_kid] = record
        self._by_sender_id[record.sender_id] = record

    def lookup_by_sig_kid(self, sig_kid: str) -> SigningPublicKeyRecord:
        record = self._by_sig_kid.get(sig_kid)
        if record is None:
            msg = f"Unknown signing key {sig_kid}"
            raise UnknownSenderError(msg)
        return record

    def lookup_by_sender_id(self, sender_id: str) -> SigningPublicKeyRecord:
        record = self._by_sender_id.get(sender_id)
        if record is None:
            msg = f"Unknown sender {sender_id}"
            raise UnknownSenderError(msg)
        return record

    def resolve_for_envelope(
        self,
        sender_id: str,
        sig_kid: str,
        *,
        issued_at_ms: int,
    ) -> SigningPublicKeyRecord:
        """Resolve a signing key valid for the sender and envelope issue time."""
        record = self.lookup_by_sig_kid(sig_kid)
        if record.sender_id != sender_id:
            msg = "sender_id does not match trusted registry"
            raise UnknownSenderError(msg)
        if not record.is_usable():
            msg = f"Signing key {sig_kid} is not usable"
            raise UnknownSenderError(msg)
        if not record.is_valid_at(issued_at_ms):
            msg = f"Signing key {sig_kid} is outside its validity window"
            raise UnknownSenderError(msg)
        return record

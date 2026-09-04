"""Sensitive key material wrapper."""

from __future__ import annotations

from dataclasses import dataclass

from secure_mqtt.protocol.constants import DEK_SIZE


@dataclass(frozen=True)
class KeyMaterial:
    """DEK or signing seed bytes with safe repr."""

    kid: str
    secret: bytes

    def __post_init__(self) -> None:
        if len(self.secret) != DEK_SIZE:
            msg = f"Key material must be {DEK_SIZE} bytes"
            raise ValueError(msg)

    def __repr__(self) -> str:
        return f"KeyMaterial(kid={self.kid!r}, secret=<redacted>)"

    def as_bytes(self) -> bytes:
        """Return secret bytes for cryptographic use."""
        return self.secret

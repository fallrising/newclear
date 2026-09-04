"""Public data models for secure MQTT client."""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime

MessageHandler = Callable[["SecureMessage"], None]


@dataclass(frozen=True)
class SecureMessage:
    """Validated decrypted message delivered to application handlers."""

    topic: str
    plaintext: bytes
    sender_id: str
    msg_id: bytes
    seq: int
    schema_id: str
    content_type: str
    received_at: datetime


@dataclass(frozen=True)
class PublishReceipt:
    """Receipt for a successfully acknowledged publish."""

    topic: str
    msg_id: bytes
    seq: int
    outbox_id: int
    published_at: datetime


@dataclass(frozen=True)
class SubscriptionHandle:
    """Handle for a registered subscription filter."""

    subscription_id: str
    filter: str
    qos: int

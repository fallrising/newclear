"""Transactional encrypted outbox persistence."""

from __future__ import annotations

import sqlite3
import uuid
from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum

from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

from secure_mqtt.errors import PublishError, UnknownKeyError
from secure_mqtt.keys.provider import KeyProvider
from secure_mqtt.persistence.database import Database, utc_now, utc_now_iso
from secure_mqtt.policy.topic_policy import TopicPolicyResolver
from secure_mqtt.protocol import envelope


class OutboxState(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    ACKED = "acked"
    FAILED = "failed"


@dataclass(frozen=True)
class OutboxRecord:
    """Encrypted outbox row ready for MQTT publish."""

    id: int
    sender_id: str
    topic: str
    topic_group: str
    msg_id: bytes
    seq: int
    envelope: bytes
    state: OutboxState
    mqtt_mid: int | None
    created_at: datetime
    updated_at: datetime


class OutboxStore:
    """Prepare and track encrypted publish outbox rows."""

    def __init__(
        self,
        database: Database,
        key_provider: KeyProvider,
        policy_resolver: TopicPolicyResolver,
    ) -> None:
        self._db = database
        self._keys = key_provider
        self._policy = policy_resolver

    def _allocate_seq(self, conn: sqlite3.Connection, sender_id: str) -> int:
        row = conn.execute(
            "SELECT next_seq FROM sender_state WHERE sender_id = ?",
            (sender_id,),
        ).fetchone()
        if row is None:
            seq = 1
            conn.execute(
                "INSERT INTO sender_state(sender_id, next_seq, updated_at) VALUES (?, ?, ?)",
                (sender_id, seq + 1, utc_now_iso()),
            )
            return seq
        seq = int(row["next_seq"])
        conn.execute(
            "UPDATE sender_state SET next_seq = ?, updated_at = ? WHERE sender_id = ?",
            (seq + 1, utc_now_iso(), sender_id),
        )
        return seq

    def prepare_publish(
        self,
        *,
        topic: str,
        plaintext: bytes,
        content_type: str,
        signing_key: Ed25519PrivateKey | None = None,
        ttl_seconds: int | None = None,
    ) -> OutboxRecord:
        """Seal envelope and persist ciphertext to outbox in one transaction."""
        sender_id = self._keys.sender_id
        policy = self._policy.assert_publish_allowed(topic, sender_id)
        if not self._keys.has_active_dek(policy.topic_group):
            raise UnknownKeyError(f"No active DEK for topic group {policy.topic_group}")

        dek_material = self._keys.get_active_dek(policy.topic_group)
        signer = signing_key if signing_key is not None else self._keys.get_signing_key()
        ttl = ttl_seconds if ttl_seconds is not None else policy.ttl_seconds
        now_iso = utc_now_iso()

        with self._db.connection:
            conn = self._db.connection
            seq = self._allocate_seq(conn, sender_id)
            msg_id = uuid.uuid4().bytes
            sealed = envelope.seal(
                topic=topic,
                plaintext=plaintext,
                dek=dek_material.as_bytes(),
                signing_key=signer,
                kid=dek_material.kid,
                sender_id=sender_id,
                sig_kid=self._keys.sig_kid,
                seq=seq,
                schema_id=policy.schema_id,
                content_type=content_type,
                msg_id=msg_id,
                ttl_seconds=ttl,
            )
            cursor = conn.execute(
                """
                INSERT INTO outbox(
                    sender_id, topic, topic_group, msg_id, seq, envelope, state,
                    mqtt_mid, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
                """,
                (
                    sender_id,
                    topic,
                    policy.topic_group,
                    sealed.protected.msg_id,
                    seq,
                    sealed.wire_bytes,
                    OutboxState.PENDING.value,
                    now_iso,
                    now_iso,
                ),
            )
            row_id = cursor.lastrowid
            if row_id is None:
                raise PublishError("Failed to allocate outbox row")
            outbox_id = int(row_id)

        return OutboxRecord(
            id=outbox_id,
            sender_id=sender_id,
            topic=topic,
            topic_group=policy.topic_group,
            msg_id=sealed.protected.msg_id,
            seq=seq,
            envelope=sealed.wire_bytes,
            state=OutboxState.PENDING,
            mqtt_mid=None,
            created_at=utc_now(),
            updated_at=utc_now(),
        )

    def list_pending(self, limit: int = 100) -> list[OutboxRecord]:
        rows = self._db.connection.execute(
            """
            SELECT * FROM outbox
            WHERE state IN (?, ?)
            ORDER BY id ASC
            LIMIT ?
            """,
            (OutboxState.PENDING.value, OutboxState.SENT.value, limit),
        ).fetchall()
        return [self._row_to_record(row) for row in rows]

    def mark_sent(self, outbox_id: int, mqtt_mid: int) -> None:
        with self._db.connection:
            updated = self._db.connection.execute(
                """
                UPDATE outbox
                SET state = ?, mqtt_mid = ?, updated_at = ?
                WHERE id = ? AND state = ?
                """,
                (
                    OutboxState.SENT.value,
                    mqtt_mid,
                    utc_now_iso(),
                    outbox_id,
                    OutboxState.PENDING.value,
                ),
            ).rowcount
        if updated == 0:
            raise PublishError(f"Outbox row {outbox_id} not pending")

    def mark_acked(self, outbox_id: int) -> None:
        with self._db.connection:
            updated = self._db.connection.execute(
                """
                UPDATE outbox
                SET state = ?, updated_at = ?
                WHERE id = ? AND state IN (?, ?)
                """,
                (
                    OutboxState.ACKED.value,
                    utc_now_iso(),
                    outbox_id,
                    OutboxState.PENDING.value,
                    OutboxState.SENT.value,
                ),
            ).rowcount
        if updated == 0:
            raise PublishError(f"Outbox row {outbox_id} not ackable")

    def mark_failed(self, outbox_id: int) -> None:
        with self._db.connection:
            self._db.connection.execute(
                "UPDATE outbox SET state = ?, updated_at = ? WHERE id = ?",
                (OutboxState.FAILED.value, utc_now_iso(), outbox_id),
            )

    def get_by_id(self, outbox_id: int) -> OutboxRecord | None:
        row = self._db.connection.execute(
            "SELECT * FROM outbox WHERE id = ?",
            (outbox_id,),
        ).fetchone()
        if row is None:
            return None
        return self._row_to_record(row)

    def _row_to_record(self, row: sqlite3.Row) -> OutboxRecord:
        return OutboxRecord(
            id=int(row["id"]),
            sender_id=str(row["sender_id"]),
            topic=str(row["topic"]),
            topic_group=str(row["topic_group"]),
            msg_id=bytes(row["msg_id"]),
            seq=int(row["seq"]),
            envelope=bytes(row["envelope"]),
            state=OutboxState(str(row["state"])),
            mqtt_mid=int(row["mqtt_mid"]) if row["mqtt_mid"] is not None else None,
            created_at=datetime.fromisoformat(str(row["created_at"])),
            updated_at=datetime.fromisoformat(str(row["updated_at"])),
        )

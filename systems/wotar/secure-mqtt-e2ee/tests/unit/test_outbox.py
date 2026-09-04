"""Outbox sealing and persistence."""

from __future__ import annotations

from tests.fixtures import test_vector

from secure_mqtt.persistence.outbox import OutboxState, OutboxStore


def test_prepare_publish_persists_encrypted_envelope(
    tmp_db,
    in_memory_keys,
    policy_resolver,
) -> None:
    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    record = outbox.prepare_publish(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        content_type="application/json",
        signing_key=test_vector.signing_key(),
        ttl_seconds=300,
    )
    assert record.state == OutboxState.PENDING
    assert record.seq == 1
    assert record.envelope == record.envelope
    assert test_vector.PLAINTEXT not in record.envelope


def test_list_pending_returns_unacked(tmp_db, in_memory_keys, policy_resolver) -> None:
    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    record = outbox.prepare_publish(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        content_type="application/json",
        signing_key=test_vector.signing_key(),
        ttl_seconds=300,
    )
    pending = outbox.list_pending()
    assert len(pending) == 1
    assert pending[0].id == record.id

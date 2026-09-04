"""Ensure secrets never appear in logs, repr, or outbox."""

from __future__ import annotations

import json
import logging

from tests.fixtures import test_vector

from secure_mqtt.crypto.key_material import KeyMaterial
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.observability.logging import JsonLogFormatter, configure_logging
from secure_mqtt.persistence.database import Database
from secure_mqtt.persistence.outbox import OutboxStore
from secure_mqtt.policy.topic_policy import TopicPolicyResolver


def test_key_material_repr_redacts_secret() -> None:
    material = KeyMaterial(kid="dek-1", secret=test_vector.DEK)
    rendered = repr(material)
    assert test_vector.DEK.hex() not in rendered
    assert "<redacted>" in rendered


def test_in_memory_provider_repr_redacts_signing_key(in_memory_keys: InMemoryKeyProvider) -> None:
    rendered = repr(in_memory_keys)
    assert test_vector.SIGN_SEED.hex() not in rendered


def test_json_logs_redact_sensitive_fields() -> None:
    formatter = JsonLogFormatter()
    record = logging.LogRecord(
        name="secure_mqtt.test",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="event",
        args=(),
        exc_info=None,
    )
    record.dek_hex = test_vector.DEK.hex()
    record.signing_seed = test_vector.SIGN_SEED.hex()
    payload = json.loads(formatter.format(record))
    assert test_vector.DEK.hex() not in json.dumps(payload)
    assert "<redacted>" in json.dumps(payload)


def test_outbox_stores_envelope_not_plaintext_dek(
    tmp_db: Database,
    in_memory_keys: InMemoryKeyProvider,
    policy_resolver: TopicPolicyResolver,
) -> None:
    outbox = OutboxStore(tmp_db, in_memory_keys, policy_resolver)
    record = outbox.prepare_publish(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        content_type="application/json",
        signing_key=test_vector.signing_key(),
        ttl_seconds=300,
    )
    row = tmp_db.connection.execute(
        "SELECT envelope FROM outbox WHERE id = ?", (record.id,)
    ).fetchone()
    assert row is not None
    stored = bytes(row["envelope"])
    assert test_vector.PLAINTEXT not in stored
    assert test_vector.DEK not in stored
    assert test_vector.DEK.hex() not in stored.hex()


def test_configure_logging_does_not_emit_secrets(capfd) -> None:
    configure_logging()
    logger = logging.getLogger("secure_mqtt.test")
    logger.info("probe", extra={"dek_hex": test_vector.DEK.hex()})
    captured = capfd.readouterr().out
    assert test_vector.DEK.hex() not in captured

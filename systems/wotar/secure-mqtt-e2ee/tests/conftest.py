"""Shared pytest fixtures."""

from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

import pytest

from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.keys.provider import KeyState
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRecord, SigningPublicKeyRegistry
from secure_mqtt.persistence.database import Database
from secure_mqtt.policy.topic_policy import TopicPolicyResolver, TopicPolicyRule
from secure_mqtt.protocol import envelope
from tests.fixtures import test_vector


@pytest.fixture
def in_memory_keys() -> InMemoryKeyProvider:
    """Key provider seeded with the fixed test vector DEK."""
    provider = InMemoryKeyProvider(
        sender_id="device-001",
        sig_kid="sig-v1-test",
        signing_seed=test_vector.SIGN_SEED,
    )
    provider.add_dek("vector1", "dek-v1-test", test_vector.DEK, state=KeyState.ACTIVE)
    return provider


@pytest.fixture
def registry() -> SigningPublicKeyRegistry:
    """Trusted registry for the fixed test vector signing key."""
    return SigningPublicKeyRegistry(
        [
            SigningPublicKeyRecord(
                sig_kid="sig-v1-test",
                sender_id="device-001",
                public_key=test_vector.public_key(),
                state=KeyState.ACTIVE,
            )
        ]
    )


@pytest.fixture
def policy_resolver() -> TopicPolicyResolver:
    """Topic policy matching the fixed test vector topic."""
    return TopicPolicyResolver(
        [
            TopicPolicyRule(
                filter="test/e2ee/#",
                topic_group="vector1",
                schema_id="sensor.temp.v1",
                ttl_seconds=300,
                max_ttl_seconds=24 * 3600,
            )
        ]
    )


@pytest.fixture
def tmp_db(tmp_path: Path) -> Database:
    """Ephemeral SQLite database."""
    db = Database(tmp_path / "state.db")
    yield db
    db.close()


@pytest.fixture
def sealed_envelope() -> envelope.SealedEnvelope:
    """Deterministic sealed envelope from docs/test-vectors.md."""
    return envelope.seal(
        topic=test_vector.TOPIC,
        plaintext=test_vector.PLAINTEXT,
        dek=test_vector.DEK,
        signing_key=test_vector.signing_key(),
        kid="dek-v1-test",
        sender_id="device-001",
        sig_kid="sig-v1-test",
        seq=42,
        schema_id="sensor.temp.v1",
        content_type="application/json",
        msg_id=test_vector.MSG_ID,
        nonce=test_vector.NONCE,
        iat_ms=test_vector.IAT_MS,
        ttl_seconds=300,
    )


@pytest.fixture
def open_valid_envelope(
    sealed_envelope: envelope.SealedEnvelope,
) -> Callable[[str], envelope.OpenedEnvelope]:
    """Helper to open the sealed test vector on a topic."""

    def _open(topic: str = test_vector.TOPIC) -> envelope.OpenedEnvelope:
        return envelope.open_envelope(
            topic=topic,
            wire_bytes=sealed_envelope.wire_bytes,
            dek=test_vector.DEK,
            public_key=test_vector.public_key(),
            now_ms=test_vector.IAT_MS + 1000,
        )

    return _open

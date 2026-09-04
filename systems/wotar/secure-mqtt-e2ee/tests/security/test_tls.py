"""TLS configuration security tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from secure_mqtt.config import ClientConfig, TlsConfig
from secure_mqtt.errors import ConfigurationError
from secure_mqtt.keys.memory import InMemoryKeyProvider
from secure_mqtt.mqtt.paho_transport import PahoMqttTransport
from secure_mqtt.observability.metrics import Metrics


@pytest.fixture
def key_provider() -> InMemoryKeyProvider:
    provider = InMemoryKeyProvider(sender_id="dev", sig_kid="sig-1", signing_seed=b"\x01" * 32)
    provider.add_dek("default", "dek-1", b"\x02" * 32)
    return provider


def test_missing_ca_file_fails_validation(
    tmp_path: Path, key_provider: InMemoryKeyProvider
) -> None:
    missing = tmp_path / "missing-ca.pem"
    config = ClientConfig(
        broker_host="localhost",
        broker_port=8883,
        client_id="test-client",
        tls=TlsConfig(ca_file=missing),
        key_provider=key_provider,
        db_path=tmp_path / "state.db",
    )
    with pytest.raises(ConfigurationError, match="CA file not found"):
        config.validate()


def test_missing_ca_prevents_transport_init(tmp_path: Path) -> None:
    missing = tmp_path / "missing-ca.pem"
    tls = TlsConfig(ca_file=missing)
    with pytest.raises(ConfigurationError, match="CA file not found"):
        tls.validate()
        _ = PahoMqttTransport(
            host="localhost",
            port=8883,
            client_id="tls-test",
            tls=tls,
            metrics=Metrics(),
        )

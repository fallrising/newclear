"""Opt-in public EMQX broker end-to-end smoke test."""

from __future__ import annotations

import os
import secrets
import tempfile
import time
from pathlib import Path

import pytest

from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import ClientConfig, TlsConfig
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.policy.loader import load_public_key_registry

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.public_smoke
def test_public_broker_encrypted_roundtrip() -> None:
    if os.environ.get("SECURE_MQTT_RUN_PUBLIC_SMOKE") != "1":
        pytest.skip("Set SECURE_MQTT_RUN_PUBLIC_SMOKE=1 to run public broker smoke test")

    keyring = ROOT / ".secure_mqtt" / "keyring.json"
    public_keys = ROOT / "config" / "public-keys.local.json"
    if not keyring.exists():
        pytest.skip("Bootstrap local keys first")

    namespace = secrets.token_hex(16)
    topic = f"test/e2ee/{namespace}/synthetic"
    registry = load_public_key_registry(public_keys)
    provider = FileKeyringProvider.from_path(keyring)

    tls = TlsConfig(
        ca_file=Path(
            os.environ.get("SECURE_MQTT_TLS_CA_FILE", "/etc/ssl/certs/ca-certificates.crt")
        ),
    )
    if not tls.ca_file.exists():
        pytest.skip("No system CA bundle; set SECURE_MQTT_TLS_CA_FILE")

    received: list[bytes] = []

    def handler(msg) -> None:
        received.append(msg.plaintext)

    with tempfile.TemporaryDirectory() as tmp:
        config = ClientConfig(
            broker_host=os.environ.get("SECURE_MQTT_BROKER_HOST", "broker.emqx.io"),
            broker_port=int(os.environ.get("SECURE_MQTT_BROKER_PORT", "8883")),
            client_id=f"smoke-{namespace[:8]}",
            tls=tls,
            key_provider=provider,
            db_path=Path(tmp) / "smoke.db",
            profile="public-dev",
            connect_timeout_seconds=30.0,
            publish_timeout_seconds=30.0,
        )
        sub = SecureMqttClient(
            config=config,
            registry=registry,
            policy_resolver=build_default_policy_resolver(),
        )
        sub.register_subscription(topic, handler, qos=1)
        sub.connect()
        try:
            pub_config = ClientConfig(
                broker_host=config.broker_host,
                broker_port=config.broker_port,
                client_id=f"smoke-pub-{namespace[:8]}",
                tls=tls,
                key_provider=provider,
                db_path=Path(tmp) / "pub.db",
                profile="public-dev",
                connect_timeout_seconds=30.0,
                publish_timeout_seconds=30.0,
            )
            pub = SecureMqttClient(
                config=pub_config,
                registry=registry,
                policy_resolver=build_default_policy_resolver(),
            )
            pub.connect()
            try:
                pub.publish_json(topic, {"synthetic": True, "ns": namespace}, wait_ack=True)
                deadline = time.time() + 30
                while time.time() < deadline and not received:
                    time.sleep(0.2)
                assert received, "No decrypted message on public broker"
                assert b"synthetic" in received[0]
            finally:
                pub.shutdown()
        finally:
            sub.shutdown()

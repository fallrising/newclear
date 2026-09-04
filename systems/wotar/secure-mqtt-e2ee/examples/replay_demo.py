#!/usr/bin/env python3
"""Demonstrate duplicate/replay rejection (handler invoked once)."""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
from pathlib import Path

from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import ClientConfig, TlsConfig
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.mqtt.transport import IncomingMessage
from secure_mqtt.policy.loader import load_public_key_registry

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    keyring = ROOT / ".secure_mqtt" / "keyring.json"
    public_keys = ROOT / "config" / "public-keys.local.json"
    if not keyring.exists():
        print("Run scripts/bootstrap_local_keys.py first", file=sys.stderr)
        return 1

    registry = load_public_key_registry(public_keys)
    provider = FileKeyringProvider.from_path(keyring)
    ca = ROOT / "certs" / "ca.pem"
    tls = TlsConfig(
        ca_file=ca,
        cert_file=ROOT / "certs" / "client.pem",
        key_file=ROOT / "certs" / "client.key",
        server_hostname="localhost",
    )
    topic = os.environ.get("EXAMPLE_TOPIC", "test/e2ee/replay-demo/data")

    with tempfile.TemporaryDirectory() as tmp:
        db = Path(tmp) / "replay.db"
        config = ClientConfig(
            broker_host="localhost",
            broker_port=8883,
            client_id="replay-demo",
            tls=tls,
            key_provider=provider,
            db_path=db,
        )
        client = SecureMqttClient(
            config=config,
            registry=registry,
            policy_resolver=build_default_policy_resolver(),
        )
        count = 0
        lock = threading.Lock()

        def handler(_msg) -> None:
            nonlocal count
            with lock:
                count += 1

        client.register_subscription(topic, handler, qos=1)
        client.connect()
        try:
            receipt = client.publish_text(topic, "replay-me", wait_ack=True)
            time.sleep(2.0)
            row = client._outbox._db.connection.execute(  # noqa: SLF001
                "SELECT envelope FROM outbox WHERE id = ?",
                (receipt.outbox_id,),
            ).fetchone()
            assert row is not None
            envelope = bytes(row["envelope"])
            # Simulate broker duplicate
            client._receive_worker.offer(  # noqa: SLF001
                IncomingMessage(topic=topic, payload=envelope, qos=1)
            )
            time.sleep(2.0)
            print(json.dumps({"handler_invocations": count, "expected": 1}))
            return 0 if count == 1 else 2
        finally:
            client.shutdown()


if __name__ == "__main__":
    raise SystemExit(main())
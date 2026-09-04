#!/usr/bin/env python3
"""Publish synthetic JSON sensor telemetry."""

from __future__ import annotations

import json
import os
import secrets
import time

from secure_mqtt.cli import main as cli_main


def main() -> int:
    ns = secrets.token_hex(8)
    topic = os.environ.get("EXAMPLE_TOPIC", f"test/e2ee/{ns}/telemetry")
    payload = {
        "sensor_id": "temp-01",
        "temp_c": 21.5,
        "humidity_pct": 48.2,
        "ts_ms": int(time.time() * 1000),
        "synthetic": True,
    }
    return cli_main([
        "pub",
        "--topic",
        topic,
        "--message",
        json.dumps(payload),
        "--json",
        "--public-keys-file",
        os.environ.get("SECURE_MQTT_PUBLIC_KEYS_FILE", "config/public-keys.local.json"),
    ])


if __name__ == "__main__":
    raise SystemExit(main())
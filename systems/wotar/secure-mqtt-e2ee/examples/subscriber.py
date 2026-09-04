#!/usr/bin/env python3
"""Example encrypted subscriber."""

from __future__ import annotations

import os

from secure_mqtt.cli import main as cli_main


def main() -> int:
    topic = os.environ.get("EXAMPLE_TOPIC", "test/e2ee/#")
    return cli_main([
        "sub",
        "--topic",
        topic,
        "--qos",
        "1",
        "--public-keys-file",
        os.environ.get("SECURE_MQTT_PUBLIC_KEYS_FILE", "config/public-keys.local.json"),
    ])


if __name__ == "__main__":
    raise SystemExit(main())
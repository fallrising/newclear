#!/usr/bin/env python3
"""Example encrypted publisher."""

from __future__ import annotations

import json
import os
import sys

from secure_mqtt.cli import main as cli_main


def main() -> int:
    topic = os.environ.get("EXAMPLE_TOPIC", "test/e2ee/demo/data")
    message = os.environ.get("EXAMPLE_MESSAGE", "hello from examples/publisher.py")
    return cli_main([
        "pub",
        "--topic",
        topic,
        "--message",
        message,
        "--public-keys-file",
        os.environ.get("SECURE_MQTT_PUBLIC_KEYS_FILE", "config/public-keys.local.json"),
    ])


if __name__ == "__main__":
    raise SystemExit(main())
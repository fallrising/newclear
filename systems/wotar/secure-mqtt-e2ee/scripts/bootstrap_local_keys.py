#!/usr/bin/env python3
"""Bootstrap local development keyring and public key registry."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from secure_mqtt.keys.keyring_admin import generate_local_keyring

# default: used by build_default_policy_resolver() / integration / public smoke
# vector1: used by config/topic-policies.example.toml quickstart topics
_DEFAULT_TOPIC_GROUPS = ("default", "vector1")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bootstrap local secure-mqtt keys")
    parser.add_argument("--keyring", default=".secure_mqtt/keyring.json")
    parser.add_argument("--public-keys", default="config/public-keys.local.json")
    parser.add_argument("--sender-id", default="device-local-001")
    parser.add_argument(
        "--topic-group",
        action="append",
        dest="topic_groups",
        default=None,
        help=(
            "Topic group to provision (repeatable). "
            f"Default: {' '.join(_DEFAULT_TOPIC_GROUPS)}"
        ),
    )
    args = parser.parse_args()

    keyring_path = Path(args.keyring)
    public_keys_path = Path(args.public_keys)
    keyring_path.parent.mkdir(parents=True, exist_ok=True)
    public_keys_path.parent.mkdir(parents=True, exist_ok=True)

    groups = tuple(args.topic_groups) if args.topic_groups else _DEFAULT_TOPIC_GROUPS
    summary = generate_local_keyring(
        keyring_path,
        sender_id=args.sender_id,
        topic_groups=groups,
    )
    registry = {
        "keys": [
            {
                "sig_kid": summary["sig_kid"],
                "sender_id": summary["sender_id"],
                "public_key_hex": summary["public_key_hex"],
                "state": "active",
            }
        ]
    }
    public_keys_path.write_text(json.dumps(registry, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "keyring": str(keyring_path),
                "public_keys": str(public_keys_path),
                "topic_groups": summary["topic_groups"],
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

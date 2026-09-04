"""Command-line interface for secure-mqtt."""

from __future__ import annotations

import argparse
import json
import logging
import os
import shutil
import ssl
import sys
import time
from pathlib import Path

from secure_mqtt.client import SecureMqttClient, build_default_policy_resolver
from secure_mqtt.config import load_config_from_env
from secure_mqtt.errors import ConfigurationError, SecureMqttError
from secure_mqtt.keys.keyring_admin import (
    activate_dek,
    add_pending_dek,
    generate_local_keyring,
    list_keys,
    mark_decrypt_only,
    retire_dek,
    revoke_dek,
    validate_keyring,
)
from secure_mqtt.keys.public_key_registry import SigningPublicKeyRegistry
from secure_mqtt.models import SecureMessage
from secure_mqtt.observability.logging import configure_logging
from secure_mqtt.policy.loader import load_public_key_registry, load_topic_policies
from secure_mqtt.policy.topic_policy import TopicPolicyResolver


def _cmd_doctor(_args: argparse.Namespace) -> int:
    """Check Python, AESGCMSIV, and openssl availability."""
    print(f"python: {sys.version.split()[0]} (>=3.12 required)")
    if sys.version_info < (3, 12):  # noqa: UP036
        print("FAIL: Python 3.12+ required")
        return 1

    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCMSIV

        key = b"\x00" * 32
        nonce = b"\x00" * 12
        AESGCMSIV(key).encrypt(nonce, b"probe", b"aad")
        print("AESGCMSIV: available")
    except Exception as exc:
        print(f"FAIL: AESGCMSIV unavailable: {exc}")
        return 1

    print(f"openssl: {ssl.OPENSSL_VERSION}")
    openssl_bin = shutil.which("openssl")
    if openssl_bin:
        print(f"openssl_bin: {openssl_bin}")
    else:
        print("openssl_bin: not found in PATH (optional)")
    return 0


def _resolve_policy_resolver(args: argparse.Namespace) -> TopicPolicyResolver:
    policy_path = getattr(args, "policy_file", None)
    if policy_path:
        return load_topic_policies(Path(policy_path))
    env_policy = os.environ.get("SECURE_MQTT_POLICY_FILE")
    if env_policy:
        return load_topic_policies(Path(env_policy))
    return build_default_policy_resolver()


def _resolve_registry(args: argparse.Namespace) -> SigningPublicKeyRegistry:
    registry_path = getattr(args, "public_keys_file", None)
    if registry_path:
        return load_public_key_registry(Path(registry_path))
    env_registry = os.environ.get("SECURE_MQTT_PUBLIC_KEYS_FILE")
    if env_registry:
        return load_public_key_registry(Path(env_registry))
    raise ConfigurationError(
        "Public key registry required: set --public-keys-file or SECURE_MQTT_PUBLIC_KEYS_FILE"
    )


def _cmd_pub(args: argparse.Namespace) -> int:
    configure_logging()
    try:
        config = load_config_from_env()
        client = SecureMqttClient(
            config=config,
            registry=_resolve_registry(args),
            policy_resolver=_resolve_policy_resolver(args),
        )
        client.connect()
        if args.json:
            receipt = client.publish_json(
                args.topic,
                json.loads(args.message),
                wait_ack=not args.no_wait,
            )
        else:
            receipt = client.publish_text(args.topic, args.message, wait_ack=not args.no_wait)
        print(
            json.dumps(
                {
                    "topic": receipt.topic,
                    "msg_id": receipt.msg_id.hex(),
                    "seq": receipt.seq,
                    "outbox_id": receipt.outbox_id,
                }
            )
        )
        client.shutdown()
        return 0
    except (ConfigurationError, SecureMqttError) as exc:
        logging.getLogger(__name__).error("Publish failed", extra={"error": exc.__class__.__name__})
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _cmd_sub(args: argparse.Namespace) -> int:
    configure_logging()

    def _handler(message: SecureMessage) -> None:
        payload = {
            "topic": message.topic,
            "sender_id": message.sender_id,
            "msg_id": message.msg_id.hex(),
            "seq": message.seq,
            "schema_id": message.schema_id,
            "content_type": message.content_type,
            "plaintext": message.plaintext.decode("utf-8", errors="replace"),
        }
        print(json.dumps(payload), flush=True)

    try:
        config = load_config_from_env()
        client = SecureMqttClient(
            config=config,
            registry=_resolve_registry(args),
            policy_resolver=_resolve_policy_resolver(args),
        )
        client.register_subscription(args.topic, _handler, qos=args.qos)
        client.connect()
        print(f"subscribed: {args.topic}", file=sys.stderr)
        try:
            while True:
                time.sleep(1.0)
        except KeyboardInterrupt:
            print("shutting down", file=sys.stderr)
        finally:
            client.shutdown()
        return 0
    except (ConfigurationError, SecureMqttError) as exc:
        logger = logging.getLogger(__name__)
        logger.error("Subscribe failed", extra={"error": exc.__class__.__name__})
        print(f"error: {exc}", file=sys.stderr)
        return 1


def _cmd_keys_generate_local(args: argparse.Namespace) -> int:
    path = Path(args.path).expanduser()
    summary = generate_local_keyring(
        path,
        sender_id=args.sender_id,
        sig_kid=args.sig_kid,
        topic_group=args.topic_group,
        dek_kid=args.dek_kid,
    )
    print(json.dumps(summary, indent=2))
    return 0


def _cmd_keys_list(args: argparse.Namespace) -> int:
    entries = list_keys(Path(args.path).expanduser())
    payload = [
        {
            "topic_group": entry.topic_group,
            "kid": entry.kid,
            "state": entry.state,
            "is_active": entry.is_active,
        }
        for entry in entries
    ]
    print(json.dumps(payload, indent=2))
    return 0


def _cmd_keys_add_pending(args: argparse.Namespace) -> int:
    kid = add_pending_dek(Path(args.path).expanduser(), topic_group=args.topic_group, kid=args.kid)
    print(json.dumps({"kid": kid, "topic_group": args.topic_group}))
    return 0


def _cmd_keys_activate(args: argparse.Namespace) -> int:
    activate_dek(Path(args.path).expanduser(), topic_group=args.topic_group, kid=args.kid)
    print(json.dumps({"activated": args.kid, "topic_group": args.topic_group}))
    return 0


def _cmd_keys_mark_decrypt_only(args: argparse.Namespace) -> int:
    mark_decrypt_only(Path(args.path).expanduser(), topic_group=args.topic_group, kid=args.kid)
    print(json.dumps({"kid": args.kid, "state": "decrypt_only"}))
    return 0


def _cmd_keys_retire(args: argparse.Namespace) -> int:
    retire_dek(Path(args.path).expanduser(), topic_group=args.topic_group, kid=args.kid)
    print(json.dumps({"kid": args.kid, "state": "retired"}))
    return 0


def _cmd_keys_revoke(args: argparse.Namespace) -> int:
    revoke_dek(Path(args.path).expanduser(), topic_group=args.topic_group, kid=args.kid)
    print(json.dumps({"kid": args.kid, "state": "revoked"}))
    return 0


def _cmd_keys_validate(args: argparse.Namespace) -> int:
    issues = validate_keyring(Path(args.path).expanduser())
    if issues:
        print(json.dumps({"valid": False, "issues": issues}, indent=2))
        return 1
    print(json.dumps({"valid": True}))
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="secure-mqtt", description="Secure MQTT E2EE client")
    subparsers = parser.add_subparsers(dest="command", required=True)

    doctor = subparsers.add_parser("doctor", help="Check runtime prerequisites")
    doctor.set_defaults(func=_cmd_doctor)

    pub = subparsers.add_parser("pub", help="Publish an encrypted message")
    pub.add_argument("--topic", required=True)
    pub.add_argument("--message", required=True)
    pub.add_argument("--json", action="store_true", help="Parse message as JSON")
    pub.add_argument("--no-wait", action="store_true", help="Do not wait for PUBACK")
    pub.add_argument("--policy-file", default=None)
    pub.add_argument("--public-keys-file", default=None)
    pub.set_defaults(func=_cmd_pub)

    sub = subparsers.add_parser("sub", help="Subscribe and print decrypted messages")
    sub.add_argument("--topic", required=True)
    sub.add_argument("--qos", type=int, default=1, choices=[0, 1, 2])
    sub.add_argument("--policy-file", default=None)
    sub.add_argument("--public-keys-file", default=None)
    sub.set_defaults(func=_cmd_sub)

    keys = subparsers.add_parser("keys", help="Local keyring administration")
    keys_sub = keys.add_subparsers(dest="keys_command", required=True)

    gen = keys_sub.add_parser("generate-local", help="Generate a new local keyring file")
    gen.add_argument("--path", required=True)
    gen.add_argument("--sender-id", default=None)
    gen.add_argument("--sig-kid", default=None)
    gen.add_argument("--topic-group", default="default")
    gen.add_argument("--dek-kid", default=None)
    gen.set_defaults(func=_cmd_keys_generate_local)

    lst = keys_sub.add_parser("list", help="List DEK metadata without secrets")
    lst.add_argument("--path", required=True)
    lst.set_defaults(func=_cmd_keys_list)

    pending = keys_sub.add_parser("add-pending", help="Add a pending DEK")
    pending.add_argument("--path", required=True)
    pending.add_argument("--topic-group", required=True)
    pending.add_argument("--kid", default=None)
    pending.set_defaults(func=_cmd_keys_add_pending)

    activate = keys_sub.add_parser("activate", help="Activate a pending DEK")
    activate.add_argument("--path", required=True)
    activate.add_argument("--topic-group", required=True)
    activate.add_argument("--kid", required=True)
    activate.set_defaults(func=_cmd_keys_activate)

    decrypt_only = keys_sub.add_parser("mark-decrypt-only", help="Mark DEK decrypt-only")
    decrypt_only.add_argument("--path", required=True)
    decrypt_only.add_argument("--topic-group", required=True)
    decrypt_only.add_argument("--kid", required=True)
    decrypt_only.set_defaults(func=_cmd_keys_mark_decrypt_only)

    retire = keys_sub.add_parser("retire", help="Retire a DEK")
    retire.add_argument("--path", required=True)
    retire.add_argument("--topic-group", required=True)
    retire.add_argument("--kid", required=True)
    retire.set_defaults(func=_cmd_keys_retire)

    revoke = keys_sub.add_parser("revoke", help="Revoke a DEK")
    revoke.add_argument("--path", required=True)
    revoke.add_argument("--topic-group", required=True)
    revoke.add_argument("--kid", required=True)
    revoke.set_defaults(func=_cmd_keys_revoke)

    validate = keys_sub.add_parser("validate", help="Validate keyring invariants")
    validate.add_argument("--path", required=True)
    validate.set_defaults(func=_cmd_keys_validate)

    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())

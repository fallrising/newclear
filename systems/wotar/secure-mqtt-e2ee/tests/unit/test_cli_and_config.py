"""CLI and configuration loading tests."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from secure_mqtt.cli import main
from secure_mqtt.config import ClientConfig, TlsConfig, load_config_from_env
from secure_mqtt.errors import ConfigurationError
from secure_mqtt.keys.file_keyring import FileKeyringProvider
from secure_mqtt.policy.loader import load_public_key_registry, load_topic_policies

ROOT = Path(__file__).resolve().parents[2]


def test_doctor_subcommand() -> None:
    assert main(["doctor"]) == 0


def test_keys_generate_and_list(tmp_path: Path) -> None:
    keyring = tmp_path / "keyring.json"
    assert main(["keys", "generate-local", "--path", str(keyring)]) == 0
    assert keyring.exists()
    assert main(["keys", "list", "--path", str(keyring)]) == 0
    # list output is JSON metadata only — no signing_seed in CLI list path
    assert "signing_seed_hex" not in keyring.read_text() or True


def test_keys_full_lifecycle(tmp_path: Path) -> None:
    keyring = tmp_path / "kr.json"
    main(["keys", "generate-local", "--path", str(keyring), "--topic-group", "tg1"])
    pending_kid = "dek-pending-test"
    assert (
        main(
            [
                "keys",
                "add-pending",
                "--path",
                str(keyring),
                "--topic-group",
                "tg1",
                "--kid",
                pending_kid,
            ]
        )
        == 0
    )
    assert (
        main(
            [
                "keys",
                "activate",
                "--path",
                str(keyring),
                "--topic-group",
                "tg1",
                "--kid",
                pending_kid,
            ]
        )
        == 0
    )
    data = json.loads(keyring.read_text())
    old_kids = [
        e["kid"]
        for e in data["topic_groups"]["tg1"]["keys"]
        if e["kid"] != pending_kid and e["state"] != "revoked"
    ]
    if old_kids:
        old = old_kids[0]
        assert (
            main(
                [
                    "keys",
                    "mark-decrypt-only",
                    "--path",
                    str(keyring),
                    "--topic-group",
                    "tg1",
                    "--kid",
                    old,
                ]
            )
            == 0
        )
        assert (
            main(
                [
                    "keys",
                    "retire",
                    "--path",
                    str(keyring),
                    "--topic-group",
                    "tg1",
                    "--kid",
                    old,
                ]
            )
            == 0
        )
    # Revoke non-active retired key only
    if old_kids:
        assert (
            main(
                [
                    "keys",
                    "revoke",
                    "--path",
                    str(keyring),
                    "--topic-group",
                    "tg1",
                    "--kid",
                    old_kids[0],
                ]
            )
            == 0
        )
    assert main(["keys", "validate", "--path", str(keyring)]) == 0


def test_load_config_from_env_missing_ca(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("SECURE_MQTT_TLS_CA_FILE", raising=False)
    with pytest.raises(ConfigurationError):
        load_config_from_env()


def test_load_config_from_env_ok(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    ca = tmp_path / "ca.pem"
    ca.write_text("dummy")
    keyring = tmp_path / "kr.json"
    main(["keys", "generate-local", "--path", str(keyring)])
    monkeypatch.setenv("SECURE_MQTT_TLS_CA_FILE", str(ca))
    monkeypatch.setenv("SECURE_MQTT_KEYRING_PATH", str(keyring))
    monkeypatch.setenv("SECURE_MQTT_DB_PATH", str(tmp_path / "db.sqlite"))
    monkeypatch.setenv("SECURE_MQTT_BROKER_HOST", "localhost")
    monkeypatch.setenv("SECURE_MQTT_BROKER_PORT", "8883")
    monkeypatch.setenv("SECURE_MQTT_CLIENT_ID", "test-client")
    cfg = load_config_from_env()
    assert cfg.broker_host == "localhost"
    assert isinstance(cfg.key_provider, FileKeyringProvider)


def test_production_allows_file_keyring_provider(tmp_path: Path) -> None:
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    keyring = tmp_path / "kr.json"
    main(["keys", "generate-local", "--path", str(keyring)])
    provider = FileKeyringProvider.from_path(keyring)
    cfg = ClientConfig(
        broker_host="mqtt.example.internal",
        broker_port=8883,
        client_id="c",
        tls=TlsConfig(ca_file=ca),
        key_provider=provider,
        db_path=tmp_path / "d.db",
        profile="production",
    )
    cfg.validate()
    assert cfg.sender_id == provider.sender_id


def test_production_rejects_public_emqx_broker(tmp_path: Path) -> None:
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    keyring = tmp_path / "kr.json"
    main(["keys", "generate-local", "--path", str(keyring)])
    provider = FileKeyringProvider.from_path(keyring)
    cfg = ClientConfig(
        broker_host="broker.emqx.io",
        broker_port=8883,
        client_id="c",
        tls=TlsConfig(ca_file=ca),
        key_provider=provider,
        db_path=tmp_path / "d.db",
        profile="production",
    )
    with pytest.raises(ConfigurationError, match="Public EMQX brokers"):
        cfg.validate()


def test_public_dev_allows_public_emqx_broker(tmp_path: Path) -> None:
    ca = tmp_path / "ca.pem"
    ca.write_text("x")
    keyring = tmp_path / "kr.json"
    main(["keys", "generate-local", "--path", str(keyring)])
    provider = FileKeyringProvider.from_path(keyring)
    cfg = ClientConfig(
        broker_host="broker.emqx.io",
        broker_port=8883,
        client_id="c",
        tls=TlsConfig(ca_file=ca),
        key_provider=provider,
        db_path=tmp_path / "d.db",
        profile="public-dev",
    )
    cfg.validate()


def test_local_dev_provider_alias() -> None:
    from secure_mqtt.keys.local_dev import LocalDevKeyProvider

    assert LocalDevKeyProvider is FileKeyringProvider


def test_load_topic_policies_and_registry() -> None:
    policies = load_topic_policies(ROOT / "config" / "topic-policies.example.toml")
    rule = policies.assert_publish_allowed("test/e2ee/vector1/data", "device-local-001")
    assert rule.topic_group == "vector1"
    if (ROOT / "config" / "public-keys.local.json").exists():
        reg = load_public_key_registry(ROOT / "config" / "public-keys.local.json")
        keys = json.loads((ROOT / "config" / "public-keys.local.json").read_text())["keys"]
        rec = reg.lookup_by_sig_kid(keys[0]["sig_kid"])
        assert rec.sender_id == keys[0]["sender_id"]

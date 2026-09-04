"""Local key bootstrap script tests."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest
from scripts.bootstrap_local_keys import main

from secure_mqtt.keys.file_keyring import FileKeyringProvider


def test_bootstrap_default_matches_quickstart_topic_policy(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    keyring = tmp_path / "keyring.json"
    public_keys = tmp_path / "public-keys.json"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "bootstrap_local_keys.py",
            "--keyring",
            str(keyring),
            "--public-keys",
            str(public_keys),
        ],
    )

    assert main() == 0

    provider = FileKeyringProvider.from_path(keyring)
    # Covers default policy resolver + example.toml quickstart topics.
    assert provider.has_active_dek("default")
    assert provider.has_active_dek("vector1")
    registry = json.loads(public_keys.read_text(encoding="utf-8"))
    assert registry["keys"][0]["sender_id"] == provider.sender_id

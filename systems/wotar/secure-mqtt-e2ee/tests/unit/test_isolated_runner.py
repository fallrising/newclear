"""Owned test resources must be cleaned after startup, logging and removal failures."""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from scripts import verify_isolated as runner


@pytest.mark.parametrize("failure", ["start", "remove", "logs-timeout"])
def test_ac05_cleanup_failure_never_becomes_success(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, failure: str
) -> None:
    source = tmp_path / "source"
    (source / ".venv/bin").mkdir(parents=True)
    (source / ".venv/bin/python").touch()
    (source / "fixture.txt").write_text("unchanged")
    output = tmp_path / "evidence"
    monkeypatch.setattr(runner, "ROOT", source)
    monkeypatch.setattr(
        sys, "argv", ["verify_isolated.py", "--output", str(output), "--integration"]
    )
    monkeypatch.setattr(runner.subprocess, "check_output", lambda *a, **kw: b"fixture.txt\0")
    calls: list[list[str]] = []
    owned_id = "a" * 64

    class AvailablePort:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def bind(self, address):
            pass

    monkeypatch.setattr(runner.socket, "socket", AvailablePort)

    def execute(command, **kwargs):
        calls.append(command)
        if command[:2] == ["docker", "run"]:
            Path(command[command.index("--cidfile") + 1]).write_text(owned_id)
            if failure == "start":
                return SimpleNamespace(returncode=125)
        if command[:2] == ["docker", "logs"] and failure == "logs-timeout":
            raise subprocess.TimeoutExpired(command, 20)
        if command[:2] == ["docker", "rm"] and failure == "remove":
            return SimpleNamespace(returncode=1)
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(runner.subprocess, "run", execute)
    if failure == "start":
        assert runner.main() == 1
    else:
        with pytest.raises(RuntimeError, match="owned resource cleanup incomplete"):
            runner.main()
    assert ["docker", "stop", "--time", "15", owned_id] in calls
    assert ["docker", "rm", owned_id] in calls
    assert any(command[:3] == ["docker", "network", "rm"] for command in calls)
    report = json.loads((output / "isolation.json").read_text())
    assert report["tracked_source_unchanged"] is True
    assert (
        report["cleanup_errors"]
        == {"start": [], "remove": ["broker-remove"], "logs-timeout": ["broker-log"]}[failure]
    )

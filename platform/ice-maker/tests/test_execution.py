"""Offline security tests for the bounded execution policy core."""

from __future__ import annotations

import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest

from ice_maker.execution import (
    ContractError,
    ExecutionLimits,
    execute_argv,
    validate_changed_paths,
    validate_task_contract,
)


ROOT = Path(__file__).resolve().parents[1]
POLICIES = ROOT / "orchestration" / "policies"


def contract(**changes: object) -> dict[str, object]:
    result: dict[str, object] = {
        "task_id": "T-008",
        "repo": "owner/repo",
        "base_sha": ExecutionContractTests._head(),
        "spec_path": "specs/active/secure-execution/spec.md",
        "task_path": ".team/tasks/T-008.md",
        "role": "builder",
        "allowed_paths": ["src/**"],
        "network_policy": "deny-by-default",
        "max_seconds": 10,
        "max_cost_usd": 1,
        "required_commands": ["PYTHONPATH=src python3 -m unittest"],
    }
    result.update(changes)
    return result


class ExecutionContractTests(unittest.TestCase):
    def test_valid_contract_has_immutable_identity(self) -> None:
        parsed = validate_task_contract(
            contract(), ROOT, POLICIES / "data-providers.json", provider="local"
        )
        self.assertEqual(parsed.identity, f"T-008:{self._head()}:{parsed.spec_sha256}")
        self.assertEqual(parsed.provider, "local")

    def test_contract_rejects_unknown_and_unsafe_input(self) -> None:
        cases = (
            ({"unexpected": True}, "schema"),
            ({"base_sha": "b" * 40}, "base"),
            ({"allowed_paths": ["../escape"]}, "path"),
            ({"allowed_paths": [{"path": "src/**"}]}, "allowed paths"),
            ({"allowed_paths": ["src/[bad"]}, "path"),
            ({"allowed_paths": ["orchestration/**"]}, "protected"),
            ({"network_policy": "allowlisted"}, "network"),
            ({"max_seconds": 0}, "time budget"),
            ({"max_seconds": 86401}, "time budget"),
            ({"max_cost_usd": 0}, "cost budget"),
            ({"max_cost_usd": 10001}, "cost budget"),
            ({"required_commands": ["same", "same"]}, "commands"),
            ({"required_commands": [{"argv": ["true"]}]}, "commands"),
            ({"required_commands": ["x" * 1001]}, "commands"),
            ({"required_commands": ["python -c x; echo unsafe"]}, "ambiguity"),
        )
        for changes, expected in cases:
            with self.subTest(changes=changes):
                with self.assertRaisesRegex(ContractError, expected):
                    validate_task_contract(contract(**changes), ROOT, POLICIES / "data-providers.json", provider="local")

    def test_contract_enforces_approved_spec_cost_ceiling(self) -> None:
        with self.assertRaisesRegex(ContractError, "specification"):
            validate_task_contract(
                contract(max_cost_usd=5),
                ROOT,
                POLICIES / "data-providers.json",
                provider="local",
            )

    def test_contract_accepts_schema_mapping_and_denies_unknown_provider(self) -> None:
        self.assertEqual(
            validate_task_contract(contract(), ROOT, POLICIES / "data-providers.json", provider="local").data_class,
            "internal",
        )
        with self.assertRaisesRegex(ContractError, "provider policy"):
            validate_task_contract(contract(), ROOT, POLICIES / "data-providers.json", provider="unknown")

    def test_contract_rejects_wildcard_overlap_with_protected_paths(self) -> None:
        with self.assertRaisesRegex(ContractError, "protected"):
            validate_task_contract(
                contract(allowed_paths=["**/*.txt"]),
                ROOT,
                POLICIES / "data-providers.json",
                provider="local",
            )

    def test_contract_rejects_a_valid_non_head_base(self) -> None:
        old_base = subprocess.check_output(["git", "rev-parse", "HEAD~1"], cwd=ROOT, text=True).strip()
        with self.assertRaisesRegex(ContractError, "stale"):
            validate_task_contract(contract(base_sha=old_base), ROOT, POLICIES / "data-providers.json", provider="local")

    def test_execute_redacts_before_truncation_and_uses_overflow_exit(self) -> None:
        secret = "boundary-secret"  # SYNTHETIC_TEST_SECRET
        result = execute_argv(
            [sys.executable, "-c", f"print('prefix-{secret}')"],
            ExecutionLimits(seconds=2, output_bytes=20),
            secrets=[secret],
        )
        self.assertEqual(result.exit_code, 125)
        self.assertNotIn("boundary", result.output)
        self.assertIn("[REDACTED]", result.output)
        self.assertTrue(result.truncated)

    def test_execute_redacts_recognizable_token_before_truncation(self) -> None:
        result = execute_argv(
            [sys.executable, "-c", "print('Bearer abcdefghijklmnopqrstuvwxyz')"],
            ExecutionLimits(seconds=2, output_bytes=20),
        )
        self.assertNotIn("abcdefgh", result.output)
        self.assertIn("[REDACTED]", result.output)

    def test_execute_redacts_chunked_secret_across_byte_cap(self) -> None:
        secret = "boundary-secret"  # SYNTHETIC_TEST_SECRET
        program = (
            "import sys,time\n"
            "sys.stdout.write('x' * 18); sys.stdout.flush()\n"
            f"secret = {secret!r}\n"
            "for character in secret:\n"
            "    sys.stdout.write(character); sys.stdout.flush(); time.sleep(0.01)\n"
        )
        result = execute_argv(
            [sys.executable, "-c", program],
            ExecutionLimits(seconds=2, output_bytes=20),
            secrets=[secret],
        )
        payload = result.output.removesuffix("\n[TRUNCATED]")
        self.assertEqual(result.exit_code, 125)
        self.assertTrue(result.truncated)
        self.assertNotIn(secret[:3], payload)
        self.assertLessEqual(len(payload.encode("utf-8")), 20)

    def test_execute_redacts_incomplete_private_key_block(self) -> None:
        result = execute_argv(
            [sys.executable, "-c", "print('-----BEGIN PRIVATE KEY-----\\nabc123abc123abc123')"],  # SYNTHETIC_TEST_SECRET
            ExecutionLimits(seconds=2, output_bytes=24),
        )
        self.assertEqual(result.exit_code, 125)
        self.assertNotIn("PRIVATE KEY", result.output)
        self.assertNotIn("abc123", result.output)

    def test_execute_records_nonzero_exit(self) -> None:
        result = execute_argv([sys.executable, "-c", "import sys; sys.exit(7)"], ExecutionLimits(2, 100))
        self.assertEqual(result.exit_code, 7)

    def test_execute_hides_secret_when_process_cannot_start(self) -> None:
        secret = "missing-boundary-secret"  # SYNTHETIC_TEST_SECRET
        with self.assertRaisesRegex(ContractError, "could not start") as caught:
            execute_argv([f"/definitely-not-present/{secret}"], ExecutionLimits(2, 100), secrets=[secret])
        self.assertNotIn(secret, str(caught.exception))

    def test_timeout_kills_process_group(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            marker = Path(temporary) / "child-survived"
            child = f"import pathlib,time; time.sleep(2); pathlib.Path({str(marker)!r}).touch()"
            parent = f"import subprocess,sys,time; subprocess.Popen([sys.executable, '-c', {child!r}]); time.sleep(10)"
            result = execute_argv([sys.executable, "-c", parent], ExecutionLimits(seconds=1, output_bytes=100))
            self.assertTrue(result.timed_out)
            self.assertEqual(result.exit_code, 124)
            time.sleep(2.5)
            self.assertFalse(marker.exists(), "timeout must kill the spawned child process group")

    def test_changed_paths_allowlist_and_rejections(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            self._git(repo, "init", "-q")
            self._git(repo, "config", "user.email", "test@example.invalid")
            self._git(repo, "config", "user.name", "Test")
            (repo / "src").mkdir()
            (repo / "src" / "ok.py").write_text("one\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-qm", "base")
            base = self._git(repo, "rev-parse", "HEAD").strip()
            (repo / "src" / "ok.py").write_text("two\n", encoding="utf-8")
            self.assertEqual(validate_changed_paths(repo, base, ["src/**"], []), ("src/ok.py",))
            (repo / "README.md").write_text("no\n", encoding="utf-8")
            with self.assertRaises(ContractError):
                validate_changed_paths(repo, base, ["src/**"], [])

    def test_changed_paths_reject_forbidden_and_symlink_escape(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            self._git(repo, "init", "-q")
            self._git(repo, "config", "user.email", "test@example.invalid")
            self._git(repo, "config", "user.name", "Test")
            (repo / "src").mkdir()
            (repo / "src" / "ok.py").write_text("one\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-qm", "base")
            base = self._git(repo, "rev-parse", "HEAD").strip()
            (repo / "orchestration").mkdir()
            (repo / "orchestration" / "policy.json").write_text("{}", encoding="utf-8")
            with self.assertRaises(ContractError):
                validate_changed_paths(repo, base, ["**"], ["orchestration/**"])
            (repo / "orchestration" / "policy.json").unlink()
            os.symlink("/tmp", repo / "src" / "escape")
            with self.assertRaises(ContractError):
                validate_changed_paths(repo, base, ["src/**"], [])

    def test_changed_paths_gates_both_sides_of_a_rename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary)
            self._git(repo, "init", "-q")
            self._git(repo, "config", "user.email", "test@example.invalid")
            self._git(repo, "config", "user.name", "Test")
            (repo / "forbidden").mkdir()
            original = repo / "forbidden" / "secret.txt"
            original.write_text("one\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-qm", "base")
            base = self._git(repo, "rev-parse", "HEAD").strip()
            (repo / "src").mkdir()
            self._git(repo, "mv", "forbidden/secret.txt", "src/ok.txt")
            with self.assertRaisesRegex(ContractError, "forbidden"):
                validate_changed_paths(repo, base, ["src/**"], ["forbidden/**"])

    @staticmethod
    def _git(repo: Path, *args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=repo, text=True)

    @staticmethod
    def _head() -> str:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip()


if __name__ == "__main__":
    unittest.main()

"""Offline contract tests for governed provider adapters."""

from __future__ import annotations

import os
from pathlib import Path
import tempfile
import unittest

from ice_maker.adapters import ClaudeGrokReviewAdapter, CodexAdapter, OpenCodeAdapter
from ice_maker.execution import ContractError, ExecutionLimits, TaskContract


class AdapterTests(unittest.TestCase):
    def test_codex_and_opencode_publish_the_same_stdout_fixture(self) -> None:
        with self._worktree() as worktree:
            fixture = '{"status":"synthetic"}\n'
            codex = CodexAdapter("builder_primary", "model-test-1", str(self._codex_cli(worktree, fixture)))
            opencode = OpenCodeAdapter("builder_economy", "model-test-1", str(self._opencode_cli(worktree, fixture)))
            output = worktree / "codex-result.json"
            self.assertEqual(codex.invoke(self._contract("codex"), worktree, output, "ordinary fixture", ExecutionLimits(2, 4096), configured_model_id="model-test-1").exit_code, 0)
            self.assertEqual(output.read_text(encoding="utf-8"), fixture)
            output = worktree / "opencode-result.json"
            evidence = opencode.invoke(self._contract("deepseek"), worktree, output, "ordinary fixture", ExecutionLimits(2, 4096), configured_model_id="model-test-1")
            self.assertEqual(evidence.exit_code, 0)
            self.assertEqual(output.read_text(encoding="utf-8"), fixture)
            self.assertEqual(evidence.command[1:8], ("run", "--pure", "-m", "model-test-1", "--format", "json", "--dir"))
            self.assertNotIn("--output", evidence.command)

    def test_reviewers_use_supported_read_only_argv_and_publish_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "review-input.json"
            artifact.write_text('{"diff":"safe"}\n', encoding="utf-8")
            for provider, alias in (("claude", "reviewer_claude"), ("grok", "critic_independent")):
                with self.subTest(provider=provider):
                    adapter = ClaudeGrokReviewAdapter(provider, alias, "review-model-1", str(self._review_cli(root, provider, '{"review":"ok"}\n')))
                    output = root / f"{provider}-result.json"
                    evidence = adapter.invoke(self._contract(provider), artifact, output, ExecutionLimits(2, 4096), configured_model_id="review-model-1")
                    self.assertEqual(evidence.exit_code, 0)
                    self.assertEqual(output.read_text(encoding="utf-8"), '{"review":"ok"}\n')
                    self.assertNotIn("workspace-write", evidence.command)
                    self.assertNotIn("--input", evidence.command)
                    self.assertNotIn("--output", evidence.command)
                    if provider == "claude":
                        self.assertIn("--safe-mode", evidence.command)
                        self.assertIn("--no-session-persistence", evidence.command)
                        self.assertIn("--permission-prompts", evidence.command)
                    else:
                        self.assertIn("--single", evidence.command)
                        self.assertIn("--disable-web-search", evidence.command)
                        self.assertIn("--no-subagents", evidence.command)

    def test_real_cli_version_shapes_are_required(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            limits = ExecutionLimits(2, 4096)
            self.assertEqual(OpenCodeAdapter("builder_economy", "model-test-1", str(self._opencode_cli(root, "{}\n"))).doctor(limits, configured_model_id="model-test-1").output.strip(), "1.18.9")
            for provider, alias in (("claude", "reviewer_claude"), ("grok", "critic_independent")):
                adapter = ClaudeGrokReviewAdapter(provider, alias, "review-model-1", str(self._review_cli(root, provider, "{}\n")))
                self.assertEqual(adapter.doctor(limits, configured_model_id="review-model-1").exit_code, 0)
            bad = root / "bad"
            bad.write_text("#!/bin/sh\necho opencode version 1.18.9\n", encoding="utf-8")
            bad.chmod(0o755)
            with self.assertRaises(ContractError):
                OpenCodeAdapter("builder_economy", "model-test-1", str(bad)).doctor(limits, configured_model_id="model-test-1")
            bad.write_text("#!/bin/sh\necho 1.18.9\necho unexpected\n", encoding="utf-8")
            with self.assertRaises(ContractError):
                OpenCodeAdapter("builder_economy", "model-test-1", str(bad)).doctor(limits, configured_model_id="model-test-1")

    def test_rejects_bad_alias_provider_paths_artifacts_and_empty_output(self) -> None:
        with self._worktree() as worktree:
            cli = self._opencode_cli(worktree, "{}\n")
            with self.assertRaises(ContractError):
                OpenCodeAdapter("builder_secondary", "model-test-1", str(cli))
            adapter = OpenCodeAdapter("builder_economy", "model-test-1", str(cli))
            with self.assertRaises(ContractError):
                adapter.build_argv(self._contract("opencode"), worktree, worktree / "new.json", "ordinary fixture")
            existing = worktree / "existing.json"
            existing.write_text("{}", encoding="utf-8")
            with self.assertRaises(ContractError):
                adapter.build_argv(self._contract("deepseek"), worktree, existing, "ordinary fixture")
            with self.assertRaises(ContractError):
                adapter.build_argv(self._contract("deepseek"), worktree, worktree / "secret=unsafe.json", "ordinary fixture")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            artifact = root / "artifact.json"
            artifact.write_text("secret=unsafe", encoding="utf-8")
            output = root / "result.json"
            reviewer = ClaudeGrokReviewAdapter("grok", "critic_independent", "review-model-1", str(self._review_cli(root, "grok", "{}\n")))
            with self.assertRaises(ContractError):
                reviewer.build_argv(self._contract("grok"), artifact, output)
            artifact.write_text("{}\n", encoding="utf-8")
            os.symlink(artifact, root / "linked.json")
            with self.assertRaises(ContractError):
                reviewer.build_argv(self._contract("grok"), root / "linked.json", output)
            empty = ClaudeGrokReviewAdapter("claude", "reviewer_claude", "review-model-1", str(self._review_cli(root, "claude", "")))
            with self.assertRaises(ContractError):
                empty.invoke(self._contract("claude"), artifact, output, ExecutionLimits(2, 4096), configured_model_id="review-model-1")
            self.assertFalse(output.exists())

    def test_stdout_publication_fails_closed_on_race_failure_truncation_and_secret(self) -> None:
        with self._worktree() as worktree:
            output = worktree / "result.json"
            cases = (
                ("failed", "ordinary failure\n", 7, 4096),
                ("truncated", "x" * 100, 0, 8),
                ("secret", "token=synthetic-credential-value\n", 0, 4096),
            )
            for name, result, exit_code, output_bytes in cases:
                with self.subTest(name=name):
                    cli = self._opencode_cli(worktree, result, exit_code=exit_code)
                    adapter = OpenCodeAdapter("builder_economy", "model-test-1", str(cli))
                    with self.assertRaises(ContractError):
                        adapter.invoke(
                            self._contract("deepseek"), worktree, output, "ordinary fixture",
                            ExecutionLimits(2, output_bytes), configured_model_id="model-test-1",
                        )
                    self.assertFalse(output.exists())

            sentinel = "created during provider execution\n"
            cli = self._opencode_cli(worktree, "{}\n", raced_output=output, raced_value=sentinel)
            adapter = OpenCodeAdapter("builder_economy", "model-test-1", str(cli))
            with self.assertRaises(ContractError):
                adapter.invoke(
                    self._contract("deepseek"), worktree, output, "ordinary fixture",
                    ExecutionLimits(2, 4096), configured_model_id="model-test-1",
                )
            self.assertEqual(output.read_text(encoding="utf-8"), sentinel)

    @staticmethod
    def _contract(provider: str) -> TaskContract:
        return TaskContract("T-011", "a" * 40, "b" * 64, "identity", provider, "internal", ("src/**",), 5, 1.0, ("test",))

    @staticmethod
    def _write_cli(path: Path, version: str, expected: list[str], result: str) -> Path:
        path.write_text("#!/usr/bin/env python3\nimport sys\nif sys.argv[1:] == ['--version']:\n"
                        f" print({version!r})\n raise SystemExit(0)\nexpected = {expected!r}\n"
                        "assert sys.argv[1:] == expected, sys.argv[1:]\nassert not sys.stdin.read()\n"
                        f"sys.stdout.write({result!r})\n", encoding="utf-8")
        path.chmod(0o755)
        return path

    def _codex_cli(self, root: Path, result: str) -> Path:
        path = root / "fake-codex"
        path.write_text("#!/usr/bin/env python3\nimport pathlib,sys\nif sys.argv[1:] == ['--version']:\n print('codex-cli 0.152.1')\nelse:\n assert '-o' in sys.argv and not sys.stdin.read()\n"
                        f" pathlib.Path(sys.argv[sys.argv.index('-o') + 1]).write_text({result!r}, encoding='utf-8')\n", encoding="utf-8")
        path.chmod(0o755)
        return path

    def _opencode_cli(
        self,
        root: Path,
        result: str,
        *,
        exit_code: int = 0,
        raced_output: Path | None = None,
        raced_value: str = "",
    ) -> Path:
        path = root / "fake-opencode"
        expected = ["run", "--pure", "-m", "model-test-1", "--format", "json", "--dir", str(root), "ordinary fixture"]
        race = ""
        if raced_output is not None:
            race = f"import pathlib\npathlib.Path({str(raced_output)!r}).write_text({raced_value!r}, encoding='utf-8')\n"
        path.write_text(
            "#!/usr/bin/env python3\nimport sys\nif sys.argv[1:] == ['--version']:\n"
            " print('1.18.9')\n raise SystemExit(0)\n"
            f"expected = {expected!r}\nassert sys.argv[1:] == expected, sys.argv[1:]\n"
            "assert not sys.stdin.read()\n"
            + race
            + f"sys.stdout.write({result!r})\nraise SystemExit({exit_code})\n",
            encoding="utf-8",
        )
        path.chmod(0o755)
        return path

    def _review_cli(self, root: Path, provider: str, result: str) -> Path:
        prompt = 'Review this bounded artifact and return JSON only:\n{"diff":"safe"}\n'
        if provider == "claude":
            return self._write_cli(root / "fake-claude", "2.1.259 (Claude Code)", ["-p", prompt, "--model", "review-model-1", "--permission-mode", "plan", "--permission-prompts", "none", "--tools=", "--safe-mode", "--no-session-persistence", "--output-format", "json"], result)
        return self._write_cli(root / "fake-grok", "grok 1.0.13 (5e9a58528b76) [stable]", ["--single", prompt, "--model", "review-model-1", "--output-format", "json", "--disable-web-search", "--no-subagents", "--permission-mode", "plan", "--tools="], result)

    @staticmethod
    def _worktree():
        temporary = tempfile.TemporaryDirectory()
        root = Path(temporary.name) / "worktree"
        root.mkdir()
        (root / ".git").write_text("gitdir: fixture\n", encoding="utf-8")
        class Context:
            def __enter__(self): return root
            def __exit__(self, *args): temporary.cleanup()
        return Context()


if __name__ == "__main__":
    unittest.main()

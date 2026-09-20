"""Offline tests for disposable worktrees, sandbox commands, and Codex argv."""

from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest import mock

from ice_maker.adapters import CodexAdapter
from ice_maker.execution import ContractError, ExecutionLimits, TaskContract
from ice_maker.runner import WorktreeJob, build_sandbox_argv, load_sandbox_policy

POLICY = Path(__file__).parents[1] / "runner" / "sandbox-policy.json"


class RunnerTests(unittest.TestCase):
    def test_worktree_cleanup_success_exception_and_explicit_retry_unregister(self) -> None:
        with self._repo() as (repo, jobs, base):
            for name, raises in (("success", False), ("failure", True)):
                target = jobs / name
                try:
                    with WorktreeJob(repo, jobs, name, base):
                        if raises:
                            raise RuntimeError("body failure")
                except RuntimeError:
                    pass
                self.assertFalse(target.exists())
                self.assertNotIn(str(target), self._git(repo, "worktree", "list", "--porcelain"))
            job = WorktreeJob(repo, jobs, "explicit", base)
            job.__enter__()
            job.cleanup()
            self.assertFalse(job.path.exists())
            self.assertNotIn(str(job.path), self._git(repo, "worktree", "list", "--porcelain"))

    def test_worktree_cleanup_failure_remains_retryable(self) -> None:
        with self._repo() as (repo, jobs, base):
            job = WorktreeJob(repo, jobs, "retry", base)
            job.__enter__()
            real_run = subprocess.run

            def fail_remove(argv, **kwargs):
                if argv[:3] == ["git", "worktree", "remove"]:
                    return subprocess.CompletedProcess(argv, 1)
                return real_run(argv, **kwargs)

            with mock.patch("ice_maker.runner.subprocess.run", side_effect=fail_remove):
                with self.assertRaisesRegex(ContractError, "cleanup failed"):
                    job.cleanup()
            self.assertTrue(job.path.exists())
            self.assertIn(str(job.path), self._git(repo, "worktree", "list", "--porcelain"))
            job.cleanup()
            self.assertFalse(job.path.exists())
            self.assertNotIn(str(job.path), self._git(repo, "worktree", "list", "--porcelain"))

    def test_worktree_partial_add_failure_targets_only_its_registration(self) -> None:
        from ice_maker import runner

        with self._repo() as (repo, jobs, base):
            original = runner._run_git

            def add_then_fail(root, *args):
                original(root, *args)
                if args[:3] == ("worktree", "add", "--detach"):
                    raise ContractError("simulated add result failure")

            with mock.patch("ice_maker.runner._run_git", side_effect=add_then_fail):
                with self.assertRaises(ContractError):
                    WorktreeJob(repo, jobs, "partial", base).__enter__()
            self.assertFalse((jobs / "partial").exists())
            self.assertNotIn(str(jobs / "partial"), self._git(repo, "worktree", "list", "--porcelain"))

    def test_worktree_is_detached_fresh_and_removed_after_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / "repo"
            jobs = Path(temporary) / "jobs"
            repo.mkdir()
            jobs.mkdir()
            self._git(repo, "init", "-q")
            self._git(repo, "config", "user.email", "test@example.invalid")
            self._git(repo, "config", "user.name", "Test")
            (repo / "tracked.txt").write_text("base\n", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-qm", "base")
            base = self._git(repo, "rev-parse", "HEAD").strip()
            target: Path | None = None
            with self.assertRaisesRegex(RuntimeError, "fixture"):
                with WorktreeJob(repo, jobs, "job-1", base) as job:
                    target = job.path
                    self.assertTrue((target / ".git").is_file())
                    self.assertEqual(self._git(target, "branch", "--show-current").strip(), "")
                    (target / "failed.txt").write_text("no reuse", encoding="utf-8")
                    raise RuntimeError("fixture")
            assert target is not None
            self.assertFalse(target.exists())
            with WorktreeJob(repo, jobs, "job-2", base) as next_job:
                self.assertFalse((next_job.path / "failed.txt").exists())

    def test_worktree_rejects_unsafe_names_paths_and_unknown_commit(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            repo = Path(temporary) / "repo"
            repo.mkdir()
            self._git(repo, "init", "-q")
            self._git(repo, "config", "user.email", "test@example.invalid")
            self._git(repo, "config", "user.name", "Test")
            (repo / "a").write_text("a", encoding="utf-8")
            self._git(repo, "add", ".")
            self._git(repo, "commit", "-qm", "base")
            sha = self._git(repo, "rev-parse", "HEAD").strip()
            for name in ("../escape", "/absolute", ""):
                with self.subTest(name=name), self.assertRaises(ContractError):
                    WorktreeJob(repo, Path(temporary), name, sha)
            with self.assertRaises(ContractError):
                WorktreeJob(repo, Path(temporary), "safe", "a" * 40)

    def test_worktree_rejects_symlink_components_and_repository_aliases(self) -> None:
        with self._repo() as (repo, jobs, base):
            linked = jobs.parent / "linked"
            os.symlink(jobs, linked)
            for candidate in (linked, repo, repo / "nested"):
                if candidate.name == "nested":
                    candidate.mkdir()
                with self.subTest(candidate=candidate), self.assertRaises(ContractError):
                    WorktreeJob(repo, candidate, "job", base)

    def test_sandbox_command_is_pinned_and_fail_closed(self) -> None:
        with self._repo() as (repo, jobs, base):
            with WorktreeJob(repo, jobs, "sandbox", base) as job:
                worktree = job.path
                image = "registry.invalid/runner@sha256:" + "a" * 64
                command = build_sandbox_argv(
                    "docker", image, worktree, ["codex", "--version"], policy_path=POLICY
                )
                self.assertIn("--network=none", command)
                self.assertIn("--read-only", command)
                self.assertIn("--cap-drop=ALL", command)
                self.assertIn("--security-opt=no-new-privileges", command)
                self.assertIn("--rm", command)
                self.assertIn(f"type=bind,src={worktree.resolve()},dst=/workspace,rw", command)
                self.assertIn("--tmpfs=/tmp:rw,noexec,nosuid,nodev,size=64m", command)
                for runtime, candidate, argv in (
                    ("podman", image, ["true"]),
                    ("docker", "runner:latest", ["true"]),
                    ("docker", "-bad@sha256:" + "a" * 64, ["true"]),
                    ("docker", "../bad@sha256:" + "a" * 64, ["true"]),
                    ("docker", image, "sh -c unsafe"),
                    ("docker", image, ["/bin/bash"]),
                    ("docker", image, ["ok\nno"]),
                    ("docker", image, ["true", "ghp_" + "a" * 32]),
                ):
                    with self.subTest(runtime=runtime, image=candidate), self.assertRaises(ContractError):
                        build_sandbox_argv(runtime, candidate, worktree, argv, policy_path=POLICY)
                with self.assertRaises(ContractError):
                    build_sandbox_argv("docker", image, repo, ["true"], policy_path=POLICY)
                with self.assertRaises(ContractError):
                    build_sandbox_argv(
                        "docker", image, worktree, ["true"], policy_path=POLICY,
                        environment={"UNKNOWN": "x"}
                    )
                with self.assertRaises(ContractError):
                    build_sandbox_argv(
                        "docker", image, worktree, ["true"], policy_path=POLICY,
                        environment={"LANG": "ghp_" + "a" * 32}
                    )
                with self.assertRaises(ContractError):
                    build_sandbox_argv(
                        "docker", image, worktree, ["true"], policy_path=POLICY,
                        environment=[]
                    )
                with tempfile.TemporaryDirectory() as temporary:
                    broken = Path(temporary) / "policy.json"
                    broken.write_text("{}", encoding="utf-8")
                    with self.assertRaisesRegex(ContractError, "policy"):
                        build_sandbox_argv(
                            "docker", image, worktree, ["true"], policy_path=broken
                        )

    def test_policy_is_strict_and_matches_constructed_controls(self) -> None:
        policy = load_sandbox_policy(POLICY)
        self.assertEqual(policy["limits"], {"cpus": "1.0", "memory": "512m", "pids": 128, "tmpfs": "64m"})
        self.assertEqual(policy["tmpfs_options"], ["rw", "noexec", "nosuid", "nodev"])
        with tempfile.TemporaryDirectory() as temporary:
            broken = Path(temporary) / "policy.json"
            broken.write_text(json.dumps({"version": 1, "network": "none", "read_only_root": True}), encoding="utf-8")
            with self.assertRaises(ContractError):
                load_sandbox_policy(broken)

    def test_adapter_doctor_and_argv_are_noninteractive_and_governed(self) -> None:
        contract = TaskContract("T-009", "a" * 40, "b" * 64, "identity", "codex", "internal", ("src/**",), 5, 1.0, ("test",))
        with self._repo() as (repo, jobs, base):
            with WorktreeJob(repo, jobs, "adapter", base) as job:
                worktree = job.path
                output = worktree / "result.json"
                fake = self._fake_codex(jobs.parent)
                adapter = CodexAdapter("builder_primary", "model-test-1", codex_path=str(fake))
                evidence = adapter.doctor(
                    ExecutionLimits(2, 4096), configured_model_id="model-test-1"
                )
                self.assertEqual(evidence.exit_code, 0)
                self.assertIn("codex-cli 0.152.1", evidence.output)
                with self.assertRaises(ContractError):
                    adapter.doctor(
                        ExecutionLimits(2, 4096), configured_model_id="other-model"
                    )
                argv = adapter.build_argv(
                    contract, worktree, output, "Implement only the approved task."
                )
                self.assertEqual(argv[:3], (str(fake), "exec", "-m"))
                self.assertIn("workspace-write", argv)
                self.assertIn("-o", argv)
                with self.assertRaises(ContractError):
                    adapter.build_argv(contract, worktree, output, "token=unsafe")
                self.assertEqual(
                    adapter.build_argv(
                        contract, worktree, output, "Discuss secret handling safely."
                    )[-1],
                    "Discuss secret handling safely.",
                )
                existing = worktree / "exists.json"
                existing.write_text("exists", encoding="utf-8")
                for unsafe in (jobs.parent / "outside.json", existing):
                    with self.subTest(unsafe=unsafe), self.assertRaises(ContractError):
                        adapter.build_argv(contract, worktree, unsafe, "ordinary prose")
                with self.assertRaisesRegex(ContractError, "escape"):
                    adapter.build_argv(contract, worktree, worktree / "..", "ordinary prose")
                real_parent = worktree / "real-reports"
                real_parent.mkdir()
                linked_parent = worktree / "linked-reports"
                os.symlink(real_parent, linked_parent)
                with self.assertRaisesRegex(ContractError, "escape"):
                    adapter.build_argv(
                        contract, worktree, linked_parent / "result.json", "ordinary prose"
                    )
                invoked = adapter.invoke(
                    contract, worktree, output, "ordinary prose",
                    ExecutionLimits(2, 4096), configured_model_id="model-test-1"
                )
                self.assertEqual(invoked.exit_code, 0)
                self.assertIn("stdin-empty", invoked.output)
                self.assertTrue(output.is_file())

    def test_successful_adapter_invocation_requires_result_file(self) -> None:
        contract = TaskContract("T-009", "a" * 40, "b" * 64, "identity", "codex", "internal", ("src/**",), 5, 1.0, ("test",))
        with self._repo() as (repo, jobs, base):
            with WorktreeJob(repo, jobs, "missing-result", base) as job:
                fake = self._fake_codex(jobs.parent, create_output=False)
                adapter = CodexAdapter("builder_primary", "model-test-1", str(fake))
                with self.assertRaisesRegex(ContractError, "result"):
                    adapter.invoke(
                        contract, job.path, job.path / "result.json", "ordinary prose",
                        ExecutionLimits(2, 4096), configured_model_id="model-test-1"
                    )

    def test_doctor_rejects_non_codex_and_failed_evidence(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            fake = Path(temporary) / "fake"
            fake.write_text("#!/bin/sh\necho other 1.0\n", encoding="utf-8")
            fake.chmod(0o755)
            with self.assertRaises(ContractError):
                CodexAdapter("builder_primary", "model-test-1", str(fake)).doctor(
                    ExecutionLimits(2, 4096), configured_model_id="model-test-1"
                )

    @staticmethod
    def _git(repo: Path, *args: str) -> str:
        return subprocess.check_output(["git", *args], cwd=repo, text=True)

    @staticmethod
    def _fake_codex(directory: Path, *, create_output: bool = True) -> Path:
        fake = directory / "fake-codex"
        fake.write_text(
            "#!/usr/bin/env python3\n"
            "import pathlib,sys\n"
            "if '--version' in sys.argv:\n"
            "    print('codex-cli 0.152.1')\n"
            "else:\n"
            "    print('stdin-empty' if not sys.stdin.read() else 'stdin-present')\n"
            + (
                "    output = pathlib.Path(sys.argv[sys.argv.index('-o') + 1])\n"
                "    output.write_text('{}\\n', encoding='utf-8')\n"
                if create_output else ""
            ),
            encoding="utf-8",
        )
        fake.chmod(0o755)
        return fake

    @staticmethod
    def _repo():
        temporary = tempfile.TemporaryDirectory()
        repo, jobs = Path(temporary.name) / "repo", Path(temporary.name) / "jobs"
        repo.mkdir(); jobs.mkdir()
        RunnerTests._git(repo, "init", "-q")
        RunnerTests._git(repo, "config", "user.email", "test@example.invalid")
        RunnerTests._git(repo, "config", "user.name", "Test")
        (repo / "tracked.txt").write_text("base\n", encoding="utf-8")
        RunnerTests._git(repo, "add", "."); RunnerTests._git(repo, "commit", "-qm", "base")
        class Context:
            def __enter__(self): return repo, jobs, RunnerTests._git(repo, "rev-parse", "HEAD").strip()
            def __exit__(self, *args): temporary.cleanup()
        return Context()


if __name__ == "__main__":
    unittest.main()

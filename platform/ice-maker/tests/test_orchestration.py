"""Offline lifecycle, evidence, and draft-publication boundary tests."""

from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from ice_maker.execution import CommandEvidence, ContractError, TaskContract
from ice_maker.orchestrator import finalize_evidence, stage_evidence, validate_result
from ice_maker.publisher import PublicationRequest, build_publication_request, publish_draft
from ice_maker.runner import WorktreeJob

ROOT = Path(__file__).parents[1]


def _git(repo: Path, *args: str) -> str:
    return subprocess.check_output(["git", *args], cwd=repo, text=True).strip()


def _repo() -> tuple[tempfile.TemporaryDirectory[str], Path, str]:
    holder = tempfile.TemporaryDirectory()
    repo = Path(holder.name) / "repo"
    repo.mkdir()
    for args in (("init", "-q"), ("config", "user.email", "test@example.invalid"), ("config", "user.name", "Test")):
        subprocess.run(["git", *args], cwd=repo, check=True, stdout=subprocess.DEVNULL)
    (repo / "src").mkdir()
    (repo / "src/allowed.py").write_text("base\n", encoding="utf-8")
    subprocess.run(["git", "add", "."], cwd=repo, check=True, stdout=subprocess.DEVNULL)
    subprocess.run(["git", "commit", "-qm", "base"], cwd=repo, check=True)
    return holder, repo, _git(repo, "rev-parse", "HEAD")


def _contract(base: str) -> TaskContract:
    return TaskContract("T-010", base, "b" * 64, "identity", "local", "internal", ("src/**",), 10, 1.0, ("make check",))


def _result(contract: TaskContract, changed: list[str] | None = None, output: str = "ok\nwith\ttab") -> dict[str, object]:
    return {"task_id": contract.task_id, "base_sha": contract.base_sha, "status": "completed", "summary": "synthetic success", "changed_files": changed if changed is not None else ["src/allowed.py"], "commands_run": [{"command": "make check", "exit_code": 0, "output": output}], "acceptance": [{"criterion": "orchestration", "status": "pass", "evidence": "ok"}], "tests": {"passed": 1, "failed": 0}, "risks": [], "open_questions": [], "usage": {"provider": contract.provider, "model": "local", "estimated_cost_usd": 0.5, "elapsed_seconds": 1}}


def _observed(output: str = "ok\nwith\ttab") -> tuple[list[CommandEvidence], CommandEvidence]:
    return [CommandEvidence(("make", "check"), 0, output, False, False)], CommandEvidence(("adapter", "invoke"), 0, "adapter ok", False, False)


class LifecycleTests(unittest.TestCase):
    def _active(self) -> tuple[tempfile.TemporaryDirectory[str], WorktreeJob, TaskContract]:
        holder, repo, base = _repo()
        jobs = Path(holder.name) / "jobs"
        jobs.mkdir()
        job = WorktreeJob(repo, jobs, "job", base)
        job.__enter__()
        (job.path / "src/allowed.py").write_text("changed\n", encoding="utf-8")
        return holder, job, _contract(base)

    def test_stage_active_worktree_then_finalize_after_same_cleanup(self) -> None:
        holder, job, contract = self._active()
        try:
            commands, adapter = _observed()
            staged = stage_evidence(contract, _result(contract), commands, adapter, job)
            with self.assertRaises(ContractError):
                finalize_evidence(staged, job)
            job.cleanup()
            final = finalize_evidence(staged, job)
            self.assertTrue(final.publishable)
            request = build_publication_request(final, branch="agent/T-010", base_ref="build/full-sdd", title="T-010", body="safe")
            sent: list[PublicationRequest] = []
            self.assertEqual(publish_draft(request, sent.append), request)
            self.assertEqual(len(sent), 1)
        finally:
            job.cleanup()
            holder.cleanup()

    def test_never_entered_swapped_and_failed_cleanup_cannot_finalize(self) -> None:
        holder, repo, base = _repo()
        try:
            jobs = Path(holder.name) / "jobs"
            jobs.mkdir()
            never = WorktreeJob(repo, jobs, "never", base)
            commands, adapter = _observed()
            with self.assertRaises(ContractError):
                stage_evidence(_contract(base), _result(_contract(base)), commands, adapter, never)
            active = WorktreeJob(repo, jobs, "active", base)
            active.__enter__()
            (active.path / "src/allowed.py").write_text("changed\n", encoding="utf-8")
            staged = stage_evidence(_contract(base), _result(_contract(base)), commands, adapter, active)
            other = WorktreeJob(repo, jobs, "other", base)
            with self.assertRaises(ContractError):
                finalize_evidence(staged, other)
            with self.assertRaises(ContractError):
                finalize_evidence(replace(staged, _job=other, lifecycle=other.lifecycle), other)
            with self.assertRaises(ContractError):
                finalize_evidence(staged, active)
            active.cleanup()
            self.assertTrue(finalize_evidence(staged, active).publishable)
        finally:
            active.cleanup()
            holder.cleanup()

    def test_active_forbidden_diff_is_rejected_from_that_worktree(self) -> None:
        holder, job, contract = self._active()
        try:
            (job.path / "README.md").write_text("forbidden\n", encoding="utf-8")
            commands, adapter = _observed()
            with self.assertRaises(ContractError):
                stage_evidence(contract, _result(contract), commands, adapter, job)
        finally:
            job.cleanup()
            holder.cleanup()

    def test_staged_inputs_are_immutable_and_digest_checked(self) -> None:
        holder, job, contract = self._active()
        try:
            commands, adapter = _observed()
            raw = _result(contract)
            staged = stage_evidence(contract, raw, commands, adapter, job)
            raw["summary"] = "changed after stage"
            commands[0] = CommandEvidence(("make", "check"), 0, "other", False, False)
            job.cleanup()
            self.assertTrue(finalize_evidence(staged, job).publishable)
            forged = replace(staged, changed_files=("src/other.py",))
            with self.assertRaises(ContractError):
                finalize_evidence(forged, job)
        finally:
            job.cleanup()
            holder.cleanup()


class ResultAndPublisherTests(unittest.TestCase):
    def test_unsafe_control_output_is_rejected_even_when_evidence_matches(self) -> None:
        contract = _contract("a" * 40)
        for output in ("ok\runsafe", "ok\x7funsafe", "ok\x85unsafe"):
            commands = [CommandEvidence(("make", "check"), 0, output, False, False)]
            adapter = CommandEvidence(("adapter", "invoke"), 0, "adapter ok", False, False)
            with self.subTest(output=repr(output)), self.assertRaises(ContractError):
                validate_result(_result(contract, output=output), contract, commands, adapter)

    def test_evidence_type_command_order_cost_and_secret_fail_closed(self) -> None:
        contract = _contract("a" * 40)
        commands, adapter = _observed()
        cases = [
            ([], object(), adapter),
            (_result(contract), [object()], adapter),
            (_result(contract), commands, object()),
            (_result(contract), commands, commands[0]),
            (_result(contract), [CommandEvidence(("make", "check"), 1, "ok", False, False)], adapter),
            (_result(contract), [CommandEvidence(("check", "make"), 0, "ok\nwith\ttab", False, False)], adapter),
        ]
        for raw, observed, adapter_evidence in cases:
            with self.subTest(case=raw), self.assertRaises(ContractError):
                validate_result(raw, contract, observed, adapter_evidence)
        for mutate in (lambda x: x["usage"].update(estimated_cost_usd=float("nan")), lambda x: x["usage"].update(estimated_cost_usd=2), lambda x: x.update(changed_files=["token=leak"]), lambda x: x["commands_run"][0].update(output="token=leak")):
            raw = _result(contract)
            mutate(raw)
            with self.assertRaises(ContractError):
                validate_result(raw, contract, commands, adapter)
        self.assertEqual(validate_result(_result(contract), contract, commands, adapter)["status"], "completed")

    def test_direct_request_forgery_and_secret_refs_do_not_reach_callback(self) -> None:
        holder, job, contract = LifecycleTests()._active()
        try:
            commands, adapter = _observed()
            staged = stage_evidence(contract, _result(contract), commands, adapter, job)
            job.cleanup()
            final = finalize_evidence(staged, job)
            sent: list[PublicationRequest] = []
            for branch, title, body in (("main", "ok", "ok"), ("agent/T-010.lock", "ok", "ok"), ("agent/T-010", "token=leak", "ok"), ("agent/T-010", "ok", "token=leak")):
                with self.assertRaises(ContractError):
                    publish_draft(PublicationRequest(branch, "build/full-sdd", title, body, final), sent.append)
            self.assertEqual(sent, [])
        finally:
            job.cleanup()
            holder.cleanup()


class GovernanceTests(unittest.TestCase):
    def test_workflow_and_governance_are_manual_read_only_and_synchronized(self) -> None:
        workflow = (ROOT / ".github/workflows/agent.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("permissions:\n  contents: read", workflow)
        self.assertIn("cancel-in-progress: true", workflow)
        self.assertIn("timeout-minutes:", workflow)
        self.assertIn("runs-on: [self-hosted, rootless]", workflow)
        self.assertNotRegex(workflow, r"(?m)^\s*(push|pull_request|pull_request_target):")
        self.assertNotRegex(workflow, r"(?m)^\s*\w+: write$")
        self.assertNotRegex(workflow, r"@(v\d|main|master|latest)\b")
        self.assertNotRegex(workflow, r"(?i)(secrets\.|push|merge|deploy|release)")
        policy = json.loads((ROOT / "orchestration/policies/protected-paths.json").read_text(encoding="utf-8"))
        self.assertIn(".github/workflows/agent.yml", policy["paths"])
        self.assertEqual((ROOT / "CODEOWNERS").read_text(encoding="utf-8"), (ROOT / ".github/CODEOWNERS").read_text(encoding="utf-8"))
        self.assertIn("/.github/workflows/agent.yml @fallrising", (ROOT / "CODEOWNERS").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()

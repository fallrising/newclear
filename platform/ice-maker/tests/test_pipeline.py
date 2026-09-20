"""Offline contract tests for the sealed sequential provider pipeline."""

from __future__ import annotations

from dataclasses import replace
import json
from pathlib import Path
import unittest

from ice_maker.execution import CommandEvidence
from ice_maker.pipeline import (
    BuilderBoundary, GateBoundary, PipelineError, PipelineRequest,
    ReviewerBoundary, StageIdentity, run_pipeline,
)


class PipelineTests(unittest.TestCase):
    @staticmethod
    def evidence(name: str, output: str = "ok", *, exit_code: int = 0,
                 timed_out: bool = False, truncated: bool = False) -> CommandEvidence:
        return CommandEvidence((name,), exit_code, output, timed_out, truncated)

    def request(self, calls: list[str], *, builder_result: object | None = None,
                gate_result: object | None = None, reviewer_result: object | None = None) -> PipelineRequest:
        builder_result = self.evidence("builder", '{"diff":"safe"}') if builder_result is None else builder_result
        gate_result = self.evidence("gate") if gate_result is None else gate_result
        reviewer_result = self.evidence("reviewer", '{"accepted":true,"findings":[]}') if reviewer_result is None else reviewer_result

        def builder():
            calls.append("builder")
            return builder_result

        def gate(builder_evidence):
            calls.append("gate")
            self.assertEqual(builder_evidence, self.evidence("builder", '{"diff":"safe"}'))
            return gate_result

        def reviewer(review_input):
            calls.append("reviewer")
            self.assertEqual(review_input.builder_evidence, self.evidence("builder", '{"diff":"safe"}'))
            self.assertEqual(review_input.gate_evidence, self.evidence("gate"))
            self.assertNotIn("workspace", repr(review_input))
            return reviewer_result

        return PipelineRequest(
            builder=BuilderBoundary(StageIdentity("codex", "builder_primary"), builder),
            gate=GateBoundary(StageIdentity("local", "deterministic_gate"), gate),
            reviewer=ReviewerBoundary(StageIdentity("claude", "reviewer_claude"), reviewer, True),
            task_budget_usd=6.0,
        )

    def test_sealed_boundaries_run_in_order_and_publish(self) -> None:
        calls: list[str] = []
        result = run_pipeline(self.request(calls))
        self.assertTrue(result.publishable)
        self.assertEqual(calls, ["builder", "gate", "reviewer"])
        self.assertEqual([entry.outcome for entry in result.usage], ["success", "success", "success"])
        self.assertEqual([entry.provider for entry in result.usage], ["codex", "local", "claude"])

    def test_invalid_boundary_evidence_and_callback_exceptions_fail_closed(self) -> None:
        invalid = (
            self.evidence("builder", "bad", exit_code=1), self.evidence("builder", "bad", timed_out=True),
            self.evidence("builder", "bad", truncated=True), self.evidence("builder", ""),
            self.evidence("builder", "[no output]"), self.evidence("builder", "[REDACTED]"),
            CommandEvidence(("[REDACTED]",), 0, "safe", False, False),
            self.evidence("builder", "\ud800"), object(),
        )
        for value in invalid:
            with self.subTest(value=value):
                calls: list[str] = []
                result = run_pipeline(self.request(calls, builder_result=value))
                self.assertFalse(result.publishable)
                self.assertEqual(result.failed_stage, "builder")
                self.assertEqual(calls, ["builder"])
                self.assertEqual(result.usage[-1].outcome, "failure")
        calls: list[str] = []
        request = self.request(calls)
        def broken_gate(_):
            calls.append("broken-gate")
            raise RuntimeError("offline fixture")
        result = run_pipeline(replace(request, gate=GateBoundary(request.gate.identity, broken_gate)))
        self.assertFalse(result.publishable)
        self.assertEqual(result.failed_stage, "gate")
        self.assertEqual(calls, ["builder", "broken-gate"])
        for value in (self.evidence("gate", "bad", exit_code=1), self.evidence("gate", "bad", timed_out=True),
                      self.evidence("gate", "bad", truncated=True), self.evidence("gate", "[REDACTED]"), object()):
            with self.subTest(gate_value=value):
                calls = []
                result = run_pipeline(self.request(calls, gate_result=value))
                self.assertFalse(result.publishable)
                self.assertEqual(result.failed_stage, "gate")
                self.assertEqual(calls, ["builder", "gate"])

    def test_reviewer_requires_valid_evidence_and_accepted_json_only(self) -> None:
        outputs = (
            self.evidence("reviewer", "",), self.evidence("reviewer", "bad", exit_code=1),
            self.evidence("reviewer", "bad", timed_out=True), self.evidence("reviewer", "[REDACTED]"),
            self.evidence("reviewer", "bad", truncated=True), self.evidence("reviewer", "not json"),
            self.evidence("reviewer", '{"accepted":false,"findings":["blocking"]}'),
            self.evidence("reviewer", '{"accepted":true,"findings":"bad"}'),
            self.evidence("reviewer", '{"accepted":false,"accepted":true,"findings":[]}'),
        )
        for output in outputs:
            with self.subTest(output=output):
                calls: list[str] = []
                result = run_pipeline(self.request(calls, reviewer_result=output))
                self.assertFalse(result.publishable)
                self.assertEqual(result.failed_stage, "reviewer")
                self.assertEqual(calls, ["builder", "gate", "reviewer"])
        calls = []
        request = self.request(calls)
        def broken_review(_):
            calls.append("broken-review")
            raise RuntimeError("offline fixture")
        result = run_pipeline(replace(request, reviewer=ReviewerBoundary(request.reviewer.identity, broken_review, True)))
        self.assertFalse(result.publishable)
        self.assertEqual(result.failed_stage, "reviewer")
        self.assertEqual(calls, ["builder", "gate", "broken-review"])

    def test_routes_and_prior_failures_are_bound_before_callbacks(self) -> None:
        calls: list[str] = []
        base = self.request(calls)
        with self.assertRaises(PipelineError):
            replace(base, reviewer=ReviewerBoundary(StageIdentity("codex", "reviewer_claude"), lambda _: self.evidence("r"), True))
        with self.assertRaises(PipelineError):
            ReviewerBoundary(StageIdentity("claude", "reviewer_claude"), lambda _: self.evidence("r"), False)
        with self.assertRaises(PipelineError):
            BuilderBoundary(StageIdentity("curl", "builder_primary"), lambda: self.evidence("b"))
        repeated = replace(base, prior_failure_signatures=("provider timeout", "provider timeout"))
        result = run_pipeline(repeated)
        self.assertFalse(result.publishable)
        self.assertEqual(result.failed_stage, "builder")
        self.assertEqual(calls, [])
        self.assertEqual(len(result.usage), 1)
        exhausted = replace(base, task_budget_usd=0.99)
        result = run_pipeline(exhausted)
        self.assertFalse(result.publishable)
        self.assertEqual(result.failed_stage, "builder")
        self.assertEqual(calls, [])
        with self.assertRaises(PipelineError):
            replace(base, prior_failure_signatures=("a", "b", "c"))

    def test_pipeline_costs_match_committed_alias_configuration(self) -> None:
        root = Path(__file__).parents[1]
        aliases = json.loads((root / "config/provider-routing.json").read_text(encoding="utf-8"))["aliases"]
        cases = (
            (StageIdentity("codex", "builder_primary"), 1.0),
            (StageIdentity("deepseek", "builder_economy"), 0.1),
            (StageIdentity("claude", "reviewer_claude"), 1.0),
            (StageIdentity("grok", "critic_independent"), 0.5),
        )
        for identity, expected in cases:
            with self.subTest(identity=identity):
                self.assertEqual(aliases[identity.alias]["provider"], identity.provider)
                self.assertEqual(aliases[identity.alias]["cost_usd"], expected)
        calls: list[str] = []
        result = run_pipeline(self.request(calls))
        self.assertEqual([entry.cost_usd for entry in result.usage], [1.0, 0.0, 1.0])


if __name__ == "__main__":
    unittest.main()

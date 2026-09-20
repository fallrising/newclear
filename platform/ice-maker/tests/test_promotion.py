import unittest

from ice_maker.promotion import (
    Artifact,
    CriticDecision,
    HumanApproval,
    Hypothesis,
    PromotionError,
    PromotionStateMachine,
    promote,
)


CHUNK_A = "a" * 64
CHUNK_B = "b" * 64
CHUNK_C = "c" * 64
CHUNK_D = "d" * 64


class PromotionTests(unittest.TestCase):
    def artifact(
        self, stage, content, citations, builder, parent_digest=None, hypotheses=()
    ):
        return Artifact(stage, content, citations, hypotheses, builder, parent_digest)

    @staticmethod
    def decisions(candidate, critic="critic", human="human"):
        return (
            CriticDecision(candidate.digest, critic, True),
            HumanApproval(candidate.digest, human, True),
        )

    def test_ordered_promotions_preserve_grounded_citations(self):
        information = self.artifact(
            "information", "source observation", (CHUNK_A,), "builder"
        )
        knowledge = self.artifact(
            "knowledge", "interpreted observation", (CHUNK_A, CHUNK_B),
            "builder", information.digest,
        )
        pattern = self.artifact(
            "pattern", "repeated outcome", (CHUNK_A, CHUNK_B, CHUNK_C),
            "builder", knowledge.digest,
        )
        principle = self.artifact(
            "principle", "durable rule", (CHUNK_A, CHUNK_B, CHUNK_C, CHUNK_D),
            "builder", pattern.digest,
        )
        machine = PromotionStateMachine()
        for parent, candidate in (
            (information, knowledge), (knowledge, pattern), (pattern, principle)
        ):
            self.assertEqual(
                machine.promote(parent, candidate, *self.decisions(candidate)),
                candidate,
            )

    def test_module_function_requires_retained_machine_and_rejects_replay(self):
        parent = self.artifact("information", "observation", (CHUNK_A,), "builder")
        candidate = self.artifact(
            "knowledge", "conclusion", (CHUNK_A,), "builder", parent.digest
        )
        decisions = self.decisions(candidate)
        machine = PromotionStateMachine()
        self.assertEqual(promote(machine, parent, candidate, *decisions), candidate)
        with self.assertRaises(PromotionError):
            promote(machine, parent, candidate, *decisions)
        with self.assertRaises(PromotionError):
            promote(object(), parent, candidate, *decisions)

    def test_rejects_missing_rejected_stale_and_self_review_gates(self):
        parent = self.artifact("information", "observation", (CHUNK_A,), "builder")
        candidate = self.artifact(
            "knowledge", "conclusion", (CHUNK_A,), "builder", parent.digest
        )
        critic, human = self.decisions(candidate)
        invalid_gates = (
            (None, human),
            (critic, None),
            (CriticDecision(candidate.digest, "critic", False), human),
            (critic, HumanApproval(candidate.digest, "human", False)),
            (critic, HumanApproval("0" * 64, "human", True)),
            (CriticDecision(candidate.digest, "builder", True), human),
            (critic, HumanApproval(candidate.digest, "critic", True)),
        )
        for gates in invalid_gates:
            with self.assertRaises(PromotionError):
                PromotionStateMachine().promote(parent, candidate, *gates)

    def test_rejects_terminal_parent_hypothesis_skip_and_lost_citations(self):
        information = self.artifact("information", "observation", (CHUNK_A,), "builder")
        skipped = self.artifact(
            "pattern", "skip", (CHUNK_A,), "builder", information.digest
        )
        with self.assertRaises(PromotionError):
            PromotionStateMachine().promote(
                information, skipped, *self.decisions(skipped)
            )
        lost = self.artifact(
            "knowledge", "lost", (CHUNK_B,), "builder", information.digest
        )
        with self.assertRaises(PromotionError):
            PromotionStateMachine().promote(information, lost, *self.decisions(lost))
        hypothesis = self.artifact(
            "information", "uncertain", (), "builder",
            hypotheses=(Hypothesis("missing source"),),
        )
        derived = self.artifact(
            "knowledge", "derived", (CHUNK_A,), "builder", hypothesis.digest
        )
        with self.assertRaises(PromotionError):
            PromotionStateMachine().promote(
                hypothesis, derived, *self.decisions(derived)
            )
        principle = self.artifact(
            "principle", "rule", (CHUNK_A,), "builder", "f" * 64
        )
        next_candidate = self.artifact(
            "principle", "later rule", (CHUNK_A,), "builder", principle.digest
        )
        with self.assertRaises(PromotionError):
            PromotionStateMachine().promote(
                principle, next_candidate, *self.decisions(next_candidate)
            )

    def test_grounded_and_hypothesis_evidence_are_structurally_distinct(self):
        with self.assertRaises(PromotionError):
            self.artifact("information", "unsupported", (), "builder")
        with self.assertRaises(PromotionError):
            self.artifact(
                "information", "mixed", (CHUNK_A,), "builder",
                hypotheses=(Hypothesis("reason"),),
            )
        with self.assertRaises(PromotionError):
            self.artifact(
                "information", "bad hypothesis", (), "builder",
                hypotheses=(Hypothesis(""),),
            )
        hypothesis = self.artifact(
            "information", "uncertain", (), "builder",
            hypotheses=(Hypothesis("missing source"),),
        )
        self.assertEqual(hypothesis.grounded_citations, ())

    def test_citations_must_be_lowercase_sha256_chunk_identities(self):
        for citation in ("chunk-a", "A" * 64, "a" * 63, 1):
            with self.assertRaises(PromotionError):
                self.artifact("information", "observation", (citation,), "builder")

    def test_digest_is_deterministic_and_bound_to_all_artifact_fields(self):
        first = self.artifact("information", "observation", (CHUNK_A,), "builder")
        same = self.artifact("information", "observation", (CHUNK_A,), "builder")
        different = self.artifact("information", "observation", (CHUNK_A,), "other")
        self.assertEqual(first.digest, same.digest)
        self.assertNotEqual(first.digest, different.digest)
        self.assertFalse(hasattr(first, "__dict__"))
        self.assertFalse(hasattr(Hypothesis("reason"), "__dict__"))
        critic, human = self.decisions(first)
        self.assertFalse(hasattr(critic, "__dict__"))
        self.assertFalse(hasattr(human, "__dict__"))
        with self.assertRaises((AttributeError, TypeError)):
            first.grounded_citations += (CHUNK_B,)

    def test_rejects_unsafe_duplicate_unknown_and_unbounded_values(self):
        invalid_artifacts = (
            ("unknown", "x", (CHUNK_A,), (), "builder", None),
            ("information", "x", (CHUNK_A, CHUNK_A), (), "builder", None),
            ("information", "token=secret", (CHUNK_A,), (), "builder", None),
            ("information", "control\ntext", (CHUNK_A,), (), "builder", None),
            ("information", "mutable", [CHUNK_A], (), "builder", None),
            (
                "information", "bounded",
                tuple(f"{index:064x}" for index in range(101)), (), "builder", None,
            ),
        )
        for args in invalid_artifacts:
            with self.assertRaises(PromotionError):
                Artifact(*args)

    def test_decision_type_actor_and_digest_validation(self):
        for decision_type, args in (
            (CriticDecision, ("bad", "critic", True)),
            (CriticDecision, ("a" * 64, "bad actor!", True)),
            (CriticDecision, ("a" * 64, "critic", "true")),
            (HumanApproval, ("A" * 64, "human", True)),
            (HumanApproval, ("a" * 64, "bad actor!", True)),
            (HumanApproval, ("a" * 64, "human", 1)),
        ):
            with self.assertRaises(PromotionError):
                decision_type(*args)

    def test_failed_decisions_do_not_consume_later_valid_decisions(self):
        parent = self.artifact("information", "observation", (CHUNK_A,), "builder")
        candidate = self.artifact(
            "knowledge", "conclusion", (CHUNK_A,), "builder", parent.digest
        )
        machine = PromotionStateMachine()
        critic, human = self.decisions(candidate)
        with self.assertRaises(PromotionError):
            machine.promote(
                parent, candidate,
                CriticDecision(candidate.digest, "critic", False), human,
            )
        self.assertEqual(machine.promote(parent, candidate, critic, human), candidate)
        with self.assertRaises(PromotionError):
            machine.promote(parent, candidate, critic, human)

import unittest

from ice_maker.knowledge_graph import Citation, Conclusion, IntegrityReport, Note
from ice_maker.promotion import Artifact, CriticDecision, HumanApproval, PromotionError, PromotionStateMachine
from ice_maker.synthesis import (
    SyntheticExperience,
    SynthesisError,
    SynthesisJourney,
    approve_pattern,
    compose_pattern,
    inspect_experiences,
)


def citation(source, chunk):
    return Citation(source * 64, chunk * 64)


def experience(note_id, text, source, chunk, *, conclusion=None, related=()):
    item = citation(source, chunk)
    note = Note(
        note_id, text, "operations", ("idempotency",), ("depends_on",),
        (Conclusion(conclusion or f"idempotent retries preserve outcome for {note_id}", "grounded", (item.chunk_id,)),),
        tuple(related), (item,),
    )
    return SyntheticExperience(note, True)


class SynthesisE2ETests(unittest.TestCase):
    def setUp(self):
        self.left = experience("experience-alpha", "idempotent retries preserve an outcome", "a", "1")
        self.right = experience("experience-beta", "idempotent retries preserve an operational outcome independently", "b", "2")

    def test_synthetic_horizontal_comparison_requires_independent_review(self):
        journey = compose_pattern((self.right, self.left), "builder")
        self.assertTrue(journey.synthetic_only)
        self.assertEqual(journey.pattern_note_ids, ("experience-alpha", "experience-beta"))
        self.assertEqual(journey.comparison.note_ids, journey.pattern_note_ids)
        self.assertIn("term:idempotent", journey.comparison.evidence)
        self.assertEqual(journey.pattern.grounded_citations, ("1" * 64, "2" * 64))
        self.assertEqual(journey.integrity.records, ())

        with self.assertRaises(PromotionError):
            approve_pattern(journey, None, None, None, None)
        with self.assertRaises(PromotionError):
            approve_pattern(
                journey,
                CriticDecision(journey.knowledge.digest, "critic", False),
                HumanApproval(journey.knowledge.digest, "human", True),
                CriticDecision(journey.pattern.digest, "critic-two", True),
                HumanApproval(journey.pattern.digest, "human-two", True),
            )
        with self.assertRaises(PromotionError):
            stale_journey = compose_pattern((self.left, self.right), "builder")
            approve_pattern(
                stale_journey,
                CriticDecision(stale_journey.knowledge.digest, "critic", True),
                HumanApproval("0" * 64, "human", True),
                CriticDecision(stale_journey.pattern.digest, "critic-two", True),
                HumanApproval(stale_journey.pattern.digest, "human-two", True),
            )
        approved = approve_pattern(
            journey,
            CriticDecision(journey.knowledge.digest, "critic", True),
            HumanApproval(journey.knowledge.digest, "human", True),
            CriticDecision(journey.pattern.digest, "critic-two", True),
            HumanApproval(journey.pattern.digest, "human-two", True),
        )
        self.assertEqual(approved, journey.pattern)

    def test_rejects_non_synthetic_and_stale_review(self):
        with self.assertRaises(SynthesisError):
            compose_pattern((SyntheticExperience(self.left.note, False), self.right), "builder")
        with self.assertRaises(SynthesisError):
            compose_pattern((item for item in (self.left, self.right, self.left)), "builder")
        with self.assertRaises(SynthesisError):
            compose_pattern([self.left, self.right], "builder")
        with self.assertRaises(SynthesisError):
            inspect_experiences(iter((self.left, self.right)))
        journey = compose_pattern((self.left, self.right), "builder")
        with self.assertRaises(PromotionError):
            approve_pattern(
                journey,
                CriticDecision("0" * 64, "critic", True),
                HumanApproval(journey.knowledge.digest, "human", True),
                CriticDecision(journey.pattern.digest, "critic-two", True),
                HumanApproval(journey.pattern.digest, "human-two", True),
            )

    def test_hypothesis_is_structural_and_integrity_is_deterministic(self):
        journey = compose_pattern((self.left, self.right), "builder", inference="not observed")
        self.assertEqual(journey.hypothesis.hypotheses[0].reason, "not observed")
        self.assertEqual(journey.hypothesis.grounded_citations, ())
        duplicate = experience("experience-copy", self.left.note.text, "c", "3")
        first = inspect_experiences((self.left, duplicate))
        second = inspect_experiences((duplicate, self.left))
        self.assertEqual(first.canonical_json(), second.canonical_json())
        self.assertEqual(first.records[0].kind, "duplicate")
        with self.assertRaises(SynthesisError):
            compose_pattern((self.left, duplicate), "builder")

    def test_rejected_pattern_review_does_not_consume_knowledge_review(self):
        journey = compose_pattern((self.left, self.right), "builder")
        knowledge_critic = CriticDecision(journey.knowledge.digest, "critic", True)
        knowledge_human = HumanApproval(journey.knowledge.digest, "human", True)
        with self.assertRaises(PromotionError):
            approve_pattern(
                journey, knowledge_critic, knowledge_human,
                CriticDecision(journey.pattern.digest, "critic-two", False),
                HumanApproval(journey.pattern.digest, "human-two", True),
            )
        self.assertEqual(
            approve_pattern(
                journey, knowledge_critic, knowledge_human,
                CriticDecision(journey.pattern.digest, "critic-two", True),
                HumanApproval(journey.pattern.digest, "human-two", True),
            ),
            journey.pattern,
        )

    def test_directly_constructed_journey_must_match_composed_invariants(self):
        journey = compose_pattern((self.left, self.right), "builder", inference="not observed")
        with self.assertRaises(SynthesisError):
            SynthesisJourney(
                journey.pattern_note_ids, journey.comparison, IntegrityReport(()),
                journey.information,
                Artifact("knowledge", "different content", journey.knowledge.grounded_citations,
                         (), "builder", journey.information.digest),
                journey.pattern, journey.hypothesis, True, PromotionStateMachine(),
                (self.left, self.right),
            )

    def test_all_integrity_findings_are_stable_under_input_reordering(self):
        duplicate = experience("experience-copy", self.left.note.text, "c", "3")
        safe = experience("experience-safe", "idempotent retries preserve a result", "d", "4", conclusion="safe")
        unsafe = experience("experience-unsafe", "idempotent retries preserve a result independently", "e", "5", conclusion="unsafe")
        orphan = experience("experience-orphan", "idempotent retries preserve a result later", "f", "6", related=("missing-note",))
        for left, right, expected in ((self.left, duplicate, "duplicate"), (safe, unsafe, "contradiction"), (orphan, self.right, "orphan")):
            forward = inspect_experiences((left, right)).canonical_json()
            backward = inspect_experiences((right, left)).canonical_json()
            self.assertEqual(forward, backward)
            self.assertIn(f'"kind":"{expected}"', forward)


if __name__ == "__main__":
    unittest.main()

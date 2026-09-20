import json
import unittest

from ice_maker.knowledge_graph import (Citation, Conclusion, Note, GraphError,
    compare_notes, integrity_report, retrieve_notes)


def c(ch):
    return Citation("a" * 64, ch * 64)


class KnowledgeGraphTests(unittest.TestCase):
    def note(self, ident, text, *, conclusion="", citations=(), related=()):
        citations = tuple(citations)
        return Note(ident, text, "operations", ("idempotency",),
                    ("depends_on",), (Conclusion(conclusion, "grounded", tuple(x.chunk_id for x in citations)),),
                    tuple(related), citations)

    def test_retrieval_and_comparison_include_evidence(self):
        a = self.note("a", "retry idempotent operations", conclusion="retry safely", citations=(c("1"),))
        b = self.note("b", "idempotent operations retry", conclusion="retry safely", citations=(c("2"),))
        found = retrieve_notes((b, a), "retry idempotent")
        self.assertEqual(tuple(n.note_id for n in found), ("a", "b"))
        comparison = compare_notes(a, b)
        self.assertEqual(comparison.note_ids, ("a", "b"))
        self.assertIn("term:idempotent", comparison.evidence)

    def test_report_is_order_independent_and_reports_conflicts(self):
        a = self.note("a", "same", conclusion="safe", citations=(c("1"),), related=("missing",))
        b = self.note("b", "same", conclusion="unsafe", citations=(c("2"),))
        one = integrity_report((a, b)).canonical_json()
        two = integrity_report((b, a)).canonical_json()
        self.assertEqual(one, two)
        self.assertEqual([x.kind for x in integrity_report((a, b)).records], ["duplicate", "contradiction", "orphan"])
        orphan = integrity_report((a, b)).records[-1]
        self.assertEqual(orphan.citation_ids, (c("1").chunk_id,))
        json.loads(one)

    def test_provenance_requires_exact_sha256_and_rejects_mutable_values(self):
        with self.assertRaises(GraphError):
            Citation("a" * 64, "chunk-1")
        with self.assertRaises(GraphError):
            Citation("A" * 64, "b" * 64)
        with self.assertRaises(GraphError):
            Conclusion("claim", "grounded", [c("1").chunk_id])
        with self.assertRaises(GraphError):
            Note("x", "text", "operations", ["idempotency"],
                 ("depends_on",), (), (), ())
        with self.assertRaises(GraphError):
            Note("x", "text", "operations", ("idempotency",),
                 ("depends_on",),
                 (Conclusion("claim", "grounded", (c("2").chunk_id,)),),
                 (), (c("1"),))

    def test_duplicate_reason_and_normalized_negation(self):
        a = self.note("a", "first note", conclusion="The claim", citations=(c("1"),))
        b = self.note("b", "second note", conclusion="the claim", citations=(c("2"),))
        duplicate = integrity_report((a, b)).records[0]
        self.assertEqual(duplicate.evidence, ("same-grounded-conclusion",))

        c1 = self.note("c", "third note", conclusion="claim", citations=(c("3"),))
        c2 = self.note("d", "fourth note", conclusion="not claim", citations=(c("4"),))
        contradiction = [r for r in integrity_report((c1, c2)).records if r.kind == "contradiction"]
        self.assertEqual(len(contradiction), 1)

    def test_report_rejects_unbounded_pairwise_output(self):
        notes = tuple(self.note(str(i), "unique note " + str(i), conclusion="claim", citations=(c("1"),)) for i in range(1001))
        with self.assertRaises(GraphError):
            integrity_report(notes)

    def test_hypothesis_and_input_validation(self):
        self.assertEqual(Conclusion("idea", "hypothesis", (), "not present in source").status, "hypothesis")
        with self.assertRaises(GraphError):
            Note("x", "text", "unknown", (), (), (), ())
        with self.assertRaises(GraphError):
            retrieve_notes((n for n in range(1002)), "x")


if __name__ == "__main__":
    unittest.main()

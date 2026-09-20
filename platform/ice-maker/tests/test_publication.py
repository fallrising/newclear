import json
import unittest

from ice_maker.publication import (
    AssembledBook, Chapter, Citation, Manifest, PublicationError,
    assemble_book, compile_publication, parse_manifest, parse_record,
    render_html, render_markdown,
)


SOURCE = "a" * 64
CHUNK = "b" * 64
COMMIT = "c" * 40


def record(source="knowledge/pattern.json", note_id="pattern", refs=()):
    return {"schema_version": "knowledge-record.v1", "source": source,
            "note_id": note_id, "title": "Safe retries", "text": "Retry safely.",
            "synthetic": True, "citations": [{"source_sha256": SOURCE, "chunk_id": CHUNK}],
            "references": list(refs)}


class PublicationTests(unittest.TestCase):
    def manifest(self, chapters=("knowledge/pattern.json",)):
        return {"schema_version": "publication-manifest.v1", "manifest_id": "book-one",
                "title": "Reliable Systems",
                "chapters": list(chapters)}

    def pm(self, value):
        return parse_manifest(json.dumps(value))

    def pr(self, value):
        return parse_record(json.dumps(value))

    def test_ordered_assembly_links_and_deduplicates_exact_bibliography(self):
        first = self.pr(record())
        second_data = record("knowledge/second.json", "second", ("pattern",))
        second_data["citations"].append({"source_sha256": SOURCE, "chunk_id": "d" * 64})
        second = self.pr(second_data)
        book = assemble_book(self.pm(self.manifest((first.source, second.source))),
                             (first, second), COMMIT)
        md = render_markdown(book)
        html = render_html(book)
        md = md.decode()
        html = html.decode()
        self.assertLess(md.index("Safe retries"), md.index("Safe retries", md.index("Safe retries") + 1))
        self.assertEqual(md.count(f"{SOURCE}#{CHUNK}"), 1)
        self.assertIn("[pattern](#pattern)", md)
        self.assertIn("book-one", md); self.assertIn(COMMIT, md); self.assertIn("Synthetic", md)
        self.assertIn("<!doctype html>", html.lower())
        self.assertIn("href=\"#pattern\"", html)
        self.assertIn("&lt;", render_html(assemble_book(self.pm(self.manifest()),
                                                          (self.pr({**record(), "text": "<safe>"}),), COMMIT)).decode())

    def test_strict_json_duplicate_unknown_and_bounds(self):
        raw = '{"schema_version":"publication-manifest.v1","schema_version":"x"}'
        with self.assertRaises(PublicationError): parse_manifest(raw)
        bad = self.manifest(); bad["unknown"] = 1
        with self.assertRaises(PublicationError): self.pm(bad)
        bad = record(); bad["synthetic"] = False
        with self.assertRaises(PublicationError): self.pr(bad)
        bad = record(); bad["source"] = "../secret.json"
        with self.assertRaises(PublicationError): self.pr(bad)

    def test_rejects_missing_self_unresolved_drift_and_unsafe_values(self):
        p = self.pm(self.manifest())
        with self.assertRaises(PublicationError): assemble_book(p, (), COMMIT)
        with self.assertRaises(PublicationError): assemble_book(p, (self.pr(record(refs=("missing",))),), COMMIT)
        with self.assertRaises(PublicationError): assemble_book(
            p, (self.pr(record(refs=("pattern",))),), COMMIT)
        bad = record(); bad["citations"].append({"source_sha256": "d" * 64, "chunk_id": CHUNK})
        with self.assertRaises(PublicationError): self.pr(bad)
        for path in ("/tmp/x", "knowledge\\x.json", ".ice-maker/x.json", "generated/x.md"):
            bad = record(path)
            with self.assertRaises(PublicationError): self.pr(bad)
        bad = record(); bad["title"] = "token=oops"
        with self.assertRaises(PublicationError): self.pr(bad)

    def test_values_are_frozen_slotted_and_rendering_is_stable(self):
        manifest = self.pm(self.manifest())
        chapter = self.pr(record())
        book = assemble_book(manifest, (chapter,), COMMIT)
        self.assertFalse(hasattr(book, "__dict__")); self.assertFalse(hasattr(chapter, "__dict__"))
        self.assertEqual(render_markdown(book), render_markdown(book))
        self.assertEqual(render_html(book), render_html(book))

    def test_commit_is_compiler_argument_and_only_exact_tuple_is_accepted(self):
        manifest = self.pm(self.manifest())
        chapter = self.pr(record())
        with self.assertRaises(PublicationError): self.pm({**self.manifest(), "source_commit": COMMIT})
        with self.assertRaises(PublicationError): assemble_book(manifest, [chapter], COMMIT)
        with self.assertRaises(PublicationError): assemble_book(manifest, iter((chapter,)), COMMIT)
        with self.assertRaises(PublicationError): assemble_book(manifest, (chapter,), "C" * 40)
        self.assertEqual(compile_publication(json.dumps(self.manifest()), (chapter,), COMMIT).source_commit, COMMIT)

    def test_direct_values_cannot_forge_invariants(self):
        with self.assertRaises(PublicationError): Manifest("book-one", "Title", ["x"])
        with self.assertRaises(PublicationError): Chapter("x", "Bad Anchor!", "T", "x", True, (), ())
        manifest = self.pm(self.manifest())
        chapter = self.pr(record())
        with self.assertRaises(PublicationError): AssembledBook(manifest, (chapter,), (), "not-a-sha")

    def test_citation_drift_is_rejected_across_chapters(self):
        first = self.pr(record())
        second_data = record("knowledge/second.json", "second")
        second_data["citations"] = [{"source_sha256": "d" * 64, "chunk_id": CHUNK}]
        second = self.pr(second_data)
        with self.assertRaises(PublicationError): assemble_book(
            self.pm(self.manifest((first.source, second.source))), (first, second), COMMIT)


if __name__ == "__main__": unittest.main()

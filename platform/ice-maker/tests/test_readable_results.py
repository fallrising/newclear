import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from ice_maker.extraction import ExtractedChunk
from ice_maker.readable_results import (
    ReadableResultError,
    ReadableResultTooLarge,
    render_html,
    render_markdown,
    source_metadata,
)
from ice_maker.knowledge_index import IndexError, IndexLimitError, KnowledgeIndex


class ReadableResultTests(unittest.TestCase):
    source = "a" * 64

    def chunk(self, page, region, method, text, confidence=1.0, *, source=None):
        source = source or self.source
        identity = f"{source}\0{page}\0{region}\0{method}\0{text}"
        return ExtractedChunk(
            source,
            page,
            region,
            method,
            text,
            confidence,
            hashlib.sha256(identity.encode("utf-8")).hexdigest(),
        )

    def test_native_ranges_are_contiguous_and_row_order_independent(self):
        chunks = (
            self.chunk(1, "text:2,0,1", "pdf-text", "c"),
            self.chunk(1, "text:0,0,2", "pdf-text", "ab"),
            self.chunk(2, "text:0,0,3", "pdf-text", "two"),
        )
        first = render_markdown(chunks, self.source)
        second = render_markdown(tuple(reversed(chunks)), self.source)
        self.assertEqual(first, second)
        self.assertIn(b"    abc", first)
        self.assertIn(b"    two", first)
        self.assertIn(b"covered text:0,0,3", first)

    def test_native_gaps_overlaps_and_mixed_page_methods_fail_closed(self):
        invalid = (
            (
                self.chunk(1, "text:0,0,1", "pdf-text", "a"),
                self.chunk(1, "text:2,0,1", "pdf-text", "c"),
            ),
            (
                self.chunk(1, "text:0,0,2", "pdf-text", "ab"),
                self.chunk(1, "text:1,0,1", "pdf-text", "b"),
            ),
            (
                self.chunk(1, "text:0,0,1", "pdf-text", "a"),
                self.chunk(1, "pixels:0,0,1,1", "ocr", "b", 0.9),
            ),
        )
        for chunks in invalid:
            with self.subTest(chunks=chunks), self.assertRaises(ReadableResultError):
                render_markdown(chunks, self.source)

    def test_ocr_uses_stable_lines_compact_region_and_low_confidence_marker(self):
        chunks = (
            self.chunk(1, "pixels:20,10,5,10", "ocr", "two", 0.95),
            self.chunk(1, "pixels:1,10,4,10", "ocr", "one", 0.79),
            self.chunk(1, "pixels:3,30,6,8", "ocr", "next", 0.90),
        )
        body = render_markdown(chunks, self.source).decode("utf-8")
        self.assertIn("[LOW CONFIDENCE 0.79: one] two", body)
        self.assertLess(body.index("one] two"), body.index("next"))
        self.assertIn("covered pixels:1,10,24,28", body)
        self.assertNotIn("pixels:20,10,5,10, pixels:", body)

    def test_metadata_counts_source_text_bytes_without_rendering_envelope(self):
        chunks = (self.chunk(1, "text:0,0,2", "pdf-text", "繁體"),)
        result = source_metadata(chunks, self.source)
        self.assertEqual(result["utf8_bytes"], len("繁體".encode("utf-8")))
        self.assertEqual(result["pages"], [1])
        self.assertEqual(result["chunk_count"], 1)

    def test_markup_stays_indented_and_browser_html_escapes_complete_markdown(self):
        text = '<img src=x onerror=alert> [x](y) `z` # heading'
        markdown = render_markdown(
            (self.chunk(1, f"text:0,0,{len(text)}", "pdf-text", text),),
            self.source,
        )
        self.assertIn(("    " + text).encode("utf-8"), markdown)
        page = render_html(markdown, "b" * 64, self.source)
        self.assertNotIn(b"<img src=x", page)
        self.assertIn(b"&lt;img src=x onerror=alert&gt;", page)
        self.assertIn(b"Download Markdown", page)

    def test_source_chunk_and_encoded_output_bounds_fail_before_publication(self):
        chunks = (
            self.chunk(1, "text:0,0,1", "pdf-text", "a"),
            self.chunk(1, "text:1,0,1", "pdf-text", "b"),
        )
        with mock.patch("ice_maker.readable_results.MAX_SOURCE_CHUNKS", 1):
            with self.assertRaises(ReadableResultTooLarge):
                render_markdown(chunks, self.source)
        with mock.patch("ice_maker.readable_results.MAX_MARKDOWN_BYTES", 32):
            with self.assertRaises(ReadableResultTooLarge):
                render_markdown(chunks[:1], self.source)
        markdown = render_markdown(chunks, self.source)
        with mock.patch("ice_maker.readable_results.MAX_HTML_BYTES", len(markdown)):
            with self.assertRaises(ReadableResultTooLarge):
                render_html(markdown, "b" * 64, self.source)

    def test_source_mismatch_and_hostile_chunk_identity_fail_closed(self):
        good = self.chunk(1, "text:0,0,1", "pdf-text", "a")
        foreign = self.chunk(
            1, "text:0,0,1", "pdf-text", "b", source="b" * 64
        )
        forged = ExtractedChunk(
            good.source_sha256,
            good.page_number,
            good.region,
            good.method,
            good.text,
            good.confidence,
            "0" * 64,
        )
        for chunks in ((foreign,), (forged,)):
            with self.subTest(chunks=chunks), self.assertRaises(ReadableResultError):
                render_markdown(chunks, self.source)

    def test_index_source_reads_preserve_insertion_order_and_enforce_limit(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "index.sqlite3"
            later = self.chunk(1, "text:1,0,1", "pdf-text", "b")
            earlier = self.chunk(1, "text:0,0,1", "pdf-text", "a")
            with KnowledgeIndex(database) as index:
                index.index_chunks((later, earlier))
                self.assertEqual(index.read_source(self.source), (later, earlier))
                with mock.patch("ice_maker.knowledge_index._MAX_CHUNKS", 1):
                    with self.assertRaises(IndexLimitError):
                        index.read_source(self.source)
                with self.assertRaises(IndexError):
                    index.read_source("b" * 64)

    def test_existing_index_mode_never_creates_a_missing_database(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "missing.sqlite3"
            with self.assertRaises(IndexError):
                KnowledgeIndex(database, existing=True)
            self.assertFalse(database.exists())


if __name__ == "__main__":
    unittest.main()

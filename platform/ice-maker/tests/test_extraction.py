"""Contract tests for the deliberately small synthetic extraction boundary."""

from __future__ import annotations

import tempfile
import unittest
import hashlib
import json
from dataclasses import replace
from pathlib import Path

from ice_maker import extraction
from ice_maker.extraction import ExtractionError, extract_bytes


GLYPHS = {
    "A": ("010", "101", "111", "101", "101"),
    "E": ("111", "100", "110", "100", "111"),
    "H": ("101", "101", "111", "101", "101"),
    "I": ("111", "010", "010", "010", "111"),
    "L": ("100", "100", "100", "100", "111"),
    "O": ("010", "101", "101", "101", "010"),
}


def pbm(text: str) -> bytes:
    """Build a P1 image using the public, fixed 3-by-5 synthetic alphabet."""
    rows = [[] for _ in range(5)]
    for position, character in enumerate(text):
        if position:
            for row in rows:
                row.append("0")
        for row, bits in zip(rows, GLYPHS[character]):
            row.extend(bits)
    width = len(rows[0])
    return ("P1\n%d 5\n" % width + "\n".join(" ".join(row) for row in rows) + "\n").encode()


def text_pdf(text: str) -> bytes:
    return ("%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\n"
            "1 0 obj << /Type /Page >> endobj\nBT (" + text + ") Tj ET\n"
            "trailer << /Root 1 0 R >>\n%%EOF\n").encode()


def scanned_pdf(text: str) -> bytes:
    return (b"%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\n"
            b"1 0 obj << /Type /Page >> stream\n" + pbm(text) +
            b"endstream\nendobj\ntrailer << /Root 1 0 R >>\n%%EOF\n")


class ExtractionTests(unittest.TestCase):
    def test_extracts_synthetic_text_pdf_with_immutable_provenance(self) -> None:
        result = extract_bytes(text_pdf("Hello synthetic PDF"))

        self.assertEqual(result.pages[0].method, "pdf-text")
        self.assertEqual(result.pages[0].page_number, 1)
        self.assertEqual(result.chunks[0].text, "Hello synthetic PDF")
        self.assertEqual(result.pages[0].source_sha256, result.source_sha256)
        self.assertTrue(result.chunks[0].chunk_id)
        with self.assertRaises(AttributeError):
            result.pages[0].text = "changed"  # type: ignore[misc]

    def test_extracts_scanned_pdf_and_standalone_pbm_and_reuses_ocr_cache(self) -> None:
        calls = 0

        def count_ocr(image: bytes) -> str:
            nonlocal calls
            calls += 1
            return "HELLO"

        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"
            first = extract_bytes(scanned_pdf("HELLO"), cache_dir=cache, ocr_decoder=count_ocr)
            second = extract_bytes(scanned_pdf("HELLO"), cache_dir=cache, ocr_decoder=count_ocr)
            image = extract_bytes(pbm("HELLO"), cache_dir=cache)

        self.assertEqual(first.chunks[0].method, "ocr-pbm")
        self.assertEqual(first.chunks[0].region, "pixels:0,0,19,5")
        self.assertEqual(second.cache_hit, True)
        self.assertEqual(calls, 1)
        self.assertEqual(image.chunks[0].text, "HELLO")

    def test_rejects_general_pdf_unknown_glyph_and_control_or_secret_output(self) -> None:
        with self.assertRaisesRegex(ExtractionError, "unsupported synthetic PDF"):
            extract_bytes(b"%PDF-1.4\n1 0 obj <<>>\n%%EOF\n")
        with self.assertRaisesRegex(ExtractionError, "unknown synthetic glyph"):
            extract_bytes(b"P1\n3 5\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n1 1 1\n")
        with self.assertRaisesRegex(ExtractionError, "unsafe extracted output"):
            extract_bytes(text_pdf("api_key=not-safe"))

    def test_rejects_corrupt_and_symlinked_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"
            cache.mkdir()
            (cache / "not-a-cache.json").write_text("{}", encoding="utf-8")
            # A matching cache file with invalid JSON must fail closed.
            source_hash = __import__("hashlib").sha256(pbm("HELLO")).hexdigest()
            (cache / (source_hash + ".json")).write_text("not json", encoding="utf-8")
            with self.assertRaisesRegex(ExtractionError, "cache"):
                extract_bytes(pbm("HELLO"), cache_dir=cache)
            linked = Path(directory) / "linked-cache"
            linked.symlink_to(cache, target_is_directory=True)
            with self.assertRaisesRegex(ExtractionError, "symlinked cache"):
                extract_bytes(pbm("HELLO"), cache_dir=linked)

    def test_rejects_digest_valid_cache_forgery(self) -> None:
        source = pbm("HELLO")
        source_hash = hashlib.sha256(source).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"
            baseline = extract_bytes(source)
            original = extraction._cache_payload(baseline)

            def reject(name: str, mutate: object, *, recompute_digest: bool = True) -> None:
                with self.subTest(name=name):
                    payload = json.loads(json.dumps(original))
                    mutate(payload)  # type: ignore[operator]
                    body = {key: value for key, value in payload.items() if key != "canonical_digest"}
                    if recompute_digest:
                        payload["canonical_digest"] = hashlib.sha256(
                            json.dumps(body, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
                    cache.mkdir()
                    (cache / f"{source_hash}.json").write_text(json.dumps(payload), encoding="utf-8")
                    with self.assertRaisesRegex(ExtractionError, "cache"):
                        extract_bytes(source, cache_dir=cache)
                    (cache / f"{source_hash}.json").unlink()
                    cache.rmdir()

            reject("version", lambda value: value.__setitem__("ocr_version", "forged"))
            reject("digest", lambda value: value.__setitem__("canonical_digest", "0" * 64), recompute_digest=False)
            reject("schema", lambda value: value.__setitem__("extra", True))
            reject("bool page", lambda value: value["pages"][0].__setitem__("page_number", True))
            reject("nan confidence", lambda value: value["pages"][0].__setitem__("confidence", float("nan")))
            reject("page order", lambda value: value["pages"][0].__setitem__("page_number", 2))
            reject("region", lambda value: value["pages"][0].__setitem__("region", "pixels:0,0,999,5"))
            reject("method", lambda value: value["pages"][0].__setitem__("method", "pdf-text"))
            reject("unsafe text", lambda value: value["pages"][0].__setitem__("text", "token=unsafe"))
            reject("chunk", lambda value: value["chunks"][0].__setitem__("chunk_id", "0" * 64))

    def test_rejects_duplicate_keys_and_symlinked_cache_components(self) -> None:
        source = pbm("HELLO")
        source_hash = hashlib.sha256(source).hexdigest()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            cache = root / "cache"
            cache.mkdir()
            entry = cache / f"{source_hash}.json"
            entry.write_text('{"source_sha256":"one","source_sha256":"two"}', encoding="utf-8")
            with self.assertRaisesRegex(ExtractionError, "cache"):
                extract_bytes(source, cache_dir=cache)
            entry.unlink()
            target = root / "target"
            target.mkdir()
            (root / "middle").symlink_to(target, target_is_directory=True)
            with self.assertRaisesRegex(ExtractionError, "symlinked cache"):
                extract_bytes(source, cache_dir=root / "middle" / "cache")
            entry.symlink_to(root / "elsewhere")
            with self.assertRaisesRegex(ExtractionError, "symlinked cache"):
                extract_bytes(source, cache_dir=cache)

    def test_rejects_mismatched_safe_cache_collision(self) -> None:
        source = pbm("HELLO")
        result = extract_bytes(source)
        forged_page = replace(result.pages[0], text="HE", region="pixels:0,0,19,5")
        forged = extraction._result(result.source_sha256, (forged_page,))
        with tempfile.TemporaryDirectory() as directory:
            cache = Path(directory) / "cache"
            cache.mkdir()
            path = cache / f"{result.source_sha256}.json"
            path.write_text(json.dumps(extraction._cache_payload(forged)), encoding="utf-8")
            with self.assertRaisesRegex(ExtractionError, "collision"):
                extraction._publish_cache(path, result)

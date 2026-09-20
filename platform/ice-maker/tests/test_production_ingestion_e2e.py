"""Generated control journey for the local production-ingestion boundaries.

This test intentionally does not invoke Poppler or Tesseract. Its extractor is
deterministic control evidence that makes the service/coordinator composition
repeatable offline; representative-corpus OCR quality remains an external gate.
"""

import hashlib
import io
import json
import tempfile
import unittest
from pathlib import Path

from ice_maker.document_batch import canonical_json, run_batch
from ice_maker.document_service import DurableBatchService, ServiceError
from ice_maker.extraction import ExtractedChunk
from ice_maker.knowledge_index import KnowledgeIndex


PDF = b"%PDF-1.7\n"
PNG = b"\x89PNG\r\n\x1a\n"
JPEG = b"\xff\xd8\xff"
WEBP = b"RIFF0000WEBP"
TEST_EXTRACTOR = "9" * 64


class Upload:
    def __init__(self, name, payload):
        self.filename = name
        self.file = io.BytesIO(payload)


def _chunk(descriptor, payload):
    """Return bounded evidence with the same public shape as the real adapter."""
    if b"CORRUPT" in payload:
        raise ValueError("corrupt input is isolated")
    image = descriptor.signature != "pdf"
    method = "ocr" if image or b"SCANNED" in payload else "pdf-text"
    text = "generated searchable control " + descriptor.item.path
    region = (
        "pixels:0,8192,40,24"
        if b"LONG" in payload
        else (
            "pixels:0,0,40,24"
            if method == "ocr"
            else f"text:0,0,{len(text)}"
        )
    )
    identity = f"{descriptor.sha256}\0{1}\0{region}\0{method}\0{text}"
    return (
        ExtractedChunk(
            descriptor.sha256,
            1,
            region,
            method,
            text,
            0.99 if method == "ocr" else 1.0,
            hashlib.sha256(identity.encode()).hexdigest(),
        ),
    )


class ProductionIngestionJourneyTests(unittest.TestCase):
    """BDD: a generated 70-PDF/30-image batch survives interruption locally."""

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name).resolve()
        source_config = Path(__file__).parents[1] / "config/document-ingestion.json"
        base_config = json.loads(source_config.read_text())
        base_config["limits"].update(
            {
                "max_items": 100,
                "max_file_bytes": 4096,
                "max_aggregate_bytes": 400000,
                "max_workers": 1,
            }
        )
        self.config = self.root / "config.json"
        self.config.write_bytes(canonical_json(base_config))

    def tearDown(self):
        self.temporary.cleanup()

    def _generated_inputs(self):
        """Return exactly 70 PDF and 30 raster sources without network fixtures."""
        rows = []
        for number in range(70):
            kind = (
                b"NATIVE"
                if number % 3 == 0
                else (b"SCANNED" if number % 3 == 1 else b"MIXED")
            )
            payload = PDF + kind + b" generated document " + str(number).encode()
            rows.append(
                (f"items/{number:03d}.pdf", payload, "confirmed", "internal")
            )
        # Duplicate bytes retain different per-item policy metadata.
        rows[69] = ("items/069.pdf", rows[0][1], "unconfirmed", "restricted")
        for number in range(30):
            prefix = (PNG, JPEG, WEBP)[number % 3]
            marker = b" LONG" if number == 0 else b" IMAGE"
            rows.append(
                (
                    f"items/{70 + number:03d}.img",
                    prefix + marker + str(number).encode(),
                    "confirmed",
                    "confidential" if number == 1 else "internal",
                )
            )
        # Isolated terminal outcomes within the canonical 100-item batch.
        rows[67] = ("items/067.pdf", PDF + b"CORRUPT", "confirmed", "internal")
        rows[68] = ("items/068.pdf", PDF + b"DENIED", "denied", "restricted")
        return rows

    @staticmethod
    def _manifest(rows):
        return canonical_json(
            {
                "schema_version": "document-batch-manifest.v1",
                "items": [
                    {
                        "path": path,
                        "rights": rights,
                        "data_class": data_class,
                        "languages": ["eng"],
                    }
                    for path, _payload, rights, data_class in rows
                ],
            }
        )

    def _write_inputs(self, rows):
        source = self.root / "source"
        for path, payload, *_ in rows:
            target = source / path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(payload)
        manifest = self.root / "manifest.json"
        manifest.write_bytes(self._manifest(rows))
        return manifest, source

    def test_generated_control_journey_resumes_and_service_keeps_safe_status(self):
        """Given 100 documents, interruption resumes without repeating completed work."""
        rows = self._generated_inputs()
        self.assertEqual(len(rows), 100)
        self.assertEqual(sum(payload.startswith(PDF) for _, payload, *_ in rows), 70)
        self.assertEqual(sum(not payload.startswith(PDF) for _, payload, *_ in rows), 30)
        self.assertEqual(
            {payload.split(b" ", 1)[0] for _, payload, *_ in rows[:67]},
            {PDF + b"NATIVE", PDF + b"SCANNED", PDF + b"MIXED"},
        )
        manifest, source = self._write_inputs(rows)
        calls = []

        def extractor(payload, descriptor, config):
            calls.append(descriptor.item.path)
            return _chunk(descriptor, payload)

        def interrupt(descriptor):
            if descriptor.item.path == "items/050.pdf":
                raise KeyboardInterrupt()

        with self.assertRaises(KeyboardInterrupt):
            run_batch(
                manifest,
                source,
                config_path=self.config,
                state_root=self.root / "coordinator",
                extractor=extractor,
                extractor_binding_sha256=TEST_EXTRACTOR,
                interrupt_after_index=interrupt,
            )
        completed_before = tuple(calls)
        result = run_batch(
            manifest,
            source,
            config_path=self.config,
            state_root=self.root / "coordinator",
            extractor=extractor,
            extractor_binding_sha256=TEST_EXTRACTOR,
        )
        self.assertEqual(
            result["counts"],
            {"duplicate": 1, "failed": 1, "processed": 97, "rejected": 1},
        )
        self.assertEqual(len(result["items"]), 100)
        self.assertEqual(
            [item["path"] for item in result["items"]],
            sorted(item["path"] for item in result["items"]),
        )
        self.assertEqual(calls[: len(completed_before)], list(completed_before))
        self.assertEqual(len(calls), len(set(calls)))
        self.assertEqual(result["items"][69]["status"], "duplicate")
        self.assertEqual(result["items"][69]["duplicate_of"], "items/000.pdf")
        self.assertEqual(
            result["items"][67],
            {
                "path": "items/067.pdf",
                "status": "failed",
                "reason": "extraction_failed",
            },
        )
        self.assertEqual(
            result["items"][68],
            {
                "path": "items/068.pdf",
                "status": "rejected",
                "reason": "policy_denied",
            },
        )

        with KnowledgeIndex(self.root / "coordinator/batch-index.sqlite3") as index:
            found = index.search("generated searchable control", limit=100)
        self.assertEqual(len(found), 97)
        self.assertTrue(
            all(
                hit.source_sha256
                and (
                    hit.region.startswith("text:")
                    or hit.region.startswith("pixels:")
                )
                for hit in found
            )
        )
        self.assertTrue(any(hit.region == "pixels:0,8192,40,24" for hit in found))

        # The durable upload/status boundary delegates to the same coordinator.
        service = DurableBatchService(
            self.root / "service",
            config_path=self.config,
            runner=run_batch,
            runner_kwargs={
                "extractor": lambda payload, descriptor, config: _chunk(
                    descriptor, payload
                ),
                "extractor_binding_sha256": TEST_EXTRACTOR,
            },
        )
        try:
            uploads = [Upload(Path(path).name, payload) for path, payload, *_ in rows]
            metadata = json.dumps(
                [
                    {
                        "name": Path(path).name,
                        "size": len(payload),
                        "rights": rights,
                        "data_class": data_class,
                        "languages": ["eng"],
                    }
                    for path, payload, rights, data_class in rows
                ],
                sort_keys=True,
                separators=(",", ":"),
            )
            batch_id = service.submit(uploads, metadata)
            self.assertTrue(service.wait_until_idle(10))
            status = service.status(batch_id)
            self.assertEqual(status["status"], "completed")
            self.assertEqual(status["counts"], result["counts"])
            encoded = canonical_json(status)
            self.assertNotIn(str(self.root).encode(), encoded)
            self.assertNotIn(rows[0][1], encoded)
            self.assertNotIn(b"generated searchable control", encoded)

            # The completed service journey exposes every processed source as
            # bounded metadata, then reconstructs both native and OCR output.
            listing = service.readable_documents(batch_id)
            replayed_listing = service.readable_documents(batch_id)
            self.assertEqual(listing, replayed_listing)
            self.assertEqual(listing["batch_id"], batch_id)
            documents = listing["documents"]
            self.assertEqual(len(documents), 97)
            self.assertEqual(
                [document["source_sha256"] for document in documents],
                sorted(document["source_sha256"] for document in documents),
            )
            listing_bytes = canonical_json(listing)
            self.assertLessEqual(len(listing_bytes), 64 * 1024)
            self.assertNotIn(b"generated searchable control", listing_bytes)
            self.assertNotIn(b"items/", listing_bytes)
            self.assertNotIn(b".pdf", listing_bytes)
            self.assertNotIn(b".img", listing_bytes)
            for document in documents:
                self.assertTrue(document["pages"])
                self.assertTrue(document["methods"])
                self.assertGreater(document["chunk_count"], 0)
                self.assertGreater(document["utf8_bytes"], 0)

            native = next(
                document for document in documents if "pdf-text" in document["methods"]
            )
            ocr = next(document for document in documents if "ocr" in document["methods"])
            native_markdown = service.readable_markdown(
                batch_id, native["source_sha256"]
            )
            ocr_markdown = service.readable_markdown(batch_id, ocr["source_sha256"])
            self.assertEqual(
                native_markdown,
                service.readable_markdown(batch_id, native["source_sha256"]),
            )
            self.assertEqual(
                ocr_markdown,
                service.readable_markdown(batch_id, ocr["source_sha256"]),
            )
            self.assertIn(b"# Document " + native["source_sha256"].encode(), native_markdown)
            self.assertIn(b"# Document " + ocr["source_sha256"].encode(), ocr_markdown)
            self.assertIn(b"Provenance: page 1;", native_markdown)
            self.assertIn(b"Provenance: page 1;", ocr_markdown)
            self.assertLessEqual(len(native_markdown), 256 * 1024)
            self.assertLessEqual(len(ocr_markdown), 256 * 1024)

            # Duplicate bytes reuse one readable identity. Failed, rejected,
            # and foreign identities all fail with the same safe 404 reason.
            failed_sha = hashlib.sha256(rows[67][1]).hexdigest()
            rejected_sha = hashlib.sha256(rows[68][1]).hexdigest()
            duplicate_sha = hashlib.sha256(rows[69][1]).hexdigest()
            self.assertEqual(duplicate_sha, hashlib.sha256(rows[0][1]).hexdigest())
            self.assertEqual(
                sum(document["source_sha256"] == duplicate_sha for document in documents),
                1,
            )
            duplicate_markdown = service.readable_markdown(batch_id, duplicate_sha)
            self.assertEqual(
                duplicate_markdown,
                service.readable_markdown(batch_id, duplicate_sha),
            )
            self.assertIn(b"# Document " + duplicate_sha.encode(), duplicate_markdown)
            for source_sha256 in (failed_sha, rejected_sha, "f" * 64):
                with self.subTest(source_sha256=source_sha256):
                    with self.assertRaises(ServiceError) as error:
                        service.readable_markdown(batch_id, source_sha256)
                self.assertEqual(str(error.exception), "readable_result_not_found")

            stored_manifest = json.loads(
                (
                    self.root
                    / "service"
                    / "batches"
                    / batch_id
                    / "manifest.json"
                ).read_text()
            )
            self.assertEqual(stored_manifest["items"][69]["rights"], "unconfirmed")
            self.assertEqual(stored_manifest["items"][69]["data_class"], "restricted")
            self.assertEqual(stored_manifest["items"][71]["data_class"], "confidential")
        finally:
            service.close()

        # Unsupported and over-limit uploads fail before publishing a batch.
        service = DurableBatchService(
            self.root / "rejections",
            config_path=self.config,
            _start_workers=False,
        )
        try:
            with self.assertRaises(ServiceError):
                service.submit([Upload("unsupported.bin", b"not-a-document")], "[]")
            too_large = PDF + b"x" * 4096
            metadata = json.dumps(
                [
                    {
                        "name": "large.pdf",
                        "size": len(too_large),
                        "rights": "confirmed",
                        "data_class": "internal",
                        "languages": ["eng"],
                    }
                ]
            )
            with self.assertRaises(ServiceError):
                service.submit([Upload("large.pdf", too_large)], metadata)
        finally:
            service.close()

        # No provider, Git, or network-client callback exists on these boundaries.
        import ice_maker.document_batch as batch_module
        import ice_maker.document_service as service_module

        for module in (batch_module, service_module):
            source_text = Path(module.__file__).read_text()
            self.assertNotRegex(
                source_text,
                r"\b(requests|urllib|http\.client|socket\.create_connection|subprocess.*git)\b",
            )

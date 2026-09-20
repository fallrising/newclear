import hashlib
import json
import tempfile
import unittest
from types import MappingProxyType
from pathlib import Path

from ice_maker.knowledge_store import (
    IntakeError, SourceStore, load_taxonomy, validate_taxonomy_value,
)


class KnowledgeStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.source = self.root / "sample.pdf"
        self.source.write_bytes(b"%PDF-1.4\nhello\n%%EOF\n")

    def tearDown(self):
        self.tmp.cleanup()

    def test_pdf_intake_hash_dedupes_and_manifest_is_immutable(self):
        store = SourceStore(self.root / "state")
        first = store.ingest(self.source, rights="confirmed", data_class="public")
        renamed = self.root / "renamed.pdf"
        renamed.write_bytes(self.source.read_bytes())
        second = store.ingest(renamed, rights="confirmed", data_class="public")
        self.assertEqual(first, second)
        manifest = json.loads(first.read_text())
        self.assertEqual(manifest["sha256"], hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertEqual(manifest["mime"], "application/pdf")
        self.assertTrue(manifest["provider_eligible"])
        self.assertEqual(manifest["sensitive_findings"], [])
        self.assertEqual((self.root / "state" / manifest["quarantine_object"]).read_bytes(), self.source.read_bytes())

    def test_pbm_magic_and_dimensions_are_accepted(self):
        source = self.root / "page.pbm"
        source.write_bytes(b"P1\n2 1\n1 0\n")
        manifest = json.loads(SourceStore(self.root / "state").ingest(source).read_text())
        self.assertEqual(manifest["mime"], "image/x-portable-bitmap")

    def test_only_phase_zero_classes_and_ascii_p1_are_accepted(self):
        store = SourceStore(self.root / "state")
        with self.assertRaises(IntakeError):
            store.ingest(self.source, data_class="sensitive")
        confidential = self.root / "confidential.pdf"
        confidential.write_bytes(self.source.read_bytes())
        manifest = json.loads(store.ingest(confidential, data_class="confidential").read_text())
        self.assertFalse(manifest["provider_eligible"])
        p4 = self.root / "page.pbm"
        p4.write_bytes(b"P4\n2 1\n\x80")
        with self.assertRaises(IntakeError):
            store.ingest(p4)

    def test_unsafe_sources_fail_before_publication(self):
        store = SourceStore(self.root / "state")
        cases = {
            "empty.pdf": b"",
            "bad.pdf": b"not a pdf",
            "notes.txt": b"hello",
            "control.pdf": b"%PDF-1.4\n\x00\n%%EOF",
        }
        for name, content in cases.items():
            path = self.root / name
            path.write_bytes(content)
            with self.subTest(name=name), self.assertRaises(IntakeError):
                store.ingest(path)
        link = self.root / "link.pdf"
        link.symlink_to(self.source)
        with self.assertRaises(IntakeError):
            store.ingest(link)
        self.assertFalse((self.root / "state").exists())

    def test_intermediate_symlinks_are_rejected(self):
        source_dir = self.root / "real-source"
        source_dir.mkdir()
        source = source_dir / "sample.pdf"
        source.write_bytes(self.source.read_bytes())
        source_link = self.root / "source-link"
        source_link.symlink_to(source_dir, target_is_directory=True)
        with self.assertRaises(IntakeError):
            SourceStore(self.root / "state").ingest(source_link / "sample.pdf")
        real_state = self.root / "real-state"
        real_state.mkdir()
        state_link = self.root / "state-link"
        state_link.symlink_to(real_state, target_is_directory=True)
        with self.assertRaises(IntakeError):
            SourceStore(state_link).ingest(self.source)

    def test_existing_manifest_and_object_are_fully_validated(self):
        state = self.root / "state"
        store = SourceStore(state)
        manifest_path = store.ingest(self.source, rights="confirmed", data_class="public")
        manifest = json.loads(manifest_path.read_text())
        manifest["data_class"] = "restricted"
        manifest_path.write_text(json.dumps(manifest))
        with self.assertRaises(IntakeError):
            store.ingest(self.source, rights="confirmed", data_class="public")

        # A matching manifest cannot bless changed immutable bytes.
        clean_state = self.root / "clean-state"
        clean_store = SourceStore(clean_state)
        clean_manifest_path = clean_store.ingest(self.source, rights="confirmed", data_class="public")
        clean_manifest = json.loads(clean_manifest_path.read_text())
        object_path = clean_state / "quarantine" / clean_manifest["sha256"]
        object_path.write_bytes(b"forged")
        with self.assertRaises(IntakeError):
            clean_store.ingest(self.source, rights="confirmed", data_class="public")

    def test_existing_policy_conflict_does_not_reuse_manifest(self):
        store = SourceStore(self.root / "state")
        store.ingest(self.source, rights="confirmed", data_class="public")
        with self.assertRaises(IntakeError):
            store.ingest(self.source, rights="denied", data_class="public")

    def test_forged_content_derived_policy_fields_are_rejected(self):
        source = self.root / "sensitive.pdf"
        source.write_bytes(b"%PDF-1.4\napi_key=top-secret\n%%EOF\n")
        state = self.root / "state"
        manifest_path = SourceStore(state).ingest(
            source, rights="confirmed", data_class="public"
        )
        forged = json.loads(manifest_path.read_text())
        forged.update({
            "mime": "image/x-portable-bitmap",
            "sensitive_findings": [],
            "provider_eligible": True,
            "local_only": False,
        })
        # This is valid canonical JSON, so duplicate validation must recompute
        # content facts instead of trusting the record's self-description.
        manifest_path.write_text(json.dumps(forged, sort_keys=True, separators=(",", ":")) + "\n")
        before = manifest_path.read_bytes()
        with self.assertRaises(IntakeError):
            SourceStore(state).ingest(source, rights="confirmed", data_class="public")
        self.assertEqual(manifest_path.read_bytes(), before)

    def test_taxonomy_result_is_immutable(self):
        taxonomy = load_taxonomy(Path("knowledge/90-meta/taxonomy.yaml"))
        self.assertIsInstance(taxonomy, MappingProxyType)
        with self.assertRaises(TypeError):
            taxonomy["domains"] = ()

    def test_sensitive_or_unconfirmed_is_local_only_and_values_are_not_recorded(self):
        source = self.root / "secret.pdf"
        source.write_bytes(b"%PDF-1.4\napi_key=super-secret-value\n%%EOF\n")
        manifest_path = SourceStore(self.root / "state").ingest(source, rights="unconfirmed")
        manifest = json.loads(manifest_path.read_text())
        self.assertFalse(manifest["provider_eligible"])
        self.assertEqual(manifest["local_only"], True)
        self.assertIn("secret", manifest["sensitive_findings"])
        self.assertNotIn("super-secret-value", manifest_path.read_text())

    def test_taxonomy_is_canonical_and_fail_closed(self):
        taxonomy = load_taxonomy(Path("knowledge/90-meta/taxonomy.yaml"))
        self.assertTrue(validate_taxonomy_value(taxonomy, "domains", "systems"))
        for value in ("unknown", "systems", "../escape"):
            if value == "systems":
                continue
            self.assertFalse(validate_taxonomy_value(taxonomy, "domains", value))
        self.assertFalse(validate_taxonomy_value(taxonomy, "concepts", "missing"))

    def test_taxonomy_rejects_byte_drift_and_intermediate_symlink(self):
        canonical = Path("knowledge/90-meta/taxonomy.yaml").read_bytes()
        altered = self.root / "taxonomy.yaml"
        altered.write_bytes(canonical + b"# mutable drift\n")
        with self.assertRaises(ValueError):
            load_taxonomy(altered)
        real = self.root / "real-taxonomy"
        real.mkdir()
        (real / "taxonomy.yaml").write_bytes(canonical)
        link = self.root / "taxonomy-link"
        link.symlink_to(real, target_is_directory=True)
        with self.assertRaises(ValueError):
            load_taxonomy(link / "taxonomy.yaml")


if __name__ == "__main__":
    unittest.main()

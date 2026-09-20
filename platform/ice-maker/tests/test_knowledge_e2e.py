"""Subprocess journeys for the local-only knowledge CLI."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
ENV = {"PYTHONPATH": str(ROOT / "src")}
TAXONOMY = """domains:\n  - operations\n  - software\n  - systems\nconcepts:\n  - consistency\n  - idempotency\n  - privacy\n  - provenance\nrelations:\n  - contrasts_with\n  - depends_on\n  - derived_from\n  - example_of\n  - implements\n"""
GLYPHS = {"H": ("101", "101", "111", "101", "101"), "E": ("111", "100", "110", "100", "111"), "L": ("100", "100", "100", "100", "111"), "O": ("010", "101", "101", "101", "010")}


def pdf_text(text: str) -> bytes:
    return ("%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\nBT (" + text + ") Tj ET\n%%EOF\n").encode()


def pdf_scan(text: str) -> bytes:
    columns = list(zip(*(GLYPHS[letter] for letter in text)))
    rows = ["0".join(column) for column in columns]
    pbm = f"P1\n{len(rows[0])} 5\n" + "\n".join(" ".join(row) for row in rows) + "\n"
    return b"%PDF-1.4\n%ICE-MAKER-SYNTHETIC-PDF\n%%ICE-PAGE 1\nstream\n" + pbm.encode() + b"endstream\n%%EOF\n"


class KnowledgeJourneyTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.repo = Path(self.temp.name)
        (self.repo / ".git").mkdir()
        taxonomy = self.repo / "knowledge/90-meta/taxonomy.yaml"
        taxonomy.parent.mkdir(parents=True)
        taxonomy.write_text(TAXONOMY)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def cli(self, *args: str, ok: bool = True) -> dict[str, object]:
        result = subprocess.run(["python3", "-m", "ice_maker.knowledge_cli", *args], cwd=self.repo,
                                env=ENV, text=True, capture_output=True)
        self.assertEqual(result.returncode, 0 if ok else 2, result.stderr)
        return json.loads(result.stdout) if ok else {"stderr": result.stderr}

    def journey(self, source: Path, query: str) -> dict[str, object]:
        manifest = self.cli("ingest", str(source), "--rights", "confirmed", "--data-class", "internal")
        extraction = self.cli("extract", "--manifest", manifest["manifest_id"])
        indexed = self.cli("index", "--manifest", manifest["manifest_id"], "--extraction", extraction["extraction_id"])
        return self.cli("propose", "--manifest", manifest["manifest_id"], "--index", indexed["index_id"],
                        "--query", query, "--destination", "concepts/idempotency", "--conclusion", "local evidence")

    def test_text_and_scanned_pdfs_are_searchable_cited_unpromoted_and_rebuild(self) -> None:
        text, scan = self.repo / "text.pdf", self.repo / "scan.pdf"
        text.write_bytes(pdf_text("idempotency local evidence")); scan.write_bytes(pdf_scan("HELLO"))
        first = self.journey(text, "idempotency")
        second = self.journey(scan, "HELLO")
        for proposal in (first, second):
            self.assertEqual(proposal["status"], "unpromoted")
            self.assertTrue(proposal["citations"])
            self.assertEqual(set(proposal["citations"][0]), {"chunk_id", "method", "page_number", "region", "source_sha256"})
            self.assertEqual(proposal["conclusion_citations"][0]["citation_ids"], [proposal["citations"][0]["chunk_id"]])
        state = self.repo / ".ice-maker/knowledge"
        before = json.dumps(first, sort_keys=True, separators=(",", ":"))
        import shutil
        shutil.rmtree(state)
        rebuilt = self.journey(text, "idempotency")
        self.assertEqual(before, json.dumps(rebuilt, sort_keys=True, separators=(",", ":")))

    def test_duplicate_reuses_ocr_and_unsafe_input_cannot_propose(self) -> None:
        scan, renamed = self.repo / "scan.pdf", self.repo / "renamed.pdf"
        scan.write_bytes(pdf_scan("HELLO")); renamed.write_bytes(scan.read_bytes())
        manifest = self.cli("ingest", str(scan), "--rights", "confirmed", "--data-class", "internal")
        self.cli("extract", "--manifest", manifest["manifest_id"])
        cache = self.repo / ".ice-maker/knowledge/extractions"
        self.assertEqual(len(list(cache.glob("*.json"))), 1)
        duplicate = self.cli("ingest", str(renamed), "--rights", "confirmed", "--data-class", "internal")
        self.assertEqual(manifest["manifest_id"], duplicate["manifest_id"])
        self.assertTrue(duplicate["duplicate"])
        self.cli("extract", "--manifest", duplicate["manifest_id"])
        self.assertEqual(len(list(cache.glob("*.json"))), 1)
        restricted = self.repo / "restricted.pdf"; restricted.write_bytes(pdf_text("privacy evidence"))
        bad = self.cli("ingest", str(restricted), "--rights", "unconfirmed", "--data-class", "restricted")
        extraction = self.cli("extract", "--manifest", bad["manifest_id"])
        indexed = self.cli("index", "--manifest", bad["manifest_id"], "--extraction", extraction["extraction_id"])
        failed = self.cli("propose", "--manifest", bad["manifest_id"], "--index", indexed["index_id"], "--query", "privacy", "--destination", "concepts/idempotency", "--conclusion", "blocked", ok=False)
        self.assertIn("provider eligible", failed["stderr"])

    def test_sensitive_rights_and_taxonomy_gates_fail_closed(self) -> None:
        for name, content, rights, data_class, destination in (
            ("sensitive", pdf_text("token: value"), "confirmed", "internal", "concepts/idempotency"),
            ("rights", pdf_text("privacy evidence"), "unconfirmed", "internal", "concepts/idempotency"),
            ("taxonomy", pdf_text("provenance evidence"), "confirmed", "internal", "concepts/not_a_value"),
        ):
            source = self.repo / f"{name}.pdf"; source.write_bytes(content)
            manifest = self.cli("ingest", str(source), "--rights", rights, "--data-class", data_class)
            if name == "sensitive":
                # Secret-like text cannot cross the extraction boundary either.
                failed = self.cli("extract", "--manifest", manifest["manifest_id"], ok=False)
                self.assertIn("unsafe extracted output", failed["stderr"])
                continue
            extraction = self.cli("extract", "--manifest", manifest["manifest_id"])
            indexed = self.cli("index", "--manifest", manifest["manifest_id"], "--extraction", extraction["extraction_id"])
            query = "provenance" if name == "taxonomy" else "privacy"
            failed = self.cli("propose", "--manifest", manifest["manifest_id"], "--index", indexed["index_id"], "--query", query, "--destination", destination, "--conclusion", "blocked", ok=False)
            self.assertTrue("provider eligible" in failed["stderr"] or "taxonomy-valid" in failed["stderr"])

    def test_stages_require_immutable_prior_evidence_and_bound_retrieval(self) -> None:
        first, second = self.repo / "first.pdf", self.repo / "second.pdf"
        first.write_bytes(pdf_text("alpha idempotency")); second.write_bytes(pdf_text("bravo provenance"))
        a = self.cli("ingest", str(first), "--rights", "confirmed", "--data-class", "internal")
        # An ingest hash is not extraction evidence; index must not silently extract.
        failed = self.cli("index", "--manifest", a["manifest_id"], "--extraction", a["manifest_id"], ok=False)
        self.assertIn("extract evidence", failed["stderr"])
        ax = self.cli("extract", "--manifest", a["manifest_id"])
        ai = self.cli("index", "--manifest", a["manifest_id"], "--extraction", ax["extraction_id"])
        b = self.cli("ingest", str(second), "--rights", "confirmed", "--data-class", "internal")
        bx = self.cli("extract", "--manifest", b["manifest_id"])
        self.cli("index", "--manifest", b["manifest_id"], "--extraction", bx["extraction_id"])
        # A's per-index database cannot retrieve B's otherwise-searchable row.
        failed = self.cli("propose", "--manifest", a["manifest_id"], "--index", ai["index_id"], "--query", "bravo", "--destination", "concepts/idempotency", "--conclusion", "must bind", ok=False)
        self.assertIn("cited source", failed["stderr"])

    def test_tampering_symlinks_and_unsafe_state_roots_fail_closed(self) -> None:
        source = self.repo / "safe.pdf"; source.write_bytes(pdf_text("privacy evidence"))
        manifest = self.cli("ingest", str(source), "--rights", "confirmed", "--data-class", "internal")
        extracted = self.cli("extract", "--manifest", manifest["manifest_id"])
        evidence = self.repo / ".ice-maker/knowledge/results/extract" / f"{extracted['extraction_id']}.json"
        value = json.loads(evidence.read_text()); value["chunks"][0]["text"] = "forged"
        evidence.write_text(json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n")
        failed = self.cli("index", "--manifest", manifest["manifest_id"], "--extraction", extracted["extraction_id"], ok=False)
        self.assertIn("identifier", failed["stderr"])
        # Restore a fresh immutable extraction record, then forge policy while
        # preserving canonical JSON: immutable source bytes still win.
        evidence.unlink(); extracted = self.cli("extract", "--manifest", manifest["manifest_id"])
        indexed = self.cli("index", "--manifest", manifest["manifest_id"], "--extraction", extracted["extraction_id"])
        manifest_path = self.repo / ".ice-maker/knowledge/manifests" / f"{manifest['manifest_id']}.json"
        original_manifest = manifest_path.read_bytes()
        policy = json.loads(manifest_path.read_text()); policy["provider_eligible"] = False; policy["local_only"] = True
        manifest_path.write_text(json.dumps(policy, sort_keys=True, separators=(",", ":")) + "\n")
        failed = self.cli("propose", "--manifest", manifest["manifest_id"], "--index", indexed["index_id"], "--query", "privacy", "--destination", "concepts/privacy", "--conclusion", "forged", ok=False)
        self.assertIn("immutable source policy", failed["stderr"])
        # The proposal/index evidence reader refuses symlink indirection too.
        manifest_path.write_bytes(original_manifest)
        index_path = self.repo / ".ice-maker/knowledge/results/index" / f"{indexed['index_id']}.json"
        index_path.unlink(); index_path.symlink_to(self.repo / "safe.pdf")
        failed = self.cli("propose", "--manifest", manifest["manifest_id"], "--index", indexed["index_id"], "--query", "privacy", "--destination", "concepts/privacy", "--conclusion", "link", ok=False)
        self.assertIn("symlink", failed["stderr"])
        for root in (".git/state", "knowledge/state", "../outside"):
            failed = self.cli("--state-root", root, "ingest", str(source), ok=False)
            self.assertIn("state", failed["stderr"])

import dataclasses
import hashlib
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from io import StringIO
from pathlib import Path
from unittest import mock

from ice_maker import study_export
from ice_maker.study_cli import main as cli_main
from ice_maker.study_export import (
    StudyBundle,
    StudyExportError,
    export_study,
    load_publication_config,
)


def canonical(value):
    return (
        json.dumps(
            value, sort_keys=True, separators=(",", ":"), ensure_ascii=True,
            allow_nan=False,
        )
        + "\n"
    ).encode("ascii")


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def record(kind, body):
    identifier = digest({"body": body, "kind": kind})
    return identifier, {"body": body, "id": identifier, "kind": kind}


def fixture(
    *,
    slug="one-study",
    sensitivity="Public",
    rights="confirmed",
    title="One study",
    question="What does the reviewed source establish?",
    finding="Reviewed finding.",
    provenance="Local reviewed evidence",
    qa_disposition="Accepted",
    claim_source_id="SRC-001",
    claim_chunk_id=None,
):
    binding = "a" * 64
    source_sha256 = "b" * 64
    extraction_sha256 = "c" * 64
    chunk_id = "d" * 64
    chunk_body = {
        "chunk_id": chunk_id,
        "confidence": 0.9,
        "config_digest": binding,
        "extraction_sha256": extraction_sha256,
        "method": "ocr",
        "page_number": 1,
        "region": "pixels:1,2,3,4",
        "source_batch_digest": binding,
        "source_sha256": source_sha256,
        "text_sha256": "e" * 64,
        "tool_digest": binding,
    }
    chunk_record_id, chunk = record("chunk", chunk_body)
    publication = "aggregate" if sensitivity == "Restricted" else "metadata"
    source_body = {
        "chunk_evidence_ids": [chunk_record_id],
        "config_digest": binding,
        "content_sha256": source_sha256,
        "extraction_sha256": extraction_sha256,
        "provenance": provenance,
        "publication": publication,
        "redistribution": "No raw redistribution",
        "rights": rights,
        "sensitivity": sensitivity,
        "source_batch_digest": binding,
        "source_id": "SRC-001",
        "tool_digest": binding,
    }
    source_record_id, source = record("source", source_body)
    analysis_body = {
        "claims": [{
            "chunk_ids": [claim_chunk_id or chunk_id],
            "claim": "The source supports the bounded conclusion.",
            "evidence": "Confirmed",
            "finding": finding,
            "missing_proof": "None.",
            "source_ids": [claim_source_id],
        }],
        "publication": (
            "aggregate" if sensitivity == "Restricted" else "approved-analysis"
        ),
        "study_slug": slug,
    }
    analysis_id, analysis = record("analysis", analysis_body)
    qa_body = {
        "analysis_ids": [analysis_id],
        "disposition": qa_disposition,
        "finding": "Citation checked.",
        "reviewer": "reviewer",
        "study_slug": slug,
    }
    qa_id, qa = record("qa", qa_body)
    decisions = {}
    decision_ids = []
    for artifact_id in (source_record_id, chunk_record_id, analysis_id, qa_id):
        decision_id, decision = record("decision", {
            "approver": "owner",
            "artifact_id": artifact_id,
            "decision": "Approved",
            "scope": "artifact",
            "study_slug": slug,
        })
        decisions[decision_id] = decision
        decision_ids.append(decision_id)
    publication_id, publication_decision = record("decision", {
        "approver": "owner",
        "artifact_id": "publication:" + slug,
        "decision": "Approved",
        "scope": "publication",
        "study_slug": slug,
    })
    decisions[publication_id] = publication_decision
    decision_ids.append(publication_id)
    evidence = {
        "analyses": {analysis_id: analysis},
        "chunks": {chunk_record_id: chunk},
        "decisions": decisions,
        "qa": {qa_id: qa},
        "sources": {source_record_id: source},
    }
    request = {
        "analysis_ids": [analysis_id],
        "config_digest": binding,
        "decision_ids": sorted(decision_ids),
        "evidence_cutoff": "2026-09-03",
        "evidence_ledger_sha256": digest(evidence),
        "owner": "owner",
        "qa_ids": [qa_id],
        "research_question": question,
        "sensitivity": sensitivity,
        "slug": slug,
        "source_batch_digest": binding,
        "source_ids": [source_record_id],
        "supersedes": [],
        "title": title,
        "tool_digest": binding,
    }
    metadata = {
        "analysis_id": analysis_id,
        "chunk_id": chunk_id,
        "chunk_record_id": chunk_record_id,
        "qa_id": qa_id,
        "source_record_id": source_record_id,
    }
    return request, evidence, metadata


class StudyExportTests(unittest.TestCase):
    def export(self, root, **kwargs):
        request, evidence, metadata = fixture(**kwargs)
        bundle = export_study(request, evidence, Path(root).resolve())
        return request, evidence, metadata, bundle

    def test_deterministic_native_bundle_has_exact_tree(self):
        with tempfile.TemporaryDirectory() as directory:
            request, _, _, first = self.export(directory)
            second = export_study(*fixture()[:2], Path(directory).resolve())
            self.assertEqual(first, second)
            self.assertEqual(first.artifact_count, 6)
            bundle = Path(directory) / first.bundle_name
            actual = {
                str(path.relative_to(bundle))
                for path in bundle.rglob("*") if path.is_file()
            }
            self.assertEqual(actual, {
                "manifest.json",
                "registry-row.md",
                "studies/one-study/README.md",
                "studies/one-study/analysis/overview.md",
                "studies/one-study/analysis/qa-review.md",
                "studies/one-study/progress.md",
                "studies/one-study/sources.md",
            })
            readme = (bundle / "studies/one-study/README.md").read_text()
            sources = (bundle / "studies/one-study/sources.md").read_text()
            registry = (bundle / "registry-row.md").read_text()
            self.assertIn("| Slug | `one-study` |", readme)
            self.assertIn("## Evidence boundary", readme)
            self.assertIn("## Publication approvals", sources)
            self.assertEqual(registry.count("|"), 6)
            self.assertNotIn(str(Path(directory).resolve()), readme)
            self.assertEqual(request["slug"], "one-study")

    def test_manifest_binds_source_chunk_qa_and_decision_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            request, _, metadata, bundle = self.export(directory)
            manifest = json.loads(
                (Path(directory) / bundle.bundle_name / "manifest.json").read_text()
            )
            self.assertEqual(manifest["aggregate_digest"], bundle.bundle_id)
            self.assertEqual(manifest["source_ids"], ["SRC-001"])
            self.assertEqual(manifest["source_record_ids"], [metadata["source_record_id"]])
            self.assertEqual(manifest["chunk_ids"], [metadata["chunk_id"]])
            self.assertEqual(
                manifest["chunk_evidence_ids"], [metadata["chunk_record_id"]],
            )
            self.assertEqual(manifest["evidence_ledger_sha256"], request["evidence_ledger_sha256"])
            encoded = canonical(manifest)
            self.assertNotIn(str(Path(directory).resolve()).encode(), encoded)
            self.assertNotIn(b"extracted text", encoded)

    def test_forged_records_and_binding_drift_fail_closed(self):
        request, evidence, metadata = fixture()
        cases = []
        forged = json.loads(json.dumps(evidence))
        forged["chunks"][metadata["chunk_record_id"]]["body"]["page_number"] = 2
        cases.append((request, forged))
        drift = dict(request)
        drift["config_digest"] = "f" * 64
        cases.append((drift, evidence))
        ledger_drift = dict(request)
        ledger_drift["evidence_ledger_sha256"] = "f" * 64
        cases.append((ledger_drift, evidence))
        for bad_request, bad_evidence in cases:
            with self.subTest(case=len(cases)):
                with tempfile.TemporaryDirectory() as directory:
                    with self.assertRaises(StudyExportError):
                        export_study(bad_request, bad_evidence, Path(directory).resolve())

    def test_dangling_and_incomplete_citations_fail_closed(self):
        for options in (
            {"claim_source_id": "SRC-999"},
            {"claim_chunk_id": "f" * 64},
        ):
            request, evidence, _ = fixture(**options)
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(StudyExportError):
                    export_study(request, evidence, Path(directory).resolve())

    def test_missing_stale_or_extra_approval_fails_closed(self):
        request, evidence, _ = fixture()
        request["decision_ids"] = request["decision_ids"][:-1]
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(StudyExportError):
            export_study(request, evidence, Path(directory).resolve())
        request, evidence, _ = fixture()
        extra_id, extra = record("decision", {
            "approver": "owner", "artifact_id": "f" * 64,
            "decision": "Approved", "scope": "artifact", "study_slug": "one-study",
        })
        evidence["decisions"][extra_id] = extra
        request["decision_ids"] = sorted(request["decision_ids"] + [extra_id])
        request["evidence_ledger_sha256"] = digest(evidence)
        with tempfile.TemporaryDirectory() as directory, self.assertRaises(StudyExportError):
            export_study(request, evidence, Path(directory).resolve())

    def test_rights_sensitivity_and_review_boundaries(self):
        for sensitivity in ("Public", "Internal", "Restricted"):
            with self.subTest(sensitivity=sensitivity), tempfile.TemporaryDirectory() as directory:
                self.export(directory, sensitivity=sensitivity)
        for options in (
            {"sensitivity": "Prohibited"},
            {"rights": "unconfirmed"},
            {"qa_disposition": "Rejected"},
        ):
            request, evidence, _ = fixture(**options)
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(StudyExportError):
                    export_study(request, evidence, Path(directory).resolve())

    def test_untrusted_rendered_text_is_strictly_safe(self):
        cases = (
            {"title": "[link](elsewhere)"},
            {"question": "See https://example.invalid"},
            {"finding": "token: leak"},
            {"finding": "<script>alert(1)</script>"},
            {"finding": "Contact a@example.com"},
            {"finding": "Service 127.0.0.1"},
            {"provenance": "/tmp/private/source.pdf"},
            {"finding": "right\u202eevil"},
            {"finding": "line\nfeed"},
            {"title": "Ｏne study"},
        )
        for options in cases:
            request, evidence, _ = fixture(**options)
            with self.subTest(options=options), tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(StudyExportError):
                    export_study(request, evidence, Path(directory).resolve())

    def test_config_is_canonical_exact_bounded_and_no_follow(self):
        default = Path(__file__).resolve().parents[1] / "config/study-publication.json"
        config = json.loads(default.read_text())
        self.assertEqual(load_publication_config(default)["config_version"], "study-publication.v1")
        mutations = []
        unknown = dict(config)
        unknown["unknown"] = True
        mutations.append(canonical(unknown))
        raised = dict(config)
        raised["max_sources"] = 101
        mutations.append(canonical(raised))
        mutations.append(json.dumps(config).encode())
        mutations.append(default.read_bytes().replace(b'"max_sources":100', b'"max_sources":100,"max_sources":100'))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            for index, content in enumerate(mutations):
                path = root / f"bad-{index}.json"
                path.write_bytes(content)
                with self.subTest(index=index), self.assertRaises(StudyExportError):
                    load_publication_config(path)
            link = root / "linked.json"
            link.symlink_to(default)
            with self.assertRaises(StudyExportError):
                load_publication_config(link)

    def test_state_root_and_existing_bundle_fail_closed(self):
        request, evidence, _ = fixture()
        with self.assertRaises(StudyExportError):
            export_study(request, evidence, "relative")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            real = root / "real"
            real.mkdir()
            linked = root / "linked"
            linked.symlink_to(real, target_is_directory=True)
            with self.assertRaises(StudyExportError):
                export_study(request, evidence, linked)
            bundle = export_study(request, evidence, real)
            bundle_root = real / bundle.bundle_name
            (bundle_root / "extra.txt").write_text("extra")
            with self.assertRaises(StudyExportError):
                export_study(request, evidence, real)
            (bundle_root / "extra.txt").unlink()
            (bundle_root / "manifest.json").write_text("{}\n")
            with self.assertRaises(StudyExportError):
                export_study(request, evidence, real)

    def test_atomic_collision_and_interruption_do_not_publish_partial_bundle(self):
        request, evidence, _ = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            with mock.patch.object(
                study_export, "_rename_noreplace",
                side_effect=FileExistsError(os.errno if hasattr(os, "errno") else 17, "race"),
            ):
                with self.assertRaises(StudyExportError):
                    export_study(request, evidence, root)
            self.assertFalse(any(path.name.startswith(".study-") for path in root.iterdir()))
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            (root / "sentinel").write_text("keep")
            real_write = study_export._write_at
            calls = 0

            def interrupted(*args):
                nonlocal calls
                calls += 1
                if calls == 3:
                    raise OSError("interrupted")
                return real_write(*args)

            with mock.patch.object(study_export, "_write_at", side_effect=interrupted):
                with self.assertRaises(StudyExportError):
                    export_study(request, evidence, root)
            self.assertEqual({path.name for path in root.iterdir()}, {"sentinel"})

    def test_distinct_study_slugs_produce_distinct_immutable_bundles(self):
        with tempfile.TemporaryDirectory() as directory:
            one = self.export(directory, slug="one-study")[3]
            two = self.export(directory, slug="two-study")[3]
            self.assertNotEqual(one.bundle_id, two.bundle_id)
            self.assertTrue((Path(directory) / one.bundle_name).is_dir())
            self.assertTrue((Path(directory) / two.bundle_name).is_dir())

    def test_cli_requires_canonical_regular_absolute_inputs_and_leaks_no_path(self):
        request, evidence, _ = fixture()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            request_path = root / "request.json"
            evidence_path = root / "evidence.json"
            request_path.write_bytes(canonical(request))
            evidence_path.write_bytes(canonical(evidence))
            output, errors = StringIO(), StringIO()
            with redirect_stdout(output), redirect_stderr(errors):
                status = cli_main([
                    "export", "--request", str(request_path), "--evidence",
                    str(evidence_path), "--state-root", str(root / "state"),
                ])
            self.assertEqual(status, 0)
            result = json.loads(output.getvalue())
            self.assertEqual(set(result), {
                "artifact_count", "bundle_id", "bundle_name", "manifest_sha256",
            })
            self.assertNotIn(str(root), output.getvalue())
            self.assertEqual(errors.getvalue(), "")
            request_path.write_text(json.dumps(request))
            output, errors = StringIO(), StringIO()
            with redirect_stdout(output), redirect_stderr(errors):
                status = cli_main([
                    "export", "--request", str(request_path), "--evidence",
                    str(evidence_path), "--state-root", str(root / "state-2"),
                ])
            self.assertEqual(status, 2)
            self.assertEqual(output.getvalue() + errors.getvalue(), "")
            request_path.unlink()
            request_path.symlink_to(evidence_path)
            with redirect_stdout(StringIO()), redirect_stderr(StringIO()):
                status = cli_main([
                    "export", "--request", str(request_path), "--evidence",
                    str(evidence_path), "--state-root", str(root / "state-3"),
                ])
            self.assertEqual(status, 2)

    def test_bundle_result_is_frozen_and_cannot_encode_a_path(self):
        bundle = StudyBundle("a" * 64, "a" * 64, "b" * 64, 6)
        self.assertFalse(hasattr(bundle, "bundle_path"))
        with self.assertRaises(dataclasses.FrozenInstanceError):
            bundle.bundle_name = "changed"
        with self.assertRaises(StudyExportError):
            StudyBundle("bad", "bad", "b" * 64, 6)


if __name__ == "__main__":
    unittest.main()

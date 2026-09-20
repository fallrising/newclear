import hashlib
import io
import json
import os
import stat
import tempfile
import unittest
from unittest import mock
from pathlib import Path

import ice_maker.document_batch as document_batch
import ice_maker.knowledge_cli as knowledge_cli
from ice_maker.document_batch import (
    BatchContractError, BatchManifest, BatchItem, CHECKPOINT_SCHEMA, CODE_MAXIMA,
    ProductionToolchain, SourceDescriptor,
    discover_sources, load_config, load_checkpoint, make_result,
    publish_checkpoint, result_bytes, transition_status, validate_manifest, run_batch,
)
from ice_maker.extraction import ExtractedChunk
from ice_maker.production_extraction import (
    EXTRACTOR_VERSION, METHOD, OcrWord, RasterExtraction, Tile,
)


class DocumentBatchContractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def manifest_bytes(self, path="docs/a.pdf"):
        return json.dumps({"items": [{"data_class": "internal", "languages": ["eng"],
            "path": path, "rights": "confirmed"}],
            "schema_version": "document-batch-manifest.v1"}, sort_keys=True,
            separators=(",", ":"), ensure_ascii=True).encode() + b"\n"

    def test_manifest_is_strict_and_frozen(self):
        manifest = validate_manifest(self.manifest_bytes())
        self.assertIsInstance(manifest, BatchManifest)
        with self.assertRaises(Exception): manifest.items[0].path = "x"
        with self.assertRaises(BatchContractError):
            validate_manifest(self.manifest_bytes().replace(b'"path":"docs/a.pdf"', b'"path":"/tmp/a.pdf"'))
        duplicate = self.manifest_bytes().replace(b'"items":[{', b'"items":[{"path":"x",')
        with self.assertRaises(BatchContractError): validate_manifest(duplicate)

    def test_manifest_boundaries_policy_languages_and_paths(self):
        for count in (0, 101):
            raw = json.loads(self.manifest_bytes())
            raw["items"] = [dict(raw["items"][0], path=f"docs/{i}.pdf") for i in range(count)]
            encoded = json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n"
            with self.assertRaises(BatchContractError): validate_manifest(encoded)
        for bad in (
            "/absolute",
            "../escape",
            "a/../b",
            "a\\b",
            "a\x00b",
            "a\nb",
            "./a.pdf",
        ):
            with self.assertRaises(BatchContractError): validate_manifest(self.manifest_bytes(bad))
        for rights, data_class, languages in (("maybe", "internal", ["eng"]),
                                               ("confirmed", "secret", ["eng"]),
                                               ("confirmed", "internal", []),
                                               ("confirmed", "internal", ["eng", "eng"]),
                                               ("confirmed", "internal", ["eng+chi_tra"]),
                                               ("confirmed", "internal", ["z bad"])):
            raw = json.loads(self.manifest_bytes())
            raw["items"][0].update(rights=rights, data_class=data_class, languages=languages)
            with self.assertRaises(BatchContractError):
                validate_manifest(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        raw = json.loads(self.manifest_bytes())
        raw["items"].append(dict(raw["items"][0], path="docs/a.pdf"))
        with self.assertRaises(BatchContractError):
            validate_manifest(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        raw["items"][1]["path"] = "docs/b.pdf"
        raw["items"].reverse()
        with self.assertRaises(BatchContractError):
            validate_manifest(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n")

    def test_manifest_rejects_unknown_fields_and_noncanonical_bytes(self):
        raw = json.loads(self.manifest_bytes())
        raw["extra"] = True
        with self.assertRaises(BatchContractError):
            validate_manifest(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        with self.assertRaises(BatchContractError): validate_manifest(self.manifest_bytes().rstrip())

    def test_discovery_uses_signature_and_rejects_links_and_aliases(self):
        root = self.root / "input"; (root / "docs").mkdir(parents=True)
        (root / "docs/a.any").write_bytes(b"%PDF-1.7\nvalid")
        manifest = validate_manifest(self.manifest_bytes("docs/a.any"))
        found = discover_sources(manifest, root)
        self.assertEqual(found[0].signature, "pdf")
        link = root / "docs/link.any"; link.symlink_to(root / "docs/a.any")
        with self.assertRaises(BatchContractError):
            discover_sources(validate_manifest(self.manifest_bytes("docs/link.any")), root)

    def test_discovery_all_signatures_and_adversarial_files(self):
        root = self.root / "input"; root.mkdir()
        fixtures = {"a": b"%PDF-1.7\n", "b": b"\x89PNG\r\n\x1a\n", "c": b"\xff\xd8\xffx",
                    "d": b"RIFFxxxxWEBP"}
        for name, content in fixtures.items(): (root / name).write_bytes(content)
        raw = json.loads(self.manifest_bytes())
        raw["items"] = [{**raw["items"][0], "path": name} for name in fixtures]
        manifest = validate_manifest(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        self.assertEqual([x.signature for x in discover_sources(manifest, root)], ["pdf", "png", "jpeg", "webp"])
        for name, content in (("empty", b""), ("bad", b"not a source")):
            (root / name).write_bytes(content)
            bad = dict(raw["items"][0], path=name)
            with self.assertRaises(BatchContractError):
                discover_sources(validate_manifest(json.dumps({"items": [bad], "schema_version": raw["schema_version"]}, sort_keys=True, separators=(",", ":")).encode() + b"\n"), root)
        (root / "alias").hardlink_to(root / "a")
        bad_items = [dict(raw["items"][0], path="a"), dict(raw["items"][0], path="alias")]
        with self.assertRaises(BatchContractError):
            discover_sources(validate_manifest(json.dumps({"items": bad_items, "schema_version": raw["schema_version"]}, sort_keys=True, separators=(",", ":")).encode() + b"\n"), root)

    def test_discovery_read_seams_reject_short_read_and_mutation(self):
        root = self.root / "input"; root.mkdir(); source = root / "a"
        source.write_bytes(b"%PDF-1.7\ncontent")
        manifest = validate_manifest(self.manifest_bytes("a"))
        config = load_config()
        with mock.patch("ice_maker.document_batch.os.read", return_value=b""):
            with self.assertRaises(BatchContractError): discover_sources(manifest, root, config)
        with mock.patch("ice_maker.document_batch._identity_changed", return_value=True):
            with self.assertRaises(BatchContractError): discover_sources(manifest, root, config)

    def test_discovery_streams_bounds_links_and_link_count(self):
        root = self.root / "input"; nested = root / "nested"; nested.mkdir(parents=True)
        payload = b"%PDF-1.7\n" + (b"x" * 130000)
        (nested / "a").write_bytes(payload)
        manifest = validate_manifest(self.manifest_bytes("nested/a"))
        reads = []
        original_read = os.read
        def track_reads(fd, size):
            reads.append(size)
            return original_read(fd, size)
        with mock.patch("ice_maker.document_batch.os.read", side_effect=track_reads):
            descriptor = discover_sources(manifest, root, load_config())[0]
        self.assertEqual(descriptor.size, len(payload))
        self.assertGreaterEqual(len(reads), 3)
        self.assertLessEqual(max(reads), 65536)
        (nested / "alias").hardlink_to(nested / "a")
        with self.assertRaises(BatchContractError):
            discover_sources(validate_manifest(self.manifest_bytes("nested/a")), root)
        (nested / "empty").write_bytes(b"")
        with self.assertRaises(BatchContractError):
            discover_sources(validate_manifest(self.manifest_bytes("nested/empty")), root)
        low_file = load_config(overrides={"max_file_bytes": 4})
        with self.assertRaises(BatchContractError): discover_sources(manifest, root, low_file)
        two = json.loads(self.manifest_bytes("nested/a")); two["items"].append(dict(two["items"][0], path="nested/b"))
        (nested / "b").write_bytes(b"%PDF-2")
        canonical = json.dumps(two, sort_keys=True, separators=(",", ":")).encode() + b"\n"
        with self.assertRaises(BatchContractError):
            discover_sources(validate_manifest(canonical), root, load_config(overrides={"max_aggregate_bytes": len(payload)}))
        linked_root = self.root / "linked-root"; linked_root.symlink_to(root)
        with self.assertRaises(BatchContractError): discover_sources(manifest, linked_root)
        linked_dir = root / "linked-dir"; linked_dir.symlink_to(nested)
        with self.assertRaises(BatchContractError): discover_sources(validate_manifest(self.manifest_bytes("linked-dir/a")), root)

    def test_manifest_and_config_bounds_are_exact(self):
        with self.assertRaises(BatchContractError): validate_manifest(b" " * (4 * 1024 * 1024 + 1))
        with self.assertRaises(BatchContractError): BatchItem("a", "confirmed", "internal", ("e" * 65,))
        with self.assertRaises(BatchContractError): BatchManifest(("not-an-item",))
        with self.assertRaises(BatchContractError):
            BatchItem("a" * 1025, "confirmed", "internal", ("eng",))
        with self.assertRaises(BatchContractError):
            BatchItem("a", [], "internal", ("eng",))
        with self.assertRaises(BatchContractError):
            BatchItem("a", "confirmed", {}, ("eng",))
        from ice_maker.document_batch import CODE_MAXIMA
        for key, maximum in CODE_MAXIMA.items():
            with self.assertRaises(BatchContractError): load_config(overrides={key: 0})
            with self.assertRaises(BatchContractError): load_config(overrides={key: -1})
            with self.assertRaises(BatchContractError): load_config(overrides={key: True})
            with self.assertRaises(BatchContractError): load_config(overrides={key: maximum + 1})
        with self.assertRaises(BatchContractError): load_config(overrides={"tile_height_pixels": 128, "tile_overlap_pixels": 128})

    def test_discovery_pins_root_and_rejects_intermediate_link_swap(self):
        root = self.root / "input"
        nested = root / "nested"
        outside = self.root / "outside"
        nested.mkdir(parents=True)
        outside.mkdir()
        (nested / "a").write_bytes(b"%PDF-safe")
        (outside / "a").write_bytes(b"%PDF-outside")
        manifest = validate_manifest(self.manifest_bytes("nested/a"))
        original_reject = document_batch._reject_links
        swapped = False

        def swap_after_check(path):
            nonlocal swapped
            original_reject(path)
            if Path(path) == nested / "a" and not swapped:
                nested.rename(root / "moved")
                nested.symlink_to(outside)
                swapped = True

        with mock.patch(
            "ice_maker.document_batch._reject_links",
            side_effect=swap_after_check,
        ):
            with self.assertRaises(BatchContractError):
                discover_sources(manifest, root, load_config())

    def test_public_descriptor_and_duplicate_result_cannot_be_forged(self):
        item = BatchItem("a", "confirmed", "internal", ("eng",))
        later_item = BatchItem("b", "confirmed", "internal", ("eng",))
        for values in (
            (item, 0, "a" * 64, "pdf", None),
            (item, 1, "not-a-hash", "pdf", None),
            (item, 1, "a" * 64, "exe", None),
            (item, 1, "a" * 64, "pdf", "/absolute"),
            (later_item, 1, "a" * 64, "pdf", "c"),
        ):
            with self.assertRaises(BatchContractError):
                SourceDescriptor(*values)

        manifest = validate_manifest(self.manifest_bytes())
        forged = {
            "schema_version": "document-batch-result.v1",
            "manifest_sha256": manifest.digest,
            "counts": {
                "processed": 0,
                "duplicate": 1,
                "rejected": 0,
                "failed": 0,
            },
            "items": [{
                "path": "docs/a.pdf",
                "status": "duplicate",
                "sha256": "a" * 64,
                "duplicate_of": "docs/later.pdf",
            }],
        }
        with self.assertRaises(BatchContractError):
            result_bytes(forged)
        with self.assertRaises(BatchContractError):
            result_bytes({
                "schema_version": "document-batch-result.v1",
                "manifest_sha256": manifest.digest,
                "counts": {
                    "processed": 0,
                    "duplicate": 0,
                    "rejected": 0,
                    "failed": 0,
                },
                "items": [],
            })

    def test_symlinks_nonregular_and_config_limits(self):
        root = self.root / "input"; root.mkdir(); (root / "a").write_bytes(b"%PDF-x")
        (root / "link").symlink_to(root / "a")
        raw = json.loads(self.manifest_bytes("link"))
        with self.assertRaises(BatchContractError):
            discover_sources(validate_manifest(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n"), root)
        with self.assertRaises(BatchContractError): load_config(overrides={"max_items": 101})
        with self.assertRaises(BatchContractError): load_config(overrides={"max_items": True})
        with self.assertRaises(BatchContractError): load_config(overrides={"nope": 1})
        with self.assertRaises(BatchContractError): load_config(overrides={"tile_overlap_pixels": load_config()["limits"]["max_tile_pixels"]})

    def test_bounds_policy_result_and_checkpoint_are_content_addressed(self):
        config = load_config()
        self.assertEqual(config["limits"]["max_items"], 100)
        with self.assertRaises(BatchContractError): load_config(overrides={"max_workers": 3})
        manifest = validate_manifest(self.manifest_bytes())
        result = make_result(manifest, [{"path": "docs/a.pdf", "status": "failed", "reason": "bad"}])
        self.assertEqual(result["counts"]["failed"], 1)
        self.assertNotIn("text", result_bytes(result).decode())
        value = {"schema_version": CHECKPOINT_SCHEMA, "manifest_sha256": manifest.digest,
                 "config_sha256": "c" * 64, "source_sha256": "a" * 64,
                 "status": "processed"}
        directory = self.root / "checkpoints"
        checkpoint = publish_checkpoint(directory, value)
        loaded = load_checkpoint(checkpoint, manifest_sha256=manifest.digest,
                                  config_sha256="c" * 64, source_sha256="a" * 64)
        self.assertEqual(loaded["status"], "processed")
        with self.assertRaises(BatchContractError): transition_status("processed", "failed")

    def test_result_schema_transitions_and_checkpoint_forgery(self):
        manifest = validate_manifest(self.manifest_bytes())
        with self.assertRaises(BatchContractError): make_result(manifest, [{"path": "docs/a.pdf", "status": "processed"}])
        with self.assertRaises(BatchContractError): result_bytes({"schema_version": "wrong"})
        for current in ("failed", "rejected"):
            for requested in ("processed", "duplicate"):
                with self.assertRaises(BatchContractError): transition_status(current, requested)
        value = {"schema_version": CHECKPOINT_SCHEMA, "manifest_sha256": manifest.digest,
                 "config_sha256": "c" * 64, "source_sha256": "a" * 64, "status": "processed"}
        checkpoint = publish_checkpoint(self.root / "checkpoints", value)
        with self.assertRaises(BatchContractError): load_checkpoint(checkpoint, manifest_sha256="0" * 64, config_sha256="c" * 64, source_sha256="a" * 64)
        checkpoint.write_bytes(b"{}")
        with self.assertRaises(BatchContractError): load_checkpoint(checkpoint, manifest_sha256=manifest.digest, config_sha256="c" * 64, source_sha256="a" * 64)

    def test_result_and_checkpoint_exact_contracts(self):
        manifest = validate_manifest(self.manifest_bytes())
        hash_value = "a" * 64
        result = {"schema_version": "document-batch-result.v1", "manifest_sha256": manifest.digest,
                  "counts": {"processed": 1, "duplicate": 0, "rejected": 0, "failed": 0},
                  "items": [{"path": "docs/a.pdf", "status": "processed", "sha256": hash_value}]}
        self.assertEqual(json.loads(result_bytes(result))["items"][0]["sha256"], hash_value)
        bad = dict(result); bad["items"] = result["items"] * 101; bad["counts"] = dict(result["counts"], processed=101)
        with self.assertRaises(BatchContractError): result_bytes(bad)
        bad = dict(result); bad["items"] = [{"path": "docs/a.pdf", "status": "failed", "reason": "contains_text", "text": "secret"}]; bad["counts"] = {"processed": 0, "duplicate": 0, "rejected": 0, "failed": 1}
        with self.assertRaises(BatchContractError): result_bytes(bad)
        for current in ("processed", "duplicate", "failed", "rejected"):
            for requested in ({"processed", "duplicate", "failed", "rejected"} - {current}):
                with self.assertRaises(BatchContractError): transition_status(current, requested)
        value = {"schema_version": CHECKPOINT_SCHEMA, "manifest_sha256": manifest.digest,
                 "config_sha256": "c" * 64, "source_sha256": hash_value, "status": "processed"}
        directory = self.root / "checkpoint-root"
        checkpoint = publish_checkpoint(directory, value)
        self.assertEqual(checkpoint, publish_checkpoint(directory, value))
        with self.assertRaises(BatchContractError): publish_checkpoint(Path("relative"), value)
        with self.assertRaises(BatchContractError): load_checkpoint(Path("relative.json"), manifest_sha256=manifest.digest, config_sha256="c" * 64)
        with self.assertRaises(BatchContractError):
            load_checkpoint(
                checkpoint,
                manifest_sha256=None,
                config_sha256="c" * 64,
            )
        target_link = self.root / "checkpoint-link"; target_link.symlink_to(directory)
        with self.assertRaises(BatchContractError): publish_checkpoint(target_link, value)
        forged = dict(value, status="unknown")
        with self.assertRaises(BatchContractError): publish_checkpoint(directory, forged)
        with self.assertRaises(BatchContractError): load_checkpoint(checkpoint.parent / ("0" * 64 + ".json"), manifest_sha256=manifest.digest, config_sha256="c" * 64)

        for mutation in (
            {key: item for key, item in value.items() if key != "status"},
            dict(value, extra=True),
            dict(value, config_sha256="short"),
        ):
            with self.assertRaises(BatchContractError):
                publish_checkpoint(directory, mutation)

        payload = document_batch.canonical_json(value)
        collision = directory / (hashlib.sha256(payload).hexdigest() + ".json")
        collision.unlink()
        collision.write_bytes(b"forged")
        with self.assertRaises(BatchContractError):
            publish_checkpoint(directory, value)

    def test_checkpoint_directory_sync_failure_is_not_reported_as_success(self):
        manifest = validate_manifest(self.manifest_bytes())
        value = {
            "schema_version": CHECKPOINT_SCHEMA,
            "manifest_sha256": manifest.digest,
            "config_sha256": "c" * 64,
            "source_sha256": "a" * 64,
            "status": "processed",
        }
        real_fsync = os.fsync
        calls = 0

        def fail_directory_sync(fd):
            nonlocal calls
            calls += 1
            if calls == 2:
                raise OSError("injected directory sync failure")
            return real_fsync(fd)

        with mock.patch(
            "ice_maker.document_batch.os.fsync",
            side_effect=fail_directory_sync,
        ):
            with self.assertRaises(BatchContractError):
                publish_checkpoint(self.root / "sync-failure", value)

    def test_checkpoint_publication_cannot_escape_after_directory_swap(self):
        manifest = validate_manifest(self.manifest_bytes())
        value = {
            "schema_version": CHECKPOINT_SCHEMA,
            "manifest_sha256": manifest.digest,
            "config_sha256": "c" * 64,
            "source_sha256": "a" * 64,
            "status": "processed",
        }
        directory = self.root / "checkpoints"
        outside = self.root / "outside"
        directory.mkdir()
        outside.mkdir()
        real_link = os.link
        swapped = False

        def swap_before_link(source, target, *args, **kwargs):
            nonlocal swapped
            if not swapped:
                moved = self.root / "moved-checkpoints"
                directory.rename(moved)
                directory.symlink_to(outside)
                source_name = Path(source).name
                (outside / source_name).write_bytes(
                    (moved / source_name).read_bytes()
                )
                swapped = True
            return real_link(source, target, *args, **kwargs)

        with mock.patch(
            "ice_maker.document_batch.os.link",
            side_effect=swap_before_link,
        ):
            with self.assertRaises(BatchContractError):
                publish_checkpoint(directory, value)
        self.assertEqual(tuple(outside.glob("*.json")), ())

    def test_batch_mixed_policy_duplicate_and_interruption_resume(self):
        """The injected extractor is a deterministic seam, never the CLI path."""
        root = self.root / "input"; root.mkdir()
        (root / "a.pdf").write_bytes(b"%PDF-a")
        (root / "b.pdf").write_bytes(b"%PDF-a")
        (root / "zdenied.pdf").write_bytes(b"%PDF-denied")
        raw = {"schema_version": "document-batch-manifest.v1", "items": [
            {"path": "a.pdf", "rights": "confirmed", "data_class": "internal", "languages": ["eng"]},
            {"path": "b.pdf", "rights": "confirmed", "data_class": "internal", "languages": ["eng"]},
            {"path": "zdenied.pdf", "rights": "denied", "data_class": "restricted", "languages": ["eng"]},
        ]}
        manifest_path = self.root / "manifest.json"
        manifest_path.write_bytes(json.dumps(raw, sort_keys=True, separators=(",", ":")).encode() + b"\n")
        state = self.root / "state"; calls = []
        def extract(source, descriptor, config):
            calls.append(descriptor.item.path)
            text = "可搜尋文字"
            region = f"text:0,0,{len(text)}"
            identity = f"{descriptor.sha256}\0{1}\0{region}\0pdf-text\0{text}"
            return (ExtractedChunk(descriptor.sha256, 1, region, "pdf-text", text, 1.0,
                    hashlib.sha256(identity.encode()).hexdigest()),)
        def stop(_descriptor): raise KeyboardInterrupt()
        with self.assertRaises(KeyboardInterrupt):
            run_batch(manifest_path, root, state_root=state, extractor=extract,
                      extractor_binding_sha256="1" * 64, interrupt_after_index=stop)
        self.assertEqual(calls, ["a.pdf"])
        result = run_batch(manifest_path, root, state_root=state, extractor=extract,
                           extractor_binding_sha256="1" * 64)
        self.assertEqual(calls, ["a.pdf"])
        self.assertEqual(result["counts"], {"duplicate": 1, "failed": 0, "processed": 1, "rejected": 1})
        self.assertEqual([entry["status"] for entry in result["items"]], ["processed", "duplicate", "rejected"])

    def test_batch_isolates_corrupt_source_and_keeps_safe_report(self):
        root = self.root / "input"; root.mkdir()
        (root / "a.pdf").write_bytes(b"%PDF-good-a")
        (root / "b.bin").write_bytes(b"not-supported")
        (root / "c.pdf").write_bytes(b"%PDF-good-c")
        items = [{"path": name, "rights": "confirmed", "data_class": "internal", "languages": ["eng"]}
                 for name in ("a.pdf", "b.bin", "c.pdf")]
        manifest = self.root / "manifest.json"
        manifest.write_bytes(json.dumps({"items": items, "schema_version": "document-batch-manifest.v1"},
            sort_keys=True, separators=(",", ":")).encode() + b"\n")
        calls = []
        def extractor(_source, descriptor, _config):
            calls.append(descriptor.item.path)
            return (self._chunk(descriptor.sha256, "可搜尋"),)
        result = run_batch(manifest, root, state_root=self.root / "state", extractor=extractor,
                           extractor_binding_sha256="2" * 64)
        self.assertEqual(calls, ["a.pdf", "c.pdf"])
        self.assertEqual([item["status"] for item in result["items"]],
                         ["processed", "rejected", "processed"])
        self.assertEqual(result["items"][1]["reason"], "unsupported_format")
        encoded = result_bytes(result)
        for forbidden in (b"not-supported", b"\xe5\x8f\xaf\xe6\x90\x9c\xe5\xb0\x8b", str(root).encode()):
            self.assertNotIn(forbidden, encoded)

    @staticmethod
    def _chunk(source, text="safe"):
        region = f"text:0,0,{len(text)}"
        identity = f"{source}\0{1}\0{region}\0pdf-text\0{text}"
        return ExtractedChunk(source, 1, region, "pdf-text", text, 1.0,
                              hashlib.sha256(identity.encode()).hexdigest())

    def test_cache_forgery_fails_closed_and_changed_binding_reextracts(self):
        root = self.root / "input"; root.mkdir(); (root / "a.pdf").write_bytes(b"%PDF-cache")
        manifest = self.root / "manifest.json"; manifest.write_bytes(self.manifest_bytes("a.pdf"))
        calls = []
        def extractor(_source, descriptor, _config):
            calls.append(descriptor.sha256)
            return (self._chunk(descriptor.sha256),)
        state = self.root / "state"
        first = run_batch(manifest, root, state_root=state, extractor=extractor,
                          extractor_binding_sha256="3" * 64)
        self.assertEqual(first["counts"]["processed"], 1)
        cache = next((state / "batch-cache").glob("*.json"))
        cache.write_bytes(b"{}\n")
        forged = run_batch(manifest, root, state_root=state, extractor=extractor,
                           extractor_binding_sha256="3" * 64)
        self.assertEqual(forged["items"][0], {"path": "a.pdf", "status": "failed", "reason": "invalid_cache"})
        self.assertEqual(len(calls), 1)
        changed = run_batch(manifest, root, state_root=state, extractor=extractor,
                            extractor_binding_sha256="4" * 64)
        self.assertEqual(changed["counts"]["processed"], 1)
        self.assertEqual(len(calls), 2)

    def test_cache_and_progress_symlinks_are_not_trusted(self):
        root = self.root / "input"; root.mkdir(); (root / "a.pdf").write_bytes(b"%PDF-links")
        manifest = self.root / "manifest.json"; manifest.write_bytes(self.manifest_bytes("a.pdf"))
        state = self.root / "state"
        def extractor(_source, descriptor, _config): return (self._chunk(descriptor.sha256),)
        run_batch(manifest, root, state_root=state, extractor=extractor,
                  extractor_binding_sha256="5" * 64)
        cache = next((state / "batch-cache").glob("*.json"))
        saved = self.root / "saved-cache"; saved.write_bytes(cache.read_bytes())
        cache.unlink(); cache.symlink_to(saved)
        result = run_batch(manifest, root, state_root=state, extractor=extractor,
                           extractor_binding_sha256="5" * 64)
        self.assertEqual(result["items"][0]["reason"], "invalid_cache")
        cache.unlink(); cache.write_bytes(saved.read_bytes())
        progress = next((state / "batch-progress").glob("*.json"))
        saved_progress = self.root / "saved-progress"; saved_progress.write_bytes(progress.read_bytes())
        progress.unlink(); progress.symlink_to(saved_progress)
        result = run_batch(manifest, root, state_root=state, extractor=extractor,
                           extractor_binding_sha256="5" * 64)
        self.assertEqual(result["items"][0]["reason"], "invalid_cache")

    def test_raster_words_keep_exact_original_rectangles(self):
        source = "a" * 64
        words = (OcrWord("繁體", .8, 4, 10, 20, 8), OcrWord("中文", .6, 8, 30, 18, 9))
        limits = dict(CODE_MAXIMA)
        config_digest = hashlib.sha256(json.dumps(
            {"limits": limits, "schema_version": "document-ingestion-config.v1"},
            sort_keys=True, separators=(",", ":")).encode()).hexdigest()
        evidence = RasterExtraction(source, METHOD, EXTRACTOR_VERSION, config_digest,
            "tesseract 5", hashlib.sha256(b"tesseract 5").hexdigest(), 100, 100,
            (Tile(0, 0, 100, 100),), words, "繁體 中文", .7)
        chunks = document_batch._batch_chunks(evidence)
        self.assertEqual([item.region for item in chunks],
                         ["pixels:4,10,20,8", "pixels:8,30,18,9"])
        self.assertEqual([item.confidence for item in chunks], [.8, .6])

    def test_source_second_read_rejects_eof_and_identity_change(self):
        root = self.root / "input"; root.mkdir(); (root / "a.pdf").write_bytes(b"%PDF-source")
        descriptor = discover_sources(validate_manifest(self.manifest_bytes("a.pdf")), root)[0]
        with mock.patch("ice_maker.document_batch.os.read", return_value=b""):
            with self.assertRaises(BatchContractError):
                document_batch._read_source(root, descriptor)
        with mock.patch("ice_maker.document_batch._identity_changed", return_value=True):
            with self.assertRaises(BatchContractError):
                document_batch._read_source(root, descriptor)

    def test_normal_toolchain_route_and_cli_exit_contract(self):
        root = self.root / "input"; root.mkdir(); (root / "a.pdf").write_bytes(b"%PDF-tool")
        manifest = self.root / "manifest.json"; manifest.write_bytes(self.manifest_bytes("a.pdf"))
        tool_paths = []
        for name in ("pdfinfo", "pdftotext", "pdftoppm", "tesseract"):
            path = self.root / name; path.write_text("tool"); path.chmod(0o700); tool_paths.append(str(path))
        toolchain = ProductionToolchain(*tool_paths, "poppler 25", "tesseract 5", ("eng",))
        seen = []
        def production(_source, descriptor, _config, supplied):
            seen.append((descriptor.signature, supplied.digest))
            return (self._chunk(descriptor.sha256),)
        with mock.patch("ice_maker.document_batch._production_extractor", side_effect=production):
            result = run_batch(manifest, root, state_root=self.root / "state", toolchain=toolchain)
        self.assertEqual(result["counts"]["processed"], 1)
        self.assertEqual(seen, [("pdf", toolchain.digest)])

        class Output:
            def __init__(self): self.buffer = io.BytesIO()
            def write(self, _value): return 0
            def flush(self): return None
        output = Output()
        argv = ["batch", "--manifest", str(manifest), "--input-root", str(root),
                "--pdfinfo-executable", tool_paths[0], "--pdftotext-executable", tool_paths[1],
                "--pdftoppm-executable", tool_paths[2], "--tesseract-executable", tool_paths[3],
                "--poppler-version", "poppler 25", "--tesseract-version", "tesseract 5",
                "--installed-language", "eng"]
        safe = {"counts": {"duplicate": 0, "failed": 1, "processed": 0, "rejected": 0},
                "items": [{"path": "a.pdf", "status": "failed", "reason": "extraction_failed"}],
                "manifest_sha256": "a" * 64, "schema_version": "document-batch-result.v1"}
        with mock.patch("ice_maker.knowledge_cli._state_root", return_value=(self.root, self.root / "cli-state")), \
             mock.patch("ice_maker.knowledge_cli.run_batch", return_value=safe) as runner, \
             mock.patch("sys.stdout", output):
            self.assertEqual(knowledge_cli.main(argv), 2)
        self.assertEqual(runner.call_args.kwargs["toolchain"].languages, ("eng",))
        with self.assertRaises(Exception):
            toolchain.languages += ("chi_tra",)
        for values in (
            ("relative", *tool_paths[1:], "poppler 25", "tesseract 5", ("eng",)),
            (*tool_paths, "bad\nversion", "tesseract 5", ("eng",)),
            (*tool_paths, "poppler 25", "tesseract 5", ["eng"]),
        ):
            with self.assertRaises(BatchContractError):
                ProductionToolchain(*values)

    def test_batch_module_has_no_provider_network_or_git_capability(self):
        source = Path(document_batch.__file__).read_text()
        for forbidden in ("import socket", "import requests", "import httpx", "import git", "subprocess"):
            self.assertNotIn(forbidden, source)


if __name__ == "__main__":
    unittest.main()

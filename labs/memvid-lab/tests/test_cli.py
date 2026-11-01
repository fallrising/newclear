"""Boundary regressions using the actual SDK, CLI and inherited syscall filter."""

from __future__ import annotations

import errno
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class CliBoundaries(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix="memvid-cli-")
        cls.output = Path(cls.temporary.name)
        cls.memory = cls.output / "fixture.mv2"
        seed = """
from pathlib import Path
import sys
from offline import local_environment, deny_network
local_environment(); deny_network()
import memvid_sdk as sdk
with sdk.create(sys.argv[1]) as m:
    m.put('A fixture', 'test', {'source': 'synthetic'}, text='Amberkit supports resumable backups.', uri='mv2://fixture', enable_embedding=False)
    m.seal()
"""
        result = subprocess.run([sys.executable, "-c", seed, str(cls.memory)], cwd=ROOT,
                                text=True, capture_output=True, timeout=60)
        if result.returncode:
            raise RuntimeError(result.stderr)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def cli(self, *arguments):
        return subprocess.run([sys.executable, str(ROOT / "lab.py"), *map(str, arguments)],
                              cwd=ROOT, text=True, capture_output=True, timeout=120)

    def test_query_is_read_only_and_preserves_citation(self):
        before = hashlib.sha256(self.memory.read_bytes()).hexdigest()
        result = self.cli("query", self.memory, "Amberkit")
        self.assertEqual(result.returncode, 0, result.stderr)
        hits = json.loads(result.stdout)["hits"]
        self.assertEqual(hits[0]["uri"], "mv2://fixture")
        self.assertIn("resumable", hits[0]["text"])
        self.assertEqual(hashlib.sha256(self.memory.read_bytes()).hexdigest(), before)

    def test_unknown_query_does_not_invent_sources(self):
        result = self.cli("query", self.memory, "qzxunknownword")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["hits"], [])

    def test_existing_output_is_not_modified(self):
        existing = self.output / "existing"
        existing.mkdir()
        sentinel = existing / "report.json"
        sentinel.write_bytes(b"owner data\n")
        result = self.cli("run", "--profile", "core", "--output", existing)
        self.assertEqual(result.returncode, 2)
        self.assertEqual(sentinel.read_bytes(), b"owner data\n")
        self.assertEqual(list(existing.iterdir()), [sentinel])

    def test_missing_memory_is_not_created(self):
        missing = self.output / "never-created.mv2"
        result = self.cli("query", missing, "Amberkit")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(missing.exists())

    def test_corrupt_memory_fails(self):
        corrupt = self.output / "corrupt.mv2"
        corrupt.write_bytes(b"This is not a Memvid container.")
        result = self.cli("query", corrupt, "Amberkit")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(result.stdout.strip())

    def test_network_denial_is_inherited_by_child(self):
        child = "import socket; socket.socket(socket.AF_INET, socket.SOCK_STREAM)"
        script = """
import subprocess, sys, json
from offline import deny_network
guard = deny_network()
child = subprocess.run([sys.executable, '-c', sys.argv[1]], capture_output=True, text=True)
print(json.dumps({'guard':guard,'returncode':child.returncode,'stderr':child.stderr}))
"""
        result = subprocess.run([sys.executable, "-c", script, child], cwd=ROOT,
                                capture_output=True, text=True, timeout=20)
        self.assertEqual(result.returncode, 0, result.stderr)
        data = json.loads(result.stdout)
        self.assertEqual(data["guard"]["probes"], {"ipv4": "EPERM", "ipv6": "EPERM"})
        self.assertNotEqual(data["returncode"], 0)
        self.assertIn(f"[Errno {errno.EPERM}]", data["stderr"])

    def test_tampered_model_is_rejected_without_repair(self):
        from models import verify_assets

        cache = self.output / "bad-model"
        model = cache / "bge-small-en-v1.5/model.onnx"
        model.parent.mkdir(parents=True)
        model.write_bytes(b"incorrect weights")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            verify_assets(cache, "semantic")
        self.assertEqual(model.read_bytes(), b"incorrect weights")

    def test_full_profile_reports_missing_models_as_non_success(self):
        result_dir = self.output / "missing-assets-run"
        result = self.cli("run", "--profile", "full", "--output", result_dir,
                          "--models", self.output / "missing-models",
                          "--whisper-assets", self.output / "missing-assets",
                          "--whisper-bin", self.output / "missing-binary")
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
        report = json.loads((result_dir / "report.json").read_text())
        self.assertFalse(report["full_acceptance_passed"])
        cases = {case["id"]: case for case in report["cases"]}
        for case_id in ("CAP-SEMANTIC", "CAP-CLIP", "CAP-WHISPER"):
            self.assertEqual(cases[case_id]["status"], "blocked")
        self.assertEqual(len(cases), 15)
        self.assertEqual(report["counts"], {"passed": 12, "blocked": 3})


if __name__ == "__main__":
    unittest.main()

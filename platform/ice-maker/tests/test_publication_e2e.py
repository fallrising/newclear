import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


COMMIT = "0123456789abcdef0123456789abcdef01234567"
SOURCE = "a" * 64
CHUNK_ONE = "b" * 64
CHUNK_TWO = "c" * 64
ROOT = Path(__file__).parents[1]


class PublicationEndToEndTests(unittest.TestCase):
    def _build(self, manifest: str, output: Path) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [
                sys.executable,
                "-m",
                "ice_maker.publication_cli",
                "--repository-root",
                str(ROOT),
                "--manifest",
                manifest,
                "--output-root",
                str(output),
                "--source-commit",
                COMMIT,
            ],
            cwd=ROOT,
            env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
            capture_output=True,
            text=True,
            check=False,
        )

    def test_clean_two_book_rebuild_is_byte_identical_and_reuses_synthetic_record(self):
        output = ROOT / ".ice-maker" / "publications"
        state_root = output.parent
        state_root.mkdir(parents=True, exist_ok=True)
        sentinel_fd, sentinel_name = tempfile.mkstemp(
            dir=state_root, prefix="publication-e2e-unrelated-"
        )
        sentinel = Path(sentinel_name)
        os.write(sentinel_fd, b"preserve me")
        os.close(sentinel_fd)
        shutil.rmtree(output, ignore_errors=True)
        try:
            self.assertTrue(sentinel.exists())
            manifests = ("books/system-design.json", "books/reliability-patterns.json")
            source = ROOT / "knowledge/50-patterns/synthetic-idempotency.json"
            source_bytes = source.read_bytes()
            source_value = json.loads(source_bytes)
            manifest_values = [json.loads((ROOT / manifest).read_bytes()) for manifest in manifests]
            self.assertEqual(
                [value["chapters"] for value in manifest_values],
                [["knowledge/50-patterns/synthetic-idempotency.json"]] * 2,
            )
            for value in manifest_values:
                self.assertEqual(set(value), {"schema_version", "manifest_id", "title", "chapters"})
                self.assertNotIn("production", value)
                self.assertNotIn("synthetic", value)
            self.assertTrue(source_value["synthetic"])
            self.assertEqual(source_value["source"], "knowledge/50-patterns/synthetic-idempotency.json")
            self.assertEqual(source_value["citations"][0]["source_sha256"], SOURCE)
            self.assertEqual(source_value["citations"][0]["chunk_id"], CHUNK_ONE)
            self.assertEqual(source_value["citations"][1]["source_sha256"], SOURCE)
            self.assertEqual(source_value["citations"][1]["chunk_id"], CHUNK_TWO)

            first = {}
            for manifest in manifests:
                result = self._build(manifest, output)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                payload = json.loads(result.stdout)
                self.assertTrue(payload["ok"])
                book = output / payload["manifest_id"]
                first[payload["manifest_id"]] = {
                    name: (book / name).read_bytes() for name in ("book.md", "book.html")
                }
                for data in first[payload["manifest_id"]].values():
                    self.assertIn(COMMIT.encode(), data)
                    self.assertIn(b"synthetic-idempotency", data)
                    self.assertIn(SOURCE.encode(), data)
                    self.assertIn(f"{SOURCE}#{CHUNK_ONE}".encode(), data)
                    self.assertIn(f"{SOURCE}#{CHUNK_TWO}".encode(), data)

            shutil.rmtree(output)
            self.assertTrue(sentinel.exists())
            for manifest in manifests:
                result = self._build(manifest, output)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                payload = json.loads(result.stdout)
                book = output / payload["manifest_id"]
                self.assertEqual(
                    first[payload["manifest_id"]],
                    {name: (book / name).read_bytes() for name in ("book.md", "book.html")},
                )

            for path in (ROOT / "books/system-design.json", ROOT / "books/reliability-patterns.json", source):
                self.assertNotEqual(
                    subprocess.run(["git", "check-ignore", "--quiet", str(path.relative_to(ROOT))], cwd=ROOT).returncode,
                    0,
                    f"publication input unexpectedly ignored: {path}",
                )
            generated = subprocess.run(
                ["git", "ls-files", ".ice-maker"], cwd=ROOT,
                capture_output=True, text=True, check=True,
            ).stdout
            self.assertEqual(generated, "")
            self.assertEqual(
                subprocess.run(["git", "check-ignore", "--quiet", ".ice-maker"], cwd=ROOT).returncode,
                0,
            )
            self.assertTrue(sentinel.exists())
        finally:
            shutil.rmtree(output, ignore_errors=True)
            self.assertTrue(sentinel.exists())
            sentinel.unlink(missing_ok=True)

    def test_shared_source_failure_publishes_no_partial_new_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "books").mkdir(parents=True)
            source = root / "knowledge/50-patterns/synthetic-idempotency.json"
            source.parent.mkdir(parents=True)
            fixture = ROOT / "knowledge/50-patterns/synthetic-idempotency.json"
            source.write_bytes(fixture.read_bytes())
            for name in ("system-design", "reliability-patterns"):
                (root / "books" / f"{name}.json").write_bytes((ROOT / "books" / f"{name}.json").read_bytes())
            output = root / ".ice-maker" / "publications"
            sentinel = root / ".ice-maker" / "unrelated-state-sentinel"
            sentinel.parent.mkdir(parents=True)
            sentinel.write_bytes(b"preserve me")
            for mutation in ("missing", "tampered"):
                source.write_bytes(fixture.read_bytes())
                if mutation == "missing":
                    source.unlink()
                else:
                    source.write_bytes(source.read_bytes().replace(
                        b"knowledge/50-patterns/synthetic-idempotency.json",
                        b"knowledge/50-patterns/tampered.json", 1,
                    ))
                for manifest in ("books/system-design.json", "books/reliability-patterns.json"):
                    result = subprocess.run(
                        [sys.executable, "-m", "ice_maker.publication_cli", "--repository-root", str(root),
                         "--manifest", manifest, "--output-root", str(output), "--source-commit", COMMIT],
                        cwd=ROOT, env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                        capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(result.returncode, 2, mutation)
                    self.assertFalse(output.exists(), mutation)
                    self.assertTrue(sentinel.exists(), mutation)


if __name__ == "__main__":
    unittest.main()

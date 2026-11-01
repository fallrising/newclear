"""Boundary tests use real temporary Git repositories and real Graphify CLI."""
from __future__ import annotations

from concurrent.futures import ProcessPoolExecutor
import importlib.metadata
import json
import multiprocessing
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from graphify_lab.cache import (
    CacheError,
    PINNED_GRAPHIFY_VERSION,
    ensure_index,
    prepare_reference,
    source_fingerprint,
)


def git(directory: Path, *arguments: str) -> str:
    result = subprocess.run(["git", *arguments], cwd=directory,
                            capture_output=True, text=True, check=True)
    return result.stdout.strip()


def fetch_worker(arguments: tuple) -> dict:
    reference, cache = arguments
    return prepare_reference(reference, Path(cache), allow_local=True)


def index_worker(arguments: tuple) -> dict:
    source, cache, source_id = arguments
    return ensure_index(Path(source), Path(cache), source_id)


class CacheFixture(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="graphify-cache-test-")
        self.addCleanup(self.temporary.cleanup)
        self.work = Path(self.temporary.name)
        self.origin = self.work / "origin"
        self.origin.mkdir()
        git(self.origin, "init", "--quiet")
        git(self.origin, "config", "user.name", "Graphify Lab Test")
        git(self.origin, "config", "user.email", "graphify-lab@example.invalid")
        (self.origin / "sample.py").write_text(
            "def calculate(amount):\n    return amount * 2\n\n"
            "def checkout(amount):\n    return calculate(amount)\n", encoding="utf-8")
        (self.origin / ".gitignore").write_text("scratch.tmp\n", encoding="utf-8")
        self.first = self.commit("first version")
        self.cache = self.work / "cache"
        self.reference = {"name": "test-reference", "url": self.origin.as_uri(),
                          "commit": self.first, "subdir": ".", "license": "MIT"}

    def commit(self, message: str) -> str:
        git(self.origin, "add", ".")
        git(self.origin, "commit", "--quiet", "-m", message)
        return git(self.origin, "rev-parse", "HEAD")

    def prepare(self, **kwargs) -> dict:
        return prepare_reference(self.reference, self.cache, allow_local=True, **kwargs)


class GitCacheTests(CacheFixture):
    def test_two_consumers_and_offline_reopen_share_one_checkout(self):
        first = self.prepare()
        second = self.prepare(offline=True)
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["root"], second["root"])
        self.assertEqual(Path(first["source"]), Path(second["source"]))
        self.assertEqual(len(list((self.cache / "sources").iterdir())), 1)
        self.assertEqual(git(Path(first["root"]), "rev-parse", "HEAD"), self.first)

    def test_version_change_isolated_without_moving_old_checkout(self):
        old = self.prepare()
        with (self.origin / "sample.py").open("a", encoding="utf-8") as stream:
            stream.write("\ndef added():\n    return 7\n")
        newer = self.commit("second version")
        updated = dict(self.reference, commit=newer)
        new = prepare_reference(updated, self.cache, allow_local=True)
        self.assertNotEqual(old["root"], new["root"])
        self.assertEqual(git(Path(old["root"]), "rev-parse", "HEAD"), self.first)
        self.assertEqual(git(Path(new["root"]), "rev-parse", "HEAD"), newer)
        self.assertNotIn("def added", (Path(old["root"]) / "sample.py").read_text())
        self.assertIn("def added", (Path(new["root"]) / "sample.py").read_text())

    def test_subdirs_reuse_same_snapshot(self):
        (self.origin / "package").mkdir()
        (self.origin / "package" / "module.py").write_text("x = 1\n", encoding="utf-8")
        self.reference["commit"] = self.commit("add package")
        first = self.prepare()
        second = prepare_reference(dict(self.reference, subdir="package"), self.cache,
                                   allow_local=True)
        self.assertEqual(first["root"], second["root"])
        self.assertEqual(Path(second["source"]), Path(first["root"]) / "package")
        self.assertTrue(second["cache_hit"])

    def test_dirty_tracked_and_ignored_files_are_rejected(self):
        source = Path(self.prepare()["source"])
        with (source / "sample.py").open("a", encoding="utf-8") as stream:
            stream.write("\ndef malicious_change():\n    pass\n")
        with self.assertRaisesRegex(CacheError, "dirty"):
            self.prepare()
        git(source, "checkout", "--", "sample.py")
        (source / "scratch.tmp").write_text("ignored but not immutable\n", encoding="utf-8")
        with self.assertRaisesRegex(CacheError, "dirty"):
            self.prepare()

    def test_changed_origin_and_revision_are_rejected(self):
        root = Path(self.prepare()["root"])
        git(root, "remote", "set-url", "origin", "https://example.invalid/other.git")
        with self.assertRaisesRegex(CacheError, "origin"):
            self.prepare()
        git(root, "remote", "set-url", "origin", self.reference["url"])
        git(root, "config", "user.name", "Graphify Lab Test")
        git(root, "config", "user.email", "graphify-lab@example.invalid")
        git(root, "commit", "--quiet", "--allow-empty", "-m", "unexpected revision")
        with self.assertRaisesRegex(CacheError, "revision"):
            self.prepare()

    def test_url_policy_sha_subdir_and_offline_miss(self):
        with self.assertRaisesRegex(CacheError, "HTTPS"):
            prepare_reference(self.reference, self.cache)
        for url in ("http://example.org/repo", "https://user:secret@example.org/repo",
                    "https://127.0.0.1/repo", "https://localhost/repo"):
            with self.subTest(url=url), self.assertRaises(CacheError):
                prepare_reference(dict(self.reference, url=url), self.cache)
        with self.assertRaisesRegex(CacheError, "complete"):
            prepare_reference(dict(self.reference, commit="main"), self.cache, allow_local=True)
        for subdir in ("../origin", "/tmp", "x/../../y"):
            with self.subTest(subdir=subdir), self.assertRaisesRegex(CacheError, "subdir"):
                prepare_reference(dict(self.reference, subdir=subdir), self.cache, allow_local=True)
        with self.assertRaisesRegex(CacheError, "absent"):
            self.prepare(offline=True)

    def test_committed_symlink_escape_is_rejected_before_publication(self):
        outside = self.work / "outside.py"
        outside.write_text("private = 'not for index'\n", encoding="utf-8")
        (self.origin / "escape.py").symlink_to(outside)
        self.reference["commit"] = self.commit("unsafe symlink fixture")
        with self.assertRaisesRegex(CacheError, "escapes"):
            self.prepare()
        self.assertEqual(list((self.cache / "sources").iterdir()), [])

    def test_tampered_metadata_is_not_a_cache_hit(self):
        entry = Path(self.prepare()["root"]).parent
        (entry / "source.json").write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(CacheError, "metadata mismatch"):
            self.prepare()

    def test_concurrent_fetch_publishes_once(self):
        args = [(self.reference, str(self.cache))] * 3
        with ProcessPoolExecutor(max_workers=3, mp_context=multiprocessing.get_context("fork")) as pool:
            results = list(pool.map(fetch_worker, args))
        self.assertEqual(sum(not result["cache_hit"] for result in results), 1)
        self.assertEqual(len({result["root"] for result in results}), 1)
        self.assertEqual(len(list((self.cache / "sources").iterdir())), 1)


class GraphifyIndexTests(CacheFixture):
    def setUp(self):
        super().setUp()
        self.assertEqual(importlib.metadata.version("graphifyy"), PINNED_GRAPHIFY_VERSION)
        self.prepared = self.prepare()
        self.source = Path(self.prepared["source"])

    def index(self, **kwargs) -> dict:
        return ensure_index(self.source, self.cache, self.prepared["source_id"], **kwargs)

    def test_real_index_is_shared_and_corruption_refused(self):
        first = self.index()
        second = self.index()
        self.assertFalse(first["cache_hit"])
        self.assertTrue(second["cache_hit"])
        self.assertEqual(first["graph"], second["graph"])
        graph_path = Path(first["graph"])
        graph = json.loads(graph_path.read_text(encoding="utf-8"))
        self.assertGreater(len(graph["nodes"]), 0)
        self.assertTrue(any("calculate" in str(node) for node in graph["nodes"]))
        graph_path.write_text("{}", encoding="utf-8")
        with self.assertRaisesRegex(CacheError, "integrity mismatch"):
            self.index()

    def test_changed_source_gets_new_index_and_old_graph_survives(self):
        first = self.index()
        with (self.source / "sample.py").open("a", encoding="utf-8") as stream:
            stream.write("\ndef new_helper():\n    return 4\n")
        second = self.index()
        self.assertNotEqual(first["graph"], second["graph"])
        self.assertNotIn("new_helper", Path(first["graph"]).read_text())
        self.assertIn("new_helper", Path(second["graph"]).read_text())
        with self.assertRaisesRegex(CacheError, "dirty"):
            self.prepare()

    def test_provenance_settings_and_fingerprint_are_part_of_key(self):
        first = self.index()
        second = self.index(subdir="package")
        third = ensure_index(self.source, self.cache, "another-provenance")
        self.assertEqual(len({row["index_id"] for row in (first, second, third)}), 3)
        self.assertEqual(first["source_fingerprint"], source_fingerprint(self.source))
        self.assertEqual(first["source_fingerprint"]["files"], 2)
        with self.assertRaisesRegex(CacheError, "outside"):
            ensure_index(self.source, self.source / "bad-cache", "bad")

    def test_concurrent_real_index_build_publishes_once(self):
        args = [(str(self.source), str(self.cache), self.prepared["source_id"])] * 3
        with ProcessPoolExecutor(max_workers=3, mp_context=multiprocessing.get_context("fork")) as pool:
            results = list(pool.map(index_worker, args))
        self.assertEqual(sum(not result["cache_hit"] for result in results), 1)
        self.assertEqual(len({result["graph"] for result in results}), 1)
        self.assertEqual(len(list((self.cache / "indexes").iterdir())), 1)
        self.assertTrue(all(Path(result["graph"]).is_file() for result in results))

    def test_indexed_source_cannot_shadow_installed_graphify(self):
        marker = self.work / "source-was-executed"
        (self.source / "graphify.py").write_text(
            f"from pathlib import Path\nPath({str(marker)!r}).write_text('executed')\n",
            encoding="utf-8",
        )
        result = self.index()
        self.assertFalse(marker.exists())
        self.assertIn("calculate", Path(result["graph"]).read_text())

    def test_ambient_output_override_does_not_escape_cache(self):
        outside = self.work / "ambient-output"
        with patch.dict(os.environ, {"GRAPHIFY_OUT": str(outside)}):
            result = self.index()
        self.assertFalse(outside.exists())
        self.assertTrue(Path(result["graph"]).is_relative_to(self.cache))

    def test_empty_graph_is_rejected_without_partial_publication(self):
        empty = self.work / "empty-source"
        empty.mkdir()
        with self.assertRaises(CacheError):
            ensure_index(empty, self.cache, "empty")
        self.assertEqual(list((self.cache / "indexes").iterdir()), [])

    def subtree(self) -> Path:
        source = self.origin / "src"
        source.mkdir()
        (source / "a.py").write_text("def alpha():\n    return 1\n", encoding="utf-8")
        (source / "b.py").write_text("def beta():\n    return 2\n", encoding="utf-8")
        return source

    def test_ancestor_graphifyignore_invalidates_subtree_index(self):
        source = self.subtree()
        first = ensure_index(source, self.cache, "local-subtree")
        self.assertIn("beta", Path(first["graph"]).read_text())
        (self.origin / ".graphifyignore").write_text("src/b.py\n", encoding="utf-8")
        second = ensure_index(source, self.cache, "local-subtree")
        self.assertFalse(second["cache_hit"])
        self.assertNotEqual(first["context_sha256"], second["context_sha256"])
        self.assertIn("alpha", Path(second["graph"]).read_text())
        self.assertNotIn("beta", Path(second["graph"]).read_text())
        fresh = ensure_index(source, self.work / "fresh-cache", "local-subtree")
        self.assertEqual(json.loads(Path(second["graph"]).read_text())["nodes"],
                         json.loads(Path(fresh["graph"]).read_text())["nodes"])
        self.assertTrue(ensure_index(source, self.cache, "local-subtree")["cache_hit"])

    def test_ancestor_gitignore_and_tracked_names_both_invalidate(self):
        source = self.subtree()
        first = ensure_index(source, self.cache, "local-subtree")
        (self.origin / ".gitignore").write_text("src/b.py\n", encoding="utf-8")
        second = ensure_index(source, self.cache, "local-subtree")
        self.assertFalse(second["cache_hit"])
        self.assertNotIn("beta", Path(second["graph"]).read_text())
        # Graphify exempts tracked files from gitignore; no source bytes change.
        git(self.origin, "add", "-f", "src/b.py")
        third = ensure_index(source, self.cache, "local-subtree")
        self.assertFalse(third["cache_hit"])
        self.assertIn("beta", Path(third["graph"]).read_text())
        self.assertEqual(first["source_fingerprint"], third["source_fingerprint"])

    def test_git_excludes_and_commit_provenance_are_context_inputs(self):
        source = self.subtree()
        first = ensure_index(source, self.cache, "local-subtree")
        info_exclude = self.origin / ".git" / "info" / "exclude"
        info_exclude.write_text("src/b.py\n", encoding="utf-8")
        second = ensure_index(source, self.cache, "local-subtree")
        self.assertFalse(second["cache_hit"])
        self.assertNotIn("beta", Path(second["graph"]).read_text())
        info_exclude.write_text("", encoding="utf-8")
        global_exclude = self.work / "user-ignore"
        global_exclude.write_text("src/a.py\n", encoding="utf-8")
        git(self.origin, "config", "core.excludesFile", str(global_exclude))
        third = ensure_index(source, self.cache, "local-subtree")
        self.assertFalse(third["cache_hit"])
        self.assertNotIn("alpha", Path(third["graph"]).read_text())
        self.assertIn("beta", Path(third["graph"]).read_text())
        global_exclude.write_text("src/b.py\n", encoding="utf-8")
        fourth = ensure_index(source, self.cache, "local-subtree")
        self.assertNotEqual(third["context_sha256"], fourth["context_sha256"])
        self.assertIn("alpha", Path(fourth["graph"]).read_text())
        self.assertNotIn("beta", Path(fourth["graph"]).read_text())
        git(self.origin, "commit", "--quiet", "--allow-empty", "-m", "provenance only")
        fifth = ensure_index(source, self.cache, "local-subtree")
        self.assertFalse(fifth["cache_hit"])
        expected_head = git(self.origin, "rev-parse", "HEAD")
        self.assertEqual(fifth["source_commit"], expected_head)
        self.assertEqual(json.loads(Path(fifth["graph"]).read_text())["built_at_commit"], expected_head)
        self.assertNotEqual(first["source_commit"], fifth["source_commit"])

    def test_external_js_resolver_configuration_has_explicit_boundary(self):
        source = self.origin / "typescript"
        source.mkdir()
        (source / "main.ts").write_text("export function alpha(): number { return 1; }\n",
                                       encoding="utf-8")
        first = ensure_index(source, self.cache, "typescript")
        self.assertIn("alpha", Path(first["graph"]).read_text())
        parent_config = self.origin / "tsconfig.json"
        parent_config.write_text('{"compilerOptions": {"baseUrl": "."}}\n', encoding="utf-8")
        with self.assertRaisesRegex(CacheError, "ancestor resolver configuration"):
            ensure_index(source, self.cache, "typescript")
        parent_config.unlink()
        local_config = source / "tsconfig.json"
        local_config.write_text('{"extends": "../base-config.json"}\n', encoding="utf-8")
        with self.assertRaisesRegex(CacheError, "escapes the scanned source"):
            ensure_index(source, self.cache, "typescript")
        local_config.write_text('{"compilerOptions": {"paths": {"shared/*": ["../shared/*"]}}}\n',
                                encoding="utf-8")
        with self.assertRaisesRegex(CacheError, "escapes the scanned source"):
            ensure_index(source, self.cache, "typescript")


if __name__ == "__main__":
    unittest.main()

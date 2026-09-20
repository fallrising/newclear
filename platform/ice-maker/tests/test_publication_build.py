import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch


class PublicationBuildTests(unittest.TestCase):
    def _repository(self, temporary: str) -> tuple[Path, Path]:
        root = Path(temporary)
        root.mkdir(exist_ok=True)
        (root / "books").mkdir(); (root / "knowledge").mkdir()
        (root / "books" / "book.json").write_text(json.dumps({"schema_version": "publication-manifest.v1", "manifest_id": "book", "title": "Book", "chapters": ["knowledge/chapter.json"]}))
        (root / "knowledge" / "chapter.json").write_text(json.dumps({"schema_version": "knowledge-record.v1", "source": "knowledge/chapter.json", "note_id": "chapter", "title": "Chapter", "text": "Synthetic text", "synthetic": True, "citations": [{"source_sha256": "a" * 64, "chunk_id": "b" * 64}], "references": []}))
        return root, root / ".ice-maker" / "publications"

    def test_builds_complete_directory_and_requires_deletion_to_rebuild(self):
        from ice_maker.publication_build import BuildError, build_publication
        with tempfile.TemporaryDirectory() as temporary:
            root, out = self._repository(temporary)
            first = build_publication(root, "books/book.json", out, "c" * 40)
            self.assertEqual(first.markdown.parent, first.html.parent)
            self.assertTrue(first.markdown.is_file() and first.html.is_file())
            with self.assertRaises(BuildError):
                build_publication(root, "books/book.json", out, "c" * 40)
            for path in (first.markdown, first.html): path.unlink()
            first.markdown.parent.rmdir()
            rebuilt = build_publication(root, "books/book.json", out, "c" * 40)
            self.assertIn(b"Source commit: `" + b"c" * 40, rebuilt.markdown.read_bytes())

    def test_rejects_root_ancestor_output_and_generated_source_symlinks(self):
        from ice_maker.publication_build import BuildError, build_publication
        with tempfile.TemporaryDirectory() as temporary:
            root, out = self._repository(temporary)
            container = root / "container"
            container.mkdir()
            (container / "repository").symlink_to(root, target_is_directory=True)
            with self.assertRaises(BuildError):
                build_publication(container / "repository", "books/book.json", out, "c" * 40)
            with self.assertRaises(BuildError):
                build_publication(root, "books/book.json", root / "outside", "c" * 40)
            (root / ".ice-maker").mkdir()
            (root / ".ice-maker" / "chapter.json").write_text((root / "knowledge" / "chapter.json").read_text())
            (root / "books" / "book.json").write_text('{"schema_version":"publication-manifest.v1","manifest_id":"book","title":"Book","chapters":[".ice-maker/chapter.json"]}')
            with self.assertRaises(BuildError):
                build_publication(root, "books/book.json", out, "c" * 40)
            (root / "books" / "book.json").write_text('{"schema_version":"publication-manifest.v1","manifest_id":"book","title":"Book","chapters":["knowledge/chapter.json"]}')
            link_parent = root / ".ice-maker" / "linked-output"
            link_parent.symlink_to(root / ".ice-maker", target_is_directory=True)
            with self.assertRaises(BuildError):
                build_publication(root, "books/book.json", link_parent / "publications", "c" * 40)

    def test_staging_and_final_publish_failures_leave_no_half_pair(self):
        from ice_maker import publication_build
        from ice_maker.publication_build import BuildError, build_publication
        with tempfile.TemporaryDirectory() as temporary:
            root, out = self._repository(temporary)
            original_write = publication_build._write_staged
            def fail_html(fd, name, data):
                if name == "book.html": raise OSError("injected")
                original_write(fd, name, data)
            with patch.object(publication_build, "_write_staged", fail_html):
                with self.assertRaises(BuildError): build_publication(root, "books/book.json", out, "c" * 40)
            self.assertFalse((out / "book").exists())
            with patch.object(publication_build, "_rename_noreplace", side_effect=OSError("injected")):
                with self.assertRaises(BuildError): build_publication(root, "books/book.json", out, "c" * 40)
            self.assertFalse((out / "book").exists())
            built = build_publication(root, "books/book.json", out, "c" * 40)
            self.assertTrue(built.markdown.is_file() and built.html.is_file())
            before = (built.markdown.read_bytes(), built.html.read_bytes())
            with patch.object(publication_build, "_write_staged", fail_html):
                with self.assertRaises(BuildError): build_publication(root, "books/book.json", out, "c" * 40)
            self.assertEqual(before, (built.markdown.read_bytes(), built.html.read_bytes()))
            with patch.object(publication_build, "_rename_noreplace", side_effect=OSError("injected")):
                with self.assertRaises(BuildError): build_publication(root, "books/book.json", out, "c" * 40)
            self.assertEqual(before, (built.markdown.read_bytes(), built.html.read_bytes()))

    def test_collision_race_never_replaces_existing_book_directory(self):
        from ice_maker import publication_build
        from ice_maker.publication_build import BuildError, build_publication
        with tempfile.TemporaryDirectory() as temporary:
            root, out = self._repository(temporary)
            original = publication_build._rename_noreplace
            def collide(fd, source, destination):
                os.mkdir(destination, dir_fd=fd)
                original(fd, source, destination)
            import os
            with patch.object(publication_build, "_rename_noreplace", collide):
                with self.assertRaises(BuildError): build_publication(root, "books/book.json", out, "c" * 40)
            self.assertTrue((out / "book").is_dir())
            self.assertFalse((out / "book" / "book.md").exists())

    def test_cli_errors_are_json_without_argument_echo(self):
        marker = "LEAK-ME-SECRET-MARKER"
        result = subprocess.run([sys.executable, "-m", "ice_maker.publication_cli", "--unknown", marker],
                                capture_output=True, text=True, env={**__import__("os").environ, "PYTHONPATH": str(Path(__file__).parents[1] / "src")})
        self.assertEqual(result.returncode, 2)
        self.assertEqual(result.stdout, '{"ok":false,"error":"publication_build_failed"}\n')
        self.assertEqual(result.stderr, "")
        self.assertNotIn(marker, result.stdout + result.stderr)

    def test_repository_descriptor_is_pinned_across_all_source_reads(self):
        from ice_maker import publication_build
        from ice_maker.publication_build import BuildError, build_publication
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root, out = self._repository(str(base / "repository"))
            replacement, _ = self._repository(str(base / "replacement"))
            saved = base / "saved"
            replacement_record = replacement / "knowledge" / "chapter.json"
            value = json.loads(replacement_record.read_text())
            value["text"] = "FROM-REPLACEMENT"
            replacement_record.write_text(json.dumps(value))
            original_read = publication_build._read_beneath
            calls = 0

            def swap_after_manifest(*args):
                nonlocal calls
                data = original_read(*args)
                calls += 1
                if calls == 1:
                    root.rename(saved)
                    replacement.rename(root)
                return data

            with patch.object(publication_build, "_read_beneath", swap_after_manifest):
                with self.assertRaises(BuildError):
                    build_publication(root, "books/book.json", out, "c" * 40)
            self.assertFalse((root / ".ice-maker").exists())
            self.assertFalse((saved / ".ice-maker").exists())

    def test_output_creation_cannot_escape_during_path_swap(self):
        from ice_maker.publication_build import BuildError, build_publication
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            root, out = self._repository(str(base / "repository"))
            moved = base / "moved"
            outside = base / "outside"
            outside.mkdir()
            original_mkdir = Path.mkdir
            swapped = False

            def swap_before_path_mkdir(path, *args, **kwargs):
                nonlocal swapped
                if not swapped and path == root / ".ice-maker":
                    root.rename(moved)
                    root.symlink_to(outside, target_is_directory=True)
                    swapped = True
                return original_mkdir(path, *args, **kwargs)

            try:
                with patch.object(Path, "mkdir", swap_before_path_mkdir):
                    try:
                        build_publication(root, "books/book.json", out, "c" * 40)
                    except BuildError:
                        pass
                self.assertFalse((outside / ".ice-maker").exists())
            finally:
                if root.is_symlink():
                    root.unlink()
                    moved.rename(root)

    def test_rejects_noncanonical_manifest_and_output_paths(self):
        from ice_maker.publication_build import BuildError, build_publication
        for manifest, suffix in (
            ("books//book.json", ".ice-maker/publications"),
            ("books/book.json", ".ice-maker/tmp/../publications"),
        ):
            with self.subTest(manifest=manifest, suffix=suffix):
                with tempfile.TemporaryDirectory() as temporary:
                    root, _ = self._repository(temporary)
                    with self.assertRaises(BuildError):
                        build_publication(root, manifest, root / suffix, "c" * 40)

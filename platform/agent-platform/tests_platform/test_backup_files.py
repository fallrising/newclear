"""Private bundle boundaries are exercised against actual files, not mocked stats."""

import hashlib
import json
import os
import struct
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from agent_platform import backup_files


class BackupFilesTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.bundle = self.root / "bundle"

    def write_bundle(self):
        payload = b"PGDMP\x00fixture contents"
        with backup_files.create_bundle(self.bundle) as directory:
            with backup_files.create_dump(directory) as dump:
                dump.write(payload)
            backup_files.complete_bundle(directory, {"version": "fixture"})
        return payload

    def test_new_bundle_is_private_and_hashes_exact_dump(self):
        payload = self.write_bundle()
        self.assertEqual(self.bundle.stat().st_mode & 0o777, 0o700)
        for name in ("database.dump", "manifest.json"):
            self.assertEqual((self.bundle / name).stat().st_mode & 0o777, 0o600)
        with backup_files.read_bundle(self.bundle) as (manifest, dump):
            self.assertEqual(dump.read(), payload)
            self.assertEqual(manifest["dump_sha256"], hashlib.sha256(payload).hexdigest())
            self.assertEqual(manifest["dump_bytes"], len(payload))

    def test_existing_destination_never_overwritten(self):
        self.write_bundle()
        original = (self.bundle / "database.dump").read_bytes()
        with self.assertRaisesRegex(ValueError, "backup_destination_exists"):
            with backup_files.create_bundle(self.bundle):
                self.fail("existing directory accepted")
        self.assertEqual((self.bundle / "database.dump").read_bytes(), original)

    def test_symlinked_ancestor_directory_and_payload_rejected(self):
        self.write_bundle()
        link = self.root / "link"
        link.symlink_to(self.bundle, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
            with backup_files.read_bundle(link):
                self.fail("symlink directory accepted")
        dump = self.bundle / "database.dump"
        saved = self.root / "saved.dump"
        dump.rename(saved)
        dump.symlink_to(saved)
        with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
            with backup_files.read_bundle(self.bundle):
                self.fail("symlink dump accepted")

    def test_hardlinks_and_open_permissions_rejected(self):
        self.write_bundle()
        dump = self.bundle / "database.dump"
        os.link(dump, self.root / "hardlink")
        with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
            with backup_files.read_bundle(self.bundle):
                self.fail("hardlink accepted")
        (self.root / "hardlink").unlink()
        for target in (dump, self.bundle, self.bundle / "manifest.json"):
            original = target.stat().st_mode & 0o777
            target.chmod(original | 0o040)
            with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
                with backup_files.read_bundle(self.bundle):
                    self.fail("public mode accepted")
            target.chmod(original)

    def test_corruption_truncation_and_partial_bundle_rejected(self):
        self.write_bundle()
        dump = self.bundle / "database.dump"
        dump.write_bytes(b"PGDMP altered content")
        with self.assertRaisesRegex(ValueError, "backup_corrupt"):
            with backup_files.read_bundle(self.bundle):
                self.fail("corrupt dump accepted")
        (self.bundle / "manifest.json").unlink()
        with self.assertRaisesRegex(ValueError, "backup_incomplete"):
            with backup_files.read_bundle(self.bundle):
                self.fail("partial bundle accepted")

    def test_manifest_json_is_bounded_strict_and_object_only(self):
        self.write_bundle()
        manifest = self.bundle / "manifest.json"
        for payload in (b"{}" * 40000, b'{"a":1,"a":2}', b'{"a":NaN}', b"[]", b"\xff"):
            manifest.write_bytes(payload)
            with self.assertRaisesRegex(ValueError, "backup_manifest_invalid"):
                with backup_files.read_bundle(self.bundle):
                    self.fail("invalid JSON accepted")

    def test_partial_write_never_becomes_completed_bundle(self):
        with (
            self.assertRaisesRegex(RuntimeError, "fixture"),
            backup_files.create_bundle(self.bundle) as directory,
        ):
            with backup_files.create_dump(directory) as dump:
                dump.write(b"partial")
                raise RuntimeError("fixture")
        self.assertFalse((self.bundle / "manifest.json").exists())
        with self.assertRaisesRegex(ValueError, "backup_incomplete"):
            with backup_files.read_bundle(self.bundle):
                self.fail("partial bundle accepted")

    def test_verified_open_descriptor_survives_path_replacement(self):
        payload = self.write_bundle()
        with backup_files.read_bundle(self.bundle) as (_, dump):
            (self.bundle / "database.dump").rename(self.root / "original")
            (self.bundle / "database.dump").write_bytes(b"replacement")
            self.assertEqual(dump.read(), payload)

    def test_manifest_dump_fields_cannot_be_forged_types(self):
        self.write_bundle()
        target = self.bundle / "manifest.json"
        original = json.loads(target.read_text())
        for key, value in (("dump_bytes", True), ("dump_bytes", -1), ("dump_sha256", [])):
            target.write_text(json.dumps({**original, key: value}))
            with self.assertRaisesRegex(ValueError, "backup_manifest_invalid"):
                with backup_files.read_bundle(self.bundle):
                    self.fail("invalid manifest accepted")

    def test_failed_completion_invalidates_manifest(self):
        with (
            self.assertRaisesRegex(RuntimeError, "fixture"),
            backup_files.create_bundle(self.bundle) as directory,
        ):
            with backup_files.create_dump(directory) as dump:
                dump.write(b"PGDMP contents")
            backup_files.complete_bundle(directory, {"version": "fixture"})
            raise RuntimeError("fixture")
        self.assertFalse((self.bundle / "manifest.json").exists())
        self.assertTrue((self.bundle / "database.dump").exists())

    def test_fifo_and_oversized_payload_are_rejected(self):
        self.write_bundle()
        dump = self.bundle / "database.dump"
        dump.unlink()
        os.mkfifo(dump, 0o600)
        with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
            with backup_files.read_bundle(self.bundle):
                self.fail("FIFO accepted")
        dump.unlink()
        dump.write_bytes(b"PGDMP" + b"x" * 2048)
        dump.chmod(0o600)
        with mock.patch.object(backup_files, "DUMP_LIMIT", 1024):
            with self.assertRaisesRegex(ValueError, "backup_corrupt"):
                with backup_files.read_bundle(self.bundle):
                    self.fail("oversized dump accepted")

    def test_unsafe_parent_cannot_create_or_damage_existing_bundle(self):
        self.write_bundle()
        original = (self.bundle / "manifest.json").read_bytes()
        self.root.chmod(0o770)
        try:
            with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
                with backup_files.create_bundle(self.root / "another"):
                    self.fail("writable parent accepted")
            self.assertFalse((self.root / "another").exists())
            self.assertEqual((self.bundle / "manifest.json").read_bytes(), original)
            with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
                with backup_files.read_bundle(self.bundle):
                    self.fail("unsafe ancestor accepted")
        finally:
            self.root.chmod(0o700)

    def test_default_acl_parent_rejected_before_creation(self):
        acl = struct.pack("<I", 2) + b"".join(
            struct.pack("<HHI", tag, permissions, 0xFFFFFFFF)
            for tag, permissions in ((1, 7), (4, 0), (32, 0))
        )
        os.setxattr(self.root, "system.posix_acl_default", acl)
        try:
            with self.assertRaisesRegex(ValueError, "backup_unsafe_path"):
                with backup_files.create_bundle(self.bundle):
                    self.fail("default ACL accepted")
            self.assertFalse(self.bundle.exists())
        finally:
            os.removexattr(self.root, "system.posix_acl_default")

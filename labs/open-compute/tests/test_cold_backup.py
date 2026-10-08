"""Cold archive safety tests; these do not certify upstream recovery."""

import fcntl
from contextlib import nullcontext
import json
import os
from pathlib import Path
import signal
import stat
import struct
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import cold_backup as cb
import lab


class ColdBackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.environment = patch.dict(os.environ, {"RUNNER_TEMP": str(self.root)})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.scope = lab.OwnedScope(self.root / "scope", 8787)
        self.scope.create()
        self.removals = []
        original_remove = self.scope.remove
        def remove(processes_stopped):
            original_remove(processes_stopped)
            self.removals.append(not self.scope.path.exists())
        self.scope.remove = remove
        for name in cb.REQUIRED_FILES | set(cb.LOCKS):
            if not (self.scope.path / name).exists():
                self.write(name, ("synthetic:" + name).encode())
        self.write(cb.DATA + "/d1/one/database.sqlite", b"synthetic-d1\0\xff")
        self.write(cb.DATA + "/objects/objects/r2/sentinel/object.ocobj", bytes(range(256)))
        self.write(cb.DATA + "/control.sqlite-wal", b"preserve-wal")
        # Names resembling transient files remain persistent outside exact roots.
        self.write(cb.DATA + "/objects/objects/cache/runtime/ocd.lock", b"payload-name")
        self.write("instances/lab/config-note", b"preserve-mode", 0o644)
        os.chmod(self.scope.path / "instances", 0o755)
        self.events = []
        self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
            time.monotonic() + 30, lambda event, summary: self.events.append((event, summary)))

    def write(self, relative, data, mode=0o600):
        path = self.scope.path / relative
        parents = []
        parent = path.parent
        while parent != self.scope.path and not parent.exists():
            parents.append(parent)
            parent = parent.parent
        for parent in reversed(parents):
            parent.mkdir(mode=0o700)
        with open(path, "wb") as stream:
            stream.write(data)
        os.chmod(path, mode)
        return path

    def assert_source_preserved(self):
        self.assertEqual(self.removals, [])
        self.scope.check_owner()
        self.assertEqual((self.scope.path / (cb.DATA + "/control.sqlite-wal")).read_bytes(),
                         b"preserve-wal")

    def mutate_package(self, mutation):
        write = self.recovery.write_package
        def changed(manifest):
            write(manifest)
            path = self.recovery.private.path / "payload.ocb"
            mutation(path)
        return patch.object(self.recovery, "write_package", side_effect=changed)

    def change_manifest(self, mutation):
        def modify(path):
            raw = path.read_bytes()
            length = struct.unpack(">Q", raw[8:16])[0]
            manifest = json.loads(raw[16:16 + length])
            mutation(manifest)
            body = cb.canonical(manifest)
            path.write_bytes(cb.MAGIC + struct.pack(">Q", len(body)) + body + raw[16 + length:])
        return self.mutate_package(modify)

    def test_roundtrip_removes_source_restores_all_bytes_and_preserves_modes(self):
        before = self.recovery.inventory(self.scope.path)
        source_identity = dict(self.scope.identity)
        self.write("run/transient", b"not-authority")
        result = self.recovery.recover()
        self.assertEqual(self.removals, [True])
        self.assertNotEqual(self.scope.identity, source_identity)
        self.assertEqual(self.recovery.inventory(self.scope.path), before)
        self.assertFalse((self.scope.path / "run").exists())
        self.assertEqual(stat.S_IMODE((self.scope.path / "instances").stat().st_mode), 0o755)
        self.assertTrue(result["source_absent"] and result["data_absent"])
        self.assertTrue(result["restored_verified"])
        self.assertEqual([e for e, _ in self.events],
                         ["locked", "backup_verified", "source_removed", "restored"])
        for entry in before["entries"]:
            if entry["type"] == "file":
                self.assertEqual((self.scope.path / entry["path"]).stat().st_nlink, 1)
        self.assertEqual(self.recovery.cleanup(True), {"private_removed": True, "staging_removed": True})
        self.scope.remove(True)

    def test_exact_ocr_assets_are_omitted_from_a_real_cold_roundtrip(self):
        derived = cb.DATA + "/tessdata/" + "1" * 64
        model = self.write(derived + "/chi_sim.traineddata", b"synthetic-embedded-model")
        os.link(model, model.parent / "zho.traineddata")
        self.assertEqual(model.stat().st_nlink, 2)
        persistent = {
            "tessdata/business.txt": b"top-level-persistent-data",
            cb.DATA + "/objects/objects/tessdata/object.ocobj": b"object-named-tessdata",
        }
        for path, contents in persistent.items():
            self.write(path, contents)
        source_identity = dict(self.scope.identity)
        before = self.recovery.inventory(self.scope.path)
        paths = {entry["path"] for entry in before["entries"]}
        excluded = cb.DATA + "/tessdata"
        self.assertFalse(any(path == excluded or path.startswith(excluded + "/") for path in paths))
        self.assertTrue(set(persistent) <= paths)

        recovered = self.recovery.recover()
        self.assertEqual(self.removals, [True])
        self.assertTrue(recovered["source_absent"] and recovered["data_absent"])
        self.assertNotEqual(self.scope.identity, source_identity)
        self.assertFalse((self.scope.path / excluded).exists())
        self.assertEqual(self.recovery.inventory(self.scope.path), before)
        for path, contents in persistent.items():
            self.assertEqual((self.scope.path / path).read_bytes(), contents)
            self.assertEqual((self.scope.path / path).stat().st_nlink, 1)
        self.assertTrue(all(self.recovery.cleanup(True).values()))
        self.scope.remove(True)

    def test_tessdata_basename_elsewhere_does_not_allow_hardlinks(self):
        for directory in ("tessdata", cb.DATA + "/objects/objects/tessdata"):
            with self.subTest(directory=directory):
                model = self.write(directory + "/chi_sim.traineddata", b"persistent-data")
                alias = model.parent / "zho.traineddata"
                os.link(model, alias)
                with self.assertRaisesRegex(cb.BackupError, "hard-linked"):
                    self.recovery.recover()
                self.assert_source_preserved()
                self.assertTrue(all(self.recovery.cleanup(True).values()))
                alias.unlink()
                model.unlink()
                self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                              time.monotonic() + 30, lambda *_: None)

    def test_corrupt_truncated_and_extra_payload_preserve_source(self):
        for mutation in (lambda p: p.write_bytes(p.read_bytes()[:-1]),
                         lambda p: p.write_bytes(p.read_bytes() + b"extra"),
                         lambda p: p.write_bytes(p.read_bytes()[:-1] + b"X")):
            with self.subTest(mutation=mutation), self.mutate_package(mutation):
                with self.assertRaises(cb.BackupError):
                    self.recovery.recover()
            self.assert_source_preserved()
            self.recovery.cleanup(True)
            self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                          time.monotonic() + 30, lambda *_: None)

    def test_missing_required_authority_is_not_repaired(self):
        (self.scope.path / (cb.DATA + "/keys/master.key")).unlink()
        with self.assertRaisesRegex(cb.BackupError, "required authority"):
            self.recovery.recover()
        self.assert_source_preserved()
        self.recovery.cleanup(True)

    def test_manifest_attacks_fail_before_source_removal(self):
        mutations = {
            "traversal": lambda m: m["entries"][0].update(path="../escape"),
            "absolute": lambda m: m["entries"][0].update(path="/escape"),
            "duplicate": lambda m: m["entries"].insert(1, dict(m["entries"][0])),
            "link": lambda m: m["entries"][0].update(type="symlink"),
            "hardlink": lambda m: m["entries"][0].update(type="hardlink"),
            "foreign uid": lambda m: m["entries"][0].update(uid=os.geteuid() + 1),
            "extra exclusions": lambda m: m.update(exclusions=["keys"]),
            "missing file": lambda m: m["entries"].pop(),
            "huge file": lambda m: next(e for e in m["entries"] if e["type"] == "file").update(size=cb.MAX_FILE + 1),
        }
        for label, mutation in mutations.items():
            with self.subTest(label=label), self.change_manifest(mutation):
                with self.assertRaises(cb.BackupError):
                    self.recovery.recover()
            self.assert_source_preserved()
            self.recovery.cleanup(True)
            self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                          time.monotonic() + 30, lambda *_: None)

    def test_source_symlink_hardlink_fifo_and_modes_are_refused(self):
        path = self.scope.path / "unexpected"
        target = self.scope.path / "ocd.toml"
        mutations = (
            lambda: path.symlink_to(target),
            lambda: os.link(target, path),
            lambda: os.mkfifo(path, 0o600),
            lambda: self.write("unexpected", b"unsafe", 0o666),
            lambda: self.write("unexpected", b"unsafe", 0o4600),
        )
        for mutation in mutations:
            mutation()
            with self.assertRaises(cb.BackupError):
                self.recovery.recover()
            self.assert_source_preserved()
            path.unlink()
            self.recovery.cleanup(True)
            self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                          time.monotonic() + 30, lambda *_: None)

    def test_private_key_and_local_modes_require_600(self):
        path = self.scope.path / (cb.DATA + "/keys/master.key")
        os.chmod(path, 0o644)
        with self.assertRaisesRegex(cb.BackupError, "private authority"):
            self.recovery.recover()
        self.assert_source_preserved()
        self.recovery.cleanup(True)

    def test_source_lock_contention_and_symlink_fail_closed(self):
        path = self.scope.path / "ocd.lock"
        with path.open("rb") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(cb.BackupError):
                self.recovery.recover()
        self.assert_source_preserved()
        path.unlink()
        path.symlink_to(self.scope.path / "ocd.toml")
        other = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                              time.monotonic() + 30, lambda *_: None)
        with self.assertRaises(cb.BackupError):
            other.recover()
        self.assert_source_preserved()

    def test_bounds_and_deadline_preserve_source(self):
        for constant, limit in (("MAX_ENTRIES", 2), ("MAX_FILE", 8), ("MAX_TOTAL", 16),
                                ("MAX_MANIFEST", 32), ("MAX_PATH", 8), ("MAX_ARCHIVE", 32)):
            with self.subTest(constant=constant), patch.object(cb, constant, limit):
                with self.assertRaises(cb.BackupError):
                    self.recovery.recover()
            self.assert_source_preserved()
            self.recovery.cleanup(True)
            self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                          time.monotonic() + 30, lambda *_: None)
        self.recovery.deadline = time.monotonic() - 1
        with self.assertRaisesRegex(cb.BackupError, "deadline"):
            self.recovery.recover()
        self.assert_source_preserved()

    def test_occupied_restore_destination_is_never_overwritten(self):
        def progress(event, _summary):
            if event == "source_removed":
                self.scope.path.mkdir(mode=0o700)
                (self.scope.path / "foreign").write_bytes(b"do-not-remove")
        self.recovery.progress = progress
        with self.assertRaisesRegex(cb.BackupError, "occupied"):
            self.recovery.recover()
        self.assertEqual(self.removals, [True])
        self.assertIsNone(self.scope.identity)
        self.assertEqual((self.scope.path / "foreign").read_bytes(), b"do-not-remove")
        self.recovery.cleanup(True)
        self.assertEqual((self.scope.path / "foreign").read_bytes(), b"do-not-remove")

    def test_no_replace_rename_closes_destination_race(self):
        install = self.recovery.install
        def racing_install():
            rename = self.recovery._rename
            def race(*args):
                self.scope.path.mkdir(mode=0o700)
                (self.scope.path / "foreign").write_bytes(b"preserve")
                return rename(*args)
            self.recovery._rename = race
            install()
        with patch.object(self.recovery, "install", side_effect=racing_install):
            with self.assertRaisesRegex(cb.BackupError, "no-clobber"):
                self.recovery.recover()
        self.assertEqual((self.scope.path / "foreign").read_bytes(), b"preserve")
        self.recovery.cleanup(True)

    def test_unknown_private_partial_is_not_deleted(self):
        write = self.recovery.write_package
        def interrupted(manifest):
            write(manifest)
            foreign = self.recovery.private.path / "foreign.partial"
            foreign.write_bytes(b"foreign")
            os.chmod(foreign, 0o600)
            raise cb.BackupError("simulated interrupted write")
        with patch.object(self.recovery, "write_package", side_effect=interrupted):
            with self.assertRaises(cb.BackupError):
                self.recovery.recover()
        self.assert_source_preserved()
        with self.assertRaisesRegex(cb.BackupError, "cleanup refused"):
            self.recovery.cleanup(True)
        self.assertEqual((self.recovery.private.path / "foreign.partial").read_bytes(), b"foreign")

    def test_changed_stage_marker_is_preserved(self):
        def progress(event, _summary):
            if event == "backup_verified":
                (self.recovery.stage.path / cb.MARKER).write_text("foreign")
        self.recovery.progress = progress
        with self.assertRaisesRegex(cb.BackupError, "marker"):
            self.recovery.recover()
        self.assert_source_preserved()
        with self.assertRaises(cb.BackupError):
            self.recovery.cleanup(True)
        self.assertEqual((self.recovery.stage.path / cb.MARKER).read_text(), "foreign")

    def test_foreign_staging_partial_prevents_source_removal_and_cleanup(self):
        def progress(event, _summary):
            if event == "backup_verified":
                foreign = self.recovery.stage.path / "foreign.partial"
                foreign.write_bytes(b"unowned")
                os.chmod(foreign, 0o600)
        self.recovery.progress = progress
        with self.assertRaisesRegex(cb.BackupError, "unowned"):
            self.recovery.recover()
        self.assert_source_preserved()
        with self.assertRaises(cb.BackupError):
            self.recovery.cleanup(True)
        self.assertEqual((self.recovery.stage.path / "foreign.partial").read_bytes(), b"unowned")

    def test_interrupt_during_extraction_cleans_only_created_partial(self):
        def progress(event, _summary):
            if event == "source_removed":
                create_file = self.recovery.stage.create_file
                def interrupted(relative):
                    stream = create_file(relative)
                    stream.write(b"incomplete-owned-data")
                    stream.close()
                    raise cb.BackupError("simulated extraction interruption")
                self.recovery.stage.create_file = interrupted
        self.recovery.progress = progress
        with self.assertRaisesRegex(cb.BackupError, "interruption"):
            self.recovery.recover()
        self.assertEqual(self.removals, [True])
        self.assertIsNone(self.scope.identity)
        stage, private = self.recovery.stage.path, self.recovery.private.path
        self.assertEqual(self.recovery.cleanup(True), {"private_removed": True, "staging_removed": True})
        self.assertFalse(stage.exists() or private.exists())

    def test_duplicate_json_fields_and_oversized_manifest_header_fail_before_delete(self):
        for header in (b'{"format":1,"format":1,"entries":[]}', None):
            def mutation(path):
                raw = header if header is not None else b""
                length = len(raw) if header is not None else cb.MAX_MANIFEST + 1
                path.write_bytes(cb.MAGIC + struct.pack(">Q", length) + raw)
            with self.mutate_package(mutation):
                with self.assertRaises(cb.BackupError):
                    self.recovery.recover()
            self.assert_source_preserved()
            self.recovery.cleanup(True)
            self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                          time.monotonic() + 30, lambda *_: None)

    def test_package_corruption_after_verification_still_prevents_delete(self):
        def progress(event, _summary):
            if event == "backup_verified":
                (self.recovery.private.path / "payload.ocb").write_bytes(b"corrupt")
        self.recovery.progress = progress
        with self.assertRaises(cb.BackupError):
            self.recovery.recover()
        self.assert_source_preserved()
        self.recovery.cleanup(True)

    def test_cleanup_requires_known_process_exit_and_public_output_is_aggregate_only(self):
        self.recovery.recover()
        with self.assertRaises(cb.BackupError):
            self.recovery.cleanup(False)
        self.assertTrue(self.recovery.private.path.exists())
        text = json.dumps(self.events)
        self.assertNotIn(str(self.root), text)
        self.assertNotIn("master.key", text)
        self.assertNotIn(self.scope.marker, text)
        self.recovery.cleanup(True)
        self.scope.remove(True)

    def test_private_package_cannot_be_created_under_source_or_cache(self):
        for parent in (self.scope.path, self.root / "cache"):
            parent.mkdir(mode=0o700, exist_ok=True)
            with patch.dict(os.environ, {"RUNNER_TEMP": str(parent)}):
                with self.assertRaisesRegex(cb.BackupError, "overlaps"):
                    self.recovery.recover()
            self.assert_source_preserved()
            self.recovery = cb.ColdRestore(self.scope, self.root / "cache", self.root / "report",
                                          time.monotonic() + 30, lambda *_: None)

    def test_cleanup_deadline_interrupts_blocked_removal_and_preserves_unfinished_root(self):
        self.recovery.recover()
        private = self.recovery.private.path
        handler = signal.getsignal(signal.SIGALRM)
        timer = signal.getitimer(signal.ITIMER_REAL)
        started = time.monotonic()
        with patch.object(cb, "CLEANUP_SECONDS", 0.03), \
                patch.object(cb.shutil, "rmtree", side_effect=lambda _path: time.sleep(1)):
            with self.assertRaisesRegex(cb.CleanupDeadline, "deadline"):
                self.recovery.cleanup(True)
        self.assertLess(time.monotonic() - started, 0.5)
        self.assertTrue(private.is_dir())
        self.assertEqual(signal.getsignal(signal.SIGALRM), handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), timer)
        self.assertEqual(self.recovery.cleanup(True), {"private_removed": True, "staging_removed": True})
        self.scope.remove(True)

    def test_inventory_stops_lazy_directory_after_limit_plus_one(self):
        consumed = []
        def lazy_children():
            for index in range(1000):
                consumed.append(index)
                if index > 3:
                    raise AssertionError("inventory consumed beyond cap plus one")
                name = "entry-" + str(index)
                yield SimpleNamespace(name=name, path=str(self.scope.path / name))
        with patch.object(cb, "MAX_ENTRIES", 3), \
                patch.object(cb.os, "scandir", return_value=nullcontext(lazy_children())):
            with self.assertRaisesRegex(cb.BackupError, "entry count"):
                self.recovery.inventory(self.scope.path)
        self.assertEqual(consumed, [0, 1, 2, 3])
        self.assert_source_preserved()


if __name__ == "__main__":
    unittest.main()

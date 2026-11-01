"""Cold metadata accounting contracts; these fixtures do not certify upstream."""

import copy
import fcntl
import json
import os
from pathlib import Path
import signal
import socket
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import storage


def live_fds():
    result = set()
    for name in os.listdir("/proc/self/fd"):
        try:
            os.fstat(int(name))
            result.add(int(name))
        except OSError:
            pass
    return result


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "scope"
        self.root.mkdir(mode=0o700)
        info = self.root.stat()
        self.scope = SimpleNamespace(path=self.root,
            identity={"device": info.st_dev, "inode": info.st_ino}, marker="a" * 64)
        self.write(".open-compute-lab-owner", b"a" * 64)
        for path in ("ocd.lock", "instances/lab/data/platform.lock",
                     "instances/lab/data/objects/backend.lock"):
            self.write(path, b"")

    def write(self, relative, data=b"x", mode=0o600):
        path = self.root / relative
        parents = []
        parent = path.parent
        while parent != self.root and not parent.exists():
            parents.append(parent)
            parent = parent.parent
        for parent in reversed(parents):
            parent.mkdir(mode=0o700)
        path.write_bytes(data)
        path.chmod(mode)
        return path

    def snapshot(self, phase="cold_baseline"):
        return storage.cold_snapshot(self.scope, phase, deadline=time.monotonic() + 10)

    def assert_reason(self, reason, action):
        with self.assertRaises(storage.StorageError) as caught:
            action()
        self.assertEqual(str(caught.exception), reason)

    def test_entire_scope_groups_sparse_and_distinct_inodes(self):
        self.write("cache/cache.bin", b"cache")
        self.write("instances/lab/data/runtime/temp.bin", b"temp")
        self.write("instances/lab/data/tessdata/model", b"derived")
        self.write("instances/lab/data/objects/value", b"object")
        self.write("instances/lab/data/d1/equal-one", b"same")
        self.write("instances/lab/data/d1/equal-two", b"same")
        sparse = self.write("sparse", b"")
        with sparse.open("wb") as stream:
            stream.truncate(1024 * 1024)
        result = self.snapshot()
        self.assertEqual(result["totals"]["logical_bytes"], 1024 * 1024 + 30)
        self.assertEqual(result["totals"]["regular_paths"], 10)
        self.assertEqual(result["groups"]["derived_tessdata"]["logical_bytes"], 7)
        self.assertEqual(result["groups"]["instance_other"]["logical_bytes"], 8)
        self.assertLess(result["totals"]["allocated_bytes"], result["totals"]["logical_bytes"])
        self.assertEqual(result["entries"], sum(result["totals"][x]
            for x in ("regular_paths", "directories", "sockets")))
        self.assertEqual(result, storage.project_snapshot(result))
        self.assertNotIn("model", json.dumps(result))

    def test_hardlinks_deduplicate_but_cross_group_alias_fails(self):
        original = self.write("instances/lab/data/tessdata/eng", b"model")
        os.link(original, original.with_name("alias"))
        result = self.snapshot()
        group = result["groups"]["derived_tessdata"]
        self.assertEqual((group["logical_bytes"], group["regular_paths"],
                          group["unique_files"], group["hardlink_aliases"]), (5, 2, 1, 1))
        os.link(original, self.root / "outside")
        self.assert_reason("metadata", self.snapshot)

    def test_transient_sockets_count_without_blocks_elsewhere_refused(self):
        directory = self.root / "run"
        directory.mkdir(mode=0o700)
        server = socket.socket(socket.AF_UNIX)
        self.addCleanup(server.close)
        previous_cwd = os.open(".", os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.chdir(directory)
            server.bind("socket")
            os.chmod("socket", 0o600)
        finally:
            os.fchdir(previous_cwd)
            os.close(previous_cwd)
        result = self.snapshot()
        self.assertEqual(result["groups"]["scope_transient"]["sockets"], 1)
        self.assertEqual(result["groups"]["scope_transient"]["allocated_bytes"], 0)
        os.rename(directory / "socket", self.root / "socket")
        self.assert_reason("type", self.snapshot)

    def test_symlink_fifo_unsafe_mode_and_marker_mutations(self):
        for kind in ("symlink", "fifo", "mode"):
            with self.subTest(kind=kind):
                leaf = self.root / "unsafe"
                if kind == "symlink":
                    leaf.symlink_to(self.temp.name)
                elif kind == "fifo":
                    os.mkfifo(leaf)
                else:
                    self.write("unsafe", b"x", 0o666)
                self.assert_reason("type" if kind != "mode" else "ownership", self.snapshot)
                leaf.unlink()
        marker = self.root / ".open-compute-lab-owner"
        for data in (b"b" * 64, b"a" * 65, b"a" * 63, b"A" * 64):
            marker.write_bytes(data)
            self.assert_reason("ownership", self.snapshot)
        marker.unlink()
        os.mkfifo(marker, 0o600)
        self.assert_reason("ownership", self.snapshot)

    def test_missing_held_unsafe_locks_not_created_and_released_on_failure(self):
        path = self.root / "ocd.lock"
        fd = os.open(path, os.O_RDONLY)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.assert_reason("lock", self.snapshot)
            fcntl.flock(fd, fcntl.LOCK_UN)
        finally:
            os.close(fd)
        path.unlink()
        self.assert_reason("lock", self.snapshot)
        self.assertFalse(path.exists())
        self.write("ocd.lock", b"", 0o666)
        self.assert_reason("lock", self.snapshot)
        path.chmod(0o600)
        self.write("unsafe", b"", 0o666)
        self.assert_reason("ownership", self.snapshot)
        with path.open("rb") as stream:
            fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_root_identity_and_symlinked_lock_ancestor_refused(self):
        self.scope.identity["inode"] += 1
        self.assert_reason("ownership", self.snapshot)
        self.scope.identity["inode"] -= 1
        os.rename(self.root / "instances", self.root / "saved")
        (self.root / "instances").symlink_to("saved")
        self.assert_reason("lock", self.snapshot)

    def test_entry_depth_path_file_and_aggregate_limits(self):
        leaf = self.write("data", b"12345678")
        cases = (("MAX_ENTRIES", 2), ("MAX_DEPTH", 2), ("MAX_PATH_BYTES", 8),
                 ("MAX_FILE_LOGICAL_BYTES", 4), ("MAX_TOTAL_LOGICAL_BYTES", 4),
                 ("MAX_TOTAL_ALLOCATED_BYTES", 1))
        for name, bound in cases:
            with self.subTest(name=name), patch.object(storage, name, bound):
                self.assert_reason("limit", self.snapshot)
        leaf.unlink()

    def test_expired_and_blocking_deadline_restore_signal_timer(self):
        previous_handler = signal.getsignal(signal.SIGALRM)
        previous_timer = signal.getitimer(signal.ITIMER_REAL)
        self.assert_reason("deadline", lambda: storage.cold_snapshot(
            self.scope, "cold_baseline", deadline=time.monotonic() - 1))
        original = os.scandir
        def blocked(fd):
            time.sleep(.2)
            return original(fd)
        with patch.object(storage.os, "scandir", side_effect=blocked):
            self.assert_reason("deadline", lambda: storage.cold_snapshot(
                self.scope, "cold_baseline", deadline=time.monotonic() + .03))
        self.assertEqual(signal.getsignal(signal.SIGALRM), previous_handler)
        self.assertEqual(signal.getitimer(signal.ITIMER_REAL), previous_timer)

    def test_foreign_uid_device_special_modes_and_unreadable_metadata(self):
        self.write("file", b"x")
        original = os.stat
        for field, value in (("st_uid", os.geteuid() + 1), ("st_dev", self.root.stat().st_dev + 1),
                             ("st_mode", 0o104600)):
            def changed(path, *args, **kwargs):
                info = original(path, *args, **kwargs)
                if path == "file":
                    values = {name: getattr(info, name) for name in dir(info) if name.startswith("st_")}
                    values[field] = value
                    return SimpleNamespace(**values)
                return info
            with self.subTest(field=field), patch.object(storage.os, "stat", side_effect=changed):
                self.assert_reason("ownership", self.snapshot)
        def unreadable(path, *args, **kwargs):
            if path == "file":
                raise PermissionError("private path /credential")
            return original(path, *args, **kwargs)
        with patch.object(storage.os, "stat", side_effect=unreadable):
            self.assert_reason("metadata", self.snapshot)

    def test_changing_and_disappearing_file_metadata(self):
        leaf = self.write("changing", b"one")
        original = os.stat
        for disappear in (False, True):
            calls = 0
            def changed(path, *args, **kwargs):
                nonlocal calls
                if path == "changing":
                    calls += 1
                    if calls == 2:
                        if disappear:
                            leaf.unlink()
                        else:
                            leaf.write_bytes(b"second value")
                return original(path, *args, **kwargs)
            with self.subTest(disappear=disappear), patch.object(storage.os, "stat", side_effect=changed):
                self.assert_reason("metadata", self.snapshot)

    def test_root_marker_lock_and_directory_change_fail_final_rechecks(self):
        original_scan = storage._scan
        for change, reason in (("marker", "ownership"), ("lock", "lock"), ("root", "ownership")):
            def changed(*args):
                result = original_scan(*args)
                if change == "marker":
                    (self.root / ".open-compute-lab-owner").write_bytes(b"a" * 64)
                elif change == "lock":
                    path = self.root / "ocd.lock"
                    path.rename(self.root / "old-lock")
                    self.write("ocd.lock", b"")
                else:
                    self.root.rename(self.root.with_name("old-root"))
                    self.root.mkdir(mode=0o700)
                return result
            with self.subTest(change=change), patch.object(storage, "_scan", side_effect=changed):
                self.assert_reason(reason, self.snapshot)
        # Directory mutation must fail even when the new entry is not emitted by its iterator.
        os.rmdir(self.root)
        self.root.with_name("old-root").rename(self.root)
        original_scandir = os.scandir
        touched = False
        def changing_directory(fd):
            nonlocal touched
            scan = original_scandir(fd)
            if not touched:
                touched = True
                self.write("new-file", b"x")
            return scan
        with patch.object(storage.os, "scandir", side_effect=changing_directory):
            self.assert_reason("metadata", self.snapshot)

    def test_no_payload_reads_bounded_marker_and_descriptor_release(self):
        self.write("secret-payload", b"should never be read")
        before = live_fds()
        original_open, original_read = os.open, os.read
        opened, requested = [], []
        def record_open(path, flags, *args, **kwargs):
            opened.append((str(path), flags))
            return original_open(path, flags, *args, **kwargs)
        def record_read(fd, count):
            requested.append(count)
            return original_read(fd, count)
        with patch.object(storage.os, "open", side_effect=record_open), \
             patch.object(storage.os, "read", side_effect=record_read):
            self.snapshot()
        self.assertFalse(any(path == "secret-payload" for path, flags in opened))
        self.assertEqual(requested, [65, 65])
        self.assertEqual(before, live_fds())
        self.write("bad", b"", 0o666)
        self.assert_reason("ownership", self.snapshot)
        self.assertEqual(before, live_fds())
        for name in storage.LOCKS:
            with (self.root / name).open("rb") as stream:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)

    def test_inherited_timer_not_paused_and_handler_restored(self):
        original_handler = signal.getsignal(signal.SIGALRM)
        original_timer = signal.getitimer(signal.ITIMER_REAL)
        def handler(signum, frame):
            raise RuntimeError("external timer")
        try:
            signal.signal(signal.SIGALRM, handler)
            signal.setitimer(signal.ITIMER_REAL, 1, 0.5)
            self.snapshot()
            remaining, interval = signal.getitimer(signal.ITIMER_REAL)
            self.assertGreater(remaining, 0)
            self.assertLessEqual(remaining, 1)
            self.assertEqual(interval, .5)
            self.assertIs(signal.getsignal(signal.SIGALRM), handler)
            signal.setitimer(signal.ITIMER_REAL, .02)
            with patch.object(storage.os, "scandir", side_effect=lambda fd: time.sleep(.2)):
                self.assert_reason("deadline", self.snapshot)
            self.assertIs(signal.getsignal(signal.SIGALRM), handler)
            self.assertEqual(signal.getitimer(signal.ITIMER_REAL), (0., 0.))
        finally:
            signal.setitimer(signal.ITIMER_REAL, 0)
            signal.signal(signal.SIGALRM, original_handler)
            signal.setitimer(signal.ITIMER_REAL, *original_timer)

    def test_replaced_during_open_lock_and_marker_hardlinks_refused(self):
        original_open = os.open
        replaced = False
        def swap(path, flags, *args, **kwargs):
            nonlocal replaced
            if path == "ocd.lock" and not replaced:
                replaced = True
                (self.root / "ocd.lock").rename(self.root / "old-lock")
                self.write("ocd.lock", b"")
            return original_open(path, flags, *args, **kwargs)
        with patch.object(storage.os, "open", side_effect=swap):
            self.assert_reason("lock", self.snapshot)
        marker = self.root / ".open-compute-lab-owner"
        os.link(marker, self.root / "marker-alias")
        self.assert_reason("ownership", self.snapshot)

    def test_lock_release_failure_cannot_return_a_passing_snapshot(self):
        original = fcntl.flock
        def fail_release(fd, operation):
            if operation == fcntl.LOCK_UN:
                raise OSError("sensitive filesystem failure")
            return original(fd, operation)
        before = live_fds()
        with patch.object(storage.fcntl, "flock", side_effect=fail_release):
            self.assert_reason("lock", self.snapshot)
        self.assertEqual(before, live_fds())

    def test_lazy_wide_directory_and_exact_byte_boundaries(self):
        self.write("payload", b"12345678")
        result = self.snapshot()
        with patch.object(storage, "MAX_ENTRIES", result["entries"]), \
             patch.object(storage, "MAX_TOTAL_LOGICAL_BYTES", result["totals"]["logical_bytes"]), \
             patch.object(storage, "MAX_TOTAL_ALLOCATED_BYTES", result["totals"]["allocated_bytes"]):
            self.snapshot()
        original_scandir = os.scandir
        class LazyScan:
            def __init__(self, fd):
                self.fd = fd
                self.scan = original_scandir(fd)
            def __enter__(self):
                return self
            def __exit__(self, *args):
                self.scan.close()
            def close(self):
                self.scan.close()
            def __iter__(self):
                for i, entry in enumerate(self.scan):
                    if i > 3:
                        raise AssertionError("unbounded directory consumption")
                    yield entry
        with patch.object(storage, "MAX_ENTRIES", 2), \
             patch.object(storage.os, "scandir", side_effect=LazyScan):
            self.assert_reason("limit", self.snapshot)

    def test_all_acquisition_boundaries_survive_trace_and_actual_alarm(self):
        original = storage._acquire
        acquisitions = []
        def record(*args):
            result = original(*args)
            acquisitions.append(result)
            return result
        with patch.object(storage, "_acquire", side_effect=record):
            self.snapshot()
        source = Path(storage.__file__)
        target = next(i for i, line in enumerate(source.read_text().splitlines(), 1)
                      if "stack.callback(owner.close)" in line)
        for actual_signal in (False, True):
            for boundary in range(1, len(acquisitions) + 1):
                observed = 0
                before = live_fds()
                def trace(frame, event, arg):
                    nonlocal observed
                    if event == "line" and frame.f_code.co_filename == str(source) and frame.f_lineno == target:
                        observed += 1
                        if observed == boundary:
                            if actual_signal:
                                signal.raise_signal(signal.SIGALRM)
                            else:
                                raise storage.StorageError("deadline")
                    return trace
                with self.subTest(actual_signal=actual_signal, boundary=boundary):
                    try:
                        sys.settrace(trace)
                        self.assert_reason("deadline", self.snapshot)
                    finally:
                        sys.settrace(None)
                    self.assertEqual(before, live_fds())

    def test_thread_directed_signal_defers_handler_until_registration(self):
        from contextlib import ExitStack
        for signum in (signal.SIGALRM, signal.SIGINT, signal.SIGTERM):
            ready, delivered = threading.Event(), threading.Event()
            def sender():
                signal.pthread_sigmask(signal.SIG_UNBLOCK, {signum})
                if ready.wait(1):
                    signal.pthread_kill(threading.get_ident(), signum)
                delivered.set()
            thread = threading.Thread(target=sender)
            previous = signal.getsignal(signum)
            def interrupted(signum, frame):
                raise storage.StorageError("deadline")
            signal.signal(signum, interrupted)
            thread.start()
            before = live_fds()
            original = ExitStack.callback
            fired = False
            def at_registration(stack, callback, *args, **kwargs):
                nonlocal fired
                if not fired and isinstance(getattr(callback, "__self__", None), storage._Handle):
                    fired = True
                    ready.set()
                    self.assertTrue(delivered.wait(1))
                    time.sleep(.01)
                return original(stack, callback, *args, **kwargs)
            try:
                with self.subTest(signum=signum), patch.object(ExitStack, "callback", at_registration):
                    self.assert_reason("deadline", self.snapshot)
                self.assertEqual(before, live_fds())
                self.assertIs(signal.getsignal(signum), interrupted)
            finally:
                ready.set()
                thread.join(1)
                signal.signal(signum, previous)
            self.assertFalse(thread.is_alive())

    def test_release_defers_interrupt_until_actual_close_and_unwinds_all_handles(self):
        original_close = os.close
        for signum in (signal.SIGALRM, signal.SIGINT, signal.SIGTERM):
            previous = signal.getsignal(signum)
            def interrupted(signum, frame):
                raise storage.StorageError("deadline")
            signal.signal(signum, interrupted)
            fired = False
            before = live_fds()
            def interrupt_close(fd):
                nonlocal fired
                if not fired:
                    fired = True
                    signal.raise_signal(signum)
                return original_close(fd)
            try:
                with self.subTest(signum=signum), patch.object(storage.os, "close", side_effect=interrupt_close):
                    self.assert_reason("deadline", self.snapshot)
                self.assertEqual(before, live_fds())
            finally:
                signal.signal(signum, previous)

    def test_callback_entry_interrupt_cannot_bypass_popped_cleanup(self):
        source = Path(storage.__file__)
        lines = source.read_text().splitlines()
        start = next(i for i, line in enumerate(lines, 1) if line == "    def close(self):")
        target = start + 1
        before = live_fds()
        fired = False
        def trace(frame, event, arg):
            nonlocal fired
            if not fired and event == "line" and frame.f_code.co_filename == str(source) and frame.f_lineno == target:
                fired = True
                signal.raise_signal(signal.SIGALRM)
            return trace
        try:
            sys.settrace(trace)
            self.assert_reason("deadline", self.snapshot)
        finally:
            sys.settrace(None)
        leaked = live_fds() - before
        try:
            self.assertEqual(leaked, set())
        finally:
            for fd in leaked:
                os.close(fd)


class ProjectionTests(unittest.TestCase):
    def snapshot(self, phase, logical=10):
        metric = dict(logical_bytes=logical, allocated_bytes=512, regular_paths=1,
                      unique_files=1, hardlink_aliases=0, directories=1, sockets=0)
        zero = {key: 0 for key in metric}
        groups = {name: dict(zero) for name in storage.GROUP_NAMES}
        groups["scope_other"] = dict(metric)
        return dict(phase=phase, elapsed_seconds=.01, entries=2,
                    totals=metric, groups=groups)

    def complete_workload(self):
        workload = storage.initial_workload()
        for prefix, count in (("submission", 32), ("absence_checks", 16), ("retained_reads", 16)):
            workload[prefix + "_attempted"] = count
            workload[prefix + "_completed"] = count
        return workload

    def test_signed_deltas_recomputed_and_objects_copied(self):
        snapshots = {phase: self.snapshot(phase, logical)
                     for phase, logical in zip(storage.PHASE_NAMES, (10, 20, 5))}
        result = storage.storage_extension(snapshots, self.complete_workload())
        self.assertEqual(result["deltas"]["writes_minus_baseline"]["logical_bytes"], 10)
        self.assertEqual(result["deltas"]["completion_minus_writes"]["logical_bytes"], -15)
        self.assertEqual(result, storage.project_storage(result))
        result["snapshots"]["cold_baseline"]["totals"]["logical_bytes"] = 0
        self.assertEqual(snapshots["cold_baseline"]["totals"]["logical_bytes"], 10)

    def test_schema_rejects_injection_bool_nan_counts_group_sums_and_forged_deltas(self):
        snapshots = {phase: self.snapshot(phase) for phase in storage.PHASE_NAMES}
        complete = storage.storage_extension(snapshots, self.complete_workload())
        mutations = (
            lambda r: r.update(path="/secret"),
            lambda r: r["limits"].update(max_entries=True),
            lambda r: r["limitations"].update(filesystem_allocation_policy="ext4"),
            lambda r: r["workload"].update(submission_completed=31),
            lambda r: r["snapshots"]["cold_baseline"].update(elapsed_seconds=float("nan")),
            lambda r: r["snapshots"]["cold_baseline"]["totals"].update(logical_bytes=True),
            lambda r: r["snapshots"]["cold_baseline"]["totals"].update(hardlink_aliases=1),
            lambda r: r["snapshots"]["cold_baseline"]["groups"]["scope_other"].update(logical_bytes=11),
            lambda r: r["deltas"]["writes_minus_baseline"].update(logical_bytes=123),
        )
        for mutate in mutations:
            bad = copy.deepcopy(complete)
            mutate(bad)
            with self.subTest(value=bad), self.assertRaisesRegex(storage.StorageError, "^schema$"):
                storage.project_storage(bad)

    def test_partial_requires_prefix_and_valid_full_workload(self):
        workload = storage.initial_workload()
        workload["submission_attempted"] = 3
        workload["submission_completed"] = 2
        result = storage.partial_extension({}, workload)
        self.assertEqual(result["snapshots"], {})
        self.assertNotIn("deltas", result)
        self.assertEqual(storage.initial_workload()["submission_attempted"], 0)
        for phases in (("cold_after_writes",), ("cold_baseline", "cold_after_completion")):
            with self.assertRaisesRegex(storage.StorageError, "^schema$"):
                storage.partial_extension({p: self.snapshot(p) for p in phases}, workload)
        workload["submission_completed"] = 4
        with self.assertRaisesRegex(storage.StorageError, "^schema$"):
            storage.partial_extension({}, workload)

    def test_projection_rejects_impossible_partition_and_per_file_capacity(self):
        original = self.snapshot("cold_baseline")
        for mutate in (
            lambda r: r["totals"].update(logical_bytes=536870913),
            lambda r: r.update(elapsed_seconds=10 ** 1000),
            lambda r: r["groups"]["scope_other"].update(sockets=1),
        ):
            bad = copy.deepcopy(original)
            mutate(bad)
            if bad["totals"]["logical_bytes"] == 536870913:
                bad["groups"]["scope_other"]["logical_bytes"] = 536870913
            if bad["groups"]["scope_other"]["sockets"]:
                bad["totals"]["sockets"] = 1
                bad["entries"] += 1
            with self.assertRaisesRegex(storage.StorageError, "^schema$"):
                storage.project_snapshot(bad)


if __name__ == "__main__":
    unittest.main()

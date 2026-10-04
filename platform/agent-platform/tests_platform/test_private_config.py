"""Private Worker configuration uses bounded, descriptor-validated reads."""

import errno
import json
import os
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from agent_platform import private_config
from agent_platform.domain import Problem
from agent_platform.private_config import read_private_text
from agent_platform.tool_worker import read_policy


class PrivatePolicyTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.secret = self.root / "secret"
        self.secret.write_text("synthetic-private-fixture-token")
        self.secret.chmod(0o600)
        self.config = {
            "service_id": str(uuid4()),
            "credential_revision": str(uuid4()),
            "origin": "http://127.0.0.1:12345",
            "credential_origin": "http://127.0.0.1:12345",
            "credential_path_prefix": "/repos/fixture/project",
            "secret_file": str(self.secret),
            "repository_id": 123,
            "owner": "fixture",
            "repository": "project",
            "commit": "a" * 40,
            "paths": ["README.md"],
            "issues": [1],
            "operations": ["github.repository.get"],
            "request_limit": 10,
            "in_flight_limit": 1,
            "total_timeout": 2,
            "idle_timeout": 1,
        }
        self.path = self.root / "config.json"
        self.write_config()

    def write_config(self):
        self.path.write_text(json.dumps(self.config))
        self.path.chmod(0o600)

    def assert_invalid_policy(self, path=None):
        with self.assertRaises(Problem) as caught:
            read_policy(self.path if path is None else path)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(str(caught.exception), "tool_mock_config_invalid")

    def test_hardlinked_secret_is_rejected(self):
        os.link(self.secret, self.root / "other-secret-name")
        self.assert_invalid_policy()

    def test_ancestor_symlink_is_rejected(self):
        real = self.root / "real"
        real.mkdir(mode=0o700)
        moved = real / "secret"
        self.secret.rename(moved)
        alias = self.root / "alias"
        alias.symlink_to(real, target_is_directory=True)
        self.config["secret_file"] = str(alias / "secret")
        self.write_config()
        self.assert_invalid_policy()

    def test_relative_secret_is_rejected(self):
        self.config["secret_file"] = os.path.relpath(self.secret)
        self.write_config()
        self.assert_invalid_policy()

    def test_valid_policy_keeps_existing_whitespace_handling(self):
        self.secret.write_text(" \nsynthetic-private-fixture-token\t\n")
        policy = read_policy(self.path)
        self.assertEqual(policy.secret, "synthetic-private-fixture-token")
        self.assertEqual(policy.repository_path, "/repos/fixture/project")
        self.assertNotIn(policy.secret, repr(policy))

    def test_missing_configuration_has_existing_fixed_code(self):
        for path in (None, ""):
            with self.subTest(path=path), self.assertRaises(Problem) as caught:
                read_policy(path)
            self.assertEqual(caught.exception.status, 409)
            self.assertEqual(str(caught.exception), "tool_mock_config_missing")

    def test_hardlinked_configuration_is_rejected(self):
        os.link(self.path, self.root / "another-config")
        self.assert_invalid_policy()

    def test_relative_configuration_is_rejected(self):
        self.assert_invalid_policy(os.path.relpath(self.path))

    def test_configuration_through_ancestor_symlink_is_rejected(self):
        alias = self.root / "alias"
        alias.symlink_to(self.root, target_is_directory=True)
        self.assert_invalid_policy(alias / self.path.name)

    def test_both_final_symlinks_are_rejected(self):
        for target in (self.path, self.secret):
            with self.subTest(target=target.name):
                retained = target.with_suffix(".retained")
                target.rename(retained)
                target.symlink_to(retained)
                self.assert_invalid_policy()
                target.unlink()
                retained.rename(target)

    def test_config_schema_remains_strict(self):
        valid = json.dumps(self.config)
        for content in (
            "not json",
            "[]",
            valid[:-1] + ', "secret_file": "duplicate"}',
            json.dumps({**self.config, "unexpected": True}),
            json.dumps({**self.config, "secret_file": 123}),
        ):
            with self.subTest(content=content[:15]):
                self.path.write_text(content)
                self.assert_invalid_policy()

    def test_config_and_secret_actual_byte_limits(self):
        self.path.write_text(json.dumps(self.config).ljust(65536))
        self.assertEqual(read_policy(self.path).repository_id, 123)
        self.path.write_text(self.path.read_text() + " ")
        self.assert_invalid_policy()
        self.write_config()
        self.secret.write_text("s" * 4096)
        self.assertEqual(len(read_policy(self.path).secret), 4096)
        self.secret.write_text("s" * 4097)
        self.assert_invalid_policy()

    def test_public_failure_does_not_expose_raw_os_details(self):
        with patch.object(private_config.os, "open", side_effect=OSError("sensitive-path")):
            self.assert_invalid_policy()


class PrivateReaderTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.parent = self.root / "private"
        self.parent.mkdir(mode=0o700)
        self.path = self.parent / "value"
        self.path.write_text("synthetic-fixture")
        self.path.chmod(0o600)

    def read(self, path=None, max_bytes=128):
        return read_private_text(self.path if path is None else path, max_bytes=max_bytes)

    def assert_invalid(self, path=None, max_bytes=128):
        with self.assertRaises(ValueError) as caught:
            self.read(path, max_bytes)
        self.assertEqual(str(caught.exception), "private_config_invalid")

    def test_owner_readable_private_files_and_directories(self):
        for parent_mode in (0o700, 0o500):
            for file_mode in (0o600, 0o400):
                with self.subTest(parent_mode=parent_mode, file_mode=file_mode):
                    self.parent.chmod(parent_mode)
                    self.path.chmod(file_mode)
                    self.assertEqual(self.read(), "synthetic-fixture")
        self.parent.chmod(0o700)

    def test_lexical_paths_are_not_normalized(self):
        for path in (
            "relative",
            "",
            str(self.parent) + "/./value",
            str(self.parent) + "/../private/value",
            str(self.parent) + "//value",
            str(self.path) + "/",
            "/" + str(self.path),
            str(self.path) + "\0",
        ):
            with self.subTest(path=path):
                self.assert_invalid(path)

    def test_missing_file_is_fixed_error(self):
        self.assert_invalid(self.parent / "absent")

    def test_file_modes_reject_public_executable_and_special_bits(self):
        for mode in (0o000, 0o100, 0o700, 0o640, 0o604, 0o4600, 0o2600, 0o1600):
            with self.subTest(mode=oct(mode)):
                self.path.chmod(mode)
                self.assert_invalid()
        self.path.chmod(0o600)

    def test_immediate_parent_requires_private_searchable_directory(self):
        for mode in (0o755, 0o750, 0o711, 0o600, 0o1777):
            with self.subTest(mode=oct(mode)):
                self.parent.chmod(mode)
                self.assert_invalid()
        self.parent.chmod(0o700)

    def test_nonprivate_readonly_ancestor_is_allowed_but_writable_is_denied(self):
        self.root.chmod(0o755)
        self.assertEqual(self.read(), "synthetic-fixture")
        for mode in (0o775, 0o757):
            with self.subTest(mode=oct(mode)):
                self.root.chmod(mode)
                self.assert_invalid()
        self.root.chmod(0o700)

    def test_nonroot_sticky_ancestor_is_denied(self):
        self.root.chmod(0o1777)
        original = os.fstat
        inode = self.root.stat().st_ino

        def nonroot_owner(fd):
            result = original(fd)
            if result.st_ino == inode:
                return altered_stat(result, st_uid=max(1, os.geteuid()))
            return result

        with patch.object(private_config.os, "fstat", side_effect=nonroot_owner):
            self.assert_invalid()
        self.root.chmod(0o700)

    def test_root_sticky_ancestor_is_allowed(self):
        self.root.chmod(0o1777)
        original = os.fstat
        inode = self.root.stat().st_ino

        def root_owner(fd):
            result = original(fd)
            return altered_stat(result, st_uid=0) if result.st_ino == inode else result

        with patch.object(private_config.os, "fstat", side_effect=root_owner):
            self.assertEqual(self.read(), "synthetic-fixture")
        self.root.chmod(0o700)

    def test_wrong_owner_on_file_parent_or_ancestor_is_denied(self):
        original = os.fstat
        for target in (self.path, self.parent, self.root):
            inode = target.stat().st_ino

            def alien_owner(fd, inode=inode):
                result = original(fd)
                if result.st_ino == inode:
                    return altered_stat(result, st_uid=os.geteuid() + 1000)
                return result

            with self.subTest(target=target.name):
                with patch.object(private_config.os, "fstat", side_effect=alien_owner):
                    self.assert_invalid()

    def test_hardlinks_are_denied(self):
        os.link(self.path, self.parent / "hardlink")
        self.assert_invalid()

    def test_nonregular_directory_is_denied(self):
        self.assert_invalid(self.parent)

    def test_fifo_is_opened_without_blocking_then_denied(self):
        fifo = self.parent / "fifo"
        os.mkfifo(fifo, 0o600)
        original = os.open
        observed = []

        def nonblocking_open(path, flags, *args, **kwargs):
            if os.fspath(path) == "fifo":
                observed.append(bool(flags & os.O_NONBLOCK))
                if not flags & os.O_NONBLOCK:
                    raise AssertionError("FIFO open would block")
            return original(path, flags, *args, **kwargs)

        with patch.object(private_config.os, "open", side_effect=nonblocking_open):
            self.assert_invalid(fifo)
        self.assertTrue(observed)
        self.assertTrue(all(observed))

    def test_valid_utf8_and_byte_limit(self):
        self.path.write_bytes("é".encode())
        self.assertEqual(self.read(max_bytes=2), "é")
        self.assert_invalid(max_bytes=1)
        self.path.write_bytes(b"\xff")
        self.assert_invalid()

    def test_acl_on_file_or_ancestor_is_denied(self):
        original = os.fstat
        for target in (self.path, self.parent, self.root):
            for acl in ("system.posix_acl_access", "system.posix_acl_default"):
                inode = target.stat().st_ino

                def list_acl(fd, inode=inode, acl=acl):
                    self.assertIsInstance(fd, int)
                    return [acl] if original(fd).st_ino == inode else []

                with self.subTest(target=target.name, acl=acl):
                    with patch.object(private_config.os, "listxattr", side_effect=list_acl):
                        self.assert_invalid()

    def test_unrelated_xattrs_do_not_grant_or_remove_access(self):
        with patch.object(private_config.os, "listxattr", return_value=["user.description"]):
            self.assertEqual(self.read(), "synthetic-fixture")

    def test_xattr_unavailable_is_distinct_from_inspection_failure(self):
        for error in (errno.ENOTSUP, errno.EOPNOTSUPP):
            with self.subTest(error=error):
                with patch.object(private_config.os, "listxattr", side_effect=OSError(error, "x")):
                    self.assertEqual(self.read(), "synthetic-fixture")
        for error in (errno.EACCES, errno.EIO, errno.EBADF):
            with self.subTest(error=error):
                with patch.object(private_config.os, "listxattr", side_effect=OSError(error, "x")):
                    self.assert_invalid()

    def test_bounded_actual_read_does_not_trust_small_stat_size(self):
        self.path.write_bytes(b"x" * 129)
        original = os.fstat
        inode = self.path.stat().st_ino

        def small_size(fd):
            result = original(fd)
            return altered_stat(result, st_size=1) if result.st_ino == inode else result

        with patch.object(private_config.os, "fstat", side_effect=small_size):
            self.assert_invalid(max_bytes=128)

    def test_changed_file_mode_during_read_is_denied(self):
        original = os.read
        changed = False

        def mutate_mode(fd, length):
            nonlocal changed
            if not changed:
                changed = True
                os.fchmod(fd, 0o644)
            return original(fd, length)

        with patch.object(private_config.os, "read", side_effect=mutate_mode):
            self.assert_invalid()
        self.assertTrue(changed)

    def test_changed_content_same_size_during_read_is_denied(self):
        original = os.read
        changed = False

        def mutate_content(fd, length):
            nonlocal changed
            if not changed:
                changed = True
                before = self.path.stat()
                self.path.write_text("x" * before.st_size)
                # Ensure a changed timestamp even on coarse-resolution filesystems.
                os.utime(self.path, ns=(before.st_atime_ns, before.st_mtime_ns - 1_000_000_000))
            return original(fd, length)

        with patch.object(private_config.os, "read", side_effect=mutate_content):
            self.assert_invalid()
        self.assertTrue(changed)

    def test_metadata_changes_during_read_are_denied(self):
        original_stat = os.fstat
        original_read = os.read
        inode = self.path.stat().st_ino
        for field in ("st_uid", "st_gid", "st_nlink", "st_size", "st_mtime_ns", "st_ctime_ns"):
            state = {"has_read": False}

            def observe_read(fd, length, state=state):
                data = original_read(fd, length)
                state["has_read"] = True
                return data

            def changed_stat(fd, field=field, state=state):
                result = original_stat(fd)
                if state["has_read"] and result.st_ino == inode:
                    return altered_stat(result, **{field: getattr(result, field) + 1})
                return result

            with self.subTest(field=field):
                with (
                    patch.object(private_config.os, "fstat", side_effect=changed_stat),
                    patch.object(private_config.os, "read", side_effect=observe_read),
                ):
                    self.assert_invalid()

    def test_replaced_path_never_supplies_replacement_content(self):
        original = os.read
        changed = False

        def replace_path(fd, length):
            nonlocal changed
            if not changed:
                changed = True
                self.path.rename(self.parent / "retained")
                self.path.write_text("replacement-value")
                self.path.chmod(0o600)
            return original(fd, length)

        with patch.object(private_config.os, "read", side_effect=replace_path):
            try:
                content = self.read()
            except ValueError as exc:
                self.assertEqual(str(exc), "private_config_invalid")
            else:
                self.assertEqual(content, "synthetic-fixture")
        self.assertTrue(changed)

    def test_descriptors_close_after_success_and_failures(self):
        before = set(os.listdir("/proc/self/fd"))
        for _ in range(10):
            self.assertEqual(self.read(), "synthetic-fixture")
            self.assert_invalid(self.parent / "absent")
            with patch.object(private_config.os, "read", side_effect=OSError(errno.EIO, "x")):
                self.assert_invalid()
            with patch.object(private_config.os, "listxattr", side_effect=OSError(errno.EIO, "x")):
                self.assert_invalid()
        self.assertEqual(set(os.listdir("/proc/self/fd")), before)


def altered_stat(result, **changes):
    values = {name: getattr(result, name) for name in dir(result) if name.startswith("st_")}
    return SimpleNamespace(**(values | changes))

import hashlib
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from agent_platform.domain import Problem
from agent_platform.export_patch import patch_paths, prepare_patch


def blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()


def tree_file(path, data, mode="100644"):
    return {"path": path, "mode": mode, "type": "blob", "sha": blob_sha(data)}


ADD = (
    "diff --git a/new.txt b/new.txt\nnew file mode 100644\n"
    "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+héllo\n+world\n"
)
MODIFY = (
    "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,2 +1,2 @@\n one\n-two\n+three\n"
)
DELETE = (
    "diff --git a/a.txt b/a.txt\ndeleted file mode 100644\n"
    "--- a/a.txt\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n"
)


class ExportPatchTests(unittest.TestCase):
    def assert_problem(self, code, fn, *args):
        with self.assertRaises(Problem) as result:
            fn(*args)
        self.assertEqual((result.exception.status, result.exception.code), (409, code))

    def apply(self, diff, files):
        blobs = {blob_sha(data): data for data in files.values()}
        return prepare_patch(diff, [tree_file(p, d) for p, d in files.items()], blobs.__getitem__)

    def test_add_modify_delete_and_mode(self):
        self.assertEqual(patch_paths(ADD + MODIFY), ["new.txt", "a.txt"])
        self.assertEqual(
            self.apply(ADD, {}),
            [{"path": "new.txt", "mode": "100644", "type": "blob", "content": "héllo\nworld\n"}],
        )
        self.assertEqual(self.apply(MODIFY, {"a.txt": b"one\ntwo\n"})[0]["content"], "one\nthree\n")
        self.assertEqual(self.apply(DELETE, {"a.txt": b"one\ntwo\n"})[0]["sha"], None)
        result = prepare_patch(
            MODIFY, [tree_file("a.txt", b"one\ntwo\n", "100755")], lambda _: b"one\ntwo\n"
        )
        self.assertEqual(result[0]["mode"], "100755")

    def test_newline_exactness(self):
        diff = (
            "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n"
            "\\ No newline at end of file\n+新\n\\ No newline at end of file\n"
        )
        self.assertEqual(self.apply(diff, {"a.txt": b"old"})[0]["content"], "新")
        self.assert_problem("export_patch_conflict", self.apply, diff, {"a.txt": b"old\n"})
        crlf = MODIFY.replace(" one\n-two\n+three\n", " one\r\n-two\r\n+three\r\n")
        self.assertEqual(
            self.apply(crlf, {"a.txt": b"one\r\ntwo\r\n"})[0]["content"], "one\r\nthree\r\n"
        )

    def test_unrelated_unicode_and_space_paths_are_preserved(self):
        files = {"a.txt": b"one\ntwo\n", "文檔/read me.txt": "untouched 原樣\n".encode()}
        entries = self.apply(MODIFY, files)
        self.assertEqual([item["path"] for item in entries], ["a.txt"])
        self.assertEqual(entries[0]["content"], "one\nthree\n")

    def test_context_hash_and_existence_conflicts(self):
        for diff, files in [
            (MODIFY, {}),
            (ADD, {"new.txt": b"existing"}),
            (MODIFY, {"a.txt": b"one\nwrong\n"}),
        ]:
            self.assert_problem("export_patch_conflict", self.apply, diff, files)
        self.assert_problem(
            "export_patch_invalid",
            prepare_patch,
            MODIFY,
            [tree_file("a.txt", b"one\ntwo\n")],
            lambda _: b"corrupt",
        )

    def test_rejects_paths_formats_and_hunk_ambiguity(self):
        for path in [
            "../evil",
            ".git/config",
            ".GITHUB/workflows/a",
            ".gitmodules",
            ".gitattributes",
            "a/../b",
            "a//b",
            "a\\b",
            "/absolute",
        ]:
            with self.subTest(path=path):
                self.assert_problem(
                    "export_patch_unsupported", patch_paths, ADD.replace("new.txt", path)
                )
        for diff in [
            ADD + ADD,
            ADD + ADD.replace("new.txt", "new.txt/child"),
            MODIFY.replace("+1,2", "+2,2"),
            MODIFY.replace("-1,2", "-1,3"),
            MODIFY + "surplus\n",
            MODIFY.replace("+three\n", "+three\n\\ No newline at end of file\n+four\n"),
        ]:
            with self.subTest(diff=diff):
                with self.assertRaises(Problem):
                    patch_paths(diff)
        for text in ["GIT binary patch\n", "rename from a\n", "old mode 100644\nnew mode 100755\n"]:
            self.assert_problem(
                "export_patch_unsupported", patch_paths, "diff --git a/a.txt b/a.txt\n" + text
            )

    def test_rejects_remote_tree_symlink_and_overlap(self):
        source = b"one\ntwo\n"
        for tree in [
            [tree_file("a.txt", source, "120000")],
            [tree_file("a.txt", source)] * 2,
            [{"path": "a.txt", "mode": "100644", "type": "blob", "sha": "invalid"}],
        ]:
            with self.assertRaises(Problem):
                prepare_patch(MODIFY, tree, lambda _: source)
        tree = [tree_file("dir", b"target", "120000")]
        with self.assertRaises(Problem):
            prepare_patch(ADD.replace("new.txt", "dir/new.txt"), tree, lambda _: b"target")

    def test_untrusted_hunk_numbers_and_tree_types_raise_bounded_problem(self):
        for number in ["9" * 5000, "٩", "-1"]:
            with self.subTest(number=number[:20]), self.assertRaises(Problem):
                patch_paths(MODIFY.replace("-1,2", "-" + number + ",2"))
        for key, value in [("mode", []), ("type", {}), ("sha", []), ("path", 42)]:
            entry = tree_file("a.txt", b"one\ntwo\n")
            entry[key] = value
            with self.subTest(key=key), self.assertRaises(Problem):
                prepare_patch(MODIFY, [entry], lambda _: b"one\ntwo\n")

    def test_empty_binary_invalid_utf8_and_bounds(self):
        for diff in [
            "",
            ADD.replace("héllo", "\0"),
            ADD.replace("héllo", "\ud800"),
            ADD + " " * (256 * 1024),
        ]:
            with self.assertRaises(Problem):
                patch_paths(diff)
        many = "".join(ADD.replace("new.txt", f"file{i}") for i in range(33))
        with self.assertRaises(Problem):
            patch_paths(many)
        self.assert_problem("export_patch_unsupported", self.apply, MODIFY, {"a.txt": b"\xff"})

    def test_actual_git_diff_utf8_crlf_multiple_hunks_and_no_final_newline(self):
        old = {
            "modify.txt": b"".join(f"line{i}\n".encode() for i in range(30)),
            "delete.txt": b"last line with no LF",
            "crlf.txt": "".join(f"行{i}\r\n" for i in range(30)).encode(),
            "to-lf.txt": b"no LF",
            "from-lf.txt": b"with LF\n",
            "no-lf.txt": b"original",
        }
        new = {
            "modify.txt": old["modify.txt"]
            .replace(b"line1\n", b"changed1\n")
            .replace(b"line28\n", b"changed28\n"),
            "crlf.txt": old["crlf.txt"]
            .replace("行1\r\n".encode(), "新1\r\n".encode())
            .replace("行28\r\n".encode(), "新28\r\n".encode()),
            "to-lf.txt": b"no LF\n",
            "from-lf.txt": b"with LF",
            "no-lf.txt": "完成".encode(),
            "added.txt": "追加\r\nwithout final LF".encode(),
        }
        with tempfile.TemporaryDirectory() as directory:
            env = {
                **os.environ,
                "GIT_CONFIG_NOSYSTEM": "1",
                "GIT_CONFIG_GLOBAL": os.devnull,
                "GIT_ATTR_NOSYSTEM": "1",
            }

            def git(*args):
                return subprocess.run(
                    ["git", "-c", "core.autocrlf=false", *args],
                    cwd=directory,
                    env=env,
                    check=True,
                    capture_output=True,
                ).stdout

            git("init", "--template=", "--quiet")
            for name, raw in old.items():
                Path(directory, name).write_bytes(raw)
            git("add", ".")
            for name in old.keys() - new.keys():
                Path(directory, name).unlink()
            for name, raw in new.items():
                Path(directory, name).write_bytes(raw)
            git("add", "-N", "added.txt")
            diff = git("diff", "--no-ext-diff", "--no-textconv", "--unified=2").decode()
        self.assertGreater(diff.count("@@"), 8)
        self.assertEqual(set(patch_paths(diff)), old.keys() | new.keys())
        applied = self.apply(diff, old)
        result = dict(old)
        for entry in applied:
            if entry.get("sha", "present") is None:
                del result[entry["path"]]
            else:
                result[entry["path"]] = entry["content"].encode()
        self.assertEqual(result, new)

    def test_index_hash_and_mode_contradictions(self):
        old, new = b"one\ntwo\n", b"one\nthree\n"
        indexed = MODIFY.replace("--- a/", f"index {blob_sha(old)}..{blob_sha(new)} 100644\n--- a/")
        self.assertEqual(self.apply(indexed, {"a.txt": old})[0]["content"].encode(), new)
        for diff in [
            indexed.replace(blob_sha(old), "f" * 40),
            indexed.replace(blob_sha(new), "f" * 40),
            indexed.replace(" 100644\n", " 100755\n"),
        ]:
            self.assert_problem("export_patch_conflict", self.apply, diff, {"a.txt": old})
        for diff in [
            indexed.replace(blob_sha(old), "0" * 40),
            ADD.replace("--- ", "index 1234567..abcdef0\n--- ", 1),
            ADD.replace("100644", "120000"),
        ]:
            with self.assertRaises(Problem):
                patch_paths(diff)

    def test_source_output_combined_and_tree_bounds(self):
        diff = "diff --git a/a b/a\n--- a/a\n+++ b/a\n@@ -1 +1 @@\n-a\n+aa\n"
        source = b"a\n" * (1024 * 512)
        self.assert_problem("export_patch_unsupported", self.apply, diff, {"a": source})
        source = b"a\n" * (256 * 1024)
        combined = "".join(
            diff.replace("a/a", f"a/p{i}").replace("b/a", f"b/p{i}") for i in range(5)
        )
        self.assert_problem(
            "export_patch_unsupported", self.apply, combined, {f"p{i}": source for i in range(5)}
        )
        entry = tree_file("a", b"a\n")
        entry["unused"] = "x" * (8 * 1024 * 1024)
        self.assert_problem(
            "export_patch_unsupported", prepare_patch, diff, [entry], lambda _: b"a\n"
        )

    def test_exact_no_newline_marker_placement(self):
        for diff in [
            MODIFY + "\\ No newline at end of file\n\\ No newline at end of file\n",
            MODIFY.replace(" one\n", " one\n\\ No newline at end of file\n"),
            MODIFY.replace("+three\n", "+three\n\\ No newline at end of file \n"),
            MODIFY[:-1],
        ]:
            with self.assertRaises(Problem):
                patch_paths(diff)


if __name__ == "__main__":
    unittest.main()

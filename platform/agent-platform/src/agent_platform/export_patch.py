"""Apply a deliberately small, bounded unified-diff grammar as data only."""

import hashlib
import json
import re
from dataclasses import dataclass

from .domain import Problem

PATCH_LIMIT = 256 * 1024
FILE_LIMIT = 1024 * 1024
TOTAL_LIMIT = 4 * 1024 * 1024
TREE_LIMIT = 8 * 1024 * 1024
_HUNK = re.compile(
    r"@@ -([0-9]{1,7})(?:,([0-9]{1,7}))? \+([0-9]{1,7})(?:,([0-9]{1,7}))? @@(?: [^\r\n]*)?\n"
)
_SHA = re.compile(r"[a-f0-9]{40}")
_MODES = {"100644", "100755"}
_MARKER = "\\ No newline at end of file\n"


def _fail(kind="invalid"):
    raise Problem(409, "export_patch_" + kind)


def _path(value, *, protected=True):
    if type(value) is not str or len(value) > 4096:
        _fail("unsupported")
    try:
        valid_size = len(value.encode("utf-8")) <= 4096 and all(
            len(part.encode("utf-8")) <= 255 for part in value.split("/")
        )
    except UnicodeError:
        _fail()
    if (
        not valid_size
        or any(part in ("", ".", "..") for part in value.split("/"))
        or any(ord(char) < 32 or ord(char) == 127 for char in value)
        or "\\" in value
    ):
        _fail("unsupported")
    if protected and (
        re.fullmatch(r"[A-Za-z0-9._/-]+", value) is None
        or any(
            part.casefold() in {".git", ".github", ".gitmodules", ".gitattributes"}
            for part in value.split("/")
        )
    ):
        _fail("unsupported")
    return value


@dataclass
class FilePatch:
    path: str
    operation: str
    mode: str | None
    hashes: tuple | None
    hunks: list


def _position(start, count):
    if count and not start:
        _fail()
    return start - 1 if count else start


def _parse(diff):
    if type(diff) is not str or not diff or len(diff) > PATCH_LIMIT:
        _fail()
    try:
        if len(diff.encode("utf-8")) > PATCH_LIMIT:
            _fail()
    except UnicodeError:
        _fail()
    if "\0" in diff:
        _fail("unsupported")
    # Only LF is a diff separator. CR remains part of an exact file line.
    lines = [line + "\n" for line in diff.split("\n")[:-1]]
    if not diff.endswith("\n"):
        _fail()
    patches, seen, index = [], set(), 0
    while index < len(lines):
        header = re.fullmatch(r"diff --git a/(\S+) b/(\S+)\n", lines[index])
        if not header or header[1] != header[2]:
            _fail("unsupported")
        path = _path(header[1])
        if path in seen or any(path.startswith(p + "/") or p.startswith(path + "/") for p in seen):
            _fail("unsupported")
        seen.add(path)
        if len(seen) > 32:
            _fail("unsupported")
        index += 1
        mode, operation, hashes = None, "modify", None
        if index < len(lines):
            match = re.fullmatch(r"(new|deleted) file mode (100644|100755)\n", lines[index])
            if match:
                operation = "add" if match[1] == "new" else "delete"
                mode = match[2]
                index += 1
        if index < len(lines) and lines[index].startswith("index "):
            match = re.fullmatch(
                r"index ([a-f0-9]{7,40})\.\.([a-f0-9]{7,40})(?: (100644|100755))?\n", lines[index]
            )
            if not match:
                _fail("unsupported")
            hashes = (match[1], match[2])
            if match[3]:
                if mode and mode != match[3]:
                    _fail("unsupported")
                mode = match[3]
            index += 1
        if index + 1 >= len(lines) or not lines[index].startswith("--- "):
            _fail("unsupported")
        old, new = lines[index][4:-1], lines[index + 1][4:-1]
        if not lines[index + 1].startswith("+++ "):
            _fail()
        if old == "/dev/null" and new == "b/" + path:
            if operation == "delete":
                _fail()
            operation = "add"
        elif old == "a/" + path and new == "/dev/null":
            if operation == "add":
                _fail()
            operation = "delete"
        elif old != "a/" + path or new != "b/" + path or operation != "modify":
            _fail("unsupported")
        if hashes:
            for pos, is_zero in ((0, operation == "add"), (1, operation == "delete")):
                if (set(hashes[pos]) == {"0"}) != is_zero:
                    _fail()
        index += 2
        hunks, delta, last_old, last_new = [], 0, -1, -1
        old_end = new_end = 0
        ended = {"old": False, "new": False}
        changes = 0
        while index < len(lines) and not lines[index].startswith("diff --git "):
            match = _HUNK.fullmatch(lines[index])
            if not match:
                _fail()
            numbers = [int(value) if value is not None else 1 for value in match.groups()]
            if any(value > FILE_LIMIT for value in numbers):
                _fail("unsupported")
            old_start, old_count, new_start, new_count = numbers
            old_pos, new_pos = _position(old_start, old_count), _position(new_start, new_count)
            if (
                old_pos <= last_old
                or new_pos <= last_new
                or old_pos < old_end
                or new_pos < new_end
                or new_pos != old_pos + delta
                or not old_count + new_count
                or (operation == "add" and (old_start or old_count))
                or (operation == "delete" and (new_start or new_count))
            ):
                _fail()
            index += 1
            records, old_used, new_used = [], 0, 0
            while index < len(lines) and lines[index][:1] in {" ", "+", "-"}:
                line = lines[index]
                kind, content = line[0], line[1:]
                sides = ("old", "new") if kind == " " else (("old",) if kind == "-" else ("new",))
                if any(ended[side] for side in sides):
                    _fail()
                index += 1
                if index < len(lines) and lines[index] == _MARKER:
                    content = content[:-1]
                    for side in sides:
                        ended[side] = True
                    index += 1
                records.append((kind, content))
                old_used += kind != "+"
                new_used += kind != "-"
                changes += kind != " "
                if old_used > old_count or new_used > new_count:
                    _fail()
            if (old_used, new_used) != (old_count, new_count):
                _fail()
            hunks.append((old_pos, records))
            last_old, last_new = old_pos, new_pos
            old_end, new_end = old_pos + old_count, new_pos + new_count
            delta += new_count - old_count
        if not hunks or not changes:
            _fail("unsupported")
        patches.append(FilePatch(path, operation, mode, hashes, hunks))
    return patches


def patch_paths(diff: str) -> list[str]:
    """Validate the entire supported grammar before performing remote reads."""
    return [patch.path for patch in _parse(diff)]


def _blob_sha(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()


def _text(data):
    if type(data) is not bytes or len(data) > FILE_LIMIT:
        _fail("unsupported")
    try:
        text = data.decode("utf-8")
    except UnicodeError:
        _fail("unsupported")
    if "\0" in text:
        _fail("unsupported")
    return text


def _tree_index(tree):
    if type(tree) is not list or len(tree) > 100000:
        _fail()
    try:
        if len(json.dumps(tree, ensure_ascii=True).encode()) > TREE_LIMIT:
            _fail("unsupported")
    except (TypeError, ValueError, RecursionError):
        _fail()
    result = {}
    for entry in tree:
        if type(entry) is not dict:
            _fail()
        path = entry.get("path")
        _path(path, protected=False)
        if path in result:
            _fail()
        mode = entry.get("mode")
        kind = entry.get("type")
        sha = entry.get("sha")
        if (
            not isinstance(sha, str)
            or not _SHA.fullmatch(sha)
            or type(mode) is not str
            or type(kind) is not str
            or (mode, kind)
            not in {
                ("100644", "blob"),
                ("100755", "blob"),
                ("120000", "blob"),
                ("040000", "tree"),
                ("160000", "commit"),
            }
        ):
            _fail()
        if "size" in entry and (type(entry["size"]) is not int or entry["size"] < 0):
            _fail()
        result[path] = entry
    for path in result:
        parts = path.split("/")
        for stop in range(1, len(parts)):
            ancestor = result.get("/".join(parts[:stop]))
            if ancestor and ancestor["type"] != "tree":
                _fail()
    return result


def prepare_patch(diff: str, tree: list[dict], read_blob) -> list[dict]:
    """Return GitHub tree entries after exact source identity and hunk validation."""
    patches, entries = _parse(diff), _tree_index(tree)
    prepared, total = [], 0
    for patch in patches:
        existing = entries.get(patch.path)
        if patch.operation == "add":
            if existing or any(path.startswith(patch.path + "/") for path in entries):
                _fail("conflict")
            source, mode = b"", patch.mode or "100644"
        else:
            if not existing:
                _fail("conflict")
            if existing["type"] != "blob" or existing["mode"] not in _MODES:
                _fail("unsupported")
            if patch.mode and patch.mode != existing["mode"]:
                _fail("conflict")
            if existing.get("size", 0) > FILE_LIMIT:
                _fail("unsupported")
            source, mode = read_blob(existing["sha"]), existing["mode"]
        for stop in range(1, len(patch.path.split("/"))):
            ancestor = entries.get("/".join(patch.path.split("/")[:stop]))
            if ancestor and ancestor["type"] != "tree":
                _fail("unsupported")
        text = _text(source)
        if existing and _blob_sha(source) != existing["sha"]:
            _fail()
        if (
            patch.hashes
            and patch.operation != "add"
            and not _blob_sha(source).startswith(patch.hashes[0])
        ):
            _fail("conflict")
        lines = [line + "\n" for line in text.split("\n")[:-1]]
        if not text.endswith("\n") and text:
            lines.append(text.split("\n")[-1])
        output, cursor = [], 0
        for old_pos, records in patch.hunks:
            if old_pos > len(lines):
                _fail("conflict")
            output.extend(lines[cursor:old_pos])
            cursor = old_pos
            for kind, content in records:
                if kind != "+":
                    if cursor >= len(lines) or lines[cursor] != content:
                        _fail("conflict")
                    cursor += 1
                if kind != "-":
                    output.append(content)
        output.extend(lines[cursor:])
        if any(not line.endswith("\n") for line in output[:-1]):
            _fail("conflict")
        content = "".join(output)
        raw = content.encode("utf-8")
        total += len(source) + len(raw)
        if len(raw) > FILE_LIMIT or total > TOTAL_LIMIT:
            _fail("unsupported")
        if patch.operation == "delete" and raw:
            _fail("conflict")
        if (
            patch.hashes
            and patch.operation != "delete"
            and not _blob_sha(raw).startswith(patch.hashes[1])
        ):
            _fail("conflict")
        item = {"path": patch.path, "mode": mode, "type": "blob"}
        item.update({"sha": None} if patch.operation == "delete" else {"content": content})
        prepared.append(item)
    return prepared

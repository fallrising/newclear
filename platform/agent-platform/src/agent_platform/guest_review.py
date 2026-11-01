"""Root-owned candidate capability: exact file read only, no execution entry point."""

import hashlib
import importlib.util
import json
import os
import stat
import sys
from pathlib import Path

ROOT = Path("/var/lib/agent-platform/review")
LIMIT = 32768


def candidate(expected):
    parent = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        info = os.fstat(parent)
        if info.st_uid != 0 or info.st_gid != 0 or stat.S_IMODE(info.st_mode) != 0o555:
            raise ValueError("review_directory_changed")
        fd = os.open("candidate.json", os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        try:
            info = os.fstat(fd)
            if (
                not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1
                or info.st_uid != 0
                or info.st_gid != 0
                or stat.S_IMODE(info.st_mode) != 0o444
                or not 0 < info.st_size <= LIMIT
            ):
                raise ValueError("review_candidate_changed")
            with os.fdopen(os.dup(fd), "rb") as stream:
                payload = stream.read(LIMIT + 1)
            if len(payload) != info.st_size or hashlib.sha256(payload).hexdigest() != expected:
                raise ValueError("review_candidate_changed")
            return payload.decode("utf-8")
        finally:
            os.close(fd)
    finally:
        os.close(parent)


def operation(request):
    action = request.get("action")
    if action not in {"read", "verify"} or (
        action == "read" and request.get("path") != "candidate.json"
    ):
        raise ValueError("review_tool_denied")
    allowed = {"action", "candidate_sha256", "path", "timeout_seconds", "content", "argv"}
    if (
        set(request) - allowed
        or request.get("content") is not None
        or request.get("argv") is not None
    ):
        raise ValueError("review_tool_denied")
    value = candidate(request["candidate_sha256"])
    return (
        {"ok": True, "content": value}
        if action == "read"
        else {"candidate_sha256": request["candidate_sha256"]}
    )


def main():
    request = json.loads(sys.argv[1])
    # Load only an attested root-owned sibling; isolated Python never imports candidate code.
    spec = importlib.util.spec_from_file_location(
        "external_helper", "/opt/agent-platform/guest_external.py"
    )
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    helper.drop_privileges()
    print(json.dumps(operation(request), ensure_ascii=False))


if __name__ == "__main__":
    main()

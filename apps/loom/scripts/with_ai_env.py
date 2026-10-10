#!/usr/bin/env python3
"""Launch a command with an explicitly selected private OpenCode key file.

Linux/macOS development helper; no shell evaluation or automatic key discovery.
Format: OPENCODE_API_KEY='value' in an owner-only regular file (mode 600).
"""
import argparse
import os
from pathlib import Path
import stat
import sys


def read_env(path):
    try:
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise ValueError("Cannot open private environment file; use a regular file, not a symlink.") from None
    with os.fdopen(fd, "rb") as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o600:
            raise ValueError("Private environment file must be owned by the current user and have mode 600.")
        data = stream.read(16385)
    if len(data) > 16384:
        raise ValueError("Private environment file is too large.")
    try:
        source = data.decode("utf-8")
    except UnicodeDecodeError:
        raise ValueError("Private environment file must be UTF-8 text.") from None
    result = {}
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        name, separator, value = line.partition("=")
        name, value = name.strip(), value.strip()
        if separator != "=" or name != "OPENCODE_API_KEY" or name in result:
            raise ValueError("Expected one OPENCODE_API_KEY assignment without export or shell commands.")
        if value.startswith(("'", '"')):
            if len(value) < 2 or value[-1] != value[0]:
                raise ValueError("Invalid quoted value in private environment file.")
            value = value[1:-1]
        if not value or any(char.isspace() or ord(char) < 32 or char in "'\"" for char in value):
            raise ValueError("API key must be nonempty without whitespace or embedded quotes.")
        result[name] = value
    if "OPENCODE_API_KEY" not in result:
        raise ValueError("Private environment file does not define OPENCODE_API_KEY.")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("provide a command after --")
    try:
        values = read_env(args.env_file)
        os.execvpe(command[0], command, {**os.environ, **values})
    except ValueError as error:
        print(f"Environment setup failed: {error}", file=sys.stderr)
        return 2
    except OSError:
        print("Could not launch the selected command.", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())

"""Create a new private Signal Hub state directory; never modify an existing one."""
import argparse
import json
import os
import re
import secrets
import sys


def initialize(state_dir, port):
    uid, gid = os.getuid(), os.getgid()
    if uid == 0 or os.geteuid() == 0 or gid == 0:
        raise ValueError("run as a non-root user with a non-root primary group")
    if type(port) is not int or not 1024 <= port <= 65535:
        raise ValueError("port must be an integer from 1024 through 65535")
    if not re.fullmatch(r"/[A-Za-z0-9_./-]+", state_dir) or os.path.normpath(state_dir) != state_dir or any(part in (".", "..", "") for part in state_dir.split("/")[1:]):
        raise ValueError("state path must be absolute and normalized, using only letters, digits, /, _, . and -")
    # Walk open directory descriptors, refusing symlinks even in ancestors. The
    # parent must already exist. Relative creation stays anchored to these fds.
    parent = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    created = None
    try:
        for part in state_dir.split("/")[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent)
            parent = child
        name = state_dir.rsplit("/", 1)[1]
        os.mkdir(name, mode=0o700, dir_fd=parent)
        created = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        os.fchmod(created, 0o700)
        for directory in ("config", "secrets", "data", "backups"):
            os.mkdir(directory, mode=0o700, dir_fd=created)
            child = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=created)
            os.fchmod(child, 0o700)
            os.close(child)

        def write(relative, value):
            fd = os.open(relative, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=created)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                os.fchmod(output.fileno(), 0o600)
                output.write(value)

        tokens = set()
        for role in ("owner", "readonly", "source"):
            token = secrets.token_urlsafe(32)
            while token in tokens:
                token = secrets.token_urlsafe(32)
            tokens.add(token)
            write("secrets/" + role + ".token", token + "\n")
        config = {"sources": [{"name": "demo", "source_prefix": "urn:example:demo:", "allowed_types": ["demo.event.*"], "retention_days": 90, "token_ref": "file:/run/secrets/source.token"}], "rules": [], "subscriptions": [], "webhook_allowlist": []}
        write("config/config.json", json.dumps(config, indent=2) + "\n")
        write("compose.env", f"SIGNALHUB_UID={uid}\nSIGNALHUB_GID={gid}\nSIGNALHUB_STATE_DIR={state_dir}\nSIGNALHUB_PORT={port}\n")
    except OSError as error:
        # Never recursively remove a partial state directory: it may contain
        # credentials. A new pathname is required after inspecting a failure.
        raise ValueError("state creation refused: path exists, parent is unavailable/symlinked, or storage failed; any partial directory is preserved") from error
    finally:
        if created is not None:
            os.close(created)
        os.close(parent)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", required=True, help="new absolute private path; its parent must exist")
    parser.add_argument("--port", type=int, default=8080)
    args = parser.parse_args()
    try:
        initialize(args.state_dir, args.port)
    except ValueError as error:
        parser.exit(1, "signalhub init: " + str(error) + "\n")
    print("Created private state, config and role credential files. Use its compose.env with deployment/docker/compose.yaml.")


if __name__ == "__main__":
    main()

"""Local administration of the experimental control-side model proxy slice."""

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit
from uuid import UUID

import psycopg
import uvicorn

from .db import Database
from .domain import Problem
from .model_api import create_model_app
from .model_policy import MOCK_MODE, Policy
from .model_proxy import ModelProxy


def write_token(proxy, run, generation, owner, path):
    path = Path(path)
    parent = path.parent.lstat()
    if path.parent.is_symlink() or parent.st_uid != os.getuid() or parent.st_mode & 0o077:
        raise ValueError("model_token_directory_must_be_private")
    # Never print a bearer token or overwrite an existing deployment artifact.
    fd = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, "w") as stream:
        token = proxy.issue(run, generation, owner)
        stream.write(token + "\n")
        stream.flush()
        os.fsync(stream.fileno())
    directory = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", type=Path, required=True)
    actions = parser.add_subparsers(dest="action", required=True)
    serve = actions.add_parser("serve")
    serve.add_argument("--port", type=int, default=17900)
    actions.add_parser("serve-fixture")
    actions.add_parser("serve-mock")
    issue = actions.add_parser("issue")
    issue.add_argument("--run", type=UUID, required=True)
    issue.add_argument("--generation", type=int, required=True)
    issue.add_argument("--lease-owner", type=UUID, required=True)
    issue.add_argument("--output", type=Path, required=True)
    revoke = actions.add_parser("revoke")
    revoke.add_argument("--run", type=UUID, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    try:
        policy = Policy.read(args.config)
        if args.action == "serve-fixture":
            if policy.mode != "fixture-http-v1":
                raise ValueError("fixture_policy_required")
            from .model_fixture import fixture_server

            fixture_server(urlsplit(policy.origin).port, policy.credential).serve_forever()
            return 0
        if args.action == "serve-mock":
            if policy.mode != MOCK_MODE:
                raise ValueError("mock_policy_required")
            from .model_mock import mock_server

            mock_server(
                urlsplit(policy.origin).port, policy.credential, policy.model
            ).serve_forever()
            return 0
        db = Database(os.environ["DATABASE_URL"])
        if args.action == "serve":
            uvicorn.run(
                create_model_app(db, policy, own_db=True),
                host="127.0.0.1",
                port=args.port,
                proxy_headers=False,
                access_log=False,
                log_level="critical",
            )
            return 0
        db.open()
        try:
            proxy = ModelProxy(db, policy)
            if args.action == "issue":
                write_token(proxy, args.run, args.generation, args.lease_owner, args.output)
            else:
                proxy.revoke(args.run)
        finally:
            db.close()
    except KeyboardInterrupt:
        return 0
    except (OSError, ValueError, KeyError, Problem, psycopg.Error, json.JSONDecodeError):
        # Parser/config/database exceptions can include paths, DSNs or secret values.
        print("model_proxy_command_failed", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

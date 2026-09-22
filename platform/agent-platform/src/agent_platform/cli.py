"""Operator CLI: migrations, one-time bootstrap, API and independent worker."""

import argparse
import getpass
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import uvicorn

from .api import create_app
from .auth import bootstrap
from .config import Settings
from .db import Database, migrate
from .domain import Problem
from .runtime_client import RuntimeClient
from .worker import Worker


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    commands.add_parser("register-runtime")
    connector = commands.add_parser("connector")
    connector.add_argument("--config", type=Path, required=True)
    connector.add_argument("--port", type=int, default=17800)
    setup = commands.add_parser("bootstrap")
    setup.add_argument("--username", required=True)
    setup.add_argument("--password-file", type=Path)
    api = commands.add_parser("api")
    api.add_argument("--host", default="127.0.0.1")
    api.add_argument("--port", type=int, default=8000)
    api.add_argument("--web-dist", type=Path)
    worker = commands.add_parser("worker")
    worker.add_argument("--once", action="store_true")
    args = parser.parse_args()
    if args.command == "connector":
        from .connector import create_connector
        from .connector_journal import private_file

        config = json.loads(private_file(args.config).read_text())
        uvicorn.run(
            create_connector(config),
            host="127.0.0.1",
            port=args.port,
            proxy_headers=False,
            access_log=False,
        )
        return 0
    settings = Settings.from_env()
    if args.command == "migrate":
        migrate(settings.database_url)
        print("Migrations applied")
        return 0
    if args.command == "api":
        uvicorn.run(
            create_app(settings, web_dist=args.web_dist),
            host=args.host,
            port=args.port,
            proxy_headers=False,
            access_log=False,
        )
        return 0
    db = Database(settings.database_url)
    db.open()
    try:
        if args.command == "bootstrap":
            if args.password_file:
                if args.password_file.stat().st_mode & 0o077:
                    parser.error("password file must be private (0600)")
                password = args.password_file.read_text().rstrip("\n")
            else:
                password = getpass.getpass("Operator password (at least 12 characters): ")
                if password != getpass.getpass("Confirm password: "):
                    parser.error("passwords do not match")
            bootstrap(db, args.username, password)
            print("Operator created")
        elif args.command == "register-runtime":
            connector = RuntimeClient.from_env()
            if connector is None:
                raise ValueError("CONNECTOR_ORIGIN is required")
            catalog = connector.register(db)
            print(
                "Registered pinned runtime with",
                len(catalog["repositories"]),
                "repository revisions",
            )
        elif args.command == "worker":
            runner = Worker(db, RuntimeClient.from_env())
            if args.once:
                runner.run_once()
            else:
                with ThreadPoolExecutor(max_workers=4) as pool:
                    pending = set()
                    while True:
                        for future in list(pending):
                            if future.done():
                                future.result()
                                pending.remove(future)
                        runner.reconcile_expired()
                        while len(pending) < 4:
                            claim = runner.claim()
                            if not claim:
                                break
                            pending.add(pool.submit(runner.execute, claim))
                        time.sleep(0.3)
    except (ValueError, Problem) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    finally:
        db.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

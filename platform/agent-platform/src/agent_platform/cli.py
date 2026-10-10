"""Operator CLI: migrations, one-time bootstrap, API and independent worker."""

import argparse
import getpass
import json
import logging
import os
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

MAINTENANCE_COMMANDS = {
    "backup-create",
    "backup-verify",
    "backup-restore",
    "archive-gc-preview",
    "archive-gc-apply",
}


def read_gc_plan(path):
    from .private_config import read_private_text

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError()
            result[key] = value
        return result

    def reject_constant(value):
        raise ValueError()

    try:
        value = json.loads(
            read_private_text(path.absolute(), max_bytes=65536),
            object_pairs_hook=unique,
            parse_constant=reject_constant,
        )
        if not isinstance(value, dict):
            raise ValueError()
        return value
    except (ValueError, OSError, RecursionError):
        raise ValueError("archive_gc_plan_invalid") from None


def maintenance_command(args):
    from psycopg import Error as DatabaseError
    from psycopg.conninfo import conninfo_to_dict

    db = None
    pool_logger = logging.getLogger("psycopg.pool")

    def hide_pool_details(record):
        # This standalone CLI emits one bounded error; background pool diagnostics may
        # embed malformed connection values before open() returns to our exception guard.
        return False

    try:
        plan = read_gc_plan(args.plan) if args.command == "archive-gc-apply" else None
        if args.command == "backup-verify":
            from .backup import verify_backup

            result = verify_backup(args.directory)
        else:
            url = os.environ.get("DATABASE_URL")
            if not url:
                raise ValueError("maintenance_database_required")
            if args.command == "backup-create":
                from .backup import create_backup

                result = create_backup(url, args.directory, offline=args.offline)
            elif args.command == "backup-restore":
                from .backup import restore_backup

                result = restore_backup(
                    url,
                    args.directory,
                    offline=args.offline,
                    confirm_database=args.confirm_database,
                )
            else:
                from .archive_retention import apply, preview

                conninfo_to_dict(url)
                pool_logger.addFilter(hide_pool_details)
                db = Database(url)
                db.open()
                if args.command == "archive-gc-preview":
                    result = preview(db, retention_days=args.retention_days, limit=args.limit)
                else:
                    result = apply(db, plan, approval_digest=args.approve)
        print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True))
        return 0
    except (ValueError, Problem) as exc:
        print(str(exc), file=sys.stderr)
        return 1
    except DatabaseError:
        print("maintenance_database_unavailable", file=sys.stderr)
        return 1
    finally:
        try:
            if db is not None:
                db.close()
        finally:
            pool_logger.removeFilter(hide_pool_details)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("migrate")
    commands.add_parser("register-runtime")
    for name in ("backup-create", "backup-verify", "backup-restore"):
        maintenance = commands.add_parser(name)
        maintenance.add_argument("--directory", type=Path, required=True)
        if name != "backup-verify":
            maintenance.add_argument("--offline", action="store_true", required=True)
        if name == "backup-restore":
            maintenance.add_argument("--confirm-database", required=True)
    preview = commands.add_parser("archive-gc-preview")
    preview.add_argument("--retention-days", type=int, default=30)
    preview.add_argument("--limit", type=int, default=100)
    pruning = commands.add_parser("archive-gc-apply")
    pruning.add_argument("--plan", type=Path, required=True)
    pruning.add_argument("--approve", required=True)
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
    export = commands.add_parser("export-worker")
    export.add_argument("--config", type=Path, required=True)
    export.add_argument("--once", action="store_true")
    rehearse = commands.add_parser("rehearse-mock")
    rehearse.add_argument("--directory", type=Path, required=True)
    rehearse.add_argument("--goal", required=True)
    rehearse.add_argument("--run-id", required=True)
    reconcile = commands.add_parser("reconcile-unconfirmed-allocation")
    reconcile.add_argument("--config", type=Path, required=True)
    reconcile.add_argument("--run-id", required=True)
    args = parser.parse_args()
    if args.command in MAINTENANCE_COMMANDS:
        return maintenance_command(args)
    if args.command == "rehearse-mock":
        from .model_mock import rehearse

        result = rehearse(args.directory, args.goal, args.run_id)
        print("fixture_matches_run=" + str(result["fixture_matches_run"]).lower())
        print("files=" + ",".join(result["files"]))
        return 0 if result["fixture_matches_run"] else 1
    if args.command == "reconcile-unconfirmed-allocation":
        from agent_platform_m0.kvm_lifecycle import Host

        from .connector_journal import private_file
        from .connector_recovery import reconcile_unconfirmed_allocation

        config = json.loads(private_file(args.config).read_text())
        observed = Host(Path(config["cocoon_config"]), Path(config["sandbox_data_dir"]))
        result = reconcile_unconfirmed_allocation(config, observed, args.run_id)
        print(result["decision"])
        return 0
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
        elif args.command == "export-worker":
            from .export_worker import from_private_config

            runner = from_private_config(db, args.config)
            if args.once:
                runner.run_once()
            else:
                while True:
                    runner.run_once()
                    time.sleep(1)
        elif args.command == "worker":
            runner = Worker(db, RuntimeClient.from_env())
            if args.once:
                runner.run_once()
            else:
                with (
                    ThreadPoolExecutor(max_workers=4) as pool,
                    ThreadPoolExecutor(max_workers=4) as controls,
                ):
                    pending = set()
                    stopping = set()
                    while True:
                        for future in list(pending):
                            if future.done():
                                future.result()
                                pending.remove(future)
                        runner.reconcile_expired()
                        for future in list(stopping):
                            if future.done():
                                future.result()
                                stopping.remove(future)
                        while len(stopping) < 4:
                            cancellation = runner.claim_control()
                            if not cancellation:
                                break
                            stopping.add(controls.submit(runner.execute, cancellation))
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

"""Test-only subprocess. Parent SIGKILLs at a deterministic durable boundary."""

import os
import signal
from pathlib import Path

import agent_platform.runtime_worker as runtime_worker
from agent_platform.db import Database
from agent_platform.runtime_client import RuntimeClient
from agent_platform.worker import Worker


def boundary(name):
    if os.environ["FAULT_POINT"] == name:
        Path(os.environ["FAULT_READY"]).write_text(name)
        os.kill(os.getpid(), signal.SIGSTOP)


class CrashClient(RuntimeClient):
    def allocate(self, run):
        boundary("before_allocate")
        value = super().allocate(run)
        boundary("after_allocate")
        return value

    def operation(self, run, action):
        boundary("before_" + action)
        value = super().operation(run, action)
        boundary("after_" + action)
        return value


def main():
    original = runtime_worker.event

    def event(*args, **kwargs):
        value = original(*args, **kwargs)
        if kwargs.get("source") == "openhands":
            boundary("before_event_commit")
        return value

    runtime_worker.event = event
    db = Database(os.environ["TEST_DATABASE_URL"])
    db.open()
    try:
        client = CrashClient(
            os.environ["FIXTURE_ORIGIN"], Path(os.environ["FIXTURE_TOKEN"]).read_text()
        )
        Worker(db, client).run_once()
    finally:
        db.close()


if __name__ == "__main__":
    main()

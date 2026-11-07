"""Test-only kill rendezvous around real product journal/admission boundaries."""

import json
import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace

from recovery_fixture import FixtureConnector, Node

from agent_platform import connector_cleanup, connector_journal, stale_cleanup
from agent_platform.db import Database
from agent_platform.runtime_client import RuntimeClient


def main():
    payload = json.loads(Path(sys.argv[1]).read_text())
    ready, phase = Path(payload["ready"]), payload["phase"]

    def rendezvous():
        ready.write_text("ready")
        while True:
            time.sleep(1)

    if phase == "admission-before-intent":
        db = Database(os.environ["TEST_DATABASE_URL"])
        db.open()
        client = RuntimeClient(payload["origin"], payload["connector_token"])
        client.cleanup_apply = lambda *args, **kwargs: rendezvous()
        stale_cleanup.apply(
            db, client, payload["plan"], approval_digest=payload["plan"]["approval_digest"]
        )
        raise AssertionError("rendezvous returned")

    class DurableNode(Node):
        def attach(self, owner, identifier, token):
            handle = super().attach(owner, identifier, token)

            def close():
                handle.close()
                target = Path(payload["upstream_state"])
                with target.open("w") as output:
                    json.dump({"rows": self.rows, "calls": self.calls}, output)
                    output.flush()
                    os.fsync(output.fileno())

            return SimpleNamespace(close=close)

    node = DurableNode(Path(payload["config"]["state_dir"]).parent)
    node.rows, node.calls = payload["rows"], payload["calls"]
    service = FixtureConnector(payload["config"], client=node, host=node)
    original = service.journal.write
    if phase == "enrollment-before":
        # The real temporary journal has been flushed/fsynced; SIGKILL precedes
        # replacement of the original run row, rather than a fabricated write.
        connector_journal.os.replace = lambda *args, **kwargs: rendezvous()

    def write(row):
        value = row.get("stale_cleanup")
        enrolled = value is not None
        attempted = enrolled and bool(value["attempts"])
        receipted = attempted and any(a["receipt"] is not None for a in value["attempts"].values())
        if phase == "effect-before-receipt" and receipted:
            rendezvous()
        original(row)
        if phase == "enrollment-after" and enrolled:
            rendezvous()
        if phase == "attempt-after-intent" and attempted:
            rendezvous()

    service.journal.write = write
    if phase.startswith("enrollment-"):
        connector_cleanup.preview(service, payload["run_id"], payload["context"])
    else:
        connector_cleanup.apply(
            service, payload["plan"], payload["plan"]["next_generation"], payload["db_digest"]
        )
    raise AssertionError("kill point not reached")


if __name__ == "__main__":
    main()

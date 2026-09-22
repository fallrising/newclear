"""Real-VM approval acceptance used by the M3 fault driver."""

import threading
import time

from agent_platform.store import Store
from agent_platform.worker import Worker


def exercise(db, client, api, post, run, before, node, host, claim, worker, choice):
    thread = threading.Thread(target=worker.execute, args=(claim,), daemon=True)
    thread.start()
    try:
        deadline = time.monotonic() + 40
        while Store(db).run(run["id"])["state"] != "awaiting_approval":
            if not thread.is_alive() or time.monotonic() >= deadline:
                raise RuntimeError(
                    "approval_not_observed:" + str(Store(db).run(run["id"])["reason"])
                )
            time.sleep(0.1)
        approval = api.get(f"/api/v1/runs/{run['id']}/approvals").json()["items"][-1]
        handle = before["handle"]
        sb = node.attach(handle["owner"], handle["id"], handle["token"])
        untouched = sb.exec(
            "python3",
            "-c",
            "from pathlib import Path; "
            "assert not Path('/home/agentprobe/workspace/m2-result.txt').exists(); "
            "print('not executed')",
            timeout=15,
        ).strip()
        assert untouched == "not executed"
        assert len(host.vms()) == len(node.sandboxes()) == Store(db).runtime()["occupied"] == 1
        view = Store(db).run(run["id"])
        post(
            f"/approvals/{approval['id']}/decision",
            {
                "decision": choice,
                "action_digest": approval["action_digest"],
                "generation": approval["generation"],
                "expected_state_version": view["state_version"],
            },
        )
        thread.join(timeout=40)
        if thread.is_alive():
            raise RuntimeError("approval_worker_did_not_finish")
        if choice == "deny":
            assert Store(db).run(run["id"])["state"] == "cancelling"
            assert Store(db).runtime()["occupied"] == 1
            Worker(db, client).run_once()
        view = Store(db).run(run["id"])
        assert view["state"] == ("succeeded" if choice == "approve" else "cancelled"), view[
            "reason"
        ]
        assert view["cleanup_state"] == "confirmed"
        assert Store(db).runtime()["occupied"] == 0
        if choice == "approve":
            assert view["result"]["verification"]["status"] == "passed"
        else:
            assert view["result"] is None
        return {
            "decision": choice,
            "run_id": run["id"],
            "vm_id": before["observed"]["vm_id"],
            "state": view["state"],
            "not_executed_before_decision": True,
            "action_digest": approval["action_digest"],
            "generation": view["generation"],
            "proof": host.wait_removed(before["observed"]),
        }
    finally:
        if thread.is_alive():
            with db.transaction() as conn:
                conn.execute(
                    "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second' "
                    "WHERE run_id=%s",
                    (run["id"],),
                )
            thread.join(timeout=10)

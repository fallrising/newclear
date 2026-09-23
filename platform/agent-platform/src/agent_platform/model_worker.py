"""Worker-owned mailbox pump; never holds DB/connector locks during model I/O."""

import time
from datetime import timedelta
from uuid import NAMESPACE_URL, UUID, uuid5

from .domain import Problem
from .model_dialect import SDKCompletion


class ModelSession:
    def __init__(self, worker, claim):
        self.worker, self.claim = worker, claim
        self.proxy = worker.model_proxy
        self.token, self.issued, self.revision = None, 0, 0

    def step(self, run):
        if run["state"] != "running":
            return
        if not self.token or time.monotonic() - self.issued >= 120:
            self.token = self.proxy.issue(run["id"], run["generation"], self.worker.owner)
            self.revision += 1
            self.worker.connector.model(run, "credential", token=self.token, revision=self.revision)
            self.issued = time.monotonic()
            with self.worker.owned(self.claim) as (conn, current):
                self.proxy.live(conn, current["id"], current["generation"], self.worker.owner)
                conn.execute(
                    "UPDATE model_proxy_runs SET guest_connected=true WHERE run_id=%s", (run["id"],)
                )
        value = self.worker.connector.model(run, "poll")
        pending = value.get("pending")
        if pending is None:
            return
        if (
            pending.get("run_id") != str(run["id"])
            or pending.get("generation") != run["generation"]
            or pending.get("token") != self.token
        ):
            raise Problem(409, "model_mailbox_identity_mismatch")
        identity = UUID(pending["request_id"])
        result = self.proxy.complete(
            run["id"], pending["token"], identity, SDKCompletion(pending["payload"]), sdk=True
        )
        with self.worker.owned(self.claim) as (conn, current):
            self.proxy.authorize(conn, current["id"], self.token)
        # Admission was already committed. A crash before/after delivery never
        # regenerates the completion: SQL request ID and connector intent persist.
        result = {
            **result,
            "model": "gpt-4o-mini",
            "id": "chatcmpl-" + str(identity),
            "object": "chat.completion",
            "created": 0,
        }
        self.worker.connector.model(run, "deliver", request_id=str(identity), response=result)

    def admit_tool(self, run, descriptor):
        with self.worker.owned(self.claim) as (conn, current):
            now = self.proxy.tool_gate(
                conn, current["id"], current["generation"], self.worker.owner
            )
            expiry = min(now + timedelta(seconds=10), current["deadline"], current["lease_until"])
        action = descriptor["normalized_action"]
        if action["run_id"] != str(run["id"]) or action["generation"] != run["generation"]:
            raise Problem(409, "model_tool_identity_mismatch")
        approval = {
            "id": uuid5(NAMESPACE_URL, "model-tool:" + descriptor["action_digest"]),
            "action_digest": descriptor["action_digest"],
            "expires_at": expiry,
        }
        self.worker.connector.approve(run, approval)


def cutoff_reason(worker, run_id):
    with worker.db.transaction() as conn:
        row = conn.execute(
            "SELECT cutoff_reason FROM model_proxy_runs WHERE run_id=%s", (run_id,)
        ).fetchone()
    return row["cutoff_reason"] if row else None

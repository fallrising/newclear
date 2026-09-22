"""Worker-to-connector boundary; no node tokens, guest secrets or local paths."""

import os
from urllib.parse import urlencode

from psycopg.types.json import Jsonb

from agent_platform_m0.transport import HTTP, ProbeError

from .connector_journal import private_file
from .domain import Problem


class RuntimeClient:
    def __init__(self, origin, token):
        self.http = HTTP(origin, token, timeout=120)
        self.lease_http = HTTP(origin, token, timeout=5)

    @classmethod
    def from_env(cls):
        origin = os.environ.get("CONNECTOR_ORIGIN")
        if not origin:
            return None
        token = private_file(os.environ["CONNECTOR_TOKEN_FILE"]).read_text().strip()
        return cls(origin, token)

    def call(self, method, path, data=None):
        try:
            status, result = self.http.request(method, path, data)
        except ProbeError:
            raise Problem(503, "connector_unavailable_or_uncertain") from None
        if status != 200:
            raise Problem(409, "connector_operation_unconfirmed")
        return result

    def register(self, db):
        catalog = self.call("GET", "/v1/catalog")
        with db.transaction() as conn:
            conn.execute(
                "SELECT node_id FROM runtime_capacity WHERE node_id='cocoon-local' FOR UPDATE"
            ).fetchone()
            occupied = conn.execute(
                "SELECT 1 FROM sandbox_bindings b JOIN resource_reservations r ON "
                "b.id=r.sandbox_id WHERE b.node_id='cocoon-local' AND r.released_at IS"
                " NULL LIMIT 1"
            ).fetchone()
            if occupied:
                raise Problem(409, "runtime_registration_requires_drain")
            conn.execute(
                "INSERT INTO runtime_catalog(node_id,template_digest,repositories) "
                "VALUES ('cocoon-local',%s,%s) ON CONFLICT(node_id) DO UPDATE SET temp"
                "late_digest=excluded.template_digest,repositories=excluded.repositori"
                "es,registered_at=now()",
                (catalog["template_digest"], Jsonb(catalog["repositories"])),
            )
            conn.execute("UPDATE runtime_capacity SET draining=false WHERE node_id='cocoon-local'")
        return catalog

    def fence(self, run):
        try:
            self.lease_http.expect(
                "PUT",
                f"/v1/runs/{run['id']}/lease",
                {"generation": run["generation"], "lease_until": run["lease_until"].isoformat()},
            )
        except ProbeError:
            raise Problem(409, "connector_lease_unconfirmed") from None

    def cancel(self, run):
        return self.call("POST", f"/v1/runs/{run['id']}/cancel", {"generation": run["generation"]})

    def inspect(self, run):
        return self.call("GET", f"/v1/runs/{run['id']}?generation={run['generation']}")

    def allocate(self, run):
        return self.call(
            "POST",
            "/v1/runs/" + str(run["id"]),
            {
                "generation": run["generation"],
                "template": run["template_digest"],
                "canonical_repo": run["canonical_repo"],
                "base_sha": run["base_sha"],
                "deadline": run["deadline"].isoformat(),
                "require_approval": run.get("require_approval", False),
            },
        )

    def operation(self, run, action):
        return self.call(
            "POST",
            f"/v1/runs/{run['id']}/operations",
            {
                "generation": run["generation"],
                "action": action,
                "goal": run["goal"] if action == "prompt" else "",
            },
        )

    def events(self, run):
        query = {"generation": run["generation"]}
        if run["backend_cursor"]:
            query["cursor"] = run["backend_cursor"]
        return self.call("GET", f"/v1/runs/{run['id']}/events?" + urlencode(query))

    def approve(self, run, approval):
        return self.call(
            "POST",
            f"/v1/runs/{run['id']}/approve",
            {
                "generation": run["generation"],
                "approval_id": str(approval["id"]),
                "action_digest": approval["action_digest"],
                "expires_at": approval["expires_at"].isoformat(),
            },
        )

    def control(self, run):
        return self.call(
            "POST",
            f"/v1/runs/{run['id']}/control",
            {
                "generation": run["generation"],
                "action": run["control_action"],
                "command_id": str(run["control_command_id"]),
                "pause_id": str(run["pause_command_id"]),
            },
        )

"""Durable, expiring worker admission grants, separate from long operation locks.

Only the private worker can supply a committed DB lease. A grant cannot stop an
already admitted guest operation; takeover inspects it under the operation lock.
Both services must use synchronized host clocks (the supported single node).
"""

from datetime import UTC, datetime

from pydantic import Field

from .connector_journal import Journal
from .domain import Input, Problem


class Lease(Input):
    generation: int = Field(ge=1)
    lease_until: datetime


class Fences:
    def __init__(self, root):
        self.journal = Journal(root)

    def grant(self, run_id, lease):
        if lease.lease_until.tzinfo is None:
            raise Problem(422, "lease_requires_timezone")
        with self.journal.locked(run_id):
            seconds = (lease.lease_until - datetime.now(UTC)).total_seconds()
            if not 0 < seconds <= 35:
                raise Problem(409, "connector_lease_expired_or_invalid")
            row = self.journal.read(run_id)
            if row and row["generation"] > lease.generation:
                raise Problem(409, "connector_generation_stale")
            if (
                row
                and row["generation"] == lease.generation
                and datetime.fromisoformat(row["lease_until"]) >= lease.lease_until
            ):
                return {"generation": lease.generation}
            self.journal.write({"run_id": str(run_id), **lease.model_dump(mode="json")})
            return {"generation": lease.generation}

    def require(self, run_id, generation):
        with self.journal.locked(run_id):
            row = self.journal.read(run_id)
            if not row or row["generation"] != generation:
                raise Problem(409, "connector_generation_stale")
            if datetime.fromisoformat(row["lease_until"]) <= datetime.now(UTC):
                raise Problem(409, "connector_lease_expired")

    def close(self):
        self.journal.close()

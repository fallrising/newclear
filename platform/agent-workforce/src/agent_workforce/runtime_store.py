"""Attempt intent, reservations, leases, stop proof, and recovery."""
import json
import uuid

from .storage_base import ConflictError, StaleFenceError, StoreError, finite_time, positive_int, text_value

_KINDS = ("job", "account", "quota_pool", "session", "workspace")
_SINGLE_CAPACITY = ("session", "workspace")
_REPLACEABLE = ("failed", "cancelled", "execution_completed")
_EXPIRE_STATES = ("dispatch_prepared", "running", "stopping", "outcome_unknown")
_RECOVER_STATES = ("dispatch_prepared", "running", "stopping")
_TRANSITIONS = {
    "dispatch_prepared": ("running", "outcome_unknown", "cancelled"),
    "running": ("awaiting_review", "failed", "stopping", "outcome_unknown"),
    "stopping": ("cancelled", "outcome_unknown"),
    "outcome_unknown": ("running", "awaiting_review", "failed", "cancelled"),
    "awaiting_review": ("execution_completed", "failed"),
}


class RuntimeStore:
    """Lifecycle mixin. Construction and schema stay on StorageBase."""

    def prepare_attempt(self, command_id, *, route, grant, resources, now, lease_until):
        command_id = text_value(command_id)
        now = finite_time(now)
        lease_until = finite_time(lease_until)
        if not lease_until > now:
            raise StoreError("lease_until must be after now")
        route_json = self._snapshot(route, "route")
        grant_json = self._snapshot(grant, "grant")
        normalized = self._resources(resources)
        with self.transaction():
            command = self._db.execute(
                "SELECT command_id FROM commands WHERE command_id=?",
                (command_id,),
            ).fetchone()
            if command is None:
                raise StoreError("unknown command")
            self._reject_overlapping_attempt(command_id)
            attempt_id = str(uuid.uuid4())
            operation_id = str(uuid.uuid4())
            fence = self._next_fence()
            self._db.execute(
                """INSERT INTO attempts(
                    attempt_id, command_id, operation_id, state, route, grant_snapshot,
                    controller_epoch, fence, lease_until, stop_proven, effects_resolved, result
                ) VALUES(?,?,?,?,?,?,?,?,?,0,0,NULL)""",
                (
                    attempt_id, command_id, operation_id, "dispatch_prepared", route_json, grant_json,
                    self.controller_epoch, fence, lease_until,
                ),
            )
            for kind, key, capacity in normalized:
                self._hold_resource(attempt_id, kind, key, capacity)
            self._db.execute(
                "UPDATE commands SET state=? WHERE command_id=?",
                ("dispatch_prepared", command_id),
            )
            self._check_fault("attempt_before_commit")
            self._audit("attempt_prepared", {
                "attempt_id": attempt_id,
                "command_id": command_id,
                "operation_id": operation_id,
                "state": "dispatch_prepared",
                "fence": fence,
            })
            return self._attempt_view(self._attempt_row(attempt_id))

    def attempt(self, attempt_id):
        with self._lock:
            self._require_open()
            row = self._db.execute(
                "SELECT * FROM attempts WHERE attempt_id=?",
                (attempt_id,),
            ).fetchone()
            if row is None:
                return None
            return self._attempt_view(row)

    def attempts(self):
        with self._lock:
            self._require_open()
            return [
                self._attempt_view(row)
                for row in self._db.execute("SELECT * FROM attempts ORDER BY rowid")
            ]

    def reservations(self):
        with self._lock:
            self._require_open()
            return [
                self._reservation_view(row)
                for row in self._db.execute("SELECT * FROM reservations ORDER BY rowid")
            ]

    def claim_lease(self, attempt_id, *, now, lease_until):
        attempt_id = text_value(attempt_id)
        now = finite_time(now)
        lease_until = finite_time(lease_until)
        if not lease_until > now:
            raise StoreError("lease_until must be after now")
        with self.transaction():
            row = self._attempt_row(attempt_id)
            if row is None:
                raise StoreError("unknown attempt")
            expired = bool(row["lease_expired"]) or not (row["lease_until"] > now)
            previous_incarnation = row["controller_epoch"] != self.controller_epoch
            if not expired and not previous_incarnation:
                raise ConflictError("lease is still current")
            new_fence = self._next_fence()
            self._db.execute(
                """UPDATE attempts
                   SET fence=?, controller_epoch=?, lease_until=?, lease_expired=0
                   WHERE attempt_id=?""",
                (new_fence, self.controller_epoch, lease_until, attempt_id),
            )
            self._audit("lease_claimed", {
                "attempt_id": attempt_id,
                "operation_id": row["operation_id"],
                "fence": new_fence,
            })
            return new_fence

    def expire_leases(self, now):
        now = finite_time(now)
        with self.transaction():
            rows = self._db.execute(
                """SELECT * FROM attempts
                   WHERE lease_until<=? AND lease_expired=0 AND state IN (?,?,?,?)""",
                (now, *_EXPIRE_STATES),
            ).fetchall()
            for row in rows:
                self._db.execute("UPDATE attempts SET lease_expired=1 WHERE attempt_id=?", (row["attempt_id"],))
                self._mark_unknown(row, "lease_expired")

    def publish_attempt(self, attempt_id, fence, state, *, now, result=None):
        attempt_id = text_value(attempt_id)
        now = finite_time(now)
        if type(state) is not str:
            raise StoreError("invalid attempt state")
        with self.transaction():
            row = self._attempt_row(attempt_id)
            if row is None:
                raise StoreError("unknown attempt")
            self._require_current_lease(row, fence, now)
            if state == row["state"]:
                if result is None:
                    return self._attempt_view(row)
                self._db.execute(
                    "UPDATE attempts SET result=? WHERE attempt_id=?",
                    (self._json(result), attempt_id),
                )
                self._audit("attempt_published", {
                    "attempt_id": attempt_id,
                    "operation_id": row["operation_id"],
                    "state": state,
                    "fence": row["fence"],
                })
                return self._attempt_view(self._attempt_row(attempt_id))
            allowed = _TRANSITIONS.get(row["state"], ())
            if state not in allowed:
                raise StoreError("invalid attempt transition")
            if state == "cancelled" and not (row["stop_proven"] and row["effects_resolved"]):
                raise StoreError("cancellation requires recorded stop and effects proof")
            if result is None:
                self._db.execute(
                    "UPDATE attempts SET state=? WHERE attempt_id=?",
                    (state, attempt_id),
                )
            else:
                self._db.execute(
                    "UPDATE attempts SET state=?, result=? WHERE attempt_id=?",
                    (state, self._json(result), attempt_id),
                )
            self._db.execute(
                "UPDATE commands SET state=? WHERE command_id=?",
                (state, row["command_id"]),
            )
            self._audit("attempt_published", {
                "attempt_id": attempt_id,
                "operation_id": row["operation_id"],
                "state": state,
                "fence": row["fence"],
            })
            return self._attempt_view(self._attempt_row(attempt_id))

    def confirm_stop(self, attempt_id, *, evidence, effects_resolved, now):
        attempt_id = text_value(attempt_id)
        finite_time(now)
        if type(evidence) is not dict:
            raise StoreError("stop evidence required")
        if type(effects_resolved) is not bool:
            raise StoreError("effects_resolved bool required")
        if evidence.get("stopped") is not True:
            raise StoreError("stopped proof required")
        evidence_effects = evidence.get("effects_resolved")
        if type(evidence_effects) is not bool or evidence_effects is not effects_resolved:
            raise StoreError("effects proof mismatch")
        operation_id = evidence.get("operation_id")
        if type(operation_id) is not str:
            raise StoreError("stop evidence operation mismatch")
        not_started = False
        if "not_started" in evidence:
            if type(evidence["not_started"]) is not bool:
                raise StoreError("not_started proof must be bool")
            not_started = evidence["not_started"]
        with self.transaction():
            row = self._attempt_row(attempt_id)
            if row is None:
                raise StoreError("unknown attempt")
            if operation_id != row["operation_id"]:
                raise StoreError("stop evidence operation mismatch")
            if not_started and (row["state"] != "dispatch_prepared" or effects_resolved is not True):
                raise StoreError("not_started proof is only valid before backend invocation")
            if effects_resolved:
                self._db.execute(
                    "UPDATE attempts SET stop_proven=1, effects_resolved=1 WHERE attempt_id=?",
                    (attempt_id,),
                )
                self._db.execute(
                    "UPDATE reservations SET released=1 WHERE attempt_id=? AND released=0",
                    (attempt_id,),
                )
            else:
                self._db.execute(
                    "UPDATE attempts SET stop_proven=1 WHERE attempt_id=?",
                    (attempt_id,),
                )
            self._audit("stop_confirmed", {
                "attempt_id": attempt_id,
                "operation_id": operation_id,
                "stop_proven": True,
                "effects_resolved": effects_resolved,
                "not_started": not_started,
            })
            return self._attempt_view(self._attempt_row(attempt_id))

    def recover_attempts(self, now):
        finite_time(now)
        with self.transaction():
            rows = self._db.execute(
                """SELECT * FROM attempts
                   WHERE controller_epoch!=? AND state IN (?,?,?)""",
                (self.controller_epoch, *_RECOVER_STATES),
            ).fetchall()
            for row in rows:
                self._mark_unknown(row, "attempt_recovered")

    def _mark_unknown(self, row, audit_kind):
        self._db.execute(
            "UPDATE attempts SET state=? WHERE attempt_id=?",
            ("outcome_unknown", row["attempt_id"]),
        )
        self._db.execute(
            "UPDATE commands SET state=? WHERE command_id=?",
            ("outcome_unknown", row["command_id"]),
        )
        self._audit(audit_kind, {
            "attempt_id": row["attempt_id"],
            "operation_id": row["operation_id"],
            "state": "outcome_unknown",
            "fence": row["fence"],
        })

    def _hold_resource(self, attempt_id, kind, key, capacity):
        # Active count is capped by the lowest held snapshot so a later caller cannot raise it.
        held = self._db.execute(
            "SELECT capacity FROM reservations WHERE kind=? AND key=? AND released=0",
            (kind, key),
        ).fetchall()
        limit = capacity
        if held:
            limit = min([capacity] + [item["capacity"] for item in held])
        if len(held) + 1 > limit:
            raise ConflictError("resource capacity exceeded: " + kind)
        self._db.execute(
            """INSERT INTO reservations(
                reservation_id, attempt_id, kind, key, capacity, released
            ) VALUES(?,?,?,?,?,0)""",
            (str(uuid.uuid4()), attempt_id, kind, key, capacity),
        )

    def _reject_overlapping_attempt(self, command_id):
        rows = self._db.execute(
            "SELECT state, stop_proven, effects_resolved FROM attempts WHERE command_id=?",
            (command_id,),
        ).fetchall()
        for row in rows:
            proven = bool(row["stop_proven"]) and bool(row["effects_resolved"])
            if row["state"] in _REPLACEABLE and proven:
                continue
            raise ConflictError("command already has an unresolved attempt")

    def _require_current_lease(self, row, fence, now):
        current = (
            type(fence) is int
            and row["fence"] == fence
            and row["controller_epoch"] == self.controller_epoch
            and row["lease_until"] > now
            and not row["lease_expired"]
        )
        if not current:
            raise StaleFenceError("stale lease fence")

    def _resources(self, resources):
        if type(resources) is not list or len(resources) != len(_KINDS):
            raise StoreError("exactly one resource of each kind required")
        normalized = []
        seen = set()
        for item in resources:
            if type(item) is not dict:
                raise StoreError("resource record required")
            kind = item.get("kind")
            if type(kind) is not str or kind not in _KINDS:
                raise StoreError("unsupported resource kind")
            if kind in seen:
                raise StoreError("duplicate resource")
            seen.add(kind)
            capacity = positive_int(item.get("capacity"))
            if kind in _SINGLE_CAPACITY and capacity != 1:
                raise StoreError("session and workspace capacity must be 1")
            normalized.append((kind, text_value(item.get("key")), capacity))
        if seen != set(_KINDS):
            raise StoreError("exactly one resource of each kind required")
        return normalized

    def _snapshot(self, value, label):
        if type(value) is not dict:
            raise StoreError(label + " snapshot required")
        return self._json(value)

    def _attempt_row(self, attempt_id):
        return self._db.execute(
            "SELECT * FROM attempts WHERE attempt_id=?",
            (attempt_id,),
        ).fetchone()

    def _attempt_view(self, row):
        raw_result = row["result"]
        return {
            "attempt_id": row["attempt_id"],
            "command_id": row["command_id"],
            "operation_id": row["operation_id"],
            "state": row["state"],
            "route": json.loads(row["route"]),
            "grant": json.loads(row["grant_snapshot"]),
            "controller_epoch": row["controller_epoch"],
            "fence": row["fence"],
            "lease_until": row["lease_until"],
            "lease_expired": bool(row["lease_expired"]),
            "stop_proven": bool(row["stop_proven"]),
            "effects_resolved": bool(row["effects_resolved"]),
            "result": None if raw_result is None else json.loads(raw_result),
        }

    def _reservation_view(self, row):
        return {
            "reservation_id": row["reservation_id"],
            "attempt_id": row["attempt_id"],
            "kind": row["kind"],
            "key": row["key"],
            "capacity": row["capacity"],
            "released": bool(row["released"]),
        }

    def _require_open(self):
        if self._db is None:
            raise StoreError("store is closed")

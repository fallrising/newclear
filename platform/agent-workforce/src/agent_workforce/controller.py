"""Offline controller over the immutable store and admission ports."""
from .admission import AdmissionError, _normalize_grant, _normalize_request, admit
from .domain import Registry, RegistryError
from .storage_base import ConflictError, StoreError

_KINDS = (
    "workers",
    "products",
    "accounts",
    "entitlements",
    "profiles",
    "resources",
    "routes",
    "jobs",
    "sessions",
)
_POLICY_FIELDS = (
    "route_revision",
    "worker_revision",
    "account_revision",
    "entitlement_revision",
    "profile_revision",
    "input_revision",
    "ac_revision",
)


class Controller:
    """Trusted boundary for admission, preparation, and one fake backend."""

    def __init__(self, store, backend, *, clock, trusted_issuers):
        if isinstance(trusted_issuers, (str, bytes)) or not isinstance(trusted_issuers, (tuple, list)):
            raise RegistryError("trusted_issuers")
        self.store = store
        self.backend = backend
        self.clock = clock
        self.trusted_issuers = tuple(trusted_issuers)
        # Serialize record/grant mutations with the check-to-send boundary,
        # including multiple controller handles over the same trusted Store.
        self._lock = store._lock
        self.store.recover_attempts(self.clock())

    def register(self, kind, key, record):
        """Install one versioned record without executing it."""
        if kind not in _KINDS:
            raise RegistryError("category")
        return self.store.put_record(kind, key, record)

    def put_grant(self, grant, *, authenticated_operator):
        """Store one trusted grant. Issuer, operator, and revision must agree."""
        if authenticated_operator not in self.trusted_issuers:
            raise AdmissionError("untrusted_operator")
        normalized = _normalize_grant(grant)
        if normalized["issuer"] != authenticated_operator or normalized["issuer"] not in self.trusted_issuers:
            raise AdmissionError("untrusted_issuer")
        return self.store.put_record("grants", normalized["grant_id"], normalized)

    def accept(self, request, *, authenticated_caller):
        """Admit a new command, or return the original immutable command."""
        with self._lock:
            normalized = _normalize_request(request, authenticated_caller)
            payload = _payload(normalized)
            policy = _route_policy(normalized)
            now = self.clock()
            with self.store.transaction():
                existing = self._command_for_step(normalized["job_id"], normalized["step_id"])
                if existing is not None:
                    _require_same_command(existing, payload, policy, normalized["worker_id"], self.store._json)
                    return existing
                registry = self._registry()
                self._bind(registry, normalized)
                admit(
                    registry,
                    self._load_grant(normalized["grant_id"]),
                    normalized,
                    authenticated_caller=authenticated_caller,
                    now=now,
                    usage=self.store.usage(normalized["job_id"]),
                    phase="accept",
                )
                return self.store.accept_command(
                    normalized["job_id"],
                    normalized["step_id"],
                    payload,
                    worker_id=normalized["worker_id"],
                    route_policy=policy,
                    grant_id=normalized["grant_id"],
                )

    def dispatch(self, command_id, grant_id=None):
        """Prepare once, recheck, then start. An existing attempt is never replaced."""
        with self._lock:
            self._reject_outer_transaction()
            attempt, created = self._prepare(command_id, grant_id)
            if not created:
                return attempt
            now = self._recheck(attempt, command_id, grant_id)
            try:
                receipt = self.backend.start(
                    attempt["operation_id"],
                    command_id=command_id,
                    attempt_id=attempt["attempt_id"],
                )
            except Exception:
                now = self.clock()
                self.store.expire_leases(now)
                return self._mark_unknown(attempt, now)
            now = self.clock()
            current = self.store.attempt(attempt["attempt_id"])
            if not _lease_current(current, self.store.controller_epoch, now):
                self.store.expire_leases(now)
                return self._mark_unknown(current, now)
            return self._apply_receipt(attempt, receipt, now)

    def receive(self, envelope, *, authenticated_sender, recipient, replay=False):
        """Store or replay one inbox envelope. This never starts a backend."""
        if type(replay) is not bool:
            raise AdmissionError("malformed")
        return self.store.receive_message(authenticated_sender, envelope, recipient)

    def recover(self):
        """Invalidate the previous incarnation without starting work."""
        with self._lock:
            self.store.recover_attempts(self.clock())

    def reconcile(self, attempt_id):
        """Inspect the original operation and publish only that receipt."""
        with self._lock:
            self._reject_outer_transaction()
            now = self.clock()
            attempt = self._ensure_lease(self._require_attempt(attempt_id), now)
            try:
                receipt = self.backend.inspect(attempt["operation_id"])
            except Exception:
                return self._mark_unknown(attempt, self.clock())
            now = self.clock()
            if not _lease_current(attempt, self.store.controller_epoch, now):
                self.store.expire_leases(now)
                return self._mark_unknown(attempt, now)
            if not isinstance(receipt, dict) or receipt.get("operation_id") != attempt["operation_id"]:
                return self.store.attempt(attempt_id)
            if receipt.get("status") == "complete":
                with self.store.transaction():
                    return self._complete(self.store.attempt(attempt_id), receipt, now)
            if receipt.get("status") == "failed":
                with self.store.transaction():
                    return self._failed(self.store.attempt(attempt_id), receipt, now)
            if receipt.get("status") == "running" and attempt["state"] == "outcome_unknown":
                return self.store.publish_attempt(attempt["attempt_id"], attempt["fence"], "running", now=now)
            if receipt.get("status") in ("stopped", "cancelled"):
                if receipt.get("stopped") is True and type(receipt.get("effects_resolved")) is bool:
                    with self.store.transaction():
                        self._confirm(attempt, receipt, now, not_started=False)
                        return self._publish_stop(self.store.attempt(attempt_id), receipt, now)
            return self.store.attempt(attempt_id)

    def stop(self, attempt_id):
        """Stop the original operation. Incomplete proof stays unknown and reserved."""
        with self._lock:
            self._reject_outer_transaction()
            now = self.clock()
            attempt = self._ensure_lease(self._require_attempt(attempt_id), now)
            try:
                receipt = self.backend.stop(attempt["operation_id"])
            except Exception:
                return self._mark_unknown(attempt, self.clock())
            now = self.clock()
            if not _lease_current(attempt, self.store.controller_epoch, now):
                self.store.expire_leases(now)
                return self._mark_unknown(attempt, now)
            if not isinstance(receipt, dict) or receipt.get("operation_id") != attempt["operation_id"]:
                return self._mark_unknown(attempt, now)
            if receipt.get("stopped") is True and type(receipt.get("effects_resolved")) is bool:
                with self.store.transaction():
                    self._confirm(attempt, receipt, now, not_started=False)
                    return self._publish_stop(self.store.attempt(attempt["attempt_id"]), receipt, now)
            return self._mark_unknown(attempt, now)

    def _reject_outer_transaction(self):
        """Refuse work while the caller still owns a Store transaction."""
        if self.store._depth != 0:
            raise StoreError("commit the outer Store transaction first")

    def _prepare(self, command_id, grant_id):
        now = self.clock()
        with self.store.transaction():
            existing = self._existing_attempt(command_id)
            if existing is not None:
                return existing, False
            command = self._require_command(command_id)
            decision, session, workspace, registry = self._admit_command(command, grant_id, now, None)
            attempt = self.store.prepare_attempt(
                command_id,
                route=decision["route"],
                grant=decision["grant"],
                resources=self._resources(registry, decision, session, workspace),
                now=now,
                lease_until=self._lease_until(now, decision),
            )
            return attempt, True

    def _recheck(self, attempt, command_id, grant_id):
        # Sample the clock before reading the grant so a pre-start revocation is visible.
        now = self.clock()
        try:
            with self.store.transaction():
                command = self._require_command(command_id)
                self._admit_command(command, grant_id, now, attempt["attempt_id"])
                current = self.store.attempt(attempt["attempt_id"])
                if not _prepared_lease_holds(attempt, current, self.store.controller_epoch, now):
                    raise AdmissionError("prepared_lease_expired")
        except (AdmissionError, RegistryError):
            self._cancel_unstarted(attempt, now)
            raise
        return now

    def _admit_command(self, command, grant_id, now, exclude_attempt_id):
        selected = command["grant_id"] if grant_id is None else grant_id
        grant_row = self._load_grant(selected)
        request = dict(command["input_payload"])
        request["grant_id"] = grant_row["grant_id"]
        _require_same_command(command, _payload(request), _route_policy(request), request["worker_id"], self.store._json)
        registry = self._registry()
        session, workspace = self._bind(registry, request)
        caller = request.get("caller", request.get("sender"))
        decision = admit(
            registry,
            grant_row,
            request,
            authenticated_caller=caller,
            now=now,
            usage=self._usage(command["job_id"], exclude_attempt_id),
            phase="dispatch",
        )
        return decision, session, workspace, registry

    def _bind(self, registry, request):
        session = registry.get("sessions", request["session_binding_id"])
        if session is None:
            raise AdmissionError("missing_session")
        route = registry.get("routes", request["route_id"])
        workspace = None if session.get("workspace_ref") is None else registry.get("resources", session["workspace_ref"])
        if (
            route is None
            or workspace is None
            or session["worker_id"] != request["worker_id"]
            or session["job_id"] != request["job_id"]
            or session["route_id"] != request["route_id"]
            or session["account_ref"] != route["account_ref"]
            or workspace.get("kind") != "workspace"
        ):
            raise AdmissionError("session_mismatch")
        if not _text(session.get("binding_key")) or not _text(workspace.get("binding_key")):
            raise AdmissionError("binding_key")
        if set(request["resource_scopes"]) - {session["workspace_ref"]}:
            raise AdmissionError("workspace_binding")
        job = registry.get("jobs", request["job_id"])
        hops = None if job is None else job.get("step_hops")
        if not isinstance(hops, dict) or request["step_id"] not in hops:
            raise AdmissionError("hop_assignment")
        if request["hop"] != hops[request["step_id"]]:
            raise AdmissionError("hop_mismatch")
        return session, workspace

    def _resources(self, registry, decision, session, workspace):
        pool = decision["entitlement"]["quota_pool_ref"]
        limits = [
            row["concurrency_limit"]
            for row in registry.snapshot()["entitlements"].values()
            if row["quota_pool_ref"] == pool
        ]
        if not limits:
            raise AdmissionError("missing_pool")
        return [
            {"kind": "job", "key": decision["grant"]["job_id"], "capacity": decision["job"]["max_concurrency"]},
            {
                "kind": "account",
                "key": decision["route"]["account_ref"],
                "capacity": decision["account"]["concurrency_limit"],
            },
            {"kind": "quota_pool", "key": pool, "capacity": min(limits)},
            {"kind": "session", "key": session["binding_key"], "capacity": 1},
            {"kind": "workspace", "key": workspace["binding_key"], "capacity": 1},
        ]

    def _lease_until(self, now, decision):
        lease_until = min(
            now + decision["profile"]["timeout_seconds"],
            decision["grant"]["expires_at"],
            decision["job"]["deadline"],
            decision["entitlement"]["expires_at"],
        )
        if not lease_until > now:
            raise AdmissionError("expired")
        return lease_until

    def _usage(self, job_id, exclude_attempt_id):
        usage = dict(self.store.usage(job_id))
        # The prepared attempt already consumed its one turn. Do not charge it again.
        if exclude_attempt_id is not None:
            usage["turns"] -= 1
        return usage

    def _cancel_unstarted(self, attempt, now):
        evidence = {
            "operation_id": attempt["operation_id"],
            "stopped": True,
            "effects_resolved": True,
            "not_started": True,
        }
        with self.store.transaction():
            current = self.store.attempt(attempt["attempt_id"])
            if current is None or current["state"] != "dispatch_prepared":
                return
            current = self._ensure_lease(current, now)
            self.store.confirm_stop(current["attempt_id"], evidence=evidence, effects_resolved=True, now=now)
            self.store.publish_attempt(current["attempt_id"], current["fence"], "cancelled", now=now)

    def _apply_receipt(self, attempt, receipt, now):
        if not isinstance(receipt, dict) or receipt.get("operation_id") != attempt["operation_id"]:
            return self._mark_unknown(attempt, now)
        status = receipt.get("status")
        with self.store.transaction():
            current = self.store.attempt(attempt["attempt_id"])
            if status == "running":
                if current["state"] == "dispatch_prepared":
                    return self.store.publish_attempt(current["attempt_id"], current["fence"], "running", now=now)
                return current
            if status == "complete":
                return self._complete(current, receipt, now)
            if status == "failed":
                return self._failed(current, receipt, now)
        return self._mark_unknown(attempt, now)

    def _complete(self, attempt, receipt, now):
        current = attempt
        if current["state"] == "dispatch_prepared":
            current = self.store.publish_attempt(current["attempt_id"], current["fence"], "running", now=now)
        if current["state"] in ("running", "outcome_unknown"):
            current = self.store.publish_attempt(
                current["attempt_id"],
                current["fence"],
                "awaiting_review",
                now=now,
                result=receipt.get("result"),
            )
        self._confirm(current, receipt, now, not_started=False)
        return self.store.attempt(attempt["attempt_id"])

    def _failed(self, attempt, receipt, now):
        """A definite native/tool failure is distinct from uncertain execution.

        Failure alone supplies no stop/effects proof and releases no capacity.
        """
        current = attempt
        if current["state"] == "dispatch_prepared":
            current = self.store.publish_attempt(current["attempt_id"], current["fence"], "running", now=now)
        if current["state"] in ("running", "outcome_unknown"):
            current = self.store.publish_attempt(current["attempt_id"], current["fence"], "failed",
                                                 now=now, result=receipt.get("result"))
        self._confirm(current, receipt, now, not_started=False)
        return self.store.attempt(current["attempt_id"])

    def _publish_stop(self, attempt, receipt, now):
        current = attempt
        effects = receipt.get("effects_resolved")
        if effects is True:
            if current["state"] == "running":
                current = self.store.publish_attempt(current["attempt_id"], current["fence"], "stopping", now=now)
            if current["state"] in ("dispatch_prepared", "stopping", "outcome_unknown"):
                current = self.store.publish_attempt(current["attempt_id"], current["fence"], "cancelled", now=now)
            return current
        if current["state"] == "running":
            return self.store.publish_attempt(current["attempt_id"], current["fence"], "stopping", now=now)
        return current

    def _confirm(self, attempt, receipt, now, *, not_started):
        effects = receipt.get("effects_resolved")
        if receipt.get("stopped") is not True or type(effects) is not bool:
            return
        if receipt.get("operation_id") != attempt["operation_id"]:
            return
        evidence = {
            "operation_id": attempt["operation_id"],
            "stopped": True,
            "effects_resolved": effects,
        }
        if not_started:
            evidence["not_started"] = True
        self.store.confirm_stop(attempt["attempt_id"], evidence=evidence, effects_resolved=effects, now=now)

    def _mark_unknown(self, attempt, now):
        self.store.expire_leases(now)
        current = self.store.attempt(attempt["attempt_id"])
        if current is None or current["state"] == "outcome_unknown":
            return current
        if current["state"] not in ("dispatch_prepared", "running", "stopping"):
            return current
        if not _lease_current(current, self.store.controller_epoch, now):
            current = self._ensure_lease(current, now)
        return self.store.publish_attempt(current["attempt_id"], current["fence"], "outcome_unknown", now=now)

    def _ensure_lease(self, attempt, now):
        if _lease_current(attempt, self.store.controller_epoch, now):
            return attempt
        self.store.claim_lease(
            attempt["attempt_id"],
            now=now,
            lease_until=self._lease_from_attempt(attempt, now),
        )
        return self.store.attempt(attempt["attempt_id"])

    def _lease_from_attempt(self, attempt, now):
        # This bounded control lease authorizes observation/stop of an already
        # owned operation. It grants no new execution or model turn and remains
        # available when current admission records are expired/inconsistent.
        return now + 60

    def _registry(self):
        snapshot = {kind: self.store.records(kind) for kind in _KINDS}
        registry = Registry(snapshot, trusted_issuers=self.trusted_issuers)
        return registry

    def _load_grant(self, grant_id):
        row = self.store.get_record("grants", grant_id)
        if row is None:
            raise AdmissionError("missing")
        return row

    def _require_command(self, command_id):
        command = self.store.command(command_id)
        if command is None:
            raise StoreError("unknown command")
        return command

    def _require_attempt(self, attempt_id):
        attempt = self.store.attempt(attempt_id)
        if attempt is None:
            raise StoreError("unknown attempt")
        return attempt

    def _command_for_step(self, job_id, step_id):
        for command in self.store.commands():
            if command["job_id"] == job_id and command["step_id"] == step_id:
                return command
        return None

    def _existing_attempt(self, command_id):
        for attempt in reversed(self.store.attempts()):
            if attempt["command_id"] == command_id:
                return attempt
        return None


def _payload(request):
    payload = dict(request)
    for field in ("grant_id", "grant_revision", "expires_at"):
        payload.pop(field, None)
    return payload


def _route_policy(request):
    policy = {"route_ids": [request["route_id"]], "route_id": request["route_id"]}
    for field in _POLICY_FIELDS:
        policy[field] = request[field]
    return policy


def _require_same_command(existing, payload, policy, worker_id, canonical):
    # Python equality treats True, 1 and 1.0 as equal; immutable JSON does not.
    if (canonical(existing["input_payload"]) != canonical(payload)
            or canonical(existing["route_policy"]) != canonical(policy)
            or existing["worker_id"] != worker_id):
        raise ConflictError("command identity conflict")


def _lease_current(attempt, epoch, now):
    return (
        attempt["controller_epoch"] == epoch
        and attempt["lease_until"] > now
        and not attempt["lease_expired"]
    )


def _prepared_lease_holds(prepared, current, epoch, now):
    return (
        current is not None
        and current["state"] == "dispatch_prepared"
        and current["fence"] == prepared["fence"]
        and current["controller_epoch"] == prepared["controller_epoch"]
        and current["operation_id"] == prepared["operation_id"]
        and _lease_current(current, epoch, now)
    )


def _text(value):
    return isinstance(value, str) and value != ""

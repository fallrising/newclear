"""Manual stale cleanup: real PostgreSQL/HTTP and a pre-effect release fault."""

import copy
import importlib
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest import mock
from uuid import uuid4

from recovery_fixture import Node, Server
from test_control_plane import PlatformFixture

from agent_platform import stale_cleanup
from agent_platform.connector_recovery import STOP_KEYS
from agent_platform.domain import Problem
from agent_platform.stale_cleanup_contract import digest, timestamp
from agent_platform.store import Store
from agent_platform.worker import Worker


class PreEffectNode(Node):
    fail_release = True

    def attach(self, owner, identifier, token):
        handle = super().attach(owner, identifier, token)

        def close():
            if self.fail_release:
                raise TimeoutError("fixture release failed before effect")
            return handle.close()

        return SimpleNamespace(close=close)


class StaleCleanupFixture(PlatformFixture):
    def setUp(self):
        super().setUp()
        self.root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.node = PreEffectNode(self.root)
        self.server = Server(
            self.root, self.project["canonical_repo"], self.payload["base_sha"], self.node
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        profile = self.post("/agent-profiles", {"name": "Stale fixture", "backend": "openhands"})
        self.assertEqual(profile.status_code, 201, profile.text)
        self.payload["profile_revision"] = profile.json()["id"]

    def stalled(self):
        self.node.fail_release = True
        value = self.create()
        run_id = value["run"]["id"]
        self.assertTrue(Worker(self.db, self.connector).run_once())
        self.assertEqual(self.scalar("SELECT state FROM runs WHERE id=%s", (run_id,)), "succeeded")
        self.assertEqual(
            self.scalar("SELECT count(*) FROM result_archives WHERE run_id=%s", (run_id,)), 1
        )
        self.assertIsNotNone(self.scalar("SELECT result FROM runs WHERE id=%s", (run_id,)))
        self.assertEqual(
            self.scalar("SELECT status FROM jobs WHERE run_id=%s", (run_id,)), "interrupted"
        )
        self.assertEqual(
            self.scalar("SELECT cleanup_state FROM runs WHERE id=%s", (run_id,)), "unknown"
        )
        row = self.server.service.journal.read(run_id)
        self.assertEqual(row["operations"]["release"]["state"], "started")
        self.assertNotIn("stale_cleanup", row)
        return run_id

    def expire_clocks(self, run_id):
        # Fixture-only clock movement; lifecycle and generation are never fabricated.
        with self.db.transaction() as conn:
            conn.execute(
                "UPDATE jobs SET lease_until=clock_timestamp()-interval '1 second',"
                "available_at=clock_timestamp()-interval '1 second' WHERE run_id=%s",
                (run_id,),
            )
        journal = self.server.service.fences.journal
        with journal.locked(run_id):
            fence = journal.read(run_id)
            fence["lease_until"] = timestamp(datetime.now(UTC) - timedelta(seconds=1))
            journal.write(fence)

    def preview_cleanup(self, run_id):
        self.expire_clocks(run_id)
        return stale_cleanup.preview(self.db, self.connector, run_id=run_id)

    def apply_cleanup(self, plan):
        self.node.fail_release = False
        return stale_cleanup.apply(
            self.db, self.connector, plan, approval_digest=plan["approval_digest"]
        )

    def reconcile_cleanup(self, run_id):
        self.assertTrue(Worker(self.db, self.connector).run_once())
        self.assertEqual(
            self.scalar("SELECT cleanup_state FROM runs WHERE id=%s", (run_id,)), "confirmed"
        )

    def row(self, run_id):
        return self.server.service.journal.read(run_id)

    def save(self, row):
        self.server.service.journal.write(row)

    def resign(self, plan):
        plan["approval_digest"] = digest({k: v for k, v in plan.items() if k != "approval_digest"})
        return plan

    def age_plan(self, plan, expires):
        original = plan["approval_digest"]
        aged = copy.deepcopy(plan)
        aged["created_at"] = timestamp(expires - timedelta(hours=1))
        aged["expires_at"] = timestamp(expires)
        self.resign(aged)
        row = self.row(plan["run_id"])
        del row["stale_cleanup"]["issued_plans"][original]
        row["stale_cleanup"]["issued_plans"][aged["approval_digest"]] = aged
        self.save(row)
        return aged


class StaleCleanupTests(StaleCleanupFixture):
    def test_legacy_terminal_pre_effect_release_can_be_cleaned(self):
        run_id = self.stalled()
        # Reach the new missing boundary only after the real lifecycle fault.
        cleanup = importlib.import_module("agent_platform.stale_cleanup")
        self.assertTrue(callable(cleanup.preview))
        self.assertTrue(callable(cleanup.apply))
        old = self.row(run_id)
        result = self.scalar("SELECT result FROM runs WHERE id=%s", (run_id,))
        archive_hash = self.scalar("SELECT sha256 FROM result_archives WHERE run_id=%s", (run_id,))
        plan = self.preview_cleanup(run_id)
        self.assertEqual(self.row(run_id)["operations"], old["operations"])
        self.assertEqual(self.node.calls["release"], 0)
        receipt = self.apply_cleanup(plan)
        self.assertEqual(receipt["status"], "stop_observed; reconciliation_pending")
        self.assertEqual(self.node.calls["release"], 1)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "interrupted")
        self.assertEqual(self.apply_cleanup(plan), receipt)
        self.reconcile_cleanup(run_id)
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.apply_cleanup(plan), receipt)
        self.assertEqual(self.node.calls["release"], 1)
        self.assertEqual(self.row(run_id)["operations"], old["operations"])
        self.assertEqual(self.scalar("SELECT result FROM runs WHERE id=%s", (run_id,)), result)
        self.assertEqual(
            self.scalar("SELECT sha256 FROM result_archives WHERE run_id=%s", (run_id,)),
            archive_hash,
        )

    def test_preview_live_lease_and_fence_are_not_stolen(self):
        run_id = self.stalled()
        before = self.row(run_id)
        with self.assertRaises(Problem):
            stale_cleanup.preview(self.db, self.connector, run_id=run_id)
        self.assertEqual(self.row(run_id), before)
        self.assertEqual(self.node.calls["release"], 0)

    def test_identity_enrollment_is_atomic_and_reopening_preserves_it(self):
        run_id = self.stalled()
        self.expire_clocks(run_id)
        real = self.server.service.journal.write

        def after_write(row):
            real(row)
            if "stale_cleanup" in row:
                raise RuntimeError("injected response loss after fsync")

        with mock.patch.object(self.server.service.journal, "write", side_effect=after_write):
            with self.assertRaises(Problem):
                stale_cleanup.preview(self.db, self.connector, run_id=run_id)
        first = self.row(run_id)["stale_cleanup"]
        plan = self.preview_cleanup(run_id)
        self.assertEqual(first["connector_cleanup_identity"], plan["connector_cleanup_identity"])
        self.assertEqual(len(self.row(run_id)["stale_cleanup"]["issued_plans"]), 2)
        self.assertEqual(len(list(self.server.service.journal.root.glob("*.json"))), 1)

    def test_missing_or_malformed_enrollment_never_rotates_identity(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        original = self.row(run_id)
        for mode in ("missing", "null", "changed", "version", "emptyplans", "orphan"):
            changed = copy.deepcopy(original)
            env = changed["stale_cleanup"]
            if mode == "missing":
                del env["connector_cleanup_identity"]
            elif mode == "null":
                env["connector_cleanup_identity"] = None
            elif mode == "changed":
                env["connector_cleanup_identity"] = str(uuid4())
            elif mode == "version":
                env["schema_version"] = "future"
            elif mode == "emptyplans":
                env["issued_plans"] = {}
            else:
                del changed["stale_cleanup"]
                changed["cleanup_attempts"] = {"orphan": True}
            self.save(changed)
            with self.subTest(mode=mode):
                with self.assertRaises(Problem):
                    self.preview_cleanup(run_id)
                with self.assertRaises(Problem):
                    self.apply_cleanup(plan)
                self.assertEqual(self.row(run_id), changed)
        self.save(original)
        self.assertEqual(self.node.calls["release"], 0)

    def test_root_token_empty_token_and_changed_observation_are_refused(self):
        run_id = self.stalled()
        original = self.row(run_id)
        root_token = Path(self.server.config["sandbox_token_file"]).read_text()
        for token in ("", root_token):
            row = copy.deepcopy(original)
            row["handle"]["token"] = token
            self.save(row)
            with self.assertRaises(Problem):
                self.preview_cleanup(run_id)
        self.save(original)
        self.node.swapped = True
        with self.assertRaises(Problem):
            self.preview_cleanup(run_id)
        self.node.swapped = False
        self.assertEqual(self.node.calls["release"], 0)

    def test_every_live_host_and_claim_identity_mismatch_refuses_without_deletion(self):
        run_id = self.stalled()
        identifier = self.row(run_id)["handle"]["id"]
        original = copy.deepcopy(self.node.rows[identifier])
        changes = [
            ("vm_id", "different-vm"),
            ("image_digest", "f" * 64),
            ("cpu", 8),
            ("memory_bytes", 123),
            ("run_dir", "/fixture/other"),
            ("scope", "/fixture/other-scope"),
            ("identity", {"pid": 999, "start_ticks": 123, "state": "S"}),
            ("identity", {"pid": 100, "start_ticks": 999, "state": "S"}),
        ]
        for key, value in changes:
            with self.subTest(key=key, value=value):
                self.node.rows[identifier] = copy.deepcopy(original)
                self.node.rows[identifier]["observed"][key] = value
                with self.assertRaises(Problem):
                    self.preview_cleanup(run_id)
        for key, value in (
            ("id", "unknown"),
            ("claim_ref", "foreign"),
            ("key", {"template": "foreign", "net": "none", "size": "large"}),
        ):
            self.node.rows[identifier] = copy.deepcopy(original)
            self.node.rows[identifier]["claim"][key] = value
            with self.subTest(claim_key=key), self.assertRaises(Problem):
                self.preview_cleanup(run_id)
        self.node.rows[identifier] = original
        self.assertEqual(self.node.calls["release"], 0)

    def test_unknown_vm_is_untouched_and_partition_or_absent_claim_residue_is_held(self):
        run_id = self.stalled()
        identifier = self.row(run_id)["handle"]["id"]
        unknown = self.node.new(
            self.server.config["template"],
            net="none",
            size="large",
            ttl_seconds=180,
            claim_ref="unknown",
            deadline=0,
        )
        foreign = copy.deepcopy(self.node.rows[unknown.id])
        self.node.partition = True
        with self.assertRaises(Problem):
            self.preview_cleanup(run_id)
        self.node.partition = False
        plan = self.preview_cleanup(run_id)
        # A claim can disappear before its original host resources are confirmed gone.
        self.node.rows[identifier]["alive"] = False
        self.node.partial_removal = True
        with self.assertRaises(Problem):
            self.apply_cleanup(plan)
        self.assertEqual(self.node.calls["release"], 0)
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        self.assertEqual(self.node.rows[unknown.id], foreign)
        self.node.partial_removal = False
        self.reconcile_cleanup(run_id)
        self.assertEqual(self.node.calls["release"], 0)
        self.assertEqual(self.node.rows[unknown.id], foreign)

    def test_missing_handle_observation_and_uncertain_allocation_cannot_enroll(self):
        run_id = self.stalled()
        original = self.row(run_id)
        for key in ("handle", "observed", "allocate"):
            changed = copy.deepcopy(original)
            if key == "allocate":
                changed["operations"]["allocate"]["state"] = "started"
            else:
                del changed[key]
            self.save(changed)
            with self.subTest(key=key), self.assertRaises(Problem):
                self.preview_cleanup(run_id)
            self.assertNotIn("stale_cleanup", self.row(run_id))
        self.save(original)
        self.assertEqual(self.node.calls["release"], 0)

    def test_private_journal_and_fence_missing_or_oversized_are_refused(self):
        run_id = self.stalled()
        journal = self.server.service.journal.root / f"{run_id}.json"
        fence = self.server.service.fences.journal.root / f"{run_id}.json"
        self.expire_clocks(run_id)
        for path in (journal, fence):
            raw = path.read_bytes()
            path.unlink()
            try:
                with self.assertRaises(Problem):
                    stale_cleanup.preview(self.db, self.connector, run_id=run_id)
            finally:
                path.write_bytes(raw)
                path.chmod(0o600)
        raw = journal.read_bytes()
        journal.write_bytes(b" " * (8 * 1024 * 1024 + 1))
        try:
            with self.assertRaises(Problem):
                stale_cleanup.preview(self.db, self.connector, run_id=run_id)
        finally:
            journal.write_bytes(raw)
        self.assertEqual(self.node.calls["release"], 0)

    def test_expired_changed_forged_and_wrong_identity_plans_do_not_admit(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        generation = self.scalar("SELECT generation FROM runs")
        for key, value in (
            ("current_generation", True),
            ("next_generation", 1.5),
            ("maintenance_id", str(uuid4())),
            ("attempt_id", str(uuid4())),
            ("archive_sha256", "f" * 64),
            ("provider_handle", "unknown"),
        ):
            changed = copy.deepcopy(plan)
            changed[key] = value
            self.resign(changed)
            with self.subTest(key=key), self.assertRaises(Problem):
                self.apply_cleanup(changed)
        with self.assertRaises(Problem):
            stale_cleanup.apply(self.db, self.connector, plan, approval_digest="0" * 64)
        expired = self.age_plan(plan, datetime.now(UTC) - timedelta(seconds=1))
        with self.assertRaises(Problem):
            self.apply_cleanup(expired)
        self.assertEqual(self.scalar("SELECT generation FROM runs"), generation)
        self.assertEqual(self.node.calls["release"], 0)

    def test_changed_db_preconditions_fail_before_lease_transfer(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        with self.db.transaction() as conn:
            conn.execute("UPDATE resource_reservations SET cpu=cpu+1")
        generation = self.scalar("SELECT generation FROM runs")
        with self.assertRaises(Problem):
            self.apply_cleanup(plan)
        self.assertEqual(self.scalar("SELECT generation FROM runs"), generation)
        self.assertEqual(self.node.calls["release"], 0)

    def test_admission_audit_failure_rolls_back_all_owned_state(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        before = self.scalar("SELECT to_jsonb(r) FROM runs r")
        with mock.patch.object(
            stale_cleanup, "audit", side_effect=RuntimeError("fixture commit fault")
        ):
            with self.assertRaises(RuntimeError):
                self.apply_cleanup(plan)
        self.assertEqual(self.scalar("SELECT to_jsonb(r) FROM runs r"), before)
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "interrupted")
        self.assertEqual(self.node.calls["release"], 0)
        self.assertEqual(self.row(run_id)["stale_cleanup"]["attempts"], {})

    def test_missing_or_newer_fence_after_preview_never_rebuilds_or_advances_db(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        path = self.server.service.fences.journal.root / f"{run_id}.json"
        raw = path.read_bytes()
        generation = self.scalar("SELECT generation FROM runs")
        path.unlink()
        with self.assertRaises(Problem):
            self.apply_cleanup(plan)
        self.assertFalse(path.exists())
        self.assertEqual(self.scalar("SELECT generation FROM runs"), generation)
        path.write_bytes(raw)
        path.chmod(0o600)
        fence = self.server.service.fences.journal.read(run_id)
        fence["generation"] += 2
        self.server.service.fences.journal.write(fence)
        with self.assertRaises(Problem):
            self.apply_cleanup(plan)
        self.assertEqual(self.scalar("SELECT generation FROM runs"), generation)
        self.assertEqual(self.server.service.fences.journal.read(run_id), fence)

    def kill_helper(self, payload):
        ready = self.root / "crash-ready"
        ready.unlink(missing_ok=True)
        payload.update(ready=str(ready))
        path = self.root / "crash-input.json"
        path.write_text(json.dumps(payload))
        path.chmod(0o600)
        with (self.root / "crash-output").open("w+") as output:
            child = subprocess.Popen(
                [
                    sys.executable,
                    str(Path(__file__).with_name("stale_cleanup_crash.py")),
                    str(path),
                ],
                stdout=output,
                stderr=output,
            )
            try:
                deadline = time.monotonic() + 10
                while not ready.exists():
                    if child.poll() is not None or time.monotonic() > deadline:
                        output.seek(0)
                        self.fail("child missed kill boundary: " + output.read())
                    time.sleep(0.02)
                child.kill()
                self.assertEqual(child.wait(timeout=5), -9)
            finally:
                if child.poll() is None:
                    child.kill()
                    child.wait(timeout=5)

    def reopen_server(self):
        self.server = Server(
            self.root, self.project["canonical_repo"], self.payload["base_sha"], self.node
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client

    def test_real_sigkill_before_connector_intent_recovers_generation_without_reset(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        self.kill_helper(
            {
                "phase": "admission-before-intent",
                "plan": plan,
                "origin": self.server.origin,
                "connector_token": Path(self.server.config["connector_token_file"]).read_text(),
            }
        )
        self.assertEqual(self.scalar("SELECT generation FROM runs"), plan["next_generation"])
        self.assertEqual(self.row(run_id)["generation"], plan["current_generation"])
        self.expire_clocks(run_id)
        worker = Worker(self.db, self.connector)
        worker.reconcile_expired()
        worker.run_once()
        current = self.scalar("SELECT generation FROM runs")
        self.assertGreater(current, plan["next_generation"])
        self.assertEqual(self.row(run_id)["generation"], current)
        self.assertEqual(self.node.calls["release"], 0)
        fresh = self.preview_cleanup(run_id)
        self.apply_cleanup(fresh)
        self.reconcile_cleanup(run_id)

    def test_real_sigkill_enrollment_boundaries_preserve_legacy_or_same_identity(self):
        for phase in ("enrollment-before", "enrollment-after"):
            with self.subTest(phase=phase):
                run_id = self.stalled()
                self.expire_clocks(run_id)
                captured = {}

                def capture(identifier, context, captured=captured):
                    captured.update(context)
                    raise RuntimeError("capture actual DB preview context")

                with mock.patch.object(self.connector, "cleanup_preview", side_effect=capture):
                    with self.assertRaises(RuntimeError):
                        stale_cleanup.preview(self.db, self.connector, run_id=run_id)
                config = dict(self.server.config)
                self.server.close()
                self.kill_helper(
                    {
                        "phase": phase,
                        "run_id": run_id,
                        "context": captured,
                        "config": config,
                        "rows": self.node.rows,
                        "calls": self.node.calls,
                    }
                )
                self.reopen_server()
                before = self.row(run_id).get("stale_cleanup")
                if phase == "enrollment-before":
                    self.assertIsNone(before)
                else:
                    self.assertTrue(before["issued_plans"])
                plan = self.preview_cleanup(run_id)
                if before:
                    self.assertEqual(
                        plan["connector_cleanup_identity"], before["connector_cleanup_identity"]
                    )
                self.apply_cleanup(plan)
                self.reconcile_cleanup(run_id)

    def test_real_sigkill_intent_and_effect_boundaries_never_repeat_request(self):
        for phase in ("attempt-after-intent", "effect-before-receipt"):
            with self.subTest(phase=phase):
                run_id = self.stalled()
                plan = self.preview_cleanup(run_id)
                current = self.scalar("SELECT generation FROM runs WHERE id=%s", (run_id,))
                lookup = self.connector.cleanup_lookup(
                    plan, generation=current, lease_until=None, resume=False
                )
                db_digest = stale_cleanup.admit(self.db, plan, lookup["operations_digest"])
                with self.db.transaction() as conn:
                    run = conn.execute(
                        "SELECT r.*,j.lease_until FROM runs r JOIN jobs j ON j.run_id=r.id "
                        "WHERE r.id=%s",
                        (run_id,),
                    ).fetchone()
                self.connector.cleanup_fence(plan, run)
                config = dict(self.server.config)
                state = self.root / "durable-upstream.json"
                state.unlink(missing_ok=True)
                before = self.node.calls["release"]
                self.server.close()
                self.kill_helper(
                    {
                        "phase": phase,
                        "run_id": run_id,
                        "plan": plan,
                        "db_digest": db_digest,
                        "config": config,
                        "rows": self.node.rows,
                        "calls": self.node.calls,
                        "upstream_state": str(state),
                    }
                )
                if state.exists():
                    upstream = json.loads(state.read_text())
                    self.node.rows, self.node.calls = upstream["rows"], upstream["calls"]
                self.reopen_server()
                self.assertEqual(len(self.row(run_id)["stale_cleanup"]["attempts"]), 1)
                receipt = self.apply_cleanup(plan)
                self.assertEqual(
                    self.node.calls["release"], before + (phase == "effect-before-receipt")
                )
                if phase == "attempt-after-intent":
                    self.assertEqual(receipt["status"], "unknown")
                    self.expire_clocks(run_id)
                    worker = Worker(self.db, self.connector)
                    worker.reconcile_expired()
                    fresh = self.preview_cleanup(run_id)
                    self.apply_cleanup(fresh)
                else:
                    self.assertEqual(receipt["status"], "stop_observed; reconciliation_pending")
                    # Replay only observes; expired DB ownership is reclaimed by recovery.
                    self.expire_clocks(run_id)
                    Worker(self.db, self.connector).reconcile_expired()
                self.reconcile_cleanup(run_id)

    def test_active_control_missing_result_and_inconsistent_binding_are_ineligible(self):
        run_id = self.stalled()
        changes = [
            ("UPDATE runs SET state=%s", (state,))
            for state in (
                "queued",
                "running",
                "interrupted",
                "finalizing",
                "cancelling",
                "paused",
                "cancelled",
            )
        ] + [
            ("UPDATE runs SET control_action='pause'", ()),
            ("UPDATE runs SET result=NULL", ()),
            ("UPDATE sandbox_bindings SET generation=generation+1", ()),
            ("UPDATE sandbox_bindings SET provider_handle='pending:fixture'", ()),
            ("UPDATE resource_reservations SET released_at=clock_timestamp()", ()),
        ]
        # Roll back every negative fixture, retaining the actual principal lifecycle.
        for statement, params in changes:
            with self.subTest(statement=statement, params=params):
                with self.db.transaction() as conn:
                    conn.execute(statement, params)
                    from agent_platform.stale_cleanup import eligibility, snapshot

                    with self.assertRaises(Problem):
                        eligibility(snapshot(conn, run_id))
                    conn.rollback()
        self.assertEqual(self.node.calls["release"], 0)

    def test_lost_reply_and_each_partial_stop_proof_keep_capacity_until_recovery(self):
        for key in sorted(STOP_KEYS):
            with self.subTest(key=key):
                run_id = self.stalled()
                plan = self.preview_cleanup(run_id)
                self.node.missing_stop_key = key
                self.node.lose = "release"
                before = self.node.calls["release"]
                self.assertEqual(self.apply_cleanup(plan)["status"], "unknown")
                self.assertEqual(self.apply_cleanup(plan)["status"], "unknown")
                self.assertEqual(self.node.calls["release"], before + 1)
                self.assertEqual(Store(self.db).runtime()["occupied"], 1)
                self.node.missing_stop_key = None
                self.node.lose = None
                self.assertEqual(
                    self.apply_cleanup(plan)["status"], "stop_observed; reconciliation_pending"
                )
                self.reconcile_cleanup(run_id)

    def test_same_attempt_intent_before_effect_never_retries_and_new_approval_can_stop(self):
        run_id = self.stalled()
        first = self.preview_cleanup(run_id)
        # Initial approved attempt reaches the same real pre-effect upstream failure.
        self.assertEqual(
            stale_cleanup.apply(
                self.db, self.connector, first, approval_digest=first["approval_digest"]
            )["status"],
            "unknown",
        )
        self.node.fail_release = False
        self.assertEqual(self.apply_cleanup(first)["status"], "unknown")
        self.assertEqual(self.node.calls["release"], 0)
        second = self.preview_cleanup(run_id)
        self.assertNotEqual(first["attempt_id"], second["attempt_id"])
        self.assertEqual(first["connector_cleanup_identity"], second["connector_cleanup_identity"])
        self.assertEqual(
            self.apply_cleanup(second)["status"], "stop_observed; reconciliation_pending"
        )
        self.assertEqual(len(self.row(run_id)["stale_cleanup"]["attempts"]), 2)
        self.reconcile_cleanup(run_id)

    def test_tombstone_blocks_every_guard_mode_but_allows_inspection_and_stopping(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        self.apply_cleanup(plan)
        # Acquire a normal, committed recovery lease to exercise actual guard fencing.
        worker = Worker(self.db, self.connector)
        claim = worker.claim()
        with worker.owned(claim) as (_, run):
            self.connector.fence(run)
        row = self.server.service.require(run_id, claim["generation"])
        for controlling in (False, True):
            with self.assertRaises(Problem):
                self.server.service.guard(row, controlling=controlling)
        self.server.service.guard(row, stopping=True)
        self.assertEqual(self.connector.inspect(run)["phase"], "stopped")
        worker.execute(claim)

    def test_concurrent_duplicate_apply_sends_one_request(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        self.node.fail_release = False

        def execute():
            try:
                return stale_cleanup.apply(
                    self.db, self.connector, plan, approval_digest=plan["approval_digest"]
                )
            except Problem:
                return None

        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: execute(), range(4)))
        self.assertTrue(any(r and r["status"].startswith("stop_observed") for r in results))
        self.assertEqual(self.node.calls["release"], 1)
        self.assertEqual(
            self.scalar(
                "SELECT count(*) FROM audit_events WHERE action='runtime.stale_cleanup_admitted'"
            ),
            1,
        )
        self.reconcile_cleanup(run_id)

    def test_recovery_winner_invalidates_old_plan_without_release(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        worker = Worker(self.db, self.connector)
        claim = worker.claim()
        with self.assertRaises(Problem):
            self.apply_cleanup(plan)
        worker.execute(claim)
        self.assertEqual(self.node.calls["release"], 0)
        fresh = self.preview_cleanup(run_id)
        self.assertEqual(
            self.apply_cleanup(fresh)["status"], "stop_observed; reconciliation_pending"
        )

    def test_expiry_after_db_lock_wait_is_rechecked_against_actual_db_clock(self):
        run_id = self.stalled()
        plan = self.age_plan(self.preview_cleanup(run_id), datetime.now(UTC) + timedelta(seconds=3))
        ready = threading.Event()
        real = stale_cleanup.admit

        def admitting(*args, **kwargs):
            ready.set()
            return real(*args, **kwargs)

        with self.db.transaction() as conn:
            conn.execute("SELECT id FROM jobs WHERE run_id=%s FOR UPDATE", (run_id,))
            with mock.patch.object(stale_cleanup, "admit", side_effect=admitting):
                with ThreadPoolExecutor(max_workers=1) as pool:
                    future = pool.submit(self.apply_cleanup, plan)
                    self.assertTrue(ready.wait(3))
                    deadline = time.monotonic() + 5
                    while conn.execute("SELECT clock_timestamp() AS now").fetchone()[
                        "now"
                    ] < datetime.fromisoformat(plan["expires_at"]):
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(0.02)
                    conn.commit()
                    with self.assertRaises(Problem):
                        future.result(timeout=5)
        self.assertEqual(self.node.calls["release"], 0)

    def test_takeover_while_cleanup_waits_for_connector_lock_fences_before_intent(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        ready, proceed = threading.Event(), threading.Event()
        original = self.connector.cleanup_apply

        def before_rpc(*args, **kwargs):
            ready.set()
            if not proceed.wait(5):
                raise RuntimeError("fixture barrier expired")
            return original(*args, **kwargs)

        self.node.fail_release = False
        with mock.patch.object(self.connector, "cleanup_apply", side_effect=before_rpc):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(
                    stale_cleanup.apply,
                    self.db,
                    self.connector,
                    plan,
                    approval_digest=plan["approval_digest"],
                )
                self.assertTrue(ready.wait(5))
                with self.server.service.journal.locked(run_id):
                    proceed.set()
                    self.expire_clocks(run_id)
                    worker = Worker(self.db, self.connector)
                    worker.reconcile_expired()
                    claim = worker.claim()
                    with worker.owned(claim) as (_, run):
                        self.connector.fence(run)
                with self.assertRaises(Problem):
                    future.result(timeout=5)
        self.assertEqual(self.node.calls["release"], 0)
        self.assertEqual(self.row(run_id)["stale_cleanup"]["attempts"], {})
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "leased")
        worker.execute(claim)

    def test_expiry_while_waiting_for_connector_lock_refuses_before_intent(self):
        run_id = self.stalled()
        plan = self.age_plan(self.preview_cleanup(run_id), datetime.now(UTC) + timedelta(seconds=3))
        ready, proceed = threading.Event(), threading.Event()
        original = self.connector.cleanup_apply

        def before_rpc(*args, **kwargs):
            ready.set()
            if not proceed.wait(5):
                raise RuntimeError("fixture barrier expired")
            return original(*args, **kwargs)

        with mock.patch.object(self.connector, "cleanup_apply", side_effect=before_rpc):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.apply_cleanup, plan)
                self.assertTrue(ready.wait(5))
                with self.server.service.journal.locked(run_id):
                    proceed.set()
                    deadline = time.monotonic() + 5
                    while datetime.now(UTC) < datetime.fromisoformat(plan["expires_at"]):
                        self.assertLess(time.monotonic(), deadline)
                        time.sleep(0.02)
                with self.assertRaises(Problem):
                    future.result(timeout=5)
        self.assertEqual(self.node.calls["release"], 0)
        self.assertEqual(self.row(run_id)["stale_cleanup"]["attempts"], {})

    def test_takeover_after_effect_cannot_be_overwritten_by_old_completion(self):
        run_id = self.stalled()
        plan = self.preview_cleanup(run_id)
        observed, proceed = threading.Event(), threading.Event()
        original = self.server.service.journal.write

        def after_receipt(row):
            original(row)
            value = row.get("stale_cleanup")
            if value and any(a["receipt"] for a in value["attempts"].values()):
                observed.set()
                if not proceed.wait(5):
                    raise RuntimeError("fixture barrier expired")

        with mock.patch.object(self.server.service.journal, "write", side_effect=after_receipt):
            with ThreadPoolExecutor(max_workers=1) as pool:
                future = pool.submit(self.apply_cleanup, plan)
                self.assertTrue(observed.wait(5))
                self.expire_clocks(run_id)
                worker = Worker(self.db, self.connector)
                worker.reconcile_expired()
                claim = worker.claim()
                with worker.owned(claim) as (_, run):
                    self.connector.fence(run)
                proceed.set()
                self.assertEqual(
                    future.result(timeout=5)["status"], "stop_observed; reconciliation_pending"
                )
        self.assertEqual(self.scalar("SELECT status FROM jobs"), "leased")
        self.assertEqual(self.scalar("SELECT generation FROM runs"), claim["generation"])
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        worker.execute(claim)
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertEqual(self.node.calls["release"], 1)

    def test_private_cli_preview_apply_and_strict_plan_file(self):
        run_id = self.stalled()
        self.expire_clocks(run_id)
        env = dict(
            os.environ,
            DATABASE_URL=os.environ["TEST_DATABASE_URL"],
            CONNECTOR_ORIGIN=self.server.origin,
            CONNECTOR_TOKEN_FILE=self.server.config["connector_token_file"],
        )

        def cli(*args):
            return subprocess.run(
                [sys.executable, "-m", "agent_platform.cli", *args],
                env=env,
                text=True,
                capture_output=True,
                timeout=15,
            )

        preview = cli("stale-cleanup-preview", "--run-id", run_id)
        self.assertEqual(preview.returncode, 0, preview.stderr)
        plan = json.loads(preview.stdout)
        path = self.root / "plan.json"
        path.write_text(json.dumps(plan))
        path.chmod(0o600)
        self.node.fail_release = False
        applied = cli(
            "stale-cleanup-apply", "--plan", str(path), "--approve", plan["approval_digest"]
        )
        self.assertEqual(applied.returncode, 0, applied.stderr)
        self.assertEqual(
            json.loads(applied.stdout)["status"], "stop_observed; reconciliation_pending"
        )
        path.write_text('{"x":1,"x":2}')
        invalid = cli(
            "stale-cleanup-apply", "--plan", str(path), "--approve", plan["approval_digest"]
        )
        self.assertEqual(invalid.returncode, 1)
        self.assertNotIn("secret", invalid.stderr)

    def test_private_http_auth_origin_duplicate_keys_and_body_cap(self):
        run_id = self.stalled()
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def send(raw, *, auth=True, origin=None):
            headers = {"Content-Type": "application/json"}
            if auth:
                headers["X-Session-API-Key"] = self.server.service.token
            if origin is not None:
                headers["Origin"] = origin
            request = urllib.request.Request(
                self.server.origin + f"/v1/runs/{run_id}/cleanup-lookup",
                data=raw,
                headers=headers,
                method="POST",
            )
            try:
                with opener.open(request, timeout=5) as response:
                    return response.status, response.read()
            except urllib.error.HTTPError as exc:
                return exc.code, exc.read()

        self.assertEqual(send(b"{}", auth=False)[0], 401)
        self.assertEqual(send(b"{}", origin="https://foreign.invalid")[0], 403)
        self.assertEqual(send(b'{"plan":{},"plan":{}}')[0], 409)
        self.assertEqual(send(b" " * 65537)[0], 413)
        self.assertEqual(self.node.calls["release"], 0)

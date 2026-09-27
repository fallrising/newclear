"""AT-07 partial: untrusted output, real HTTP/DB boundaries and no false completion."""

import copy
import hashlib
import json
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path
from types import SimpleNamespace

from recovery_fixture import FixtureConnector, Server
from test_control_plane import PlatformFixture

from agent_platform.connector import Connector
from agent_platform.connector_approval import pending_approval
from agent_platform.connector_output import VERIFICATION_REASON, OutputPolicy, workspace_result
from agent_platform.domain import Problem
from agent_platform.store import Store
from agent_platform.worker import Worker


def result(row, diff="diff with Unicode 文字 and <script>alert(1)</script>\n"):
    return {
        "base_sha": row["input"]["base_sha"],
        "diff": diff,
        "diff_sha256": hashlib.sha256(diff.encode()).hexdigest(),
        "diff_bytes": len(diff.encode()),
        "verification": {
            "status": "passed",
            "name": "m2_fixture_workspace_assertion",
            "exit_code": 0,
            "reason": VERIFICATION_REASON,
        },
        "workspace_value": row["run_id"] + "\n",
    }


class OutputPolicyTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "run_id": "fixture-run",
            "input": {"base_sha": "a" * 40, "require_approval": True},
            "generation": 1,
            "session_key": 'session-"秘密\\canary',
            "handle": {"token": "sandbox-canary"},
        }
        self.service = SimpleNamespace(
            token="connector-canary", client=SimpleNamespace(api_token="node-canary")
        )
        self.policy = OutputPolicy(self.service, self.row)

    def test_decoded_nested_keys_values_and_truncation_boundary(self):
        for secret in self.policy.secrets:
            with self.subTest(credential_length=len(secret)):
                value = json.loads(json.dumps({secret: ["x" * 15995 + secret + "tail"]}))
                clean = self.policy.redact(value)
                self.assertFalse(self.policy.sensitive(clean))
                self.assertEqual(list(clean), ["[redacted]"])
                self.assertTrue(clean["[redacted]"][0].endswith("[redacted]tail"))
                with self.assertRaisesRegex(Problem, "sensitive"):
                    self.policy.require_safe(value, "sensitive")

    def test_valid_unicode_patch_retains_exact_bytes_and_hash(self):
        value = result(self.row)
        actual = workspace_result(json.dumps(value), self.row, self.policy)
        for key in value:
            self.assertEqual(actual[key], value[key])
        self.assertEqual(actual["execution_mode"], "cocoon-fixture")
        value.update(workspace_value=None)
        value["verification"].update(status="failed", exit_code=1)
        self.assertEqual(
            workspace_result(json.dumps(value), self.row, self.policy)["verification"]["status"],
            "failed",
        )

    def test_forged_or_unbounded_result_rejected(self):
        value = result(self.row)
        attacks = [
            None,
            [],
            {**value, "summary": "forged host summary"},
            {**value, "execution_mode": "real-provider"},
            {**value, "base_sha": "b" * 40},
            {**value, "diff_sha256": "0" * 64},
            {**value, "diff_bytes": True},
            {**value, "diff_bytes": len(value["diff"])},
            {**value, "diff": "\ud800"},
            result(self.row, "x" * (256 * 1024 + 1)),
            {**value, "workspace_value": "forged run\n"},
        ]
        for field, attack in (
            ("status", "success"),
            ("exit_code", False),
            ("name", "repository tests"),
            ("reason", "forged"),
        ):
            altered = copy.deepcopy(value)
            altered["verification"][field] = attack
            attacks.append(altered)
        for n, attack in enumerate(attacks):
            with self.subTest(attack=n), self.assertRaises(Problem):
                workspace_result(json.dumps(attack), self.row, self.policy)
        with self.assertRaisesRegex(Problem, "too_large"):
            workspace_result("x" * (2 * 1024 * 1024 + 1), self.row, self.policy)

    def test_secret_in_any_result_field_rejected_without_rewriting_patch(self):
        for secret in self.policy.secrets:
            for field in ("diff", "base_sha", "workspace_value", "diff_sha256"):
                value = result(self.row, secret) if field == "diff" else result(self.row)
                value[field] = secret
                with self.assertRaisesRegex(Problem, "backend_sensitive_result"):
                    workspace_result(json.dumps(value), self.row, self.policy)

    def test_approval_checks_decoded_params_and_node_credential_without_changing_digest(self):
        for secret in self.policy.secrets:

            @contextmanager
            def relay(row, secret=secret):
                class HTTP:
                    def expect(self, method, path):
                        if "/events/search" in path:
                            return {
                                "items": [
                                    {
                                        "id": "action-1",
                                        "kind": "ActionEvent",
                                        "tool_name": "terminal",
                                        "tool_call_id": "call-1",
                                        "action": {"command": "echo " + secret},
                                    }
                                ]
                            }
                        return {
                            "id": row["run_id"],
                            "execution_status": "waiting_for_confirmation",
                            "confirmation_policy": {"kind": "AlwaysConfirm"},
                            "leaf_event_id": "action-1",
                        }

                yield HTTP()

            self.service.relay = relay
            self.service.conversation = lambda row, http: http.expect("GET", "/conversation")
            with self.assertRaisesRegex(Problem, "approval_sensitive_parameters"):
                pending_approval(self.service, self.row)


class SecurityConnector(FixtureConnector):
    mode = "events"

    def prepare(self, row):
        value = super().prepare(row)
        self.client.api_token = 'node-"escaped\\秘密-canary'
        return value

    def handle(self, row):
        handle = super().handle(row)

        def execute(*args, **kwargs):
            value = result(row)
            if self.mode == "result_secret":
                value = result(row, self.client.api_token)
            elif self.mode == "result_forged":
                value["diff_sha256"] = "0" * 64
            return json.dumps(value)

        handle.exec = execute
        return handle

    result = Connector.result

    @contextmanager
    def relay(self, row):
        service = self
        policy = OutputPolicy(self, row)

        class HTTP:
            def expect(self, method, path):
                if "/events/search" in path:
                    event = {
                        "id": "event-1",
                        "kind": "ObservationEvent",
                        "observation": {
                            "output": list(policy.secrets),
                            service.client.api_token: "nested key",
                        },
                    }
                    if service.mode in {"id", "kind"}:
                        event[service.mode] = service.client.api_token
                    return {"items": [event]}
                return {"id": row["run_id"], "execution_status": "finished"}

        yield HTTP()


class OutputBoundaryTests(PlatformFixture):
    def setUp(self):
        super().setUp()
        root = Path(self.enterContext(tempfile.TemporaryDirectory()))
        self.server = Server(
            root,
            self.project["canonical_repo"],
            self.payload["base_sha"],
            connector_type=SecurityConnector,
        )
        self.addCleanup(self.server.close)
        self.connector = self.server.client
        self.connector.register(self.db)
        self.payload["profile_revision"] = self.post(
            "/agent-profiles",
            {
                "name": "Security fixture",
                "backend": "openhands",
                "verification": {
                    "mode": "fixture-m2",
                    "revision": "fixture-m2-v1",
                    "checks": [],
                },
            },
        ).json()["id"]

    def execute(self, mode):
        self.server.service.mode = mode
        run = self.create()["run"]
        Worker(self.db, self.connector).run_once()
        row = self.server.service.journal.read(run["id"])
        secrets = OutputPolicy(self.server.service, row).secrets
        for table in ("runs", "run_events", "approvals", "audit_events"):
            with self.db.transaction() as conn:
                rows = conn.execute("SELECT row_to_json(t)::text AS value FROM " + table + " t")
                raw = " ".join(r["value"] for r in rows)
                # Decode/serialize escaping can differ. Recursively scan JSON rows as well.
                for item in conn.execute("SELECT row_to_json(t) AS value FROM " + table + " t"):
                    self.assertFalse(
                        OutputPolicy(self.server.service, row).sensitive(item["value"])
                    )
                self.assertFalse(any(secret in raw for secret in secrets))
        stream = self.client.get(f"/api/v1/runs/{run['id']}/events?follow=false").text
        self.assertFalse(any(secret in stream for secret in secrets))
        return Store(self.db).run(run["id"])

    def assert_quarantined(self, mode):
        run = self.execute(mode)
        self.assertEqual(run["state"], "interrupted")
        self.assertIsNone(run["result"])
        self.assertEqual(Store(self.db).runtime()["occupied"], 1)
        if mode.startswith("result"):
            row = self.server.service.journal.read(run["id"])
            self.assertEqual(row["operations"]["result"]["state"], "started")
            self.assertNotIn("result", row["operations"]["result"])
        self.post(
            f"/runs/{run['id']}/actions",
            {"action": "cancel", "expected_state_version": run["state_version"]},
        )
        Worker(self.db, self.connector).run_once()
        self.assertEqual(Store(self.db).run(run["id"])["state"], "cancelled")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)

    def test_all_credentials_redacted_before_database_and_sse(self):
        run = self.execute("events")
        self.assertEqual(run["state"], "succeeded")
        self.assertEqual(Store(self.db).runtime()["occupied"], 0)
        self.assertIn("<script>", run["result"]["diff"])
        self.assertIn(
            "[redacted]",
            str(self.scalar("SELECT payload FROM run_events WHERE source='openhands' LIMIT 1")),
        )

    def test_secret_diff_quarantines_until_explicit_cancel(self):
        self.assert_quarantined("result_secret")

    def test_corrupt_diff_quarantines_until_explicit_cancel(self):
        self.assert_quarantined("result_forged")

    def test_sensitive_event_id_is_never_a_database_cursor(self):
        self.assert_quarantined("id")

    def test_sensitive_event_kind_is_never_persisted(self):
        self.assert_quarantined("kind")

"""Lost replies and repeated RPC identities cannot repeat guest effects."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

from agent_platform.domain import Problem
from agent_platform.subscription_mcp import Bridge


class BridgeTests(unittest.TestCase):
    def setUp(self):
        tmp = tempfile.TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.path = Path(tmp.name) / "bridge.json"
        self.path.write_text(
            json.dumps(
                {
                    "run_id": str(uuid4()),
                    "generation": 1,
                    "origin": "http://127.0.0.1:1",
                    "token_file": "unused",
                }
            )
        )
        self.path.chmod(0o600)
        self.client = Mock()

    def bridge(self):
        b = Bridge(self.path, self.client)
        self.addCleanup(b.journal.close)
        return b

    def test_lost_reply_closes_all_admission_across_restart(self):
        self.client.call.side_effect = Problem(503, "connector_unavailable_or_uncertain")
        bridge = self.bridge()
        with self.assertRaises(Problem):
            bridge.call(7, "write", {"path": "x", "content": "one"})
        for b, rpc in ((bridge, 7), (bridge, 8)):
            with self.assertRaises(ValueError):
                b.call(rpc, "write", {"path": "x", "content": "two"})
        bridge.journal.close()
        with self.assertRaises(ValueError):
            self.bridge().call(9, "write", {"path": "x", "content": "two"})
        self.assertEqual(self.client.call.call_count, 1)

    def test_completed_replay_observes_and_changed_payload_closes(self):
        self.client.call.return_value = {"ok": True, "bytes": 4}
        bridge = self.bridge()
        a = bridge.call(7, "write", {"path": "x", "content": " a\n"})
        bridge.journal.close()
        bridge = self.bridge()
        self.assertEqual(bridge.call(7, "write", {"path": "x", "content": " a\n"}), a)
        self.assertEqual(self.client.call.call_count, 1)
        self.assertEqual(self.client.call.call_args.args[2]["content"], " a\n")
        with self.assertRaises(Problem):
            bridge.call(7, "write", {"path": "x", "content": "changed"})
        with self.assertRaises(ValueError):
            bridge.call(8, "exec", {"argv": ["true"]})
        self.assertEqual(self.client.call.call_count, 1)

    def test_model_cannot_override_run_or_generation(self):
        with self.assertRaises(ValueError):
            self.bridge().call(7, "read", {"path": "x", "generation": 9})
        self.client.call.assert_not_called()

    def test_crash_after_started_intent_refuses_a_new_rpc_identity(self):
        bridge = self.bridge()
        run_id = bridge.config["run_id"]
        bridge.journal.write(
            {
                "run_id": run_id,
                "operations": {"old": {"state": "started", "payload_hash": "unknown"}},
            }
        )
        bridge.journal.close()
        with self.assertRaises(ValueError):
            self.bridge().call(99, "exec", {"argv": ["true"]})
        self.client.call.assert_not_called()

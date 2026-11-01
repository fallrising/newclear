"""Candidate-only review boundaries; fixtures never claim live qualification."""

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock
from uuid import uuid4

from agent_platform.domain import Problem
from agent_platform.subscription_mcp import Bridge


class ReviewContractTests(unittest.TestCase):
    def test_exact_hash_bound_bounded_verdict(self):
        from agent_platform.review import parse_verdict

        value = {
            "candidate_sha256": "a" * 64,
            "verdict": "request_changes",
            "reasons": ["Fix totals."],
        }
        self.assertEqual(parse_verdict(json.dumps(value), "a" * 64), value)
        for bad in (
            {**value, "candidate_sha256": "b" * 64},
            {**value, "verdict": "approved"},
            {**value, "reasons": []},
            {**value, "reasons": [" "]},
            {**value, "reasons": ["x" * 2001]},
            {**value, "extra": True},
            {**value, "reasons": ["\x00"]},
            {**value, "reasons": ["\ud800"]},
        ):
            with self.subTest(bad=bad), self.assertRaises(Problem):
                parse_verdict(json.dumps(bad), "a" * 64)
        with self.assertRaises(Problem):
            parse_verdict(
                json.dumps(value).replace('"verdict":', '"verdict":"reject","verdict":'), "a" * 64
            )

    def test_review_bridge_denies_mutation_and_other_paths_before_forward(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "bridge.json"
            path.write_text(
                json.dumps({"run_id": str(uuid4()), "generation": 1, "purpose": "review"})
            )
            path.chmod(0o600)
            client = Mock()
            bridge = Bridge(path, client)
            self.addCleanup(bridge.journal.close)
            for name, args in (
                ("write", {"path": "candidate.json", "content": "x"}),
                ("exec", {"argv": ["true"]}),
                ("read", {"path": "../candidate.json"}),
                ("read", {"path": "secret"}),
            ):
                with self.subTest(name=name, args=args), self.assertRaises(ValueError):
                    bridge.call(1, name, args)
            client.call.assert_not_called()
            client.call.return_value = {"ok": True, "content": "candidate"}
            self.assertTrue(bridge.call(2, "read", {"path": "candidate.json"})["ok"])
            self.assertEqual([tool["name"] for tool in bridge.tools], ["read"])


class ConnectorReviewTests(unittest.TestCase):
    def test_connector_denies_review_mutation_before_guest_and_receipt(self):
        from contextlib import nullcontext
        from datetime import UTC, datetime, timedelta

        from agent_platform.connector_workspace import WorkspaceOperation, exchange

        service = Mock()
        row = {
            "input": {
                "purpose": "review",
                "external_workspace": True,
                "deadline": (datetime.now(UTC) + timedelta(minutes=5)).isoformat(),
            }
        }
        service.require.return_value = row
        service.journal.locked.return_value = nullcontext()
        for args in (
            {"action": "write", "path": "candidate.json", "content": "x"},
            {"action": "exec", "argv": ["true"]},
            {"action": "read", "path": "secret"},
        ):
            with self.subTest(args=args), self.assertRaisesRegex(Problem, "review_tool_denied"):
                exchange(
                    service, uuid4(), WorkspaceOperation(generation=1, operation_id=uuid4(), **args)
                )
        service.handle.assert_not_called()
        service.journal.operation.assert_not_called()

    def test_guest_denies_mutations_and_path_forgery_before_filesystem(self):
        from unittest.mock import patch

        from agent_platform import guest_review

        with patch.object(guest_review, "candidate") as read:
            for request in (
                {"action": "exec", "argv": ["true"]},
                {"action": "write", "path": "candidate.json", "content": "x"},
                {"action": "unknown"},
                {"action": "read", "path": "../candidate.json"},
                {"action": "read", "path": "candidate.json", "argv": ["true"]},
            ):
                with self.subTest(request=request), self.assertRaises(ValueError):
                    guest_review.operation(request)
            read.assert_not_called()

    def test_review_allocation_integrity_and_purpose_boundaries(self):
        import hashlib
        from datetime import UTC, datetime

        from agent_platform.connector import Allocate

        payload = "candidate\n"
        fields = dict(
            generation=1,
            template="pinned",
            canonical_repo="repo",
            base_sha="a" * 40,
            egress_policy_sha256="b" * 64,
            deadline=datetime.now(UTC),
            purpose="review",
            external_workspace=True,
            review_candidate=payload,
            candidate_sha256=hashlib.sha256(payload.encode()).hexdigest(),
        )
        self.assertEqual(Allocate(**fields).review_candidate, payload)
        for changes in (
            {"purpose": "coding"},
            {"candidate_sha256": "0" * 64},
            {"review_candidate": "x" * 32769},
            {"external_workspace": False},
            {"tool_transport": True},
            {"model_transport": True},
        ):
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                Allocate(**{**fields, **changes})

    def test_review_finalization_only_attests_candidate_without_coding_checks(self):
        from agent_platform.connector_workspace import result

        service = Mock()
        value = result(service, {"input": {"purpose": "review"}})
        self.assertEqual(value["verification"]["name"], "candidate_integrity")
        self.assertEqual(value["verification"]["status"], "passed")
        service.isolation.assert_called_once()
        service.handle.assert_not_called()

    def test_archive_preserves_typed_result_and_refuses_binding_changes(self):
        from agent_platform.result_archive import result_snapshot
        from agent_platform.review import result_review

        run = {
            "id": uuid4(),
            "purpose": "review",
            "review_context": {
                "root_writer_run_id": str(uuid4()),
                "writer_run_id": str(uuid4()),
                "artifact_id": str(uuid4()),
                "candidate_sha256": "a" * 64,
                "review_round": 1,
                "reviewer_profile_revision": str(uuid4()),
            },
        }
        verdict = {"candidate_sha256": "a" * 64, "verdict": "accept", "reasons": ["Looks correct."]}
        result = {"verification": {"status": "passed"}, "review": result_review(run, verdict)}
        self.assertEqual(result_snapshot(run, result)["review"], result["review"])
        result["review"]["writer_run_id"] = str(uuid4())
        with self.assertRaises(Problem):
            result_snapshot(run, result)

    def test_candidate_input_is_byte_bounded_not_character_bounded(self):
        import hashlib

        from agent_platform.review import candidate_bytes

        raw = ("🐈" * 8193).encode()
        with self.assertRaises(Problem):
            candidate_bytes(raw, hashlib.sha256(raw).hexdigest())
        raw = b"x" * 32768
        self.assertEqual(candidate_bytes(raw, hashlib.sha256(raw).hexdigest()), raw)

    def test_claude_review_attestation_accepts_read_only_and_refuses_writer_tools(self):
        from agent_platform.subscription_claude import MODEL, TOOLS, assess

        tools = {"mcp__fanz_workspace__read"}
        events = [
            {"type": "system", "subtype": "init", "model": MODEL, "tools": list(tools)},
            {
                "type": "assistant",
                "message": {
                    "model": MODEL,
                    "content": [{"type": "tool_use", "name": "mcp__fanz_workspace__read"}],
                },
            },
            {
                "type": "result",
                "subtype": "success",
                "is_error": False,
                "permission_denials": [],
                "modelUsage": {MODEL: {}},
            },
        ]
        self.assertTrue(assess(events, 0, tools))
        events[0]["tools"] = list(TOOLS)
        self.assertFalse(assess(events, 0, tools))

    def test_prepare_materializes_independent_candidate_only_with_readonly_modes(self):
        import hashlib

        from agent_platform.connector_workspace import prepare

        payload = "candidate\n"
        digest = hashlib.sha256(payload.encode()).hexdigest()
        service = Mock()
        guest = service.handle.return_value
        guest.exec.return_value = json.dumps({"candidate_sha256": digest})
        row = {
            "run_id": "review-run",
            "input": {"purpose": "review", "review_candidate": payload, "candidate_sha256": digest},
        }
        response = prepare(service, row)
        self.assertEqual(response["candidate_sha256"], digest)
        copies = [
            c for c in guest.write_file.call_args_list if c.args[0].endswith("candidate.json")
        ]
        self.assertEqual(len(copies), 1)
        self.assertEqual(
            copies[0].args, ("/var/lib/agent-platform/review/candidate.json", payload.encode())
        )
        self.assertEqual(copies[0].kwargs["mode"], 0o444)
        self.assertTrue(
            any(
                c.args == ("install", "-d", "-m", "0555", "/var/lib/agent-platform/review")
                for c in guest.exec.call_args_list
            )
        )
        self.assertFalse(any("source.bundle" in c.args[0] for c in guest.write_file.call_args_list))
        service.bundle.assert_not_called()
        self.assertEqual(
            guest.exec.call_args.args[:3], ("python3", "-I", "/opt/agent-platform/guest_review.py")
        )
        service.isolation.assert_called_once_with(row)

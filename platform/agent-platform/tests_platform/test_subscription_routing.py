"""Offline routing contracts; these do not qualify a provider or a VM."""

import os
import unittest
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock, patch

from agent_platform.domain import Problem, ProfileInput, capabilities, execution_mode
from agent_platform.runtime_client import RuntimeClient
from agent_platform.store import Store
from agent_platform.worker import Worker


class SubscriptionRoutingTests(unittest.TestCase):
    def test_both_subscriptions_share_bounded_external_capabilities(self):
        for backend in ("claude-subscription", "codex-subscription"):
            with self.subTest(backend=backend):
                profile = ProfileInput(name="subscription", backend=backend)
                self.assertEqual(profile.backend, backend)
                self.assertEqual(execution_mode(backend), "cocoon-external")
                declared = capabilities(backend)
                self.assertTrue(declared["cancel"])
                self.assertTrue(declared["terminal_output"])
                for feature in ("usage", "pause", "resume", "durable_resume", "approval"):
                    self.assertFalse(declared[feature])

    def test_subscription_admission_rejects_unbounded_unverified_approval_and_mock(self):
        for backend in ("claude-subscription", "codex-subscription"):
            for fields, reason in (
                ({"deadline_seconds": 601}, "subscription_requires_bounded_verified_run"),
                ({"verification": {"mode": "none"}}, "subscription_requires_bounded_verified_run"),
                ({"mock_tools": True}, "unsupported_capability:mock_tools"),
                ({"require_approval": True}, "unsupported_capability:approval"),
            ):
                with self.subTest(backend=backend, fields=fields):
                    data = ProfileInput(
                        **{
                            "name": "subscription",
                            "backend": backend,
                            "deadline_seconds": 600,
                            "verification": {
                                "mode": "commands",
                                "revision": "routing-v1",
                                "checks": [{"id": "test", "argv": ["true"], "timeout_seconds": 1}],
                            },
                            **fields,
                        }
                    )
                    conn = Mock()
                    with self.assertRaisesRegex(Problem, reason):
                        Store(None).create_profile(conn, data)
                    conn.execute.assert_not_called()

    def test_matching_driver_only_and_legacy_constructor(self):
        claude, codex = object(), object()
        legacy = Worker(None, object(), claude)
        self.assertIs(legacy.subscription_for("claude-subscription"), claude)
        self.assertIsNone(legacy.subscription_for("codex-subscription"))
        worker = Worker(None, object(), claude, codex_subscription=codex)
        self.assertIs(worker.subscription_for("claude-subscription"), claude)
        self.assertIs(worker.subscription_for("codex-subscription"), codex)
        for backend in ("fake", "openhands", "unknown"):
            self.assertIsNone(worker.subscription_for(backend))

    def test_claim_never_attempts_an_unconfigured_subscription(self):
        for connector in (None, object()):
            for claude in (None, object()):
                for codex in (None, object()):
                    with self.subTest(
                        connector=bool(connector), claude=bool(claude), codex=bool(codex)
                    ):
                        worker = Worker(None, connector, claude, codex_subscription=codex)
                        worker.claim_node = Mock(return_value=None)
                        with patch("agent_platform.recovery.claim_recovery", return_value=None):
                            self.assertIsNone(worker.claim())
                        claimed = [call.args[1] for call in worker.claim_node.call_args_list]
                        self.assertEqual("fake" in claimed, True)
                        self.assertEqual("openhands" in claimed, connector is not None)
                        self.assertEqual(
                            "claude-subscription" in claimed, bool(connector and claude)
                        )
                        self.assertEqual("codex-subscription" in claimed, bool(connector and codex))

    def test_connector_external_allocation_disables_model_proxy(self):
        client = RuntimeClient("https://fixture.invalid", "fixture-token")
        client.call = Mock(return_value={})
        client.model_transport = True
        for backend in ("claude-subscription", "codex-subscription", "openhands"):
            with self.subTest(backend=backend):
                client.allocate(
                    {
                        "id": "run",
                        "generation": 1,
                        "backend": backend,
                        "template_digest": "template@sha256:" + "a" * 64,
                        "canonical_repo": "https://example.com/repo",
                        "base_sha": "b" * 40,
                        "deadline": datetime.now(UTC),
                    }
                )
                payload = client.call.call_args.args[2]
                self.assertEqual(payload.get("external_workspace", False), backend != "openhands")
                self.assertEqual(payload["model_transport"], backend == "openhands")

    def test_execute_routes_both_subscriptions_to_real_lifecycle(self):
        worker = Worker(None)
        for backend in ("claude-subscription", "codex-subscription", "openhands"):
            with self.subTest(backend=backend):
                claim = {"backend": backend}
                with patch("agent_platform.runtime_worker.execute_real") as execute:
                    worker.execute(claim)
                    execute.assert_called_once_with(worker, claim)

    def test_cli_injects_each_explicit_configuration_without_fallback(self):
        from agent_platform import cli

        for enable_claude, enable_codex in (
            (False, False),
            (True, False),
            (False, True),
            (True, True),
        ):
            with self.subTest(claude=enable_claude, codex=enable_codex):
                claude, codex = Mock(), Mock()
                env = {}
                if enable_claude:
                    env["SUBSCRIPTION_CONFIG"] = "/fixture/claude.json"
                if enable_codex:
                    env["CODEX_SUBSCRIPTION_CONFIG"] = "/fixture/codex.json"
                with (
                    patch.dict(os.environ, env, clear=True),
                    patch.dict(
                        "sys.modules",
                        {
                            "agent_platform.subscription_claude": SimpleNamespace(
                                ClaudeSubscription=claude
                            ),
                            "agent_platform.subscription_codex": SimpleNamespace(
                                CodexSubscription=codex
                            ),
                        },
                    ),
                    patch("sys.argv", ["agent-platform", "worker", "--once"]),
                    patch.object(cli.Settings, "from_env"),
                    patch.object(cli, "Database") as database,
                    patch.object(cli.RuntimeClient, "from_env") as connector,
                    patch.object(cli, "Worker") as worker,
                ):
                    self.assertEqual(cli.main(), 0)
                    worker.assert_called_once_with(
                        database.return_value,
                        connector.return_value,
                        subscription=claude.return_value if enable_claude else None,
                        codex_subscription=codex.return_value if enable_codex else None,
                    )
                    worker.return_value.run_once.assert_called_once()
                    database.return_value.close.assert_called_once()
                if enable_claude:
                    claude.assert_called_once_with("/fixture/claude.json")
                else:
                    claude.assert_not_called()
                if enable_codex:
                    codex.assert_called_once_with("/fixture/codex.json")
                else:
                    codex.assert_not_called()

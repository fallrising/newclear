"""Behavioral model acceptance oracles; these do not claim a KVM execution."""

import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


class ModelCleanupOracles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        scripts = Path(__file__).resolve().parents[1] / "scripts"
        spec = importlib.util.spec_from_file_location(
            "model_oracles", scripts / "model_kvm_checks.py"
        )
        cls.checks = importlib.util.module_from_spec(spec)
        with patch.object(sys, "path", [str(scripts), *sys.path]):
            spec.loader.exec_module(cls.checks)

    def setUp(self):
        self.report = {"passed": True}
        self.saved = []
        self.host = Mock(vms=Mock(return_value=[]))
        self.node = Mock(sandboxes=Mock(return_value=[]))
        self.servers = [Mock(), Mock(), Mock()]
        self.db = Mock()
        self.restore = Mock()
        self.cleanups = [Mock(), Mock()]

    def finalize(self):
        self.checks.finalize_acceptance(
            self.report,
            cleanups=self.cleanups,
            host=self.host,
            node=self.node,
            servers=self.servers,
            db=self.db,
            restore=self.restore,
            save=lambda: self.saved.append(dict(self.report)),
        )

    def assert_closed_and_saved(self):
        for cleanup in self.cleanups:
            cleanup.assert_called_once_with()
        for server in self.servers:
            server.shutdown.assert_called_once_with()
            server.server_close.assert_called_once_with()
        self.db.close.assert_called_once_with()
        self.restore.assert_called_once_with()
        self.assertEqual(len(self.saved), 1)
        self.assertEqual(self.saved[0]["passed"], self.report["passed"])

    def test_invalid_mock_usage_is_retained_with_its_actual_failure_reason(self):
        usage = {
            "hard_money_limit_supported": False,
            "amount_decimal": None,
            "entries": [{"status": "unknown", "reason": "model_response_invalid"}],
            "uncertain_requests": 1,
        }
        self.checks.validate_mock_usage("mock-unknown", usage)
        for key, value in (("status", "final"), ("reason", "mock_reported_usage")):
            with self.subTest(key=key):
                original = usage["entries"][0][key]
                usage["entries"][0][key] = value
                with self.assertRaises(RuntimeError):
                    self.checks.validate_mock_usage("mock-unknown", usage)
                usage["entries"][0][key] = original

    def test_final_mock_usage_has_exact_transport_reason_and_no_unknown_slots(self):
        for case, reason in (
            ("mock-complete", "mock_reported_usage"),
            ("mock-cutoff", "mock_reported_usage"),
            ("mock-https-complete", "provider_reported_usage_unbilled"),
        ):
            with self.subTest(case=case):
                usage = {
                    "hard_money_limit_supported": False,
                    "amount_decimal": None,
                    "entries": [{"status": "final", "reason": reason}],
                    "uncertain_requests": 0,
                }
                self.checks.validate_mock_usage(case, usage)
                usage["uncertain_requests"] = 1
                with self.assertRaises(RuntimeError):
                    self.checks.validate_mock_usage(case, usage)

    def test_successful_case_and_cleanup_pass(self):
        self.finalize()
        self.assertTrue(self.report["passed"])
        self.assert_closed_and_saved()

    def test_original_case_failure_is_preserved_after_cleanup(self):
        self.report["passed"] = False
        original = ValueError("case acceptance failed")
        with self.assertRaises(ValueError) as caught:
            try:
                raise original
            finally:
                self.finalize()
        self.assertIs(caught.exception, original)
        self.assertFalse(self.saved[0]["passed"])
        self.assert_closed_and_saved()

    def test_resource_residue_fails_report_and_exit(self):
        for stage in ("vms", "claims"):
            with self.subTest(stage=stage):
                self.setUp()
                probe = self.host.vms if stage == "vms" else self.node.sandboxes
                probe.return_value = ["owned-resource"]
                with self.assertRaisesRegex(RuntimeError, "acceptance_cleanup_failed"):
                    self.finalize()
                self.assertFalse(self.report["passed"])
                self.assert_closed_and_saved()

    def test_cleanup_and_observation_errors_do_not_skip_other_cleanup(self):
        for stage in ("run", "vms", "claims", "shutdown", "close", "db", "restore"):
            with self.subTest(stage=stage):
                self.setUp()
                target = {
                    "run": self.cleanups[0],
                    "vms": self.host.vms,
                    "claims": self.node.sandboxes,
                    "shutdown": self.servers[0].shutdown,
                    "close": self.servers[0].server_close,
                    "db": self.db.close,
                    "restore": self.restore,
                }[stage]
                target.side_effect = OSError("private diagnostic must not leak")
                with self.assertRaisesRegex(RuntimeError, "acceptance_cleanup_failed"):
                    self.finalize()
                self.assertFalse(self.report["passed"])
                self.assertNotIn("private diagnostic", str(self.saved))
                self.assert_closed_and_saved()

    def test_case_error_survives_cleanup_error_and_report_is_saved(self):
        self.report["passed"] = False
        self.host.vms.side_effect = OSError("observation unavailable")
        original = ValueError("case acceptance failed")
        with self.assertRaises(ValueError) as caught:
            try:
                raise original
            finally:
                self.finalize()
        self.assertIs(caught.exception, original)
        self.assertFalse(self.report["passed"])
        self.assert_closed_and_saved()

    def test_missing_observation_fails_closed(self):
        self.host.vms.return_value = None
        with self.assertRaisesRegex(RuntimeError, "acceptance_cleanup_failed"):
            self.finalize()
        self.assertFalse(self.report["passed"])
        self.assertFalse(self.report["zero_vms"])
        self.assert_closed_and_saved()

    def test_report_write_error_fails_exit_after_all_cleanup_attempts(self):
        def cannot_save():
            raise OSError("disk unavailable")

        with self.assertRaisesRegex(RuntimeError, "acceptance_cleanup_failed"):
            self.checks.finalize_acceptance(
                self.report,
                cleanups=self.cleanups,
                host=self.host,
                node=self.node,
                servers=self.servers,
                db=self.db,
                restore=self.restore,
                save=cannot_save,
            )
        self.assertFalse(self.report["passed"])
        self.assertEqual(self.report["cleanup_failures"][-1]["stage"], "report_save")
        for server in self.servers:
            server.shutdown.assert_called_once_with()
            server.server_close.assert_called_once_with()
        self.db.close.assert_called_once_with()
        self.restore.assert_called_once_with()


class ModelPollingOracles(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ModelCleanupOracles.setUpClass()
        cls.checks = ModelCleanupOracles.checks

    def pages(self):
        return [
            {
                "generation": 1,
                "request_cursor": None,
                "response_cursor": "one",
                "state": "running",
                "caught_up": True,
                "events": [{"event_id": "one", "cursor": "one"}],
            },
            {
                "generation": 1,
                "request_cursor": "one",
                "response_cursor": "one",
                "state": "finished",
                "caught_up": True,
                "events": [],
            },
        ]

    def test_empty_final_page_proves_finished_and_retains_observed_cursors(self):
        result = self.checks.validate_model_trace(self.pages(), finished=True)
        self.assertTrue(result["sdk_finished"])
        self.assertTrue(result["sdk_caught_up"])
        self.assertEqual(result["sdk_event_count"], 1)
        self.assertEqual(result["sdk_poll_count"], 2)
        self.assertEqual(result["sdk_pages"], self.pages())

    def test_missing_or_uncaught_completion_fails_success_oracle(self):
        for state, caught_up in (("running", True), ("finished", False), ("finished", "true")):
            with self.subTest(state=state, caught_up=caught_up):
                pages = self.pages()
                pages[-1].update(state=state, caught_up=caught_up)
                with self.assertRaisesRegex(RuntimeError, "sdk_completion_missing"):
                    self.checks.validate_model_trace(pages, finished=True)
        with self.assertRaisesRegex(RuntimeError, "sdk_completion_missing"):
            self.checks.validate_model_trace([], finished=True)

    def test_duplicate_events_fail_before_sql_deduplication(self):
        pages = self.pages()
        pages[-1]["events"] = pages[0]["events"]
        with self.assertRaisesRegex(RuntimeError, "sdk_event_replayed"):
            self.checks.validate_model_trace(pages, finished=True)

    def test_cursor_discontinuities_and_malformed_event_cursor_fail(self):
        for key, code in (
            ("request_cursor", "sdk_cursor_discontinuity"),
            ("response_cursor", "sdk_response_cursor_invalid"),
        ):
            with self.subTest(key=key):
                pages = self.pages()
                pages[-1][key] = "unseen"
                with self.assertRaisesRegex(RuntimeError, code):
                    self.checks.validate_model_trace(pages, finished=True)
        pages = self.pages()
        pages[0]["events"][0]["cursor"] = "unseen"
        with self.assertRaisesRegex(RuntimeError, "sdk_cursor_invalid"):
            self.checks.validate_model_trace(pages, finished=True)

    def test_cancel_and_budget_faults_do_not_invent_finished(self):
        for pages in ([], self.pages()[:1]):
            with self.subTest(pages=pages):
                result = self.checks.validate_model_trace(pages, finished=False)
                self.assertFalse(result["sdk_finished"])
                self.assertFalse(result["sdk_completion_required"])

    def test_recovery_requires_explicit_partial_trace_label(self):
        pages = self.pages()[1:]
        with self.assertRaisesRegex(RuntimeError, "sdk_cursor_discontinuity"):
            self.checks.validate_model_trace(pages, finished=True)
        result = self.checks.validate_model_trace(pages, finished=True, resumed=True)
        self.assertEqual(result["sdk_initial_cursor"], "one")
        self.assertEqual(result["sdk_observation_scope"], "post_recovery_suffix")
        pages[0]["events"] = [{"event_id": "one", "cursor": "one"}]
        with self.assertRaisesRegex(RuntimeError, "sdk_event_replayed"):
            self.checks.validate_model_trace(pages, finished=True, resumed=True)

    def test_observer_returns_identical_pages_without_extra_polling_or_state_changes(self):
        client = self.checks.ObservedRuntimeClient("http://127.0.0.1:1", "test-token")
        run = {"id": "one", "generation": 1, "backend_cursor": None}
        original_run = dict(run)
        value = {
            "events": [{"event_id": "e1", "cursor": "e1", "payload": {"content": "private"}}],
            "state": "running",
            "caught_up": False,
        }
        with patch.object(self.checks.RuntimeClient, "events", return_value=value) as events:
            self.assertIs(client.events(run), value)
            events.assert_called_once_with(run)
        self.assertEqual(run, original_run)
        self.assertNotIn("private", str(client.event_pages))
        value["events"][0]["cursor"] = "mutated-after-consumption"
        self.assertEqual(client.event_pages["one"][0]["events"][0]["cursor"], "e1")

    def test_parallel_run_ids_are_observed_separately(self):
        client = self.checks.ObservedRuntimeClient("http://127.0.0.1:1", "test-token")
        value = {"events": [], "state": "running", "caught_up": True}
        with patch.object(self.checks.RuntimeClient, "events", return_value=value):
            for identity in ("one", "two"):
                client.events({"id": identity, "generation": 1, "backend_cursor": None})
        self.assertEqual(set(client.event_pages), {"one", "two"})
        self.assertTrue(all(len(pages) == 1 for pages in client.event_pages.values()))

    def test_connector_409_propagates_unchanged_without_fabricated_page(self):
        client = self.checks.ObservedRuntimeClient("http://127.0.0.1:1", "test-token")
        failure = self.checks.Problem(409, "connector_operation_unconfirmed")
        with patch.object(self.checks.RuntimeClient, "events", side_effect=failure) as events:
            with self.assertRaises(self.checks.Problem) as caught:
                client.events({"id": "one", "generation": 1, "backend_cursor": None})
        self.assertIs(caught.exception, failure)
        self.assertEqual(events.call_count, 1)
        self.assertEqual(client.event_pages, {})


class LegacyProbeFixtureOracles(unittest.TestCase):
    def check_fixture(self, script):
        import runpy
        from pathlib import Path

        namespace = runpy.run_path(str(Path("scripts") / script))
        prefix = "python3 -I /opt/agent-platform/test_probe.py; "
        source = namespace["fixture_source"](prefix)
        fixture = {"__name__": "probe_fixture_test"}
        exec(compile(source, script, "exec"), fixture)
        original = runpy.run_path("src/agent_platform/guest_fixture.py")
        run_id = "00000000-0000-0000-0000-000000000001"
        for messages in ([], [{"role": "user", "content": "FILE note.txt\nTEXT safe"}]):
            with self.subTest(messages=messages):
                self.assertEqual(
                    fixture["edit_command"](messages, run_id),
                    prefix + original["edit_command"](messages, run_id),
                )
        self.assertIsNotNone(fixture["Handler"])

    def test_egress_fixture_starts_and_preserves_native_command(self):
        self.check_fixture("m3-egress-kvm.py")

    def test_isolation_fixture_starts_and_preserves_native_command(self):
        self.check_fixture("m3-isolation-kvm.py")

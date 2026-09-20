import json
from pathlib import Path
import tempfile
import unittest

from ice_maker.operations import (
    DEVELOPMENT_COMPLETE,
    Dashboard,
    EXTERNAL_PRODUCTION_GATES,
    MetricSample,
    MetricSnapshot,
    LocalEvidence,
    OperationsError,
    build_local_evidence,
    evaluate_readiness,
    evaluate_snapshot,
    load_dashboard,
    load_dashboard_file,
    load_metric_registry_file,
)


ROOT = Path(__file__).parents[1]


class OperationsTests(unittest.TestCase):
    def registry(self):
        return load_metric_registry_file(ROOT / "ops/observability/metrics.json")

    def test_tracked_registry_and_dashboard_are_complete_and_deterministic(self):
        registry = self.registry()
        dashboard = load_dashboard_file(ROOT / "ops/observability/dashboard.json", registry)
        self.assertEqual(tuple(sorted(registry.metrics)), tuple(registry.metrics))
        self.assertEqual(tuple(sorted(panel.identifier for panel in dashboard.panels)),
                         tuple(panel.identifier for panel in dashboard.panels))
        values = tuple(MetricSample(name, 0.0, ()) for name in registry.metrics)
        snapshot = evaluate_snapshot(registry, values)
        self.assertEqual(snapshot.violations, (
            "metric:cache_hit_rate:threshold",
            "metric:ocr_confidence:threshold",
            "metric:task_success_rate:threshold",
            "metric:test_pass_rate:threshold",
        ))
        self.assertIsInstance(snapshot.samples, tuple)
        with self.assertRaises((AttributeError, TypeError)):
            registry.metrics = {}
        with self.assertRaises((AttributeError, TypeError)):
            dashboard.panels = ()

    def test_rejects_duplicate_unknown_mutable_nonfinite_and_unsafe_input(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "metrics.json"
            path.write_text('{"version":1,"version":1,"metrics":[]}', encoding="utf-8")
            with self.assertRaises(OperationsError): load_metric_registry_file(path)
        registry = self.registry()
        name = next(iter(registry.metrics))
        with self.assertRaises(OperationsError): evaluate_snapshot(registry, [])
        with self.assertRaises(OperationsError): evaluate_snapshot(registry, (MetricSample(name, float("nan"), ()),))
        with self.assertRaises(OperationsError): MetricSample(name, 0, (("token", "hidden"),))
        with self.assertRaises(OperationsError): MetricSample(name, 0, (("ok", "bad\nvalue"),))
        item = build_local_evidence("metrics", "a" * 40, "b" * 64)
        self.assertEqual(evaluate_readiness((item,), ("token",)).status, "LOCAL_EVIDENCE_INVALID")

    def test_direction_drift_and_low_rates_fail_closed(self):
        registry = self.registry()
        raw = json.loads((ROOT / "ops/observability/dashboard.json").read_text(encoding="utf-8"))
        raw["panels"][0]["direction"] = "minimum"
        with self.assertRaises(OperationsError): load_dashboard(raw, registry)
        samples = tuple(MetricSample(name, 1.0 if definition.direction == "minimum" else 0.0, ())
                        for name, definition in registry.metrics.items())
        self.assertEqual(evaluate_snapshot(registry, samples).violations, ())
        low = tuple(MetricSample("test_pass_rate", 0.0, ()) if sample.name == "test_pass_rate" else sample
                    for sample in samples)
        self.assertEqual(evaluate_snapshot(registry, low).violations,
                         ("metric:test_pass_rate:threshold",))

    def test_configuration_loader_rejects_oversized_and_symlinked_files(self):
        with tempfile.TemporaryDirectory() as directory:
            directory_path = Path(directory)
            oversized = directory_path / "oversized.json"
            oversized.write_bytes(b" " * 65_537)
            with self.assertRaises(OperationsError): load_metric_registry_file(oversized)
            linked = directory_path / "linked.json"
            linked.symlink_to(ROOT / "ops/observability/metrics.json")
            with self.assertRaises(OperationsError): load_metric_registry_file(linked)
            ancestor = directory_path / "ancestor"
            ancestor.symlink_to(ROOT / "ops", target_is_directory=True)
            with self.assertRaises(OperationsError):
                load_metric_registry_file(ancestor / "observability/metrics.json")

    def test_public_metric_values_cannot_bypass_validated_boundaries(self):
        with self.assertRaises(OperationsError): MetricSample("bogus", 0, ())
        with self.assertRaises(OperationsError): MetricSample("broken_links", -1, ())
        with self.assertRaises(OperationsError): Dashboard(())
        with self.assertRaises(OperationsError): MetricSnapshot((), ())

    def test_quota_violations_have_stable_safe_identities(self):
        registry = self.registry()
        values = tuple(MetricSample(name, 1.0 if definition.direction == "minimum" else 0.0, ())
                       for name, definition in registry.metrics.items())
        values = tuple(MetricSample("estimated_cost_usd", 999.0, ()) if item.name == "estimated_cost_usd" else item for item in values)
        snapshot = evaluate_snapshot(registry, values)
        self.assertEqual(snapshot.violations, ("metric:estimated_cost_usd:threshold",))
        self.assertNotIn("999", " ".join(snapshot.violations))

    def test_digest_bound_evidence_is_frozen_and_never_claims_production(self):
        controls = ("metrics", "quotas", "evidence")
        evidence = tuple(build_local_evidence(control, "a" * 40, "b" * 64) for control in controls)
        readiness = evaluate_readiness(evidence, controls)
        self.assertEqual(readiness.status, DEVELOPMENT_COMPLETE)
        self.assertEqual(readiness.external_gates, EXTERNAL_PRODUCTION_GATES)
        with self.assertRaises((AttributeError, TypeError)): evidence[0].result = "failure"
        replay = evidence + (evidence[0],)
        self.assertEqual(evaluate_readiness(replay, controls).status, "LOCAL_EVIDENCE_INVALID")
        drifted = build_local_evidence("metrics", "c" * 40, "b" * 64)
        self.assertEqual(evaluate_readiness((drifted,) + evidence[1:], controls).status, "LOCAL_EVIDENCE_INVALID")

    def test_direct_evidence_forgery_and_all_public_values_are_rejected_or_frozen(self):
        with self.assertRaises(OperationsError): LocalEvidence("metrics", "x", "local", "passed", "y", "z")
        item = build_local_evidence("metrics", "a" * 40, "b" * 64)
        for attribute, value in (("control", "other"), ("commit_digest", "c" * 40),
                                 ("environment_class", "external"), ("result", "failed"),
                                 ("artifact_digest", "c" * 64), ("digest", "c" * 64)):
            with self.assertRaises((AttributeError, TypeError)):
                setattr(item, attribute, value)
        readiness = evaluate_readiness((item,), ("metrics",))
        for attribute, value in (("status", "PRODUCTION_READY"), ("external_gates", ())):
            with self.assertRaises((AttributeError, TypeError)):
                setattr(readiness, attribute, value)
        self.assertIn("EXTERNAL_RESTORE_ATTESTATION", EXTERNAL_PRODUCTION_GATES)
        self.assertIn("EXTERNAL_CREDENTIAL_ROTATION_ATTESTATION", EXTERNAL_PRODUCTION_GATES)
        self.assertIn("EXTERNAL_TELEMETRY_COST_ALERT_ATTESTATION", EXTERNAL_PRODUCTION_GATES)
        self.assertIn("EXTERNAL_COMPROMISED_RUNNER_DRILL_ATTESTATION", EXTERNAL_PRODUCTION_GATES)


if __name__ == "__main__":
    unittest.main()

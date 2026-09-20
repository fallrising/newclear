"""Deterministic, local-only Phase 7 hardening journey."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest

from ice_maker.execution import ContractError
from ice_maker.hardening import (
    COMPROMISE_STEPS,
    CredentialMetadata,
    enforce_cost_ceiling,
    evaluate_egress,
    load_egress_policy,
    load_identity_contract,
    load_runner_contract,
    respond_to_compromise,
    restore_backup,
    rotate_credential,
)
from ice_maker.operations import (
    DEVELOPMENT_COMPLETE,
    EXTERNAL_PRODUCTION_GATES,
    LOCAL_EVIDENCE_INVALID,
    MetricSample,
    build_local_evidence,
    evaluate_readiness,
    evaluate_snapshot,
    load_dashboard_file,
    load_metric_registry_file,
)

ROOT = Path(__file__).parents[1]
HARDENING = ROOT / "ops" / "hardening"
OBSERVABILITY = ROOT / "ops" / "observability"
COMMIT = "0123456789abcdef0123456789abcdef01234567"
CONTROLS = (
    "runner", "identity", "egress", "restore", "rotation", "compromise",
    "quotas", "metrics",
)


def _digest(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


class HardeningEndToEndTests(unittest.TestCase):
    def _journey(
        self,
        *,
        corrupt_restore: bool = False,
        halt_cost: bool = False,
        violate_threshold: bool = False,
    ) -> tuple[str, tuple[str, ...], tuple[str, ...]]:
        runner = load_runner_contract(HARDENING / "runner.json")
        identity = load_identity_contract(HARDENING / "identity.json")
        policy = load_egress_policy(HARDENING / "egress.json")
        registry = load_metric_registry_file(OBSERVABILITY / "metrics.json")
        dashboard = load_dashboard_file(OBSERVABILITY / "dashboard.json", registry)
        evidence = []

        def passed(control: str, output: object) -> None:
            evidence.append(build_local_evidence(control, COMMIT, _digest(output)))

        passed("runner", {
            "lifecycle": runner.lifecycle,
            "max_jobs": runner.max_jobs_per_runner,
            "privileged": runner.privileged,
            "rootless": runner.rootless,
            "read_only_root": runner.read_only_root,
            "no_new_privileges": runner.no_new_privileges,
            "drop": runner.capabilities_dropped,
            "add": runner.capabilities_added,
            "limits": (
                runner.limits.cpus, runner.limits.memory, runner.limits.pids,
                runner.limits.timeout_seconds,
            ),
            "contract_sha256": hashlib.sha256(
                (HARDENING / "runner.json").read_bytes()
            ).hexdigest(),
        })
        passed("identity", {
            "method": identity.method,
            "issuer": identity.issuer,
            "audience": identity.audience,
            "ttl": identity.max_ttl_seconds,
            "static": identity.static_credentials,
            "claims": identity.subject_claims,
            "contract_sha256": hashlib.sha256(
                (HARDENING / "identity.json").read_bytes()
            ).hexdigest(),
        })

        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            backup = root / "backup"
            (backup / "nested").mkdir(parents=True)
            files = {"ledger.json": b'{"entries":[]}', "nested/state.json": b'{"ok":true}'}
            manifest = {}
            for name, content in files.items():
                (backup / name).write_bytes(content)
                manifest[name] = hashlib.sha256(content).hexdigest()
            restore_manifest = dict(manifest)
            if corrupt_restore:
                restore_manifest["ledger.json"] = "0" * 64
            try:
                restored = restore_backup(backup, root / "restored", restore_manifest)
            except ContractError:
                self.assertTrue(corrupt_restore)
                self.assertFalse((root / "restored").exists())
            else:
                self.assertFalse(corrupt_restore)
                self.assertEqual(
                    (root / "restored" / "nested/state.json").read_bytes(),
                    files["nested/state.json"],
                )
                passed("restore", {
                    "digest": restored.digest,
                    "files": list(restored.files),
                    "bytes": restored.total_bytes,
                    "manifest": sorted(manifest.items()),
                })

        rotation = rotate_credential(CredentialMetadata("oidc-current", "oidc-token", 0, 900),
                                     CredentialMetadata("oidc-next", "oidc-token", 1, 900))
        compromise = respond_to_compromise("runner-old", "runner-new", COMPROMISE_STEPS)
        allowed = evaluate_egress(policy, "https://api.github.com/repos", via="egress-proxy")
        denied_host = evaluate_egress(policy, "https://example.invalid/", via="egress-proxy")
        denied_direct = evaluate_egress(policy, "https://api.github.com/", via="direct")
        self.assertTrue(allowed.allowed)
        self.assertFalse(denied_host.allowed)
        self.assertFalse(denied_direct.allowed)
        passed("egress", {
            "policy": (
                policy.default_action, policy.direct_egress, policy.proxy,
                tuple((item.host, item.scheme, item.port) for item in policy.allow),
            ),
            "decisions": tuple(
                (item.allowed, item.host, item.reason)
                for item in (allowed, denied_host, denied_direct)
            ),
            "contract_sha256": hashlib.sha256(
                (HARDENING / "egress.json").read_bytes()
            ).hexdigest(),
        })
        passed("rotation", (
            rotation.steps, rotation.revoked_id, rotation.active_id,
            rotation.generation, rotation.digest,
        ))
        passed("compromise", (
            compromise.steps, compromise.destroyed_runner,
            compromise.replacement_runner, compromise.digest,
        ))

        cost = enforce_cost_ceiling(400, (401,) if halt_cost else (100, 150, 100))
        if halt_cost:
            self.assertTrue(cost.halted)
        else:
            self.assertFalse(cost.halted)
            self.assertEqual(cost.spent_cents, 350)
            passed("quotas", (
                cost.ceiling_cents, cost.spent_cents, cost.accepted,
                cost.halted, cost.digest,
            ))

        samples = tuple(MetricSample(name, 5.0 if violate_threshold and name == "estimated_cost_usd"
                                      else (1.0 if definition.direction == "minimum" else 0.0), ())
                        for name, definition in registry.metrics.items())
        snapshot = evaluate_snapshot(registry, samples)
        if violate_threshold:
            self.assertIn("metric:estimated_cost_usd:threshold", snapshot.violations)
        else:
            self.assertEqual(snapshot.violations, ())
            passed("metrics", {
                "registry_sha256": hashlib.sha256(
                    (OBSERVABILITY / "metrics.json").read_bytes()
                ).hexdigest(),
                "dashboard_sha256": hashlib.sha256(
                    (OBSERVABILITY / "dashboard.json").read_bytes()
                ).hexdigest(),
                "dashboard": tuple(
                    (panel.identifier, panel.metric, panel.threshold, panel.direction)
                    for panel in dashboard.panels
                ),
                "samples": tuple(
                    (sample.name, sample.value, sample.labels)
                    for sample in snapshot.samples
                ),
                "violations": snapshot.violations,
            })
        readiness = evaluate_readiness(tuple(evidence), CONTROLS)
        self.assertEqual(readiness.external_gates, EXTERNAL_PRODUCTION_GATES)
        return readiness.status, readiness.external_gates, tuple(item.digest for item in evidence)

    def test_complete_journey_is_repeatable_and_fail_closed(self) -> None:
        first = self._journey()
        second = self._journey()
        self.assertEqual(first, second)
        self.assertEqual(first[0], DEVELOPMENT_COMPLETE)
        self.assertNotEqual(first[0], "PRODUCTION_READY")
        self.assertEqual(self._journey(corrupt_restore=True)[0], LOCAL_EVIDENCE_INVALID)
        self.assertEqual(self._journey(halt_cost=True)[0], LOCAL_EVIDENCE_INVALID)
        self.assertEqual(self._journey(violate_threshold=True)[0], LOCAL_EVIDENCE_INVALID)

        # Structural readiness also rejects incomplete, replayed, or malformed
        # evidence independently of the composed journey's control gating.
        complete = tuple(build_local_evidence(control, COMMIT, "a" * 64) for control in CONTROLS)
        self.assertEqual(evaluate_readiness(complete[:-1], CONTROLS).status, LOCAL_EVIDENCE_INVALID)
        self.assertEqual(
            evaluate_readiness(complete + (complete[0],), CONTROLS).status,
            LOCAL_EVIDENCE_INVALID,
        )
        malformed = list(complete)
        malformed[0] = object()
        self.assertEqual(
            evaluate_readiness(tuple(malformed), CONTROLS).status,
            LOCAL_EVIDENCE_INVALID,
        )


if __name__ == "__main__":
    unittest.main()

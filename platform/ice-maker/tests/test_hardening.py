"""Adversarial offline tests for hardening contracts and local operational drills."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from ice_maker import hardening
from ice_maker.execution import ContractError
from ice_maker.hardening import (
    COMPROMISE_STEPS,
    CompromiseResult,
    CostResult,
    CredentialMetadata,
    EgressEntry,
    EgressPolicy,
    IdentityContract,
    ResourceLimits,
    RestoreResult,
    RotationResult,
    RunnerContract,
    enforce_cost_ceiling,
    evaluate_egress,
    load_egress_policy,
    load_identity_contract,
    load_runner_contract,
    load_strict_json,
    respond_to_compromise,
    restore_backup,
    rotate_credential,
)

OPS = Path(__file__).parents[1] / "ops" / "hardening"
RUNNER = OPS / "runner.json"
IDENTITY = OPS / "identity.json"
EGRESS = OPS / "egress.json"


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _write(directory: Path, name: str, payload: object | str) -> Path:
    path = directory / name
    text = payload if isinstance(payload, str) else json.dumps(payload)
    path.write_text(text, encoding="utf-8")
    return path


def _mutated(path: Path, **changes: object) -> dict[str, object]:
    data = json.loads(path.read_text(encoding="utf-8"))
    for key, value in changes.items():
        if value is _DELETE:
            data.pop(key, None)
        else:
            data[key] = value
    return data


_DELETE = object()


class StrictJsonTests(unittest.TestCase):
    def test_rejects_duplicate_keys_non_finite_numbers_control_characters_and_oversize(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cases = {
                "duplicate": '{"a": 1, "a": 2}',
                "nan": '{"a": NaN}',
                "infinity": '{"a": -Infinity}',
                "control": '{"a": "xy"}',
                "oversize": json.dumps({"a": "x" * 70_000}),
                "not-object": "[1, 2]",
                "truncated": '{"a": ',
            }
            for name, text in cases.items():
                with self.subTest(name=name), self.assertRaises(ContractError):
                    load_strict_json(_write(root, f"{name}.json", text))
            (root / "real.json").write_text('{"a": 1}', encoding="utf-8")
            os.symlink(root / "real.json", root / "link.json")
            with self.assertRaises(ContractError):
                load_strict_json(root / "link.json")
            with self.assertRaises(ContractError):
                load_strict_json(root / ".." / root.name / "real.json")
            with self.assertRaises(ContractError):
                load_strict_json(root / "missing.json")
            self.assertEqual(load_strict_json(root / "real.json"), {"a": 1})


class RunnerContractTests(unittest.TestCase):
    def test_tracked_runner_contract_requires_one_job_ephemeral_rootless_isolation(self) -> None:
        contract = load_runner_contract(RUNNER)
        self.assertEqual(contract.lifecycle, "ephemeral")
        self.assertEqual(contract.max_jobs_per_runner, 1)
        self.assertFalse(contract.privileged)
        self.assertTrue(contract.rootless)
        self.assertTrue(contract.read_only_root)
        self.assertTrue(contract.no_new_privileges)
        self.assertEqual(contract.capabilities_dropped, "ALL")
        self.assertEqual(contract.capabilities_added, ())
        self.assertEqual(contract.limits.pids, 128)
        self.assertEqual(contract.limits.timeout_seconds, 1800)
        with self.assertRaises(Exception):
            contract.limits.pids = 1  # type: ignore[misc]

    def test_rejects_persistent_multi_job_privileged_writable_or_capable_runners(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad = {
                "persistent": {"lifecycle": "persistent"},
                "multi-job": {"max_jobs_per_runner": 2},
                "zero-jobs": {"max_jobs_per_runner": 0},
                "bool-jobs": {"max_jobs_per_runner": True},
                "privileged": {"privileged": True},
                "root": {"rootless": False},
                "writable-root": {"read_only_root": False},
                "new-privileges": {"no_new_privileges": False},
                "added-capability": {"capabilities": {"drop": "ALL", "add": ["SYS_ADMIN"]}},
                "partial-drop": {"capabilities": {"drop": "NET_RAW", "add": []}},
                "unknown-field": {"docker_socket": "/var/run/docker.sock"},
                "missing-field": {"limits": _DELETE},
                "unbounded-pids": {"limits": {**_mutated(RUNNER)["limits"], "pids": 0}},
                "huge-memory": {"limits": {**_mutated(RUNNER)["limits"], "memory": "999g"}},
                "no-timeout": {"limits": {**_mutated(RUNNER)["limits"], "timeout_seconds": 0}},
                "unknown-limit": {"limits": {**_mutated(RUNNER)["limits"], "gpu": 1}},
                "wrong-version": {"version": 2},
            }
            for name, changes in bad.items():
                with self.subTest(name=name), self.assertRaises(ContractError):
                    load_runner_contract(_write(root, f"{name}.json", _mutated(RUNNER, **changes)))


class IdentityContractTests(unittest.TestCase):
    def test_tracked_identity_is_metadata_only_oidc_bounded_to_fifteen_minutes(self) -> None:
        contract = load_identity_contract(IDENTITY)
        self.assertEqual(contract.method, "oidc")
        self.assertFalse(contract.static_credentials)
        self.assertLessEqual(contract.max_ttl_seconds, 900)
        self.assertTrue(contract.issuer.startswith("https://"))
        self.assertIn("repository", contract.subject_claims)

    def test_rejects_static_overlong_or_secret_bearing_identity(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad = {
                "static": {"static_credentials": True},
                "pat": {"method": "personal-access-token"},
                "overlong": {"max_ttl_seconds": 901},
                "zero-ttl": {"max_ttl_seconds": 0},
                "float-ttl": {"max_ttl_seconds": 900.0},
                "http-issuer": {"issuer": "http://issuer.invalid"},
                "userinfo-issuer": {"issuer": "https://user@issuer.invalid"},
                "secret-field": {"client_secret": "SYNTHETIC_TEST_SECRET"},
                "token-field": {"token": "SYNTHETIC_TEST_SECRET"},
                "secret-audience": {"audience": "SYNTHETIC_TEST_SECRET-ghp_" + "a" * 32},
                "empty-claims": {"subject_claims": []},
                "duplicate-claims": {"subject_claims": ["repository", "repository"]},
                "unknown-claim": {"subject_claims": ["repository", "password"]},
                "unknown-field": {"private_key_path": "/tmp/key"},
            }
            for name, changes in bad.items():
                with self.subTest(name=name), self.assertRaises(ContractError):
                    load_identity_contract(_write(root, f"{name}.json", _mutated(IDENTITY, **changes)))


class EgressPolicyTests(unittest.TestCase):
    def test_tracked_egress_is_deny_by_default_https_only_through_named_proxy(self) -> None:
        policy = load_egress_policy(EGRESS)
        self.assertEqual(policy.default_action, "deny")
        self.assertFalse(policy.direct_egress)
        self.assertEqual(policy.proxy, "egress-proxy")
        self.assertTrue(policy.allow)
        for entry in policy.allow:
            self.assertEqual((entry.scheme, entry.port), ("https", 443))

    def test_rejects_direct_default_allow_plaintext_or_wildcard_egress(self) -> None:
        allow = _mutated(EGRESS)["allow"]
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bad = {
                "default-allow": {"default_action": "allow"},
                "direct": {"direct_egress": True},
                "no-proxy": {"proxy": ""},
                "unsafe-proxy": {"proxy": "proxy;rm"},
                "http": {"allow": [{"host": "api.github.com", "scheme": "http", "port": 80}]},
                "odd-port": {"allow": [{"host": "api.github.com", "scheme": "https", "port": 8443}]},
                "wildcard": {"allow": [{"host": "*.github.com", "scheme": "https", "port": 443}]},
                "ip-literal": {"allow": [{"host": "203.0.113.7", "scheme": "https", "port": 443}]},
                "uppercase": {"allow": [{"host": "API.GitHub.com", "scheme": "https", "port": 443}]},
                "duplicate": {"allow": allow + [allow[0]]},
                "unknown-entry-field": {"allow": [{**allow[0], "path": "/"}]},
                "empty-allow": {"allow": []},
                "unknown-field": {"allow_all_ports": True},
            }
            for name, changes in bad.items():
                with self.subTest(name=name), self.assertRaises(ContractError):
                    load_egress_policy(_write(root, f"{name}.json", _mutated(EGRESS, **changes)))

    def test_egress_drill_denies_unlisted_ambiguous_and_direct_requests(self) -> None:
        policy = load_egress_policy(EGRESS)
        allowed = evaluate_egress(policy, "https://api.github.com/repos", via="egress-proxy")
        self.assertTrue(allowed.allowed)
        self.assertEqual(allowed.host, "api.github.com")
        denied = {
            "unlisted": "https://evil.invalid/",
            "suffix": "https://notapi.github.com/",
            "subdomain": "https://api.github.com.evil.invalid/",
            "http": "http://api.github.com/",
            "port": "https://api.github.com:8443/",
            "userinfo": "https://api.github.com@evil.invalid/",
            "ip": "https://203.0.113.7/",
            "trailing-dot": "https://api.github.com./",
            "control": "https://api.github.com/\n",
            "empty": "",
            "scheme-only": "https://",
            "overlong": "https://api.github.com/" + "a" * 5000,
        }
        for name, url in denied.items():
            with self.subTest(name=name):
                decision = evaluate_egress(policy, url, via="egress-proxy")
                self.assertFalse(decision.allowed)
        direct = evaluate_egress(policy, "https://api.github.com/", via="direct")
        self.assertFalse(direct.allowed)
        self.assertIn("proxy", direct.reason)
        self.assertFalse(evaluate_egress(policy, "https://api.github.com/", via="").allowed)


class RestoreDrillTests(unittest.TestCase):
    def _backup(self, root: Path) -> tuple[Path, dict[str, str]]:
        backup = root / "backup"
        (backup / "nested").mkdir(parents=True)
        files = {"ledger.json": b'{"entries": []}\n', "nested/note.md": b"# note\n"}
        manifest = {}
        for name, data in files.items():
            (backup / name).write_bytes(data)
            manifest[name] = _sha256(data)
        return backup, manifest

    def test_restore_is_hash_exact_and_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup, manifest = self._backup(root)
            destination = root / "restored"
            result = restore_backup(backup, destination, manifest)
            self.assertEqual(result.destination, destination)
            self.assertEqual(result.total_bytes, 23)
            self.assertEqual(dict(result.files), manifest)
            self.assertEqual(len(result.digest), 64)
            for name, digest in manifest.items():
                self.assertEqual(_sha256((destination / name).read_bytes()), digest)
            self.assertFalse(list(root.glob("*staging*")))
            with self.assertRaises(Exception):
                result.files = ()  # type: ignore[misc]
            self.assertEqual(restore_backup(backup, root / "again", manifest).digest, result.digest)

    def test_restore_rejects_tamper_traversal_symlink_collision_and_publishes_nothing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup, manifest = self._backup(root)
            os.symlink(backup / "ledger.json", backup / "link.json")
            (root / "outside.txt").write_bytes(b"outside\n")
            tampered = dict(manifest)
            tampered["ledger.json"] = _sha256(b"different")
            bad_manifests = {
                "tamper": tampered,
                "missing-file": {**manifest, "absent.txt": _sha256(b"")},
                "traversal": {**manifest, "../outside.txt": _sha256(b"outside\n")},
                "absolute": {**manifest, str(root / "outside.txt"): _sha256(b"outside\n")},
                "symlink": {**manifest, "link.json": manifest["ledger.json"]},
                "case-collision": {**manifest, "LEDGER.json": manifest["ledger.json"]},
                "dir-collision": {**manifest, "nested": manifest["ledger.json"]},
                "bad-digest": {**manifest, "nested/note.md": "zz"},
                "control-path": {**manifest, "bad\nname": manifest["ledger.json"]},
                "empty": {},
            }
            for name, candidate in bad_manifests.items():
                destination = root / f"restore-{name}"
                with self.subTest(name=name), self.assertRaises(ContractError):
                    restore_backup(backup, destination, candidate)
                self.assertFalse(destination.exists(), name)
                self.assertFalse(list(root.glob("*staging*")), name)
            existing = root / "existing"
            existing.mkdir()
            with self.assertRaises(ContractError):
                restore_backup(backup, existing, manifest)
            self.assertEqual(list(existing.iterdir()), [])
            linked_parent = root / "linked-parent"
            os.symlink(root, linked_parent)
            with self.assertRaises(ContractError):
                restore_backup(backup, linked_parent / "via-link", manifest)
            self.assertFalse((root / "via-link").exists())
            with self.assertRaises(ContractError):
                restore_backup(root / "missing-backup", root / "x", manifest)


class RotationAndCompromiseDrillTests(unittest.TestCase):
    def test_rotation_is_opaque_metadata_only_and_ordered(self) -> None:
        current = CredentialMetadata("cred-2026-a", "oidc-token", 3, 900)
        replacement = CredentialMetadata("cred-2026-b", "oidc-token", 4, 600)
        result = rotate_credential(current, replacement)
        self.assertEqual(result.steps, ("issue", "verify", "cutover", "revoke"))
        self.assertEqual(result.revoked_id, "cred-2026-a")
        self.assertEqual(result.active_id, "cred-2026-b")
        self.assertEqual(len(result.digest), 64)
        self.assertEqual(rotate_credential(current, replacement).digest, result.digest)
        self.assertNotIn("SYNTHETIC", repr(result))
        # Invalid metadata is rejected at construction and again at rotation,
        # so each candidate is built inside the assertion.
        bad = {
            "same-id": ("cred-2026-a", "oidc-token", 4, 600),
            "stale-generation": ("cred-2026-c", "oidc-token", 3, 600),
            "skipped-generation": ("cred-2026-c", "oidc-token", 5, 600),
            "kind-change": ("cred-2026-c", "static-key", 4, 600),
            "overlong": ("cred-2026-c", "oidc-token", 4, 901),
            "zero-ttl": ("cred-2026-c", "oidc-token", 4, 0),
            "float-ttl": ("cred-2026-c", "oidc-token", 4, 600.0),
            "bool-generation": ("cred-2026-c", "oidc-token", True, 600),
            "secret-value": ("ghp_" + "a" * 36, "oidc-token", 4, 600),
            "secret-kind": ("cred-2026-c", "password=SYNTHETIC_TEST_SECRET", 4, 600),
            "long-id": ("c" * 129, "oidc-token", 4, 600),
            "control": ("cred\n2026", "oidc-token", 4, 600),
        }
        for name, fields in bad.items():
            with self.subTest(name=name), self.assertRaises(ContractError):
                rotate_credential(current, CredentialMetadata(*fields))  # type: ignore[arg-type]
        with self.assertRaises(ContractError):
            rotate_credential(CredentialMetadata("cred-x", "static-key", 3, 900), replacement)
        forged = CredentialMetadata.__new__(CredentialMetadata)
        for field, value in (("credential_id", "cred-2026-c"), ("kind", "static-key"), ("generation", 4), ("ttl_seconds", 600)):
            object.__setattr__(forged, field, value)
        with self.assertRaises(ContractError):
            rotate_credential(current, forged)
        with self.assertRaises(Exception):
            current.extra = 1  # type: ignore[attr-defined]

    def test_compromise_response_requires_exact_order_and_fresh_runner(self) -> None:
        self.assertEqual(COMPROMISE_STEPS, ("detect", "revoke", "destroy", "rebuild", "canary"))
        result = respond_to_compromise("runner-old", "runner-new", COMPROMISE_STEPS)
        self.assertEqual(result.steps, COMPROMISE_STEPS)
        self.assertEqual(result.destroyed_runner, "runner-old")
        self.assertEqual(result.replacement_runner, "runner-new")
        self.assertEqual(respond_to_compromise("runner-old", "runner-new", COMPROMISE_STEPS).digest, result.digest)
        bad = {
            "list": list(COMPROMISE_STEPS),
            "reordered": ("detect", "destroy", "revoke", "rebuild", "canary"),
            "missing": ("detect", "revoke", "destroy", "rebuild"),
            "duplicate": ("detect", "revoke", "revoke", "destroy", "rebuild", "canary"),
            "extra": COMPROMISE_STEPS + ("celebrate",),
            "empty": (),
            "string": "detect revoke destroy rebuild canary",
        }
        for name, steps in bad.items():
            with self.subTest(name=name), self.assertRaises(ContractError):
                respond_to_compromise("runner-old", "runner-new", steps)  # type: ignore[arg-type]
        with self.assertRaises(ContractError):
            respond_to_compromise("runner-old", "runner-old", COMPROMISE_STEPS)
        with self.assertRaises(ContractError):
            respond_to_compromise("runner old", "runner-new", COMPROMISE_STEPS)


class CostCeilingTests(unittest.TestCase):
    def test_cost_ceiling_fails_closed_before_overspend(self) -> None:
        result = enforce_cost_ceiling(400, (100, 150, 100, 60, 10))
        self.assertTrue(result.halted)
        self.assertEqual(result.accepted, 3)
        self.assertEqual(result.spent_cents, 350)
        self.assertEqual(result.ceiling_cents, 400)
        exact = enforce_cost_ceiling(400, (200, 200))
        self.assertFalse(exact.halted)
        self.assertEqual(exact.spent_cents, 400)
        self.assertEqual(enforce_cost_ceiling(400, ()).accepted, 0)
        self.assertEqual(enforce_cost_ceiling(400, (100, 150, 100, 60, 10)).digest, result.digest)
        for name, ceiling, charges in (
            ("zero-ceiling", 0, (1,)),
            ("negative-ceiling", -1, ()),
            ("float-ceiling", 4.0, ()),
            ("bool-ceiling", True, ()),
            ("negative-charge", 400, (-1,)),
            ("float-charge", 400, (1.5,)),
            ("bool-charge", 400, (True,)),
            ("string-charge", 400, ("1",)),
            ("string-charges", 400, "111"),
            ("list-charges", 400, [1]),
            ("unbounded", 400, (1,) * 10_001),
            ("huge-ceiling", 10**13, ()),
        ):
            with self.subTest(name=name), self.assertRaises(ContractError):
                enforce_cost_ceiling(ceiling, charges)  # type: ignore[arg-type]


class ReworkRegressionTests(unittest.TestCase):
    """Isolated regressions for the orchestrator's REWORK 1 probes."""

    def test_evaluate_egress_revalidates_a_directly_constructed_policy(self) -> None:
        evil = EgressEntry("evil.invalid", "https", 443)
        with self.assertRaises(ContractError):
            evaluate_egress(EgressPolicy("allow", True, "direct", (evil,)), "https://evil.invalid/", via="direct")
        with self.assertRaises(ContractError):
            EgressPolicy("deny", True, "egress-proxy", (evil,))
        with self.assertRaises(ContractError):
            EgressPolicy("deny", False, "egress-proxy", [evil])  # type: ignore[arg-type]
        with self.assertRaises(ContractError):
            EgressEntry("evil.invalid", "http", 80)
        # Bypass the constructor entirely; evaluation must still fail closed.
        forged = EgressPolicy.__new__(EgressPolicy)
        for field, value in (("default_action", "allow"), ("direct_egress", True), ("proxy", "direct"), ("allow", (evil,))):
            object.__setattr__(forged, field, value)
        with self.assertRaises(ContractError):
            evaluate_egress(forged, "https://evil.invalid/", via="direct")
        with self.assertRaises(ContractError):
            evaluate_egress(load_strict_json(EGRESS), "https://api.github.com/", via="egress-proxy")  # type: ignore[arg-type]
        policy = load_egress_policy(EGRESS)
        with self.assertRaises(Exception):
            policy.extra = 1  # type: ignore[attr-defined]

    def test_drills_require_exact_tuple_steps_and_charges(self) -> None:
        with self.assertRaises(ContractError):
            respond_to_compromise("runner-old", "runner-new", list(COMPROMISE_STEPS))
        with self.assertRaises(ContractError):
            enforce_cost_ceiling(400, [1])
        with self.assertRaises(ContractError):
            enforce_cost_ceiling(400, range(1))  # type: ignore[arg-type]
        self.assertEqual(enforce_cost_ceiling(400, (1,)).accepted, 1)

    def test_public_contracts_and_results_reject_directly_constructed_invalid_values(self) -> None:
        valid_limits = ResourceLimits("1", "512m", 128, 1800)
        with self.assertRaises(ContractError):
            ResourceLimits("99", "512m", 128, 1800)
        with self.assertRaises(ContractError):
            RunnerContract("persistent", 1, False, True, True, True, "ALL", (), valid_limits)
        with self.assertRaises(ContractError):
            IdentityContract("oidc", "https://issuer.invalid", "ice-maker", 901, False, ("repository",))
        with self.assertRaises(ContractError):
            hardening.EgressDecision(True, "evil.invalid", "request host is not on the allowlist")
        with self.assertRaises(ContractError):
            RestoreResult(Path("restored"), (("file", "0" * 64),), 1, "0" * 64)
        with self.assertRaises(ContractError):
            RotationResult(hardening.ROTATION_STEPS, "cred-a", "cred-b", 2, "0" * 64)
        with self.assertRaises(ContractError):
            CompromiseResult(COMPROMISE_STEPS, "runner-a", "runner-b", "0" * 64)
        with self.assertRaises(ContractError):
            CostResult(400, 500, 1, False, "0" * 64)

    def _backup(self, root: Path) -> tuple[Path, dict[str, str]]:
        return RestoreDrillTests._backup(self, root)  # type: ignore[arg-type]

    def test_restore_race_keeps_existing_destination_and_cleans_only_staging(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup, manifest = self._backup(root)
            destination = root / "restored"
            original = hardening._rename_noreplace

            def racing(parent_fd: int, staging_name: str, destination_name: str) -> None:
                destination.mkdir()
                (destination / "sentinel").write_bytes(b"keep\n")
                original(parent_fd, staging_name, destination_name)

            with mock.patch.object(hardening, "_rename_noreplace", racing), self.assertRaises(ContractError):
                restore_backup(backup, destination, manifest)
            self.assertEqual([entry.name for entry in destination.iterdir()], ["sentinel"])
            self.assertEqual((destination / "sentinel").read_bytes(), b"keep\n")
            self.assertEqual(sorted(entry.name for entry in root.iterdir()), ["backup", "restored"])

    def test_restore_fails_closed_without_atomic_noreplace_rename(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup, manifest = self._backup(root)
            with mock.patch.object(hardening, "_RENAMEAT2", None), self.assertRaises(ContractError):
                restore_backup(backup, root / "restored", manifest)
            self.assertEqual([entry.name for entry in root.iterdir()], ["backup"])

    def test_restore_reads_backup_through_pinned_no_follow_descriptors(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            backup, manifest = self._backup(root)
            os.symlink(backup, root / "backup-link")
            with self.assertRaises(ContractError):
                restore_backup(root / "backup-link", root / "restored-a", manifest)
            elsewhere = root / "elsewhere"
            elsewhere.mkdir()
            (elsewhere / "note.md").write_bytes(b"# note\n")
            (backup / "nested" / "note.md").unlink()
            (backup / "nested").rmdir()
            os.symlink(elsewhere, backup / "nested")
            with self.assertRaises(ContractError):
                restore_backup(backup, root / "restored-b", manifest)
            self.assertEqual(sorted(entry.name for entry in root.iterdir()), ["backup", "backup-link", "elsewhere"])
            with self.assertRaises(ContractError):
                load_runner_contract(root / "backup-link" / "ledger.json")


if __name__ == "__main__":
    unittest.main()

"""Behavioral tests for the pure registry and trusted grant admission ports.

Imports stay on domain and admission. SQLite, the store, and the controller are
out of this suite.
"""

import unittest

from agent_workforce.admission import AdmissionError, admit
from agent_workforce.domain import (
    Registry,
    RegistryError,
    canonical_path,
    paths_overlap,
)

OWNER = "owner-1"
OTHER_OWNER = "owner-2"
ISSUER = "issuer-1"
AGENT = "agent-1"
NOW = 1_700_000_000


def _records():
    return {
        "workers": {
            "worker-1": {
                "owner": OWNER,
                "revision": 2,
                "role": "writer",
                "lifecycle": "active",
                "label": "synthetic-writer",
            },
            "worker-2": {
                "owner": OWNER,
                "revision": 1,
                "role": "writer",
                "lifecycle": "active",
            },
        },
        "products": {
            "product-1": {
                "owner": OWNER,
                "revision": 3,
                "harness": "synthetic-harness",
                "harness_version": "1.2.3",
            }
        },
        "accounts": {
            "account-1": {
                "owner": OWNER,
                "revision": 4,
                "product_id": "product-1",
                "lifecycle": "active",
                "concurrency_limit": 2,
            }
        },
        "entitlements": {
            "entitlement-1": {
                "owner": OWNER,
                "revision": 5,
                "account_ref": "account-1",
                "quota_pool_ref": "pool-1",
                "billing_class": "personal",
                "actual_entitlement": "verified",
                "expires_at": NOW + 1000,
                "concurrency_limit": 2,
                "quota_remaining": None,
            }
        },
        "profiles": {
            "profile-1": {
                "owner": OWNER,
                "revision": 6,
                "read_paths": ["src"],
                "write_paths": ["src"],
                "timeout_seconds": 30,
                "capabilities": ["execute", "review", "rework"],
            }
        },
        "resources": {
            "resource-1": {
                "owner": OWNER,
                "revision": 7,
                "kind": "workspace",
                "read_paths": ["src"],
                "write_paths": ["src"],
            }
        },
        "routes": {
            "route-1": {
                "owner": OWNER,
                "revision": 8,
                "worker_id": "worker-1",
                "product_id": "product-1",
                "account_ref": "account-1",
                "entitlement_ref": "entitlement-1",
                "profile_id": "profile-1",
                "model": "synthetic-model",
                "harness_version": "1.2.3",
                "runtime_status": "verified",
                "policy_review": "supported_for_scope",
                "evidence": {
                    "route_revision": 8,
                    "worker_revision": 2,
                    "account_revision": 4,
                    "entitlement_revision": 5,
                    "profile_revision": 6,
                    "harness_version": "1.2.3",
                    "model": "synthetic-model",
                },
            }
        },
        "jobs": {
            "job-1": {
                "owner": OWNER,
                "revision": 9,
                "input_revision": 11,
                "ac_revision": 12,
                "revocation_epoch": 0,
                "deadline": NOW + 500,
                "max_concurrency": 1,
            }
        },
    }


def _grant():
    return {
        "grant_id": "grant-1",
        "revision": 13,
        "issuer": ISSUER,
        "job_id": "job-1",
        "worker_id": "worker-1",
        "route_ids": ["route-1"],
        "resource_scopes": {
            "resource-1": {"read": ["src"], "write": ["src"]},
        },
        "operations": ["execute", "review", "rework"],
        "allowed_steps": ["step-1"],
        "input_revision": 11,
        "ac_revision": 12,
        "expires_at": NOW + 400,
        "revocation_epoch": 0,
        "revoked": False,
        "max_turns": 4,
        "max_messages": 6,
        "max_hops": 2,
        "allow_agent_trigger": False,
        "allowed_callers": [AGENT],
    }


def _request():
    return {
        "sender": ISSUER,
        "origin": "operator",
        "grant_id": "grant-1",
        "job_id": "job-1",
        "step_id": "step-1",
        "input": {"brief": "synthetic"},
        "input_revision": 11,
        "ac_revision": 12,
        "worker_id": "worker-1",
        "route_id": "route-1",
        "route_revision": 8,
        "worker_revision": 2,
        "account_revision": 4,
        "entitlement_revision": 5,
        "profile_revision": 6,
        "operation": "execute",
        "resource_scopes": {
            "resource-1": {"read": ["src/mod"], "write": ["src/mod"]},
        },
        "session_binding_id": "session-1",
        "hop": 0,
    }


def _registry(records=None, issuers=(ISSUER,)):
    return Registry(_records() if records is None else records, trusted_issuers=issuers)


class CanonicalPathTests(unittest.TestCase):
    def test_accepts_relative_and_explicit_root(self):
        self.assertEqual(canonical_path("src/mod"), "src/mod")
        self.assertEqual(canonical_path("."), ".")
        self.assertEqual(canonical_path(".hidden"), ".hidden")

    def test_rejects_escape_forms(self):
        rejected = [
            "",
            "..",
            "../secret",
            "src/../secret",
            "src/../../etc",
            "src/./mod",
            "src//mod",
            "/src",
            "src\\mod",
            "src/",
            ".",
            "~/.ssh",
            "foo/~/secret",
            "src/mod ",
            3,
            None,
        ]
        # "." is valid; keep the reject list free of the explicit root.
        rejected.remove(".")
        for value in rejected:
            with self.subTest(value=value):
                with self.assertRaises(RegistryError):
                    canonical_path(value)

    def test_overlap_is_segment_boundary_and_root_covers_all(self):
        self.assertTrue(paths_overlap("src", "src"))
        self.assertTrue(paths_overlap("src", "src/mod"))
        self.assertTrue(paths_overlap("src/mod", "src"))
        self.assertTrue(paths_overlap(".", "src/mod"))
        self.assertTrue(paths_overlap("src/mod", "."))
        self.assertFalse(paths_overlap("src", "src2"))
        self.assertFalse(paths_overlap("src/a", "src/b"))
        self.assertFalse(paths_overlap("src/mod", "src/module"))

    def test_overlap_rejects_non_canonical_inputs(self):
        for left, right in (("../x", "src"), ("/etc", "src"), ("a\\b", "a")):
            with self.subTest(left=left, right=right):
                with self.assertRaises(RegistryError):
                    paths_overlap(left, right)


class RegistryTests(unittest.TestCase):
    def test_exports_and_snapshot_shape(self):
        self.assertTrue(issubclass(RegistryError, ValueError))
        registry = _registry()
        snapshot = registry.snapshot()
        self.assertEqual(
            set(snapshot),
            {
                "workers",
                "products",
                "accounts",
                "entitlements",
                "profiles",
                "resources",
                "routes",
                "jobs",
                "sessions",
            },
        )
        self.assertEqual(registry.trusted_issuers, (ISSUER,))
        self.assertEqual(snapshot["workers"]["worker-1"]["label"], "synthetic-writer")
        self.assertIsNone(snapshot["entitlements"]["entitlement-1"]["quota_remaining"])

    def test_get_and_snapshot_are_detached_from_inputs_and_each_other(self):
        records = _records()
        issuers = [ISSUER]
        registry = Registry(records, trusted_issuers=issuers)
        records["workers"]["worker-1"]["role"] = "reviewer"
        records["workers"]["worker-1"]["label"] = "changed"
        records["routes"]["route-1"]["evidence"]["model"] = "mutated"
        records["profiles"]["profile-1"]["capabilities"].append("root")
        records["profiles"]["profile-1"]["read_paths"].append("etc")
        issuers.append("attacker")

        first = registry.get("workers", "worker-1")
        self.assertEqual(first["role"], "writer")
        self.assertEqual(first["label"], "synthetic-writer")
        first["role"] = "reviewer"
        first["label"] = "local"
        self.assertEqual(registry.get("workers", "worker-1")["role"], "writer")
        self.assertEqual(registry.get("workers", "worker-1")["label"], "synthetic-writer")

        route = registry.get("routes", "route-1")
        route["evidence"]["model"] = "local-model"
        route["evidence"]["route_revision"] = 1
        self.assertEqual(
            registry.get("routes", "route-1")["evidence"]["model"], "synthetic-model"
        )
        self.assertEqual(
            registry.get("routes", "route-1")["evidence"]["route_revision"], 8
        )

        profile = registry.get("profiles", "profile-1")
        profile["capabilities"].append("shell")
        profile["write_paths"].append("/tmp")
        self.assertEqual(
            registry.get("profiles", "profile-1")["capabilities"],
            ["execute", "review", "rework"],
        )
        self.assertEqual(registry.get("profiles", "profile-1")["write_paths"], ["src"])

        snap = registry.snapshot()
        snap["jobs"]["job-1"]["deadline"] = 1
        snap["resources"]["resource-1"]["write_paths"].append("secret")
        self.assertEqual(registry.snapshot()["jobs"]["job-1"]["deadline"], NOW + 500)
        self.assertEqual(
            registry.snapshot()["resources"]["resource-1"]["write_paths"], ["src"]
        )
        self.assertEqual(registry.trusted_issuers, (ISSUER,))
        self.assertIsNone(registry.get("workers", "missing"))
        with self.assertRaises(RegistryError):
            registry.get("unsupported-category", "worker-1")

    def test_mismatched_evidence_is_kept_not_repaired(self):
        records = _records()
        records["routes"]["route-1"]["evidence"]["worker_revision"] = 99
        records["routes"]["route-1"]["evidence"]["model"] = "other-model"
        registry = Registry(records, trusted_issuers=(ISSUER,))
        evidence = registry.get("routes", "route-1")["evidence"]
        self.assertEqual(evidence["worker_revision"], 99)
        self.assertEqual(evidence["model"], "other-model")
        self.assertEqual(registry.get("workers", "worker-1")["revision"], 2)
        self.assertEqual(registry.get("routes", "route-1")["model"], "synthetic-model")

    def test_missing_quota_remaining_is_rejected_not_zero(self):
        records = _records()
        del records["entitlements"]["entitlement-1"]["quota_remaining"]
        with self.assertRaises(RegistryError):
            _registry(records)

    def test_explicit_zero_quota_is_preserved(self):
        records = _records()
        records["entitlements"]["entitlement-1"]["quota_remaining"] = 0
        registry = _registry(records)
        self.assertEqual(
            registry.get("entitlements", "entitlement-1")["quota_remaining"], 0
        )

    def test_unknown_quota_stays_none(self):
        registry = _registry()
        self.assertIsNone(
            registry.get("entitlements", "entitlement-1")["quota_remaining"]
        )

    def test_revision_and_limit_types(self):
        cases = [
            ("workers", "worker-1", "revision", True),
            ("workers", "worker-1", "revision", False),
            ("workers", "worker-1", "revision", 0),
            ("workers", "worker-1", "revision", -1),
            ("workers", "worker-1", "revision", 1.5),
            ("jobs", "job-1", "input_revision", True),
            ("jobs", "job-1", "ac_revision", 0),
            ("jobs", "job-1", "revocation_epoch", -1),
            ("jobs", "job-1", "revocation_epoch", False),
            ("jobs", "job-1", "revocation_epoch", 1.0),
            ("accounts", "account-1", "concurrency_limit", 0),
            ("accounts", "account-1", "concurrency_limit", True),
            ("accounts", "account-1", "concurrency_limit", 2.0),
            ("entitlements", "entitlement-1", "concurrency_limit", 0),
            ("jobs", "job-1", "max_concurrency", 0),
            ("profiles", "profile-1", "timeout_seconds", 0),
            ("profiles", "profile-1", "timeout_seconds", float("inf")),
            ("profiles", "profile-1", "timeout_seconds", float("nan")),
            ("entitlements", "entitlement-1", "expires_at", float("inf")),
            ("jobs", "job-1", "deadline", float("nan")),
            ("entitlements", "entitlement-1", "quota_remaining", True),
            ("entitlements", "entitlement-1", "quota_remaining", "0"),
            ("workers", "worker-1", "role", "admin"),
            ("workers", "worker-1", "lifecycle", "sleeping"),
            ("accounts", "account-1", "lifecycle", "active-ish"),
            ("entitlements", "entitlement-1", "billing_class", "subscription"),
            ("entitlements", "entitlement-1", "actual_entitlement", "maybe"),
            ("profiles", "profile-1", "read_paths", "src"),
            ("profiles", "profile-1", "write_paths", ["../secret"]),
            ("resources", "resource-1", "read_paths", ["/etc"]),
            ("resources", "resource-1", "kind", ""),
            ("routes", "route-1", "policy_review", ""),
        ]
        for kind, key, field, value in cases:
            with self.subTest(kind=kind, field=field, value=value):
                records = _records()
                records[kind][key][field] = value
                with self.assertRaises(RegistryError):
                    _registry(records)

    def test_zero_revocation_epoch_is_valid(self):
        registry = _registry()
        self.assertEqual(registry.get("jobs", "job-1")["revocation_epoch"], 0)

    def test_reference_and_owner_consistency(self):
        broken = []

        missing_product = _records()
        missing_product["accounts"]["account-1"]["product_id"] = "product-missing"
        broken.append(missing_product)

        missing_worker = _records()
        missing_worker["routes"]["route-1"]["worker_id"] = "worker-missing"
        broken.append(missing_worker)

        account_split = _records()
        account_split["accounts"]["account-2"] = {
            "owner": OWNER,
            "revision": 1,
            "product_id": "product-1",
            "lifecycle": "active",
            "concurrency_limit": 1,
        }
        account_split["entitlements"]["entitlement-1"]["account_ref"] = "account-2"
        broken.append(account_split)

        owner_profile = _records()
        owner_profile["profiles"]["profile-1"]["owner"] = OTHER_OWNER
        broken.append(owner_profile)

        owner_product = _records()
        owner_product["products"]["product-1"]["owner"] = OTHER_OWNER
        broken.append(owner_product)

        unknown_category = _records()
        unknown_category["unsupported-category"] = {}
        broken.append(unknown_category)

        for records in broken:
            with self.subTest(records=sorted(records)):
                with self.assertRaises(RegistryError):
                    _registry(records)

    def test_non_executable_strings_remain_data(self):
        records = _records()
        payload = "__import__('os').system('echo pwned')"
        records["profiles"]["profile-1"]["capabilities"].append(payload)
        registry = _registry(records)
        self.assertIn(
            payload, registry.get("profiles", "profile-1")["capabilities"]
        )

    def test_empty_registry_snapshot(self):
        registry = Registry({}, trusted_issuers=())
        snapshot = registry.snapshot()
        self.assertEqual(snapshot["workers"], {})
        self.assertEqual(snapshot["routes"], {})
        self.assertEqual(registry.trusted_issuers, ())
        self.assertIsNone(registry.get("jobs", "job-1"))


class AdmissionTests(unittest.TestCase):
    def test_error_exposes_reason(self):
        self.assertTrue(issubclass(AdmissionError, ValueError))
        error = AdmissionError("revoked")
        self.assertEqual(error.reason, "revoked")
        self.assertIn("revoked", str(error))

    def _admit(self, records=None, grant=None, request=None, caller=ISSUER, usage=None, issuers=(ISSUER,)):
        return admit(
            _registry(records, issuers),
            _grant() if grant is None else grant,
            _request() if request is None else request,
            authenticated_caller=caller,
            now=NOW,
            usage=usage,
        )

    def test_operator_personal_success_detaches_snapshots_and_keeps_unknown_usage(self):
        records = _records()
        grant = _grant()
        request = _request()
        registry = _registry(records)
        result = admit(
            registry,
            grant,
            request,
            authenticated_caller=ISSUER,
            now=NOW,
            usage=None,
        )
        self.assertEqual(
            set(result),
            {
                "route",
                "account",
                "entitlement",
                "profile",
                "worker",
                "job",
                "grant",
                "request",
                "usage",
            },
        )
        self.assertEqual(result["request"]["sender"], ISSUER)
        self.assertEqual(result["request"]["caller"], ISSUER)
        self.assertEqual(result["request"]["operation"], "execute")
        self.assertEqual(
            result["request"]["resource_scopes"]["resource-1"]["write"], ["src/mod"]
        )
        self.assertNotIn("trusted_issuers", result["request"])
        self.assertEqual(result["grant"]["issuer"], ISSUER)
        self.assertEqual(result["grant"]["max_turns"], 4)
        self.assertFalse(result["grant"]["revoked"])
        self.assertEqual(result["usage"]["turns"], 0)
        self.assertEqual(result["usage"]["messages"], 0)
        self.assertIsNone(result["usage"]["provider_tokens"])
        self.assertIsNone(result["usage"]["provider_cost"])
        self.assertIsNone(result["usage"]["quota_remaining"])
        self.assertIsNone(result["entitlement"]["quota_remaining"])
        self.assertEqual(result["route"]["evidence"]["route_revision"], 8)
        self.assertEqual(result["worker"]["lifecycle"], "active")

        result["worker"]["lifecycle"] = "retired"
        result["route"]["evidence"]["model"] = "changed"
        result["profile"]["capabilities"].append("shell")
        result["profile"]["write_paths"].append("secret")
        result["entitlement"]["quota_remaining"] = 0
        result["grant"]["max_turns"] = 1
        result["grant"]["revoked"] = True
        result["request"]["resource_scopes"]["resource-1"]["write"].append("../etc")
        result["job"]["deadline"] = 1
        result["usage"]["provider_tokens"] = 0
        result["usage"]["quota_remaining"] = 0

        self.assertEqual(registry.get("workers", "worker-1")["lifecycle"], "active")
        self.assertEqual(
            registry.get("routes", "route-1")["evidence"]["model"], "synthetic-model"
        )
        self.assertEqual(
            registry.get("profiles", "profile-1")["capabilities"],
            ["execute", "review", "rework"],
        )
        self.assertEqual(registry.get("profiles", "profile-1")["write_paths"], ["src"])
        self.assertIsNone(
            registry.get("entitlements", "entitlement-1")["quota_remaining"]
        )
        self.assertEqual(grant["max_turns"], 4)
        self.assertFalse(grant["revoked"])
        self.assertEqual(request["resource_scopes"]["resource-1"]["write"], ["src/mod"])
        self.assertEqual(registry.snapshot()["jobs"]["job-1"]["deadline"], NOW + 500)

        again = admit(
            registry,
            grant,
            request,
            authenticated_caller=ISSUER,
            now=NOW,
            usage=None,
        )
        self.assertIsNone(again["usage"]["provider_tokens"])
        self.assertIsNone(again["usage"]["quota_remaining"])
        self.assertIsNot(again["route"], result["route"])
        self.assertIsNot(again["grant"], grant)

    def test_request_trust_fields_do_not_grant_trust(self):
        request = _request()
        request["trusted_issuers"] = ["attacker"]
        request["issuer"] = "attacker"
        result = self._admit(request=request)
        self.assertEqual(result["grant"]["issuer"], ISSUER)
        self.assertNotIn("trusted_issuers", result["request"])
        self.assertNotIn("issuer", result["request"])

        forged = _grant()
        forged["issuer"] = "attacker"
        request["issuer"] = "attacker"
        request["trusted_issuers"] = ["attacker"]
        with self.assertRaises(AdmissionError) as caught:
            self._admit(grant=forged, request=request)
        self.assertEqual(caught.exception.reason, "untrusted_issuer")

    def test_known_usage_is_returned_and_unknown_fields_stay_none(self):
        result = self._admit(usage={"turns": 1, "provider_tokens": 7, "provider_cost": 1.5})
        self.assertEqual(result["usage"]["turns"], 1)
        self.assertEqual(result["usage"]["messages"], 0)
        self.assertEqual(result["usage"]["provider_tokens"], 7)
        self.assertEqual(result["usage"]["provider_cost"], 1.5)
        self.assertIsNone(result["usage"]["quota_remaining"])

    def test_explicit_provider_zero_is_preserved(self):
        result = self._admit(usage={"provider_tokens": 0, "provider_cost": 0})
        self.assertEqual(result["usage"]["provider_tokens"], 0)
        self.assertEqual(result["usage"]["provider_cost"], 0)
        self.assertIsNone(result["usage"]["quota_remaining"])

    def test_usage_cannot_invent_quota(self):
        result = self._admit(usage={"quota_remaining": 0, "turns": 0, "messages": 0})
        self.assertIsNone(result["usage"]["quota_remaining"])
        self.assertIsNone(result["entitlement"]["quota_remaining"])

    def test_agent_api_success_at_hop_cap_with_known_quota(self):
        records = _records()
        records["entitlements"]["entitlement-1"]["billing_class"] = "api"
        records["entitlements"]["entitlement-1"]["quota_remaining"] = 5
        grant = _grant()
        grant["allow_agent_trigger"] = True
        request = _request()
        request["origin"] = "agent"
        request["sender"] = AGENT
        request["caller"] = AGENT
        request["hop"] = 2
        result = self._admit(
            records=records,
            grant=grant,
            request=request,
            caller=AGENT,
            usage={"turns": 3, "messages": 5},
        )
        self.assertEqual(result["request"]["origin"], "agent")
        self.assertEqual(result["request"]["caller"], AGENT)
        self.assertEqual(result["request"]["hop"], 2)
        self.assertEqual(result["usage"]["turns"], 3)
        self.assertEqual(result["usage"]["messages"], 5)
        self.assertEqual(result["usage"]["quota_remaining"], 5)
        self.assertIsNone(result["usage"]["provider_tokens"])
        self.assertIsNone(result["usage"]["provider_cost"])
        self.assertEqual(result["entitlement"]["billing_class"], "api")

    def test_reviewer_read_only_success(self):
        records = _records()
        records["workers"]["worker-1"]["role"] = "reviewer"
        request = _request()
        request["operation"] = "review"
        request["resource_scopes"] = {"resource-1": {"read": ["src/mod"], "write": []}}
        result = self._admit(records=records, request=request)
        self.assertEqual(result["worker"]["role"], "reviewer")
        self.assertEqual(result["request"]["operation"], "review")
        self.assertEqual(result["request"]["resource_scopes"]["resource-1"]["write"], [])

    def test_explicit_root_scope_succeeds_only_when_granted(self):
        records = _records()
        records["profiles"]["profile-1"]["read_paths"] = ["."]
        records["profiles"]["profile-1"]["write_paths"] = ["."]
        records["resources"]["resource-1"]["read_paths"] = ["."]
        records["resources"]["resource-1"]["write_paths"] = ["."]
        grant = _grant()
        grant["resource_scopes"] = {"resource-1": {"read": ["."], "write": ["."]}}
        request = _request()
        request["resource_scopes"] = {"resource-1": {"read": ["."], "write": ["src/mod"]}}
        result = self._admit(records=records, grant=grant, request=request)
        self.assertEqual(result["request"]["resource_scopes"]["resource-1"]["read"], ["."])

    def test_empty_scope_allows_no_path(self):
        records = _records()
        records["profiles"]["profile-1"]["read_paths"] = []
        records["profiles"]["profile-1"]["write_paths"] = []
        records["resources"]["resource-1"]["read_paths"] = []
        records["resources"]["resource-1"]["write_paths"] = []
        grant = _grant()
        grant["resource_scopes"] = {"resource-1": {"read": [], "write": []}}
        request = _request()
        request["resource_scopes"] = {"resource-1": {"read": [], "write": []}}
        result = self._admit(records=records, grant=grant, request=request)
        self.assertEqual(result["request"]["resource_scopes"]["resource-1"]["read"], [])

        request["resource_scopes"] = {"resource-1": {"read": ["src"], "write": []}}
        with self.assertRaises(AdmissionError) as caught:
            self._admit(records=records, grant=grant, request=request)
        self.assertEqual(caught.exception.reason, "scope_escape")

    def _reject(self, reason, **kwargs):
        with self.assertRaises(AdmissionError) as caught:
            self._admit(**kwargs)
        self.assertEqual(caught.exception.reason, reason)

    def test_forged_sender_caller_and_grant(self):
        sender = _request()
        sender["sender"] = AGENT
        self._reject("forged_sender", request=sender)

        caller = _request()
        caller["caller"] = AGENT
        self._reject("forged_caller", request=caller)

        claimed = _request()
        claimed["claimed_caller"] = "someone-else"
        self._reject("forged_caller", request=claimed)

        forged = _request()
        forged["grant_id"] = "grant-forged"
        self._reject("forged_grant", request=forged)

    def test_inactive_worker_and_account(self):
        for lifecycle in ("draft", "configured", "verified", "suspended", "retired"):
            with self.subTest(worker=lifecycle):
                records = _records()
                records["workers"]["worker-1"]["lifecycle"] = lifecycle
                self._reject("inactive_worker", records=records)
            with self.subTest(account=lifecycle):
                records = _records()
                records["accounts"]["account-1"]["lifecycle"] = lifecycle
                self._reject("inactive_account", records=records)

    def test_mismatched_route_and_identity(self):
        request = _request()
        request["route_id"] = "route-other"
        self._reject("route_mismatch", request=request)

        request = _request()
        request["worker_id"] = "worker-2"
        self._reject("identity_mismatch", request=request)

        grant = _grant()
        grant["worker_id"] = "worker-2"
        request = _request()
        request["worker_id"] = "worker-2"
        self._reject("route_mismatch", grant=grant, request=request)

        request = _request()
        request["job_id"] = "job-other"
        self._reject("identity_mismatch", request=request)

    def test_stale_revisions_and_evidence(self):
        request = _request()
        request["route_revision"] = 7
        self._reject("stale_revision", request=request)

        request = _request()
        request["profile_revision"] = 1
        self._reject("stale_revision", request=request)

        grant = _grant()
        grant["input_revision"] = 10
        self._reject("stale_revision", grant=grant)

        request = _request()
        request["ac_revision"] = 1
        self._reject("stale_revision", request=request)

        records = _records()
        records["routes"]["route-1"]["evidence"]["entitlement_revision"] = 4
        self._reject("stale_evidence", records=records)

        records = _records()
        records["routes"]["route-1"]["evidence"]["harness_version"] = "9.9.9"
        self._reject("harness_mismatch", records=records)

        records = _records()
        records["products"]["product-1"]["harness_version"] = "9.9.9"
        self._reject("harness_mismatch", records=records)

        records = _records()
        records["routes"]["route-1"]["evidence"]["model"] = "other-model"
        self._reject("model_mismatch", records=records)

    def test_revoked_expired_and_epoch(self):
        grant = _grant()
        grant["revoked"] = True
        self._reject("revoked", grant=grant)

        grant = _grant()
        grant["expires_at"] = NOW
        self._reject("expired_grant", grant=grant)

        records = _records()
        records["jobs"]["job-1"]["deadline"] = NOW
        self._reject("expired_job", records=records)

        records = _records()
        records["entitlements"]["entitlement-1"]["expires_at"] = NOW
        self._reject("expired_entitlement", records=records)

        grant = _grant()
        grant["revocation_epoch"] = 1
        self._reject("epoch_mismatch", grant=grant)

    def test_scope_escapes_and_reviewer_writes(self):
        escapes = [
            {"read": ["../secret"], "write": []},
            {"read": ["/etc/passwd"], "write": []},
            {"read": ["src\\mod"], "write": []},
            {"read": ["src/../../etc"], "write": []},
            {"read": ["src2"], "write": []},
            {"read": ["."], "write": []},
            {"read": ["src"], "write": ["src/../secret"]},
            {"read": [], "write": ["src2/mod"]},
        ]
        for scopes in escapes:
            with self.subTest(scopes=scopes):
                request = _request()
                request["resource_scopes"] = {"resource-1": scopes}
                with self.assertRaises(AdmissionError) as caught:
                    self._admit(request=request)
                self.assertIn(caught.exception.reason, {"malformed", "scope_escape"})

        request = _request()
        request["resource_scopes"] = {
            "resource-foreign": {"read": ["src"], "write": []}
        }
        self._reject("scope_escape", request=request)

        records = _records()
        records["profiles"]["profile-1"]["write_paths"] = ["src/only"]
        request = _request()
        request["resource_scopes"] = {"resource-1": {"read": ["src/mod"], "write": ["src/mod"]}}
        self._reject("scope_escape", records=records, request=request)

        records = _records()
        records["workers"]["worker-1"]["role"] = "reviewer"
        request = _request()
        request["operation"] = "review"
        request["resource_scopes"] = {"resource-1": {"read": ["src"], "write": ["src"]}}
        self._reject("reviewer_write", records=records, request=request)

        records = _records()
        records["workers"]["worker-1"]["role"] = "reviewer"
        records["profiles"]["profile-1"]["write_paths"] = ["."]
        records["resources"]["resource-1"]["write_paths"] = ["."]
        grant = _grant()
        grant["resource_scopes"] = {"resource-1": {"read": ["."], "write": ["."]}}
        request = _request()
        request["operation"] = "review"
        request["resource_scopes"] = {"resource-1": {"read": ["src"], "write": ["."]}}
        self._reject("reviewer_write", records=records, grant=grant, request=request)

    def test_personal_agent_and_replay_cannot_admit(self):
        grant = _grant()
        grant["allow_agent_trigger"] = True
        request = _request()
        request["origin"] = "agent"
        request["sender"] = AGENT
        request["caller"] = AGENT
        request["hop"] = 1
        self._reject("personal_agent", grant=grant, request=request, caller=AGENT)

        request = _request()
        request["origin"] = "replay"
        self._reject("replay", request=request)

        records = _records()
        records["entitlements"]["entitlement-1"]["billing_class"] = "api"
        request = _request()
        request["origin"] = "replay"
        request["operation"] = "review"
        self._reject("replay", records=records, request=request)

    def test_agent_gates_and_operator_binding(self):
        records = _records()
        records["entitlements"]["entitlement-1"]["billing_class"] = "api"
        request = _request()
        request["origin"] = "agent"
        request["sender"] = AGENT
        request["hop"] = 1
        self._reject("agent_trigger", records=records, request=request, caller=AGENT)

        grant = _grant()
        grant["allow_agent_trigger"] = True
        grant["allowed_callers"] = ["agent-other"]
        self._reject(
            "agent_caller",
            records=records,
            grant=grant,
            request=request,
            caller=AGENT,
        )

        grant = _grant()
        grant["allow_agent_trigger"] = True
        request["caller"] = ISSUER
        request["sender"] = ISSUER
        self._reject(
            "forged_caller",
            records=records,
            grant=grant,
            request=request,
            caller=ISSUER,
        )

        request = _request()
        request["origin"] = "operator"
        request["sender"] = AGENT
        self._reject("operator_caller", request=request, caller=AGENT)

    def test_self_expanded_step_recipient_and_hop(self):
        request = _request()
        request["step_id"] = "step-invented"
        self._reject("expansion", request=request)

        request = _request()
        request["recipients"] = [AGENT, "agent-smuggled"]
        self._reject("expansion", request=request)

        records = _records()
        records["entitlements"]["entitlement-1"]["billing_class"] = "api"
        grant = _grant()
        grant["allow_agent_trigger"] = True
        request = _request()
        request["origin"] = "agent"
        request["sender"] = AGENT
        request["hop"] = 3
        self._reject(
            "budget_hop",
            records=records,
            grant=grant,
            request=request,
            caller=AGENT,
        )

    def test_exhausted_budgets_and_quota(self):
        self._reject("budget_turns", usage={"turns": 4, "messages": 0})
        self._reject("budget_messages", usage={"turns": 0, "messages": 6})

        records = _records()
        records["entitlements"]["entitlement-1"]["quota_remaining"] = 0
        self._reject("quota_exhausted", records=records)

        records = _records()
        records["entitlements"]["entitlement-1"]["quota_remaining"] = -1
        self._reject("quota_exhausted", records=records)

        records = _records()
        records["entitlements"]["entitlement-1"]["quota_remaining"] = 0
        self._reject(
            "quota_exhausted",
            records=records,
            usage={"quota_remaining": 100, "turns": 0, "messages": 0},
        )

    def test_unknown_quota_without_finite_grant_limits_is_rejected(self):
        grant = _grant()
        del grant["max_turns"]
        self._reject("malformed", grant=grant)

        grant = _grant()
        grant["max_messages"] = 0
        self._reject("malformed", grant=grant)

        grant = _grant()
        del grant["expires_at"]
        self._reject("malformed", grant=grant)

    def test_owner_policy_capability_and_missing_objects(self):
        records = _records()
        records["jobs"]["job-1"]["owner"] = OTHER_OWNER
        self._reject("owner_mismatch", records=records)

        records = _records()
        records["resources"]["resource-1"]["owner"] = OTHER_OWNER
        self._reject("owner_mismatch", records=records)

        records = _records()
        records["entitlements"]["entitlement-1"]["actual_entitlement"] = "unknown"
        self._reject("unverified_entitlement", records=records)

        for policy in ("unreviewed", "restricted", "unresolved", "unknown"):
            with self.subTest(policy=policy):
                records = _records()
                records["routes"]["route-1"]["policy_review"] = policy
                self._reject("policy_review", records=records)

        records = _records()
        records["profiles"]["profile-1"]["capabilities"] = ["review"]
        self._reject("capability", records=records)

        records = _records()
        records["profiles"]["profile-1"]["capabilities"] = ["execute", "unknown"]
        request = _request()
        request["operation"] = "rework"
        self._reject("capability", records=records, request=request)

        request = _request()
        request["route_id"] = "route-1"
        records = _records()
        del records["jobs"]["job-1"]
        self._reject("missing", records=records, request=request)

    def test_malformed_requests_are_rejected(self):
        incomplete = _request()
        del incomplete["session_binding_id"]
        self._reject("malformed", request=incomplete)

        bad_hop = _request()
        bad_hop["hop"] = -1
        self._reject("malformed", request=bad_hop)

        bool_hop = _request()
        bool_hop["hop"] = True
        self._reject("malformed", request=bool_hop)

        bad_usage = _request()
        self._reject("malformed", usage={"turns": -1, "messages": 0})
        self._reject("malformed", usage={"turns": True, "messages": 0})
        self._reject("malformed", request=bad_usage, usage={"messages": 1.5})

        nested = _request()
        nested["input"] = {"ok": {1, 2}}
        self._reject("malformed", request=nested)

        self._reject("malformed", caller="")
        self._reject("malformed", caller=None)


if __name__ == "__main__":
    unittest.main()

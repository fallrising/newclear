"""Synthetic M1 test fixtures; no accounts, credentials or native adapters."""
from copy import deepcopy

NOW = 1000.0

def records():
    owner = "operator-example"
    common = {"owner": owner, "revision": 1}
    data = {
        "workers": {
            "worker-a": dict(common, role="writer", lifecycle="active"),
            "worker-b": dict(common, role="reviewer", lifecycle="active"),
        },
        "products": {"product-example": dict(common, harness="fake", harness_version="1")},
        "accounts": {
            "account-a": dict(common, product_id="product-example", lifecycle="active", concurrency_limit=1),
            "account-b": dict(common, product_id="product-example", lifecycle="active", concurrency_limit=1),
        },
        "entitlements": {
            "entitlement-a": dict(common, account_ref="account-a", quota_pool_ref="pool-shared", billing_class="personal", actual_entitlement="verified", expires_at=2000.0, concurrency_limit=2, quota_remaining=None),
            "entitlement-b": dict(common, account_ref="account-b", quota_pool_ref="pool-shared", billing_class="api", actual_entitlement="verified", expires_at=2000.0, concurrency_limit=2, quota_remaining=None),
        },
        "profiles": {
            "profile-a": dict(common, read_paths=["src", "tests"], write_paths=["src"], timeout_seconds=60, capabilities=["execute", "review", "rework"]),
            "profile-b": dict(common, read_paths=["snapshot"], write_paths=[], timeout_seconds=60, capabilities=["review"]),
        },
        "resources": {
            "workspace-a": dict(common, kind="workspace", read_paths=["src", "tests"], write_paths=["src"]),
            "workspace-b": dict(common, kind="workspace", read_paths=["snapshot"], write_paths=[]),
        },
        "jobs": {"job-example": dict(common, input_revision=1, ac_revision=1, revocation_epoch=0, deadline=1900.0, max_concurrency=2,
                                     step_hops={"write-0": 0, "write-1": 0, "write-2": 0, "review-0": 1})},
        "routes": {},
        "sessions": {},
    }
    for suffix, role in [("a", "writer"), ("b", "reviewer")]:
        evidence = {"route_revision": 1, "worker_revision": 1, "account_revision": 1,
                    "entitlement_revision": 1, "profile_revision": 1,
                    "harness_version": "1", "model": "fake-model"}
        data["routes"]["route-"+suffix] = dict(common, worker_id="worker-"+suffix,
            product_id="product-example", account_ref="account-"+suffix,
            entitlement_ref="entitlement-"+suffix, profile_id="profile-"+suffix,
            model="fake-model", harness_version="1", runtime_status="verified",
            policy_review="supported_for_scope", evidence=evidence)
        data["resources"]["workspace-"+suffix]["binding_key"] = "workspace-physical-"+suffix
        data["sessions"]["session-"+suffix] = dict(common, worker_id="worker-"+suffix,
            job_id="job-example", route_id="route-"+suffix, account_ref="account-"+suffix,
            workspace_ref="workspace-"+suffix, binding_key="session-physical-"+suffix)
    for step in ["write-0", "write-1", "write-2"]:
        data["sessions"]["session-"+step] = dict(data["sessions"]["session-a"], binding_key="session-physical-"+step)
    return deepcopy(data)

def grant(**updates):
    value = {
        "grant_id": "grant-example", "revision": 1, "issuer": "operator-example",
        "job_id": "job-example", "worker_id": "worker-a", "route_ids": ["route-a"],
        "resource_scopes": {"workspace-a": {"read": ["src", "tests"], "write": ["src"]}},
        "operations": ["execute", "rework"], "allowed_steps": ["write-0", "write-1", "write-2"],
        "input_revision": 1, "ac_revision": 1, "expires_at": 1800.0,
        "revocation_epoch": 0, "revoked": False, "max_turns": 2, "max_messages": 3,
        "max_hops": 1, "allow_agent_trigger": False, "allowed_callers": [],
    }
    value.update(updates)
    return deepcopy(value)

def request(**updates):
    value = {
        "sender": "operator-example", "origin": "operator", "grant_id": "grant-example",
        "job_id": "job-example", "step_id": "write-0", "input": {"goal": "synthetic work"},
        "input_revision": 1, "ac_revision": 1, "worker_id": "worker-a", "route_id": "route-a",
        "route_revision": 1, "worker_revision": 1, "account_revision": 1,
        "entitlement_revision": 1, "profile_revision": 1, "operation": "execute",
        "resource_scopes": {"workspace-a": {"read": ["src"], "write": ["src"]}},
        "session_binding_id": "session-a", "hop": 0,
    }
    value.update(updates)
    return deepcopy(value)

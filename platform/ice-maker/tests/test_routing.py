import json
from pathlib import Path
import unittest

from ice_maker.routing import RoutingError, TaskUsageLedger, load_routing_config, load_routing_file, select_route

CLASSES = ["public", "internal", "confidential", "restricted"]
POLICY = {"default": "deny", "data_classes": CLASSES, "providers": {
    p: {"egress": p != "local", "allowed_data_classes": CLASSES if p == "local" else ["public", "internal"],
        "blocked_data_classes": [] if p == "local" else ["confidential", "restricted"]}
    for p in ("local", "codex", "deepseek", "grok", "claude")}}

def config():
    return load_routing_config({"version": 1, "attempt_ceiling": 3, "aliases": {
        "builder_primary": {"provider": "codex", "role": "builder", "tier": 1, "cost_usd": 2.0, "fallback_aliases": ["builder_economy"]},
        "builder_economy": {"provider": "deepseek", "role": "builder", "tier": 1, "cost_usd": 1.0, "fallback_aliases": []},
        "critic_independent": {"provider": "grok", "role": "reviewer", "tier": 1, "cost_usd": 1.0, "fallback_aliases": []},
        "reviewer_claude": {"provider": "claude", "role": "reviewer", "tier": 1, "cost_usd": 2.0, "fallback_aliases": ["critic_independent"]},
    }}, POLICY)

class RoutingTests(unittest.TestCase):
    def statuses(self):
        return ({p: "healthy" for p in POLICY["providers"]}, {p: False for p in POLICY["providers"]})

    def test_primary_selection(self):
        health, limited = self.statuses()
        self.assertEqual(select_route(config(), "builder", "public", health, limited, 3).alias, "builder_primary")

    def test_unavailable_route_fails_closed_without_opt_in_fallback(self):
        health, limited = self.statuses(); health["codex"] = "unhealthy"
        with self.assertRaises(RoutingError): select_route(config(), "builder", "public", health, limited, 3)

    def test_explicit_equal_tier_fallback_and_reviewer_fallback(self):
        health, limited = self.statuses(); health["codex"] = "unhealthy"
        self.assertEqual(select_route(config(), "builder", "public", health, limited, 3, allow_fallback=True).alias, "builder_economy")
        health["claude"] = "unhealthy"
        self.assertEqual(select_route(config(), "reviewer", "public", health, limited, 3, allow_fallback=True).alias, "critic_independent")

    def test_malformed_status_rate_limit_and_unsafe_data_fail_closed(self):
        health, limited = self.statuses()
        for bad in ("ok", None, True):
            health["codex"] = bad
            with self.assertRaises(RoutingError): select_route(config(), "builder", "public", health, limited, 3)
            health["codex"] = "healthy"
        limited["codex"] = "false"
        with self.assertRaises(RoutingError): select_route(config(), "builder", "public", health, limited, 3)
        limited["codex"] = False
        with self.assertRaises(RoutingError): select_route(config(), "builder", "confidential", health, limited, 3)

    def test_cost_ceiling_and_policy_mutation_are_isolated(self):
        health, limited = self.statuses(); loaded = config()
        POLICY["providers"]["codex"]["allowed_data_classes"].clear()
        try:
            # The validated snapshot is independent of the caller's policy objects.
            self.assertEqual(select_route(loaded, "builder", "public", health, limited, 2).provider, "codex")
        finally:
            POLICY["providers"]["codex"]["allowed_data_classes"] = ["public", "internal"]

    def test_real_configuration_is_alias_only_and_matches_policy(self):
        root = Path(__file__).parents[1]
        raw = json.loads((root / "config/provider-routing.json").read_text())
        policy = json.loads((root / "orchestration/policies/data-providers.json").read_text())
        loaded = load_routing_file(str(root / "config/provider-routing.json"), policy)
        self.assertEqual(set(raw["aliases"]), {"builder_primary", "builder_economy", "critic_independent", "reviewer_claude"})
        self.assertEqual(loaded.attempt_ceiling, raw["attempt_ceiling"])
        self.assertNotRegex(json.dumps(raw), r"(?i)(model|secret|token|password|api[_-]?key|bearer)")

    def test_invalid_policy_and_fallback_metadata(self):
        bad = {**POLICY, "providers": {**POLICY["providers"], "codex": {**POLICY["providers"]["codex"], "egress": "yes"}}}
        with self.assertRaises(RoutingError): load_routing_config({"version": 1, "attempt_ceiling": 3, "aliases": {}}, bad)
        raw = {"version": 1, "attempt_ceiling": 3, "aliases": {"bad_alias": {"provider": "codex", "role": "builder", "tier": 1, "cost_usd": 1, "fallback_aliases": ["other"]}, "other": {"provider": "codex", "role": "reviewer", "tier": 1, "cost_usd": 1, "fallback_aliases": []}}}
        with self.assertRaises(RoutingError): load_routing_config(raw, POLICY)

    def test_ledger_identity_budget_and_secret_signature(self):
        loaded = config(); ledger = TaskUsageLedger(3.0, loaded)
        self.assertEqual(ledger.attempt_ceiling, 3)
        ledger.record("codex", "builder_primary", 1, 0.2, 1.0, "failure", " Timeout ")
        ledger.record("codex", "builder_primary", 2, 0.3, 1.0, "failure", "timeout")
        self.assertFalse(ledger.retry_allowed("timeout", 2)); self.assertIsInstance(ledger.entries, tuple)
        with self.assertRaises(RoutingError): ledger.record("deepseek", "builder_primary", 3, 0.1, 1, "success")
        with self.assertRaises(RoutingError): ledger.record("codex", "builder_primary", 3, 0.1, float("nan"), "success")
        with self.assertRaises(RoutingError): ledger.record("codex", "builder_primary", 3, 0.1, -1, "success")
        with self.assertRaises(RoutingError): ledger.record("codex", "builder_primary", 3, 0.1, 1, "failure", "token: hidden")
        with self.assertRaises(RoutingError): TaskUsageLedger(3, loaded, attempt_ceiling=4)

if __name__ == "__main__": unittest.main()

"""Strategy evidence must be reproducible and fail closed on corruption."""
import copy
import importlib.util
import io
from contextlib import redirect_stderr
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("simulate", ROOT / "tools/simulate.py")
simulate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(simulate)


class SimulationTests(unittest.TestCase):
    def run_scenario(self, scenario="complementary", seed=7, **kwargs):
        with tempfile.TemporaryDirectory() as directory:
            return simulate.run_scenario(Path(directory) / "world.sqlite3", scenario, seed, **kwargs)

    def test_three_seeds_complete_three_rounds_and_account_for_every_item(self):
        schedules = []
        for seed in (7, 19, 41):
            with self.subTest(seed=seed):
                report = self.run_scenario(seed=seed)
                simulate.verify_report(report)
                self.assertEqual(report["outcome"], "completed")
                self.assertEqual(report["rounds"], {"1": 3, "2": 3})
                self.assertEqual(report["counts"]["buy"], 4)
                self.assertEqual(report["ledger"]["coins"], {"grants": 24, "rewards": 16, "transferred": 12, "final": 40})
                self.assertEqual(report["ledger"]["items"]["kit"]["consumed"], 6)
                self.assertEqual(report["ledger"]["items"]["medicine"]["consumed"], 6)
                self.assertEqual(report["ledger"]["items"]["ore"]["created"], 10)
                self.assertEqual(report["ledger"]["items"]["herb"]["created"], 15)
                self.assertTrue(report["reopen_consistent"])
                self.assertLessEqual(report["steps"], report["max_steps"])
                schedules.append([event["actor"] for event in report["events"]])
        self.assertNotEqual(schedules[0], schedules[1])

    def test_same_seed_exact_reproduction_and_no_tokens(self):
        first, second = self.run_scenario(), self.run_scenario()
        self.assertEqual(first, second)
        self.assertNotIn("token", json.dumps(first))
        self.assertEqual(first["final_balances"], {"1": 20, "2": 20})

    def test_supply_and_price_counterexamples_stall_after_first_round(self):
        for scenario, reason in (("same_profession", "missing_complementary_supply"), ("unaffordable", "insufficient_coins")):
            for seed in (7, 19, 41):
                with self.subTest(scenario=scenario, seed=seed):
                    report = self.run_scenario(scenario, seed)
                    simulate.verify_report(report)
                    self.assertEqual(report["outcome"], "stalled")
                    self.assertEqual(report["reason"], reason)
                    self.assertEqual(report["rounds"], {"1": 1, "2": 1})
                    self.assertGreater(sum(report["waits"].values()), 0)
                    self.assertLessEqual(report["steps"], report["max_steps"])
                    self.assertEqual(report["counts"].get("buy", 0), 0)
                    if scenario == "unaffordable":
                        self.assertGreater(report["rejections"].get("insufficient_coins", 0), 0)

    def test_step_budget_never_becomes_invented_success(self):
        report = self.run_scenario(max_steps=4)
        simulate.verify_report(report)
        self.assertEqual(report["outcome"], "budget_exhausted")
        self.assertEqual(report["steps"], 4)
        self.assertEqual(report["rounds"], {"1": 0, "2": 0})

    def test_verifier_rejects_corrupted_ledger_rounds_balances_and_receipt(self):
        original = self.run_scenario()
        variants = []
        bad = copy.deepcopy(original)
        bad["ledger"]["items"]["ore"]["created"] += 1
        variants.append(bad)
        bad = copy.deepcopy(original)
        bad["rounds"]["1"] = 4
        variants.append(bad)
        bad = copy.deepcopy(original)
        bad["final_balances"]["1"] += 1
        variants.append(bad)
        bad = copy.deepcopy(original)
        bad["events"][0]["result"]["state"]["coins"] += 1
        variants.append(bad)
        for report in variants:
            with self.assertRaises(simulate.InvariantError):
                simulate.verify_report(report)

    def test_verifier_detects_conserved_total_but_wrong_recipient_and_item_creation(self):
        original = self.run_scenario()
        for field in ("coins", "ore", "herb", "kit", "medicine"):
            bad = copy.deepcopy(original)
            world = bad["events"][0]["world"]["characters"]
            if field == "coins":
                world[0]["coins"] += 1
                world[1]["coins"] -= 1
            else:
                world[0]["items"][field] += 1
            with self.subTest(field=field), self.assertRaises(simulate.InvariantError):
                simulate.verify_report(bad)

    def test_rejected_purchase_state_corruption_is_rejected(self):
        report = self.run_scenario("unaffordable")
        event = next(event for event in report["events"] if event["status"] == 400)
        event["world"]["characters"][0]["items"]["kit"] += 1
        with self.assertRaises(simulate.InvariantError):
            simulate.verify_report(report)

    def test_existing_database_is_never_reused_or_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "existing.sqlite3"
            path.write_bytes(b"precious")
            with self.assertRaises(FileExistsError):
                simulate.run_scenario(path)
            self.assertEqual(path.read_bytes(), b"precious")

    def test_live_store_result_corruption_stops_simulation(self):
        original = simulate.Store.action

        def corrupt(store, token, body):
            status, result = original(store, token, body)
            result["state"]["coins"] += 1
            return status, result

        with patch.object(simulate.Store, "action", corrupt):
            with self.assertRaisesRegex(simulate.InvariantError, "receipt mismatch"):
                self.run_scenario()

    def test_reopen_and_terminal_claim_corruption_is_rejected(self):
        original = self.run_scenario("same_profession")
        for field, value in (("outcome", "completed"), ("target_rounds", 1), ("stall_limit", 1), ("reopen_consistent", False)):
            report = copy.deepcopy(original)
            report[field] = value
            with self.subTest(field=field), self.assertRaises(simulate.InvariantError):
                simulate.verify_report(report)
        original["reopened_world"]["characters"][0]["coins"] += 1
        with self.assertRaises(simulate.InvariantError):
            simulate.verify_report(original)

    def test_cli_json_and_nonzero_when_invariant_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            env = dict(os.environ, AGENT_BUILD_DIR=directory, AGENT_EVIDENCE_DIR=directory)
            result = subprocess.run([sys.executable, str(ROOT / "tools/simulate.py"), "--seeds", "7", "--scenarios", "complementary"], env=env, capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            summary = json.loads(result.stdout)
            self.assertTrue(summary["accepted"])
            self.assertEqual(summary["runs"][0]["rounds"], {"1": 3, "2": 3})
            self.assertLess(len(result.stdout), 3000)
            artifact = json.loads(Path(summary["evidence_path"]).read_text())
            self.assertGreater(len(artifact["runs"][0]["events"]), 100)
            simulate.verify_report(artifact["runs"][0])
        with patch.object(simulate, "run_scenario", side_effect=simulate.InvariantError("injected")):
            with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {"AGENT_BUILD_DIR": directory, "AGENT_EVIDENCE_DIR": directory}):
                stderr = io.StringIO()
                with redirect_stderr(stderr):
                    self.assertEqual(simulate.main(["--seeds", "7", "--scenarios", "complementary"]), 1)
                self.assertEqual(json.loads(stderr.getvalue())["error"], "injected")

    def test_cli_budget_exhaustion_fails_acceptance_but_preserves_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "budget.json"
            result = subprocess.run([sys.executable, str(ROOT / "tools/simulate.py"), "--seeds", "7", "--scenarios", "complementary", "--max-steps", "4", "--output", str(output)], env=dict(os.environ, AGENT_BUILD_DIR=directory), capture_output=True, text=True)
            self.assertEqual(result.returncode, 1, result.stderr)
            summary = json.loads(result.stdout)
            self.assertFalse(summary["accepted"])
            self.assertEqual(summary["runs"][0]["outcome"], "budget_exhausted")
            self.assertEqual(json.loads(output.read_text())["runs"][0]["steps"], 4)


if __name__ == "__main__":
    unittest.main()

"""Profile-bound verifier behavior and connector output validation."""

import hashlib
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from agent_platform.connector_output import OutputPolicy, workspace_result
from agent_platform.domain import Problem
from agent_platform.guest_workspace import result as workspace_result_from_guest
from agent_platform.verification import VerificationPolicy, contract_sha256

BASE_SHA = "0" * 40
RUN_ID = "00000000-0000-0000-0000-000000000001"


class VerificationContractTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "repo"
        self.root.mkdir()
        subprocess.run(["git", "init", "--quiet"], cwd=self.root, check=True)
        subprocess.run(["git", "config", "user.name", "Verifier Test"], cwd=self.root, check=True)
        subprocess.run(
            ["git", "config", "user.email", "verifier@example.test"],
            cwd=self.root,
            check=True,
        )
        (self.root / "README.txt").write_text("pinned base\n")
        subprocess.run(["git", "add", "README.txt"], cwd=self.root, check=True)
        subprocess.run(["git", "commit", "--quiet", "-m", "base"], cwd=self.root, check=True)
        self.base_sha = subprocess.run(
            ["git", "rev-parse", "HEAD"], cwd=self.root, check=True, capture_output=True, text=True
        ).stdout.strip()
        (self.root / "m2-result.txt").write_text("sample\n")
        self.row = {
            "run_id": RUN_ID,
            "input": {"base_sha": self.base_sha},
            "generation": 1,
            "handle": {"token": "sandbox-canary"},
        }
        self.output_policy = OutputPolicy(
            SimpleNamespace(
                token="connector-canary", client=SimpleNamespace(api_token="node-canary")
            ),
            self.row,
        )
        self.old_cwd = Path.cwd()
        self.addCleanup(os.chdir, self.old_cwd)

    def command_policy(self, argv, timeout=3):
        return VerificationPolicy(
            mode="commands",
            revision="repo-tests-v1",
            checks=[{"id": "repo-tests", "argv": argv, "timeout_seconds": timeout}],
        )

    def run_guest(self, policy):
        self.row["input"]["base_sha"] = self.base_sha
        self.row["input"]["verification"] = policy.model_dump(mode="json")
        with patch("agent_platform.guest_workspace.ROOT", self.root):
            raw = workspace_result_from_guest(
                {
                    "run_id": RUN_ID,
                    "base_sha": self.base_sha,
                    "verification": policy.model_dump(mode="json"),
                }
            )
        return raw

    def accept(self, value):
        return workspace_result(json.dumps(value), self.row, self.output_policy)

    def test_profile_contract_bounds_and_identity(self):
        policy = self.command_policy(["python3", "-c", "pass"])
        self.assertEqual(policy.mode, "commands")
        self.assertRegex(contract_sha256(policy), r"^[a-f0-9]{64}$")
        for value in (
            {"mode": "commands", "checks": []},
            {
                "mode": "commands",
                "checks": [
                    {"id": "same", "argv": ["true"], "timeout_seconds": 60},
                    {"id": "same", "argv": ["true"], "timeout_seconds": 60},
                    {"id": "extra", "argv": ["true"], "timeout_seconds": 1},
                ],
            },
            {
                "mode": "commands",
                "checks": [
                    {"id": "long", "argv": ["true"], "timeout_seconds": 60},
                    {"id": "longer", "argv": ["true"], "timeout_seconds": 60},
                    {"id": "extra", "argv": ["true"], "timeout_seconds": 1},
                ],
            },
        ):
            with self.subTest(value=value), self.assertRaises(ValueError):
                VerificationPolicy.model_validate(value)

    def test_configured_check_passes_and_only_hashes_output(self):
        secret_output = "synthetic-verifier-output-secret"
        policy = self.command_policy(
            [
                "python3",
                "-c",
                "import os,pathlib; assert os.environ['AGENT_RUN_ID'] == "
                + repr(RUN_ID)
                + "; print("
                + repr(secret_output)
                + ")",
            ]
        )
        raw = self.run_guest(policy)
        accepted = self.accept(raw)
        self.assertEqual(accepted["verification"]["status"], "passed")
        check = accepted["verification"]["checks"][0]
        self.assertEqual(check["status"], "passed")
        self.assertGreater(check["output_bytes"], 0)
        self.assertNotIn(secret_output, json.dumps(accepted))
        expected_hash = hashlib.sha256(secret_output.encode() + b"\n").hexdigest()
        self.assertEqual(check["output_sha256"], expected_hash)

    def test_nonzero_timeout_output_limit_and_workspace_mutation_never_pass(self):
        failure_check = self.command_policy(["python3", "-c", "raise SystemExit(7)"])
        failed = self.accept(self.run_guest(failure_check))
        self.assertEqual(failed["verification"]["status"], "failed")
        self.assertEqual(failed["verification"]["checks"][0]["exit_code"], 7)

        timeout_policy = self.command_policy(["python3", "-c", "import time; time.sleep(10)"], 1)
        timed_out = self.accept(self.run_guest(timeout_policy))
        self.assertEqual(timed_out["verification"]["status"], "unknown")
        self.assertEqual(timed_out["verification"]["checks"][0]["reason"], "check_timeout")

        noisy = self.command_policy(["python3", "-c", "print('x' * 2_000_000)"])
        too_much_output = self.accept(self.run_guest(noisy))
        self.assertEqual(too_much_output["verification"]["status"], "unknown")
        self.assertEqual(
            too_much_output["verification"]["checks"][0]["reason"], "check_output_limit"
        )
        self.assertLessEqual(
            too_much_output["verification"]["checks"][0]["output_bytes"], 1024 * 1024 + 1
        )

        mutating = self.command_policy(
            ["python3", "-c", "from pathlib import Path; Path('test-created.txt').write_text('x')"]
        )
        changed = self.accept(self.run_guest(mutating))
        self.assertEqual(changed["verification"]["status"], "unknown")
        self.assertEqual(changed["verification"]["reason"], "verification_modified_workspace")

    def test_absent_checks_are_unknown_and_cannot_be_forged_as_passed(self):
        policy = VerificationPolicy(mode="none", revision="no-tests-v1")
        raw = self.run_guest(policy)
        accepted = self.accept(raw)
        self.assertEqual(accepted["verification"]["status"], "unknown")
        self.assertEqual(accepted["verification"]["reason"], "verification_not_configured")

        forged = json.loads(json.dumps(raw))
        forged["verification"]["status"] = "passed"
        forged["verification"]["reason"] = "checks_passed"
        with self.assertRaises(Problem):
            self.accept(forged)

    def test_check_result_is_bound_to_profile_contract_and_exact_patch(self):
        policy = self.command_policy(["python3", "-c", "pass"])
        raw = self.run_guest(policy)
        forged = json.loads(json.dumps(raw))
        forged["verification"]["checks"][0]["id"] = "other-tests"
        with self.assertRaises(Problem):
            self.accept(forged)
        forged = json.loads(json.dumps(raw))
        forged["verification"]["diff_sha256"] = "f" * 64
        with self.assertRaises(Problem):
            self.accept(forged)


if __name__ == "__main__":
    unittest.main()

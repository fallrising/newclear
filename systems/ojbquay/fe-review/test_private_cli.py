import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

CLI = Path(__file__).with_name("run-isolated.py")
SOURCE = "a" * 40


class PrivateCliTests(unittest.TestCase):
    def invoke(self, mode, state, *args):
        process = subprocess.run([sys.executable, "-B", str(CLI), mode, "--state", str(state), *args], capture_output=True, text=True, check=False)
        return process.returncode, json.loads(process.stdout)

    def test_prepare_is_exclusive_private_and_does_not_echo_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            code, output = self.invoke("prepare", state, "--source", SOURCE)
            self.assertEqual(code, 0)
            env = json.loads((state / "environment.json").read_text())
            self.assertEqual((state / "environment.json").stat().st_mode & 0o777, 0o600)
            self.assertEqual(len({env[k] for k in env if k.endswith("PASSWORD")}), 3)
            for key, value in env.items():
                if key.endswith(("PASSWORD", "USER")):
                    self.assertNotIn(value, json.dumps(output))
            code, output = self.invoke("prepare", state, "--source", SOURCE)
            self.assertEqual(code, 1)
            self.assertEqual(output["error"], "REVIEW_PRIVATE_NOT_EMPTY")

    def test_unknown_inventory_and_wrong_file_permissions_never_prove_absence(self):
        with tempfile.TemporaryDirectory() as directory:
            state = Path(directory)
            self.assertEqual(self.invoke("prepare", state, "--source", SOURCE)[0], 0)
            inventory = state / "inventory.json"
            inventory.write_text(json.dumps({"inspectionSucceeded": False, "resources": []}))
            inventory.chmod(0o600)
            self.assertEqual(self.invoke("absent", state, "--inventory", str(inventory))[1]["error"], "REVIEW_INVENTORY_UNKNOWN")
            inventory.write_text(json.dumps({"inspectionSucceeded": True, "resources": []}))
            inventory.chmod(0o644)
            self.assertEqual(self.invoke("absent", state, "--inventory", str(inventory))[1]["error"], "REVIEW_FILE_MODE")
            inventory.chmod(0o600)
            self.assertEqual(self.invoke("absent", state, "--inventory", str(inventory))[0], 0)

    def test_symlink_and_nonprivate_state_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            target = parent / "target"
            target.mkdir(mode=0o700)
            link = parent / "link"
            link.symlink_to(target)
            self.assertEqual(self.invoke("prepare", link, "--source", SOURCE)[1]["error"], "REVIEW_PRIVATE_PATH")
            target.chmod(0o755)
            self.assertEqual(self.invoke("prepare", target, "--source", SOURCE)[1]["error"], "REVIEW_PRIVATE_MODE")


if __name__ == "__main__":
    unittest.main()

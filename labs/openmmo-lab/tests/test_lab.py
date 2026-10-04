import hashlib
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("lab", Path(__file__).resolve().parents[1] / "lab.py")
lab = importlib.util.module_from_spec(spec)
spec.loader.exec_module(lab)


class LabTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / "source"
        self.workspace = self.root / "runtime"
        self.source.mkdir()
        self.lock = lab.load_lock()
        asset = self.source / "client/public/sample.bin"
        asset.parent.mkdir(parents=True)
        asset.write_bytes(b"asset")
        (self.source / "assets.lock").write_text(
            f"repo {self.lock['asset_repository']}\nrevision {self.lock['asset_revision']}\n"
            f"file {hashlib.sha256(b'asset').hexdigest()} client/public/sample.bin\n")
        for name in ["server.Dockerfile", "client.Dockerfile", "terrain-bake.sh"]:
            p = self.source / "docker" / name
            p.parent.mkdir(exist_ok=True)
            p.write_text("fixture\n")
        self.git("init", "-q")
        self.git("add", ".")
        self.git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture")
        self.lock["commit"] = self.git("rev-parse", "HEAD")
        self.lock["asset_lock_sha256"] = lab.digest(self.source / "assets.lock")

    def git(self, *args):
        return lab.git(self.source, *args)

    def render(self):
        return lab.render(self.source, self.workspace, 18080, self.lock)

    def test_pin_and_dirty_checkout_rejected(self):
        lab.verify_source(self.source, self.lock)
        wrong = dict(self.lock, commit="0" * 40)
        with self.assertRaisesRegex(ValueError, "HEAD differs"):
            lab.verify_source(self.source, wrong)
        (self.source / "docker/server.Dockerfile").write_text("changed")
        with self.assertRaisesRegex(ValueError, "tracked changes"):
            lab.verify_source(self.source, self.lock)

    def test_untracked_and_wrong_asset_lock_rejected(self):
        (self.source / "unexpected").write_text("x")
        with self.assertRaisesRegex(ValueError, "untracked"):
            lab.verify_source(self.source, self.lock)
        (self.source / "unexpected").unlink()
        with self.assertRaisesRegex(ValueError, "checksum"):
            lab.verify_source(self.source, dict(self.lock, asset_lock_sha256="0" * 64))

    def test_render_idempotent_preserves_env_and_isolates_ports(self):
        self.render()
        env = self.workspace / ".env"
        env.write_text("GOOGLE_CLIENT_ID=test.apps.googleusercontent.com\nADMIN_EMAILS=\n")
        before = env.read_bytes()
        self.render()
        self.assertEqual(env.read_bytes(), before)
        self.assertEqual(env.stat().st_mode & 0o777, 0o600)
        cfg = json.loads((self.workspace / "compose.json").read_text())
        self.assertEqual(set(cfg["services"]), {"terrain-init", "server", "client"})
        self.assertNotIn("ports", cfg["services"]["server"])
        self.assertEqual(cfg["services"]["client"]["ports"][0]["host_ip"], "127.0.0.1")
        self.assertEqual(cfg["services"]["terrain-init"]["environment"]["TERRAIN_REGION_MIN"], "-2")
        self.assertNotIn("-v", lab.compose_command(self.workspace, "down"))
        self.assertNotEqual(lab.compose_command(self.workspace, "down")[3],
                            lab.compose_command(self.root / "other", "down")[3])

    def test_unowned_workspace_and_in_checkout_rejected(self):
        self.workspace.mkdir()
        keep = self.workspace / "keep"
        keep.write_text("preserve")
        with self.assertRaisesRegex(ValueError, "unowned"):
            self.render()
        self.assertEqual(keep.read_text(), "preserve")
        with self.assertRaisesRegex(ValueError, "outside the upstream"):
            lab.render(self.source, self.source / "runtime", 18080, self.lock)

    def test_drift_and_symlink_rejected(self):
        self.render()
        config = self.workspace / "compose.json"
        original = config.read_text()
        config.write_text(original.replace("127.0.0.1", "0.0.0.0"))
        with self.assertRaisesRegex(ValueError, "drift"):
            lab.read_workspace(self.workspace, self.lock)
        config.write_text(original)
        env = self.workspace / ".env"
        env.unlink()
        env.symlink_to(self.source / "assets.lock")
        with self.assertRaisesRegex(ValueError, "symlinks"):
            lab.read_workspace(self.workspace, self.lock)

    def test_missing_docker_oauth_and_asset_reported(self):
        self.render()
        with patch.object(lab.shutil, "which", return_value=None):
            result = lab.doctor(self.workspace, self.lock)
        self.assertEqual(result["status"], "blocked")
        self.assertEqual(len(result["problems"]), 2)
        self.assertFalse(result["runtime_verified"])
        (self.source / "client/public/sample.bin").write_bytes(b"corrupt")
        self.assertEqual(len(lab.asset_problems(self.source)), 1)
        (self.source / "client/public/sample.bin").unlink()
        self.assertEqual(len(lab.asset_problems(self.source)), 1)

    def test_blocked_up_never_builds(self):
        self.render()
        with patch.object(lab, "load_lock", return_value=self.lock), \
             patch.object(lab.shutil, "which", return_value=None), \
             patch.object(lab, "compose_command") as compose:
            self.assertEqual(lab.main(["up", "--workspace", str(self.workspace)]), 2)
            compose.assert_not_called()

    def test_shell_cannot_override_workspace_settings(self):
        with patch.dict(os.environ, {"COMPOSE_PROJECT_NAME": "production", "GOOGLE_CLIENT_ID": "wrong"}), \
             patch.object(subprocess, "run") as runner:
            lab.run(lab.compose_command(self.workspace, "down"))
            env = runner.call_args.kwargs["env"]
            self.assertNotIn("COMPOSE_PROJECT_NAME", env)
            self.assertNotIn("GOOGLE_CLIENT_ID", env)


if __name__ == "__main__":
    unittest.main()

"""Offline contracts; all artifact values are deliberately synthetic."""
import copy
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "labctl.py"
spec = importlib.util.spec_from_file_location("labctl", SCRIPT)
labctl = importlib.util.module_from_spec(spec)
spec.loader.exec_module(labctl)


def inputs():
    inventory = {
        "schema_version": 1, "run_id": "fixture-demo",
        "access_policy_revision": "fixture-policy-v1",
        "hosts": [{"role": f"H{i}", "ssh_alias": f"fixture-h{i}",
                   "machine_identity_sha256": str(i) * 64,
                   "tailnet_ipv4": f"100.64.0.{i}",
                   "data_root": "/home/fixture/mithril/fixture-demo",
                   "available_memory_mib": 4096 if i < 4 else 2048,
                   "available_disk_mib": 10240,
                   "occupied_ports": [],
                   "approved_ports": [17001, 17002, 27001, 27002] if i < 4 else [17979]}
                  for i in range(1, 5)]}
    lock = {"schema_version": 1, "research_commit": labctl.RESEARCH_COMMIT,
            "platform": "linux/amd64", "redis_image": "redis:7.4.1@sha256:" + "a" * 64,
            "mithril_binary_sha256": "b" * 64, "mithril_provenance": "fixture-build-v1",
            "builder_image": "fixture-builder@sha256:" + "c" * 64,
            "rust_toolchain": "1.98.0", "native_verification": "fixture-native-v1"}
    return inventory, lock


class Contracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.inventory, self.lock = inputs()
        self.plan = labctl.build_plan(self.inventory, self.lock)

    def invoke(self, action, **kwargs):
        return labctl.fixture(self.plan, self.state, self.plan["plan_sha256"], action, **kwargs)

    def write(self, name, obj):
        path = self.state / name
        path.write_text(json.dumps(obj))
        path.chmod(0o600)

    def read(self, name):
        return json.loads((self.state / name).read_text())

    def test_plan_canonical_topology_and_labels(self):
        shuffled = copy.deepcopy(self.inventory)
        shuffled["hosts"].reverse()
        self.assertEqual(self.plan, labctl.build_plan(shuffled, self.lock))
        self.assertTrue(self.plan["executable"])
        self.assertEqual(self.plan["lane"], "local-fixture")
        self.assertIs(self.plan["remote_execution_supported"], False)
        roles = {n["role"]: n for n in self.plan["topology"]}
        self.assertEqual(len(roles), 7)
        for i, replica_host in [(1, "H2"), (2, "H3"), (3, "H1")]:
            self.assertEqual(roles[f"R{i}"]["host"], replica_host)
            self.assertEqual(roles[f"R{i}"]["replicates"], f"M{i}")
        self.assertEqual([roles[f"M{i}"]["slots"] for i in range(1, 4)],
                         [[0, 5460], [5461, 10922], [10923, 16383]])

    def test_strict_inputs(self):
        mutations = [lambda i: i.update(extra="secret"),
                     lambda i: i.update(schema_version=True),
                     lambda i: i.update(run_id="../secret"),
                     lambda i: i["hosts"].pop(),
                     lambda i: i["hosts"][1].update(role="H1"),
                     lambda i: i["hosts"][1].update(ssh_alias="fixture-h1"),
                     lambda i: i["hosts"][1].update(machine_identity_sha256="1" * 64),
                     lambda i: i["hosts"][1].update(tailnet_ipv4="100.64.0.1"),
                     lambda i: i["hosts"][0].update(tailnet_ipv4="127.0.0.1"),
                     lambda i: i["hosts"][0].update(data_root="/home/root/fixture-demo"),
                     lambda i: i["hosts"][0].update(data_root="/home/u/../fixture-demo"),
                     lambda i: i["hosts"][0].update(available_memory_mib=True),
                     lambda i: i["hosts"][0].update(approved_ports=[17001, 17001, 27001, 27002])]
        for mutate in mutations:
            with self.subTest(mutate=mutate):
                inventory = copy.deepcopy(self.inventory)
                mutate(inventory)
                with self.assertRaises(labctl.LabError):
                    labctl.build_plan(inventory, self.lock)

    def test_drafts_and_artifact_drift(self):
        for field in ["redis_image", "mithril_binary_sha256", "mithril_provenance",
                      "builder_image", "native_verification"]:
            lock = dict(self.lock, **{field: "UNRESOLVED"})
            plan = labctl.build_plan(self.inventory, lock)
            self.assertFalse(plan["executable"])
            self.assertTrue(plan["reasons"])
            with self.assertRaises(labctl.LabError):
                labctl.fixture(plan, self.state, plan["plan_sha256"], "up")
        for field, value in [("research_commit", "0" * 40), ("platform", "linux/arm64"),
                             ("rust_toolchain", "stable"), ("redis_image", "redis:latest")]:
            with self.assertRaises(labctl.LabError):
                labctl.build_plan(self.inventory, dict(self.lock, **{field: value}))
        self.inventory["hosts"][0]["available_disk_mib"] = 1
        self.assertFalse(labctl.build_plan(self.inventory, self.lock)["executable"])
        self.inventory["hosts"][0]["available_disk_mib"] = 10240
        self.inventory["hosts"][0]["occupied_ports"] = [17001]
        self.assertFalse(labctl.build_plan(self.inventory, self.lock)["executable"])

    def test_json_bounds_duplicate_nonfinite_links(self):
        path = self.root / "input.json"
        for raw in ['{"a":1,"a":2}', '{"a":NaN}', '{"a":Infinity}', '{"a":1e309}', '\udcff', 'x' * (labctl.MAX_BYTES + 1)]:
            path.write_bytes(raw.encode("utf-8", "surrogatepass"))
            with self.assertRaises(labctl.LabError):
                labctl.load_json(path)
        path.write_text("{}")
        link = self.root / "link"
        link.symlink_to(path)
        with self.assertRaises(labctl.LabError):
            labctl.load_json(link)
        link.unlink()
        os.link(path, link)
        with self.assertRaises(labctl.LabError):
            labctl.load_json(path)

    def test_hash_and_semantic_tamper(self):
        for key, value in [("lane", "remote"), ("remote_execution_supported", True),
                           ("executable", False), ("caps", {}), ("topology", [])]:
            plan = dict(self.plan, **{key: value})
            plan["plan_sha256"] = labctl.digest({k: v for k, v in plan.items() if k != "plan_sha256"})
            with self.assertRaises(labctl.LabError):
                labctl.validate_plan(plan, plan["plan_sha256"])
        with self.assertRaises(labctl.LabError):
            labctl.validate_plan(self.plan, "f" * 64)
        self.invoke("up")
        altered = copy.deepcopy(self.inventory)
        altered["access_policy_revision"] = "fixture-policy-v2"
        plan = labctl.build_plan(altered, self.lock)
        with self.assertRaises(labctl.LabError):
            labctl.fixture(plan, self.state, plan["plan_sha256"], "down")

    def test_lifecycle_retains_data_node_identity_new_process_ids(self):
        up = self.invoke("up")
        first = self.read("state.json")
        self.assertEqual(len(up["resources"]), 7)
        smoke = self.invoke("smoke")
        self.assertEqual(smoke["result"], "simulated-pass")
        self.assertEqual(smoke["checks"]["slots"], 16384)
        data = self.read("state.json")["data"]
        self.invoke("down")
        self.assertEqual(self.read("backend.json")["objects"], {})
        self.invoke("up")
        second = self.read("state.json")
        self.assertEqual(second["data"], data)
        self.assertEqual(first["node_ids"], second["node_ids"])
        self.assertTrue(set(first["manifest"]).isdisjoint(second["manifest"]))
        self.assertEqual(self.invoke("smoke")["retained_marker"], smoke["retained_marker"])
        self.assertEqual(len(self.read("state.json")["journal"]), 21)

    def test_create_remove_crash_windows_reconcile_no_replay(self):
        for action in ["up", "down"]:
            for fault in ["before-effect", "lost-reply", "after-ack"]:
                with self.subTest(action=action, fault=fault):
                    self.state = self.root / (action + "-" + fault)
                    if action == "down":
                        self.invoke("up")
                    with self.assertRaises(labctl.LabError):
                        self.invoke(action, fault=fault)
                    snapshot = self.read("backend.json")
                    state = self.read("state.json")
                    self.assertEqual(state["journal"][-1]["action"], "create" if action == "up" else "remove")
                    if fault != "after-ack":
                        with self.assertRaises(labctl.LabError):
                            self.invoke(action)
                    self.invoke("reconcile")
                    self.assertEqual(snapshot, self.read("backend.json"))
                    observed = self.read("state.json")
                    self.invoke("reconcile")
                    self.assertEqual(observed, self.read("state.json"))
                    self.invoke(action)
                    self.assertEqual(len(self.read("backend.json")["objects"]), 7 if action == "up" else 0)

    def test_foreign_objects_unchanged_and_missing_observation_blocks(self):
        self.invoke("up")
        backend = self.read("backend.json")
        backend["objects"]["foreign"] = {"label": "another-run"}
        self.write("backend.json", backend)
        for action in ["up", "down", "smoke"]:
            with self.assertRaises(labctl.LabError):
                self.invoke(action)
            self.assertEqual(self.read("backend.json"), backend)
        result = self.invoke("reconcile")
        self.assertEqual(result["observation"], "foreign")
        self.assertEqual(self.read("backend.json"), backend)
        (self.state / "backend.json").unlink()
        self.assertEqual(self.invoke("reconcile")["observation"], "unknown")
        with self.assertRaises(labctl.LabError):
            self.invoke("up")

    def test_unknown_scope_permissions_and_source_boundary(self):
        self.state.mkdir(mode=0o700)
        (self.state / "foreign").write_text("retained")
        with self.assertRaises(labctl.LabError):
            self.invoke("up")
        self.assertEqual((self.state / "foreign").read_text(), "retained")
        self.state = self.root / "unsafe"
        self.state.mkdir(mode=0o755)
        with self.assertRaises(labctl.LabError):
            self.invoke("up")
        self.state = SCRIPT.parent / "forbidden-state"
        with self.assertRaises(labctl.LabError):
            self.invoke("up")
        self.assertFalse(self.state.exists())

    def test_state_links_lock_contention_and_binding_tamper(self):
        self.invoke("up")
        with (self.state / ".lock").open("r+") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(labctl.LabError):
                self.invoke("status")
        state = self.read("state.json")
        self.write("state.json", dict(state, plan_sha256="0" * 64))
        with self.assertRaises(labctl.LabError):
            self.invoke("down")
        self.write("state.json", state)
        path = self.state / "backend.json"
        os.link(path, self.root / "hardlink")
        with self.assertRaises(labctl.LabError):
            self.invoke("down")
        (self.root / "hardlink").unlink()
        moved = self.root / "backend"
        path.rename(moved)
        path.symlink_to(moved)
        with self.assertRaises(labctl.LabError):
            self.invoke("down")
        parentlink = self.root / "parentlink"
        parentlink.symlink_to(self.root)
        self.state = parentlink / "new-state"
        with self.assertRaises(labctl.LabError):
            self.invoke("up")

    def test_topology_backend_tamper(self):
        self.invoke("up")
        backend = self.read("backend.json")
        rid = next(iter(backend["objects"]))
        backend["objects"][rid]["role"] = "OTHER"
        self.write("backend.json", backend)
        with self.assertRaises(labctl.LabError):
            self.invoke("smoke")
        with self.assertRaises(labctl.LabError):
            self.invoke("down")

    def test_unrecorded_disappearance_resurrection_and_manifest_tamper(self):
        self.invoke("up")
        backend = self.read("backend.json")
        self.write("backend.json", {"objects": {}})
        self.assertEqual(self.invoke("reconcile")["observation"], "unknown")
        with self.assertRaises(labctl.LabError):
            self.invoke("up")
        self.write("backend.json", backend)
        self.invoke("down")
        self.write("backend.json", backend)
        self.assertEqual(self.invoke("reconcile")["observation"], "unknown")
        with self.assertRaises(labctl.LabError):
            self.invoke("down")
        self.write("backend.json", {"objects": {}})
        state = self.read("state.json")
        state["manifest"] = {}
        self.write("state.json", state)
        with self.assertRaises(labctl.LabError):
            self.invoke("up")

    def test_copied_state_root_binding_and_lock_substitution(self):
        self.invoke("up")
        original = self.state
        copied = self.root / "copied"
        copied.mkdir(mode=0o700)
        for name in ["state.json", "backend.json", ".lock"]:
            (copied / name).write_bytes((original / name).read_bytes())
            (copied / name).chmod(0o600)
        self.state = copied
        with self.assertRaises(labctl.LabError):
            self.invoke("down")
        self.state = original
        lock = original / ".lock"
        os.link(lock, self.root / "lock-hardlink")
        with self.assertRaises(labctl.LabError):
            self.invoke("down")
        (self.root / "lock-hardlink").unlink()
        lock.unlink()
        lock.symlink_to(copied / ".lock")
        with self.assertRaises(labctl.LabError):
            self.invoke("down")

    def test_atomic_write_refuses_replaced_target(self):
        self.invoke("up")
        target = self.state / "state.json"
        before = self.read("state.json")
        original_open = labctl.os.open
        def replacing_open(name, flags, *args, **kwargs):
            fd = original_open(name, flags, *args, **kwargs)
            if str(name).startswith(".write-"):
                target.unlink()
                target.symlink_to(self.root / "untouched")
            return fd
        with labctl.directory(self.state) as dirfd:
            with patch.object(labctl.os, "open", side_effect=replacing_open):
                with self.assertRaises(labctl.LabError):
                    labctl.atomic_write(dirfd, "state.json", before)
        self.assertTrue(target.is_symlink())
        self.assertFalse((self.root / "untouched").exists())

    def test_synthetic_backend_behavior(self):
        clock = [1]
        values = {}
        store = labctl.SyntheticStore("fixture-demo", values, lambda: clock[0])
        key = "fixture-demo:sample"
        self.assertEqual(store.execute("GET", key), None)
        self.assertEqual(store.execute("SET", key, "value", 3), "OK")
        self.assertEqual(store.execute("GET", key), "value")
        clock[0] = 3
        self.assertEqual(store.execute("TTL", key), 1)
        clock[0] = 4
        self.assertEqual(store.execute("GET", key), None)
        self.assertEqual(store.execute("DEL", key), 0)
        for command, denied_key in [("GET", "another-run:key"), ("CONFIG", key)]:
            with self.assertRaises(labctl.LabError):
                store.execute(command, denied_key)
        with self.assertRaises(labctl.LabError):
            store.execute("GET", key, authorized=False)

    def test_status_does_not_claim_new_scope_and_remote_intent_is_never_target(self):
        with self.assertRaises(labctl.LabError):
            self.invoke("status")
        self.assertFalse(self.state.exists())
        self.state.mkdir(mode=0o700)
        with self.assertRaises(labctl.LabError):
            self.invoke("report")
        self.assertEqual(list(self.state.iterdir()), [])
        for root in ["/home/fixture/mithril/fixture-demo", "/home/fixture/mithril/fixture-demo/subdir"]:
            with self.assertRaisesRegex(labctl.LabError, "remote-intent-state-root"):
                labctl.fixture(self.plan, Path(root), self.plan["plan_sha256"], "up")

    def test_malformed_private_state_is_rejected(self):
        self.invoke("up")
        original = self.read("state.json")
        for mutate in [lambda s: s["journal"][0].update(action=[]),
                       lambda s: s["journal"][0].update(status={}),
                       lambda s: next(iter(s["manifest"].values())).update(role=[]),
                       lambda s: s.update(last_smoke={"fake": "pass"}),
                       lambda s: s["data"].update(values={"foreign:key": {"value": "x", "expires": 3}})]:
            changed = copy.deepcopy(original)
            mutate(changed)
            self.write("state.json", changed)
            with self.assertRaises(labctl.LabError):
                self.invoke("down")

    def test_cli_json_error_privacy_and_sanitized_report(self):
        inv, lock, planpath = [self.root / name for name in ["inventory.json", "runtime.json", "plan.json"]]
        inv.write_text(json.dumps(self.inventory))
        lock.write_text(json.dumps(self.lock))
        def cli(*args):
            return subprocess.run([sys.executable, str(SCRIPT), *map(str, args)], capture_output=True, text=True)
        result = cli("plan", "--inventory", inv, "--runtime-lock", lock)
        self.assertEqual(result.returncode, 0, result.stderr)
        planpath.write_text(result.stdout)
        args = ["--plan", planpath, "--expected-digest", self.plan["plan_sha256"], "--state-root", self.state]
        for action in ["up", "status", "smoke", "down", "reconcile", "up", "report"]:
            result = cli("fixture", action, *args)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(output["lane"], "local-fixture")
            self.assertFalse(output["remote_execution_supported"])
        public = result.stdout
        for forbidden in ["fixture-h1", "100.64.0.1", "/home/fixture", "1" * 64, str(self.state)]:
            self.assertNotIn(forbidden, public)
        inv.write_text('{"credential":"private-sentinel"}')
        result = cli("plan", "--inventory", inv, "--runtime-lock", lock)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn("private-sentinel", result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["result"], "error")
        result = cli("fixture", "purge", *args)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(str(self.state), result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

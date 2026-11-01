"""Offline bundle contracts. Every identity, image and credential is synthetic."""
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import bundle
import labctl
from test_labctl import inputs


def fixture():
    inventory, lock = inputs()
    plan = labctl.build_plan(inventory, lock)
    runtime = {"schema_version": 1, "template_revision": "p1b-v1",
               "runtime_uid": 12001, "runtime_gid": 12001,
               "secret_revision": "synthetic-credentials-v1",
               "mithril_image": "synthetic/mithril@sha256:" + "d" * 64,
               "mithril_image_provenance": {
                   "research_commit": lock["research_commit"],
                   "binary_sha256": lock["mithril_binary_sha256"],
                   "platform": lock["platform"], "evidence_reference": "synthetic-image-v1"}}
    credentials = {"schema_version": 1, **{name: "SYNTHETIC_SENTINEL_" + name
                   for name in ("backend_proxy", "backend_replication", "backend_operator",
                                "proxy_app", "proxy_admin")}}
    return plan, runtime, credentials


class BundleContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.plan, self.runtime, self.credentials = fixture()
        self.digest = self.plan["plan_sha256"]

    def build(self, **changes):
        return bundle.build_bundle(changes.get("plan", self.plan),
                                   changes.get("digest", self.digest),
                                   changes.get("runtime", self.runtime),
                                   changes.get("credentials", self.credentials))

    def assert_no_secrets(self, value):
        for secret in list(self.credentials.values())[1:]:
            self.assertNotIn(secret, value)
            self.assertNotIn(hashlib.sha256(secret.encode()).hexdigest(), value)

    def assert_private_output(self, value):
        self.assert_no_secrets(value)
        for marker in ["100.64.0.1", "fixture-h1", "/home/fixture", str(self.root), "1" * 64]:
            self.assertNotIn(marker, value)

    def test_manifest_exact_reconstruction_detaches_source(self):
        before = copy.deepcopy(self.plan)
        manifest = bundle.build_manifest(self.plan, self.digest, self.runtime)
        self.assertEqual(set(manifest), {"schema_version", "lane", "source_plan", "runtime_spec", "bundle_sha256"})
        self.assertEqual(manifest["lane"], "offline-bundle")
        self.assertEqual(manifest["bundle_sha256"], labctl.digest({k: v for k, v in manifest.items() if k != "bundle_sha256"}))
        self.assertEqual(bundle.validate_manifest(manifest, manifest["bundle_sha256"]), manifest)
        self.assertEqual(self.plan, before)
        manifest["source_plan"]["caps"]["cache"] = True
        self.assertEqual(self.plan, before)

    def test_recomputed_hash_semantic_tamper_and_independent_binding(self):
        original = bundle.build_manifest(self.plan, self.digest, self.runtime)
        mutations = [lambda m: m.update(extra=True), lambda m: m.update(lane="ssh"),
                     lambda m: m.update(schema_version=True),
                     lambda m: m["source_plan"].update(topology=[]),
                     lambda m: m["source_plan"]["caps"].update(cache=True),
                     lambda m: m["runtime_spec"].update(runtime_uid=0),
                     lambda m: m["runtime_spec"].update(template_revision="p1b-v2"),
                     lambda m: m["runtime_spec"]["mithril_image_provenance"].update(binary_sha256="f" * 64)]
        for mutate in mutations:
            changed = copy.deepcopy(original)
            mutate(changed)
            if changed["source_plan"] != original["source_plan"]:
                changed["source_plan"]["plan_sha256"] = labctl.digest({
                    k: v for k, v in changed["source_plan"].items() if k != "plan_sha256"})
            changed["bundle_sha256"] = labctl.digest({k: v for k, v in changed.items() if k != "bundle_sha256"})
            with self.subTest(mutate=mutate), self.assertRaises(labctl.LabError):
                bundle.validate_manifest(changed, changed["bundle_sha256"])
        with self.assertRaises(labctl.LabError):
            bundle.validate_manifest(original, "f" * 64)
        with self.assertRaises(labctl.LabError):
            self.build(digest="f" * 64)

    def test_runtime_strict_types_pins_and_provenance(self):
        for key, value in [("schema_version", True), ("runtime_uid", "12001"),
                           ("runtime_gid", False), ("runtime_uid", 0),
                           ("runtime_gid", -1), ("runtime_uid", 2 ** 32),
                           ("secret_revision", "bad\nuser default on nopass"),
                           ("mithril_image", "mithril:latest"),
                           ("mithril_image", "mithril@sha256:" + "d" * 64 + "\n"),
                           ("mithril_image_provenance", {}), ("extra", "x")]:
            with self.subTest(key=key, value=value), self.assertRaises(labctl.LabError):
                self.build(runtime=dict(self.runtime, **{key: value}))
        for key in ["research_commit", "binary_sha256", "platform", "evidence_reference"]:
            runtime = copy.deepcopy(self.runtime)
            runtime["mithril_image_provenance"][key] = "invalid drift"
            with self.subTest(provenance=key), self.assertRaises(labctl.LabError):
                self.build(runtime=runtime)

    def test_unresolved_image_is_nonrunnable_draft_and_draft_plan_refused(self):
        runtime = dict(self.runtime, mithril_image="UNRESOLVED", mithril_image_provenance="UNRESOLVED")
        draft = self.build(runtime=runtime)
        self.assertEqual(draft.classification, "draft")
        self.assertEqual(draft.hosts["H4"]["services"], {})
        self.assertNotIn('"image"', json.dumps(draft.hosts["H4"]))
        self.assertFalse(draft.live_ready)
        for key in ["mithril_image", "mithril_image_provenance"]:
            with self.assertRaises(labctl.LabError):
                self.build(runtime=dict(self.runtime, **{key: "UNRESOLVED"}))
        inventory, lock = inputs()
        inventory["access_policy_revision"] = "UNRESOLVED"
        plan = labctl.build_plan(inventory, lock)
        with self.assertRaises(labctl.LabError):
            self.build(plan=plan, digest=plan["plan_sha256"])

    def test_fixed_topology_labels_nonroot_caps_mounts_argv(self):
        result = self.build()
        self.assertEqual(set(result.hosts), {"H1", "H2", "H3", "H4"})
        expected = {"H1": {"M1", "R3"}, "H2": {"M2", "R1"}, "H3": {"M3", "R2"}, "H4": {"A"}}
        hosts = {h["role"]: h for h in self.plan["inventory"]["hosts"]}
        for host, document in result.hosts.items():
            self.assertEqual(set(document["services"]), expected[host])
            for role, service in document["services"].items():
                self.assertEqual(service["user"], "12001:12001")
                self.assertEqual(service["network_mode"], "host")
                self.assertEqual(service["cap_drop"], ["ALL"])
                self.assertEqual(service["security_opt"], ["no-new-privileges:true"])
                self.assertTrue(service["read_only"])
                self.assertEqual(service["mem_limit"], "1024m")
                self.assertEqual(service["logging"]["options"], {"max-size": "10m", "max-file": "3"})
                self.assertNotIn("ports", service)
                self.assertNotIn("privileged", service)
                self.assertEqual(service["labels"], {
                    "io.mithril-research.run": self.plan["run_id"],
                    "io.mithril-research.plan": self.digest,
                    "io.mithril-research.bundle": result.manifest["bundle_sha256"],
                    "io.mithril-research.role": role})
                self.assertEqual(service["image"], self.runtime["mithril_image"] if role == "A" else self.plan["runtime_lock"]["redis_image"])
                self.assertIsInstance(service["entrypoint"], list)
                self.assertIsInstance(service["command"], list)
                self.assertNotIn("sh", service["entrypoint"])
                for mount in service["volumes"]:
                    self.assertEqual(mount["type"], "bind")
                    self.assertEqual(mount["bind"], {"create_host_path": False})
                    self.assertTrue(mount["source"].startswith(hosts[host]["data_root"] + "/"))
                    self.assertNotIn("docker.sock", mount["source"])
                    self.assertEqual(mount["read_only"], mount["target"].startswith("/config/"))
        self.assertFalse(result.live_ready)
        self.assertEqual(result.live_runtime, "UNEXECUTED")
        self.assert_private_output(repr(result))

    def test_six_redis_config_acl_sets_and_real_mithril_syntax(self):
        result = self.build()
        redis = [k for k in result.files if k.endswith("redis.conf")]
        acls = [k for k in result.files if k.endswith("users.acl")]
        self.assertEqual(len(redis), 6)
        self.assertEqual(len(acls), 6)
        disabled = "user default reset off resetpass -@all resetkeys resetchannels"
        for node in self.plan["topology"]:
            role, host = node["role"], node["host"]
            if role == "A":
                continue
            config = result.files[f"{host}/config/{role}/redis.conf"]
            ip = next(h["tailnet_ipv4"] for h in self.plan["inventory"]["hosts"] if h["role"] == host)
            for line in [f"bind {ip}", f"cluster-announce-ip {ip}",
                         f"port {node['port']}", f"cluster-port {node['bus_port']}",
                         f"cluster-announce-port {node['port']}", f"cluster-announce-bus-port {node['bus_port']}",
                         "appendonly yes", "appendfsync everysec", "dir /data", "cluster-config-file /data/nodes.conf",
                         "maxmemory 256mb", "maxmemory-policy noeviction", "masteruser backend_replication",
                         "masterauth " + self.credentials["backend_replication"]]:
                self.assertIn(line + "\n", config)
            acl = result.files[f"{host}/config/{role}/users.acl"]
            self.assertIn(disabled, acl)
            self.assertIn("+cluster|nodes", acl)
            self.assertIn("+readonly", acl)
            self.assertIn("+psync", acl)
            self.assertIn("+replconf", acl)
            for name in ["backend_proxy", "backend_replication", "backend_operator"]:
                self.assertIn(f"user {name} reset on >{self.credentials[name]} ", acl)
            self.assertNotIn(self.credentials["proxy_app"], acl)
        config = result.files["H4/config/A/mithril.conf"]
        for line in ["bind 100.64.0.4", "announce-addr 100.64.0.4:17979", "port 17979",
                     "bootstrap 100.64.0.1:17001,100.64.0.2:17001,100.64.0.3:17001",
                     "worker-threads 2", "backend-conns 1", "maxclients 256", "query-buffer-limit 4mb",
                     "backend-sharding no", "reply-cache no", "slave-mode off", "acl-pubsub-default resetchannels", disabled,
                     "backend-auth-user backend_proxy", "backend-auth-pass " + self.credentials["backend_proxy"]]:
            self.assertIn(line + "\n", config)
        self.assertNotIn("include", config)
        app = next(line for line in config.splitlines() if line.startswith("user proxy_app "))
        self.assertEqual(app, f"user proxy_app reset on >{self.credentials['proxy_app']} ~fixture-demo:* resetchannels -@all +ping +set +get +ttl +del")
        admin = next(line for line in config.splitlines() if line.startswith("user proxy_admin "))
        self.assertNotIn("+@all", admin)
        self.assertIn("+info", admin)

    def test_credentials_reject_injection_duplicates_and_malformed_types(self):
        for value in ["", "a b", "x\nuser default on nopass", "x\r", "x\t", "x\x00", "x\x7f", "é", "'quoted'", '"quoted"',
                      "x#comment", "x>rule", "$(id)", "x\\", "x" * 257, [], True, None]:
            with self.subTest(value=value), self.assertRaises(labctl.LabError) as caught:
                self.build(credentials=dict(self.credentials, proxy_app=value))
            self.assertNotIn("user default on nopass", str(caught.exception))
        with self.assertRaises(labctl.LabError):
            self.build(credentials=dict(self.credentials, proxy_admin=self.credentials["proxy_app"]))
        for changed in [dict(self.credentials, schema_version=True), dict(self.credentials, extra="x"), {}]:
            with self.assertRaises(labctl.LabError):
                self.build(credentials=changed)

    def test_no_secret_or_secret_hash_in_manifest_summary_or_argv(self):
        first = self.build()
        credentials = {k: v + "SECOND" if k != "schema_version" else v for k, v in self.credentials.items()}
        second = self.build(credentials=credentials)
        self.assertEqual(first.manifest, second.manifest)
        # The private manifest intentionally binds the full source inventory;
        # only CLI summaries omit identities, paths and addresses.
        self.assert_no_secrets(json.dumps(first.manifest))
        for doc in first.hosts.values():
            for service in doc["services"].values():
                self.assert_private_output(json.dumps(service["entrypoint"] + service["command"]))
        summary = bundle.write_bundle(first, self.root / "bundle")
        self.assert_private_output(json.dumps(summary))
        self.assertFalse(summary["live_ready"])
        self.assertEqual(summary["live_runtime"], "UNEXECUTED")

    def test_private_output_exclusive_permissions_and_retained_files(self):
        result = self.build()
        output = self.root / "bundle"
        summary = bundle.write_bundle(result, output)
        self.assertEqual(summary["hosts"], 4)
        self.assertEqual(summary["redis_nodes"], 6)
        self.assertEqual(json.loads((output / "manifest.json").read_text()), result.manifest)
        for name, contents in result.files.items():
            self.assertEqual((output / name).read_text(), contents)
        for path in [output, *output.rglob("*")]:
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o700 if path.is_dir() else 0o600)
        before = (output / "manifest.json").read_bytes()
        with self.assertRaises(labctl.LabError):
            bundle.write_bundle(result, output)
        self.assertEqual(before, (output / "manifest.json").read_bytes())

    def test_output_traversal_source_remote_intent_and_links_refused_before_write(self):
        result = self.build()
        link = self.root / "link"
        link.symlink_to(self.root, target_is_directory=True)
        for output in [self.root / ".." / self.root.name / "traversed", SCRIPTS / "forbidden",
                       Path("/home/fixture/mithril/fixture-demo/subdir"), link / "child", link,
                       Path("relative-output")]:
            with self.subTest(output=output), self.assertRaises(labctl.LabError):
                bundle.write_bundle(result, output)
        self.assertFalse((self.root / "traversed").exists())
        self.assertFalse((self.root / "child").exists())
        unsafe = self.root / "unsafe"
        unsafe.mkdir(mode=0o755)
        with self.assertRaises(labctl.LabError):
            bundle.write_bundle(result, unsafe / "child")
        self.assertFalse((unsafe / "child").exists())

    def test_render_tamper_is_refused_before_output_creation(self):
        for mutate in [lambda b: b.files.update({"../escape": "bad"}),
                       lambda b: b.hosts["H1"]["services"]["M1"].update(privileged=True),
                       lambda b: b.files.update({"H4/config/A/mithril.conf": "user default on nopass"})]:
            result = self.build()
            mutate(result)
            output = self.root / "tampered"
            with self.subTest(mutate=mutate), self.assertRaises(labctl.LabError):
                bundle.write_bundle(result, output)
            self.assertFalse(output.exists())

    def test_malformed_bundle_manifest_is_bounded_refusal(self):
        for value in [None, [], "invalid", 1, {}, {"bundle_sha256": []}]:
            result = self.build()
            result.manifest = value
            with self.subTest(value=value), self.assertRaises(labctl.LabError):
                bundle.write_bundle(result, self.root / "invalid-manifest")
            self.assertFalse((self.root / "invalid-manifest").exists())

    def test_injected_output_hardlink_retains_target_and_partial_evidence(self):
        result = self.build()
        target = self.root / "untouched"
        target.write_text("synthetic retained evidence")
        target.chmod(0o600)
        original = bundle._save_file
        def inject(rootfd, relative, payload):
            if relative == "manifest.json":
                os.link(target, "manifest.json", dst_dir_fd=rootfd)
            return original(rootfd, relative, payload)
        output = self.root / "partially-written"
        with patch.object(bundle, "_save_file", side_effect=inject):
            with self.assertRaises(labctl.LabError):
                bundle.write_bundle(result, output)
        self.assertEqual(target.read_text(), "synthetic retained evidence")
        self.assertTrue(output.is_dir())
        self.assertTrue((output / "H1/compose.json").is_file())

    def save(self, name, value):
        path = self.root / name
        path.write_text(json.dumps(value))
        path.chmod(0o600)
        return path

    def cli(self, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / "bundle.py"), *map(str, args)], capture_output=True, text=True, timeout=10)

    def cli_args(self, output="cli-bundle"):
        return ["--plan", self.save("plan.json", self.plan), "--expected-plan-digest", self.digest,
                "--runtime-spec", self.save("runtime.json", self.runtime),
                "--credentials", self.save("credentials.json", self.credentials), "--output", self.root / output]

    def test_actual_cli_generation_and_all_output_privacy(self):
        result = self.cli(*self.cli_args())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["classification"], "review-only")
        self.assert_private_output(result.stdout + result.stderr)
        self.assertIn(self.credentials["proxy_app"], (self.root / "cli-bundle/H4/config/A/mithril.conf").read_text())
        result = self.cli("--unknown", self.credentials["proxy_app"])
        self.assertEqual(result.returncode, 2)
        self.assert_private_output(result.stdout + result.stderr)

    def test_cli_private_credential_files_size_links_duplicates_and_sanitized_errors(self):
        arguments = self.cli_args()
        cred = self.root / "credentials.json"
        for raw in [b'{"schema_version":1,"proxy_app":"SYNTHETIC_SENTINEL_proxy_app","proxy_app":"x"}',
                    b"x" * (64 * 1024 + 1), b"\xff", b'{"schema_version":NaN}']:
            cred.write_bytes(raw)
            result = self.cli(*arguments)
            self.assertEqual(result.returncode, 2)
            self.assert_private_output(result.stdout + result.stderr)
        cred.write_text(json.dumps(self.credentials))
        cred.chmod(0o644)
        self.assertEqual(self.cli(*arguments).returncode, 2)
        cred.chmod(0o600)
        alias = self.root / "credential-alias"
        os.link(cred, alias)
        self.assertEqual(self.cli(*arguments).returncode, 2)
        alias.unlink()
        cred.rename(alias)
        cred.symlink_to(alias)
        self.assertEqual(self.cli(*arguments).returncode, 2)
        self.assertFalse((self.root / "cli-bundle").exists())


if __name__ == "__main__":
    unittest.main()

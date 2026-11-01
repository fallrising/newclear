"""Offline transport contracts. No test invokes SSH or Docker."""
import copy
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import ssh_executor as executor
import ssh_helper as helper
import labctl

MACHINE = b"0123456789abcdef0123456789abcdef\n"


def request(operation="observe", role="A", host="H4", container_id="a" * 64):
    return {"schema_version": 1, "operation_id": "1" * 32, "operation": operation,
            "run_id": "fixture-demo", "plan_sha256": "b" * 64,
            "bundle_sha256": "c" * 64, "host": host,
            "machine_identity_sha256": hashlib.sha256(MACHINE).hexdigest(),
            "target": {"role": role, "container_id": container_id}}


class Docker:
    def __init__(self, req):
        self.req = req
        self.state = "running"
        self.calls = []
        self.bad = None

    def __call__(self, argv, payload, deadline, limit):
        self.calls.append(argv)
        assert argv[:3] == ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock"]
        args = argv[3:]
        rid = self.req["target"]["container_id"]
        if args[:2] == ["container", "ls"]:
            if self.bad == "enumeration":
                raise helper.ProtocolError("transport-failed")
            return (b"" if self.state == "absent" else (rid + "\n").encode())
        if args[0] == "inspect":
            if self.bad == "inspect":
                raise helper.ProtocolError("transport-failed")
            if self.bad == "json":
                return b"[]"
            obj = {"Id": rid, "Config": {"Labels": helper.labels(self.req)},
                   "State": {"Status": self.state, "Running": self.state == "running",
                             "Paused": False, "Restarting": False}}
            if self.bad == "foreign":
                obj["Config"]["Labels"]["io.mithril-research.run"] = "another-run"
            if self.bad == "id":
                obj["Id"] = "f" * 64
            return json.dumps([obj]).encode()
        if args[0] == "stop":
            self.state = "exited"
            return (rid + "\n").encode()
        if args[0] == "rm":
            self.state = "absent"
            return (rid + "\n").encode()
        raise AssertionError(argv)


class HelperTests(unittest.TestCase):
    def test_identity_exact_bytes_and_drift_refuses_effects(self):
        req = request("stop")
        docker = Docker(req)
        result = helper.handle(req, _runner=docker, _machine=lambda: MACHINE[:-1])
        self.assertEqual(result["observation"], "unknown")
        self.assertEqual(docker.calls, [])
        for raw in (b"", b"0" * 33, b"g" * 32 + b"\n", MACHINE + b"\n"):
            self.assertEqual(helper.handle(req, _runner=docker, _machine=lambda: raw)["observation"], "unknown")

    def test_fixed_endpoint_exact_ownership_and_stop_remove(self):
        req = request("stop")
        docker = Docker(req)
        result = helper.handle(req, _runner=docker, _machine=lambda: MACHINE)
        self.assertEqual(result["observation"], "stopped")
        req["operation"] = "remove"
        result = helper.handle(req, _runner=docker, _machine=lambda: MACHINE)
        self.assertEqual(result["observation"], "absent")
        effects = [a[3:] for a in docker.calls if a[3] in {"stop", "rm"}]
        self.assertEqual(effects, [["stop", "--time", "10", "a" * 64], ["rm", "a" * 64]])
        self.assertEqual(result["origin"], "mock-ssh")

    def test_running_remove_and_foreign_never_effect(self):
        for bad in (None, "foreign", "id", "inspect", "enumeration", "json"):
            with self.subTest(bad=bad):
                req = request("remove")
                docker = Docker(req)
                docker.bad = bad
                result = helper.handle(req, _runner=docker, _machine=lambda: MACHINE)
                self.assertIn(result["observation"], {"running", "foreign", "unknown"})
                self.assertFalse(any(a[3] in {"stop", "rm"} for a in docker.calls))

    def test_only_successful_enumeration_proves_absence(self):
        req = request()
        docker = Docker(req)
        docker.state = "absent"
        self.assertEqual(helper.handle(req, _runner=docker, _machine=lambda: MACHINE)["observation"], "absent")
        docker.bad = "enumeration"
        self.assertEqual(helper.handle(req, _runner=docker, _machine=lambda: MACHINE)["observation"], "unknown")

    def test_mutations_require_present_owned_precondition(self):
        for operation in ("stop", "remove"):
            req = request(operation)
            docker = Docker(req)
            docker.state = "absent"
            self.assertEqual(helper.handle(req, _runner=docker, _machine=lambda: MACHINE)["observation"], "unknown")

    def test_malformed_inspect_status_remains_unknown(self):
        req = request()
        docker = Docker(req)
        docker.state = []
        self.assertEqual(helper.handle(req, _runner=docker, _machine=lambda: MACHINE)["observation"], "unknown")

    def test_strict_protocol_and_json(self):
        for changed in (dict(request(), extra="sentinel"), dict(request(), schema_version=True),
                        dict(request(), operation="purge"), dict(request(), host="H1"),
                        dict(request(), target={"role": "A", "container_id": "short"})):
            with self.assertRaises(helper.ProtocolError):
                helper.validate_request(changed)
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'[]', b'"bad"', b'x' * (helper.MAX_BYTES + 1)):
            with self.assertRaises(helper.ProtocolError):
                helper.validate_request(helper.decode(raw))


class ProcessTests(unittest.TestCase):
    def process(self, code, deadline=1, limit=2048):
        return helper.bounded_run([sys.executable, "-c", code], b"hello", deadline, limit)

    def test_real_subprocess_stdin_and_concurrent_streams(self):
        raw = self.process("import sys; data=sys.stdin.buffer.read();sys.stderr.write('ok');sys.stdout.buffer.write(data)")
        self.assertEqual(raw, b"hello")

    def test_deadline_lost_reply_and_children_holding_pipes(self):
        for code in ("import time; time.sleep(5)",
                     "import os,time; child=os.fork();time.sleep(5) if child==0 else None"):
            started = time.monotonic()
            with self.assertRaises(helper.ProtocolError):
                self.process(code, deadline=.15)
            self.assertLess(time.monotonic() - started, 2)

    def test_stdout_stderr_bounds_nonzero_and_malformed_reply(self):
        for code in ("import sys;sys.stdout.write('x'*100000)",
                     "import sys;sys.stderr.write('secret-sentinel'*10000)",
                     "import sys;sys.exit(4)"):
            with self.assertRaises(helper.ProtocolError) as caught:
                self.process(code)
            self.assertNotIn("secret-sentinel", str(caught.exception))

    def test_helper_cli_sanitizes_untrusted_input(self):
        result = subprocess.run([sys.executable, str(SCRIPTS / "ssh_helper.py")],
                                input=b'{"secret":"sentinel"}', capture_output=True)
        self.assertEqual(result.returncode, 2)
        self.assertNotIn(b"sentinel", result.stdout + result.stderr)


class TransportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = {}
        for key in ("ssh_config", "known_hosts"):
            path = self.root / key
            path.write_text("# synthetic private mapping\n")
            path.chmod(0o600)
            self.config[key] = str(path)
        self.config.update(schema_version=1, deadline_seconds=2)

    def test_ssh_argv_constant_command_and_inherited_options(self):
        argv = executor.ssh_argv(self.config, "fixture-h4")
        self.assertEqual(argv[0], "/usr/bin/ssh")
        self.assertEqual(argv[-2], "fixture-h4")
        self.assertEqual(argv[-1], executor.REMOTE_COMMAND)
        for option in ("StrictHostKeyChecking=yes", "ClearAllForwardings=yes", "ForwardAgent=no",
                       "ForwardX11=no", "ControlMaster=no", "ControlPath=none", "ControlPersist=no",
                       "BatchMode=yes", "RequestTTY=no", "Tunnel=no", "PermitLocalCommand=no"):
            self.assertIn(option, argv)
        with self.assertRaises(labctl.LabError):
            executor.ssh_argv(self.config, "fixture; touch sentinel")
        with self.assertRaises(labctl.LabError):
            executor.ssh_argv(dict(self.config, command="sentinel"), "fixture-h4")

    def test_mapping_types_refuse_without_unhandled_errors(self):
        for value in (None, True, 12, [], {}):
            with self.subTest(value=value):
                with self.assertRaises(labctl.LabError):
                    executor.ssh_argv(dict(self.config, known_hosts=value), "fixture-h4")

    def test_mapping_cannot_run_config_hooks_or_include_other_files(self):
        path = Path(self.config["ssh_config"])
        for directive in ("Match exec secret-sentinel", "Include /private/config", "LocalCommand secret-sentinel",
                          "ProxyCommand secret-sentinel", "KnownHostsCommand secret-sentinel",
                          "PKCS11Provider /private/provider", "RemoteCommand secret-sentinel"):
            path.write_text("Host fixture-h4\n  HostName 100.64.0.4\n" + directive + "\n")
            with self.subTest(directive=directive):
                with self.assertRaises(labctl.LabError):
                    executor.ssh_argv(self.config, "fixture-h4")
        path.write_text("Host fixture-h4\n  HostName=100.64.0.4\n  User fixture\n  Port 22\n  IdentityFile /private/key\n")
        self.assertEqual(executor.ssh_argv(self.config, "fixture-h4")[-2], "fixture-h4")

    def test_knownhosts_path_cannot_expand_ssh_tokens(self):
        path = self.root / "known-%h"
        path.write_text("# literal name must not become an SSH expansion")
        path.chmod(0o600)
        with self.assertRaises(labctl.LabError):
            executor.ssh_argv(dict(self.config, known_hosts=str(path)), "fixture-h4")

    def test_private_mapping_links_permissions(self):
        path = Path(self.config["known_hosts"])
        path.chmod(0o644)
        with self.assertRaises(labctl.LabError):
            executor.ssh_argv(self.config, "fixture-h4")
        path.chmod(0o600)
        alias = self.root / "link"
        alias.symlink_to(path)
        with self.assertRaises(labctl.LabError):
            executor.ssh_argv(dict(self.config, known_hosts=str(alias)), "fixture-h4")

    def test_mock_transport_real_subprocess_and_echo_binding(self):
        req = request()
        code = "import json,sys;r=json.load(sys.stdin);print(json.dumps(dict(r,origin='mock-ssh',observation='running')))"
        def runner(argv, payload, deadline, limit):
            self.assertEqual(argv[-1], executor.REMOTE_COMMAND)
            self.assertEqual(json.loads(payload), req)
            return helper.bounded_run([sys.executable, "-c", code], payload, deadline, limit)
        transport = executor.Transport(self.config, _runner=runner)
        self.assertEqual(transport.send(req, "fixture-h4")["origin"], "mock-ssh")
        for raw in (b"{}", b'{"x":1,"x":2}', b"secret-sentinel", b"x" * (helper.MAX_BYTES + 1)):
            with self.assertRaises(labctl.LabError):
                executor.Transport(self.config, _runner=lambda *args: raw).send(req, "fixture-h4")
        reply = dict(req, origin="ssh", observation="running")
        with self.assertRaises(labctl.LabError):
            executor.Transport(self.config, _runner=lambda *args: helper.canonical(reply)).send(req, "fixture-h4")


class ControllerTests(unittest.TestCase):
    def setUp(self):
        from test_labctl import inputs
        bundle = importlib.import_module("bundle")
        inventory, lock = inputs()
        self.plan = labctl.build_plan(inventory, lock)
        runtime = {"schema_version": 1, "template_revision": "p1b-v1", "runtime_uid": 1001,
                   "runtime_gid": 1001, "secret_revision": "fixture-secrets-v1",
                   "mithril_image": "fixture-mithril@sha256:" + "d" * 64,
                   "mithril_image_provenance": {"research_commit": lock["research_commit"],
                       "binary_sha256": lock["mithril_binary_sha256"], "platform": lock["platform"],
                       "evidence_reference": "fixture-image-v1"}}
        self.manifest = bundle.build_manifest(self.plan, self.plan["plan_sha256"], runtime)
        self.ownership = {"schema_version": 1, "run_id": self.plan["run_id"],
                          "plan_sha256": self.plan["plan_sha256"],
                          "bundle_sha256": self.manifest["bundle_sha256"],
                          "targets": [{"host": n["host"], "role": n["role"], "container_id": str(i + 1) * 64}
                                      for i, n in enumerate(self.plan["topology"])]}
        self.admission = {"schema_version": 1, "purpose": "down", "admission_id": "a" * 32,
                          "approval_reference": "fixture-independent-approval", "ownership": self.ownership,
                          "actions": ["stop", "remove"], "clients_stopped": True}
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.state = self.root / "state"
        self.states = {t["container_id"]: "running" for t in self.ownership["targets"]}
        self.calls = []
        self.fail_operation = None
        class FakeTransport:
            origin = "mock-ssh"
            def send(inner, req, alias):
                self.calls.append(copy.deepcopy(req))
                action, rid = req["operation"], req["target"]["container_id"]
                if action == "stop":
                    self.states[rid] = "stopped"
                if action == "remove":
                    self.states[rid] = "absent"
                if self.fail_operation == action:
                    raise labctl.LabError("transport-uncertain")
                return dict(req, origin="mock-ssh", observation=self.states[rid])
        self.transport = FakeTransport()

    def invoke(self, action="down", **kwargs):
        return executor.control(self.manifest, self.manifest["bundle_sha256"], self.ownership,
                                self.state, action, self.transport, admission=self.admission,
                                execute_approved=True, **kwargs)

    def read(self):
        return json.loads((self.state / "state.json").read_text())

    def test_first_observe_is_independent_of_down(self):
        result = self.invoke("observe")
        self.assertEqual(result["observations"]["running"], 7)
        self.assertEqual(result["operations"], 0)
        self.assertTrue(all(r["operation"] == "observe" for r in self.calls))
        self.assertEqual(self.read()["journal"], [])

    def test_nonterminal_remove_and_restart_remain_fenced(self):
        self.fail_operation = "remove"
        with self.assertRaises(labctl.LabError):
            self.invoke()
        self.fail_operation = None
        rid = self.read()["journal"][-1]["request"]["target"]["container_id"]
        self.states[rid] = "stopped"
        self.invoke("reconcile")
        self.assertEqual(self.read()["journal"][-1]["status"], "uncertain")
        self.admission = dict(self.admission, admission_id="b" * 32,
                              approval_reference="fixture-new-approval")
        self.states[rid] = "running"
        before = len(self.calls)
        with self.assertRaises(labctl.LabError):
            self.invoke()
        self.assertEqual(before, len(self.calls))

    def test_down_fixed_order_retains_all_records_and_data(self):
        retained = self.root / "data"
        retained.write_text("retained marker")
        result = self.invoke()
        self.assertEqual(result["origin"], "mock-ssh")
        effects = [(r["target"]["role"], r["operation"]) for r in self.calls if r["operation"] != "observe"]
        self.assertEqual(effects, [(role, op) for role in ["A", "R3", "R2", "R1", "M3", "M2", "M1"] for op in ["stop", "remove"]])
        self.assertEqual(retained.read_text(), "retained marker")
        self.assertEqual(len(self.read()["journal"]), 14)
        before = self.read()
        self.invoke("reconcile")
        self.assertEqual(before, self.read())

    def test_lost_reply_durable_fence_reconcile_without_replay(self):
        self.fail_operation = "stop"
        with self.assertRaises(labctl.LabError):
            self.invoke()
        state = self.read()
        self.assertEqual(state["journal"][-1]["status"], "uncertain")
        self.fail_operation = None
        before = len(self.calls)
        with self.assertRaises(labctl.LabError):
            self.invoke()
        self.assertEqual(before, len(self.calls))
        self.invoke("reconcile")
        self.assertEqual(self.read()["journal"][-1]["status"], "completed")
        self.assertTrue(all(r["operation"] == "observe" for r in self.calls[before:]))
        self.invoke()
        operation_ids = [r["operation_id"] for r in self.calls if r["operation"] != "observe"]
        self.assertEqual(len(operation_ids), len(set(operation_ids)))

    def test_real_subprocess_lost_reply_preserves_durable_uncertainty(self):
        config = {"schema_version": 1, "deadline_seconds": 2}
        for key in ("ssh_config", "known_hosts"):
            path = self.root / key
            path.write_text("# synthetic config")
            path.chmod(0o600)
            config[key] = str(path)
        remote_state = self.root / "mock-remote.json"
        remote_state.write_text(json.dumps(self.states))
        lost = [True]
        code = """import json,pathlib,sys
req=json.load(sys.stdin);path=pathlib.Path(sys.argv[1]);states=json.loads(path.read_text())
action=req['operation'];rid=req['target']['container_id']
if action=='stop': states[rid]='stopped'
if action=='remove': states[rid]='absent'
path.write_text(json.dumps(states))
if action=='stop' and sys.argv[2]=='lost': sys.exit(7)
print(json.dumps(dict(req,origin='mock-ssh',observation=states[rid])))
"""
        def runner(argv, payload, deadline, limit):
            self.assertEqual(argv[-1], executor.REMOTE_COMMAND)
            return helper.bounded_run([sys.executable, "-c", code, str(remote_state),
                                       "lost" if lost[0] else "ok"], payload, deadline, limit)
        self.transport = executor.Transport(config, _runner=runner)
        with self.assertRaises(labctl.LabError):
            self.invoke()
        self.assertEqual(self.read()["journal"][-1]["status"], "uncertain")
        lost[0] = False
        self.invoke("reconcile")
        self.assertEqual(self.read()["journal"][-1]["status"], "completed")
        self.invoke()
        self.assertEqual(set(json.loads(remote_state.read_text()).values()), {"absent"})

    def test_intent_persisted_before_effect_and_remove_lost_reply(self):
        original = self.transport.send
        def checked(req, alias):
            if req["operation"] != "observe":
                self.assertEqual(self.read()["journal"][-1]["request"], req)
                self.assertEqual(self.read()["journal"][-1]["status"], "uncertain")
            return original(req, alias)
        self.transport.send = checked
        self.fail_operation = "remove"
        with self.assertRaises(labctl.LabError):
            self.invoke()
        self.fail_operation = None
        self.invoke("reconcile")
        self.assertEqual(self.read()["journal"][-1]["status"], "completed")

    def test_unknown_foreign_and_resurrection_block(self):
        for observed in ("unknown", "foreign", "absent"):
            self.states = dict.fromkeys(self.states, observed)
            with self.assertRaises(labctl.LabError):
                self.invoke()
            self.assertFalse(any(r["operation"] != "observe" for r in self.calls))
        self.states = dict.fromkeys(self.states, "running")
        self.invoke()
        self.states = dict.fromkeys(self.states, "running")
        with self.assertRaises(labctl.LabError):
            self.invoke()

    def late_effect_case(self, operation):
        """A remote-like child can outlive the lost reply and act after reconcile."""
        remote_state = self.root / "late-remote.json"
        initial = "running" if operation == "stop" else "stopped"
        remote_state.write_text(json.dumps(dict.fromkeys(self.states, initial)))
        release = self.root / "release-late-effect"
        dispatches, children = [], []
        code = """import json,pathlib,sys,time
state,release=map(pathlib.Path,sys.argv[1:3]);rid,terminal=sys.argv[3:5]
expires=time.monotonic()+10
while not release.exists():
 if time.monotonic()>expires: sys.exit(8)
 time.sleep(.01)
values=json.loads(state.read_text());values[rid]=terminal;state.write_text(json.dumps(values))
"""
        class DelayedTransport:
            origin = "mock-ssh"
            def send(inner, req, alias):
                rid = req["target"]["container_id"]
                if req["operation"] == "observe":
                    return dict(req, origin="mock-ssh", observation=json.loads(remote_state.read_text())[rid])
                dispatches.append(copy.deepcopy(req))
                if not children:
                    child = subprocess.Popen([sys.executable, "-c", code, str(remote_state), str(release),
                                              rid, "stopped" if operation == "stop" else "absent"],
                                             stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                             stderr=subprocess.DEVNULL, start_new_session=True)
                    children.append(child)
                raise labctl.LabError("transport-uncertain")
        self.transport = DelayedTransport()
        try:
            with self.assertRaises(labctl.LabError):
                self.invoke()
            self.assertIsNone(children[0].poll())
            self.invoke("reconcile")
            first_status = self.read()["journal"][0]["status"]
            self.admission = dict(self.admission, admission_id="b" * 32,
                                  approval_reference="fixture-new-approval")
            rejected = False
            try:
                self.invoke()
            except labctl.LabError:
                rejected = True
            # Release the original pending work only after the opposite
            # observation and attempted fresh admission have both occurred.
            release.write_text("release original mock effect")
            self.assertEqual(children[0].wait(timeout=3), 0)
            original = dispatches[0]["target"]["container_id"]
            terminal = "stopped" if operation == "stop" else "absent"
            self.assertEqual(json.loads(remote_state.read_text())[original], terminal)
            self.invoke("reconcile")
            with self.subTest(check="opposite-observation-retains-uncertainty"):
                self.assertEqual(first_status, "uncertain")
            with self.subTest(check="new-admission-cannot-bypass"):
                self.assertTrue(rejected)
                self.assertEqual(len(dispatches), 1)
            with self.subTest(check="terminal-original-observation-completes"):
                self.assertEqual(self.read()["journal"][0]["status"], "completed")
                self.assertEqual(len(self.read()["journal"]), 1)
        finally:
            release.write_text("release retained mock work")
            for child in children:
                try:
                    child.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=1)

    def test_late_stop_opposite_observation_and_new_admission_fence(self):
        self.late_effect_case("stop")

    def test_late_remove_opposite_observation_and_new_admission_fence(self):
        self.late_effect_case("remove")

    def test_unsupported_abandoned_journal_refused_before_observations(self):
        self.fail_operation = "stop"
        with self.assertRaises(labctl.LabError):
            self.invoke()
        self.fail_operation = None
        state = self.read()
        state["journal"][0]["status"] = "abandoned"
        (self.state / "state.json").write_text(json.dumps(state))
        before = len(self.calls)
        with self.assertRaises(labctl.LabError):
            self.invoke("reconcile")
        self.assertEqual(before, len(self.calls))

    def test_unresolved_journal_reference_refused_before_observations(self):
        self.invoke()
        state = self.read()
        for entry in state["journal"]:
            entry["approval_reference"] = "UNRESOLVED"
        (self.state / "state.json").write_text(json.dumps(state))
        for action in ("observe", "reconcile", "down"):
            before = len(self.calls)
            rejected = False
            try:
                self.invoke(action)
            except labctl.LabError:
                rejected = True
            with self.subTest(action=action):
                self.assertTrue(rejected)
                self.assertEqual(before, len(self.calls))

    def test_exact_admission_binding_and_explicit_intent(self):
        for changes in ({"purpose": "purge"}, {"actions": ["remove"]}, {"clients_stopped": False},
                        {"approval_reference": ""}, {"approval_reference": "UNRESOLVED"}, {"extra": "sentinel"}):
            admission = dict(self.admission, **changes)
            with self.assertRaises(labctl.LabError):
                executor.control(self.manifest, self.manifest["bundle_sha256"], self.ownership,
                                 self.state, "down", self.transport, admission=admission, execute_approved=True)
        with self.assertRaises(labctl.LabError):
            executor.control(self.manifest, self.manifest["bundle_sha256"], self.ownership,
                             self.state, "down", self.transport, admission=self.admission)
        self.assertFalse(self.state.exists())

    def test_ownership_duplicates_wrong_role_host_and_bundle_tamper(self):
        for mutate in (lambda o: o["targets"].append(o["targets"][0]),
                       lambda o: o["targets"][0].update(host="H4"),
                       lambda o: o["targets"][0].update(container_id="bad"),
                       lambda o: o.update(bundle_sha256="0" * 64)):
            ownership = copy.deepcopy(self.ownership)
            mutate(ownership)
            with self.assertRaises(labctl.LabError):
                executor.validate_ownership(self.manifest, ownership)

    def test_private_state_lock_links_copied_root_and_malformed_journal(self):
        self.invoke()
        with (self.state / ".lock").open("r+") as held:
            fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
            with self.assertRaises(labctl.LabError):
                self.invoke("reconcile")
        path = self.state / "state.json"
        extra = self.root / "hardlink"
        os.link(path, extra)
        with self.assertRaises(labctl.LabError):
            self.invoke()
        extra.unlink()
        state = self.read()
        state["journal"][0]["request"]["target"]["role"] = "R3"
        path.write_text(json.dumps(state))
        with self.assertRaises(labctl.LabError):
            self.invoke()

    def test_purge_preview_exact_candidates_no_eligibility_or_apply(self):
        preview = executor.purge_preview(self.manifest, self.manifest["bundle_sha256"], self.ownership)
        self.assertEqual(len(preview["candidates"]), 6)
        self.assertEqual(preview["eligible"], [])
        self.assertFalse(preview["apply_supported"])
        self.assertTrue(all("/data/" in c["data_path"] for c in preview["candidates"]))
        self.assertNotEqual(preview["preview_sha256"], self.manifest["bundle_sha256"])
        with self.assertRaises(labctl.LabError):
            executor.validate_purge_approval(preview, preview["preview_sha256"], self.admission)
        self.assertFalse(hasattr(executor, "purge_apply"))

    def test_cli_errors_and_preview_output_are_sanitized(self):
        for arguments in (["purge-apply", "secret-sentinel"], ["down"], ["--help"]):
            result = subprocess.run([sys.executable, str(SCRIPTS / "ssh_executor.py"), *arguments],
                                    capture_output=True, text=True)
            self.assertNotIn("secret-sentinel", result.stdout + result.stderr)
            self.assertNotIn(str(self.root), result.stdout + result.stderr)
            self.assertIn("live_runtime", json.loads(result.stdout))


if __name__ == "__main__":
    unittest.main()

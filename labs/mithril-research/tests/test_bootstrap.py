"""Offline P1c contracts; all identities and responses are synthetic."""
import copy
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import bootstrap
import bundle
import labctl
from test_bundle import fixture

ROLES = ["M1", "M2", "M3", "R1", "R2", "R3"]
RANGES = [[0, 5460], [5461, 10922], [10923, 16383]]
COMMON = ["fresh-authenticated-direct-observations", "exact-session-approval-and-phase-admission",
          "durable-intent-and-uncertainty-fence", "bound-runtime-config-network-and-storage",
          "quiescent-clients-and-per-effect-identity-recheck"]


def snapshot(converged=False):
    source, runtime, _ = fixture()
    manifest = bundle.build_manifest(source, source["plan_sha256"], runtime)
    topology = {n["role"]: n for n in source["topology"] if n["role"] != "A"}
    ids = {role: format(i + 1, "040x") for i, role in enumerate(ROLES)}
    ownership = {"schema_version": 1, "run_id": source["run_id"],
                 "plan_sha256": source["plan_sha256"], "bundle_sha256": manifest["bundle_sha256"],
                 "targets": [{"host": topology[r]["host"], "role": r, "container_id": format(i + 20, "064x")}
                             for i, r in enumerate(ROLES)]}
    hosts = {h["role"]: h for h in source["inventory"]["hosts"]}
    observations = {"schema_version": 1, "lane": "offline-snapshot", "origin": "synthetic",
                    "snapshot_id": "c" * 32, "run_id": source["run_id"],
                    "plan_sha256": source["plan_sha256"], "bundle_sha256": manifest["bundle_sha256"], "nodes": []}
    for i, role in enumerate(ROLES):
        target, host = ownership["targets"][i], hosts[topology[role]["host"]]
        rows = []
        for j, peer in enumerate(ROLES if converged else [role]):
            node = topology[peer]
            replica = converged and peer.startswith("R")
            flags = ("slave" if replica else "master") + (",myself" if role == peer else "")
            epoch = int(peer[1]) if converged else 0
            slots = " " + "-".join(map(str, node["slots"])) if converged and not replica else ""
            rows.append(f"{ids[peer]} {hosts[node['host']]['tailnet_ipv4']}:{node['port']}@{node['bus_port']} "
                        f"{flags} {ids['M' + peer[1]] if replica else '-'} {i+j} {i+j+1} {epoch} connected{slots}\n")
        info = {"cluster_state": "ok" if converged else "fail", "cluster_slots_assigned": 16384 if converged else 0,
                "cluster_slots_ok": 16384 if converged else 0, "cluster_slots_pfail": 0, "cluster_slots_fail": 0,
                "cluster_known_nodes": 6 if converged else 1, "cluster_size": 3 if converged else 0,
                "cluster_current_epoch": 9 if converged else 0, "cluster_my_epoch": int(role[1]) if converged else 0}
        observations["nodes"].append({**target, "machine_identity_sha256": host["machine_identity_sha256"],
            "labels": bundle.labels(manifest, role), "container_state": "running", "cluster_nodes": "".join(rows),
            "cluster_info": "".join(f"{k}:{v}\n" for k, v in info.items()), "info_keyspace": "# Keyspace\r\n"})
    return manifest, ownership, ids, observations


def rehash(plan):
    plan["bootstrap_sha256"] = labctl.digest({k: v for k, v in plan.items() if k != "bootstrap_sha256"})
    return plan


class BootstrapContracts(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest, self.ownership, self.ids, self.observations = snapshot()

    def build(self, **changes):
        return bootstrap.build_bootstrap_plan(changes.get("manifest", self.manifest),
            changes.get("digest", self.manifest["bundle_sha256"]), changes.get("ownership", self.ownership),
            changes.get("ids", self.ids), changes.get("observations", self.observations))

    def refused(self, observations):
        with self.assertRaises(labctl.LabError):
            self.build(observations=observations)

    def assert_flags(self, result):
        self.assertEqual(result["lane"], "offline-bootstrap")
        self.assertIs(result["execution_supported"], False)
        self.assertIs(result["live_ready"], False)
        self.assertEqual(result["live_runtime"], "UNEXECUTED")

    def test_pristine_exact_typed_sequence_barriers_and_detached_inputs(self):
        before = copy.deepcopy((self.manifest, self.ownership, self.ids, self.observations))
        with patch.object(subprocess, "Popen", side_effect=AssertionError("runtime forbidden")), \
             patch.object(socket, "socket", side_effect=AssertionError("network forbidden")):
            result = self.build()
        self.assert_flags(result)
        self.assertEqual(result["classification"], "pristine")
        self.assertEqual(result["observations"], self.observations)
        self.assertEqual(set(result), {"schema_version", "lane", "execution_supported", "live_ready", "live_runtime",
            "source_manifest", "ownership", "expected_node_ids", "observations", "classification", "phases",
            "unmet_requirements", "bootstrap_sha256"})
        phases = result["phases"]
        self.assertEqual([p["phase_id"] for p in phases], ["set-config-epochs", "meet", "assign-slots", "replicate"])
        self.assertEqual([len(p["actions"]) for p in phases], [6, 5, 3, 3])
        before_ids = ["pristine-isolated-empty-zero-epochs", "isolated-empty-assigned-epochs",
                      "six-connected-empty-masters-epoch-six", "exact-slots-with-empty-prospective-replicas"]
        after_ids = before_ids[1:] + ["exact-converged-topology-snapshot"]
        for i, phase in enumerate(phases):
            self.assertEqual(set(phase), {"phase_id", "actions", "requires_before", "requires_after"})
            self.assertEqual(phase["requires_before"], COMMON + [before_ids[i]])
            self.assertEqual(phase["requires_after"], [after_ids[i]])
        for i, action in enumerate(phases[0]["actions"]):
            self.assertEqual(action, {"kind": "set-config-epoch", "epoch": i + 1,
                "target": {**self.ownership["targets"][i], "node_id": self.ids[ROLES[i]]}})
        self.assertEqual([a["peer"]["role"] for a in phases[1]["actions"]], ROLES[1:])
        for action in phases[1]["actions"]:
            peer = action["peer"]
            self.assertEqual(set(peer), {"host", "role", "node_id", "ipv4", "port", "bus_port"})
            self.assertEqual(peer["node_id"], self.ids[peer["role"]])
            self.assertEqual(action["target"]["role"], "M1")
        self.assertEqual([a["slots"] for a in phases[2]["actions"]], RANGES)
        self.assertEqual([a["master_node_id"] for a in phases[3]["actions"]], [self.ids[r] for r in ROLES[:3]])
        self.assertEqual(len(result["unmet_requirements"]), 7)
        self.assertEqual(bootstrap.validate_bootstrap_plan(result, result["bootstrap_sha256"]), result)
        self.assertEqual(before, (self.manifest, self.ownership, self.ids, self.observations))
        result["observations"]["nodes"].clear()
        self.assertEqual(len(self.observations["nodes"]), 6)

    def test_converged_nonempty_subexpiry_replica_epochs_and_equivalent_order(self):
        manifest, ownership, ids, obs = snapshot(True)
        obs["origin"] = "operator-supplied"
        obs["nodes"][0]["info_keyspace"] = "# Keyspace\r\ndb0:keys=5,expires=3,avg_ttl=1200,subexpiry=2\r\n\r\n"
        # Alternate row/flag/split-range order and local ping counters remain equivalent.
        raw = obs["nodes"][1]["cluster_nodes"]
        rows = raw.replace("0-5460", "3001-5460 0 1-3000").replace("master,myself", "myself,master").splitlines()
        obs["nodes"][1]["cluster_nodes"] = "\r\n".join(reversed(rows)) + "\r\n"
        result = self.build(manifest=manifest, ownership=ownership, ids=ids, observations=obs, digest=manifest["bundle_sha256"])
        self.assertEqual(result["classification"], "already-converged")
        self.assertEqual(result["phases"], [])
        self.assert_flags(result)
        self.assertEqual(result["observations"]["origin"], "operator-supplied")
        self.assertEqual(len(result["unmet_requirements"]), 7)
        self.assertEqual(bootstrap.validate_bootstrap_plan(result, result["bootstrap_sha256"]), result)

    def test_raw_order_remains_digest_bound_even_when_topology_equivalent(self):
        a = self.build()
        obs = copy.deepcopy(self.observations)
        obs["nodes"].reverse()
        b = self.build(observations=obs)
        self.assertNotEqual(a["bootstrap_sha256"], b["bootstrap_sha256"])

    def test_public_api_malformed_values_and_serialized_output_bound(self):
        original=self.build()
        for value in [None,True,[],{},"bad"]:
            with self.subTest(plan=value),self.assertRaises(labctl.LabError):
                bootstrap.validate_bootstrap_plan(value,original["bootstrap_sha256"])
            for name in ["manifest","ownership","observations"]:
                with self.subTest(name=name,value=value),self.assertRaises(labctl.LabError):
                    self.build(**{name:value})
        # Every individual raw payload remains within its parser bounds, but
        # JSON escaping makes the original snapshot/proposal exceed the envelope.
        obs=copy.deepcopy(self.observations)
        for node in obs["nodes"]:
            node["info_keyspace"]="# Keyspace\n"+"\n"*4084
        with patch.object(labctl,"MAX_BYTES",len(labctl.canonical(obs))+1):
            with self.assertRaises(labctl.LabError): self.build(observations=obs)
        for path in [None,True,12,[],{}]:
            with self.subTest(path=path),self.assertRaises(labctl.LabError):
                bootstrap.write_bootstrap_plan(original,original["bootstrap_sha256"],path)

    def test_coordinated_replacement_epoch_rules_and_replica_slot_refusal(self):
        obs=snapshot(True)[3]
        replacements={nid:format(i+100,"040x") for i,nid in enumerate(self.ids.values())}
        for node in obs["nodes"]:
            for old,new in replacements.items():
                node["cluster_nodes"]=node["cluster_nodes"].replace(old,new)
        self.refused(obs)
        for mode in ["duplicate-master-epochs","initial-replica-epochs","replica-slots"]:
            obs=snapshot(True)[3]
            for node in obs["nodes"]:
                lines=[]
                for row in node["cluster_nodes"].splitlines():
                    parts=row.split();role=next(r for r,nid in self.ids.items() if nid==parts[0])
                    if mode=="duplicate-master-epochs": parts[6]="1"
                    if mode=="initial-replica-epochs" and role.startswith("R"): parts[6]=str(int(role[1])+3)
                    if mode=="replica-slots" and role=="R1": parts.append("0")
                    lines.append(" ".join(parts))
                node["cluster_nodes"]="\n".join(lines)+"\n"
            with self.subTest(mode=mode):self.refused(obs)

    def test_identity_ownership_and_observation_envelope_binding(self):
        mutations = [lambda o: o.update(extra=True), lambda o: o.update(schema_version=True),
            lambda o: o.update(lane="ssh"), lambda o: o.update(origin="ssh"),
            lambda o: o.update(snapshot_id="bad"), lambda o: o.update(run_id="foreign"),
            lambda o: o.update(plan_sha256="a"*64), lambda o: o.update(bundle_sha256="a"*64),
            lambda o: o["nodes"].pop(), lambda o: o["nodes"].append(o["nodes"][0]),
            lambda o: o["nodes"][0].update(host="H3"), lambda o: o["nodes"][0].update(container_id="f"*64),
            lambda o: o["nodes"][0].update(machine_identity_sha256="f"*64),
            lambda o: o["nodes"][0]["labels"].update(extra="x"),
            lambda o: o["nodes"][0]["labels"].update({"io.mithril-research.role": "R1"}),
            lambda o: o["nodes"][0].update(container_state="stopped"),
            lambda o: o["nodes"][0].update(role="A"), lambda o: o["nodes"][1].update(role="M1")]
        for mutate in mutations:
            obs = copy.deepcopy(self.observations)
            mutate(obs)
            with self.subTest(mutate=mutate):
                self.refused(obs)
        for mutate in [lambda o: o["targets"].pop(), lambda o: o["targets"].append({"host":"H4","role":"A","container_id":"f"*64}),
                       lambda o: o["targets"][1].update(container_id=o["targets"][0]["container_id"]),
                       lambda o: o["targets"][0].update(host="H2")]:
            ownership = copy.deepcopy(self.ownership)
            mutate(ownership)
            with self.subTest(mutate=mutate), self.assertRaises(labctl.LabError):
                self.build(ownership=ownership)
        for ids in [{}, dict(self.ids, A="f"*40), dict(self.ids, M1=self.ids["M2"]), dict(self.ids, M1="F"*40)]:
            with self.subTest(ids=ids), self.assertRaises(labctl.LabError):
                self.build(ids=ids)
        replacement = copy.deepcopy(self.observations)
        for node in replacement["nodes"]:
            node["cluster_nodes"] = node["cluster_nodes"].replace(self.ids[node["role"]], "f"*40)
        self.refused(replacement)

    def test_nested_types_refuse_as_lab_errors(self):
        for key in self.observations:
            for value in [None, True, [], {}]:
                obs = copy.deepcopy(self.observations)
                obs[key] = value
                with self.subTest(envelope=key, value=value):
                    self.refused(obs)
        for key in self.observations["nodes"][0]:
            for value in [None, True, [], {}]:
                obs = copy.deepcopy(self.observations)
                obs["nodes"][0][key] = value
                with self.subTest(node=key, value=value):
                    self.refused(obs)
        for value in [None, True, [], {}, "bad"]:
            with self.subTest(value=value), self.assertRaises(labctl.LabError):
                self.build(ids=value)

    def test_draft_and_source_manifest_semantics_refused(self):
        manifest = copy.deepcopy(self.manifest)
        manifest["runtime_spec"].update(mithril_image="UNRESOLVED", mithril_image_provenance="UNRESOLVED")
        manifest["bundle_sha256"] = labctl.digest({k:v for k,v in manifest.items() if k != "bundle_sha256"})
        with self.assertRaises(labctl.LabError):
            self.build(manifest=manifest, digest=manifest["bundle_sha256"])
        manifest = copy.deepcopy(self.manifest)
        manifest["source_plan"]["topology"][0]["slots"] = [0, 1]
        source = manifest["source_plan"]
        source["plan_sha256"] = labctl.digest({k:v for k,v in source.items() if k != "plan_sha256"})
        manifest["bundle_sha256"] = labctl.digest({k:v for k,v in manifest.items() if k != "bundle_sha256"})
        with self.assertRaises(labctl.LabError):
            self.build(manifest=manifest, digest=manifest["bundle_sha256"])
        with self.assertRaises(labctl.LabError):
            self.build(digest="f"*64)

    def test_pristine_nonzero_epochs_keys_and_intermediate_states_refused(self):
        for replacement in ["# Keyspace\ndb0:keys=1,expires=0,avg_ttl=0\n", "# Keyspace\ndb0:keys=0,expires=0,avg_ttl=1\n",
                            "# Keyspace\ndb0:keys=0,expires=0,avg_ttl=0,subexpiry=1\n"]:
            obs = copy.deepcopy(self.observations)
            obs["nodes"][0]["info_keyspace"] = replacement
            self.refused(obs)
        for key, old, new in [("cluster_nodes", " 0 connected", " 1 connected"),
                              ("cluster_info", "cluster_current_epoch:0", "cluster_current_epoch:1"),
                              ("cluster_info", "cluster_my_epoch:0", "cluster_my_epoch:1"),
                              ("cluster_info", "cluster_slots_ok:0", "cluster_slots_ok:1")]:
            obs = copy.deepcopy(self.observations)
            obs["nodes"][0][key] = obs["nodes"][0][key].replace(old,new)
            self.refused(obs)
        formed = snapshot(True)[3]
        mixed = copy.deepcopy(self.observations)
        mixed["nodes"][0] = formed["nodes"][0]
        self.refused(mixed)
        for stage in ["epochs", "meet", "slots"]:
            obs = copy.deepcopy(formed)
            for i,node in enumerate(obs["nodes"]):
                if stage == "epochs":
                    node.update(copy.deepcopy(self.observations["nodes"][i]))
                    node["cluster_nodes"] = node["cluster_nodes"].replace(" 0 connected", f" {i+1} connected")
                else:
                    lines = []
                    for row in node["cluster_nodes"].splitlines():
                        parts = row.split()
                        parts[2] = parts[2].replace("slave", "master")
                        parts[3] = "-"
                        lines.append(" ".join(parts[:8] if stage == "meet" else parts))
                    node["cluster_nodes"] = "\n".join(lines)+"\n"
            self.refused(obs)

    def test_converged_wrong_topology_and_cross_view_disagreement_refused(self):
        mutations = [lambda s: s.replace("0-5460", "0-5459"),
            lambda s: s.replace("5461-10922", "5460-10922"),
            lambda s: s.replace("0-5460", "0-5460 3"),
            lambda s: s.replace("0-5460", "0-5460 [42->-"+self.ids["M2"]+"]"),
            lambda s: s.replace("0-5460", "0-5460 [42-<-"+self.ids["M2"]+"]"),
            lambda s: s.replace("100.64.0.1:17001", "100.64.0.2:17001"),
            lambda s: s.replace("@27001", "@27003"),
            lambda s: s.replace("slave "+self.ids["M1"], "slave "+self.ids["M3"]),
            lambda s: s.replace(" 1 connected", " 4 connected"),
            lambda s: s.replace("master,myself", "master"),
            lambda s: s.replace("slave", "slave,myself", 1),
            lambda s: s.replace("master,myself", "master,fail,myself"),
            lambda s: s.replace(" connected", " disconnected", 1),
            lambda s: s + f"{'f'*40} 100.64.0.5:17001@27001 master - 0 0 10 connected\n"]
        for mutate in mutations:
            obs = snapshot(True)[3]
            obs["nodes"][0]["cluster_nodes"] = mutate(obs["nodes"][0]["cluster_nodes"])
            with self.subTest(mutate=mutate): self.refused(obs)
        # A full but wrong slot allocation and changed replica parent in all views still refuse.
        for change in [lambda s:s.replace("0-5460", "TEMP").replace("5461-10922", "0-5460").replace("TEMP", "5461-10922"),
                       lambda s:s.replace("slave "+self.ids["M1"], "slave "+self.ids["M3"])]:
            obs = snapshot(True)[3]
            for node in obs["nodes"]: node["cluster_nodes"] = change(node["cluster_nodes"])
            self.refused(obs)
        for key,old,new in [("cluster_state","ok","fail"),("cluster_known_nodes",6,5),("cluster_size",3,2),
                            ("cluster_slots_assigned",16384,16383),("cluster_slots_pfail",0,1),
                            ("cluster_current_epoch",9,2),("cluster_my_epoch",1,4)]:
            obs = snapshot(True)[3]
            node=obs["nodes"][0]
            node["cluster_info"] = node["cluster_info"].replace(f"{key}:{old}\n",f"{key}:{new}\n")
            with self.subTest(info=key): self.refused(obs)

    def test_rehashed_semantic_tamper_and_writer_prevalidation(self):
        original=self.build()
        mutations=[lambda p:p.update(lane="ssh"),lambda p:p.update(execution_supported=True),
            lambda p:p.update(live_ready=True),lambda p:p.update(classification="already-converged"),
            lambda p:p["expected_node_ids"].update(M1="f"*40),lambda p:p["phases"].reverse(),
            lambda p:p["phases"][0]["actions"][0].update(epoch=7),
            lambda p:p["phases"][1]["actions"][0]["peer"].update(ipv4="100.64.0.99"),
            lambda p:p["phases"][2]["actions"][0].update(slots=[0,16383]),
            lambda p:p["phases"][3]["actions"][0].update(master_node_id="f"*40),
            lambda p:p["phases"][0]["actions"][0].update(argv=["sh","secret-sentinel"]),
            lambda p:p["phases"][0].update(requires_before=[]),
            lambda p:p["phases"][0].update(requires_after=[]),lambda p:p.update(unmet_requirements=[])]
        for mutate in mutations:
            plan=copy.deepcopy(original); mutate(plan); rehash(plan)
            with self.subTest(mutate=mutate),self.assertRaises(labctl.LabError):
                bootstrap.validate_bootstrap_plan(plan,plan["bootstrap_sha256"])
            output=self.root/"refused"
            with self.assertRaises(labctl.LabError): bootstrap.write_bootstrap_plan(plan,plan["bootstrap_sha256"],output)
            self.assertFalse(output.exists())
        with self.assertRaises(labctl.LabError): bootstrap.validate_bootstrap_plan(original,"f"*64)

    def test_private_output_permissions_retention_and_path_guards(self):
        plan=self.build(); output=self.root/"proposal"
        result=bootstrap.write_bootstrap_plan(plan,plan["bootstrap_sha256"],output)
        self.assert_flags(result)
        self.assertEqual(json.loads((output/"bootstrap.json").read_text()),plan)
        self.assertEqual(stat.S_IMODE(output.stat().st_mode),0o700)
        self.assertEqual(stat.S_IMODE((output/"bootstrap.json").stat().st_mode),0o600)
        before=(output/"bootstrap.json").read_bytes()
        alias=self.root/"alias"; alias.symlink_to(self.root,target_is_directory=True)
        unsafe=self.root/"unsafe"; unsafe.mkdir(mode=0o755)
        for path in [output,alias,alias/"child",self.root/".."/self.root.name/"traverse",SCRIPTS/"forbidden",
                     Path("relative"),Path("/home/fixture/mithril/fixture-demo/x"),unsafe/"child"]:
            with self.subTest(path=path),self.assertRaises(labctl.LabError):
                bootstrap.write_bootstrap_plan(plan,plan["bootstrap_sha256"],path)
        self.assertEqual((output/"bootstrap.json").read_bytes(),before)
        self.assertFalse((self.root/"child").exists())
        self.assertFalse((self.root/"traverse").exists())
        target=self.root/"retained"; target.write_text("unique evidence"); target.chmod(0o600)
        original=bundle._save_file
        def inject(rootfd,relative,payload):
            os.link(target,"bootstrap.json",dst_dir_fd=rootfd)
            return original(rootfd,relative,payload)
        partial=self.root/"partial"
        with patch.object(bundle,"_save_file",side_effect=inject),self.assertRaises(labctl.LabError):
            bootstrap.write_bootstrap_plan(plan,plan["bootstrap_sha256"],partial)
        self.assertTrue(partial.is_dir());self.assertEqual(target.read_text(),"unique evidence")

    def save(self,name,value):
        path=self.root/name;path.write_bytes(labctl.canonical(value));path.chmod(0o600);return path

    def cli(self,*args):
        return subprocess.run([sys.executable,str(SCRIPTS/"bootstrap.py"),*map(str,args)],capture_output=True,text=True,timeout=10)

    def arguments(self):
        return ["plan","--manifest",self.save("manifest.json",self.manifest),"--expected-bundle-digest",self.manifest["bundle_sha256"],
            "--ownership",self.save("ownership.json",self.ownership),"--node-ids",self.save("ids.json",self.ids),
            "--observations",self.save("observations.json",self.observations),"--output",self.root/"cli-output"]

    def assert_sanitized(self,result):
        raw=result.stdout+result.stderr
        for value in ["secret-sentinel","fixture-h1","100.64.0.1","/home/fixture",str(self.root),
                      self.ids["M1"],self.ownership["targets"][0]["container_id"],"1"*64]: self.assertNotIn(value,raw)
        self.assertEqual(result.stderr,"")
        self.assert_flags(json.loads(result.stdout))

    def test_actual_cli_plan_validate_help_error_sanitization(self):
        result=self.cli(*self.arguments());self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assert_sanitized(result)
        summary=json.loads(result.stdout);self.assertEqual(summary["classification"],"pristine")
        self.assertEqual(summary["phase_count"],4);self.assertEqual(summary["action_count"],17)
        result=self.cli("validate","--plan",self.root/"cli-output/bootstrap.json","--expected-bootstrap-digest",summary["bootstrap_sha256"])
        self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.assert_sanitized(result)
        for args in [["--help"],["plan","--help"],["--secret-sentinel"],["execute-approved","secret-sentinel"],
                     ["validate","--plan",self.root/"cli-output/bootstrap.json","--expected-bootstrap-digest","f"*64]]:
            result=self.cli(*args);self.assert_sanitized(result)
            self.assertEqual(result.returncode,0 if "--help" in args else 2)

    def test_cli_input_json_bounds_private_links_and_source_refusal(self):
        args=self.arguments(); path=self.root/"observations.json"; original=path.read_bytes()
        for raw in [b'{"secret-sentinel":1,"secret-sentinel":2}',b'\xff',b'{"x":NaN}',b'{"x":1e999}',
                    b"x"*(1024*1024+1),b"["*2000+b"]"*2000]:
            path.write_bytes(raw);result=self.cli(*args);self.assertEqual(result.returncode,2);self.assert_sanitized(result)
        path.write_bytes(original);path.chmod(0o644)
        self.assertEqual(self.cli(*args).returncode,2);path.chmod(0o600)
        alias=self.root/"hardlink";os.link(path,alias)
        self.assertEqual(self.cli(*args).returncode,2);alias.unlink()
        path.rename(alias);path.symlink_to(alias)
        self.assertEqual(self.cli(*args).returncode,2)
        self.assertFalse((self.root/"cli-output").exists())
        path.unlink();alias.rename(path)
        self.root.chmod(0o755)
        self.assertEqual(self.cli(*args).returncode,2);self.root.chmod(0o700)
        index=args.index("--observations")+1
        for unsafe in [SCRIPTS/"labctl.py",self.root/".."/self.root.name/"observations.json"]:
            changed=list(args);changed[index]=unsafe
            self.assertEqual(self.cli(*changed).returncode,2)


class ParserContracts(unittest.TestCase):
    def setUp(self):
        self.raw=snapshot()[3]["nodes"][0]["cluster_nodes"]
        self.info=snapshot()[3]["nodes"][0]["cluster_info"]

    def test_nodes_grammar_limits_and_ambiguous_slots(self):
        for value in [None,True,[],{},"",self.raw.rstrip(),self.raw+"\n",self.raw.replace("\n","\r"),
                      self.raw.replace("master,myself","master,myself,myself"),self.raw.replace("master,myself","master,slave,myself"),
                      self.raw.replace("master,myself","master,unknown,myself"),self.raw.replace("@27001","@27001,hostname"),
                      self.raw.replace("17001@","0@"),self.raw.replace(" 0 1 "," -1 1 "),
                      self.raw.replace(" 0 connected"," "+"9"*10000+" connected"),self.raw.replace(" connected"," connected 1 1"),
                      self.raw.replace(" connected"," connected 1-3 3-5"),self.raw.replace(" connected"," connected 16384"),
                      self.raw.replace(" connected"," connected 5-2"),self.raw.replace(" connected"," connected [1->-"+"f"*40+"]"),
                      self.raw.replace(" connected"," connected 0-16383 0-16383"),self.raw*7,"x"*(65536+1),
                      self.raw.replace("connected","connected\t"),self.raw.replace("connected","connectéd"),self.raw+"\x00"]:
            with self.subTest(value=str(value)[:80]),self.assertRaises(labctl.LabError): bootstrap.parse_cluster_nodes(value)
        for flag in ["fail","fail?","handshake","noaddr","nofailover","noflags"]:
            with self.subTest(flag=flag),self.assertRaises(labctl.LabError):
                bootstrap.parse_cluster_nodes(self.raw.replace("master,myself","master,myself,"+flag))
        self.assertEqual(bootstrap.parse_cluster_nodes(self.raw),bootstrap.parse_cluster_nodes(self.raw.replace("@27001 ","@27001, ")))

    def test_info_required_optional_fields_and_limits(self):
        valid=self.info+"cluster_stats_messages_auth-req_sent:4\ncluster_stats_messages_publishshard_received:0\ntotal_cluster_links_buffer_limit_exceeded:0\n"
        self.assertEqual(bootstrap.parse_cluster_info(valid)["cluster_current_epoch"],0)
        for value in [None,True,[],{},"",self.info.rstrip(),self.info+"\n",self.info.replace("\n","\r"),
                      self.info+"unknown:1\n",self.info+"cluster_state:fail\n",self.info.replace("cluster_state:fail\n",""),
                      self.info.replace("cluster_state:fail","cluster_state:loading"),self.info.replace("cluster_size:0","cluster_size:-1"),
                      self.info.replace("cluster_size:0","cluster_size:"+str(2**64)),self.info+"cluster_stats_messages_future_sent:1\n",
                      "-ERR secret-sentinel\n","x"*(16384+1)]:
            with self.subTest(value=str(value)[:80]),self.assertRaises(labctl.LabError): bootstrap.parse_cluster_info(value)

    def test_keyspace_header_completeness_fields_and_limits(self):
        for raw in ["# Keyspace\n","# Keyspace\r\n\r\n","# Keyspace\ndb0:keys=0,expires=0,avg_ttl=0,subexpiry=0\n"]:
            self.assertTrue(all(v==0 for v in bootstrap.parse_info_keyspace(raw).values()))
        for value in [None,True,[],{},"","\n","# Keyspace","db0:keys=0,expires=0,avg_ttl=0\n","# Other\n",
                      "# Keyspace\n# Server\n","# Keyspace\ndb1:keys=0,expires=0,avg_ttl=0\n",
                      "# Keyspace\ndb0:keys=1,expires=2,avg_ttl=0\n","# Keyspace\ndb0:keys=0,keys=0,expires=0,avg_ttl=0\n",
                      "# Keyspace\ndb0:keys=0,expires=0,avg_ttl=0,future=0\n",
                      "# Keyspace\ndb0:keys=0,expires=0\n","# Keyspace\n# Keyspace\n",
                      "# Keyspace\ndb0:keys=0,expires=0,avg_ttl=-1\n","x"*(4096+1)]:
            with self.subTest(value=value),self.assertRaises(labctl.LabError): bootstrap.parse_info_keyspace(value)


if __name__ == "__main__":
    unittest.main()

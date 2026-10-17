"""Pure offline P1e assertions; fixtures are original synthetic collections."""
import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import stat
import subprocess
import sys
import tempfile
import time
import uuid
import unittest
from unittest.mock import patch

SCRIPTS=Path(__file__).resolve().parents[1]/"scripts"
sys.path.insert(0,str(SCRIPTS))
import phase_validation as phase
import bootstrap
import collector
import labctl
from test_bootstrap import snapshot, ROLES

BARRIERS=["pristine-isolated-empty-zero-epochs","isolated-empty-assigned-epochs",
          "six-connected-empty-masters-epoch-six","exact-slots-with-empty-prospective-replicas",
          "exact-converged-topology-snapshot"]
FLAGS={"lane":"offline-phase-validation","execution_supported":False,"phase_execution_supported":False,
       "live_ready":False,"live_runtime":"UNEXECUTED","freshness_verified":False,"authenticated_authority":False}
RESULT_KEYS={"schema_version",*FLAGS,"result","barrier_id","origin","collection_id","collection_sha256",
             "run_id","plan_sha256","bundle_sha256"}
SUMMARY_KEYS={*FLAGS,"result","barrier_id","origin"}


def fixture(stage,origin="mock-ssh"):
    manifest,ownership,ids,observations=snapshot(stage in (2,3,4))
    for i,node in enumerate(observations["nodes"]):
        if stage in (1,2,3):
            rows=[]
            for raw in node["cluster_nodes"].splitlines():
                row=raw.split(); role=next(r for r,nid in ids.items() if nid==row[0])
                row[2]=row[2].replace("slave","master");row[3]="-";row[6]=str(ROLES.index(role)+1)
                if stage!=3:row=row[:8]
                rows.append(" ".join(row))
            node["cluster_nodes"]="\n".join(rows)+"\n"
            formed=stage==3
            info={"cluster_state":"ok" if formed else "fail","cluster_slots_assigned":16384 if formed else 0,
                  "cluster_slots_ok":16384 if formed else 0,"cluster_slots_pfail":0,"cluster_slots_fail":0,
                  "cluster_known_nodes":1 if stage==1 else 6,"cluster_size":3 if formed else 0,
                  "cluster_current_epoch":i+1 if stage==1 else 6,"cluster_my_epoch":i+1}
            node["cluster_info"]="".join(f"{k}:{v}\n" for k,v in info.items())
        node["process"]={"started_at":f"2026-10-17T01:02:{i:02}Z","pid":1200+i}
    collection={"schema_version":1,"lane":"redis-collection","origin":origin,"collection_id":"e"*32,
        "run_id":ownership["run_id"],"plan_sha256":ownership["plan_sha256"],"bundle_sha256":ownership["bundle_sha256"],
        "expected_node_ids":copy.deepcopy(ids),"status":"complete","phase_execution_supported":False,
        "live_ready":False,"live_runtime":"UNEXECUTED","nodes":[{"target":copy.deepcopy(target),"status":"complete","record":node}
            for target,node in zip(ownership["targets"],observations["nodes"])]}
    return manifest,ownership,ids,collection


def change_info(collection,index,key,value):
    node=collection["nodes"][index]["record"]
    rows=[line.split(":",1) for line in node["cluster_info"].splitlines()]
    node["cluster_info"]="".join(f"{k}:{value if k==key else v}\n" for k,v in rows)


def change_rows(collection,transform,indices=None):
    for i,entry in enumerate(collection["nodes"]):
        if indices is not None and i not in indices:continue
        node=entry["record"]
        node["cluster_nodes"]="\n".join(" ".join(transform(row.split())) for row in node["cluster_nodes"].splitlines())+"\n"


class PhaseContracts(unittest.TestCase):
    def validate(self,inputs,barrier):
        manifest,ownership,ids,collection=inputs
        return phase.validate_phase_snapshot(manifest,manifest.get("bundle_sha256") if type(manifest) is dict else "f"*64,ownership,ids,collection,barrier)

    def collection_valid(self,inputs):
        m,o,ids,c=inputs
        self.assertEqual(collector.validate_collection(m,m["bundle_sha256"],o,ids,c),c)

    def predicate_refused(self,inputs,barrier):
        self.collection_valid(inputs)
        with self.assertRaises(labctl.LabError):self.validate(inputs,barrier)

    def test_five_exact_results_origins_and_deterministic_detached_inputs(self):
        self.assertEqual(list(bootstrap.BARRIERS),BARRIERS)
        for stage,barrier in enumerate(BARRIERS):
            for origin in ["mock-ssh","ssh"]:
                data=fixture(stage,origin);before=copy.deepcopy(data);self.collection_valid(data)
                result=self.validate(data,barrier);collection=data[3]
                self.assertEqual(set(result),RESULT_KEYS)
                self.assertEqual(result,{"schema_version":1,**FLAGS,"result":"predicate-matched","barrier_id":barrier,
                    "origin":origin,"collection_id":collection["collection_id"],"collection_sha256":labctl.digest(collection),
                    "run_id":collection["run_id"],"plan_sha256":collection["plan_sha256"],"bundle_sha256":collection["bundle_sha256"]})
                self.assertEqual(self.validate(data,barrier),result);self.assertEqual(data,before)
                result["result"]="changed";self.assertEqual(data,before)

    def test_five_by_five_only_requested_barrier_matches(self):
        for stage in range(5):
            data=fixture(stage);self.collection_valid(data)
            for selected,barrier in enumerate(BARRIERS):
                with self.subTest(stage=stage,selected=selected):
                    if selected==stage:self.validate(data,barrier)
                    else:self.predicate_refused(data,barrier)
        for bad in [None,True,1,[],{},"unknown","","secret-sentinel\n"]:
            with self.subTest(bad=bad),self.assertRaises(labctl.LabError):self.validate(fixture(0),bad)

    def test_isolated_epoch_self_current_my_and_shape_predicate_negatives(self):
        for stage in [0,1]:
            for field in ["self","cluster_current_epoch","cluster_my_epoch"]:
                data=fixture(stage);c=data[3]
                if field=="self":change_rows(c,lambda r:r[:6]+[str(int(r[6])+1)]+r[7:],indices=[0])
                else:change_info(c,0,field,7)
                self.predicate_refused(data,BARRIERS[stage])
            for modify in [lambda c:change_info(c,0,"cluster_known_nodes",2),
                           lambda c:change_rows(c,lambda r:r[:3]+[fixture(0)[2]["M2"]]+r[4:],indices=[0]),
                           lambda c:change_rows(c,lambda r:r[:2]+[r[2].replace("master","slave")]+r[3:],indices=[0]),
                           lambda c:change_rows(c,lambda r:r+["0"],indices=[0])]:
                data=fixture(stage);modify(data[3]);self.predicate_refused(data,BARRIERS[stage])
        for roles in [[0,1],list(range(6))]:
            data=fixture(1)
            for i in roles:
                change_rows(data[3],lambda r:r[:6]+["2" if r[6]=="1" else "1"]+r[7:],indices=[i])
            self.predicate_refused(data,BARRIERS[1])
        # An extra bound peer in one isolated view remains a valid collection.
        data=fixture(1);rows=data[3]["nodes"][1]["record"]["cluster_nodes"].replace(",myself","")
        data[3]["nodes"][0]["record"]["cluster_nodes"]+=rows
        self.predicate_refused(data,BARRIERS[1])

    def test_every_empty_counter_on_every_role_is_required_for_initial_four(self):
        for stage in range(4):
            for index in range(6):
                for field,raw in [("keys","keys=1,expires=0,avg_ttl=0"),
                                  ("expires","keys=1,expires=1,avg_ttl=0"),
                                  ("avg_ttl","keys=0,expires=0,avg_ttl=1"),
                                  ("subexpiry","keys=0,expires=0,avg_ttl=0,subexpiry=1")]:
                    data=fixture(stage);data[3]["nodes"][index]["record"]["info_keyspace"]="# Keyspace\n"+"db0:"+raw+"\n"
                    with self.subTest(stage=stage,index=index,field=field):self.predicate_refused(data,BARRIERS[stage])

    def test_middle_info_fields_independently_exact(self):
        for stage in [1,2,3]:
            base=fixture(stage)
            parsed=bootstrap.parse_cluster_info(base[3]["nodes"][0]["record"]["cluster_info"])
            for key,value in parsed.items():
                data=fixture(stage);change_info(data[3],0,key,"fail" if value=="ok" else "ok" if key=="cluster_state" else value+1)
                with self.subTest(stage=stage,key=key):self.predicate_refused(data,BARRIERS[stage])

    def test_connected_middle_normalized_role_parent_epoch_and_slot_drift(self):
        for stage in [2,3]:
            ids=fixture(stage)[2]
            changes=[lambda r:r[:6]+[str(int(r[6])+10)]+r[7:],
                     lambda r:r[:2]+[r[2].replace("master","slave")]+r[3:],
                     lambda r:r[:3]+[ids["M1"]]+r[4:],
                     lambda r:r+["16383"] if len(r)==8 else r[:8]+["0-5459"]]
            for transform in changes:
                for indices in [[0],None]:
                    data=fixture(stage);change_rows(data[3],transform,indices=indices)
                    with self.subTest(stage=stage,transform=transform,indices=indices):self.predicate_refused(data,BARRIERS[stage])
            data=fixture(stage)
            for entry in data[3]["nodes"]:
                lines=entry["record"]["cluster_nodes"].splitlines()
                entry["record"]["cluster_nodes"]="\n".join(row for row in lines if not row.startswith(ids["R3"]))+"\n"
            # Removing a row also removes R3's self marker; retain R3's own view
            # to ensure all direct bindings validate but cross-view completeness fails.
            data[3]["nodes"][5]["record"]=fixture(stage)[3]["nodes"][5]["record"]
            self.predicate_refused(data,BARRIERS[stage])

    def test_slot_gap_overlap_wrong_ranges_replica_slots_and_early_replication(self):
        for replacement in ["0-5459","0-5461","5461-10922"]:
            data=fixture(3)
            for entry in data[3]["nodes"]:
                entry["record"]["cluster_nodes"]=entry["record"]["cluster_nodes"].replace("0-5460",replacement)
            self.predicate_refused(data,BARRIERS[3])
        data=fixture(3);nid=data[2]["R1"]
        change_rows(data[3],lambda r:r+["0"] if r[0]==nid else r)
        self.predicate_refused(data,BARRIERS[3])
        data=fixture(3);ids=data[2]
        change_rows(data[3],lambda r:r[:2]+[r[2].replace("master","slave"),ids["M1"]]+r[4:] if r[0]==ids["R1"] else r)
        self.predicate_refused(data,BARRIERS[3])

    def test_final_p1c_parity_nonempty_arbitrary_epochs_and_refusals(self):
        data=fixture(4);ids=data[2]
        for i,entry in enumerate(data[3]["nodes"]):
            entry["record"]["info_keyspace"]=f"# Keyspace\ndb0:keys={i+4},expires=2,avg_ttl=123,subexpiry=1\n"
        epoch_by_id={nid:(int(role[1])*11) for role,nid in ids.items()}
        change_rows(data[3],lambda r:r[:6]+[str(epoch_by_id[r[0]])]+r[7:])
        for i,role in enumerate(ROLES):
            change_info(data[3],i,"cluster_my_epoch",epoch_by_id[ids[role]]);change_info(data[3],i,"cluster_current_epoch",50)
        self.validate(data,BARRIERS[4]);self.p1c(data)
        for transform in [lambda r:r[:6]+["4"]+r[7:] if r[0]==ids["R1"] else r,
            lambda r:r[:3]+[ids["M3"]]+r[4:] if r[0]==ids["R1"] else r,
            lambda r:r+["1"] if r[0]==ids["R1"] else r,
            lambda r:r[:6]+["11"]+r[7:]]:
            bad=copy.deepcopy(data);change_rows(bad[3],transform)
            self.predicate_refused(bad,BARRIERS[4])
            with self.assertRaises(labctl.LabError):self.p1c(bad)
        bad=copy.deepcopy(data);change_info(bad[3],0,"cluster_current_epoch",51)
        self.predicate_refused(bad,BARRIERS[4])
        with self.assertRaises(labctl.LabError):self.p1c(bad)

    def p1c(self,data):
        m,o,ids,c=data
        # Test-only parity fixture construction, never a production adapter.
        obs={"schema_version":1,"lane":"offline-snapshot","origin":"synthetic","snapshot_id":"e"*32,
             "run_id":c["run_id"],"plan_sha256":c["plan_sha256"],"bundle_sha256":c["bundle_sha256"],
             "nodes":[{k:v for k,v in entry["record"].items() if k!="process"} for entry in c["nodes"]]}
        return bootstrap.validate_observations(m,m["bundle_sha256"],o,ids,obs)

    def test_intermediates_and_collection_lane_still_refused_by_p1c(self):
        for stage in [1,2,3]:
            data=fixture(stage);self.validate(data,BARRIERS[stage])
            with self.assertRaises(labctl.LabError):self.p1c(data)
        m,o,ids,c=fixture(0)
        with self.assertRaises(labctl.LabError):bootstrap.validate_observations(m,m["bundle_sha256"],o,ids,c)

    def test_normalization_optional_statistics_and_original_raw_fingerprint(self):
        for stage in [2,3,4]:
            original=fixture(stage);changed=copy.deepcopy(original)
            for index,entry in enumerate(changed[3]["nodes"]):
                raw=entry["record"]["cluster_nodes"].replace("master,myself","myself,master")
                raw=raw.replace("0-5460","3001-5460 0 1-3000")
                lines=[]
                for line in raw.splitlines():
                    row=line.split();row[4]=str(index+100);row[5]=str(index+200);lines.append(" ".join(row))
                entry["record"]["cluster_nodes"]="\r\n".join(reversed(lines))+"\r\n"
                entry["record"]["cluster_info"]+=f"cluster_stats_messages_ping_sent:{index}\n"
            a=self.validate(original,BARRIERS[stage]);b=self.validate(changed,BARRIERS[stage])
            self.assertNotEqual(a["collection_sha256"],b["collection_sha256"])
            self.assertEqual(b["collection_sha256"],labctl.digest(changed[3]))

    def test_original_binding_schema_process_and_alternate_envelopes_refused(self):
        changes=[lambda c:c.update(status="partial"),lambda c:c.update(schema_version=True),lambda c:c.update(schema_version=1.0),
            lambda c:c.update(origin="synthetic"),lambda c:c.update(lane="offline-snapshot"),lambda c:c.update(expected_node_ids={}),
            lambda c:c.update(run_id="foreign"),lambda c:c.update(plan_sha256="f"*64),lambda c:c.update(bundle_sha256="f"*64),
            lambda c:c["nodes"].reverse(),lambda c:c["nodes"].pop(),lambda c:c["nodes"].append(c["nodes"][0]),
            lambda c:c["nodes"][0].update(status="unknown",record=None),lambda c:c["nodes"][0].update(record=None),
            lambda c:c["nodes"][0]["record"].update(machine_identity_sha256="f"*64),
            lambda c:c["nodes"][0]["record"].update(container_id="f"*64),
            lambda c:c["nodes"][0]["record"]["labels"].update(extra="x"),
            lambda c:c["nodes"][0]["record"]["process"].update(pid=True),
            lambda c:c["nodes"][0]["record"]["process"].update(started_at="2026-02-30T01:02:03Z")]
        for change in changes:
            data=fixture(0);change(data[3])
            with self.subTest(change=change),self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        for c in [{},self.validate(fixture(0),BARRIERS[0]),{"views":{}}]:
            data=list(fixture(0));data[3]=c
            with self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        data=fixture(0);data[2]["M1"]="f"*40
        with self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        m,o,ids,c=fixture(0)
        with self.assertRaises(labctl.LabError):phase.validate_phase_snapshot(m,"f"*64,o,ids,c,BARRIERS[0])

    def test_draft_manifest_semantic_drift_and_deep_record_types_refuse(self):
        data=fixture(0);m,o,ids,c=data
        m["runtime_spec"].update(mithril_image="UNRESOLVED",mithril_image_provenance="UNRESOLVED")
        m["bundle_sha256"]=labctl.digest({k:v for k,v in m.items() if k!="bundle_sha256"})
        o["bundle_sha256"]=c["bundle_sha256"]=m["bundle_sha256"]
        for entry in c["nodes"]:entry["record"]["labels"]["io.mithril-research.bundle"]=m["bundle_sha256"]
        __import__("bundle").validate_manifest(m,m["bundle_sha256"])
        with self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        data=fixture(0);m=data[0];plan=m["source_plan"];plan["topology"][0]["slots"]=[0,1]
        plan["plan_sha256"]=labctl.digest({k:v for k,v in plan.items() if k!="plan_sha256"})
        m["bundle_sha256"]=labctl.digest({k:v for k,v in m.items() if k!="bundle_sha256"})
        with self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        original=fixture(0)
        for key in original[3]["nodes"][0]["record"]:
            for bad in [None,True,[],{}]:
                data=copy.deepcopy(original);data[3]["nodes"][0]["record"][key]=bad
                with self.subTest(key=key,bad=bad),self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        for pid in [0,-1,2**31,"1234",1.0]:
            data=fixture(0);data[3]["nodes"][0]["record"]["process"]["pid"]=pid
            with self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])

    def test_coordinated_ids_foreign_peer_wrong_self_and_raw_errors_refuse(self):
        for mode in ["replacement","foreign","myself","duplicate","truncated","overlimit"]:
            data=fixture(2);ids=data[2]
            for entry in data[3]["nodes"]:
                node=entry["record"]
                if mode=="replacement":
                    for i,nid in enumerate(ids.values()):node["cluster_nodes"]=node["cluster_nodes"].replace(nid,format(i+200,"040x"))
                elif mode=="foreign":node["cluster_nodes"]=node["cluster_nodes"].replace(ids["R3"],"f"*40)
                elif mode=="myself":node["cluster_nodes"]=node["cluster_nodes"].replace(",myself","")
                elif mode=="duplicate":node["cluster_nodes"]+=node["cluster_nodes"].splitlines()[0]+"\n"
                elif mode=="truncated":node["info_keyspace"]="# Keyspace"
                else:node["info_keyspace"]="# Keyspace\n"+"\n"*4096
            with self.subTest(mode=mode),self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[2])

    def test_malformed_nested_values_consistently_laberror_and_canonical_caps(self):
        for position in range(4):
            for bad in [None,True,1,[],{},"secret-sentinel"]:
                data=list(fixture(0));data[position]=bad
                with self.subTest(position=position,bad=bad),self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        original=fixture(0)
        for key in original[3]:
            for bad in [None,True,[],{}]:
                data=copy.deepcopy(original);data[3][key]=bad
                with self.subTest(key=key,bad=bad),self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])
        for position,cap in [(0,1048576),(1,1048576),(2,1048576),(3,2097152)]:
            data=list(fixture(0));data[position]="x"*(cap+1)
            with self.assertRaises(labctl.LabError):self.validate(data,BARRIERS[0])

    def test_pure_validation_fences_runtime_collection_journal_and_clocks(self):
        data=fixture(3)
        with patch.object(socket,"socket",side_effect=AssertionError("socket forbidden")), \
             patch.object(subprocess,"Popen",side_effect=AssertionError("runtime forbidden")), \
             patch.object(collector,"collect",side_effect=AssertionError("collect forbidden")), \
             patch.object(collector,"Transport",side_effect=AssertionError("transport forbidden")), \
             patch.object(labctl,"atomic_write",side_effect=AssertionError("journal forbidden")), \
             patch.object(bootstrap,"validate_observations",side_effect=AssertionError("envelope conversion forbidden")), \
             patch.object(bootstrap,"build_bootstrap_plan",side_effect=AssertionError("proposal forbidden")), \
             patch.object(os,"open",side_effect=AssertionError("filesystem forbidden")), \
             patch.object(time,"time",side_effect=AssertionError("clock forbidden")), \
             patch.object(time,"monotonic",side_effect=AssertionError("clock forbidden")), \
             patch.object(uuid,"uuid4",side_effect=AssertionError("new identity forbidden")):
            self.validate(data,BARRIERS[3])


class CliContracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)

    def save(self,name,value):
        path=self.root/name;path.write_bytes(labctl.canonical(value));path.chmod(0o600);return path

    def arguments(self,stage):
        m,o,ids,c=fixture(stage)
        return ["validate","--manifest",self.save("manifest.json",m),"--expected-bundle-digest",m["bundle_sha256"],
            "--ownership",self.save("ownership.json",o),"--node-ids",self.save("ids.json",ids),
            "--collection",self.save("collection.json",c),"--barrier",BARRIERS[stage]]

    def cli(self,*args):
        return subprocess.run([sys.executable,str(SCRIPTS/"phase_validation.py"),*map(str,args)],capture_output=True,text=True,timeout=10)

    def sanitized(self,result):
        self.assertEqual(result.stderr,"")
        for token in [str(self.root),"secret-sentinel","fixture-demo","fixture-h1","100.64.0.1","/home/fixture","e"*32,"1"*64]:
            self.assertNotIn(token,result.stdout+result.stderr)
        value=json.loads(result.stdout)
        for key,item in FLAGS.items():self.assertEqual(value[key],item)
        return value

    def test_real_subprocess_all_five_success_help_refusal_and_no_writes(self):
        for stage in range(5):
            args=self.arguments(stage);before={p.name:p.read_bytes() for p in self.root.iterdir()}
            result=self.cli(*args);self.assertEqual(result.returncode,0,result.stdout+result.stderr)
            value=self.sanitized(result);self.assertEqual(set(value),SUMMARY_KEYS)
            self.assertEqual(value["barrier_id"],BARRIERS[stage]);self.assertEqual(value["result"],"predicate-matched")
            self.assertEqual({p.name:p.read_bytes() for p in self.root.iterdir()},before)
        for args in [["--help"],["validate","--help"],["--credentials","secret-sentinel"],["--execute-approved"],
                     ["--output",self.root/"new"],["--mock"],["--bar","secret-sentinel"],["validate","--barrier","secret-sentinel"]]:
            result=self.cli(*args);self.sanitized(result);self.assertEqual(result.returncode,0 if "--help" in args else 2)
        args=self.arguments(0);args[-1]=BARRIERS[1]
        result=self.cli(*args);self.assertEqual(result.returncode,2);self.sanitized(result)

    def test_private_reader_raw_bounds_exact_padding_and_invalid_json(self):
        args=self.arguments(0)
        for name,limit in [("manifest.json",1048576),("ownership.json",1048576),("ids.json",1048576),("collection.json",2097152)]:
            path=self.root/name;raw=path.read_bytes()
            path.write_bytes(raw+b" "*(limit-len(raw)))
            result=self.cli(*args);self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.sanitized(result)
            path.write_bytes(raw+b" "*(limit+1-len(raw)))
            result=self.cli(*args);self.assertEqual(result.returncode,2);self.sanitized(result)
            path.write_bytes(raw)
        path=self.root/"collection.json"
        for raw in [b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":1e999}',b'\xff',b'['*2000+b']'*2000,
                    b'{}secret-sentinel',b'{"schema_version":true}']:
            path.write_bytes(raw);result=self.cli(*args);self.assertEqual(result.returncode,2);self.sanitized(result)

    def test_literal_dot_and_repeated_separator_spelling_refused_before_read(self):
        args=self.arguments(0);index=args.index("--collection")+1
        canonical=str(args[index])
        for raw in [str(self.root)+"/./collection.json",str(self.root)+"//collection.json","/"+canonical]:
            changed=list(args);changed[index]=raw
            result=self.cli(*changed)
            with self.subTest(raw=raw):
                self.assertEqual(result.returncode,2,result.stdout+result.stderr)
                self.sanitized(result)
                with patch.object(os,"open",side_effect=AssertionError("noncanonical path must fail before read")),self.assertRaises(labctl.LabError):
                    phase._load_private(raw,2097152)

    def test_private_reader_detects_growth_after_stat_and_foreign_ownership(self):
        args=self.arguments(0);path=self.root/"collection.json"
        path.write_bytes(b" "*2097153)
        original=os.fstat
        def smaller(fd):
            values=list(original(fd));values[6]=0;return os.stat_result(values)
        with patch.object(phase.os,"fstat",side_effect=smaller),self.assertRaises(labctl.LabError):
            phase._load_private(str(path),2097152)
        with patch.object(phase.os,"getuid",return_value=os.getuid()+1),self.assertRaises(labctl.LabError):
            phase._load_private(str(path),2097152)

    def test_real_cli_wrapper_fences_collection_network_runtime_and_journal(self):
        args=self.arguments(3)
        code="""import sys,socket,subprocess
from unittest.mock import patch
sys.path.insert(0,sys.argv[1]);import phase_validation as phase,collector,labctl
with patch.object(socket,'socket',side_effect=AssertionError('socket forbidden')),patch.object(subprocess,'Popen',side_effect=AssertionError('runtime forbidden')),patch.object(collector,'collect',side_effect=AssertionError('collection forbidden')),patch.object(collector,'Transport',side_effect=AssertionError('transport forbidden')),patch.object(labctl,'atomic_write',side_effect=AssertionError('journal forbidden')):
 sys.exit(phase.main(sys.argv[2:]))
"""
        result=subprocess.run([sys.executable,"-c",code,str(SCRIPTS),*map(str,args)],capture_output=True,text=True,timeout=10)
        self.assertEqual(result.returncode,0,result.stdout+result.stderr);self.sanitized(result)

    def test_private_files_links_modes_paths_and_fifo_refuse_without_writes(self):
        args=self.arguments(0);path=self.root/"collection.json";raw=path.read_bytes()
        path.chmod(0o644);self.assertEqual(self.cli(*args).returncode,2);path.chmod(0o600)
        alias=self.root/"alias";os.link(path,alias);self.assertEqual(self.cli(*args).returncode,2);alias.unlink()
        path.rename(alias);path.symlink_to(alias);self.assertEqual(self.cli(*args).returncode,2);path.unlink();alias.rename(path)
        path.unlink();os.mkfifo(path,0o600);self.assertEqual(self.cli(*args).returncode,2);path.unlink();path.write_bytes(raw);path.chmod(0o600)
        self.root.chmod(0o755);self.assertEqual(self.cli(*args).returncode,2);self.root.chmod(0o700)
        directory=self.root/"directory";directory.mkdir(mode=0o700)
        parentlink=self.root/"parentlink";parentlink.symlink_to(self.root,target_is_directory=True)
        for bad in [SCRIPTS/"phase_validation.py",self.root/".."/self.root.name/"collection.json",Path("relative"),directory,parentlink/"collection.json"]:
            changed=list(args);changed[changed.index("--collection")+1]=bad
            result=self.cli(*changed);self.assertEqual(result.returncode,2);self.sanitized(result)


if __name__=="__main__":unittest.main()

"""P1d acquisition contracts. Every transport/socket/runtime dependency is mocked."""
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
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS))
import collector
import collector_helper as helper
import bootstrap
import bundle
import labctl
from test_bootstrap import snapshot, ROLES

MACHINE = b"0123456789abcdef0123456789abcdef\n"
START = "2026-10-17T01:02:03.123456789Z"
SECRETS = {"schema_version": 1, **{name: "PRIVATE_SENTINEL_" + name for name in bundle.CREDENTIAL_NAMES}}


def request():
    return {"schema_version": 1, "operation_id": "1" * 32, "collection_id": "2" * 32,
        "operation": "collect-redis", "run_id": "fixture-demo", "plan_sha256": "a" * 64,
        "bundle_sha256": "b" * 64, "host": "H1", "machine_identity_sha256": hashlib.sha256(MACHINE).hexdigest(),
        "target": {"role": "M1", "container_id": "c" * 64, "node_id": "d" * 40,
                   "ipv4": "100.64.0.1", "port": 17001, "bus_port": 27001},
        "credential": SECRETS["backend_operator"]}


def wire(payloads):
    return b"+OK\r\n" + b"".join(b"$" + str(len(raw)).encode() + b"\r\n" + raw + b"\r\n" for raw in payloads)


class Socket:
    def __init__(self, raw, fragment=1):
        self.raw, self.fragment = bytearray(raw), fragment
        self.sent = bytearray()
        self.timeouts, self.shutdowns = [], []
        self.closed = False
        self.hold = False
        self.on_recv = None

    def settimeout(self, timeout):
        self.timeouts.append(timeout)

    def send(self, data):
        count = min(len(data), self.fragment)
        self.sent.extend(data[:count])
        return count

    def recv(self, size):
        if self.on_recv:
            self.on_recv()
        if not self.raw and self.hold:
            raise TimeoutError("PRIVATE_SENTINEL_backend_operator")
        count = min(size, self.fragment, len(self.raw))
        raw = bytes(self.raw[:count]); del self.raw[:count]
        return raw

    def shutdown(self, how):
        self.shutdowns.append(how)

    def close(self):
        self.closed = True


class Runtime:
    def __init__(self, req):
        self.req = req
        self.calls = []
        self.objects = []
        self.obj = {"Id": req["target"]["container_id"], "Config": {"Labels": {
            "io.mithril-research.run": req["run_id"], "io.mithril-research.plan": req["plan_sha256"],
            "io.mithril-research.bundle": req["bundle_sha256"], "io.mithril-research.role": req["target"]["role"]}},
            "State": {"Status": "running", "Running": True, "Paused": False, "Restarting": False,
                      "StartedAt": START, "Pid": 1234}}

    def __call__(self, argv, payload, deadline, limit):
        self.calls.append((argv, payload, deadline, limit))
        assert argv == ["/usr/bin/docker", "--host", "unix:///var/run/docker.sock", "inspect", "--type", "container", self.req["target"]["container_id"]]
        assert payload == b"" and 0 < deadline <= 20 and limit == 65536
        return json.dumps([self.objects.pop(0) if self.objects else self.obj]).encode()


class HelperContracts(unittest.TestCase):
    def setUp(self):
        self.req = request()
        self.runtime = Runtime(self.req)
        obs = snapshot()[3]["nodes"][0]
        self.payloads = [obs[key].encode() for key in ("cluster_nodes", "cluster_info", "info_keyspace")]
        self.sock = Socket(wire(self.payloads))
        self.connections = []

    def connect(self, ipv4, port, remaining):
        self.connections.append((ipv4, port, remaining))
        return self.sock

    def run_helper(self, **kwargs):
        return helper.handle(self.req, _runner=kwargs.get("runner", self.runtime),
                             _machine=kwargs.get("machine", lambda: MACHINE), _connect=self.connect)

    def unknown(self, **kwargs):
        result = self.run_helper(**kwargs)
        self.assertEqual(result["status"], "unknown")
        self.assertIsNone(result["record"])
        self.assertEqual(result["origin"], "mock-ssh")
        self.assertNotIn(SECRETS["backend_operator"], json.dumps(result))
        return result

    def test_fragmented_fixed_commands_complete_eof_and_no_secret_echo(self):
        result = self.run_helper()
        self.assertEqual(result["status"], "complete")
        self.assertEqual(set(result), set(self.req) - {"credential"} | {"origin", "status", "record"})
        self.assertEqual(result["record"]["process"], {"started_at": START, "pid": 1234})
        self.assertEqual(self.sock.shutdowns, [socket.SHUT_WR])
        self.assertTrue(self.sock.closed)
        self.assertEqual(len(self.runtime.calls), 2)
        commands = [[b"AUTH", b"backend_operator", SECRETS["backend_operator"].encode()],
                    [b"CLUSTER", b"NODES"], [b"CLUSTER", b"INFO"], [b"INFO", b"keyspace"]]
        expected = b"".join(b"*"+str(len(cmd)).encode()+b"\r\n"+b"".join(
            b"$"+str(len(arg)).encode()+b"\r\n"+arg+b"\r\n" for arg in cmd) for cmd in commands)
        self.assertEqual(bytes(self.sock.sent), expected)
        self.assertEqual(self.connections[0][:2], ("100.64.0.1", 17001))
        self.assertNotIn("credential", result)
        self.assertNotIn(SECRETS["backend_operator"], json.dumps(result))

    def test_every_frame_cut_point_is_unknown(self):
        raw = wire(self.payloads)
        for cut in range(len(raw)):
            self.sock = Socket(raw[:cut], fragment=4096)
            with self.subTest(cut=cut): self.unknown()

    def test_wrong_auth_and_bulk_types_lengths_delimiters(self):
        for auth in [b"-NOAUTH x\r\n", b"-ERR x\r\n", b"+PONG\r\n", b"$2\r\nOK\r\n", b":1\r\n", b"+OK\n"]:
            self.sock = Socket(auth)
            with self.subTest(auth=auth): self.unknown()
        for frame in [b"-ERR x\r\n", b"-NOPERM x\r\n", b"-LOADING x\r\n", b"$-1\r\n", b"*0\r\n", b"%0\r\n", b":1\r\n",
                      b"$+1\r\nx\r\n", b"$01\r\nx\r\n", b"$-2\r\n", b"$99999999999999999\r\n", b"$1\nx\r\n",
                      b"$1\r\nx\n", b"$2\r\nx\r\n", b"$1\r\nxy\r\n", b"", b"$0\r\n\r\n"]:
            self.sock = Socket(b"+OK\r\n" + frame)
            with self.subTest(frame=frame): self.unknown()

    def test_final_extra_bytes_frame_and_eof_holder_unknown(self):
        for extra in [b"x", b"\r\n", b"+OK\r\n"]:
            self.sock = Socket(wire(self.payloads) + extra)
            self.unknown()
        self.sock = Socket(wire(self.payloads)); self.sock.hold = True
        self.unknown()

    def test_payload_exact_bounds_overlimits_and_ascii(self):
        for i, cap in enumerate([65536, 16384, 4096]):
            payloads = list(self.payloads); payloads[i] = b"x" * cap
            self.sock = Socket(wire(payloads), fragment=4096)
            self.assertEqual(self.run_helper()["status"], "complete")
            payloads[i] += b"x"; self.sock = Socket(wire(payloads), fragment=4096)
            self.unknown()
        for raw in [b"\xff", b"\x00", b"\t", b"\x7f"]:
            payloads = list(self.payloads); payloads[0] = raw
            self.sock = Socket(wire(payloads)); self.unknown()

    def test_machine_precheck_and_postcheck_no_payload_survives(self):
        for raw in [b"", b"0" * 32, MACHINE[:-1], MACHINE+b"\n", b"g" * 32]:
            self.runtime.calls.clear(); self.connections.clear()
            self.unknown(machine=lambda: raw)
            self.assertEqual(self.runtime.calls, []); self.assertEqual(self.connections, [])
        reads = iter([MACHINE, MACHINE[:-1]])
        self.unknown(machine=lambda: next(reads))
        self.assertEqual(len(self.runtime.calls), 1)

    def test_bad_preinspect_prevents_connect(self):
        changes = [lambda o:o.update(Id="f"*64), lambda o:o["Config"]["Labels"].update(extra="x"),
            lambda o:o["Config"]["Labels"].update({"io.mithril-research.run":"foreign"}),
            lambda o:o["State"].update(Status="exited",Running=False), lambda o:o["State"].update(Paused=True),
            lambda o:o["State"].update(Restarting=True), lambda o:o["State"].update(Pid=True),
            lambda o:o["State"].update(Pid=0), lambda o:o["State"].update(Pid=2**31),
            lambda o:o["State"].update(StartedAt="0001-01-01T00:00:00Z"),
            lambda o:o["State"].update(StartedAt="2026-02-30T01:02:03Z"),
            lambda o:o["State"].update(StartedAt="2026-10-17T25:02:03Z"),
            lambda o:o["State"].update(StartedAt="2026-10-17T01:02:03.1234567890Z"),
            lambda o:o.update(State=None)]
        for change in changes:
            runtime = Runtime(self.req); change(runtime.obj); self.connections.clear()
            with self.subTest(change=change): self.unknown(runner=runtime)
            self.assertEqual(self.connections, [])
        for raw in [b"[]", b"null", b"{}", b"x"*65537]:
            self.connections.clear(); self.unknown(runner=lambda *a:raw)
            self.assertEqual(self.connections, [])

    def test_post_restart_and_binding_drift_discards_all(self):
        for change in [lambda o:o["State"].update(Pid=1235),
            lambda o:o["State"].update(StartedAt="2026-10-17T01:02:04Z"),
            lambda o:o["State"].update(Running=False), lambda o:o.update(Id="e"*64),
            lambda o:o["Config"]["Labels"].update({"io.mithril-research.role":"R3"})]:
            runtime = Runtime(self.req); post = copy.deepcopy(runtime.obj); change(post)
            runtime.objects = [copy.deepcopy(runtime.obj), post]
            self.sock = Socket(wire(self.payloads), fragment=4096)
            with self.subTest(change=change): self.unknown(runner=runtime)

    def test_single_monotonic_deadline_slow_drip_and_connect_failure(self):
        now = [0.0]
        self.sock.on_recv = lambda: now.__setitem__(0, now[0]+0.7)
        with patch.object(helper.time, "monotonic", side_effect=lambda:now[0]): self.unknown()
        self.assertLess(len(self.sock.sent), 400)
        self.assertTrue(all(0 < x <= 20 for x in self.sock.timeouts))
        self.sock = Socket(wire(self.payloads))
        with patch.object(self, "connect", side_effect=OSError("secret-sentinel")): self.unknown()

    def test_request_shape_types_and_operation_are_fixed(self):
        for key in self.req:
            for bad in [None, True, [], {}]:
                req = copy.deepcopy(self.req); req[key] = bad
                with self.subTest(key=key,bad=bad), self.assertRaises(helper.ProtocolError): helper.validate_request(req)
        for change in [{"operation":"stop"}, {"extra":"x"}, {"credential":"x\nAUTH"}, {"host":"H4"}]:
            with self.assertRaises(helper.ProtocolError): helper.validate_request(dict(self.req,**change))
        for key,bad in [("ipv4","localhost"),("ipv4","127.0.0.1"),("port",True),("bus_port",27002),("role","A"),("node_id","e"*39)]:
            req=copy.deepcopy(self.req);req["target"][key]=bad
            with self.assertRaises(helper.ProtocolError):helper.validate_request(req)

    def test_numeric_connect_boundary_and_blocking_failures(self):
        fake=Socket(b"")
        fake.connect=lambda address:self.assertEqual(address,("100.64.0.1",17001))
        with patch.object(helper.socket,"socket",return_value=fake) as factory:
            self.assertIs(helper.connect("100.64.0.1",17001,1.5),fake)
        factory.assert_called_once_with(socket.AF_INET,socket.SOCK_STREAM,socket.IPPROTO_TCP)
        for name in ["send","recv","shutdown"]:
            self.sock=Socket(wire(self.payloads))
            with patch.object(self.sock,name,side_effect=TimeoutError("secret-sentinel")):
                self.unknown()
        self.sock=Socket(wire(self.payloads))
        with patch.object(self.sock,"send",return_value=0):self.unknown()
        now=[0.0]
        def expired(*args):now[0]=21;return self.runtime(*args)
        self.connections.clear()
        with patch.object(helper.time,"monotonic",side_effect=lambda:now[0]):self.unknown(runner=expired)
        self.assertEqual(self.connections,[])

    def test_each_injected_dependency_forces_mock_origin(self):
        # Defaults are patched at their boundary; only one explicit seam per call.
        for seam in ["_runner","_machine","_connect"]:
            self.sock=Socket(wire(self.payloads),fragment=4096)
            with patch.object(helper,"bounded_run",side_effect=self.runtime), patch.object(helper,"machine_bytes",return_value=MACHINE), \
                 patch.object(helper,"connect",side_effect=self.connect):
                deps={"_runner":self.runtime,"_machine":lambda:MACHINE,"_connect":self.connect}
                self.assertEqual(helper.handle(self.req,**{seam:deps[seam]})["origin"],"mock-ssh")


class CollectionContracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.manifest,self.ownership,self.ids,self.obs=snapshot()
        self.calls=[];self.failures={};self.transform=None
        class FakeTransport:
            origin="mock-ssh"
            def send(inner,req,alias):
                self.calls.append((copy.deepcopy(req),alias))
                role=req["target"]["role"]
                if role in self.failures:raise self.failures[role]
                node=copy.deepcopy(next(n for n in self.obs["nodes"] if n["role"]==role))
                node["process"]={"started_at":START,"pid":1234}
                result={k:copy.deepcopy(v) for k,v in req.items() if k!="credential"}
                result.update(origin="mock-ssh",status="complete",record=node)
                if self.transform:self.transform(result)
                return result
        self.transport=FakeTransport()

    def collect(self,**kwargs):
        return collector.collect(kwargs.get("manifest",self.manifest),kwargs.get("digest",self.manifest["bundle_sha256"]),
            kwargs.get("ownership",self.ownership),kwargs.get("ids",self.ids),kwargs.get("credentials",SECRETS),
            kwargs.get("transport",self.transport),execute_approved=kwargs.get("approved",True))

    def validate(self,result):
        return collector.validate_collection(self.manifest,self.manifest["bundle_sha256"],self.ownership,self.ids,result)

    def write(self,result,path):
        return collector.write_collection(self.manifest,self.manifest["bundle_sha256"],self.ownership,self.ids,result,path)

    def test_six_complete_pristine_and_converged_inputs_detached_and_secret_free(self):
        for converged in [False,True]:
            self.obs=snapshot(converged)[3];self.calls.clear()
            before=copy.deepcopy((self.manifest,self.ownership,self.ids,self.obs,SECRETS))
            result=self.collect()
            self.assertEqual(result["status"],"complete")
            self.assertEqual(result["lane"],"redis-collection")
            self.assertEqual(result["origin"],"mock-ssh")
            self.assertEqual(result["live_runtime"],"UNEXECUTED")
            self.assertIs(result["live_ready"],False);self.assertIs(result["phase_execution_supported"],False)
            self.assertEqual([n["target"]["role"] for n in result["nodes"]],ROLES)
            self.assertEqual([r[0]["target"]["role"] for r in self.calls],ROLES)
            self.assertEqual(len({r[0]["operation_id"] for r in self.calls}),6)
            self.assertEqual(len({r[0]["collection_id"] for r in self.calls}),1)
            self.assertEqual(self.validate(result),result)
            self.assertEqual(before,(self.manifest,self.ownership,self.ids,self.obs,SECRETS))
            for secret in list(SECRETS.values())[1:]:
                self.assertNotIn(secret,json.dumps(result));self.assertNotIn(hashlib.sha256(secret.encode()).hexdigest(),json.dumps(result))
            self.assertEqual({r[0]["credential"] for r in self.calls},{SECRETS["backend_operator"]})
            result["expected_node_ids"].clear();self.assertEqual(len(self.ids),6)

    def test_intermediates_collect_without_becoming_p1c_admissible(self):
        for all_master in [False,True]:
            self.obs=snapshot(all_master)[3]
            for i,node in enumerate(self.obs["nodes"]):
                if all_master:
                    rows=[]
                    for row in node["cluster_nodes"].splitlines():
                        parts=row.split();parts[2]=parts[2].replace("slave","master");parts[3]="-";rows.append(" ".join(parts))
                    node["cluster_nodes"]="\n".join(rows)+"\n"
                else:
                    node["cluster_nodes"]=node["cluster_nodes"].replace(" 0 connected",f" {i+1} connected")
                    node["cluster_info"]=node["cluster_info"].replace("epoch:0",f"epoch:{i+1}")
            with patch.object(bootstrap,"_classify",side_effect=AssertionError("classification forbidden")):
                self.assertEqual(self.collect()["status"],"complete")
            with self.assertRaises(labctl.LabError):bootstrap.validate_observations(self.manifest,self.manifest["bundle_sha256"],self.ownership,self.ids,self.obs)

    def test_collection_has_no_network_journal_or_topology_side_effect(self):
        with patch.object(socket,"socket",side_effect=AssertionError("real socket forbidden")), \
             patch.object(subprocess,"Popen",side_effect=AssertionError("real runtime forbidden")), \
             patch.object(labctl,"owned_scope",side_effect=AssertionError("journal forbidden")), \
             patch.object(labctl,"atomic_write",side_effect=AssertionError("journal forbidden")):
            result=self.collect()
            self.assertEqual(self.validate(result),result)
        with self.assertRaises(labctl.LabError):
            bootstrap.validate_observations(self.manifest,self.manifest["bundle_sha256"],self.ownership,self.ids,result)

    def test_partial_once_each_and_all_failures_have_null_records(self):
        for roles in [["M2"],ROLES]:
            self.calls.clear();self.failures={r:labctl.LabError("lost-reply") for r in roles}
            result=self.collect();self.assertEqual(result["status"],"partial")
            self.assertEqual(len(self.calls),6);self.assertEqual(self.validate(result),result)
            self.assertEqual([n["target"]["role"] for n in result["nodes"] if n["status"]=="unknown"],list(roles))
            self.assertTrue(all(n["record"] is None for n in result["nodes"] if n["status"]=="unknown"))
        self.failures={"M3":KeyboardInterrupt()}
        with self.assertRaises(KeyboardInterrupt):self.collect()

    def test_invalid_shared_inputs_refuse_before_dispatch(self):
        for kwargs in [{"digest":"f"*64},{"ownership":{}},{"ids":{}},{"credentials":{}},{"approved":False},
                       {"credentials":dict(SECRETS,backend_operator="secret\n")},{"ids":dict(self.ids,M1=self.ids["M2"])},
                       {"ownership":dict(self.ownership,targets=self.ownership["targets"][:-1])}]:
            self.calls.clear()
            with self.subTest(kwargs=list(kwargs)),self.assertRaises(labctl.LabError):self.collect(**kwargs)
            self.assertEqual(self.calls,[])

    def test_bad_protocol_origin_binding_and_records_become_unknown(self):
        changes=[lambda r:r.update(extra=True),lambda r:r.update(schema_version=True),lambda r:r.update(origin="ssh"),
            lambda r:r.update(operation_id="a"*32),lambda r:r.update(status="complete",record=None),
            lambda r:r.update(status="unknown"),lambda r:r.update(credential="bad"),
            lambda r:r["record"]["process"].update(pid=True),lambda r:r["record"]["labels"].update(extra="x"),
            lambda r:r["record"].update(machine_identity_sha256="f"*64),
            lambda r:r["record"].update(cluster_nodes=r["record"]["cluster_nodes"].replace("100.64.","100.65.")),
            lambda r:r["record"].update(cluster_nodes=r["record"]["cluster_nodes"].replace("myself","fail")),
            lambda r:r["record"].update(info_keyspace=""),lambda r:r["record"].update(cluster_info="-ERR secret-sentinel\n")]
        for change in changes:
            self.transform=change
            with self.subTest(change=change):
                result=self.collect();self.assertEqual(result["status"],"partial")
                self.assertTrue(all(n["record"] is None for n in result["nodes"]))
        self.transform=None
        for node in self.obs["nodes"]:
            for nid in self.ids.values():node["cluster_nodes"]=node["cluster_nodes"].replace(nid,"f"*40)
        self.assertEqual(self.collect()["status"],"partial")

    def test_collection_schema_status_identity_type_and_cap_tampering_refused(self):
        original=self.collect()
        changes=[lambda c:c.update(extra=1),lambda c:c.update(status="partial"),lambda c:c.update(live_ready=True),
            lambda c:c.update(phase_execution_supported=True),lambda c:c.update(origin="synthetic"),lambda c:c.update(schema_version=True),
            lambda c:c.update(collection_id="x"),lambda c:c.update(bundle_sha256="f"*64),lambda c:c.update(expected_node_ids={}),
            lambda c:c["nodes"].reverse(),lambda c:c["nodes"][0].update(status="unknown"),
            lambda c:c["nodes"][0]["target"].update(host="H2"),lambda c:c["nodes"][0]["record"].update(extra=1)]
        for change in changes:
            result=copy.deepcopy(original);change(result)
            with self.subTest(change=change),self.assertRaises(labctl.LabError):self.validate(result)
            with self.assertRaises(labctl.LabError):self.write(result,self.root/"refused")
            self.assertFalse((self.root/"refused").exists())
        for key in original:
            for bad in [None,True,[],{}]:
                result=copy.deepcopy(original);result[key]=bad
                with self.subTest(key=key,bad=bad),self.assertRaises(labctl.LabError):self.validate(result)
        with patch.object(collector,"MAX_COLLECTION_BYTES",100),self.assertRaises(labctl.LabError):self.validate(original)
        self.assertEqual(labctl.MAX_BYTES,1048576)

    def test_writer_new_private_and_partial_retention_and_path_guards(self):
        result=self.collect();out=self.root/"complete"
        summary=self.write(result,out)
        self.assertEqual(set(summary),{"lane","origin","status","complete_nodes","unknown_nodes","phase_execution_supported","live_ready","live_runtime"})
        self.assertEqual(summary["complete_nodes"],6)
        self.assertEqual(json.loads((out/"collection.json").read_bytes()),result)
        self.assertEqual(stat.S_IMODE(out.stat().st_mode),0o700)
        self.assertEqual(stat.S_IMODE((out/"collection.json").stat().st_mode),0o600)
        self.failures={"M2":labctl.LabError("unknown")};partial=self.collect();summary=self.write(partial,self.root/"partial")
        self.assertEqual(summary["unknown_nodes"],1)
        alias=self.root/"alias";alias.symlink_to(self.root,target_is_directory=True)
        unsafe=self.root/"unsafe";unsafe.mkdir(mode=0o755)
        for path in [out,alias/"child",self.root/".."/self.root.name/"traverse",SCRIPTS/"forbidden",Path("relative"),
                     Path("/home/fixture/mithril/fixture-demo/child"),unsafe/"child",None,True,[],{}]:
            with self.subTest(path=str(path)),self.assertRaises(labctl.LabError):self.write(result,path)
        target=self.root/"retained";target.write_text("unique evidence");target.chmod(0o600)
        original=collector._save_collection
        def inject(fd,payload):os.link(target,"collection.json",dst_dir_fd=fd);return original(fd,payload)
        with patch.object(collector,"_save_collection",side_effect=inject),self.assertRaises(labctl.LabError):self.write(result,self.root/"write-failed")
        self.assertTrue((self.root/"write-failed").exists());self.assertEqual(target.read_text(),"unique evidence")


class TransportCliContracts(unittest.TestCase):
    collect = CollectionContracts.collect
    validate = CollectionContracts.validate
    write = CollectionContracts.write
    def setUp(self):
        CollectionContracts.setUp(self)
        self.config={"schema_version":1,"deadline_seconds":2}
        for name in ["ssh_config","known_hosts"]:
            path=self.root/name;path.write_text("# synthetic\n");path.chmod(0o600);self.config[name]=str(path)

    def test_new_literal_command_origin_and_large_response(self):
        # Parser-valid raw nodes below64KiB; serialized response above64KiB.
        self.obs["nodes"][0]["cluster_nodes"]=self.obs["nodes"][0]["cluster_nodes"].replace(
            " connected", " connected "+" ".join(format(i,"020d") for i in range(3000)))
        self.obs["nodes"][0]["info_keyspace"]="# Keyspace\n"+"\n"*4000
        seen=[]
        def runner(argv,raw,deadline,limit):
            seen.append((argv,deadline,limit))
            self.assertEqual(limit,524288);self.assertEqual(argv[-1],collector.REMOTE_COMMAND)
            self.assertNotEqual(argv[-1],__import__("ssh_executor").REMOTE_COMMAND)
            req=helper.decode(raw,65536)
            result=self.transport.send(req,argv[-2])
            encoded=helper.canonical(result)
            if req["target"]["role"]=="M1":self.assertGreater(len(encoded),65536)
            self.assertNotIn(SECRETS["backend_operator"],json.dumps(argv))
            return encoded
        transport=collector.Transport(self.config,_runner=runner)
        result=self.collect(transport=transport)
        self.assertEqual(result["status"],"complete")
        self.assertEqual(len(seen),6)
        argv=seen[0][0]
        for option in ["StrictHostKeyChecking=yes","ClearAllForwardings=yes","BatchMode=yes",
                       "ForwardAgent=no","ForwardX11=no","ControlMaster=no","RequestTTY=no"]:
            self.assertIn(option,argv)
        req=request();payload={k:v for k,v in req.items() if k!="credential"}
        payload.update(origin="ssh",status="unknown",record=None)
        with self.assertRaises(labctl.LabError):
            collector.Transport(self.config,_runner=lambda *a:helper.canonical(payload)).send(req,"fixture-h1")
        for raw in [b'{"x":1,"x":2}',b'{"x":NaN}',b'\xff',b'x'*524289]:
            with self.assertRaises(labctl.LabError):
                collector.Transport(self.config,_runner=lambda *a:raw).send(req,"fixture-h1")
        for directive in ["Include /private/config","Match exec secret-sentinel","ProxyCommand secret-sentinel"]:
            Path(self.config["ssh_config"]).write_text(directive+"\n")
            with self.assertRaises(labctl.LabError):transport.send(req,"fixture-h1")
        self.assertEqual(len(seen),6)

    def test_mapping_parent_must_be_private_before_dispatch(self):
        public=self.root/"public-mapping";public.mkdir(mode=0o755)
        known=public/"known_hosts";known.write_text("# synthetic\n");known.chmod(0o600)
        calls=[]
        with self.assertRaises(labctl.LabError):
            collector.Transport(dict(self.config,known_hosts=str(known)),_runner=lambda *args:calls.append(args))
        self.assertEqual(calls,[])

    def test_runner_actual_subprocess_large_pipes_deadlines_and_fixed_environment(self):
        raw=helper.bounded_run([sys.executable,"-c","import os,sys;assert set(os.environ)<=set(['PATH','LANG','LC_ALL','LC_CTYPE']);sys.stdout.buffer.write(b'x'*70000)"],b"",2,524288)
        self.assertEqual(len(raw),70000)
        for code in ["import sys;sys.stdout.write('x'*600000)","import sys;sys.stderr.write('secret-sentinel'*60000)",
                     "import sys;sys.exit(3)","import os,time;pid=os.fork();time.sleep(5) if pid==0 else None"]:
            started=time.monotonic()
            with self.assertRaises(helper.ProtocolError):helper.bounded_run([sys.executable,"-c",code],b"",.15,524288)
            self.assertLess(time.monotonic()-started,2)

    def save(self,name,value):
        path=self.root/name;path.write_bytes(labctl.canonical(value));path.chmod(0o600);return path

    def arguments(self,out="cli-output"):
        return ["collect","--manifest",self.save("manifest.json",self.manifest),"--expected-bundle-digest",self.manifest["bundle_sha256"],
            "--ownership",self.save("ownership.json",self.ownership),"--node-ids",self.save("ids.json",self.ids),
            "--credentials",self.save("credentials.json",SECRETS),"--transport-config",self.save("transport.json",self.config),
            "--output",self.root/out,"--execute-approved"]

    def cli(self,args,wrapper=False,partial=False):
        if wrapper:
            # Real subprocess CLI with only the Python transport dependency injected.
            code='''import copy,json,sys
sys.path[:0]=[sys.argv[1],sys.argv[2]]
import collector
from test_bootstrap import snapshot
obs=snapshot()[3]
class Mock:
 origin='mock-ssh'
 def __init__(self,config): pass
 def send(self,req,alias):
  if PARTIAL and req['target']['role']=='M2': raise collector.labctl.LabError('lost-reply')
  record=copy.deepcopy(next(n for n in obs['nodes'] if n['role']==req['target']['role']))
  record['process']={'started_at':'2026-10-17T01:02:03Z','pid':1234}
  result={k:v for k,v in req.items() if k!='credential'}
  return dict(result,origin='mock-ssh',status='complete',record=record)
collector.Transport=Mock
sys.exit(collector.main(sys.argv[3:]))
'''.replace("PARTIAL",repr(partial))
            argv=[sys.executable,"-c",code,str(SCRIPTS),str(SCRIPTS.parent/"tests"),*map(str,args)]
        else:argv=[sys.executable,str(SCRIPTS/"collector.py"),*map(str,args)]
        return subprocess.run(argv,capture_output=True,text=True,timeout=10)

    def sanitized(self,result):
        self.assertEqual(result.stderr,"")
        for secret in list(SECRETS.values())[1:]:
            self.assertNotIn(secret,result.stdout+result.stderr);self.assertNotIn(hashlib.sha256(secret.encode()).hexdigest(),result.stdout+result.stderr)
        for marker in [str(self.root),"fixture-h1","100.64.0.1","/home/fixture",self.ids["M1"],self.ownership["targets"][0]["container_id"]]:
            self.assertNotIn(marker,result.stdout+result.stderr)
        value=json.loads(result.stdout);self.assertIs(value["live_ready"],False);self.assertEqual(value["live_runtime"],"UNEXECUTED")

    def test_actual_cli_help_errors_and_mocked_complete_partial_subprocesses(self):
        for partial in [False,True]:
            result=self.cli(self.arguments("partial" if partial else "complete"),wrapper=True,partial=partial)
            self.assertEqual(result.returncode,2 if partial else 0,result.stdout+result.stderr);self.sanitized(result)
            self.assertEqual(json.loads(result.stdout)["origin"],"mock-ssh")
            self.assertTrue((self.root/("partial" if partial else "complete")/"collection.json").exists())
        for args in [["--help"],["collect","--help"],["--mock","secret-sentinel"],["stop","secret-sentinel"],self.arguments()[:-1]]:
            result=self.cli(args);self.assertEqual(result.returncode,0 if "--help" in args else 2);self.sanitized(result)

    def test_private_input_invalid_json_permissions_links_and_source_before_dispatch(self):
        args=self.arguments();path=self.root/"credentials.json";original=path.read_bytes()
        for raw in [b'{"x":1,"x":2}',b'\xff',b'{"x":NaN}',b'{"x":1e999}',b"x"*65537]:
            path.write_bytes(raw);result=self.cli(args,wrapper=True);self.assertEqual(result.returncode,2);self.sanitized(result)
        path.write_bytes(original);path.chmod(0o644);self.assertEqual(self.cli(args,wrapper=True).returncode,2);path.chmod(0o600)
        alias=self.root/"hardlink";os.link(path,alias);self.assertEqual(self.cli(args,wrapper=True).returncode,2);alias.unlink()
        path.rename(alias);path.symlink_to(alias);self.assertEqual(self.cli(args,wrapper=True).returncode,2);path.unlink();alias.rename(path)
        self.root.chmod(0o755);self.assertEqual(self.cli(args,wrapper=True).returncode,2);self.root.chmod(0o700)
        for bad in [SCRIPTS/"collector.py",self.root/".."/self.root.name/"credentials.json"]:
            changed=list(args);changed[changed.index("--credentials")+1]=bad
            self.assertEqual(self.cli(changed,wrapper=True).returncode,2)
        self.assertFalse((self.root/"cli-output").exists())


if __name__=="__main__":unittest.main()

"""Private local journal tests. Effects are external synthetic wrappers only."""
import copy
import errno
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPTS=Path(__file__).resolve().parents[1]/"scripts"
sys.path.insert(0,str(SCRIPTS))
import bootstrap_journal as journal
import bootstrap
import collector
import labctl
from test_bootstrap import snapshot

FLAGS={"lane":"offline-bootstrap-journal","execution_supported":False,"live_ready":False,"live_runtime":"UNEXECUTED",
       "effect_dispatch_supported":False,"resolution_supported":False}
META_KEYS={"schema_version",*FLAGS,"journal_id","bootstrap_sha256","run_id","plan_sha256","bundle_sha256",
           "ownership","expected_node_ids","source_origin","root_binding","lock_binding"}
INTENT_KEYS={"schema_version","journal_id","bootstrap_sha256","intent_id","status","phase_id","action_index","action"}


def plan(converged=False):
    m,o,ids,obs=snapshot(converged)
    return bootstrap.build_bootstrap_plan(m,m["bundle_sha256"],o,ids,obs)


class JournalContracts(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
        self.plan=plan();self.digest=self.plan["bootstrap_sha256"];self.state=self.root/"state"

    def init(self,path=None):return journal.initialize_journal(self.plan,self.digest,str(path or self.state))
    def status(self,path=None):return journal.journal_status(self.plan,self.digest,str(path or self.state))
    def record(self,phase="set-config-epochs",index=0,path=None):return journal.record_intent(self.plan,self.digest,str(path or self.state),phase,index)
    def disk(self,path=None):return {p.name:p.read_bytes() for p in (path or self.state).iterdir() if p.is_file()}
    def save_plan(self):
        p=self.root/"plan.json";p.write_bytes(labctl.canonical(self.plan));p.chmod(0o600);return p
    def cli(self,action,*extra,state=None):
        return subprocess.run([sys.executable,str(SCRIPTS/"bootstrap_journal.py"),action,"--plan",str(self.save_plan()),
            "--expected-bootstrap-digest",self.digest,"--state-root",str(state or self.state),*map(str,extra)],capture_output=True,text=True,timeout=10)
    def child(self,code,*args):
        return subprocess.run([sys.executable,"-c",code,str(SCRIPTS),str(self.save_plan()),self.digest,str(self.state),*map(str,args)],capture_output=True,text=True,timeout=10)
    def sanitized(self,result):
        self.assertEqual(result.stderr,"")
        for marker in [str(self.root),"secret-sentinel",self.digest,self.plan["ownership"]["run_id"],self.plan["expected_node_ids"]["M1"],"fixture-h1","100.64.0.1"]:
            self.assertNotIn(marker,result.stdout+result.stderr)
        value=json.loads(result.stdout)
        for key,item in FLAGS.items():self.assertEqual(value[key],item)
        return value

    def test_exact_schemas_modes_immutable_status_and_restart(self):
        original=copy.deepcopy(self.plan);result=self.init()
        self.assertEqual(set(result),{"schema_version",*FLAGS,"journal_state","metadata","intent"})
        self.assertEqual(result["journal_state"],"no-intent");self.assertIsNone(result["intent"])
        metadata=result["metadata"];self.assertEqual(set(metadata),META_KEYS)
        for key in FLAGS:self.assertEqual(metadata[key],FLAGS[key])
        self.assertEqual(metadata["bootstrap_sha256"],self.digest)
        self.assertEqual(metadata["ownership"],self.plan["ownership"])
        self.assertEqual(metadata["expected_node_ids"],self.plan["expected_node_ids"])
        self.assertEqual(metadata["source_origin"],"synthetic")
        for path,key in [(self.state,"root_binding"),(self.state/".lock","lock_binding")]:
            info=path.stat();self.assertEqual(metadata[key],{"device":info.st_dev,"inode":info.st_ino})
        self.assertEqual(stat.S_IMODE(self.state.stat().st_mode),0o700)
        self.assertEqual(self.disk()[".lock"],b"")
        self.assertEqual(self.disk()["journal.json"],labctl.canonical(metadata)+b"\n")
        before=self.disk();self.assertEqual(self.status(),result);self.assertEqual(before,self.disk())
        result["metadata"]["ownership"]["targets"].clear();self.assertEqual(self.plan,original)
        recorded=self.record();self.assertEqual(recorded["journal_state"],"uncertain")
        self.assertEqual(set(recorded["intent"]),INTENT_KEYS)
        self.assertEqual(recorded["intent"]["status"],"uncertain")
        self.assertEqual(recorded["intent"]["action"],self.plan["phases"][0]["actions"][0])
        for file in self.state.iterdir():self.assertEqual(stat.S_IMODE(file.stat().st_mode),0o600)
        before=self.disk();result=self.cli("status");self.assertEqual(result.returncode,0);self.assertEqual(self.sanitized(result)["journal_state"],"uncertain")
        self.assertEqual(before,self.disk());self.assertEqual(self.plan,original)

    def test_all_original_actions_and_permanent_duplicate_fence(self):
        for phase in self.plan["phases"]:
            for index,action in enumerate(phase["actions"]):
                path=self.root/(phase["phase_id"]+str(index));self.init(path)
                result=self.record(phase["phase_id"],index,path)
                self.assertEqual(result["intent"]["action"],action)
                before=self.disk(path)
                for selected,idx in [(phase["phase_id"],index),("meet",0),("replicate",2)]:
                    with self.assertRaises(labctl.LabError):self.record(selected,idx,path)
                self.assertEqual(before,self.disk(path));self.assertEqual(self.status(path)["journal_state"],"uncertain")

    def test_invalid_plan_binding_and_selection_before_writes(self):
        for value in [None,True,[],{},"x"]:
            for api,args in [(journal.initialize_journal,()),(journal.journal_status,()),(journal.record_intent,("meet",0))]:
                with self.subTest(value=value,api=api.__name__),self.assertRaises(labctl.LabError):api(value,self.digest,str(self.state),*args)
        for bad in [plan(True),dict(self.plan,extra=True)]:
            with self.assertRaises(labctl.LabError):journal.initialize_journal(bad,bad["bootstrap_sha256"],str(self.state))
        with self.assertRaises(labctl.LabError):journal.initialize_journal(self.plan,"f"*64,str(self.state))
        self.assertFalse(self.state.exists());self.init();before=self.disk()
        for phase,index in [("unknown",0),(None,0),(True,0),([],0),("meet",True),("meet",-1),("meet",5),("meet",1.0),("meet","0")]:
            with self.subTest(phase=phase,index=index),self.assertRaises(labctl.LabError):self.record(phase,index)
        self.assertEqual(before,self.disk())
        other=copy.deepcopy(self.plan);other["observations"]["origin"]="operator-supplied"
        other=bootstrap.build_bootstrap_plan(other["source_manifest"],other["source_manifest"]["bundle_sha256"],other["ownership"],other["expected_node_ids"],other["observations"])
        for api,args in [(journal.journal_status,()),(journal.record_intent,("meet",0))]:
            with self.assertRaises(labctl.LabError):api(other,other["bootstrap_sha256"],str(self.state),*args)
        cyclic={};cyclic["self"]=cyclic
        with self.assertRaises(labctl.LabError):journal.initialize_journal(cyclic,self.digest,str(self.root/"cyclic"))

    def test_missing_empty_partial_unknown_and_pending_are_never_adopted(self):
        for api,args in [(journal.journal_status,()),(journal.record_intent,("meet",0))]:
            with self.assertRaises(labctl.LabError):api(self.plan,self.digest,str(self.state),*args)
        self.assertFalse(self.state.exists());self.state.mkdir(mode=0o700)
        with self.assertRaises(labctl.LabError):self.init()
        self.assertEqual(list(self.state.iterdir()),[])
        for files in [{".lock":b""},{"journal.json":b"{}"},{".lock":b"",".initialize.pending":b"partial"}]:
            path=self.root/("partial"+str(len(list(self.root.iterdir()))));path.mkdir(mode=0o700)
            for name,raw in files.items():(path/name).write_bytes(raw);(path/name).chmod(0o600)
            before=self.disk(path)
            with self.assertRaises(labctl.LabError):self.status(path)
            with self.assertRaises(labctl.LabError):self.init(path)
            self.assertEqual(before,self.disk(path))
        path=self.root/"valid";self.init(path)
        for name in [".initialize.pending",".intent.pending","unknown"]:
            (path/name).write_bytes(b"partial");(path/name).chmod(0o600);before=self.disk(path)
            with self.assertRaises(labctl.LabError):self.status(path)
            with self.assertRaises(labctl.LabError):self.record(path=path)
            self.assertEqual(before,self.disk(path));(path/name).unlink()

    def test_raw_lexical_source_remote_and_parent_guards(self):
        for raw in [None,True,Path(self.state),"relative","/","//tmp/child",str(self.root)+"/./state",str(self.root)+"//state",
                    str(self.root)+"/state/",str(self.root)+"/../state",str(self.state)+"\x00",str(SCRIPTS/"forbidden"),
                    "/home/fixture/mithril/fixture-demo/child","/home/fixture/mithril"]:
            with self.subTest(raw=str(raw)),self.assertRaises(labctl.LabError):journal.initialize_journal(self.plan,self.digest,raw)
        self.root.chmod(0o755)
        with self.assertRaises(labctl.LabError):self.init()
        self.root.chmod(0o700);alias=self.root/"alias";alias.symlink_to(self.root,target_is_directory=True)
        with self.assertRaises(labctl.LabError):self.init(alias/"child")
        self.assertFalse(self.state.exists())

    def test_metadata_intent_semantic_and_canonical_refusal(self):
        self.init();self.record();original=self.disk()
        for filename in ["journal.json","intent.json"]:
            obj=json.loads(original[filename])
            changes=[lambda o:o.update(extra=1),lambda o:o.update(schema_version=True)]
            if filename=="journal.json":changes += [lambda o:o.update(source_origin="operator-supplied"),lambda o:o["root_binding"].update(inode=True),lambda o:o["lock_binding"].update(inode=1),lambda o:o.update(expected_node_ids={})]
            else:changes += [lambda o:o.update(status="completed"),lambda o:o.update(status="abandoned"),lambda o:o.update(journal_id="f"*32),lambda o:o.update(action_index=True),lambda o:o["action"].update(epoch=99),lambda o:o.update(phase_id="meet")]
            for change in changes:
                altered=copy.deepcopy(obj);change(altered);(self.state/filename).write_bytes(labctl.canonical(altered)+b"\n")
                with self.subTest(filename=filename,change=change),self.assertRaises(labctl.LabError):self.status()
            for raw in [original[filename].rstrip(),b" "+original[filename],b"{}\n",b"null\n",b'{"x":1,"x":2}\n',b'{"x":NaN}\n',b'\xff',b'['*2000+b']'*2000,b'x'*65537]:
                (self.state/filename).write_bytes(raw)
                with self.subTest(filename=filename,raw=raw[:30]),self.assertRaises(labctl.LabError):self.status()
            (self.state/filename).write_bytes(original[filename])
        self.assertEqual(self.status()["journal_state"],"uncertain")

    def test_link_copy_lock_mode_identity_and_fifo_refusal(self):
        self.init();original=self.disk()
        copied=self.root/"copied";shutil.copytree(self.state,copied)
        with self.assertRaises(labctl.LabError):self.status(copied)
        for name in [".lock","journal.json"]:
            file=self.state/name;alias=self.root/(name+"-alias");os.link(file,alias)
            with self.assertRaises(labctl.LabError):self.status()
            alias.unlink();file.chmod(0o644)
            with self.assertRaises(labctl.LabError):self.status()
            file.chmod(0o600);file.rename(alias);file.symlink_to(alias)
            with self.assertRaises(labctl.LabError):self.status()
            file.unlink();alias.rename(file)
        lock=self.state/".lock";lock.rename(self.root/"original-lock");lock.write_bytes(b"");lock.chmod(0o600)
        with self.assertRaises(labctl.LabError):self.status()
        lock.unlink();(self.root/"original-lock").rename(lock)
        lock.write_bytes(b"not empty")
        with self.assertRaises(labctl.LabError):self.status()
        lock.write_bytes(b"")
        file=self.state/"journal.json";file.unlink();os.mkfifo(file,0o600)
        result=self.cli("status");self.assertEqual(result.returncode,2);self.sanitized(result)
        file.unlink();file.write_bytes(original["journal.json"]);file.chmod(0o600)
        self.assertEqual(self.status()["journal_state"],"no-intent")

    def test_busy_lock_in_actual_other_process(self):
        self.init();ready=self.root/"ready";release=self.root/"release"
        code="""import fcntl,pathlib,sys,time
lock=open(sys.argv[1],'r+');fcntl.flock(lock,fcntl.LOCK_EX);pathlib.Path(sys.argv[2]).write_text('held')
end=time.monotonic()+5
while not pathlib.Path(sys.argv[3]).exists() and time.monotonic()<end:time.sleep(.01)
"""
        child=subprocess.Popen([sys.executable,"-c",code,str(self.state/".lock"),str(ready),str(release)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:
            deadline=time.monotonic()+3
            while not ready.exists() and time.monotonic()<deadline:time.sleep(.01)
            self.assertTrue(ready.exists());started=time.monotonic()
            for action in ["status","record-intent","init"]:
                args=["--phase-id","meet","--action-index","0"] if action=="record-intent" else []
                result=self.cli(action,*args);self.assertEqual(result.returncode,2);self.sanitized(result)
            self.assertLess(time.monotonic()-started,3)
        finally:release.write_text("release");child.wait(timeout=3)

    def test_two_actual_reservations_allow_one_external_mock_effect(self):
        self.init();release=self.root/"start";effect=self.root/"effect"
        code="""import json,pathlib,sys,time
sys.path.insert(0,sys.argv[1]);import bootstrap_journal as j,labctl
p=json.loads(pathlib.Path(sys.argv[2]).read_text());gate=pathlib.Path(sys.argv[5]);end=time.monotonic()+5
while not gate.exists() and time.monotonic()<end:time.sleep(.01)
try:j.record_intent(p,sys.argv[3],sys.argv[4],'meet',0)
except labctl.LabError:sys.exit(2)
with open(sys.argv[6],'x') as out:out.write('one synthetic effect after durable return')
"""
        argv=[sys.executable,"-c",code,str(SCRIPTS),str(self.save_plan()),self.digest,str(self.state),str(release),str(effect)]
        children=[subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE) for _ in range(2)]
        release.write_text("start");results=[c.communicate(timeout=8) for c in children]
        self.assertEqual(sorted(c.returncode for c in children),[0,2]);self.assertTrue(effect.is_file())
        self.assertTrue(all(not out and not err for out,err in results));self.assertEqual(self.status()["journal_state"],"uncertain")

    def test_failed_initialization_retains_partial_root_at_all_boundaries(self):
        for stage in ["mkdir","parent-fsync","lock-create","lock-acquire","pending-create","rename"]:
            path=self.root/stage
            original_open=os.open;original_fsync=os.fsync;original_rename=os.rename
            def opened(name,flags,*args,**kwargs):
                if stage=="lock-create" and name==".lock":raise OSError(errno.ENOSPC,"private-sentinel")
                if stage=="pending-create" and name==".initialize.pending":raise PermissionError("private-sentinel")
                return original_open(name,flags,*args,**kwargs)
            def fsynced(fd):
                if stage=="parent-fsync":raise OSError(errno.EIO,"private-sentinel")
                return original_fsync(fd)
            def renamed(*args,**kwargs):
                if stage=="rename":raise OSError(errno.EIO,"private-sentinel")
                return original_rename(*args,**kwargs)
            with patch.object(os,"open",side_effect=opened),patch.object(os,"fsync",side_effect=fsynced),patch.object(os,"rename",side_effect=renamed):
                if stage=="mkdir":
                    with patch.object(os,"mkdir",side_effect=PermissionError("private-sentinel")),self.assertRaises(labctl.LabError):self.init(path)
                elif stage=="lock-acquire":
                    with patch.object(fcntl,"flock",side_effect=BlockingIOError()),self.assertRaises(labctl.LabError):self.init(path)
                else:
                    with self.assertRaises(labctl.LabError):self.init(path)
            if stage=="mkdir":self.assertFalse(path.exists())
            else:
                self.assertTrue(path.exists());before=self.disk(path)
                with self.assertRaises(labctl.LabError):self.init(path)
                with self.assertRaises(labctl.LabError):self.status(path)
                self.assertEqual(before,self.disk(path))

    def test_intent_fsync_rename_reread_failures_never_call_effect_and_retain_artifacts(self):
        for stage in ["pending-create","file-fsync","staging-fsync","rename","final-fsync","reread"]:
            path=self.root/stage;self.init(path);effect=[];fsync_dirs=[0]
            original_open=os.open;original_fsync=os.fsync;original_rename=os.rename;original_read=os.read
            def opened(name,flags,*args,**kwargs):
                if stage=="pending-create" and name==".intent.pending":raise OSError(errno.ENOSPC,"private-sentinel")
                return original_open(name,flags,*args,**kwargs)
            def fsynced(fd):
                mode=os.fstat(fd).st_mode
                if stat.S_ISDIR(mode):
                    fsync_dirs[0]+=1
                    if (stage=="staging-fsync" and fsync_dirs[0]==1) or (stage=="final-fsync" and fsync_dirs[0]==2):raise OSError(errno.EIO,"private-sentinel")
                elif stage=="file-fsync":raise OSError(errno.EIO,"private-sentinel")
                return original_fsync(fd)
            def renamed(*args,**kwargs):
                if stage=="rename":raise OSError(errno.EIO,"private-sentinel")
                return original_rename(*args,**kwargs)
            def read(fd,count):
                if stage=="reread" and (path/"intent.json").exists():raise OSError(errno.EIO,"private-sentinel")
                return original_read(fd,count)
            with patch.object(os,"open",side_effect=opened),patch.object(os,"fsync",side_effect=fsynced),patch.object(os,"rename",side_effect=renamed),patch.object(os,"read",side_effect=read):
                with self.assertRaises(labctl.LabError):self.record(path=path);effect.append("must never happen")
            self.assertEqual(effect,[]);names=set(self.disk(path))
            if stage=="pending-create":self.assertEqual(self.status(path)["journal_state"],"no-intent")
            elif stage in ["final-fsync","reread"]:self.assertEqual(self.status(path)["journal_state"],"uncertain")
            else:
                self.assertIn(".intent.pending",names)
                with self.assertRaises(labctl.LabError):self.status(path)
            self.assertEqual(names,set(self.disk(path)))

    def test_actual_crashes_at_staging_postrename_and_postreturn(self):
        code="""import json,os,pathlib,sys
sys.path.insert(0,sys.argv[1]);import bootstrap_journal as j
p=json.loads(pathlib.Path(sys.argv[2]).read_text());stage=sys.argv[5];rename=os.rename
def crash(src,dst,*args,**kwargs):
 if dst=='intent.json' and stage=='staging':os._exit(31)
 result=rename(src,dst,*args,**kwargs)
 if dst=='intent.json' and stage=='postrename':os._exit(32)
 return result
os.rename=crash
j.record_intent(p,sys.argv[3],sys.argv[4],'meet',0)
os._exit(33)
"""
        for stage,exit_code in [("staging",31),("postrename",32),("postreturn",33)]:
            self.state=self.root/stage;self.init();result=self.child(code,stage);self.assertEqual(result.returncode,exit_code,result.stderr)
            result=self.cli("status")
            if stage=="staging":self.assertEqual(result.returncode,2);self.assertTrue((self.state/".intent.pending").exists())
            else:self.assertEqual(result.returncode,0);self.assertEqual(self.sanitized(result)["journal_state"],"uncertain")
            with self.assertRaises(labctl.LabError):self.record()

    def test_late_external_mock_effect_never_clears_uncertainty(self):
        self.init();self.record("meet",0);release=self.root/"release";effect=self.root/"effect"
        code="""import pathlib,sys,time
release,effect=map(pathlib.Path,sys.argv[1:]);end=time.monotonic()+5
while not release.exists() and time.monotonic()<end:time.sleep(.01)
if not release.exists():sys.exit(3)
with effect.open('x') as out:out.write('one late synthetic effect')
"""
        child=subprocess.Popen([sys.executable,"-c",code,str(release),str(effect)],stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        try:
            self.assertIsNone(child.poll());before=self.disk();self.assertFalse(effect.exists())
            result=self.cli("status");self.assertEqual(result.returncode,0);self.assertEqual(self.sanitized(result)["journal_state"],"uncertain")
            (self.root/"fresh-approval").write_text("new assertion cannot resolve old work")
            for phase,index in [("meet",0),("replicate",1)]:
                with self.assertRaises(labctl.LabError):self.record(phase,index)
            release.write_text("allow original late work");out,err=child.communicate(timeout=3);self.assertEqual(child.returncode,0);self.assertFalse(out or err)
            self.assertTrue(effect.exists());self.assertEqual(self.status()["journal_state"],"uncertain");self.assertEqual(before,self.disk())
            with self.assertRaises(labctl.LabError):self.record("meet",0)
        finally:
            release.write_text("release");child.communicate(timeout=3)

    def test_final_identity_check_refuses_substitution_after_committed_reread(self):
        self.init();original=journal._read_json;swapped=[False]
        def reader(fd,name,*args,**kwargs):
            result=original(fd,name,*args,**kwargs)
            if name=="intent.json" and not swapped[0]:
                swapped[0]=True
                (self.state/".lock").rename(self.root/"held-lock")
                (self.state/".lock").write_bytes(b"");(self.state/".lock").chmod(0o600)
            return result
        effects=[]
        with patch.object(journal,"_read_json",side_effect=reader),self.assertRaises(labctl.LabError):
            self.record();effects.append("forbidden")
        self.assertEqual(effects,[]);self.assertTrue((self.state/"intent.json").exists())
        self.assertTrue((self.root/"held-lock").exists())
        with self.assertRaises(labctl.LabError):self.status()

    def test_initial_lock_fsync_precedes_metadata_pending_creation(self):
        events=[];original_open=os.open;original_fsync=os.fsync
        def opened(name,flags,*args,**kwargs):
            if name==".initialize.pending":events.append("metadata-pending")
            return original_open(name,flags,*args,**kwargs)
        def fsynced(fd):
            info=os.fstat(fd)
            if stat.S_ISREG(info.st_mode) and info.st_size==0:events.append("lock-fsync")
            return original_fsync(fd)
        with patch.object(os,"open",side_effect=opened),patch.object(os,"fsync",side_effect=fsynced):self.init()
        self.assertIn("lock-fsync",events)
        self.assertLess(events.index("lock-fsync"),events.index("metadata-pending"))

    def test_initial_lock_fsync_failure_retains_unadoptable_partial_root(self):
        original=os.fsync;effects=[]
        def fsynced(fd):
            info=os.fstat(fd)
            if stat.S_ISREG(info.st_mode) and info.st_size==0:raise OSError(errno.EIO,"private-sentinel")
            return original(fd)
        with patch.object(os,"fsync",side_effect=fsynced),self.assertRaises(labctl.LabError):
            self.init();effects.append("forbidden")
        self.assertEqual(effects,[]);self.assertEqual(set(self.disk()),{".lock"})
        before=self.disk()
        for action in [self.init,self.status,self.record]:
            with self.assertRaises(labctl.LabError):action()
        self.assertEqual(before,self.disk())

    def test_short_write_flush_interrupt_and_no_cleanup(self):
        original=os.fdopen
        for stage in ["zero-write","partial-error","flush","interrupt"]:
            path=self.root/stage;self.init(path);effect=[]
            class Stream:
                def __init__(inner,stream):inner.stream=stream;inner.calls=0
                def __enter__(inner):return inner
                def __exit__(inner,*args):inner.stream.close()
                def write(inner,raw):
                    inner.calls+=1
                    if stage=="zero-write":return 0
                    if stage=="interrupt":raise KeyboardInterrupt()
                    if stage=="partial-error":
                        if inner.calls==1:return inner.stream.write(raw[:7])
                        raise OSError(errno.ENOSPC,"private-sentinel")
                    return inner.stream.write(raw)
                def flush(inner):
                    if stage=="flush":raise OSError(errno.EIO,"private-sentinel")
                    return inner.stream.flush()
            with patch.object(os,"fdopen",side_effect=lambda *a,**kw:Stream(original(*a,**kw))):
                error=KeyboardInterrupt if stage=="interrupt" else labctl.LabError
                with self.assertRaises(error):self.record(path=path);effect.append("forbidden")
            self.assertEqual(effect,[]);self.assertTrue((path/".intent.pending").exists())
            before=self.disk(path)
            with self.assertRaises(labctl.LabError):self.status(path)
            self.assertEqual(before,self.disk(path))
        # A positive short write must make progress until the entire payload is saved.
        path=self.root/"short-progress";self.init(path)
        class Partial:
            def __init__(inner,stream):inner.stream=stream
            def __enter__(inner):return inner
            def __exit__(inner,*args):inner.stream.close()
            def write(inner,raw):return inner.stream.write(raw[:7])
            def flush(inner):return inner.stream.flush()
        with patch.object(os,"fdopen",side_effect=lambda *a,**kw:Partial(original(*a,**kw))):self.record(path=path)
        self.assertEqual(self.status(path)["journal_state"],"uncertain")

    def test_lock_root_substitution_at_acquire_and_during_commit_refuses(self):
        for stage in ["lock-at-acquire","root-at-acquire","lock-during-commit","root-during-commit"]:
            path=self.root/stage;self.init(path);original_flock=fcntl.flock;original_rename=os.rename;swapped=[False]
            def swap():
                if swapped[0]:return
                swapped[0]=True
                if stage.startswith("lock"):
                    original_rename(path/".lock",self.root/(stage+"-held-lock"))
                    (path/".lock").write_bytes(b"");(path/".lock").chmod(0o600)
                else:
                    original_rename(path,self.root/(stage+"-held-root"));path.mkdir(mode=0o700)
            def flocked(fd,flags):
                value=original_flock(fd,flags)
                if "acquire" in stage:swap()
                return value
            def renamed(src,dst,*args,**kwargs):
                if "commit" in stage and dst=="intent.json":swap()
                return original_rename(src,dst,*args,**kwargs)
            with patch.object(fcntl,"flock",side_effect=flocked),patch.object(os,"rename",side_effect=renamed):
                with self.assertRaises(labctl.LabError):self.record(path=path)
            self.assertTrue(swapped[0])
            retained=path if stage.startswith("lock") else self.root/(stage+"-held-root")
            self.assertTrue((retained/"journal.json").exists())
            with self.assertRaises(labctl.LabError):self.status(path)

    def test_file_identity_growth_truncation_uid_and_remaining_special_files(self):
        self.init();self.record();original=self.disk();original_read=os.read;original_stat=os.fstat
        for stage in ["growth","truncation"]:
            touched=[False]
            def read(fd,count):
                if not touched[0]:
                    touched[0]=True
                    with (self.state/"journal.json").open("ab" if stage=="growth" else "wb") as stream:stream.write(b"x")
                return original_read(fd,count)
            with patch.object(os,"read",side_effect=read),self.assertRaises(labctl.LabError):self.status()
            self.assertTrue(touched[0]);(self.state/"journal.json").write_bytes(original["journal.json"])
        def foreign(fd):
            info=original_stat(fd)
            if stat.S_ISREG(info.st_mode):
                values=list(info);values[4]=os.getuid()+1;return os.stat_result(values)
            return info
        with patch.object(os,"fstat",side_effect=foreign),self.assertRaises(labctl.LabError):self.status()
        for name in [".lock","intent.json"]:
            target=self.state/name;old=target.read_bytes();target.unlink();os.mkfifo(target,0o600)
            result=self.cli("status");self.assertEqual(result.returncode,2);self.sanitized(result)
            target.unlink();target.mkdir(mode=0o700)
            with self.assertRaises(labctl.LabError):self.status()
            target.rmdir();target.write_bytes(old);target.chmod(0o600)
        self.state.chmod(0o755)
        with self.assertRaises(labctl.LabError):self.status()
        self.state.chmod(0o700)
        for kind in [stat.S_IFCHR,stat.S_IFBLK,stat.S_IFSOCK]:
            def special(fd):
                info=original_stat(fd)
                if stat.S_ISREG(info.st_mode):
                    values=list(info);values[0]=kind|0o600;return os.stat_result(values)
                return info
            with patch.object(os,"fstat",side_effect=special),self.assertRaises(labctl.LabError):self.status()
        self.assertEqual(self.disk(),original)

    def test_all_nested_metadata_and_intent_fields_have_strict_types(self):
        self.init();self.record();original=self.disk()
        for name in ["journal.json","intent.json"]:
            source=json.loads(original[name])
            for key in source:
                for bad in [None,True,[],{}]:
                    changed=copy.deepcopy(source);changed[key]=bad
                    (self.state/name).write_bytes(labctl.canonical(changed)+b"\n")
                    with self.subTest(name=name,key=key,bad=bad),self.assertRaises(labctl.LabError):self.status()
            (self.state/name).write_bytes(original[name])
        self.assertEqual(self.status()["journal_state"],"uncertain")

    def test_commit_order_caps_and_final_initialization_sync_failure(self):
        self.init();events=[];original_fsync=os.fsync;original_rename=os.rename
        def fsync(fd):events.append("dir-sync" if stat.S_ISDIR(os.fstat(fd).st_mode) else "file-sync");return original_fsync(fd)
        def rename(*args,**kwargs):events.append("rename");return original_rename(*args,**kwargs)
        with patch.object(os,"fsync",side_effect=fsync),patch.object(os,"rename",side_effect=rename):self.record()
        self.assertEqual(events,["file-sync","dir-sync","rename","dir-sync"])
        boundary=self.root/"boundary";boundary.write_bytes(labctl.canonical("x"*(65536-3))+b"\n");boundary.chmod(0o600)
        with labctl.directory(self.root) as fd:
            self.assertEqual(len(journal._read_json(fd,"boundary",65536,canonical=True)[0]),65533)
            boundary.write_bytes(boundary.read_bytes()+b" ")
            with self.assertRaises(labctl.LabError):journal._read_json(fd,"boundary",65536,canonical=True)
        path=self.root/"final-parent-sync";parents=[0]
        def final_parent(fd):
            if os.fstat(fd).st_ino==self.root.stat().st_ino:
                parents[0]+=1
                if parents[0]==2:raise OSError(errno.EIO,"private-sentinel")
            return original_fsync(fd)
        with patch.object(os,"fsync",side_effect=final_parent),self.assertRaises(labctl.LabError):self.init(path)
        self.assertTrue((path/"journal.json").exists());self.assertEqual(self.status(path)["journal_state"],"no-intent")
        with self.assertRaises(labctl.LabError):self.init(path)

    def test_private_plan_cli_raw_caps_json_links_and_aliases(self):
        path=self.save_plan();raw=path.read_bytes()
        base=[sys.executable,str(SCRIPTS/"bootstrap_journal.py"),"init","--plan",str(path),"--expected-bootstrap-digest",self.digest]
        for size,code in [(1048576,0),(1048577,2)]:
            path.write_bytes(raw+b" "*(size-len(raw)));state=self.root/("cap"+str(size))
            result=subprocess.run(base+["--state-root",str(state)],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,code);self.sanitized(result)
        for data in [b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":1e999}',b'\xff',b'['*2000+b']'*2000,b'{}garbage']:
            path.write_bytes(data);result=subprocess.run(base+["--state-root",str(self.state)],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,2);self.sanitized(result)
        path.write_bytes(raw)
        for alias in [str(self.root)+"/./plan.json",str(self.root)+"//plan.json","/"+str(path)]:
            args=list(base);args[args.index("--plan")+1]=alias
            result=subprocess.run(args+["--state-root",str(self.state)],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,2);self.sanitized(result)
        self.assertFalse(self.state.exists())

    def test_actual_cli_actions_private_bounds_help_indexes_and_no_effect_surface(self):
        result=self.cli("init");self.assertEqual(result.returncode,0);self.sanitized(result)
        for raw in ["-1","+1","01"," 1","1.0","9"*10000]:
            result=self.cli("record-intent","--phase-id","meet","--action-index",raw);self.assertEqual(result.returncode,2);self.sanitized(result)
        result=self.cli("record-intent","--phase-id","replicate","--action-index","2");self.assertEqual(result.returncode,0);self.assertEqual(self.sanitized(result)["intent_count"],1)
        result=self.cli("record-intent","--phase-id","replicate","--action-index","2");self.assertEqual(result.returncode,2);self.sanitized(result)
        for argv in [["--help"],["init","--help"],["resolve","secret-sentinel"],["--execute-approved"],["--credentials","secret-sentinel"]]:
            result=subprocess.run([sys.executable,str(SCRIPTS/"bootstrap_journal.py"),*argv],capture_output=True,text=True,timeout=5)
            self.assertEqual(result.returncode,0 if "--help" in argv else 2);self.sanitized(result)
        for name in ["dispatch","resolve","complete","reset","adopt","abandon","advance","retry"]:self.assertFalse(hasattr(journal,name))

    def test_no_runtime_collection_dispatch_or_old_state_apis(self):
        with patch.object(socket,"socket",side_effect=AssertionError("socket forbidden")),patch.object(subprocess,"Popen",side_effect=AssertionError("runtime forbidden")), \
             patch.object(collector,"collect",side_effect=AssertionError("collector forbidden")),patch.object(collector,"Transport",side_effect=AssertionError("transport forbidden")), \
             patch.object(labctl,"owned_scope",side_effect=AssertionError("old state forbidden")),patch.object(labctl,"atomic_write",side_effect=AssertionError("old write forbidden")):
            self.init();self.record();self.assertEqual(self.status()["journal_state"],"uncertain")


if __name__=="__main__":unittest.main()

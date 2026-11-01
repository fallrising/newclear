"""Real local subprocess oracles for the opt-in helper, never provider calls."""
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / "src/agent_workforce/native_reaper.py"
PROTOCOL = "subreaper-v1"


class NativeReaperTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.processes = []
        self.addCleanup(self.cleanup_processes)

    def cleanup_processes(self):
        for process in self.processes:
            if process.poll() is None:
                # A valid control lets an admitted helper reap its own children.
                self.write("stop.json", {"nonce": "a" * 32})
                try:
                    process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=2)
            for stream in (process.stdout, process.stderr):
                if stream:
                    stream.close()

    def write(self, name, value, mode=0o600):
        path = self.root / name
        data = json.dumps(value).encode() if not isinstance(value, bytes) else value
        temporary = self.root / (name + ".test-tmp")
        temporary.write_bytes(data)
        temporary.chmod(mode)
        temporary.replace(path)

    def start(self, code="pass", *, timeout=2, request_change=None):
        request = dict(operation_id="synthetic-operation", request_digest="b" * 64,
                       nonce="a" * 32, argv=[sys.executable, "-I", "-c", code],
                       cwd=str(self.root), timeout_seconds=timeout)
        if request_change:
            request.update(request_change)
        self.write("helper-request.json", request)
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        try:
            process = subprocess.Popen([sys.executable, "-I", str(SCRIPT), str(directory)],
                                       pass_fds=(directory,), stdin=subprocess.DEVNULL,
                                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        finally:
            os.close(directory)
        self.processes.append(process)
        return process

    def await_file(self, name, timeout=3):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            path = self.root / name
            if path.exists():
                return json.loads(path.read_text())
            if self.processes and self.processes[-1].poll() is not None:
                self.fail(f"helper exited before {name}: {self.processes[-1].returncode}")
            time.sleep(.005)
        self.fail(f"helper did not write {name}")

    def go(self):
        ready = self.await_file("helper-ready.json")
        self.assertEqual(set(ready), {"protocol", "operation_id", "request_digest", "nonce", "helper_identity"})
        self.assertEqual(ready["protocol"], PROTOCOL)
        self.assertEqual(ready["nonce"], "a" * 32)
        self.assertEqual(set(ready["helper_identity"]), {"pid", "start_ticks", "boot_id"})
        self.assertEqual(ready["helper_identity"]["pid"], self.processes[-1].pid)
        self.write("go.json", {"nonce": "a" * 32})
        return ready

    def closed(self, process, reason="exited", exit_code=0):
        output, error = process.communicate(timeout=5)
        self.assertEqual(process.returncode, 0, error)
        proof = json.loads((self.root / "closure.json").read_text())
        ready = json.loads((self.root / "helper-ready.json").read_text())
        self.assertEqual(set(proof), {"protocol", "operation_id", "request_digest", "nonce",
                                     "helper_identity", "admitted", "fork_gate_closed", "wait_echild",
                                     "leader_exit_code", "reason", "effects_resolved"})
        for key in ready:
            self.assertEqual(proof[key], ready[key])
        for flag in ("admitted", "fork_gate_closed", "wait_echild"):
            self.assertIs(proof[flag], True)
        self.assertIs(proof["effects_resolved"], False)
        self.assertEqual(proof["reason"], reason)
        self.assertIs(type(proof["leader_exit_code"]), int)
        self.assertEqual(proof["leader_exit_code"], exit_code)
        self.assertEqual(error, b"")
        return output

    def assert_gone(self, pid):
        self.assertFalse(Path(f"/proc/{pid}").exists(), f"owned child {pid} remains")

    def test_ready_precedes_payload_and_requires_go(self):
        process = self.start("open('payload', 'w').write('ran')")
        self.await_file("helper-ready.json")
        self.assertFalse((self.root / "payload").exists())
        self.assertFalse((self.root / "closure.json").exists())
        self.go()
        self.closed(process)
        self.assertEqual((self.root / "payload").read_text(), "ran")

    def test_missing_go_parent_receipt_gap_never_admits(self):
        process = self.start("open('payload', 'w').write('ran')")
        self.await_file("helper-ready.json")
        process.communicate(timeout=6)
        self.assertNotEqual(process.returncode, 0)
        self.assertFalse((self.root / "payload").exists())
        self.assertFalse((self.root / "closure.json").exists())

    def test_stdout_is_payload_only_and_spoof_is_not_proof(self):
        fake = '{"protocol":"subreaper-v1","wait_echild":true}'
        process = self.start(f"import sys; print({fake!r}); sys.exit(17)")
        self.go()
        self.assertEqual(self.closed(process, exit_code=17), (fake + "\n").encode())

    def test_exec_failure_is_admitted_and_reaped(self):
        process = self.start(request_change={"argv": [str(self.root / "missing-executable")]})
        self.go()
        self.closed(process, exit_code=127)

    def test_immediate_double_fork_setsid_detach_is_reaped(self):
        code = """import os,time
if os.fork():
    while not os.path.exists('detached-pid'): time.sleep(.001)
    os._exit(0)
os.setsid()
if os.fork():
    os._exit(0)
open('detached-pid','w').write(str(os.getpid()))
time.sleep(30)
"""
        process = self.start(code)
        self.go()
        self.closed(process)
        self.assert_gone(int((self.root / "detached-pid").read_text()))

    def test_nested_subreaper_adoption_reaches_kernel_echild(self):
        code = """import os,time,ctypes
if os.fork():
    while not os.path.exists('nested-ready'): time.sleep(.001)
    os._exit(0)
ctypes.CDLL(None).prctl(36,1,0,0,0)
if os.fork():
    while not os.path.exists('grandchild-pid'): time.sleep(.001)
    open('nested-ready','w').write(str(os.getpid()))
    time.sleep(30)
os.setsid()
open('grandchild-pid','w').write(str(os.getpid()))
time.sleep(30)
"""
        process = self.start(code)
        self.go()
        self.closed(process)
        self.assert_gone(int((self.root / "nested-ready").read_text()))
        self.assert_gone(int((self.root / "grandchild-pid").read_text()))

    def test_clone_parent_sibling_is_reaped(self):
        code = """import ctypes,os,time
libc=ctypes.CDLL(None, use_errno=True)
callback_type=ctypes.CFUNCTYPE(ctypes.c_int,ctypes.c_void_p)
@callback_type
def child(arg):
    os.setsid()
    open('clone-pid','w').write(str(os.getpid()))
    time.sleep(30)
    return 0
stack=ctypes.create_string_buffer(1024*1024)
pid=libc.clone(child,ctypes.c_void_p(ctypes.addressof(stack)+len(stack)),0x8000,None)
if pid < 0: os._exit(81)
while not os.path.exists('clone-pid'): time.sleep(.001)
"""
        process = self.start(code)
        self.go()
        self.closed(process)
        self.assert_gone(int((self.root / "clone-pid").read_text()))

    def test_timeout_kills_stubborn_leader_and_child(self):
        code = "import os,time,signal; signal.signal(signal.SIGTERM,signal.SIG_IGN); open('leader-pid','w').write(str(os.getpid())); os.fork(); time.sleep(30)"
        process = self.start(code, timeout=.15)
        self.go()
        self.closed(process, reason="timeout", exit_code=-signal.SIGKILL)
        self.assert_gone(int((self.root / "leader-pid").read_text()))

    def test_cancel_kills_tree(self):
        process = self.start("import os,time; open('started','w').write(str(os.getpid())); os.fork(); time.sleep(30)")
        self.go()
        deadline = time.monotonic() + 2
        while not (self.root / "started").exists() and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertTrue((self.root / "started").exists())
        self.write("stop.json", {"nonce": "a" * 32})
        self.closed(process, reason="cancelled", exit_code=-signal.SIGKILL)

    def test_mismatched_stop_reaps_but_does_not_publish_proof(self):
        process = self.start("import os,time; open('started','w').write(str(os.getpid())); time.sleep(30)")
        self.go()
        deadline = time.monotonic() + 2
        while not (self.root / "started").exists() and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertTrue((self.root / "started").exists())
        pid = int((self.root / "started").read_text())
        self.write("stop.json", {"nonce": "c" * 32})
        process.communicate(timeout=2)
        self.assertNotEqual(process.returncode, 0)
        self.assert_gone(pid)
        self.assertFalse((self.root / "closure.json").exists())

    def test_payload_has_no_journal_or_control_fds(self):
        code = """import os,json
result={}
for fd in os.listdir('/proc/self/fd'):
    if int(fd)>2:
        try: result[fd]=os.readlink('/proc/self/fd/'+fd)
        except FileNotFoundError: pass
print(json.dumps(result))
"""
        process = self.start(code)
        self.go()
        self.assertEqual(json.loads(self.closed(process)), {})

    def test_helper_crash_before_go_cannot_prove_or_spawn(self):
        process = self.start("open('payload','w').write('ran')")
        self.await_file("helper-ready.json")
        process.kill()
        process.communicate(timeout=2)
        self.assertFalse((self.root / "closure.json").exists())
        self.assertFalse((self.root / "payload").exists())

    def test_helper_crash_after_go_has_no_closure(self):
        process = self.start("import time; open('started','w').write('yes'); time.sleep(.15)")
        self.go()
        deadline = time.monotonic() + 2
        while not (self.root / "started").exists() and time.monotonic() < deadline:
            time.sleep(.005)
        self.assertTrue((self.root / "started").exists())
        # Become the orphan's reaper solely for this fixture, then restore it.
        libc = ctypes.CDLL(None, use_errno=True)
        previous = ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(previous), 0, 0, 0), 0)
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        try:
            process.kill()
            process.communicate(timeout=2)
            # The only orphan is the self-terminating synthetic payload.
            pid, _ = os.waitpid(-1, 0)
            self.assertGreater(pid, 0)
            self.assertFalse((self.root / "closure.json").exists())
        finally:
            libc.prctl(36, previous.value, 0, 0, 0)

    def test_parent_disappears_after_go_helper_still_closes(self):
        # Start through a throwaway launching parent; test adopts/reaps only the
        # helper, while the helper owns all payload waits.
        request = dict(operation_id="synthetic-operation", request_digest="b" * 64,
                       nonce="a" * 32, argv=[sys.executable, "-I", "-c", "import time; time.sleep(.1)"],
                       cwd=str(self.root), timeout_seconds=2)
        self.write("helper-request.json", request)
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        libc = ctypes.CDLL(None, use_errno=True)
        previous = ctypes.c_int()
        self.assertEqual(libc.prctl(37, ctypes.byref(previous), 0, 0, 0), 0)
        self.assertEqual(libc.prctl(36, 1, 0, 0, 0), 0)
        wrapper_code = """import os,sys,subprocess,time,json
from pathlib import Path
root=Path(sys.argv[3])
p=subprocess.Popen([sys.executable,'-I',sys.argv[1],sys.argv[2]],pass_fds=(int(sys.argv[2]),),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
while not (root/'helper-ready.json').exists(): time.sleep(.005)
temporary=root/'go.tmp'
fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
os.write(fd,json.dumps({'nonce':'a'*32}).encode());os.fsync(fd);os.close(fd)
temporary.replace(root/'go.json')
os._exit(0)
"""
        try:
            wrapper = subprocess.Popen([sys.executable, "-I", "-c", wrapper_code, str(SCRIPT),
                                        str(directory), str(self.root)], pass_fds=(directory,))
            self.assertEqual(wrapper.wait(timeout=3), 0)
            ready = json.loads((self.root / "helper-ready.json").read_text())
            helper = ready["helper_identity"]["pid"]
            deadline = time.monotonic() + 4
            while True:
                pid, status = os.waitpid(helper, os.WNOHANG)
                if pid:
                    break
                if time.monotonic() >= deadline:
                    self.fail("orphan helper did not finish")
                time.sleep(.005)
            self.assertEqual(os.waitstatus_to_exitcode(status), 0)
            proof = json.loads((self.root / "closure.json").read_text())
            self.assertEqual(proof["helper_identity"], ready["helper_identity"])
            self.assertIs(proof["wait_echild"], True)
            self.assertIs(proof["effects_resolved"], False)
        finally:
            os.close(directory)
            libc.prctl(36, previous.value, 0, 0, 0)

    def test_receipt_is_atomically_visible_as_private_single_link(self):
        specification = importlib.util.spec_from_file_location("fixture_reaper", SCRIPT)
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        original_unlink = os.unlink
        observed_links = []

        def observe_before_unlink(path, **kwargs):
            target = self.root / "receipt.json"
            if target.exists():
                observed_links.append(target.stat().st_nlink)
            return original_unlink(path, **kwargs)

        try:
            with mock.patch.object(module.os, "unlink", side_effect=observe_before_unlink):
                module._write(directory, "receipt.json", {"nonce": "a" * 32})
            self.assertTrue(all(count == 1 for count in observed_links), observed_links)
            self.assertEqual((self.root / "receipt.json").stat().st_nlink, 1)
        finally:
            os.close(directory)

    def test_failed_receipt_directory_sync_withdraws_publication(self):
        specification = importlib.util.spec_from_file_location("fault_reaper", SCRIPT)
        module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(module)
        directory = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY)
        original_fsync = os.fsync

        def fail_directory_sync(fd):
            if fd == directory:
                raise OSError("synthetic directory sync failure")
            return original_fsync(fd)

        try:
            with mock.patch.object(module.os, "fsync", side_effect=fail_directory_sync):
                with self.assertRaises(OSError):
                    module._write(directory, "closure.json", {"wait_echild": True})
            self.assertFalse((self.root / "closure.json").exists())
        finally:
            os.close(directory)

    def test_malformed_or_mismatched_go_never_admits(self):
        for value in ({"nonce": "c" * 32}, {"nonce": "a" * 32, "extra": True}, b'{"nonce":',
                      b'null', b'{"nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'):
            with self.subTest(value=value):
                process = self.start("open('payload','w').write('ran')")
                self.await_file("helper-ready.json")
                self.write("go.json", value)
                process.communicate(timeout=2)
                self.assertNotEqual(process.returncode, 0)
                self.assertFalse((self.root / "payload").exists())
                self.assertFalse((self.root / "closure.json").exists())
                for name in ("go.json", "helper-ready.json"):
                    (self.root / name).unlink(missing_ok=True)

    def test_unsafe_request_rejected_before_ready(self):
        for change in ({"nonce": "bad"}, {"timeout_seconds": True}, {"argv": ["relative"]}, {"extra": 1}):
            with self.subTest(change=change):
                process = self.start(request_change=change)
                process.communicate(timeout=2)
                self.assertNotEqual(process.returncode, 0)
                self.assertFalse((self.root / "helper-ready.json").exists())
                self.assertFalse((self.root / "closure.json").exists())

    def test_link_nonprivate_and_oversized_go_rejected(self):
        for kind in ("symlink", "hardlink", "nonprivate", "oversized"):
            with self.subTest(kind=kind):
                process = self.start("open('payload','w').write('ran')")
                self.await_file("helper-ready.json")
                self.write("control-target", {"nonce": "a" * 32})
                if kind == "symlink":
                    (self.root / "go.json").symlink_to("control-target")
                elif kind == "hardlink":
                    os.link(self.root / "control-target", self.root / "go.json")
                else:
                    self.write("go.json", b" " * 65537 if kind == "oversized" else {"nonce": "a" * 32},
                               mode=0o644 if kind == "nonprivate" else 0o600)
                process.communicate(timeout=2)
                self.assertNotEqual(process.returncode, 0)
                self.assertFalse((self.root / "payload").exists())
                self.assertFalse((self.root / "closure.json").exists())
                for name in ("go.json", "helper-ready.json", "control-target"):
                    (self.root / name).unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()

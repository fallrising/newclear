"""Private M7 same-process delegation; never a generic Process replacement."""
import ctypes
import errno
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import re
import secrets
import select
import signal
import socket
import subprocess
import sys
import threading
import time

import lab
from trial_state import StateDirectory, decode_message, encode_message, validate_scope, validate_manifest, _parse

TRIAL_PATH = Path(__file__).with_name('trial.py')
COMMANDS = frozenset(('init', 'serve', 'status', 'submit', 'read', 'workflow',
                      'approve', 'stop', 'destroy'))
REASONS = frozenset(('protocol', 'ownership', 'deadline', 'cancelled', 'children',
                     'waiter', 'output', 'evidence', 'command'))
MAX_FRAME = 4096


class SupervisionError(Exception):
    def __init__(self, reason='protocol'):
        self.reason = reason if reason in REASONS else 'protocol'
        super().__init__(self.reason)


def require(value, reason='protocol'):
    if not value:
        raise SupervisionError(reason)


def integer(value, lower=0, upper=2**63-1):
    return type(value) is int and lower <= value <= upper


def unique(pairs):
    out = {}
    for key, value in pairs:
        require(key not in out)
        out[key] = value
    return out


def validate_frame(value):
    require(type(value) is dict)
    common = {'version', 'kind', 'seq', 'pid', 'start', 'deadline_ns'}
    kind = value.get('kind')
    extra = {'READY': set(), 'ADMIT': set(), 'ACK': {'closure'},
             'CLOSED': {'exit_code', 'reaped', 'commit', 'closure'},
             'CANCEL': {'reason'}, 'ABORT': {'reason'}}
    require(type(kind) is str and kind in extra and set(value) == common | extra[kind])
    require(type(value['version']) is int and value['version'] == 1)
    require(integer(value['pid'], 1, 2**31-1) and integer(value['start'])
            and integer(value['deadline_ns'], 1) and integer(value['seq'], 0, 3))
    expected = {'READY': 0, 'ADMIT': 1, 'CLOSED': 2, 'ACK': 3}
    require(kind not in expected or value['seq'] == expected[kind])
    if kind == 'CLOSED':
        require(integer(value['exit_code'], 0, 1) and integer(value['reaped'], 0, 1024))
        require(value['commit'] is None or (type(value['commit']) is str
                and re.fullmatch('[0-9a-f]{64}', value['commit']) is not None))
    if kind in ('CLOSED', 'ACK'):
        require(type(value['closure']) is str
                and re.fullmatch('[0-9a-f]{32}', value['closure']) is not None)
    if kind in ('ABORT', 'CANCEL'):
        require(type(value['reason']) is str and value['reason'] in REASONS)
    return value


class Channel:
    def __init__(self, connection, deadline):
        require(math.isfinite(deadline) and deadline > time.monotonic(), 'deadline')
        require(connection.family == socket.AF_UNIX
                and connection.type & socket.SOCK_SEQPACKET == socket.SOCK_SEQPACKET)
        self.socket, self.deadline = connection, deadline
        connection.set_inheritable(False)

    def remaining(self, deadline=None):
        left = min(self.deadline, self.deadline if deadline is None else deadline) - time.monotonic()
        require(left > 0, 'deadline')
        return left

    def send(self, value, deadline=None):
        validate_frame(value)
        raw = json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
        require(len(raw) <= MAX_FRAME)
        self.socket.settimeout(self.remaining(deadline))
        require(self.socket.send(raw) == len(raw))

    def receive(self, deadline=None):
        self.socket.settimeout(self.remaining(deadline))
        raw, _, flags, _ = self.socket.recvmsg(MAX_FRAME)
        require(raw and not flags & socket.MSG_TRUNC)
        try:
            value = json.loads(raw, object_pairs_hook=unique,
                               parse_constant=lambda _: require(False))
        except (UnicodeError, ValueError, RecursionError):
            raise SupervisionError() from None
        return validate_frame(value)

    def close(self):
        self.socket.close()


def identity(pid):
    value = lab.process_info(pid)
    require(value is not None and value['state'] != 'Z', 'ownership')
    return {'pid': value['pid'], 'start': value['start_ticks']}


class Sigaction(ctypes.Structure):
    _fields_ = [('handler', ctypes.c_void_p), ('mask', ctypes.c_ulong * 16),
                ('flags', ctypes.c_int), ('restorer', ctypes.c_void_p)]


def checked_libc():
    require(sys.platform == 'linux' and platform.machine() == 'x86_64'
            and ctypes.sizeof(ctypes.c_void_p) == 8 and ctypes.sizeof(Sigaction) == 152
            and Sigaction.mask.offset == 8 and Sigaction.flags.offset == 136
            and Sigaction.restorer.offset == 144, 'ownership')
    libc = ctypes.CDLL(None, use_errno=True)
    require(hasattr(libc, 'gnu_get_libc_version'), 'ownership')
    libc.gnu_get_libc_version.restype = ctypes.c_char_p
    version = libc.gnu_get_libc_version()
    require(type(version) is bytes and len(version) <= 32
            and re.fullmatch(rb'2\.[0-9]+(?:\.[0-9]+)?', version) is not None, 'ownership')
    return libc


def checked_signal_policy():
    """Read Linux x86_64 libc policy, not just Python's cached handler object."""
    libc = checked_libc()
    action = Sigaction()
    require(libc.sigaction(signal.SIGCHLD, None, ctypes.byref(action)) == 0, 'ownership')
    require(action.handler is None and not action.flags & 2
            and signal.getsignal(signal.SIGCHLD) == signal.SIG_DFL, 'ownership')


def kernel_setup():
    # Called only in the freshly exec'd opted-in trial, never in the parent.
    require(threading.current_thread() is threading.main_thread(), 'waiter')
    libc = checked_libc()
    signal.signal(signal.SIGCHLD, signal.SIG_DFL)
    checked_signal_policy()
    enabled = ctypes.c_int()
    require(libc.prctl(36, 1, 0, 0, 0) == 0
            and libc.prctl(37, ctypes.byref(enabled), 0, 0, 0) == 0
            and enabled.value == 1, 'ownership')
    try:
        os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
    except ChildProcessError as exc:
        require(exc.errno == errno.ECHILD, 'ownership')
    else:
        raise SupervisionError('children')


def dirty_binding(state):
    state.check()
    raw, manifest_identity = state._read()
    value = validate_manifest(_parse(raw))
    require(value['clean'] is False and value['identity'] is not None, 'evidence')
    require(value['workflow'] is None or value['workflow']['phase'] != 'reserved', 'evidence')
    binding = {'manifest': hashlib.sha256(raw).hexdigest(),
               'manifest_identity': manifest_identity,
               'root': state._root_identity, 'lock': state._lock_identity,
               'lock_change_ns': os.fstat(state._lock_fd).st_ctime_ns,
               'trial': value['trial_id'], 'scope': value['scope']}
    return hashlib.sha256(json.dumps(binding, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def commit_clean(path, digest):
    """Called only after exact owner exit/output proof; never by a stop client."""
    with StateDirectory(Path(path)) as state:
        require(dirty_binding(state) == digest, 'evidence')
        value = state.load()
        # validate_scope is read-only and requires a proposed clean projection.
        proposed = dict(value, clean=True)
        scope = validate_scope(proposed)
        scope.check_owner()
        require(dirty_binding(state) == digest, 'evidence')
        state.save(proposed)


def validate_pending_terminal(value):
    require(type(value) is dict and set(value) ==
            {'schema_version', 'command', 'result', 'error', 'data'})
    require(type(value['schema_version']) is int and value['schema_version'] == 1)
    require(type(value['command']) is str and value['command'] == 'serve'
            and type(value['result']) is str and value['result'] == 'passed'
            and value['error'] is None)
    data = value['data']
    require(type(data) is dict and set(data) == {'stopped', 'clean_pending'}
            and type(data['stopped']) is bool and data['stopped'] is True
            and type(data['clean_pending']) is bool and data['clean_pending'] is True)
    return value


class OwnerControl:
    def __init__(self, fd, deadline_ns):
        require(integer(fd, 3, 2**31-1) and integer(deadline_ns, 1))
        self.channel = Channel(socket.socket(fileno=fd), deadline_ns / 1e9)
        self.deadline_ns = deadline_ns
        self.identity = identity(os.getpid())
        self.cancelled = threading.Event()
        self.ack = threading.Event()
        self.stopping = threading.Event()
        self.closed = False
        self.pending = None
        self.registry = []
        self.uncertain = False
        self.listener = None
        self.phase_lock = threading.Lock()
        self.awaiting_ack = False
        self.closure_nonce = None
        self.launching = False
        kernel_setup()
        self.channel.send(self.frame('READY', 0))
        admit = self.channel.receive()
        self.check(admit)
        require(admit['kind'] == 'ADMIT', 'cancelled')
        self.install_registry()
        self.listener = threading.Thread(target=self.listen, daemon=True)
        self.listener.start()

    def frame(self, kind, seq, **extra):
        return dict(version=1, kind=kind, seq=seq, **self.identity,
                    deadline_ns=self.deadline_ns, **extra)

    def check(self, frame):
        require(all(frame[k] == v for k, v in self.identity.items())
                and frame['deadline_ns'] == self.deadline_ns)

    def install_registry(self):
        owner = self
        original = subprocess.Popen
        class RegisteredPopen(original):
            def __init__(self, *args, **kwargs):
                owner.launch_check()
                require(len(owner.registry) < 1024, 'children')
                require(kwargs.get('close_fds', True) is True
                        and owner.channel.socket.fileno() not in kwargs.get('pass_fds', ()), 'ownership')
                owner.launching = True
                try:
                    super().__init__(*args, **kwargs)
                finally:
                    owner.launching = False
                owner.registry.append(self)
            def wait(self, *args, **kwargs):
                owner.wait_check()
                return super().wait(*args, **kwargs)
            def poll(self, *args, **kwargs):
                owner.wait_check()
                return super().poll(*args, **kwargs)
        subprocess.Popen = RegisteredPopen
        def audit(event, _args):
            if event in ('subprocess.Popen', 'os.fork', 'os.forkpty', 'os.posix_spawn'):
                owner.launch_check()
                if event != 'subprocess.Popen' and not owner.launching:
                    owner.uncertain = True
                    raise SupervisionError('children')
        sys.addaudithook(audit)

    def launch_check(self):
        if self.closed or self.cancelled.is_set() or threading.current_thread() is not threading.main_thread():
            self.uncertain = True
            raise SupervisionError('waiter')

    def wait_check(self):
        if threading.current_thread() is not threading.main_thread():
            self.uncertain = True
            raise SupervisionError('waiter')

    def listen(self):
        try:
            message = self.channel.receive()
            self.check(message)
            with self.phase_lock:
                if (message['kind'] == 'ACK' and self.awaiting_ack
                        and message['closure'] == self.closure_nonce):
                    self.ack.set()
                    return
                require(message['kind'] == 'CANCEL'
                        and message['seq'] == (3 if self.awaiting_ack else 2))
        except Exception:
            if self.stopping.is_set():
                return
        self.cancelled.set()
        # Self-only interruption reaches the existing owner cleanup handlers.
        os.kill(os.getpid(), signal.SIGTERM)

    def prepare_clean(self, state):
        require(not self.cancelled.is_set(), 'cancelled')
        self.pending = dirty_binding(state)

    def begin_cleanup(self, deadline):
        require(type(deadline) in (int, float) and math.isfinite(deadline), 'deadline')
        self.channel.deadline = min(self.channel.deadline, deadline)
        self.channel.remaining()

    def collect(self):
        self.closed = True
        require(not self.uncertain and not self.cancelled.is_set(), 'cancelled')
        checked_signal_policy()
        enabled = ctypes.c_int()
        require(checked_libc().prctl(37, ctypes.byref(enabled), 0, 0, 0) == 0
                and enabled.value == 1, 'ownership')
        require(all(p.returncode is not None for p in self.registry), 'waiter')
        require(all(stream is None or stream.closed for p in self.registry
                    for stream in (p.stdin, p.stdout, p.stderr)), 'waiter')
        for thread in threading.enumerate():
            if thread is not threading.main_thread() and thread is not self.listener:
                thread.join(timeout=min(2, self.channel.remaining()))
                require(not thread.is_alive(), 'waiter')
        reaped = 0
        while True:
            require(not self.cancelled.is_set(), 'cancelled')
            self.channel.remaining()
            try:
                child = os.waitid(os.P_ALL, 0, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            except ChildProcessError as exc:
                require(exc.errno == errno.ECHILD, 'ownership')
                return reaped
            if child is None:
                time.sleep(min(.01, self.channel.remaining()))
                continue
            require(reaped < 1024, 'children')
            # Kernel wait ownership pins the exited generation until this reap.
            require(child.si_pid > 0, 'ownership')
            waited, _ = os.waitpid(child.si_pid, 0)
            require(waited == child.si_pid, 'waiter')
            reaped += 1

    def finish(self, response):
        encode_message(response)
        reaped = self.collect()
        self.closure_nonce = secrets.token_hex(16)
        passed = response['result'] == 'passed'
        commit = self.pending if passed and response['command'] in ('init', 'serve') else None
        require(not (passed and response['command'] in ('init', 'serve')) or commit is not None, 'evidence')
        with self.phase_lock:
            self.channel.send(self.frame('CLOSED', 2, exit_code=0 if passed else 1,
                                         reaped=reaped, commit=commit, closure=self.closure_nonce))
            self.awaiting_ack = True
        require(self.ack.wait(self.channel.remaining()) and not self.cancelled.is_set(), 'cancelled')
        self.listener.join(timeout=min(2, self.channel.remaining()))
        require(not self.listener.is_alive(), 'waiter')
        if response['command'] == 'serve' and passed:
            response = dict(response, data={'stopped': True, 'clean_pending': True})
        return response

    def abort(self, reason):
        self.closed = True
        try:
            self.channel.send(self.frame('ABORT', 2, reason=reason if reason in REASONS else 'command'))
        except Exception:
            pass

    def close(self):
        self.stopping.set()
        try:
            self.channel.socket.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        if self.listener is not None:
            self.listener.join(timeout=2)
        self.channel.close()


class SupervisedCapture:
    """M7-private direct Popen plus explicit delegated completion, no live API."""
    def __init__(self, argv, *, deadline, state):
        require(len(argv) >= 3 and argv[0] == sys.executable
                and Path(argv[1]) == TRIAL_PATH and argv[2] in COMMANDS)
        self.command, self.state = argv[2], Path(state)
        self.deadline = deadline
        self.deadline_ns = int(deadline * 1e9)
        self.cancelled = False
        self.finished = False
        self.clean_committed = False
        self.closure = None
        self.observation_error = None
        self.observation_reason = None
        self.tail = bytearray()
        self.output_bytes = 0
        self.lock = threading.Lock()
        self.state_lock = threading.RLock()
        self.stop_reading = threading.Event()
        left, right = socket.socketpair(socket.AF_UNIX, socket.SOCK_SEQPACKET)
        left.set_inheritable(False)
        right.set_inheritable(False)
        self.process = None
        self.reader = None
        try:
            self.channel = Channel(left, deadline)
            self.process = subprocess.Popen([*argv, '--supervision-fd', str(right.fileno()),
                                              '--supervision-deadline-ns', str(self.deadline_ns)],
                                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, close_fds=True,
                                            pass_fds=(right.fileno(),), start_new_session=True)
            self.identity = identity(self.process.pid)
            os.set_blocking(self.process.stdout.fileno(), False)
            self.reader = threading.Thread(target=self._read, daemon=True)
            self.reader.start()
        except BaseException:
            left.close()
            if self.process is not None:
                try:
                    if self.process.poll() is None:self.process.terminate()
                    self.process.wait(timeout=2)
                except subprocess.TimeoutExpired:
                    self.process.kill();self.process.wait(timeout=2)
                finally:
                    self.process.stdout.close()
            raise
        finally:
            right.close()
        self.admitted = False

    def frame(self, kind, seq, **extra):
        return dict(version=1, kind=kind, seq=seq, **self.identity,
                    deadline_ns=self.deadline_ns, **extra)

    def check(self, frame):
        require(all(frame[k] == v for k, v in self.identity.items())
                and frame['deadline_ns'] == self.deadline_ns)

    def alive(self):
        require(identity(self.process.pid) == self.identity, 'ownership')
        require(self.process.returncode is None, 'ownership')

    def _read(self):
        try:
            descriptor = self.process.stdout.fileno()
            while not self.stop_reading.is_set():
                if not select.select([descriptor], [], [], .05)[0]:continue
                try:chunk = os.read(descriptor, 4096)
                except BlockingIOError:continue
                if not chunk:return
                with self.lock:
                    self.output_bytes += len(chunk)
                    if self.output_bytes > lab.LOG_LIMIT:
                        self.observation_error = 'bounded command output exceeded'
                    self.tail.extend(chunk)
                    del self.tail[:-lab.LOG_LIMIT]
            self.observation_error = 'command output drain incomplete'
        except Exception:
            self.observation_error = 'command output read failed'

    def text(self):
        with self.lock:
            return bytes(self.tail).decode(errors='replace')

    def ready(self, deadline=None):
        require(not self.cancelled, 'cancelled')
        if not self.admitted:
            message = self.channel.receive(deadline)
            self.check(message)
            require(message['kind'] == 'READY')
            self.alive()
            self.channel.send(self.frame('ADMIT', 1), deadline)
            self.admitted = True
        self.alive()
        require(not self.observation_error, 'output')
        return True

    def completion(self, expected='passed', *, deadline=None):
        if self.finished:
            require(not self.cancelled, 'cancelled')
            return self.response
        if deadline is not None:
            self.channel.deadline = min(self.channel.deadline, self.deadline, deadline)
        self.ready()
        closed = self.channel.receive()
        self.check(closed)
        require(closed['kind'] == 'CLOSED')
        self.alive()
        require(not self.cancelled, 'cancelled')
        self.channel.send(self.frame('ACK', 3, closure=closed['closure']))
        self.closure = closed
        self.process.wait(timeout=self.channel.remaining())
        self.reader.join(timeout=min(2, self.channel.remaining()))
        require(not self.reader.is_alive() and not self.observation_error, 'output')
        self.process.stdout.close()
        self.channel.socket.settimeout(self.channel.remaining())
        require(self.channel.socket.recv(1) == b'')
        require(self.process.returncode == closed['exit_code']
                and self.process.returncode == (0 if expected == 'passed' else 1), 'command')
        lines = self.text().splitlines(keepends=True)
        require(len(lines) == (2 if self.command == 'serve' and expected == 'passed' else 1), 'output')
        if self.command == 'serve' and expected == 'passed':
            require(decode_message(lines[0].encode()) == {
                'schema_version': 1, 'command': 'serve', 'result': 'passed',
                'error': None, 'data': {'ready': True}})
            try:
                value = json.loads(lines[1], object_pairs_hook=unique)
            except (ValueError, RecursionError):
                raise SupervisionError('protocol') from None
            validate_pending_terminal(value)
        else:
            value = decode_message(lines[0].encode())
        require(value['command'] == self.command and value['result'] == expected, 'command')
        require(not self.cancelled, 'cancelled')
        needs_commit = expected == 'passed' and self.command in ('init', 'serve')
        require((closed['commit'] is not None) == needs_commit, 'evidence')
        with self.state_lock:
            require(not self.cancelled, 'cancelled')
            if needs_commit:
                commit_clean(self.state, closed['commit'])
                self.clean_committed = True
        self.response = value
        self.finished = True
        self.channel.close()
        return value

    def cancel(self, deadline):
        with self.state_lock:
            self.cancelled = True
        self.channel.deadline = min(self.channel.deadline, self.deadline, deadline)
        if not self.finished:
            try:
                self.alive()
                self.channel.send(self.frame('CANCEL', 3 if self.closure is not None else
                                             2 if self.admitted else 1, reason='cancelled'))
            except Exception:
                pass
            try:
                self.process.wait(timeout=max(.001, self.channel.remaining()))
            except Exception:
                # Containment of the exact unreaped direct child is not closure.
                try:
                    self.alive()
                    os.kill(self.identity['pid'], signal.SIGKILL)
                    self.process.wait(timeout=2)
                except Exception:
                    pass
            self.process.poll()  # Reap an exited own child even if alive() refused Z.
            self.stop_reading.set()
            self.reader.join(timeout=2)
            if not self.reader.is_alive():
                self.process.stdout.close()
            self.channel.close()
        return False

"""Opt-in local descendant closure through a dedicated Linux subreaper.

Private cooperating same-UID journals are trusted, not a hostile-user sandbox.
Old polling operations retain their original unknown stop semantics. Neither
kernel descendant closure nor a native terminal resolves external effects.
"""
import hashlib
import json
import os
from pathlib import Path
import selectors
import subprocess
import sys
import time
import uuid

from .native_process import (ProcessError, ProcessSupervisor, _boot, _identity,
                             _json, _operation, _private)
from .native_stop_proof import StopProofError, validate_closure


class ReapingProcessSupervisor(ProcessSupervisor):
    """Durable one-shot admission and bounded proof-preserving reconciliation."""

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()

    def _read(self, fd, name):
        # Nonblocking open rejects FIFOs/devices before a read can block.
        try:
            source = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK,
                             dir_fd=fd)
        except FileNotFoundError:
            return None
        try:
            _private(source)
            with os.fdopen(source, 'rb', closefd=False) as stream:
                raw = stream.read(65537)
            if len(raw) > 65536:
                raise ProcessError('oversized journal')
            def pairs(items):
                result = {}
                for key, value in items:
                    if key in result:
                        raise ProcessError('duplicate journal key')
                    result[key] = value
                return result
            value = json.loads(raw, object_pairs_hook=pairs)
            _json(value)
            if type(value) is not dict:
                raise ProcessError('invalid journal record')
            return value
        except (ValueError, UnicodeError, RecursionError) as exc:
            raise ProcessError('invalid journal record') from exc
        finally:
            os.close(source)

    def _request(self, *args):
        request = super()._request(*args)
        helper = Path(__file__).with_name('native_reaper.py').resolve()
        interpreter = Path(sys.executable).resolve()
        request['containment'] = dict(protocol='subreaper-v1', helper=str(helper),
                                     helper_sha256=hashlib.sha256(helper.read_bytes()).hexdigest(),
                                     interpreter=str(interpreter),
                                     interpreter_sha256=hashlib.sha256(interpreter.read_bytes()).hexdigest())
        return json.loads(_json(request))

    @staticmethod
    def _descriptor(intent):
        request = intent['request']
        return dict(operation_id=intent['operation_id'],
                    request_digest=hashlib.sha256(_json(request)).hexdigest(),
                    nonce=intent['nonce'], argv=request['argv'], cwd=request['cwd'],
                    timeout_seconds=request['timeout_seconds'])

    def _checked(self, fd, operation_id):
        intent, record = self._record(fd, operation_id)
        # A mutable state bit is never the stop oracle. Revalidate the separate
        # helper receipt against all durable admission records on every read.
        record.update(stopped=False, containment_proof=None, effects_resolved=False)
        if intent is None or intent['request'].get('containment', {}).get('protocol') != 'subreaper-v1':
            return record
        descriptor = self._descriptor(intent)
        ready = self._read(fd, 'helper-ready.json')
        if (self._read(fd, 'helper-request.json') != descriptor or ready is None
                or set(ready) != {'protocol', 'operation_id', 'request_digest', 'nonce', 'helper_identity'}
                or any(ready.get(key) != descriptor[key] for key in ('operation_id', 'request_digest', 'nonce'))
                or ready.get('protocol') != 'subreaper-v1'
                or ready.get('helper_identity') != record.get('helper_identity')
                or self._read(fd, 'go.json') != {'nonce': intent['nonce']}):
            record['status'] = 'unknown'
            return record
        proof = self._read(fd, 'closure.json')
        if proof is not None:
            try:
                proof = validate_closure(proof, operation_id=operation_id,
                                         request_digest=descriptor['request_digest'],
                                         nonce=intent['nonce'], helper_identity=ready['helper_identity'])
            except StopProofError:
                record['status'] = 'unknown'
                return record
            # Independently make the observed receipt durable; merely observing
            # a rename cannot prove the helper completed its directory fsync.
            source = os.open('closure.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
            try:
                _private(source)
                os.fsync(source)
                os.fsync(fd)
            finally:
                os.close(source)
            record.update(stopped=True, leader_stopped=True, status='exited',
                          exit_code=proof['leader_exit_code'], containment_proof=proof,
                          timed_out=record['timed_out'] or proof['reason'] == 'timeout')
            return record
        owner = ready['helper_identity']
        try:
            current = _identity(owner['pid'])
            live = (owner['boot_id'] == _boot() and current is not None
                    and current['start_ticks'] == owner['start_ticks'] and current['state'] != 'Z')
        except (ProcessError, KeyError, TypeError):
            live = False
        record['status'] = 'running' if live else 'unknown'
        return record

    def inspect(self, operation_id):
        _operation(operation_id)
        with self._locked(), self._directory(operation_id) as (fd, _):
            if fd is None:
                return self._base(operation_id)
            try:
                return self._checked(fd, operation_id)
            except (ProcessError, OSError, KeyError, TypeError, ValueError):
                # Fail closed: malformed/mismatched receipts never authorize a
                # stop signal, native session adoption or capacity release.
                return self._base(operation_id)

    def stop(self, operation_id):
        with self._locked(), self._directory(operation_id) as (fd, _):
            if fd is None:
                return self._base(operation_id)
            try:
                record = self._checked(fd, operation_id)
                if record['stopped'] or record['status'] != 'running':
                    return record
                intent = self._read(fd, 'intent.json')
                self._write(fd, 'stop.json', {'nonce': intent['nonce']})
                # No signals from a reopened caller. Only the original helper
                # consumes its nonce-bound request and signals its own children.
            except (ProcessError, OSError, KeyError, TypeError, ValueError):
                return self._base(operation_id)
        deadline = time.monotonic() + 1.5
        while time.monotonic() < deadline:
            record = self.inspect(operation_id)
            if record['stopped'] or record['status'] != 'running':
                return record
            time.sleep(.01)
        return record

    def execute(self, operation_id, argv, cwd, *, binding, timeout_seconds,
                max_output_bytes=2097152):
        _operation(operation_id)
        request = self._request(argv, cwd, binding, timeout_seconds, max_output_bytes)
        process = None
        streams = {}
        selector = selectors.DefaultSelector()
        admitted = False
        try:
            with self._locked(), self._directory(operation_id, create=True) as (fd, created):
                if not created:
                    intent, _ = self._record(fd, operation_id)
                    if intent is None or _json(intent['request']) != _json(request):
                        raise ProcessError('immutable process request conflict; never respawn')
                    return self._checked(fd, operation_id)
                intent = dict(operation_id=operation_id, request=request, nonce=uuid.uuid4().hex)
                self._write(fd, 'intent.json', intent, exclusive=True)
                descriptor = self._descriptor(intent)
                self._write(fd, 'helper-request.json', descriptor, exclusive=True)
                for name in ('stdout', 'stderr'):
                    output = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                     0o600, dir_fd=fd)
                    streams[name] = os.fdopen(output, 'wb')
                os.fsync(fd)
                self._check_fault('after_intent')
                mechanism = request['containment']
                process = subprocess.Popen([mechanism['interpreter'], '-I', mechanism['helper'], str(fd)],
                                           cwd=request['cwd'], stdin=subprocess.DEVNULL,
                                           stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                           pass_fds=(fd,), start_new_session=True)
                self._check_fault('after_spawn')
                start = time.monotonic()
                ready = None
                while time.monotonic() - start < 4:
                    ready = self._read(fd, 'helper-ready.json')
                    if ready is not None or process.poll() is not None:
                        break
                    time.sleep(.005)
                current = _identity(process.pid)
                owner = (dict(pid=process.pid, start_ticks=current['start_ticks'], boot_id=_boot())
                         if current is not None else None)
                expected = {key: descriptor[key] for key in ('operation_id', 'request_digest', 'nonce')}
                expected.update(protocol='subreaper-v1', helper_identity=owner)
                if owner is None or ready != expected:
                    raise ProcessError('helper bootstrap ownership unavailable')
                record = self._base(operation_id, request['binding'])
                record.update(status='running', helper_identity=owner)
                self._write(fd, 'state.json', record)
                self._check_fault('before_go')
                # A failed go fsync may still have made go visible. From this
                # point cleanup must preserve the helper and request closure.
                admitted = True
                self._write(fd, 'go.json', {'nonce': intent['nonce']}, exclusive=True)
                self._check_fault('after_go')
            for name, pipe in (('stdout', process.stdout), ('stderr', process.stderr)):
                os.set_blocking(pipe.fileno(), False)
                selector.register(pipe, selectors.EVENT_READ, name)
            written = 0
            limited = False
            deadline = time.monotonic() + request['timeout_seconds'] + 2
            while selector.get_map() or process.poll() is None:
                if time.monotonic() >= deadline:
                    self.stop(operation_id)
                    break
                for key, _ in selector.select(.01):
                    try:
                        data = os.read(key.fileobj.fileno(), 65536)
                    except BlockingIOError:
                        continue
                    if not data:
                        selector.unregister(key.fileobj)
                        key.fileobj.close()
                        continue
                    remaining = request['max_output_bytes'] - written
                    captured = data[:remaining]
                    streams[key.data].write(captured)
                    written += len(captured)
                    if len(data) > remaining and not limited:
                        limited = True
                        self._update(operation_id, output_limited=True)
                        self.stop(operation_id)
                if not selector.get_map():
                    time.sleep(.005)
            for stream in streams.values():
                stream.flush()
                os.fsync(stream.fileno())
            record = self.inspect(operation_id)
            # Output files and proof are persisted independently; no process
            # exit code can fabricate closure if the proof is absent.
            return record
        except BaseException:
            if process is not None:
                if admitted:
                    self.stop(operation_id)
                else:
                    # Before go there is no admitted payload. Terminate only
                    # this held unreaped helper, never an old PID from a file.
                    if process.poll() is None:
                        process.kill()
                try:
                    process.wait(timeout=1.6)
                except subprocess.TimeoutExpired:
                    pass
            raise
        finally:
            selector.close()
            for stream in streams.values():
                stream.close()
            if process is not None:
                for pipe in (process.stdout, process.stderr):
                    if pipe is not None:
                        pipe.close()

#!/usr/bin/env python3
"""Prepare or run one native Office/Pi synthetic task with a bounded DeepSeek relay."""
import argparse
from execution_slot import guarded_main, mark_started, mark_clean
import datetime
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import re
import signal
import stat
from contextlib import contextmanager
import subprocess
import sys
import time
from deepseek_relay import Relay, MAX_REQUESTS, MAX_OUTPUT, MAX_BODY
from remote_cli import LAB, isolated_env, private_directory, probe, write_new_private
import pi_retry
from pi_hook_evidence import verify_hook_boundary
from process_ownership import process_table, collect_owned, alive_owned, crash_owned, terminate_owned


QUESTION_RESPONSES = [
    {'index': 0, 'input': 'deny', 'ui_result': False},
    {'index': 1, 'input': 'allow', 'ui_result': True},
    {'index': 2, 'input': 'timeout', 'ui_result': False},
]
QUESTION_EVENT_TYPES = ['detector_installed', 'confirm_start', 'confirm_result', 'confirm_start',
                        'confirm_result', 'marker_written', 'confirm_start', 'confirm_result',
                        'command_complete', 'command_rejected']


def _json_no_duplicates(data):
    def hook(pairs):
        obj = {}
        for key, value in pairs:
            if key in obj:
                raise ValueError('duplicate JSON key')
            obj[key] = value
        return obj
    return json.loads(data, object_pairs_hook=hook)


@contextmanager
def _question_directory(path):
    """Pin every path component; the run directory itself must be private."""
    absolute = Path(path).absolute()
    fd = os.open(absolute.anchor, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in absolute.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        _private_directory_fd(fd)
        yield fd
    finally:
        os.close(fd)


def _private_directory_fd(fd):
    st = os.fstat(fd)
    if not stat.S_ISDIR(st.st_mode) or st.st_uid != os.getuid() or st.st_mode & 0o077:
        raise ValueError('unsafe question directory')


def _safe_file_bytes(directory_fd, name, limit):
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=directory_fd)
    with os.fdopen(fd, 'rb') as stream:
        st = os.fstat(stream.fileno())
        if (not stat.S_ISREG(st.st_mode) or st.st_nlink != 1 or st.st_uid != os.getuid()
                or st.st_mode & 0o077 or st.st_size > limit):
            raise ValueError('unsafe question artifact')
        data = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
        if len(data) > limit or (st.st_size, st.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError('changed or oversized question artifact')
        return data


def _question_artifacts(out):
    with _question_directory(out) as run_fd:
        qfd = os.open('question', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=run_fd)
        try:
            _private_directory_fd(qfd)
            if os.listdir(qfd) != ['allow-marker.json']:
                raise ValueError('unexpected question artifact')
            marker = _safe_file_bytes(qfd, 'allow-marker.json', 512)
        finally:
            os.close(qfd)
        wfd = os.open('workspace', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=run_fd)
        try:
            _private_directory_fd(wfd)
            try:
                os.stat('result.json', dir_fd=wfd, follow_symlinks=False)
            except FileNotFoundError:
                pass
            else:
                raise ValueError('unexpected task artifact')
        finally:
            os.close(wfd)
        events = _safe_file_bytes(run_fd, 'question-events.jsonl', 64 * 1024)
        pi_events = _safe_file_bytes(run_fd, 'pi-events.jsonl', 64 * 1024)
        return marker, events, pi_events


def _strict_responses(value):
    if type(value) is not list or len(value) != len(QUESTION_RESPONSES):
        return False
    for got, expected in zip(value, QUESTION_RESPONSES):
        if type(got) is not dict or set(got) != {'index', 'input', 'ui_result'}:
            return False
        if type(got.get('index')) is not int or type(got.get('input')) is not str or type(got.get('ui_result')) is not bool:
            return False
        if got != expected:
            return False
    return True


def verify_question(office, relay_summary, out, nonce):
    try:
        out = Path(out)
        if type(office) is not dict or type(relay_summary) is not dict or type(nonce) is not str or not re.fullmatch(r'[0-9a-f]{32}', nonce):
            return False
        session = office.get('session_id')
        if not isinstance(session, str) or not session:
            return False
        expected_office = {
            'provider': 'pi', 'model': 'deepseek/deepseek-flash', 'status': 'question_verified',
            'model_inference_verified': False, 'input_path': 'office_ws_terminal_input',
            'question_prompt_starts': 3, 'question_prompt_ends': 3, 'native_question_verified': True,
            'provider_request_detector_installed': True, 'same_session_verified': True,
            'denial_preserved_workspace': True, 'replay_rejected': True, 'cleanup_completed': True,
            'marker_written_after_allow': True,
        }
        for key, expected in expected_office.items():
            if office.get(key) != expected or type(office.get(key)) is not type(expected):
                return False
        if type(office.get('marker_sha256')) is not str or not re.fullmatch(r'[0-9a-f]{64}', office.get('marker_sha256')):
            return False
        if not _strict_responses(office.get('question_responses')):
            return False
        if relay_summary.get('records') != [] or type(relay_summary.get('records')) is not list:
            return False
        for key in ('client_requests', 'external_requests'):
            if relay_summary.get(key) != 0 or type(relay_summary.get(key)) is not int:
                return False
        hooks = office.get('authenticated_hooks')
        if type(hooks) is not list or len(hooks) != 7 or any(type(h) is not dict for h in hooks):
            return False
        expected_hooks = [('session','starting')] + [('question','needs_input'),('session','done')] * 3
        if [(h.get('type'), h.get('status')) for h in hooks] != expected_hooks or any(h.get('session') != session for h in hooks):
            return False
        states = office.get('states')
        if type(states) is not list or states.count('needs_input') != 3:
            return False
        marker_bytes, event_bytes, pi_event_bytes = _question_artifacts(out)
        pi_events = [_json_no_duplicates(line) for line in pi_event_bytes.decode('utf-8').splitlines() if line]
        if pi_events != [{'type':'session_start','session':session,'provider':'deepseek','model':'deepseek-flash'}]:
            return False
        marker_obj = _json_no_duplicates(marker_bytes.decode('utf-8'))
        if type(marker_obj) is not dict or set(marker_obj) != {'schema', 'session', 'index', 'nonce'} or type(marker_obj.get('index')) is not int:
            return False
        if marker_obj != {'schema': 'lab.pi.question.v1', 'session': session, 'index': 1, 'nonce': nonce}:
            return False
        if hashlib.sha256(marker_bytes).hexdigest() != office.get('marker_sha256'):
            return False
        lines = [line for line in event_bytes.decode('utf-8').splitlines() if line]
        events = [_json_no_duplicates(line) for line in lines]
        if any(type(event) is not dict for event in events):
            return False
        if [event.get('type') for event in events] != QUESTION_EVENT_TYPES:
            return False
        if any(event.get('type') == 'provider_request_attempt' for event in events):
            return False
        for event in events:
            keys = {'type','session','provider','model'}
            if event['type'] in ('confirm_start','confirm_result','marker_written'): keys.add('index')
            if event['type'] == 'confirm_result': keys.add('ui')
            if set(event) != keys:
                return False
            if event.get('session') != session or event.get('provider') != 'deepseek' or event.get('model') != 'deepseek-flash':
                return False
        starts = [event for event in events if event.get('type') == 'confirm_start']
        results = [event for event in events if event.get('type') == 'confirm_result']
        if [event.get('index') for event in starts] != [0, 1, 2] or [event.get('index') for event in results] != [0, 1, 2]:
            return False
        if any(type(event.get('index')) is not int for event in starts + results):
            return False
        values = [event.get('ui') for event in results]
        if values != [False, True, False] or any(type(value) is not bool for value in values):
            return False
        marker_index = [i for i, event in enumerate(events) if event.get('type') == 'marker_written']
        if marker_index != [5] or events[5].get('index') != 1 or type(events[5].get('index')) is not int:
            return False
        return True
    except (OSError, ValueError, TypeError, UnicodeError, RecursionError):
        return False


def prepare(out, port, token, fixture, check_question=False, question_nonce=None):
    workspace = private_directory(out / 'workspace')
    home = private_directory(out / 'home')
    agent = private_directory(home / 'pi')
    tmp = private_directory(out / 'tmp')
    write_new_private(workspace / 'input.json', fixture)
    write_new_private(agent / 'auth.json', {'deepseek': {'type': 'api_key', 'key': token}})
    write_new_private(agent / 'models.json', {'providers': {'deepseek': {'baseUrl': f'http://127.0.0.1:{port}/v1',
        'api': 'openai-completions', 'models': [{'id': 'deepseek-flash', 'name': 'DeepSeek bounded fixture',
        'reasoning': False, 'contextWindow': 32768, 'maxTokens': MAX_OUTPUT}]}}})
    write_new_private(agent / 'settings.json', {'defaultProvider': 'deepseek', 'defaultModel': 'deepseek-flash',
        'defaultThinkingLevel': 'off', 'retry': {'enabled': False, 'provider': {'maxRetries': 0}},
        'compaction': {'enabled': False}, 'cacheWarming': {'enabled': False}})
    profile = ('(version 1)(allow default)(deny network*)'
               '(allow network-outbound (remote ip "localhost:*"))'
               '(allow network-inbound network-bind (local ip "localhost:*"))'
               '(allow network* (local unix-socket) (remote unix-socket))'
               '(deny file-write*)'
               f'(allow file-write* (subpath {json.dumps(str(out))}))'
               '(allow file-write* (regex #"^/dev/"))'
               f'(deny file-read* (subpath {json.dumps(str(LAB / ".local"))}))')
    (out / 'pi.sb').write_text(profile)
    env = isolated_env(home, 'pi')
    env.update(TMPDIR=str(tmp), LAB_PI_OUT=str(out), LAB_PI_WORKSPACE=str(workspace),
               PATH=str(LAB / 'scripts/bin') + os.pathsep + os.environ['PATH'])
    if check_question:
        if not re.fullmatch(r'[0-9a-f]{32}', question_nonce or ''):
            raise ValueError('Invalid question nonce')
        env.update(LAB_PI_QUESTION_MODE='1', LAB_PI_QUESTION_NONCE=question_nonce)
    return env


def main():
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    group = parser.add_mutually_exclusive_group()
    group.add_argument('--check-startup', action='store_true', help='Real Office/Pi boot, no remote request permitted')
    group.add_argument('--allow-remote', action='store_true', help='Authorize one bounded paid DeepSeek fixture run')
    group.add_argument('--check-failure', type=int, choices=(401, 429), help='Native Pi against an injected loopback error; no credentials or external requests')
    group.add_argument('--check-crash', action='store_true', help='Kill this run\'s working Pi CLI while its request is held locally; no remote calls')
    group.add_argument('--check-cancel', action='store_true', help='Cancel the working Pi through native Office with a held loopback request; no model calls')
    group.add_argument('--check-resume', action='store_true', help='Reconnect the same persisted Pi session after a local error and owned CLI exit; no model calls')
    group.add_argument('--check-host-restart', action='store_true', help='Crash and restart the native Office host; reconnect Pi without a prompt or model calls')
    group.add_argument('--check-question', action='store_true', help='Exercise native Pi confirm UI with deny, allow and timeout; no model calls')
    parser.add_argument('--authorization-ref', help='Server-side remote grant reference; only valid with --allow-remote')
    args = parser.parse_args()
    if args.authorization_ref is not None and (not args.allow_remote or not re.fullmatch(r'[0-9a-f]{32}', args.authorization_ref)):
        raise ValueError('Invalid authorization reference')
    authorization_fingerprint = hashlib.sha256(args.authorization_ref.encode()).hexdigest()[:12] if args.authorization_ref else None
    if not args.allow_remote and not args.check_startup and args.check_failure is None and not args.check_crash and not args.check_cancel and not args.check_resume and not args.check_host_restart and not args.check_question:
        print(json.dumps({'mode': 'plan', 'command': 'python3 scripts/run_pi_work.py --allow-remote',
                          'provider': 'pi', 'model': 'deepseek-flash', 'max_requests': MAX_REQUESTS,
                          'max_output_tokens_per_request': MAX_OUTPUT, 'max_request_bytes': MAX_BODY,
                          'timeout_seconds': 180, 'automatic_retries': False, 'remote_requests_sent': False}, indent=2))
        return 0
    if not probe('pi')['compatible']:
        raise ValueError('Pi preflight failed')
    api_key = None
    if args.allow_remote:
        auth = LAB / '.local/remote/pi/auth.json'
        if auth.is_symlink() or auth.stat().st_mode & 0o077:
            raise ValueError('Pi credentials require a private regular file')
        saved = json.loads(auth.read_text()).get('deepseek', {})
        if saved.get('type') != 'api_key' or not isinstance(saved.get('key'), str) or not saved['key']:
            raise ValueError('DeepSeek key missing')
        api_key = saved['key']
    mark_started()
    out = private_directory(LAB / 'runs' / ('pi-work-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')))
    fixture = {'marker': secrets.token_hex(12), 'values': [7, 11, -2, 9]}
    if not args.check_startup and not args.check_cancel and not args.check_resume and not args.check_host_restart and not args.check_question:
        mode = 'crash' if args.check_crash else 'http_' + str(args.check_failure) if args.check_failure else 'task'
        _, fixture = pi_retry.register(LAB, out, mode, fixture)
    elif pi_retry.slots.retry_parent(LAB) is not None:
        raise ValueError('Startup, cancellation, reconnect or question check cannot retry a task')
    token = secrets.token_urlsafe(32)
    question_nonce = secrets.token_hex(16) if args.check_question else None
    relay = Relay(token, api_key, fault_status=429 if args.check_resume or args.check_host_restart or args.check_question else args.check_failure, hold_request=args.check_crash or args.check_cancel)
    process = None; owned = {}
    report = {'status': 'starting', 'startup_only': args.check_startup, 'provider': 'pi', 'model': 'deepseek-flash',
              'model_inference_verified': False, 'cleanup_errors': [], 'cloud_fallback': False}
    if authorization_fingerprint:
        report['authorization'] = {'kind':'server_grant','fingerprint':authorization_fingerprint}
    if args.check_failure is not None:
        report.update(fault_injection={'source': 'loopback', 'http_status': args.check_failure}, failure_check_passed=False)
    if args.check_crash:
        report.update(crash_injection={'source': 'owned_cli', 'signal': 'SIGKILL'}, crash_check_passed=False,
                      crash_target_verified=False)
    if args.check_cancel:
        report.update(cancellation_check={'source':'held_loopback','method':'worker.kill'}, cancel_check_passed=False)
    if args.check_resume:
        report.update(resume_check={'source':'loopback','http_status':429}, resume_check_passed=False, resume_target_verified=False)
    if args.check_host_restart:
        report.update(host_restart_check={'source':'loopback','http_status':429,'signal':'SIGKILL'}, host_restart_check_passed=False, host_target_verified=False)
    if args.check_question:
        report.update(result_kind='native_question_check', permission_kind='synthetic_ui_confirm',
                      model_driven_permission=False, question_check_passed=False, startup_only=False)
    started = time.monotonic()
    def interrupted(*_):
        raise InterruptedError('Interrupted')
    signal.signal(signal.SIGINT, interrupted)
    signal.signal(signal.SIGTERM, interrupted)
    try:
        port = relay.start()
        env = prepare(out, port, token, fixture, args.check_question, question_nonce)
        for name in ('pi_retry.py', 'execution_slot.py', 'process_ownership.py', 'run_pi_work.py', 'deepseek_relay.py', 'office_pi.mjs', 'office_pi_question.mjs', 'office_pi_host.mjs', 'office_pi_restart.mjs', 'manual_recovery.mjs', 'pi_boundary.mjs', 'pi_question_check.mjs', 'pi_office_policy.mjs', 'pi_hook_guard.mjs', 'pi_hook_probe.mjs', 'pi_hook_evidence.py', 'pi_session_evidence.mjs', 'remote_cli.py'):
            shutil.copy2(LAB / 'scripts' / name, out / name)
        shutil.copy2(LAB / 'scripts/bin/pi', out / 'pi-launcher.py')
        command = [shutil.which('node'), str(LAB / ('scripts/office_pi_question.mjs' if args.check_question else 'scripts/office_pi_restart.mjs' if args.check_host_restart else 'scripts/office_pi.mjs')), str(out)]
        if args.check_startup: command.append('--check-startup')
        if args.check_failure is not None: command += ['--check-failure', str(args.check_failure)]
        if args.check_crash: command.append('--check-crash')
        if args.check_cancel: command.append('--check-cancel')
        if args.check_resume: command.append('--check-resume')
        if args.check_question: command.append('--check-question')
        with (out / 'office.stdout.log').open('w') as stdout, (out / 'office.stderr.log').open('w') as stderr:
            process = subprocess.Popen(command, cwd=out, env=env, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
            deadline = time.monotonic() + 180
            while process.poll() is None:
                owned = collect_owned(process_table(), owned, process.pid)
                if args.check_cancel and relay.request_held.is_set() and not (out / 'cancel-ready.json').exists():
                    write_new_private(out / 'cancel-ready.json', {'held':True})
                if args.check_host_restart and not report['host_target_verified'] and relay.records:
                    target_path = out / 'host-crash-target.json'
                    if target_path.is_file():
                        target = json.loads(target_path.read_text())
                        if target.get('status') != 'needs_input' or not isinstance(target.get('session'), str) or not target['session']:
                            raise ValueError('Invalid native host crash target')
                        crash_owned(target.get('pid'), owned)
                        report['host_target_verified'] = True
                if args.check_resume and not report['resume_target_verified'] and relay.records:
                    target_path = out / 'resume-target.json'
                    if target_path.is_file():
                        target = json.loads(target_path.read_text())
                        if target.get('status') != 'needs_input' or not isinstance(target.get('session'), str) or not target['session']:
                            raise ValueError('Invalid native reconnect target')
                        crash_owned(target.get('pid'), owned)
                        report['resume_target_verified'] = True
                if args.check_crash and not report['crash_target_verified'] and relay.request_held.is_set():
                    target_path = out / 'crash-target.json'
                    if target_path.is_file():
                        target = json.loads(target_path.read_text())
                        if target.get('status') != 'working' or not isinstance(target.get('session'), str) or not target['session']:
                            raise ValueError('Invalid native crash target')
                        crash_owned(target.get('pid'), owned)
                        report['crash_target_verified'] = True
                if time.monotonic() > deadline: raise subprocess.TimeoutExpired(command, 180)
                time.sleep(0.1)
            code = process.returncode
        office = json.loads((out / 'office-result.json').read_text())
        report['office'] = office
        if args.check_question or args.check_resume or args.check_startup:
            if not verify_hook_boundary(office.get('hook_boundary'), resumed=args.check_resume):
                raise ValueError('Native Pi hook boundary acceptance failed')
            report['hook_boundary_check_passed'] = True
        if args.check_question:
            relay_summary = {'records': relay.records, 'client_requests': relay.client_requests, 'external_requests': relay.external_requests}
            if code or not verify_question(office, relay_summary, out, question_nonce):
                raise ValueError('Native Pi question acceptance failed')
            report.update(status='stopped', reason='native_question_check', result_kind='native_question_check',
                          permission_kind='synthetic_ui_confirm', model_driven_permission=False,
                          question_check_passed=True, model_inference_verified=False)
        elif args.check_host_restart:
            if (code or office.get('status') != 'stopped'
                    or not all(office.get(k) is True for k in ('crash_recovery_verified','repeated_restart_preserved','old_processes_exited','session_history_preserved','native_resume_verified','new_process_same_session','distinct_host_processes','browser_interrupted_visible','browser_refresh_without_replay'))
                    or office.get('host_generations') != 3 or report['host_target_verified'] is not True
                    or relay.external_requests != 0 or relay.client_requests != 1 or len(relay.records) != 1
                    or relay.records[0].get('origin') != 'injected_loopback' or relay.records[0].get('http_status') != 429
                    or office.get('no_automatic_replay_observation_ms',0) < 3000
                    or (out / 'workspace/result.json').exists()):
                raise ValueError('Native Pi host restart acceptance failed')
            report.update(status='stopped', reason='native_host_restart_check', host_restart_check_passed=True)
        elif args.check_resume:
            if (code or office.get('status') != 'stopped' or office.get('native_resume_verified') is not True
                    or office.get('session_history_preserved') is not True or office.get('native_token_rotated') is not True
                    or report['resume_target_verified'] is not True or relay.external_requests != 0
                    or relay.client_requests != 1 or len(relay.records) != 1
                    or relay.records[0].get('origin') != 'injected_loopback' or relay.records[0].get('http_status') != 429
                    or office.get('no_automatic_replay_observation_ms',0) < 3000
                    or (out / 'workspace/result.json').exists()):
                raise ValueError('Native Pi reconnect acceptance failed')
            report.update(status='stopped', reason='native_resume_check', resume_check_passed=True)
        elif args.check_cancel:
            if (code or office.get('status') != 'cancelled' or office.get('native_cancel_verified') is not True
                    or office.get('cancelled_processes_exited') is not True or relay.external_requests != 0
                    or relay.client_requests != 1 or len(relay.records) != 1
                    or relay.records[0].get('origin') != 'held_loopback'
                    or office.get('no_automatic_restart_observation_ms', 0) < 3000
                    or not 0 <= office.get('cancel_processes_exit_duration_ms', 10001) <= 10000
                    or (out / 'workspace/result.json').exists()):
                raise ValueError('Native Pi cancellation acceptance failed')
            report.update(status='cancelled', reason='native_cancel_check', cancel_check_passed=True)
        elif args.check_crash:
            if (code or office.get('status') != 'failed' or office.get('native_crash_verified') is not True
                    or report['crash_target_verified'] is not True or relay.external_requests != 0
                    or relay.client_requests != 1 or len(relay.records) != 1
                    or relay.records[0].get('origin') != 'held_loopback'
                    or office.get('no_automatic_restart_observation_ms', 0) < 3000
                    or (out / 'workspace/result.json').exists()):
                raise ValueError('Native CLI crash acceptance failed')
            report.update(status='failed', reason='injected_cli_crash', crash_check_passed=True)
        elif args.check_failure is not None:
            if (code or office.get('status') != 'failed' or office.get('native_error_verified') is not True
                    or office.get('failure_check_passed') is not True or relay.external_requests != 0
                    or relay.client_requests != 1 or len(relay.records) != 1
                    or relay.records[0].get('http_status') != args.check_failure
                    or relay.records[0].get('origin') != 'injected_loopback'
                    or (out / 'workspace/result.json').exists()):
                raise ValueError('Native injected failure acceptance failed')
            report.update(status='failed', reason='injected_api_error', failure_check_passed=True)
        elif code or office['status'] != 'completed':
            raise ValueError('Native Office/Pi acceptance failed')
        elif args.check_startup:
            if relay.records or relay.client_requests or relay.external_requests:
                raise ValueError('Startup unexpectedly requested inference')
        else:
            if not relay.records or any(r['status'] != 'completed' for r in relay.records): raise ValueError('Provider requests did not complete')
            if not any(r.get('output_tokens', 0) > 0 for r in relay.records): raise ValueError('No provider usage evidence')
            if not office.get('file_task_passed') or not office.get('agent_settled_verified'): raise ValueError('Missing native evidence')
            report['model_inference_verified'] = True
        if args.check_failure is None and not args.check_crash and not args.check_cancel and not args.check_resume and not args.check_host_restart and not args.check_question: report['status'] = 'completed'
    except InterruptedError:
        if args.allow_remote:
            report['status'] = 'stopped'; report['reason'] = 'operator_interrupt'
        else:
            report['status'] = 'failed'; report['reason'] = 'bounded_pi_acceptance_failed'
    except (OSError, ValueError, subprocess.SubprocessError):
        report['status'] = 'failed'; report['reason'] = 'bounded_pi_acceptance_failed'
    finally:
        signal.signal(signal.SIGINT, signal.SIG_IGN); signal.signal(signal.SIGTERM, signal.SIG_IGN)
        if process: owned = collect_owned(process_table(), owned, process.pid)
        if process and process.poll() is None:
            process.terminate()
            try: process.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL); process.wait(); report['cleanup_errors'].append('forced_process_group_stop')
        if (args.check_cancel or args.check_resume or args.check_host_restart or args.check_question) and process and process.poll() is not None:
            report['question_background_processes_signalled' if args.check_question else 'cancel_background_processes_signalled' if args.check_cancel else 'resume_background_processes_signalled'] = terminate_owned(owned)
        remaining = alive_owned(process_table(), owned)
        deadline = time.monotonic() + 10
        while remaining and time.monotonic() < deadline:
            time.sleep(0.1); remaining = alive_owned(process_table(), owned)
        report['owned_processes_seen'] = len(owned)
        report['remaining_owned_processes'] = len(remaining)
        if remaining: report['cleanup_errors'].append('owned_pi_process_survived')
        relay.close()
        if (out / 'office-result.json').is_file(): report['office'] = json.loads((out / 'office-result.json').read_text())
        report['requests'] = relay.records
        report['remote_usage'] = {'requests': relay.external_requests,
            'output_tokens': (sum(r['output_tokens'] for r in relay.records)
                if relay.external_requests and all(type(r.get('output_tokens')) is int for r in relay.records)
                else None if relay.external_requests else 0)}
        report['client_requests'] = relay.client_requests
        report['external_requests'] = relay.external_requests
        report['elapsed_s'] = time.monotonic() - started
        if not report.get('office', {}).get('cleanup_completed'): report['cleanup_errors'].append('native_cleanup_not_verified')
        if report['cleanup_errors']:
            report['status'] = 'failed'
            if args.check_failure is not None: report['failure_check_passed'] = False
            if args.check_crash: report['crash_check_passed'] = False
            if args.check_cancel: report['cancel_check_passed'] = False
            if args.check_host_restart: report['host_restart_check_passed'] = False
            if args.check_resume: report['resume_check_passed'] = False
            if args.check_question: report['question_check_passed'] = False
        if args.check_cancel and report.get('cancel_check_passed'):
            duration = time.time() * 1000 - report['office']['cancel_started_at']
            report['cancel_cleanup_duration_ms'] = round(duration)
            if not 0 <= duration <= 10000:
                report.update(status='failed', cancel_check_passed=False, reason='cancel_cleanup_deadline_exceeded')
        (out / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps({'status': report['status'], 'model_inference_verified': report['model_inference_verified'],
              'result_kind': report.get('result_kind'), 'question_check_passed': report.get('question_check_passed'),
              'failure_check_passed': report.get('failure_check_passed'), 'external_requests': relay.external_requests,
              'host_restart_check_passed':report.get('host_restart_check_passed'), 'resume_check_passed':report.get('resume_check_passed'), 'crash_check_passed': report.get('crash_check_passed'), 'cancel_check_passed': report.get('cancel_check_passed'),
              'requests': len(relay.records), 'cleanup_errors': report['cleanup_errors'], 'artifacts': str(out)}, indent=2))
    if not report['cleanup_errors']:
        mark_clean()
    return 0 if report['status'] == 'completed' or report.get('failure_check_passed') is True or report.get('crash_check_passed') is True or report.get('cancel_check_passed') is True or report.get('resume_check_passed') is True or report.get('host_restart_check_passed') is True or report.get('question_check_passed') is True else 1


if __name__ == '__main__':
    try: raise SystemExit(guarded_main(main, bool(set(sys.argv[1:]) & {'--allow-remote', '--check-startup', '--check-crash', '--check-cancel', '--check-resume', '--check-host-restart', '--check-question'}) or any(a == '--check-failure' or a.startswith('--check-failure=') for a in sys.argv[1:])))
    except (OSError, ValueError):
        print('Pi fixture could not start; check preflight and isolated credentials. No secret is printed.', file=sys.stderr)
        raise SystemExit(1)

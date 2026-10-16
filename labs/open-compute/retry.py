#!/usr/bin/env python3
"""M6 controlled callback failures; standalone, bounded original-runtime probe."""
import argparse
import hashlib
import http.client
import json
import os
from pathlib import Path
import platform
import pwd
import re
import secrets
import signal
import stat
import time

from lab import (LabError, ProcessObservationError, OwnedScope, Process, LocalHTTP,
                 Redactor, MARKER, HERE, preflight, validate_artifact_paths,
                 validate_lock, download_binary, command,
                 sha256_file, public_process, worker_host, poll, exclusive_file,
                 source_commit, m3_deadline, defer_owner_signals)
from retry_contract import (CASES, POLICY, SCHEMA_SQL, validate_row,
                            validate_terminal, case_result, initial_retries,
                            project_retries)

WORKER = 'retry-worker'
FLOW = 'retry-flow'
PIN = json.loads((HERE / 'upstream.lock.json').read_text())
ERRORS = {'preflight', 'pin', 'bootstrap', 'deployment', 'case', 'schema',
          'deadline', 'ownership', 'cleanup', 'evidence', 'interrupted'}
PHASES = ERRORS | {'complete'}


def require(value, category='schema'):
    if not value:
        raise LabError(category)


def safe_id(value):
    require(type(value) is str and re.fullmatch(r'[A-Za-z0-9_-]{1,100}', value) is not None)
    return value


def observed_environment():
    """Keep supported observations; represent unsupported metadata with fixed unknown."""
    system, machine, version = platform.system(), platform.machine(), platform.python_version()
    return dict(os=system if system in ('Linux', 'Darwin', 'Windows') else 'unknown',
                architecture=machine if machine in ('x86_64', 'aarch64', 'arm64', 'AMD64') else 'unknown',
                euid=os.geteuid(),
                python=version if type(version) is str and len(version) <= 16 and
                re.fullmatch(r'[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,3}', version) else 'unknown')


def scope_hint():
    return Path(pwd.getpwuid(os.getuid()).pw_dir) / '.open-compute'


class RequestBudget:
    def __init__(self, deadline):
        self.deadline = deadline
        self.case_deadline = None
        self.get_requests = 0

    def charge(self, method):
        deadline = min(self.deadline, self.case_deadline or self.deadline,
                       time.monotonic() + 20)
        require(time.monotonic() < deadline, 'deadline')
        if self.case_deadline is not None and method == 'GET':
            require(self.get_requests < 256, 'deadline')
            self.get_requests += 1
        return deadline


class BoundedHTTP:
    """Composition keeps shared GET accounting independent of HTTP implementation."""
    def __init__(self, transport, budget):
        self.transport, self.budget = transport, budget

    def request(self, method, path, body=None, content_type='application/json', host=None):
        deadline = self.budget.charge(method)
        result = self.transport.request(method, path, body, content_type, host,
                                        deadline=deadline)
        require(time.monotonic() < deadline, 'deadline')
        return result

    def v4(self, method, path, body=None, content_type='application/json'):
        value = self.request(method, '/client/v4' + path, body, content_type)
        require(type(value) is dict and value.get('success') is True)
        return value.get('result')


def read_secret(path, redactor):
    """Reject special files before bounded nonblocking no-follow read."""
    fd = None
    try:
        before = path.lstat()
        with defer_owner_signals():
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        info = os.fstat(fd)
        def metadata(s):
            return (s.st_dev, s.st_ino, s.st_mode, s.st_uid, s.st_nlink,
                    s.st_size, s.st_mtime_ns, s.st_ctime_ns)
        require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and
                stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1 and
                0 < info.st_size <= 4096 and metadata(before) == metadata(info), 'bootstrap')
        value = os.read(fd, 4097)
        require(len(value) == info.st_size and metadata(info) == metadata(os.fstat(fd)) and
                metadata(info) == metadata(path.lstat()), 'bootstrap')
        redactor.secrets.extend([value.hex(), value.decode(errors='replace').strip()])
        return value
    finally:
        if fd is not None:
            with defer_owner_signals():
                os.close(fd)


def fixture_bytes():
    with (HERE / 'fixtures/retry_worker.js').open('rb') as stream:
        value = stream.read(32 * 1024 + 1)
    require(0 < len(value) < 32 * 1024, 'deployment')
    return value


def multipart(database_id, source):
    boundary = 'oc-m6-' + secrets.token_hex(16)
    metadata = dict(main_module='index.js', compatibility_date='2026-09-08', bindings=[
        dict(type='d1', name='DB', id=database_id),
        dict(type='workflow', name='FLOW', workflow_name=FLOW, class_name='RetryFlow')],
        exports=dict(RetryFlow=dict(type='workflow', name=FLOW)))
    parts = []
    for name, kind, payload in [('metadata', 'application/json', json.dumps(metadata).encode()),
                                ('index.js', 'application/javascript+module', source)]:
        parts.append((f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; '
                      f'filename="{name}"\r\nContent-Type: {kind}\r\n\r\n').encode() + payload + b'\r\n')
    return b''.join(parts) + f'--{boundary}--\r\n'.encode(), 'multipart/form-data; boundary=' + boundary


def deployment(api, base, database_id):
    path = base + '/workers/scripts/' + WORKER
    rows = api.v4('GET', path + '/deployments')['deployments']
    require(type(rows) is list and len(rows) == 1)
    safe_id(rows[0]['id'])
    versions = rows[0]['versions']
    require(type(versions) is list and len(versions) == 1 and
            type(versions[0]['percentage']) in (int, float) and versions[0]['percentage'] == 100)
    version = api.v4('GET', path + '/versions/' + safe_id(versions[0]['version_id']))
    require(version['id'] == versions[0]['version_id'])
    resources = version['resources']
    require(resources['script_runtime']['compatibility_date'] == '2026-09-08')
    require(type(resources['script']['etag']) is str and
            re.fullmatch(r'[a-f0-9]{64}', resources['script']['etag']))
    bindings = resources['bindings']
    require(type(bindings) is list and len(bindings) == 2)
    d1 = [v for v in bindings if v.get('name') == 'DB']
    flow = [v for v in bindings if v.get('name') == 'FLOW']
    require(len(d1) == len(flow) == 1 and d1[0]['type'] == 'd1' and
            d1[0]['database_id'] == database_id and flow[0]['type'] == 'workflow' and
            flow[0]['workflow_name'] == FLOW and flow[0]['class_name'] == 'RetryFlow', 'deployment')


def daemon_alive(daemon):
    require(daemon.process.poll() is None and not daemon.observation_error, 'ownership')
    require(daemon.live(), 'ownership')


def run_cases(api, worker, host, base, database_id, run_id, budget, daemon, retries, acceptance):
    for index, name in enumerate(CASES):
        with m3_deadline(min(60, budget.deadline - time.monotonic()), 'case') as deadline:
            budget.case_deadline = min(deadline, budget.deadline)
            daemon_alive(daemon)
            job_id = name + '-' + run_id.lower()
            workflow_id = 'flow-' + job_id
            api.v4('POST', base + '/d1/database/' + database_id + '/query',
                   dict(sql='INSERT INTO retry_jobs (id, case_name) VALUES (?, ?)', params=[job_id, name]))
            initial = validate_row(worker.request('GET', '/jobs/' + job_id, host=host),
                                   job_id, name, terminal=False)
            path = base + '/workflows/' + FLOW + '/instances'
            creation = api.v4('POST', path, dict(instance_id=workflow_id,
                                                params=dict(jobId=job_id, caseName=name)))
            require(type(creation) is dict and creation.get('id') == workflow_id, 'case')
            path += '/' + workflow_id
            expected = 'errored' if name == 'exhausted' else 'complete'
            while True:
                daemon_alive(daemon)
                value = api.v4('GET', path)
                require(type(value) is dict, 'schema')
                if value.get('status') == expected:
                    final = validate_terminal(value, job_id, name)
                    break
                require(value.get('status') in {'queued', 'running', 'waiting', 'paused'}, 'case')
                require(time.monotonic() + .1 < budget.case_deadline, 'deadline')
                time.sleep(.1)
            observed = validate_row(worker.request('GET', '/jobs/' + job_id, host=host),
                                    job_id, name, terminal=True)
            again = validate_terminal(api.v4('GET', path), job_id, name)
            row_again = validate_row(worker.request('GET', '/jobs/' + job_id, host=host),
                                     job_id, name, terminal=True)
            require(final == again and observed == row_again, 'case')
            daemon_alive(daemon)
            require(time.monotonic() < budget.case_deadline, 'deadline')
            result = case_result(name, job_id, workflow_id, initial, observed, final)
            retries['cases'].append(result)
            acceptance[f'M6-{index+2:02}'] = 'passed'
    budget.case_deadline = None


def project_shutdown(value):
    require(type(value) is dict)
    expected = {'was_running': True, 'signal': 'SIGTERM', 'forced': False,
                'exit_code': 0, 'all_owned_exited': True}
    projected = {}
    for key in expected:
        observed = value.get(key)
        require(type(observed) is type(expected[key]))
        projected[key] = observed
    require(projected['signal'] == 'SIGTERM')
    return projected


def project_report(value):
    """Only known structured facts cross the public evidence boundary."""
    required = {'schema_version', 'scenario', 'run_id', 'command', 'harness_commit',
                'environment', 'acceptance', 'result', 'phase', 'scope_removed',
                'evidence_file_written', 'retries'}
    optional = {'upstream', 'runtime', 'fixture_sha256', 'instance', 'daemon',
                'final_shutdown', 'error', 'cleanup_error', 'evidence_write_error'}
    require(type(value) is dict and required <= set(value) <= required | optional)
    require(type(value['schema_version']) is int and value['schema_version'] == 1)
    require(value['scenario'] == 'controlled-workflow-retries' and value['command'] == 'make integration-retry')
    require(type(value['run_id']) is str and re.fullmatch(r'[0-9]{8}T[0-9]{6}Z-[a-f0-9]{8}', value['run_id']))
    require(value['harness_commit'] is None or (type(value['harness_commit']) is str and
            re.fullmatch(r'[a-f0-9]{40}', value['harness_commit'])))
    require(value['result'] in ('passed', 'failed') and value['phase'] in PHASES)
    env = value['environment']
    require(type(env) is dict and set(env) == {'os', 'architecture', 'euid', 'python'})
    require(env['os'] in ('Linux', 'Darwin', 'Windows', 'unknown') and env['architecture'] in
            ('x86_64', 'aarch64', 'arm64', 'AMD64', 'unknown'))
    require(type(env['euid']) is int and 0 <= env['euid'] < 2**32 and type(env['python']) is str and
            (env['python'] == 'unknown' or re.fullmatch(r'[0-9]{1,2}\.[0-9]{1,2}\.[0-9]{1,3}', env['python'])))
    acceptance = value['acceptance']
    require(type(acceptance) is dict and set(acceptance) == {f'M6-{n:02}' for n in range(1, 6)} and
            all(type(v) is str and v in ('not_run', 'passed') for v in acceptance.values()))
    require(type(value['scope_removed']) is bool and type(value['evidence_file_written']) is bool)
    result = dict(value)
    result['retries'] = project_retries(value['retries'], complete=value['result'] == 'passed')
    for key in ('error', 'cleanup_error', 'evidence_write_error'):
        if key in value: require(value[key] in ERRORS)
    if 'upstream' in value:
        require(json.dumps(value['upstream'], sort_keys=True, allow_nan=False) ==
                json.dumps(PIN, sort_keys=True, allow_nan=False))
    if 'runtime' in value:
        require(type(value['runtime']) is dict and value['runtime'] ==
                dict(version_text='ocd 0.2.4', artifact_sha256=PIN['artifact']['sha256']))
    if 'fixture_sha256' in value:
        require(type(value['fixture_sha256']) is str and re.fullmatch(r'[a-f0-9]{64}', value['fixture_sha256']))
    if 'instance' in value:
        require(type(value['instance']) is dict and set(value['instance']) == {'name', 'instance_id', 'account_id', 'database_id'} and
                value['instance']['name'] == 'lab')
        for key in ('instance_id', 'account_id', 'database_id'): safe_id(value['instance'][key])
    if 'daemon' in value:
        require(type(value['daemon']) is dict and set(value['daemon']) == {'pid', 'pgid', 'start_ticks'})
        for number in value['daemon'].values(): require(type(number) is int and 0 < number < 2**63)
    if 'final_shutdown' in value:
        result['final_shutdown'] = project_shutdown(value['final_shutdown'])
    if value['result'] == 'passed':
        require(env['os'] == 'Linux' and env['architecture'] == 'x86_64' and env['euid'] > 0 and
                re.fullmatch(r'3\.(?:1[1-9]|[2-9][0-9])\.[0-9]{1,3}', env['python']))
        require(all(v == 'passed' for v in acceptance.values()) and value['scope_removed'] and
                value['evidence_file_written'] and 'final_shutdown' in result and
                result['final_shutdown'] == dict(was_running=True, signal='SIGTERM', forced=False,
                                                exit_code=0, all_owned_exited=True))
        require({'upstream', 'runtime', 'fixture_sha256', 'instance', 'daemon'} <= set(value))
    require(len(json.dumps(result, allow_nan=False).encode()) < 128 * 1024)
    return result


def error_category(exc, phase):
    if isinstance(exc, KeyboardInterrupt): return 'interrupted'
    if isinstance(exc, ProcessObservationError): return 'ownership'
    # Shared helpers contain diagnostics; emit no arbitrary exception text.
    text = str(exc)
    if 'deadline' in text: return 'deadline'
    if text in ERRORS: return text
    if isinstance(exc, (ValueError, TypeError, KeyError, AttributeError)): return 'schema'
    return phase if phase in ERRORS else 'schema'


def integration(args):
    run_id = time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()) + '-' + secrets.token_hex(4)
    report = dict(schema_version=1, scenario='controlled-workflow-retries', run_id=run_id,
                  command='make integration-retry', harness_commit=source_commit(),
                  environment=observed_environment(),
                  acceptance={f'M6-{n:02}': 'not_run' for n in range(1, 6)},
                  result='failed', phase='preflight', scope_removed=False,
                  evidence_file_written=False, retries=initial_retries())
    safe_base = json.loads(json.dumps(report))
    redactor = Redactor()
    scope = daemon = budget = None
    output_allowed = False
    cleanup_unknown = False
    cache, output = Path(args.cache), Path(args.output)
    hint = None
    old_handlers = {}
    def interrupted(signum, frame):
        raise LabError('interrupted')
    try:
        for sig in (signal.SIGINT, signal.SIGTERM):
            old_handlers[sig] = signal.signal(sig, interrupted)
        hint = scope_hint()
        cache, output = validate_artifact_paths(hint, cache, output)
        output_allowed = True
        scope_path = preflight(args.port)
        report['phase'] = 'pin'
        lock = json.loads((HERE / 'upstream.lock.json').read_text())
        validate_lock(lock)
        require(json.dumps(lock, sort_keys=True, allow_nan=False) ==
                json.dumps(PIN, sort_keys=True, allow_nan=False), 'pin')
        report['upstream'] = lock
        binary = download_binary(cache, lock['artifact'], run_id)
        version = command([str(binary), '--version']).strip()
        require(version == 'ocd 0.2.4', 'pin')
        digest = sha256_file(binary)
        require(digest == lock['artifact']['sha256'], 'pin')
        report['runtime'] = dict(version_text=version, artifact_sha256=digest)
        report['phase'] = 'bootstrap'
        scope = OwnedScope(scope_path, args.port, bounded_owner=True)
        redactor.secrets.append(scope.create())
        with m3_deadline(300, 'scenario') as scenario_end:
            budget = RequestBudget(scenario_end)
            with defer_owner_signals():
                daemon = Process([str(binary), '--no-update-check', 'run'])
            report['daemon'] = public_process(daemon.identity, strict=True)
            unauth = BoundedHTTP(LocalHTTP(args.port), budget)
            def ready():
                daemon_alive(daemon)
                if not (scope_path / 'run/control.sock').is_socket(): return False
                try:
                    unauth.request('GET', '/health/live')
                    return True
                except (OSError, http.client.HTTPException):
                    return False
            poll(ready, bool, min(60, scenario_end - time.monotonic()), 'daemon bootstrap')
            config = scope_path / 'instances/lab/compute.toml'
            data = config.parent / 'data'
            command([str(binary), '--no-update-check', '--config', str(config), 'instance', 'setup',
                     '--name', 'lab', '--data-dir', str(data), '--yes'],
                    timeout=min(90, scenario_end - time.monotonic()))
            records = json.loads(command([str(binary), '--no-update-check', 'instances', '--json'],
                                         timeout=min(30, scenario_end-time.monotonic())))['instances']
            require(type(records) is list and len(records) == 1 and records[0]['name'] == 'lab' and records[0]['state'] == 'running')
            instance_id = safe_id(records[0]['instance_id'])
            scope.check_owner()
            credentials = {}
            for name in ('deployer.token', 'read-only.token', 'master.key'):
                credentials[name] = read_secret(data / 'keys' / name, redactor)
            token = credentials['deployer.token'].decode('ascii').strip()
            require(token and '\n' not in token and '\r' not in token, 'bootstrap')
            api = BoundedHTTP(LocalHTTP(args.port, token), budget)
            accounts = api.v4('GET', '/accounts')
            require(type(accounts) is list and len(accounts) == 1)
            account = safe_id(accounts[0]['id'])
            base = '/accounts/' + account
            report['phase'] = 'deployment'
            database_id = safe_id(api.v4('POST', base + '/d1/database', dict(name='retry-db'))['uuid'])
            for sql in SCHEMA_SQL:
                api.v4('POST', base + '/d1/database/' + database_id + '/query', dict(sql=sql, params=[]))
            source = fixture_bytes()
            report['fixture_sha256'] = hashlib.sha256(source).hexdigest()
            upload, content_type = multipart(database_id, source)
            api.v4('PUT', base + '/workers/scripts/' + WORKER, upload, content_type)
            endpoints = api.v4('GET', base + '/open-compute/workers/' + WORKER + '/endpoints')
            require(type(endpoints) is list)
            endpoints = [v for v in endpoints if v.get('kind') == 'local_origin']
            require(len(endpoints) == 1)
            host = worker_host(endpoints[0], args.port)
            worker = BoundedHTTP(LocalHTTP(args.port), budget)
            health = worker.request('GET', '/health', host=host)
            require(type(health) is dict and set(health) == {'fixture', 'ok'} and
                    health['fixture'] == 'open-compute-m6' and health['ok'] is True, 'deployment')
            deployment(api, base, database_id)
            report['instance'] = dict(name='lab', instance_id=instance_id, account_id=account, database_id=database_id)
            report['acceptance']['M6-01'] = 'passed'
            report['phase'] = 'case'
            run_cases(api, worker, host, base, database_id, run_id, budget, daemon,
                      report['retries'], report['acceptance'])
            daemon_alive(daemon)
            report['retries']['get_requests'] = budget.get_requests
            project_retries(report['retries'], complete=True)
            report['result'] = 'passed'
    except (Exception, KeyboardInterrupt) as exc:
        report['result'] = 'failed'
        report['error'] = error_category(exc, report['phase'])
        cleanup_unknown = isinstance(exc, ProcessObservationError)
    finally:
        if budget is not None:
            report['retries']['get_requests'] = budget.get_requests
        try:
            with m3_deadline(150, 'cleanup'):
                clean = not cleanup_unknown
                if daemon is not None:
                    shutdown = daemon.stop()
                    report['final_shutdown'] = project_shutdown(shutdown)
                    clean = clean and report['final_shutdown'] == dict(was_running=True, signal='SIGTERM',
                                  forced=False, exit_code=0, all_owned_exited=True)
                    clean = clean and not daemon.observation_error and not daemon.live() and daemon.process.poll() == 0
                    clean = clean and not daemon.reader.is_alive() and not daemon.monitor.is_alive()
                require(clean, 'ownership')
                if scope is not None and scope.identity is not None:
                    with m3_deadline(30, 'owned removal'):
                        scope.remove(processes_stopped=True)
                    report['scope_removed'] = True
                if report['result'] == 'passed': report['phase'] = 'complete'
        except (Exception, KeyboardInterrupt) as exc:
            report['result'] = 'failed'
            report['cleanup_error'] = error_category(exc, 'cleanup')
        for sig, handler in old_handlers.items():
            signal.signal(sig, handler)
    try:
        # Validate extension before output mutation; retain only valid observed prefix.
        report['retries'] = project_retries(report['retries'], complete=report['result'] == 'passed')
    except Exception:
        report['result'] = 'failed'
        report['error'] = 'schema'
        valid = initial_retries()
        if budget is not None: valid['get_requests'] = budget.get_requests
        observed_cases = report['retries'].get('cases') if type(report['retries']) is dict else None
        observed_cases = observed_cases if type(observed_cases) is list else []
        for item in observed_cases[:3]:
            trial = dict(valid, cases=valid['cases'] + [item])
            try: valid = project_retries(trial)
            except Exception: break
        report['retries'] = valid
    if output_allowed:
        try:
            with m3_deadline(10, 'evidence'):
                validate_artifact_paths(hint, cache, output)
                report['evidence_file_written'] = True
                if report['result'] == 'passed': report['acceptance']['M6-05'] = 'passed'
                report = project_report(report)
                encoded = redactor.check_report(report)
                output.parent.mkdir(parents=True, exist_ok=True)
                output.mkdir(mode=0o700)
                exclusive_file(output / 'report.json', encoded.encode())
        except (Exception, KeyboardInterrupt) as exc:
            report['result'] = 'failed'
            report['phase'] = 'evidence'
            report['evidence_file_written'] = False
            report['acceptance']['M6-05'] = 'not_run'
            report['evidence_write_error'] = error_category(exc, 'evidence')
    # A malformed optional observation cannot leak through fallback stdout.
    try:
        report = project_report(report)
        encoded = redactor.check_report(report)
    except Exception:
        failed = safe_base
        failed.update(result='failed', phase='evidence', evidence_file_written=False, error='schema')
        if type(report.get('scope_removed')) is bool:
            failed['scope_removed'] = report['scope_removed']
        try:
            failed['retries'] = project_retries(report.get('retries'))
        except Exception:
            pass
        report = failed
        encoded = redactor.check_report(project_report(report))
    print(encoded, end='', flush=True)
    return 0 if report['result'] == 'passed' else 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--cache', default=str(HERE / '.lab-cache'))
    parser.add_argument('--output', default=str(HERE / '.lab-runs' / ('retry-' + time.strftime('%Y%m%dT%H%M%SZ', time.gmtime()))))
    return integration(parser.parse_args())


if __name__ == '__main__':
    raise SystemExit(main())

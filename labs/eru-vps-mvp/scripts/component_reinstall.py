"""Bounded selected-worker reinstall with continuous HTTP guards and retained recovery."""
import base64
import hashlib
import gzip
import io
import json
from pathlib import Path
import subprocess
import sys
import tarfile
import time
import urllib.request

from labops import atomic_json, digest, lock_fds
from worker_scope import REINSTALL_FILES
from canaries import HTTPGuards

TARGET = 'worker-4'
ALIAS = 'ckc-disposable-04'
WORKERS = {'worker-2': 'ckc-disposable-02', 'worker-3': 'ckc-disposable-03', TARGET: ALIAS}
UNITS = ['eru-agent.service', 'eru-containerd-proxy.socket', 'eru-containerd-proxy.service']


def empty_target(snapshot, target=TARGET, alias=ALIAS):
    node = next(n for n in snapshot['nodes'] if n['name'] == target)
    def nonzero(value):
        if isinstance(value, dict):
            return any(nonzero(v) for v in value.values())
        if isinstance(value, list):
            return any(nonzero(v) for v in value)
        return isinstance(value, (int, float)) and value != 0
    host = snapshot['hosts'][alias]
    task_ids = [line.split()[0] for line in host['tasks'].splitlines()[1:] if line.strip()]
    if any(w['nodename'] == target for w in snapshot['workloads']) or host['containers'] or task_ids or nonzero(json.loads(node['resource_usage'])):
        raise ValueError(target + ' must have empty metadata, containers/tasks and zero usage')
    return node


def protected_membership(snapshot, target=TARGET, alias=ALIAS):
    return {
        'pods': sorted(snapshot['pods'], key=lambda p: p['name']),
        'nodes': sorted([{k: n.get(k) for k in ['name', 'podname', 'endpoint', 'labels', 'resource_capacity', 'resource_usage', 'available', 'bypass']}
                  for n in snapshot['nodes'] if n['name'] != target], key=lambda n: n['name']),
        'workloads': sorted([w for w in snapshot['workloads'] if w['nodename'] != target], key=lambda w: w['id']),
        'hosts': {k: v for k, v in snapshot['hosts'].items() if k != alias},
    }


class ComponentReinstall:
    def __init__(self, operator, guard_factory=HTTPGuards, target=TARGET):
        if target not in WORKERS:
            raise ValueError('unreviewed worker target')
        self.target = target
        self.alias = WORKERS[target]
        self.op = operator
        self.guard_factory = guard_factory
        self.guards = None
        self.resume_attempted = False

    def stage(self, name):
        if self.guards: self.guards.check()
        self.op.stage(name)

    def command(self, *args, **kwargs):
        if self.guards: self.guards.check()
        result = self.op.command(*args, **kwargs)
        if self.guards: self.guards.check()
        return result

    def execute(self, plan, before):
        if not plan.get('executable'):
            raise ValueError('review-only plan cannot execute')
        guard = self.guard_factory(self.op.project, plan['id'], plan['worker_readiness']['canaries'])
        try:
            with guard:
                self.guards = guard
                self.execute_steps(plan, before)
                guard.check()
            if guard.summary['failures']:
                raise ValueError('HTTP failure observed before guard shutdown')
            self.record_revision(plan, before)
        except BaseException:
            if self.resume_attempted:
                # A lost up response may have enabled scheduling. One distinct
                # corrective fence attempt is journaled; neither command is retried.
                self.op.stage('refencing-after-resume-failure')
                self.op.journal['resume_recovery'] = 'uncertain'
                self.op.save_journal()
                try:
                    self.fence(corrective=True)
                    self.op.journal['resume_recovery'] = 'fenced'
                except Exception as exc:
                    self.op.journal['resume_recovery_error'] = str(exc)
            raise
        finally:
            self.op.journal['http_guards'] = getattr(guard, 'summary', {'error': 'observer did not start'})
            self.op.save_journal()
            self.guards = None


    def service_baseline(self):
        result = {}
        for host in self.op.inventory:
            units = ['docker.service', 'containerd.service', 'ssh.service', 'tailscaled.service']
            if host['role'] == 'core':
                units += ['eru-core.service', 'eru-etcd.service', 'eru-mvp-firewall.service']
            elif host['alias'] != self.alias:
                units += UNITS
            result[host['alias']] = self.command(host['alias'], ['sudo', '-n', 'systemctl', 'show',
                '--property=Id,ActiveState,SubState,MainPID,InvocationID,NRestarts,ExecMainStartTimestampMonotonic', *units])
        return result

    def remote(self, action, plan, files=None, extra=None):
        config = {'action': action, 'run_id': plan['id'], 'node': self.target,
                  'machine_id': plan['snapshot']['hosts'][self.alias]['machine_id'],
                  'manifest_sha256': plan['component_scope']['manifest_sha256']}
        if extra:
            config.update(extra)
        if files is not None:
            config['files'] = {k: base64.b64encode(v).decode() for k, v in files.items()}
        # Ship only reviewed modules in memory; no persistent helper or keys.
        source = 'import types,sys\n'
        for name in ['labops', 'worker_scope', 'worker_reinstall']:
            code = (self.op.project / 'scripts' / (name + '.py')).read_text()
            source += f'm=types.ModuleType({name!r});sys.modules[{name!r}]=m;exec({code!r},m.__dict__)\n'
        source += 'import json,gzip,base64;sys.modules["worker_reinstall"].remote_main(json.loads(gzip.decompress(base64.b64decode(sys.stdin.read()))))\n'
        payload = base64.b64encode(gzip.compress(json.dumps(config).encode(), mtime=0)).decode()
        return json.loads(self.command(self.alias, ['sudo', '-n', 'python3', '-c', 'import ast;exec(ast.literal_eval(input()))'],
                                       repr(source) + '\n' + payload, timeout=300 if files else 90))

    def payload(self, plan):
        rows = json.loads((self.op.project / 'private/deployment-plan.json').read_text())
        row = next(r for r in rows if r['alias'] == self.alias and r['node'] == self.target and r['role'] == 'worker')
        files = {f['path']: f['content'].encode() for f in row['files'] if f['path'] in REINSTALL_FILES}
        lock = json.loads((self.op.project / 'artifacts.amd64.lock.json').read_text())
        artifact = next(a for a in lock['artifacts'] if a['repository'] == 'projecteru2/agent')
        with urllib.request.urlopen(artifact['url'], timeout=30) as response:
            archive = response.read(128 * 1024 * 1024 + 1)
        if hashlib.sha256(archive).hexdigest() != artifact['sha256']:
            raise ValueError('agent archive checksum mismatch')
        with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
            members = [m for m in tar.getmembers() if m.isfile() and Path(m.name).name == 'eru-agent']
            if len(members) != 1 or members[0].size > 128 * 1024 * 1024:
                raise ValueError('ambiguous agent archive member')
            files['/usr/local/bin/eru-agent'] = tar.extractfile(members[0]).read()
        expected = {f['path']: f['sha256'] for f in plan['component_scope']['files_to_reinstall']}
        if set(files) != set(REINSTALL_FILES) or {k: hashlib.sha256(v).hexdigest() for k, v in files.items()} != expected:
            raise ValueError('pinned installer payload differs from audited worker files')
        return files

    def fence(self, corrective=False):
        call = self.op.command if corrective else self.command
        call(self.op.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
            '--eru', self.op.core['ip'] + ':5001', 'node', 'down', self.target])
        node = next(n for n in self.op.cli('node', 'get', self.target) if n['name'] == self.target)
        if not node.get('bypass'):
            raise ValueError(self.target + ' scheduling fence was not observed')

    def check_isolation(self, before, services):
        after = self.op.snapshot()
        self.op.journal['isolation_observed'] = after
        self.op.save_journal()
        if protected_membership(before, self.target, self.alias) != protected_membership(after, self.target, self.alias):
            raise ValueError('unrelated worker/control-plane state changed')
        # Worker host/OS and shared runtime identities must be retained as well.
        for key in ['machine_id', 'boot_id', 'hostname', 'tailscale', 'docker', 'ssh_config_hash', 'trusted_hostkeys_hash']:
            if before['hosts'][self.alias][key] != after['hosts'][self.alias][key]:
                raise ValueError('preserved worker identity/runtime changed: ' + key)
        if self.service_baseline() != services:
            raise ValueError('preserved service invocation/state changed')
        empty_target(after, self.target, self.alias)
        return after

    def run_smoke(self):
        directory = self.op.project / 'private/smoke'
        before = {p.name for p in directory.glob('*.json')}
        log = self.op.root / 'runs' / (self.op.journal['id'] + '-worker-smoke.log')
        self.op.journal['smoke_log'] = str(log.relative_to(self.op.project))
        self.op.save_journal()
        with log.open('w') as stream:
            result = subprocess.run([sys.executable, str(self.op.project / 'scripts/smoke-lab.py'),
                                     '--node', self.target], stdout=stream, stderr=subprocess.STDOUT,
                                    pass_fds=lock_fds())
        added = [p for p in directory.glob('*.json') if p.name not in before]
        self.op.journal['smoke_evidence'] = [p.name for p in added]
        self.op.save_journal()
        if result.returncode or len(added) != 1:
            raise RuntimeError('worker smoke failed or outcome uncertain; target stays fenced')
        evidence = json.loads(added[0].read_text())
        if not evidence.get('pass') or set(evidence.get('nodes', {})) != {self.target}:
            raise ValueError('worker smoke evidence did not pass')

    def execute_steps(self, plan, before):
        if not plan.get('executable'):
            raise ValueError('review-only plan cannot execute')
        if plan['node'] != self.target or plan['rebuild_mode'] != 'component-reinstall':
            raise ValueError('plan target differs from selected component executor')
        empty_target(before, self.target, self.alias)
        scope = self.op.worker_scope(self.alias)
        if scope['blockers'] or scope['manifest_sha256'] != plan['component_scope']['manifest_sha256']:
            raise ValueError('worker scope changed')
        self.stage('preparing-worker-payload')
        files = self.payload(plan)  # finish downloads/checks before fencing or stopping
        services = self.service_baseline()
        self.op.journal['preserved_services'] = services
        self.op.save_journal()
        self.stage('fencing-' + self.target)
        # Failure/timeout leaves an uncertain fence; never automatically node up.
        self.fence()
        self.stage('stopping-' + self.target)
        self.command(self.alias, ['sudo', '-n', 'systemctl', 'stop', *UNITS])
        current = self.op.snapshot()
        node = empty_target(current, self.target, self.alias)
        if not node.get('bypass'):
            raise ValueError('scheduling fence lost after stopping')
        self.stage('quarantining-' + self.target)
        self.op.journal['quarantine'] = self.remote('quarantine', plan)
        self.op.save_journal()
        if plan.get('fault_after') == 'quarantine':
            raise RuntimeError('planned recovery drill stopped after quarantine; create a recovery plan')
        self.stage('installing-' + self.target)
        self.op.journal['installation'] = self.remote('install', plan, files)
        self.op.save_journal()
        self.command(self.alias, ['sudo', '-n', 'systemd-analyze', 'verify',
            *['/etc/systemd/system/' + u for u in UNITS]])
        self.command(self.alias, ['sudo', '-n', 'systemctl', 'daemon-reload'])
        self.command(self.alias, ['sudo', '-n', 'systemctl', 'start', 'eru-containerd-proxy.socket', 'eru-agent.service'])
        self.command(self.alias, ['sudo', '-n', 'systemctl', 'is-active', 'eru-containerd-proxy.socket', 'eru-agent.service'])
        self.stage('verifying-' + self.target)
        for _ in range(30):
            node = next(n for n in self.op.cli('node', 'get', self.target) if n['name'] == self.target)
            if node['available'] and node.get('bypass'):
                break
            time.sleep(1)
        else:
            raise ValueError('worker did not become available while fenced')
        if plan.get('fault_after') == 'start':
            raise RuntimeError('planned recovery drill stopped after start; preserve new state and create a recovery plan')
        # Pinned upstream single-node Includes path permits targeted validation
        # while Bypass excludes this node from general scheduling. Do not node up.
        self.run_smoke()
        after = self.check_isolation(before, services)
        node = empty_target(after, self.target, self.alias)
        if not node.get('bypass') or not node['available']:
            raise ValueError('target must be healthy and still fenced after smoke')
        original = empty_target(before, self.target, self.alias)
        for key in ['name', 'podname', 'endpoint', 'labels', 'resource_capacity']:
            if node[key] != original[key]:
                raise ValueError('worker registration changed')
        self.stage('resuming-' + self.target)
        self.resume_attempted = True
        self.command(self.op.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
            '--eru', self.op.core['ip'] + ':5001', 'node', 'up', self.target])
        after = self.check_isolation(before, services)
        if empty_target(after, self.target, self.alias).get('bypass'):
            raise ValueError('target remained fenced after resume; reconcile')
        self.op.journal['after'] = after

    def record_revision(self, plan, before):
        revisions = self.op.root / 'worker-component-revisions.json'
        prior = json.loads(revisions.read_text()) if revisions.exists() else {}
        old = prior.get(self.target, {}).get('revision', 0)
        prior[self.target] = {'revision': old + 1, 'run': plan['id'],
                         'machine_id': before['hosts'][self.alias]['machine_id'],
                         'generation': plan['bindings']['cluster']['generation']}
        atomic_json(revisions, prior)
        self.op.journal['component_revision'] = old + 1

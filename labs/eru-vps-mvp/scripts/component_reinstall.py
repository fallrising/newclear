"""Worker-4 state-machine prototype; intentionally not wired to labctl execute.

Continuous HTTP canaries and validated control-plane readiness are required
before integration. All remote commands use Operator aliases.
"""
import base64
import hashlib
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

TARGET = 'worker-4'
ALIAS = 'ckc-disposable-04'
UNITS = ['eru-agent.service', 'eru-containerd-proxy.socket', 'eru-containerd-proxy.service']


def empty_target(snapshot):
    node = next(n for n in snapshot['nodes'] if n['name'] == TARGET)
    def nonzero(value):
        if isinstance(value, dict):
            return any(nonzero(v) for v in value.values())
        if isinstance(value, list):
            return any(nonzero(v) for v in value)
        return isinstance(value, (int, float)) and value != 0
    host = snapshot['hosts'][ALIAS]
    task_ids = [line.split()[0] for line in host['tasks'].splitlines()[1:] if line.strip()]
    if any(w['nodename'] == TARGET for w in snapshot['workloads']) or host['containers'] or task_ids or nonzero(json.loads(node['resource_usage'])):
        raise ValueError('worker-4 must have empty metadata, containers/tasks and zero usage')
    return node


def protected_membership(snapshot):
    return {
        'pods': snapshot['pods'],
        'nodes': [{k: n.get(k) for k in ['name', 'podname', 'endpoint', 'labels', 'resource_capacity', 'resource_usage', 'available', 'bypass']}
                  for n in snapshot['nodes'] if n['name'] != TARGET],
        'workloads': [w for w in snapshot['workloads'] if w['nodename'] != TARGET],
        'hosts': {k: v for k, v in snapshot['hosts'].items() if k != ALIAS},
    }


class ComponentReinstall:
    def __init__(self, operator):
        self.op = operator

    def service_baseline(self):
        result = {}
        for host in self.op.inventory:
            units = ['docker.service', 'containerd.service', 'ssh.service', 'tailscaled.service']
            if host['role'] == 'core':
                units += ['eru-core.service', 'eru-etcd.service', 'eru-mvp-firewall.service']
            elif host['alias'] != ALIAS:
                units += UNITS
            result[host['alias']] = self.op.command(host['alias'], ['sudo', '-n', 'systemctl', 'show',
                '--property=Id,ActiveState,SubState,MainPID,InvocationID,NRestarts,ExecMainStartTimestampMonotonic', *units])
        return result

    def remote(self, action, plan, files=None):
        config = {'action': action, 'run_id': plan['id'], 'node': TARGET,
                  'machine_id': plan['snapshot']['hosts'][ALIAS]['machine_id'],
                  'manifest_sha256': plan['component_scope']['manifest_sha256']}
        if files is not None:
            config['files'] = {k: base64.b64encode(v).decode() for k, v in files.items()}
        # Ship only reviewed modules in memory; no persistent helper or keys.
        source = 'import types,sys\n'
        for name in ['labops', 'worker_scope', 'worker_reinstall']:
            code = (self.op.project / 'scripts' / (name + '.py')).read_text()
            source += f'm=types.ModuleType({name!r});sys.modules[{name!r}]=m;exec({code!r},m.__dict__)\n'
        source += 'sys.modules["worker_reinstall"].remote_main(' + repr(config) + ')\n'
        return json.loads(self.op.command(ALIAS, ['sudo', '-n', 'python3', '-'], source))

    def payload(self, plan):
        rows = json.loads((self.op.project / 'private/deployment-plan.json').read_text())
        row = next(r for r in rows if r['alias'] == ALIAS and r['node'] == TARGET and r['role'] == 'worker')
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

    def fence(self):
        self.op.command(self.op.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
            '--eru', self.op.core['ip'] + ':5001', 'node', 'down', TARGET])
        node = next(n for n in self.op.cli('node', 'get', TARGET) if n['name'] == TARGET)
        if not node.get('bypass'):
            raise ValueError('worker-4 scheduling fence was not observed')

    def check_isolation(self, before, services):
        after = self.op.snapshot()
        if protected_membership(before) != protected_membership(after):
            raise ValueError('unrelated worker/control-plane state changed')
        # Worker host/OS and shared runtime identities must be retained as well.
        for key in ['machine_id', 'boot_id', 'hostname', 'tailscale', 'docker', 'ssh_config_hash', 'trusted_hostkeys_hash']:
            if before['hosts'][ALIAS][key] != after['hosts'][ALIAS][key]:
                raise ValueError('preserved worker identity/runtime changed: ' + key)
        if self.service_baseline() != services:
            raise ValueError('preserved service invocation/state changed')
        empty_target(after)
        return after

    def run_smoke(self):
        directory = self.op.project / 'private/smoke'
        before = {p.name for p in directory.glob('*.json')}
        log = self.op.root / 'runs' / (self.op.journal['id'] + '-worker-smoke.log')
        self.op.journal['smoke_log'] = str(log.relative_to(self.op.project))
        self.op.save_journal()
        with log.open('w') as stream:
            result = subprocess.run([sys.executable, str(self.op.project / 'scripts/smoke-lab.py'),
                                     '--node', TARGET], stdout=stream, stderr=subprocess.STDOUT,
                                    pass_fds=lock_fds())
        added = [p for p in directory.glob('*.json') if p.name not in before]
        self.op.journal['smoke_evidence'] = [p.name for p in added]
        self.op.save_journal()
        if result.returncode or len(added) != 1:
            raise RuntimeError('worker smoke failed or outcome uncertain; target stays fenced')
        evidence = json.loads(added[0].read_text())
        if not evidence.get('pass') or set(evidence.get('nodes', {})) != {TARGET}:
            raise ValueError('worker smoke evidence did not pass')

    def execute(self, plan, before):
        if not plan.get('executable'):
            raise ValueError('review-only plan cannot execute')
        if plan['node'] != TARGET or plan['rebuild_mode'] != 'component-reinstall':
            raise ValueError('only worker-4 component reinstall is executable')
        empty_target(before)
        scope = self.op.worker_scope(ALIAS)
        if scope['blockers'] or scope['manifest_sha256'] != plan['component_scope']['manifest_sha256']:
            raise ValueError('worker scope changed')
        self.op.stage('preparing-worker-payload')
        files = self.payload(plan)  # finish downloads/checks before fencing or stopping
        services = self.service_baseline()
        self.op.journal['preserved_services'] = services
        self.op.save_journal()
        self.op.stage('fencing-worker-4')
        # Failure/timeout leaves an uncertain fence; never automatically node up.
        self.fence()
        self.op.stage('stopping-worker-4')
        self.op.command(ALIAS, ['sudo', '-n', 'systemctl', 'stop', *UNITS])
        current = self.op.snapshot()
        node = empty_target(current)
        if not node.get('bypass'):
            raise ValueError('scheduling fence lost after stopping')
        self.op.stage('quarantining-worker-4')
        self.op.journal['quarantine'] = self.remote('quarantine', plan)
        self.op.save_journal()
        self.op.stage('installing-worker-4')
        self.op.journal['installation'] = self.remote('install', plan, files)
        self.op.save_journal()
        self.op.command(ALIAS, ['sudo', '-n', 'systemd-analyze', 'verify',
            *['/etc/systemd/system/' + u for u in UNITS]])
        self.op.command(ALIAS, ['sudo', '-n', 'systemctl', 'daemon-reload'])
        self.op.command(ALIAS, ['sudo', '-n', 'systemctl', 'start', 'eru-containerd-proxy.socket', 'eru-agent.service'])
        self.op.command(ALIAS, ['sudo', '-n', 'systemctl', 'is-active', 'eru-containerd-proxy.socket', 'eru-agent.service'])
        self.op.stage('verifying-worker-4')
        # Pinned upstream single-node Includes path permits targeted validation
        # while Bypass excludes this node from general scheduling. Do not node up.
        self.run_smoke()
        after = self.check_isolation(before, services)
        node = empty_target(after)
        if not node.get('bypass') or not node['available']:
            raise ValueError('target must be healthy and still fenced after smoke')
        original = empty_target(before)
        for key in ['name', 'podname', 'endpoint', 'labels', 'resource_capacity']:
            if node[key] != original[key]:
                raise ValueError('worker registration changed')
        self.op.stage('resuming-worker-4')
        self.op.command(self.op.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
            '--eru', self.op.core['ip'] + ':5001', 'node', 'up', TARGET])
        after = self.check_isolation(before, services)
        if empty_target(after).get('bypass'):
            raise ValueError('target remained fenced after resume; reconcile')
        revisions = self.op.root / 'worker-component-revisions.json'
        prior = json.loads(revisions.read_text()) if revisions.exists() else {}
        old = prior.get(TARGET, {}).get('revision', 0)
        prior[TARGET] = {'revision': old + 1, 'run': plan['id'],
                         'machine_id': before['hosts'][ALIAS]['machine_id'],
                         'generation': plan['bindings']['cluster']['generation']}
        atomic_json(revisions, prior)
        self.op.journal['component_revision'] = old + 1
        self.op.journal['after'] = after

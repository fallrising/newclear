#!/usr/bin/env python3
"""Plan and execute a validated core-only patch (or explicit binary rollback)."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import gzip
import json
import os
from pathlib import Path
import subprocess
import time
import uuid

from labctl import Operator, PROJECT, code_inputs, consistency_issues, identifier, membership, now, read
from labops import ClusterLock, atomic_json, digest

ALIAS = 'ckc-disposable-01'
PROTECTED_UNITS = ['eru-etcd', 'docker', 'containerd', 'ssh', 'tailscaled', 'eru-mvp-firewall']


def readiness(report, at=None):
    """A bounded functional trial gate; disk performance recommendations stay visible."""
    at = time.time() if at is None else at
    samples = report.get('samples', [])
    from control_health import summarize
    summary = summarize(samples)
    issues = [f for f in summary['findings'] if not ('candidate threshold' in f or 'no observations' in f)]
    if report.get('status') != 'complete' or len(samples) < 20 or summary['duration_seconds'] < 120:
        issues.append('need at least 20 completed observations over 120 seconds')
    if not samples or not 0 <= at - samples[-1]['time'] <= 600:
        issues.append('control observation is stale or from the future')
    if any(not 0 < b['time'] - a['time'] <= 20 for a, b in zip(samples, samples[1:])):
        issues.append('observation gaps exceed the journal coverage window')
    for sample in samples:
        text = sample.get('commands', {}).get('services', {}).get('stdout', '')
        states = [line for line in text.splitlines() if line.startswith('ActiveState=')]
        if len(states) != 4 or any(line != 'ActiveState=active' for line in states):
            issues.append('core/etcd/shared runtime services must be active')
            break
    return {'eligible_for_bounded_trial': not issues, 'blockers': issues,
            'performance_findings': [f for f in summary['findings'] if f not in issues],
            'summary': summary}


def artifact(project, name):
    path = (project / name).resolve()
    if not path.is_relative_to((project / 'private/builds').resolve()):
        raise ValueError('artifact must be in the private build directory')
    verified = read(project / 'patches/core-v0.1.5-lock-context.validation.json')
    patch = project / 'patches/core-v0.1.5-lock-context.patch'
    if hashlib.sha256(patch.read_bytes()).hexdigest() != verified['patch_sha256']:
        raise ValueError('patch has changed since validation')
    data = path.read_bytes()
    if not data.startswith(b'\x7fELF') or hashlib.sha256(data).hexdigest() != verified['artifact_sha256']:
        raise ValueError('binary is not the independently validated core artifact')
    return data, verified['artifact_sha256']


class PatchOperator(Operator):
    def remote(self, config):
        source = 'import types,sys\n'
        for name in ['labops', 'worker_scope', 'worker_reinstall', 'core_update']:
            code = (self.project / 'scripts' / (name + '.py')).read_text()
            source += f'm=types.ModuleType({name!r});sys.modules[{name!r}]=m;exec({code!r},m.__dict__)\n'
        source += 'import json;sys.modules["core_update"].remote_main(json.load(sys.stdin))\n'
        # Read the reviewed small program first; parse the large payload as JSON,
        # avoiding compilation of a binary-sized Python string literal on the VPS.
        stdin = repr(source) + '\n' + json.dumps(config)
        return json.loads(self.command(ALIAS, ['sudo', '-n', 'python3', '-c', 'import ast;exec(ast.literal_eval(input()))'], stdin, timeout=300 if 'payload' in config else 90))

    def protected_services(self):
        result = {}
        for host in self.inventory:
            units = PROTECTED_UNITS if host['role'] == 'core' else [
                'docker', 'containerd', 'ssh', 'tailscaled', 'eru-agent', 'eru-containerd-proxy.socket', 'eru-containerd-proxy.service']
            result[host['alias']] = self.command(host['alias'], ['sudo', '-n', 'systemctl', 'show',
                '--property=Id,ActiveState,SubState,MainPID,InvocationID,NRestarts', *units])
        return result

    def core_runtime(self):
        source = '''import subprocess,hashlib,json
from pathlib import Path
p=subprocess.run(['systemctl','show','eru-core','--property=MainPID,ActiveState,InvocationID,NRestarts'],capture_output=True,text=True,check=True)
r=dict(line.split('=',1) for line in p.stdout.splitlines())
if r['ActiveState']!='active' or int(r['MainPID'])<=0:raise RuntimeError('core is not active')
r['sha256']=hashlib.sha256(Path('/proc',r['MainPID'],'exe').read_bytes()).hexdigest()
print(json.dumps(r))
'''
        return json.loads(self.command(ALIAS, ['sudo', '-n', 'python3', '-'], source))

    def make_plan(self, build, health_file, rollback_run=None):
        snapshot = self.snapshot()
        issues = consistency_issues(snapshot, self.inventory)
        if snapshot['workloads']:
            issues.append('first core patch trial requires no live ERU workloads')
        if self.health()['exit_code']:
            issues.append('etcd health failed')
        gate = readiness(read(self.project / health_file))
        issues += gate['blockers']
        machine = snapshot['hosts'][ALIAS]['machine_id']
        footprint = self.remote({'action': 'inspect', 'machine_id': machine})
        if rollback_run:
            source = read(self.root / 'plans' / (identifier(rollback_run) + '.json'))['plan']
            if source['operation'] != 'core-patch' or source['snapshot']['hosts'][ALIAS]['machine_id'] != machine:
                raise ValueError('rollback must reference a core patch on this same host')
            checksum = source['footprint']['binary']['sha256']
        else:
            _, checksum = artifact(self.project, build)
        plan = {'id': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8],
                'operation': 'core-rollback' if rollback_run else 'core-patch', 'created_at': now(),
                'artifact': build, 'sha256': checksum, 'rollback_run': rollback_run,
                'health_file': health_file, 'health_sha256': digest(read(self.project / health_file)),
                'readiness': gate, 'snapshot': snapshot, 'footprint': footprint,
                'bindings': {'inputs': code_inputs(self.project), 'inventory': self.inventory, 'cluster': self.cluster()},
                'protected_services': self.protected_services(), 'core_runtime': self.core_runtime(),
                'mutation_hosts': [ALIAS], 'steps': ['Verify fresh health, empty workloads and hashes',
                    'Back up the owned core binary and manifest; atomically replace only that binary',
                    'Restart only eru-core; verify running binary, API and preserved services'],
                'executable': not issues, 'blockers': issues}
        envelope = {'plan': plan, 'sha256': digest(plan)}
        atomic_json(self.root / 'plans' / (plan['id'] + '.json'), envelope)
        atomic_json(self.root / 'observations' / (plan['id'] + '.json'), self.events)
        return envelope

    def apply_plan(self, plan_id, checksum):
        envelope = read(self.root / 'plans' / (identifier(plan_id) + '.json'))
        plan = envelope['plan']
        if digest(plan) != checksum or checksum != envelope['sha256'] or not plan['executable']:
            raise ValueError('invalid hash or blocked plan')
        if plan['operation'] not in ['core-patch', 'core-rollback']:
            raise ValueError('not a core update plan')
        self.journal_path = self.root / 'runs' / (plan_id + '.json')
        if self.journal_path.exists():
            raise ValueError('run exists; reconcile and create a new plan, never replay')
        self.journal = {'id': plan_id, 'operation': plan['operation'], 'plan_hash': checksum,
                        'status': 'running', 'started_at': now(), 'controller_pid': os.getpid(), 'events': []}
        self.stage('preflight')
        try:
            if plan['bindings'] != {'inputs': code_inputs(self.project), 'inventory': self.inventory, 'cluster': self.cluster()}:
                raise ValueError('bound inputs changed')
            report = read(self.project / plan['health_file'])
            if digest(report) != plan['health_sha256'] or not readiness(report)['eligible_for_bounded_trial']:
                raise ValueError('health evidence changed or became stale')
            before = self.snapshot()
            if consistency_issues(before, self.inventory) or before['workloads'] or self.health()['exit_code']:
                raise ValueError('cluster is unhealthy or has live workloads')
            if before['hosts'] != plan['snapshot']['hosts'] or membership(before) != membership(plan['snapshot']):
                raise ValueError('host/runtime/membership drift')
            if self.protected_services() != plan['protected_services'] or self.core_runtime() != plan['core_runtime']:
                raise ValueError('service identity changed')
            config = {'action': 'inspect', 'machine_id': before['hosts'][ALIAS]['machine_id']}
            if self.remote(config) != plan['footprint']:
                raise ValueError('remote core files changed')
            config.update(id=plan_id)
            if plan['rollback_run']:
                config.update(action='rollback', source_run=plan['rollback_run'])
            else:
                data, verified = artifact(self.project, plan['artifact'])
                if verified != plan['sha256']:
                    raise ValueError('artifact changed')
                config.update(action='install', expected=plan['footprint'], sha256=verified,
                              payload=base64.b64encode(gzip.compress(data, mtime=0)).decode(), payload_encoding='gzip-base64')
            self.stage('replacing-core-binary')
            self.journal['remote_update'] = self.remote(config)
            self.save_journal()
            self.stage('restarting-core-only')
            self.command(ALIAS, ['sudo', '-n', 'systemctl', 'restart', 'eru-core.service'])
            self.stage('verifying-core')
            # Readiness queries may repeat; mutation commands never repeat.
            last_error = None
            for _ in range(15):
                try:
                    runtime = self.core_runtime()
                    if runtime['sha256'] != plan['sha256']:
                        raise ValueError('running core executable checksum mismatch')
                    after = self.snapshot()
                    if self.health()['exit_code'] or consistency_issues(after, self.inventory):
                        raise ValueError('post-update health failed')
                    break
                except Exception as exc:
                    last_error = exc
                    time.sleep(1)
            else:
                raise RuntimeError('core did not become ready') from last_error
            if runtime['InvocationID'] == plan['core_runtime']['InvocationID']:
                raise ValueError('core restart was not observed')
            if after['hosts'] != before['hosts'] or membership(after) != membership(before):
                raise ValueError('preserved host/runtime/membership changed')
            if self.protected_services() != plan['protected_services']:
                raise ValueError('protected service state changed')
            self.journal.update(after=after, core_runtime=runtime, status='complete', finished_at=now())
            atomic_json(self.root / 'core-revision.json', {'operation': plan['operation'], 'run': plan_id,
                        'artifact_sha256': plan['sha256'], 'core_runtime': runtime})
            self.stage('complete')
        except BaseException as exc:
            self.journal.update(status='failed', failed_at=self.journal['stage'], error=str(exc), finished_at=now())
            self.save_journal()
            raise
        return self.journal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--artifact')
    plan.add_argument('--rollback-run')
    plan.add_argument('--health', required=True)
    execute = sub.add_parser('execute')
    execute.add_argument('--plan', required=True)
    execute.add_argument('--sha256', required=True)
    args = parser.parse_args()
    with ClusterLock(PROJECT):
        op = PatchOperator()
        if args.command == 'plan':
            if bool(args.artifact) == bool(args.rollback_run):
                parser.error('provide exactly one of --artifact or --rollback-run')
            result = op.make_plan(args.artifact, args.health, args.rollback_run)
            print(json.dumps({k: result['plan'][k] for k in ['id', 'operation', 'mutation_hosts', 'steps', 'executable', 'blockers']}, indent=2))
            print('Plan SHA256:', result['sha256'])
        else:
            result = op.apply_plan(args.plan, args.sha256)
            print(json.dumps({k: result[k] for k in ['id', 'operation', 'status', 'stage']}, indent=2))


if __name__ == '__main__':
    main()

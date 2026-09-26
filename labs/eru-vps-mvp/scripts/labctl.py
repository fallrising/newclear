#!/usr/bin/env python3
"""Plan, execute and reconcile bounded ERU lab operations from controller B."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import uuid

from labops import ClusterLock, atomic_json, digest, lock_fds

PROJECT = Path(__file__).resolve().parent.parent
ALIASES = [f'ckc-disposable-{i:02d}' for i in range(1, 5)]
OWNER = 'eru-vps-mvp'

# Read-only commands; no key material, config secrets or environment dumps.
FACTS = '''import json,subprocess
from pathlib import Path
r={'machine_id':Path('/etc/machine-id').read_text().strip()}
for name,argv in {
 'hostname':['hostname'],
 'boot_id':['cat','/proc/sys/kernel/random/boot_id'],
 'tailscale':['tailscale','ip','-4'],
 'containers':['ctr','--namespace','eru','containers','list','-q'],
 'tasks':['ctr','--namespace','eru','tasks','list'],
 'docker':['docker','ps','-aq'],
}.items():
 p=subprocess.run(argv,capture_output=True,text=True,timeout=20)
 if p.returncode:raise RuntimeError(name+': '+p.stderr)
 r[name]=p.stdout.strip()
r['core_config']=Path('/etc/eru/core.yaml').exists()
r['etcd_data']=Path('/var/lib/etcd-eru-mvp').exists()
r['owner']=json.loads(Path('/var/lib/eru-mvp/owner.json').read_text())['owner']
print(json.dumps(r))
'''


def now():
    return datetime.now(timezone.utc).isoformat()


def identifier(value):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', value):
        raise ValueError('invalid record ID')
    return value


def read(path):
    return json.loads(Path(path).read_text())


def code_inputs(project):
    files = list((project / 'scripts').glob('*.py'))
    files += list((project / 'patches').glob('*.patch'))
    files += list((project / 'patches').glob('*.validation.json'))
    files += [project / x for x in ['artifacts.amd64.lock.json', 'upstream.lock.json',
              'private/deployment-plan.json', 'private/verified-host-public-keys.json']]
    files += sorted((project / 'private/preflight').glob('*.json'))
    revision = project / 'private/operations/core-revision.json'
    if revision.exists():
        files.append(revision)
    return {str(f.relative_to(project)): hashlib.sha256(f.read_bytes()).hexdigest() for f in sorted(files)}


def load_inventory(project):
    rows = read(project / 'private/deployment-plan.json')
    if [r['alias'] for r in rows] != ALIASES or [r['role'] for r in rows] != ['core', 'worker', 'worker', 'worker']:
        raise ValueError('only the reviewed four-host basic topology is supported')
    if [r['node'] for r in rows[1:]] != ['worker-2', 'worker-3', 'worker-4']:
        raise ValueError('unexpected worker identities')
    return [{k: r[k] for k in ['alias', 'node', 'role', 'ip']} for r in rows]


def membership(snapshot):
    return {
        'pods': sorted(x['name'] for x in snapshot['pods']),
        'nodes': sorted([{k: x[k] for k in ['name', 'podname', 'endpoint', 'available', 'labels',
                       'resource_capacity', 'resource_usage']} for x in snapshot['nodes']], key=lambda x: x['name']),
        'workloads': sorted([{k: x.get(k) for k in ['id', 'nodename', 'podname', 'labels', 'image']}
                             for x in snapshot['workloads']], key=lambda x: x['id'])}


def consistency_issues(snapshot, inventory):
    def nonzero(value):
        if isinstance(value, dict):
            return any(nonzero(x) for x in value.values())
        if isinstance(value, list):
            return any(nonzero(x) for x in value)
        return isinstance(value, (int, float)) and value != 0
    issues = []
    for host in inventory[1:]:
        node = next(x for x in snapshot['nodes'] if x['name'] == host['node'])
        expected = {x['id'] for x in snapshot['workloads'] if x['nodename'] == host['node']}
        actual = set(snapshot['hosts'][host['alias']]['containers'].splitlines())
        if actual != expected:
            issues.append(host['node'] + ': runtime and metadata workload IDs differ')
        if not expected and nonzero(json.loads(node['resource_usage'])):
            issues.append(host['node'] + ': empty node has nonzero resource usage; manual reconciliation required')
        if not node['available']:
            issues.append(host['node'] + ': node is unavailable')
    return issues


def cleanup_targets(evidence, workloads):
    run_id = identifier(evidence['run_id'])
    apps = {x['app']: node for node, x in evidence['nodes'].items()}
    if not apps or any(not re.fullmatch(r'erumvp[0-9a-f]{12}', app) for app in apps):
        raise ValueError('cleanup requires original smoke evidence with unique app names')
    result = []
    for w in workloads:
        labels = w.get('labels', {})
        matching = [app for app in apps if w['id'].startswith(app + '_')]
        if not matching:
            continue
        app = matching[0]
        if labels.get('owner') != OWNER or labels.get('run') != run_id or w['nodename'] != apps[app]:
            raise ValueError('workload ownership/run/node mismatch: ' + w['id'])
        result.append({'id': w['id'], 'node': w['nodename'], 'app': app, 'run': run_id})
    return sorted(result, key=lambda x: x['id'])


class Operator:
    def __init__(self, project=PROJECT):
        self.project = project
        self.root = project / 'private/operations'
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.trusted_hostkeys_dir = Path.home() / '.ssh/hzd-vps/known_hosts'
        self.inventory = load_inventory(project)
        self.core = self.inventory[0]
        self.events = []
        self.journal_path = None
        self.journal = None

    def command(self, host, argv, stdin=None, check=True, timeout=90,
                ssh_options=None, record_output=True):
        print(f'[{host}] {shlex.join(argv)}', flush=True)
        event = {'at': now(), 'host': host, 'argv': argv, 'status': 'started'}
        if ssh_options:
            event['ssh_options'] = list(ssh_options)
        self.events.append(event)
        self.save_journal()
        ssh_argv = ['ssh', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
            '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=10']
        if ssh_options:
            for option in ssh_options:
                if not isinstance(option, str) or not option:
                    raise ValueError('SSH options must be non-empty argument strings')
                ssh_argv += ['-o', option]
        ssh_argv += [host, shlex.join(argv)]
        try:
            p = subprocess.run(ssh_argv, input=stdin, capture_output=True, text=True,
                               timeout=timeout, pass_fds=lock_fds())
        except BaseException as exc:
            event.update(status='uncertain', error=type(exc).__name__)
            self.save_journal()
            raise
        event.update(status='complete', exit_code=p.returncode,
                     stdout=p.stdout if record_output else None, stderr=p.stderr)
        if not record_output:
            event['stdout_sha256'] = hashlib.sha256(p.stdout.encode()).hexdigest()
        self.save_journal()
        if check and p.returncode:
            raise RuntimeError(f'{host}: exit {p.returncode}: {p.stderr or p.stdout}')
        return p.stdout

    def cli(self, *argv):
        result = self.command(self.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
            '--eru', self.core['ip'] + ':5001', '--output', 'json', *argv])
        return json.loads(result) or []

    def worker_scope(self, alias):
        host = next((host for host in self.inventory if host['alias'] == alias and host['role'] == 'worker'), None)
        if host is None or host['node'] not in ('worker-2', 'worker-3', 'worker-4'):
            raise ValueError('worker audit requires a reviewed worker alias')
        source = (self.project / 'scripts/worker_scope.py').read_text()
        return json.loads(self.command(alias, ['sudo', '-n', 'python3', '-', host['node']], source))

    def health(self):
        self.command(self.core['alias'], ['sudo', '-n', '/usr/local/bin/etcdctl',
            '--endpoints=http://127.0.0.1:2379', '--command-timeout=10s', 'endpoint', 'health'], check=False)
        return {k: self.events[-1][k] for k in ['exit_code', 'stdout', 'stderr']}

    def host_snapshot(self):
        hosts = {}
        for item in self.inventory:
            alias = item['alias']
            cfg = subprocess.run(['ssh', '-G', alias], capture_output=True, text=True, check=True).stdout
            if 'user ckc\n' not in cfg:
                raise ValueError('admin SSH principal changed')
            facts = json.loads(self.command(alias, ['sudo', '-n', 'python3', '-'], FACTS))
            facts['ssh_config_hash'] = hashlib.sha256(cfg.encode()).hexdigest()
            trusted = Path.home() / '.ssh/hzd-vps/known_hosts' / alias.removeprefix('ckc-')
            facts['trusted_hostkeys_hash'] = hashlib.sha256(trusted.read_bytes()).hexdigest()
            if facts['owner'] != OWNER or item['ip'] not in facts['tailscale'].splitlines():
                raise ValueError('owner or private endpoint mismatch: ' + alias)
            if item['role'] == 'worker' and (facts['core_config'] or facts['etcd_data']):
                raise ValueError('worker also owns control-plane state: ' + alias)
            if item['role'] == 'core' and not (facts['core_config'] and facts['etcd_data']):
                raise ValueError('core identity/config mismatch')
            hosts[alias] = facts
        return hosts

    def snapshot(self):
        hosts = self.host_snapshot()
        snapshot = {'at': now(), 'hosts': hosts, 'pods': self.cli('pod', 'list'),
                    'nodes': self.cli('pod', 'nodes', 'eru'), 'workloads': self.cli('workload', 'list')}
        expected = {r['node']: 'containerd://ckc@' + r['ip'] + ':22' for r in self.inventory[1:]}
        actual = {r['name']: r['endpoint'] for r in snapshot['nodes']}
        if actual != expected or len(snapshot['nodes']) != 3:
            raise ValueError('node membership/endpoint differs from reviewed inventory')
        if any(r.get('labels', {}).get('owner') != OWNER for r in snapshot['nodes']):
            raise ValueError('node owner label mismatch')
        return snapshot

    def cluster(self):
        path = self.root / 'cluster.json'
        if not path.exists():
            atomic_json(path, {'cluster_id': OWNER, 'generation': 1, 'adopted_at': now(),
                'note': 'Adopted existing Debian basic cluster; no bootstrap or reimage performed.'})
        data = read(path)
        if data['cluster_id'] != OWNER or data['generation'] < 1:
            raise ValueError('invalid cluster generation')
        return data

    def save_journal(self):
        if self.journal_path:
            self.journal['events'] = self.events
            atomic_json(self.journal_path, self.journal)

    def stage(self, stage):
        self.journal['stage'] = stage
        self.journal.setdefault('history', []).append({'at': now(), 'stage': stage})
        self.save_journal()

    def plan(self, operation, node=None, smoke_run=None, rebuild_mode=None, health_file=None, canary_run=None, core_artifact=None, fault_after=None, guard_exclude=None, reimage_intent=None):
        if fault_after and (operation != 'rebuild-node' or node != 'worker-4' or rebuild_mode not in [None, 'component-reinstall']):
            raise ValueError('--fault-after is only for a bounded worker-4 component recovery drill')
        if fault_after not in [None, 'quarantine', 'start']:
            raise ValueError('unsupported recovery drill boundary')
        if health_file and operation not in ['rebuild-node', 'reapply']:
            raise ValueError('--health applies only to rebuild-node/reapply')
        if canary_run and operation != 'rebuild-node':
            raise ValueError('--canary-run applies only to rebuild-node')
        if core_artifact and operation != 'reapply':
            raise ValueError('--core-artifact applies only to reapply')
        if operation == 'canary-start' and node:
            raise ValueError('canary-start uses --exclude-node to select the empty target')
        if guard_exclude and operation != 'canary-start':
            raise ValueError('--exclude-node applies only to canary-start')
        if rebuild_mode and operation != 'rebuild-node':
            raise ValueError('--mode applies only to rebuild-node')
        if reimage_intent is not None and not (operation == 'rebuild-node' and rebuild_mode == 'provider-reimage'):
            raise ValueError('--reimage-intent applies only to provider-reimage rebuild-node plans')
        if rebuild_mode not in [None, 'component-reinstall', 'provider-reimage']:
            raise ValueError('unsupported rebuild mode')
        if operation == 'rebuild-node' and node not in ['worker-2', 'worker-3', 'worker-4']:
            raise ValueError('rebuild-node requires an explicit worker; core/etcd cannot use this path')
        if operation == 'cleanup' and not smoke_run:
            raise ValueError('cleanup requires --smoke-run; there is no all-workloads reset')
        if operation != 'cleanup' and smoke_run:
            raise ValueError('--smoke-run applies only to cleanup')
        if operation == 'reapply' and node:
            raise ValueError('reapply always affects all four hosts; do not specify --node')
        if operation == 'cleanup' and node:
            raise ValueError('cleanup scope comes from smoke evidence; do not specify --node')
        snap = self.snapshot()
        issues = consistency_issues(snap, self.inventory)
        if operation == 'reapply' and (self.root / 'core-revision.json').exists():
            if read(self.root / 'core-revision.json')['operation'] == 'core-patch' and not core_artifact:
                issues.append('Core uses a validated local patch; release reapply would downgrade it and is blocked')
        health = self.health()
        if health['exit_code']:
            issues.append('etcd health failed; mutations blocked')
        bindings = {'inventory': self.inventory, 'inputs': code_inputs(self.project), 'cluster': self.cluster()}
        plan = {'schema': 1, 'id': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8],
                'created_at': now(), 'operation': operation, 'node': node, 'bindings': bindings,
                'snapshot': snap, 'etcd_health': health, 'executable': operation != 'rebuild-node' and not issues, 'blockers': issues,
                'targets': [], 'steps': [], 'mutation_hosts': ALIASES if operation == 'reapply' else []}
        if operation == 'reapply' and core_artifact:
            if not health_file:
                plan['blockers'].append('patched reapply requires --health')
            else:
                from patched_reapply import gate
                plan['patched_core'] = gate(self, core_artifact, health_file, snap)
                plan['blockers'] += plan['patched_core']['blockers']
            plan['executable'] = not plan['blockers']
        if operation == 'canary-start':
            from canaries import canary_nodes
            guards = canary_nodes(guard_exclude or 'worker-4')
            plan['guard_exclude'] = guard_exclude or 'worker-4'
            plan['guard_nodes'] = list(guards)
            if snap['workloads']:
                plan['blockers'].append('initial canary setup requires empty ERU workloads')
                plan['executable'] = False
            plan['mutation_hosts'] = [self.core['alias'], *guards.values()]
            plan['steps'] = ['Create one run-owned nginx on each of ' + ', '.join(guards),
                             'Verify both HTTP endpoints; retain exact IDs for guard and cleanup plans']
        elif operation == 'cleanup':
            evidence_path = self.project / 'private/smoke' / (identifier(smoke_run) + '.json')
            evidence = read(evidence_path)
            if evidence['run_id'] != smoke_run:
                raise ValueError('smoke evidence ID mismatch')
            plan['smoke_run'] = smoke_run
            plan['smoke_evidence_hash'] = digest(evidence)
            plan['targets'] = cleanup_targets(evidence, snap['workloads'])
            plan['steps'] = ['Re-read exact workload IDs and owner/run/node labels',
                             'Remove only listed IDs', 'Verify listed IDs no longer exist']
            nodes = {x['node'] for x in plan['targets']}
            plan['mutation_hosts'] = [self.core['alias']] + [x['alias'] for x in self.inventory if x['node'] in nodes]
        elif operation in ['smoke', 'reapply']:
            plan['steps'] = ['Create run-owned nginx', 'Verify lifecycle, HTTP, resource rejection', 'Clean up run-owned workload']
            if operation == 'reapply':
                plan['steps'].insert(1, 'Apply locked inputs to four hosts; compare live nginx and service/membership snapshots')
            else:
                plan['mutation_hosts'] = [self.core['alias']] + [x['alias'] for x in self.inventory[1:] if not node or x['node'] == node]
        else:
            host = next(x for x in self.inventory if x['node'] == node)
            plan['rebuild_mode'] = rebuild_mode or 'component-reinstall'
            if fault_after:
                plan['fault_after'] = fault_after
            plan['mutation_hosts'] = [self.core['alias'], host['alias']]
            plan['targets'] = [w['id'] for w in snap['workloads'] if w['nodename'] == node]
            if plan['rebuild_mode'] == 'component-reinstall':
                scope = self.worker_scope(host['alias'])
                plan['component_scope'] = scope
                plan['blockers'] += scope['blockers']
                from component_reinstall import empty_target
                try:
                    empty_target(snap, node, host['alias'])
                except (ValueError, KeyError, StopIteration) as exc:
                    plan['blockers'].append(str(exc))
                if not health_file or not canary_run:
                    plan['blockers'].append('component reinstall requires --health and --canary-run')
                elif not plan['blockers']:
                    plan['worker_readiness'] = self.worker_readiness(health_file, canary_run, snap, node)
                    plan['blockers'] += plan['worker_readiness']['blockers']
                plan['executable'] = not plan['blockers']
                plan['steps'] = [
                    f'Require empty {node}, zero usage, healthy control plane and unchanged owned-file hashes',
                    'Save baseline of other workers and shared services; prohibit scheduling on target',
                    'Stop only target eru-agent and eru-containerd-proxy socket/service; recheck empty runtime',
                    'Record hashes and quarantine only the six listed ERU files and three state roots; retain recovery journal',
                    'Keep OS, SSH/Tailscale, Docker/containerd, shared CNI binaries, bridge, image cache and etcd',
                    'Reinstall pinned components on target only, without re-running other hosts',
                    'Verify target nginx, zero resource leaks and unchanged other workers; then allow scheduling',
                    'Record a new worker component revision; preserve cluster generation and OS identity',
                ]
            else:
                if not reimage_intent:
                    plan['blockers'].append(
                        'Manual provider-console reimage requires --reimage-intent under private/reimage-intents/')
                else:
                    try:
                        from reimage_review import load_intent
                        intent = load_intent(self.project, reimage_intent, node=node, alias=host['alias'],
                                             machine_id=snap['hosts'][host['alias']]['machine_id'])
                        plan['provider_reimage_intent'] = intent['intent']
                        plan['bindings']['provider_reimage_intent'] = {
                            'path': intent['path'], 'sha256': intent['sha256']}
                    except (OSError, ValueError, KeyError) as exc:
                        plan['blockers'].append('invalid manual reimage intent: ' + str(exc))
                if plan['targets']:
                    plan['blockers'].append(
                        'ERU workloads must be migrated and verified before provider-console reimage')
                if snap['hosts'][host['alias']]['docker']:
                    plan['blockers'].append('Docker workloads exist on target; separate ownership/migration review required')
                target_node = next(n for n in snap['nodes'] if n['name'] == node)
                target_facts = snap['hosts'][host['alias']]
                if target_node.get('bypass'):
                    plan['blockers'].append('Target is already fenced; reconcile its existing operation before planning reimage')
                task_rows = [line for line in target_facts.get('tasks', '').splitlines()
                             if line.strip() and not line.upper().startswith('TASK ')]
                if target_facts.get('containers', '').strip() or task_rows:
                    plan['blockers'].append('Selected worker ERU runtime must be empty before preparation')
                try:
                    usage = json.loads(target_node['resource_usage'])
                    def nonzero(value):
                        if isinstance(value, dict):
                            return any(nonzero(child) for child in value.values())
                        if isinstance(value, list):
                            return any(nonzero(child) for child in value)
                        return isinstance(value, (int, float)) and value != 0
                    if nonzero(usage):
                        plan['blockers'].append('Selected worker must have zero ERU resource usage before preparation')
                except (TypeError, json.JSONDecodeError, KeyError):
                    plan['blockers'].append('Selected worker resource usage is unreadable')
                prep_blockers = list(plan['blockers'])
                plan['reimage_preparation'] = {
                    'executable': not prep_blockers,
                    'blockers': prep_blockers,
                    'steps': [
                        'Revalidate the exact plan, intent, healthy core, empty worker and unchanged cluster state',
                        'Fence the selected worker and confirm Bypass on the core',
                        'Stop only the selected worker eru-agent and verify SSH/Tailscale/Docker/containerd remain active',
                        'Remove the exact ERU node registration and verify it is absent',
                        'Stop at an owner-operated provider console boundary; do not reimage via API',
                    ],
                }
                plan['blockers'] += [
                    'Owner console reimage, receipt and replacement-host verification are separate manual stages',
                    'Worker smoke, safe resume, generation commit and recovery executor are not implemented',
                ]
                plan['steps'] = [f'Quiesce {node}; enumerate and relocate owned workloads',
                    'Verify empty node/runtime; stop target agent; remove exact node registration',
                    'Pause for the owner to reimage only the bound provider resource and enumerated volumes in the console',
                    'Verify new machine/boot identity and out-of-band trusted host key; rebuild SSH/Tailscale/runtime',
                    'Install worker only; register original name/capacity; start agent',
                    'Verify target nginx and continuous HTTP on other workers; record new host incarnation']
        if fault_after:
            plan['steps'].append('Recovery drill: deliberately fail after ' + fault_after + '; keep target fenced; require a new recovery plan')
        revision = subprocess.run(['git', '-C', str(self.project), 'rev-parse', 'HEAD'], capture_output=True, text=True)
        plan['source_commit'] = revision.stdout.strip() if revision.returncode == 0 else None
        envelope = {'plan': plan, 'sha256': digest(plan)}
        atomic_json(self.root / 'plans' / (plan['id'] + '.json'), envelope)
        atomic_json(self.root / 'observations' / (plan['id'] + '.json'), self.events)
        return envelope

    def prepare_reimage(self, plan_id, expected_hash):
        from reimage_prepare import prepare_reimage
        return prepare_reimage(self, plan_id, expected_hash)

    def plan_reimage_worker(self, source_plan_id, expected_hash):
        from reimage_worker_plan import plan_reimage_worker
        return plan_reimage_worker(self, source_plan_id, expected_hash)

    def install_reimage_worker(self, bootstrap_plan_id, expected_hash):
        from reimage_worker_install import install_reimage_worker
        return install_reimage_worker(self, bootstrap_plan_id, expected_hash)

    def register_reimage_worker(self, bootstrap_plan_id, expected_hash):
        from reimage_worker_registration import register_reimage_worker
        return register_reimage_worker(self, bootstrap_plan_id, expected_hash)

    def record_reimage_receipt(self, plan_id, expected_hash, receipt_file):
        plan_id = identifier(plan_id)
        envelope = read(self.root / 'plans' / (plan_id + '.json'))
        plan = envelope.get('plan')
        if (not isinstance(plan, dict) or digest(plan) != envelope.get('sha256')
                or expected_hash != envelope.get('sha256')):
            raise ValueError('plan hash mismatch')
        from reimage_receipt import load_receipt, verify_local_hostkeys
        receipt = load_receipt(self.project, receipt_file, plan=plan, plan_sha256=expected_hash)
        from reimage_prepare import require_prepared
        preparation = require_prepared(self, plan, expected_hash)
        trusted_host_key_check = verify_local_hostkeys(
            receipt['receipt']['target']['alias'], receipt['receipt']['host_key_fingerprints'],
            self.trusted_hostkeys_dir)
        path = self.root / 'reimage-receipts' / (plan_id + '.json')
        if path.exists():
            raise ValueError('reimage receipt already recorded; inspect it and do not overwrite')
        atomic_json(path, {
            'plan_id': plan_id,
            'plan_sha256': expected_hash,
            'status': 'owner-receipt-recorded',
            'remote_mutation_performed': False,
            'receipt_path': receipt['path'],
            'receipt_sha256': receipt['sha256'],
            'trusted_host_key_file_check': trusted_host_key_check,
            'preparation': preparation,
            'receipt': receipt['receipt'],
            'recorded_at': now(),
        })
        return {'plan_id': plan_id, 'status': 'owner-receipt-recorded',
                'remote_mutation_performed': False,
                'path': str(path.relative_to(self.project)), 'receipt_sha256': receipt['sha256']}

    def verify_reimage_host(self, plan_id, expected_hash):
        plan_id = identifier(plan_id)
        plan_path = self.root / 'plans' / (plan_id + '.json')
        if plan_path.is_symlink() or not plan_path.is_file():
            raise ValueError('provider reimage plan is missing or unsafe')
        envelope = read(plan_path)
        if not isinstance(envelope, dict):
            raise ValueError('provider reimage plan envelope is malformed')
        plan = envelope.get('plan')
        if (not isinstance(plan, dict) or digest(plan) != envelope.get('sha256')
                or expected_hash != envelope.get('sha256')):
            raise ValueError('plan hash mismatch')
        if (plan.get('operation') != 'rebuild-node' or plan.get('rebuild_mode') != 'provider-reimage'
                or plan.get('executable') is not False):
            raise ValueError('replacement host verification requires a review-only provider-reimage plan')

        receipt_record_path = self.root / 'reimage-receipts' / (plan_id + '.json')
        if receipt_record_path.is_symlink() or not receipt_record_path.is_file():
            raise ValueError('owner reimage receipt record is missing or unsafe')
        receipt_record = read(receipt_record_path)
        if not isinstance(receipt_record, dict):
            raise ValueError('owner reimage receipt record is malformed')
        if (receipt_record.get('plan_id') != plan_id or receipt_record.get('plan_sha256') != expected_hash
                or receipt_record.get('status') != 'owner-receipt-recorded'
                or receipt_record.get('remote_mutation_performed') is not False):
            raise ValueError('owner reimage receipt record does not match this plan')

        from reimage_receipt import load_receipt, verify_local_hostkeys
        receipt = load_receipt(self.project, receipt_record.get('receipt_path', ''),
                               plan=plan, plan_sha256=expected_hash)
        if (receipt['sha256'] != receipt_record.get('receipt_sha256')
                or receipt['receipt'] != receipt_record.get('receipt')):
            raise ValueError('owner reimage receipt changed after it was recorded')
        from reimage_prepare import require_prepared
        preparation = require_prepared(self, plan, expected_hash)
        if preparation != receipt_record.get('preparation'):
            raise ValueError('provider reimage preparation journal changed after receipt recording')
        trusted = verify_local_hostkeys(receipt['receipt']['target']['alias'],
                                        receipt['receipt']['host_key_fingerprints'],
                                        self.trusted_hostkeys_dir)
        if trusted != receipt_record.get('trusted_host_key_file_check'):
            raise ValueError('trusted worker host-key file changed after receipt recording')

        path = self.root / 'reimage-observations' / (plan_id + '.json')
        if path.exists() or path.is_symlink():
            raise ValueError('replacement host observation already recorded; inspect it and do not overwrite')
        from reimage_host import inspect_replacement_host
        expected = {**receipt['receipt']['replacement'],
                    'host_key_fingerprints': receipt['receipt']['host_key_fingerprints']}
        observation = inspect_replacement_host(receipt['receipt']['target']['alias'], expected,
                                               self.trusted_hostkeys_dir)
        atomic_json(path, {
            'plan_id': plan_id,
            'plan_sha256': expected_hash,
            'status': 'replacement-host-readonly-verified',
            'remote_mutation_performed': False,
            'receipt_sha256': receipt['sha256'],
            'observation_sha256': digest(observation),
            'observation': observation,
            'verified_at': now(),
        })
        return {'plan_id': plan_id, 'status': 'replacement-host-readonly-verified',
                'remote_mutation_performed': False, 'alias': receipt['receipt']['target']['alias'],
                'path': str(path.relative_to(self.project))}

    def worker_readiness(self, health_file, canary_run, snapshot, target='worker-4'):
        from core_patch import readiness, PatchOperator
        from canaries import guard_targets
        report = read(self.project / health_file)
        gate = readiness(report)
        revision_path = self.root / 'core-revision.json'
        expected = read(self.project / 'patches/core-v0.1.5-lock-context.validation.json')['artifact_sha256']
        if not revision_path.exists() or read(revision_path).get('artifact_sha256') != expected:
            gate['blockers'].append('validated core patch has not been recorded as deployed')
        runtime = PatchOperator.core_runtime(self)
        if runtime['sha256'] != expected:
            gate['blockers'].append('running core is not the validated patch')
        last_services = report.get('samples', [{}])[-1].get('commands', {}).get('services', {}).get('stdout', '')
        if 'InvocationID=' + runtime['InvocationID'] not in last_services:
            gate['blockers'].append('health observation predates the current core invocation')
        return {'health_file': health_file, 'health_sha256': digest(report),
                'canary_run': identifier(canary_run),
                'canary_evidence_sha256': digest(read(self.project / 'private/smoke' / (identifier(canary_run) + '.json'))),
                'canaries': guard_targets(self, snapshot, canary_run, expected_nodes=set(('worker-2', 'worker-3', 'worker-4')) - {target}), 'core_runtime': runtime,
                'blockers': gate['blockers'], 'performance_findings': gate['performance_findings']}

    def execute(self, plan_id, expected_hash):
        envelope = read(self.root / 'plans' / (identifier(plan_id) + '.json'))
        plan = envelope['plan']
        if digest(plan) != envelope['sha256'] or expected_hash != envelope['sha256']:
            raise ValueError('plan hash mismatch')
        if not plan['executable']:
            raise ValueError('plan is not executable: ' + '; '.join(plan['blockers']))
        path = self.root / 'runs' / (plan_id + '.json')
        if path.exists():
            raise ValueError('run already exists; inspect/reconcile it and create a new plan instead of replaying')
        self.journal_path = path
        self.journal = {'id': plan_id, 'operation': plan['operation'], 'plan_hash': expected_hash,
                        'status': 'running', 'started_at': now(), 'controller_pid': os.getpid(), 'events': [],
                        'cluster_id': plan['bindings']['cluster']['cluster_id'],
                        'generation': plan['bindings']['cluster']['generation'],
                        'inventory_hash': digest(plan['bindings']['inventory']), 'source_commit': plan['source_commit']}
        self.stage('preflight')
        try:
            bindings = {'inventory': load_inventory(self.project), 'inputs': code_inputs(self.project), 'cluster': self.cluster()}
            if bindings != plan['bindings']:
                raise ValueError('inventory, generation or pinned inputs changed; create a new plan')
            current = self.snapshot()
            self.journal['preflight_snapshot'] = current
            issues = consistency_issues(current, self.inventory)
            self.journal['etcd_health'] = self.health()
            if self.journal['etcd_health']['exit_code']:
                issues.append('etcd health failed; mutations blocked')
            if issues:
                raise ValueError('; '.join(issues))
            if current['hosts'] != plan['snapshot']['hosts'] or membership(current) != membership(plan['snapshot']):
                raise ValueError('host identity/role/runtime or cluster state changed; create a new plan')
            if plan.get('patched_core'):
                from patched_reapply import gate
                bound = plan['patched_core']
                current_gate = gate(self, bound['artifact'], bound['health_file'], current)
                if current_gate != bound or current_gate['blockers']:
                    raise ValueError('patched artifact/runtime/health changed; create a new plan')
            self.stage('preflighted')
            if plan['operation'] == 'rebuild-node':
                from component_reinstall import ComponentReinstall
                bound = plan['worker_readiness']
                current_gate = self.worker_readiness(bound['health_file'], bound['canary_run'], current, plan['node'])
                if current_gate['blockers'] or current_gate != bound:
                    raise ValueError('worker readiness/canaries changed; create a new plan')
                ComponentReinstall(self, target=plan['node']).execute(plan, current)
            elif plan['operation'] == 'canary-start':
                from canaries import start_canaries
                start_canaries(self, plan, current)
            elif plan['operation'] == 'cleanup':
                evidence = read(self.project / 'private/smoke' / (plan['smoke_run'] + '.json'))
                if digest(evidence) != plan['smoke_evidence_hash']:
                    raise ValueError('source smoke evidence changed; create a new plan')
                if cleanup_targets(evidence, current['workloads']) != plan['targets']:
                    raise ValueError('cleanup target set changed')
                self.stage('removing')
                for target in plan['targets']:
                    matches = [w for w in self.cli('workload', 'list') if w['id'] == target['id']]
                    if not matches:
                        continue
                    if cleanup_targets(evidence, matches) != [target]:
                        raise ValueError('ownership changed immediately before remove')
                    self.command(self.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
                        '--eru', self.core['ip'] + ':5001', 'workload', 'remove', '--force', target['id']])
                self.stage('verifying')
                remaining = self.cli('workload', 'list')
                if {x['id'] for x in remaining} & {x['id'] for x in plan['targets']}:
                    raise RuntimeError('cleanup target still exists')
                untouched = {x['id'] for x in current['workloads']} - {x['id'] for x in plan['targets']}
                if not untouched <= {x['id'] for x in remaining}:
                    raise RuntimeError('unrelated workload disappeared; inspect before further action')
                self.journal['after'] = self.snapshot()
                for target in plan['targets']:
                    host = next(x['alias'] for x in self.inventory if x['node'] == target['node'])
                    facts = self.journal['after']['hosts'][host]
                    if target['id'] in facts['containers'].splitlines() or target['id'] in facts['tasks']:
                        raise RuntimeError('target runtime container/task still exists')
            else:
                self.stage('executing')
                argv = [sys.executable, str(self.project / 'scripts/smoke-lab.py')]
                if plan['operation'] == 'reapply':
                    argv += ['--node', 'worker-2', '--verify-reapply']
                    if plan.get('patched_core'):
                        argv += ['--core-artifact', plan['patched_core']['artifact']]
                elif plan['node']:
                    argv += ['--node', plan['node']]
                log = self.root / 'runs' / (plan_id + '.log')
                self.journal['command'] = argv
                self.journal['log'] = str(log.relative_to(self.project))
                before = {f.name for f in (self.project / 'private/smoke').glob('*.json')}
                self.save_journal()
                print('[controller B] ' + shlex.join(argv), flush=True)
                with log.open('w') as stream:
                    result = subprocess.run(argv, stdout=stream, stderr=subprocess.STDOUT, pass_fds=lock_fds())
                self.journal['exit_code'] = result.returncode
                after = sorted(f.name for f in (self.project / 'private/smoke').glob('*.json') if f.name not in before)
                self.journal['smoke_evidence'] = after
                self.save_journal()
                if result.returncode or len(after) != 1:
                    raise RuntimeError('operation failed or evidence ambiguous; inspect run log and reconcile')
                smoke = read(self.project / 'private/smoke' / after[0])
                if not smoke.get('pass') or not smoke.get('nodes'):
                    raise RuntimeError('missing successful smoke evidence')
                self.stage('verifying')
                self.journal['after'] = self.snapshot()
                if membership(self.journal['after']) != membership(current):
                    raise RuntimeError('post-operation membership/resource/workload state changed')
            self.journal.update(status='complete', finished_at=now())
            self.stage('complete')
        except BaseException as exc:
            self.journal.update(status='failed', failed_at=self.journal['stage'], error=str(exc), finished_at=now())
            self.save_journal()
            raise
        return self.journal

    def reconcile(self, run_id):
        path = self.root / 'runs' / (identifier(run_id) + '.json')
        journal = read(path)
        if journal.get('operation') == 'provider-reimage-prepare':
            from reimage_prepare import reconcile_preparation
            return reconcile_preparation(self, run_id, journal)
        if journal.get('operation') == 'provider-reimage-worker-install':
            from reimage_worker_install import reconcile_worker_install
            return reconcile_worker_install(self, run_id, journal)
        if journal.get('operation') == 'provider-reimage-worker-registration':
            from reimage_worker_registration import reconcile_worker_registration
            return reconcile_worker_registration(self, run_id, journal)
        # Caller holds the mutation lock. No child that inherited it may still run.
        observation = {'at': now(), 'policy': 'Read-only reconciliation; no remote command replay or automatic cleanup.'}
        try:
            snapshot = self.snapshot()
            observation['snapshot'] = snapshot
            observation['issues'] = consistency_issues(snapshot, self.inventory)
        except Exception as exc:
            observation['error'] = str(exc)
        observation['events'] = self.events
        atomic_json(self.root / 'observations' / (run_id + '-reconcile-' + uuid.uuid4().hex[:8] + '.json'), observation)
        if journal['status'] == 'running':
            journal.update(status='interrupted', failed_at=journal['stage'], reconciled_at=now())
        else:
            journal['reconciled_at'] = now()
        journal['reconciliation'] = {k: observation[k] for k in ['issues', 'error'] if k in observation}
        atomic_json(path, journal)
        return journal


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan', help='Read live state and write a private, hash-bound plan')
    plan.add_argument('--operation', required=True, choices=['reapply', 'smoke', 'cleanup', 'rebuild-node', 'canary-start'])
    plan.add_argument('--node', choices=['worker-2', 'worker-3', 'worker-4'])
    plan.add_argument('--exclude-node', choices=['worker-2', 'worker-3', 'worker-4'], help='canary-start: keep this target empty and guard the other two workers')
    plan.add_argument('--smoke-run')
    plan.add_argument('--health', help='Completed control health evidence for component reinstall or patched reapply')
    plan.add_argument('--fault-after', choices=['quarantine', 'start'], help='Bounded worker-4 recovery drill; intentionally fails and stays fenced')
    plan.add_argument('--core-artifact', help='Validated deployed core artifact to preserve during reapply')
    plan.add_argument('--canary-run', help='Running worker-2/3 canary evidence ID')
    plan.add_argument('--mode', choices=['component-reinstall', 'provider-reimage'], help='rebuild-node defaults to component-reinstall; provider-reimage remains review-only')
    plan.add_argument('--reimage-intent', help='Private owner-reviewed provider resource, OS image, and exact volume scope for provider-reimage only')
    prepare_reimage = sub.add_parser('prepare-reimage', help='Fence, stop the worker agent and remove its ERU registration before owner console reimage')
    prepare_reimage.add_argument('--plan', required=True)
    prepare_reimage.add_argument('--sha256', required=True)
    bootstrap_plan = sub.add_parser('plan-reimage-worker', help='Build a private worker-only bootstrap plan from a verified replacement host')
    bootstrap_plan.add_argument('--plan', required=True, help='Source provider-reimage plan ID')
    bootstrap_plan.add_argument('--sha256', required=True, help='Source provider-reimage plan SHA-256')
    install_reimage_worker = sub.add_parser('install-reimage-worker', help='Install locked worker-only ERU components while leaving the agent stopped and unregistered')
    install_reimage_worker.add_argument('--plan', required=True, help='Worker bootstrap plan ID')
    install_reimage_worker.add_argument('--sha256', required=True, help='Worker bootstrap plan SHA-256')
    register_reimage_worker = sub.add_parser('register-reimage-worker', help='Register the verified worker under safe core and leave it fenced for smoke testing')
    register_reimage_worker.add_argument('--plan', required=True, help='Worker bootstrap plan ID')
    register_reimage_worker.add_argument('--sha256', required=True, help='Worker bootstrap plan SHA-256')
    receipt = sub.add_parser('record-reimage-receipt', help='Record owner attestation after manual console reimage; no SSH or provider API')
    receipt.add_argument('--plan', required=True)
    receipt.add_argument('--sha256', required=True)
    receipt.add_argument('--receipt', required=True, help='Private owner-reviewed receipt JSON')
    verify_reimage = sub.add_parser('verify-reimage-host', help='Read-only identity and readiness check before worker bootstrap')
    verify_reimage.add_argument('--plan', required=True)
    verify_reimage.add_argument('--sha256', required=True)
    execute = sub.add_parser('execute', help='Execute one reviewed plan exactly once')
    execute.add_argument('--plan', required=True)
    execute.add_argument('--sha256', required=True)
    status = sub.add_parser('status', help='Show local journals without SSH')
    status.add_argument('--run')
    reconcile = sub.add_parser('reconcile', help='Read actual state after failure; never replay mutations')
    reconcile.add_argument('--run', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    if args.command == 'status':
        root = PROJECT / 'private/operations/runs'
        if args.run:
            data = read(root / (identifier(args.run) + '.json'))
            print(json.dumps({k: v for k, v in data.items() if k not in ['events', 'after', 'preflight_snapshot']}, indent=2))
        else:
            print(json.dumps([{k: read(f).get(k) for k in ['id', 'operation', 'status', 'stage', 'failed_at']}
                              for f in sorted(root.glob('*.json'))], indent=2))
        return
    with ClusterLock(PROJECT):
        operator = Operator()
        if args.command == 'plan':
            envelope = operator.plan(args.operation, args.node, args.smoke_run, args.mode, args.health, args.canary_run, args.core_artifact, args.fault_after, args.exclude_node, args.reimage_intent)
            summary = {k: envelope['plan'][k] for k in ['id', 'operation', 'node', 'executable', 'mutation_hosts', 'targets', 'steps', 'blockers']}
            for optional in ['rebuild_mode', 'component_scope', 'provider_reimage_intent', 'fault_after', 'guard_exclude', 'guard_nodes']:
                if optional in envelope['plan']:
                    summary[optional] = envelope['plan'][optional]
            if 'reimage_preparation' in envelope['plan']:
                summary['reimage_preparation'] = envelope['plan']['reimage_preparation']
            if envelope['plan'].get('patched_core'):
                summary['patched_core'] = {k: envelope['plan']['patched_core'][k]
                    for k in ['artifact', 'health_file', 'selection', 'blockers']}
            summary['sha256'] = envelope['sha256']
            summary['path'] = str(operator.root / 'plans' / (summary['id'] + '.json'))
            print(json.dumps(summary, indent=2))
        elif args.command == 'plan-reimage-worker':
            envelope = operator.plan_reimage_worker(args.plan, args.sha256)
            plan = envelope['plan']
            payload = plan['worker_payload']
            print(json.dumps({
                'id': plan['id'], 'operation': plan['operation'],
                'source_reimage_plan': plan['source_reimage_plan'],
                'target': {k: plan['target'][k] for k in ['alias', 'node', 'index']},
                'artifacts': [{'repository': row['repository'], 'tag': row['tag'], 'sha256': row['sha256']}
                              for row in payload['artifacts']],
                'files': [{'path': row['path'], 'sha256': row['sha256']}
                          for row in plan['worker_files']],
                'registration': {k: plan['registration'][k]
                                 for k in ['node', 'podname', 'labels', 'resource_capacity']},
                'worker_install': plan['worker_install'],
                'worker_registration': {
                    'executable': plan['worker_registration']['executable'],
                    'core_release_id': plan['worker_registration']['core_release']['release_id'],
                    'core_artifact_sha256': plan['worker_registration']['core_release']['artifact_sha256'],
                    'steps': plan['worker_registration']['steps'],
                },
                'executable': plan['executable'], 'blockers': plan['blockers'],
                'sha256': envelope['sha256'],
                'path': str(operator.root / 'reimage-bootstrap-plans' / (plan['id'] + '.json')),
            }, indent=2))
        elif args.command == 'install-reimage-worker':
            result = operator.install_reimage_worker(args.plan, args.sha256)
            print(json.dumps({k: result.get(k) for k in [
                'id', 'operation', 'status', 'stage', 'target', 'target_alias',
                'agent_started', 'node_registered', 'finished_at']}, indent=2))
        elif args.command == 'register-reimage-worker':
            result = operator.register_reimage_worker(args.plan, args.sha256)
            print(json.dumps({k: result.get(k) for k in [
                'id', 'bootstrap_plan_id', 'operation', 'status', 'stage', 'target',
                'target_alias', 'agent_started', 'node_registered', 'available', 'bypass',
                'core_artifact_sha256', 'finished_at']}, indent=2))
        elif args.command == 'record-reimage-receipt':
            result = operator.record_reimage_receipt(args.plan, args.sha256, args.receipt)
            print(json.dumps(result, indent=2))
        elif args.command == 'prepare-reimage':
            result = operator.prepare_reimage(args.plan, args.sha256)
            print(json.dumps({k: result.get(k) for k in ['id', 'status', 'stage']}, indent=2))
        elif args.command == 'verify-reimage-host':
            result = operator.verify_reimage_host(args.plan, args.sha256)
            print(json.dumps(result, indent=2))
        elif args.command == 'execute':
            result = operator.execute(args.plan, args.sha256)
            print(json.dumps({k: result[k] for k in ['id', 'status', 'stage']}, indent=2))
        else:
            result = operator.reconcile(args.run)
            print(json.dumps({k: result.get(k) for k in ['id', 'status', 'stage', 'reconciled_at', 'reconciliation']}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, ValueError, OSError, subprocess.SubprocessError) as exc:
        print('ERROR:', str(exc), file=sys.stderr)
        raise SystemExit(1)

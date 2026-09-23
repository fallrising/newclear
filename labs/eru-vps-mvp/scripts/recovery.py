#!/usr/bin/env python3
"""New, hash-bound recovery plans; never replay the failed deployment plan."""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import json
import os
import re
import time
import uuid

from labctl import PROJECT, code_inputs, consistency_issues, identifier, membership, now, read
from labops import ClusterLock, atomic_json, digest
from core_patch import PatchOperator, ALIAS as CORE
from component_reinstall import ComponentReinstall, ALIAS as WORKER, TARGET, UNITS, empty_target
from canaries import HTTPGuards

CORE_ACTIONS = ['core-rollback', 'core-cancel']
ACTIONS = [*CORE_ACTIONS, 'worker-restore', 'worker-resume']


def count_field(output):
    # This pinned etcdctl only permits --count-only with --write-out=fields.
    # Do not treat an unexpected/missing response as an empty metadata prefix.
    values = re.findall(r'^"Count" : ([0-9]+)$', output, re.MULTILINE)
    if len(values) != 1:
        raise ValueError('invalid etcd count-only response')
    return int(values[0])


def worker_issues(snapshot, inventory):
    copy = deepcopy(snapshot)
    # An unavailable target is expected after a stopped-worker failure. Every
    # other consistency check, including its metadata/runtime/usage, still holds.
    next(n for n in copy['nodes'] if n['name'] == TARGET)['available'] = True
    return consistency_issues(copy, inventory)


def identity(host):
    return {k: v for k, v in host.items() if k not in ['containers', 'tasks']}


class RecoveryOperator(PatchOperator):
    def bindings(self):
        revisions = self.root / 'worker-component-revisions.json'
        return {'inputs': code_inputs(self.project), 'inventory': self.inventory,
                'cluster': self.cluster(), 'worker_revisions': read(revisions) if revisions.exists() else {}}

    def source(self, run, action):
        run = identifier(run)
        envelope = read(self.root / 'plans' / (run + '.json'))
        plan = envelope['plan']
        journal = read(self.root / 'runs' / (run + '.json'))
        if journal.get('operation') != plan['operation']:
            raise ValueError('source operation identity mismatch')
        if plan['id'] != run or journal['id'] != run or digest(plan) != envelope['sha256'] or journal['plan_hash'] != envelope['sha256']:
            raise ValueError('source plan/journal identity or hash mismatch')
        if journal['status'] not in ['failed', 'interrupted', 'complete']:
            raise ValueError('source still running; reconcile it under the controller lock first')
        if plan['bindings']['inventory'] != self.inventory or plan['bindings']['cluster'] != self.cluster():
            raise ValueError('source inventory/generation no longer matches')
        if action in CORE_ACTIONS:
            if plan['operation'] != 'core-patch':
                raise ValueError('core recovery must reference an original core-patch run')
            if action == 'core-cancel' and journal['status'] == 'complete':
                raise ValueError('completed core update cannot be cancelled')
            relevant = ['core-patch', 'core-rollback', 'core-recovery']
            if action == 'core-cancel': relevant.append('reapply')
        else:
            if plan['operation'] != 'rebuild-node' or plan['node'] != TARGET or plan['rebuild_mode'] != 'component-reinstall':
                raise ValueError('worker recovery requires a worker-4 component reinstall source')
            if journal['status'] == 'complete':
                raise ValueError('completed reinstall needs no failure recovery')
            relevant = ['rebuild-node', 'worker-recovery']
        for path in (self.root / 'runs').glob('*.json'):
            later = read(path)
            if later['id'] == run or later.get('operation') not in relevant or later['started_at'] <= journal['started_at']:
                continue
            if self.journal and later['id'] == self.journal['id']:
                continue
            if later.get('source_run') == run and later.get('status') in ['failed', 'interrupted']:
                continue  # a fresh recovery may resolve a previously uncertain recovery
            raise ValueError('source was superseded by a later operation; reconcile the latest attempt')
        return {'plan': plan, 'journal_sha256': digest(journal), 'plan_sha256': envelope['sha256']}

    def etcd_ready(self):
        if self.health()['exit_code']:
            raise ValueError('etcd is unhealthy; recovery cannot repair etcd')
        alarms = json.loads(self.command(CORE, ['sudo', '-n', '/usr/local/bin/etcdctl',
            '--endpoints=http://127.0.0.1:2379', '--command-timeout=5s', 'alarm', 'list', '-w', 'json']))
        if alarms.get('alarms'):
            raise ValueError('etcd alarms block recovery')

    def offline_workloads(self):
        # Fixed v0.1.5 store/common/keys.go and the reviewed /eru namespace.
        # Count-only reads avoid retrieving workload configuration/credentials.
        counts = {}
        for prefix in ['/eru/workloads/', '/eru/deploy/', '/eru/processing/']:
            result = self.command(CORE, ['sudo', '-n', '/usr/local/bin/etcdctl',
                '--endpoints=http://127.0.0.1:2379', '--command-timeout=5s', 'get', prefix,
                '--prefix', '--count-only', '-w', 'fields'])
            counts[prefix] = count_field(result)
        if any(counts.values()):
            raise ValueError('offline core rollback requires empty workload/deploy/processing metadata')
        return counts

    def observe_core(self, source):
        hosts = self.host_snapshot()  # does not call the unavailable core API
        for alias, host in hosts.items():
            if identity(host) != identity(source['plan']['snapshot']['hosts'][alias]):
                raise ValueError('source host/boot/runtime identity changed: ' + alias)
            if host['containers'] or host['tasks'].splitlines()[1:]:
                raise ValueError('offline core rollback requires empty ERU runtime on all hosts')
        self.etcd_ready()
        counts = self.offline_workloads()
        footprint = self.remote({'action': 'inspect-recovery', 'source_run': source['plan']['id'],
                                 'machine_id': hosts[CORE]['machine_id']})
        if footprint['before'] != source['plan']['footprint'] or footprint['new_sha256'] != source['plan']['sha256']:
            raise ValueError('remote update journal does not match source plan')
        return {'hosts': hosts, 'metadata_counts': counts, 'recovery': footprint,
                'runtime': self.core_runtime(allow_inactive=True), 'protected_services': self.protected_services()}

    def observe_cancellation(self, source):
        original = source['plan']
        hosts = self.host_snapshot()
        for alias, host in hosts.items():
            if identity(host) != identity(original['snapshot']['hosts'][alias]):
                raise ValueError('source host/boot/runtime identity changed: ' + alias)
        footprint = self.remote({'action': 'inspect-cancellation', 'source_run': original['id'],
            'machine_id': hosts[CORE]['machine_id'], 'source': {
                'before': original['footprint'], 'new_sha256': original['sha256'],
                'plan_sha256': source['plan_sha256']}})
        runtime = self.core_runtime()
        if runtime != original['core_runtime'] or runtime['sha256'] != original['footprint']['binary']['sha256']:
            raise ValueError('original running core changed; cancellation cannot restore it')
        self.etcd_ready()
        return {'hosts': hosts, 'recovery': footprint, 'runtime': runtime,
                'protected_services': self.protected_services()}

    def worker_state(self, source):
        return ComponentReinstall(self).remote('inspect-recovery', source['plan'])

    def worker_services(self):
        return self.command(WORKER, ['sudo', '-n', 'systemctl', 'show', '--property=Id,ActiveState', *UNITS])

    def observe_worker(self, source, action, health_file, canary_run):
        snapshot = self.snapshot()
        issues = worker_issues(snapshot, self.inventory)
        if issues: raise ValueError('; '.join(issues))
        node = empty_target(snapshot)
        old = source['plan']['snapshot']
        for alias, host in snapshot['hosts'].items():
            if identity(host) != identity(old['hosts'][alias]):
                raise ValueError('source host/boot/runtime identity changed: ' + alias)
        original = empty_target(old)
        for key in ['name', 'podname', 'endpoint', 'labels', 'resource_capacity']:
            if node[key] != original[key]: raise ValueError('worker registration changed')
        self.etcd_ready()
        gate = self.worker_readiness(health_file, canary_run, snapshot)
        if gate['blockers']: raise ValueError('; '.join(gate['blockers']))
        remote = self.worker_state(source)
        services = self.worker_services()
        if action == 'worker-restore':
            if not node.get('bypass'):
                raise ValueError('restore requires an already fenced worker')
            if services.splitlines().count('ActiveState=inactive') != 3:
                raise ValueError('restore requires all three ERU units already inactive')
            already_restored = remote.get('stage') == 'restored' and not remote.get('conflicts')
            if not remote.get('restore_possible') and not already_restored:
                raise ValueError('restore would overwrite new state or lacks a verified backup; use a reviewed resume plan if intact')
        else:
            scope = self.worker_scope(WORKER)
            if scope['blockers'] or scope['manifest_sha256'] != source['plan']['component_scope']['manifest_sha256']:
                raise ValueError('resume requires intact owned worker files')
            if not node['available']:
                raise ValueError('resume requires an available worker')
            # New agent state is deliberately preserved, not rolled back. Only
            # immutable backup/journal identity is bound for this action.
            remote = {k: remote[k] for k in ['exists', 'stage', 'journal_sha256', 'snapshot_sha256'] if k in remote}
            if not remote['exists']:
                journal = read(self.root / 'runs' / (source['plan']['id'] + '.json'))
                safe_stages = ['preflight', 'preflighted', 'preparing-worker-payload', 'fencing-worker-4', 'stopping-worker-4']
                if journal.get('failed_at') not in safe_stages:
                    raise ValueError('remote recovery journal missing after quarantine could have started')
        return {'snapshot': snapshot, 'recovery': remote, 'worker_services': services,
                'readiness': gate, 'protected_services': ComponentReinstall(self).service_baseline()}

    def observe(self, source, action, health_file, canary_run):
        if action == 'core-rollback': return self.observe_core(source)
        if action == 'core-cancel': return self.observe_cancellation(source)
        if not health_file or not canary_run:
            raise ValueError('worker recovery requires --health and --canary-run')
        return self.observe_worker(source, action, health_file, canary_run)

    def make_recovery_plan(self, run, action, health_file=None, canary_run=None):
        if action not in ACTIONS: raise ValueError('unknown recovery action')
        source = self.source(run, action)
        if action in CORE_ACTIONS and (health_file or canary_run):
            raise ValueError('offline core recovery uses direct SSH/etcd evidence, not worker health/canaries')
        observed = self.observe(source, action, health_file, canary_run)
        plan = {'id': datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8],
                'operation': 'core-recovery' if action in CORE_ACTIONS else 'worker-recovery',
                'action': action, 'created_at': now(), 'source_run': run, 'source': source,
                'health_file': health_file, 'canary_run': canary_run, 'observed': observed,
                'bindings': self.bindings(), 'executable': True, 'mutation_hosts': [CORE] if action in CORE_ACTIONS else [CORE, WORKER],
                'steps': (['Verify SSH identity, empty runtime/metadata, etcd and backup hashes without core API',
                           'Restore only the recorded binary/manifest if needed; restart core at most once',
                           'Verify running checksum, API, zero workloads/usage and preserved services'] if action == 'core-rollback' else
                          ['Keep continuous HTTP guards on worker-2/3; verify current ownership and empty worker-4',
                           'Restore the exact backup into a stopped worker' if action == 'worker-restore' else 'Preserve current worker files and agent state',
                           'Fence, validate nginx lifecycle and isolation, then resume scheduling; record recovery separately'])}
        if action == 'core-cancel':
            plan['steps'] = [
                'Verify source plan, backing-up journal and unchanged original files/runtime',
                'Record a new cancellation intent and receipt; retain all update evidence',
                'Verify archive and unchanged services; never replace files or restart core']
        envelope = {'plan': plan, 'sha256': digest(plan)}
        atomic_json(self.root / 'plans' / (plan['id'] + '.json'), envelope)
        atomic_json(self.root / 'observations' / (plan['id'] + '.json'), self.events)
        return envelope

    def execute_recovery(self, run, checksum):
        envelope = read(self.root / 'plans' / (identifier(run) + '.json'))
        plan = envelope['plan']
        expected_operation = 'core-recovery' if plan['action'] in CORE_ACTIONS else 'worker-recovery'
        if (plan['id'] != run or plan['operation'] != expected_operation or digest(plan) != checksum or
                checksum != envelope['sha256'] or not plan['executable'] or plan['action'] not in ACTIONS):
            raise ValueError('invalid or blocked recovery plan')
        self.journal_path = self.root / 'runs' / (run + '.json')
        if self.journal_path.exists(): raise ValueError('run exists; create a new recovery plan, never replay')
        self.journal = {'id': run, 'operation': plan['operation'], 'action': plan['action'],
                        'source_run': plan['source_run'], 'plan_hash': checksum, 'status': 'running',
                        'started_at': now(), 'controller_pid': os.getpid()}
        self.stage('recovery-preflight')
        try:
            if self.bindings() != plan['bindings'] or self.source(plan['source_run'], plan['action']) != plan['source']:
                raise ValueError('bound inputs or source journal changed')
            observed = self.observe(plan['source'], plan['action'], plan['health_file'], plan['canary_run'])
            # Snapshot timestamps are observations, not state identity.
            def stable(value):
                value = deepcopy(value)
                if 'snapshot' in value:
                    snap = value['snapshot']
                    snap.pop('at', None)
                    for key, field in [('nodes', 'name'), ('pods', 'name'), ('workloads', 'id')]:
                        snap[key] = sorted(snap[key], key=lambda row: row[field])
                return value
            if stable(observed) != stable(plan['observed']):
                raise ValueError('recovery state changed after plan')
            if plan['action'] == 'core-rollback': self.recover_core(plan)
            elif plan['action'] == 'core-cancel': self.cancel_core(plan)
            else: self.recover_worker(plan)
            self.journal.update(status='complete', finished_at=now())
            self.stage('complete')
        except BaseException as exc:
            self.journal.update(status='failed', failed_at=self.journal['stage'], error=str(exc), finished_at=now())
            self.save_journal()
            raise
        return self.journal

    def cancel_core(self, plan):
        before = plan['observed']
        self.stage('cancelling-core-update')
        if before['recovery']['stage'] != 'cancelled':
            self.journal['remote_cancellation'] = self.remote({'action': 'cancel', 'id': plan['id'],
                'source_run': plan['source_run'], 'machine_id': before['hosts'][CORE]['machine_id'],
                'expected_cancellation': before['recovery']})
            self.save_journal()
        self.stage('verifying-core-cancellation')
        after = self.observe_cancellation(plan['source'])
        if after['recovery']['stage'] != 'cancelled':
            raise ValueError('core cancellation receipt not observed')
        stable_before, stable_after = deepcopy(before), deepcopy(after)
        for value in [stable_before, stable_after]:
            value['recovery'].pop('stage')
            value['recovery'].pop('receipt_sha256')
        if stable_after != stable_before:
            raise ValueError('files/runtime/services changed during core cancellation')
        self.journal['after'] = after
        # No core revision, source status or service changes: this update never installed.

    def recover_core(self, plan):
        before = plan['observed']
        checksum = before['recovery']['before']['binary']['sha256']
        if before['recovery']['stage'] != 'rolled-back':
            self.stage('restoring-core-binary')
            self.journal['remote_restore'] = self.remote({'action': 'rollback', 'id': plan['id'],
                'source_run': plan['source_run'], 'machine_id': before['hosts'][CORE]['machine_id'],
                'expected_recovery': before['recovery']})
            self.save_journal()
        needs_restart = before['runtime'].get('ActiveState') != 'active' or before['runtime']['sha256'] != checksum
        if needs_restart:
            self.stage('restarting-core-only')
            self.command(CORE, ['sudo', '-n', 'systemctl', 'restart', 'eru-core.service'])
        self.stage('verifying-core-recovery')
        for _ in range(60):
            try:
                runtime = self.core_runtime()
                if runtime['sha256'] != checksum: raise ValueError('recovered runtime checksum mismatch')
                after = self.snapshot()
                if consistency_issues(after, self.inventory):
                    raise ValueError('workers have not reconnected to recovered core')
                break
            except Exception:
                time.sleep(1)
        else: raise ValueError('recovered core did not become ready; reconcile before a new plan')
        self.etcd_ready()
        if after['hosts'] != before['hosts'] or after['workloads'] or consistency_issues(after, self.inventory):
            raise ValueError('post-recovery runtime/metadata/resources changed or inconsistent')
        original = plan['source']['plan']['snapshot']
        fields = ['name', 'podname', 'endpoint', 'labels', 'resource_capacity']
        registration = lambda snap: sorted([{k: n[k] for k in fields} for n in snap['nodes']], key=lambda n: n['name'])
        if registration(after) != registration(original) or sorted(p['name'] for p in after['pods']) != sorted(p['name'] for p in original['pods']):
            raise ValueError('registration changed since original core update')
        if self.protected_services() != before['protected_services']:
            raise ValueError('protected services changed')
        if needs_restart and runtime['InvocationID'] == before['runtime']['InvocationID']:
            raise ValueError('core restart not observed')
        self.journal.update(after=after, core_runtime=runtime)
        atomic_json(self.root / 'core-revision.json', {'operation': 'core-rollback', 'run': plan['id'],
            'source_run': plan['source_run'], 'artifact_sha256': checksum, 'core_runtime': runtime})

    def recover_worker(self, plan):
        before = plan['observed']
        component = ComponentReinstall(self)
        guards = HTTPGuards(self.project, plan['id'], before['readiness']['canaries'])
        try:
            with guards:
                component.guards = guards
                component.stage('fencing-worker-4-for-recovery')
                component.fence()
                if plan['action'] == 'worker-restore':
                    component.stage('restoring-worker-4')
                    if before['recovery']['stage'] != 'restored':
                        self.journal['remote_restore'] = component.remote('restore', plan['source']['plan'], extra={
                            'recovery_id': plan['id'], 'expected_recovery': before['recovery']})
                        self.save_journal()
                    component.command(WORKER, ['sudo', '-n', 'systemd-analyze', 'verify',
                        *['/etc/systemd/system/' + u for u in UNITS]])
                    component.command(WORKER, ['sudo', '-n', 'systemctl', 'daemon-reload'])
                    component.command(WORKER, ['sudo', '-n', 'systemctl', 'start', 'eru-containerd-proxy.socket', 'eru-agent.service'])
                component.stage('verifying-worker-recovery')
                for _ in range(30):
                    node = next(n for n in self.cli('node', 'get', TARGET) if n['name'] == TARGET)
                    if node['available'] and node.get('bypass'): break
                    time.sleep(1)
                else: raise ValueError('worker is not ready while fenced')
                if self.worker_scope(WORKER)['blockers']: raise ValueError('worker ownership validation failed')
                component.run_smoke()
                component.check_isolation(before['snapshot'], before['protected_services'])
                component.stage('resuming-recovered-worker-4')
                component.resume_attempted = True
                component.command(CORE, ['sudo', '-n', '/usr/local/bin/eru-cli', '--eru', self.core['ip'] + ':5001', 'node', 'up', TARGET])
                after = component.check_isolation(before['snapshot'], before['protected_services'])
                node = empty_target(after)
                original = empty_target(before['snapshot'])
                if any(node[k] != original[k] for k in ['name', 'podname', 'endpoint', 'labels', 'resource_capacity']):
                    raise ValueError('worker registration changed during recovery')
                if node.get('bypass') or not node['available']: raise ValueError('worker resume not observed')
                self.journal['after'] = after
                guards.check()
            if guards.summary['failures']: raise ValueError('HTTP failure before guard shutdown')
            # Recovery is not another successful reinstall and never increments its counter.
            self.journal['recovered_source'] = plan['source_run']
        except BaseException:
            if component.resume_attempted:
                self.stage('refencing-after-recovery-resume-failure')
                self.journal['resume_recovery'] = 'uncertain'
                self.save_journal()
                try:
                    component.fence(corrective=True)
                    self.journal['resume_recovery'] = 'fenced'
                except Exception as exc:
                    self.journal['resume_recovery_error'] = str(exc)
            raise
        finally:
            self.journal['http_guards'] = getattr(guards, 'summary', {'error': 'observer did not start'})
            self.save_journal()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    plan = sub.add_parser('plan')
    plan.add_argument('--action', choices=ACTIONS, required=True)
    plan.add_argument('--source-run', required=True)
    plan.add_argument('--health')
    plan.add_argument('--canary-run')
    execute = sub.add_parser('execute')
    execute.add_argument('--plan', required=True)
    execute.add_argument('--sha256', required=True)
    args = parser.parse_args()
    with ClusterLock(PROJECT):
        op = RecoveryOperator()
        if args.command == 'plan':
            result = op.make_recovery_plan(args.source_run, args.action, args.health, args.canary_run)
            print(json.dumps({k: result['plan'][k] for k in ['id', 'action', 'source_run', 'executable', 'mutation_hosts', 'steps']}, indent=2))
            print('Plan SHA256:', result['sha256'])
        else:
            result = op.execute_recovery(args.plan, args.sha256)
            print(json.dumps({k: result[k] for k in ['id', 'status', 'stage']}, indent=2))


if __name__ == '__main__':
    main()

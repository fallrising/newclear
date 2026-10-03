"""Journal the ERU-side preparation boundary before an owner-controlled OS reimage.

This module never calls a provider API, deletes host files, installs software or
resumes scheduling. Every SSH action is addressed by the reviewed ckc alias.
"""
from datetime import datetime, timezone
import json
import re

from labops import atomic_json, digest


def _now():
    return datetime.now(timezone.utc).isoformat()


def _identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', value):
        raise ValueError('invalid record ID')
    return value


def _read(path):
    with open(path) as stream:
        return json.load(stream)


def _nonzero(value):
    if isinstance(value, dict):
        return any(_nonzero(child) for child in value.values())
    if isinstance(value, list):
        return any(_nonzero(child) for child in value)
    return isinstance(value, (int, float)) and value != 0


def _task_rows(value):
    rows = []
    for line in str(value or '').splitlines():
        line = line.strip()
        if line and not line.upper().startswith('TASK '):
            rows.append(line)
    return rows


def _assert_empty_target(snapshot, target, alias):
    nodes = [node for node in snapshot['nodes'] if node.get('name') == target]
    if len(nodes) != 1:
        raise ValueError('selected worker registration is missing or ambiguous')
    node = nodes[0]
    host = snapshot['hosts'][alias]
    if node.get('bypass'):
        raise ValueError('selected worker is already fenced; reconcile its existing operation')
    if not node.get('available'):
        raise ValueError('selected worker is unavailable')
    if any(row.get('nodename') == target for row in snapshot['workloads']):
        raise ValueError('selected worker still owns ERU workloads')
    if host.get('containers', '').strip() or _task_rows(host.get('tasks')):
        raise ValueError('selected worker ERU runtime is not empty')
    try:
        usage = json.loads(node['resource_usage'])
    except (TypeError, json.JSONDecodeError) as exc:
        raise ValueError('selected worker resource usage is unreadable') from exc
    if _nonzero(usage):
        raise ValueError('selected worker has nonzero resource usage')
    if host.get('docker', '').strip():
        raise ValueError('Docker workloads exist on target; separate ownership/migration review required')
    return node


def _cluster(operator):
    return {
        'pods': operator.cli('pod', 'list'),
        'nodes': operator.cli('pod', 'nodes', 'eru'),
        'workloads': operator.cli('workload', 'list'),
    }


def _workload_projection(rows):
    return sorted(({key: row.get(key) for key in ('id', 'nodename', 'podname', 'labels', 'image')}
                   for row in rows), key=lambda row: row['id'])


def _node_projection(row, *, target=False):
    keys = ['name', 'podname', 'endpoint', 'labels', 'resource_capacity', 'resource_usage']
    if not target:
        keys.append('available')
    return {key: row.get(key) for key in keys}


def _assert_host_state(operator, plan, target_alias):
    current = operator.host_snapshot()
    before = plan['snapshot']['hosts']
    if set(current) != set(before):
        raise ValueError('host set changed during worker preparation')
    identity = ('machine_id', 'boot_id', 'hostname', 'tailscale', 'owner',
                'ssh_config_hash', 'trusted_hostkeys_hash')
    for alias, facts in current.items():
        original = before[alias]
        if alias != target_alias:
            if facts != original:
                raise ValueError('unrelated host/runtime state changed: ' + alias)
            continue
        if any(facts.get(key) != original.get(key) for key in identity):
            raise ValueError('selected worker identity or SSH trust changed during preparation')
        if (facts.get('containers', '').strip() or _task_rows(facts.get('tasks'))
                or facts.get('docker', '').strip() or facts.get('core_config')
                or facts.get('etcd_data')):
            raise ValueError('selected worker ERU or Docker runtime is not empty after stopping agent')
    return current


def _assert_cluster_state(operator, plan, *, target_present, require_bypass=False):
    target = plan['node']
    before = plan['snapshot']
    current = _cluster(operator)
    if sorted(row['name'] for row in current['pods']) != sorted(row['name'] for row in before['pods']):
        raise ValueError('pod membership changed during worker preparation')
    if _workload_projection(current['workloads']) != _workload_projection(before['workloads']):
        raise ValueError('workload set changed during worker preparation')
    expected_nodes = {row['name']: row for row in before['nodes']}
    current_nodes = {row['name']: row for row in current['nodes']}
    if (target in current_nodes) != target_present:
        raise ValueError('selected worker registration presence differs from the expected phase')
    expected_other = {name: _node_projection(row) for name, row in expected_nodes.items() if name != target}
    actual_other = {name: _node_projection(row) for name, row in current_nodes.items() if name != target}
    if actual_other != expected_other:
        raise ValueError('unrelated worker registration changed during preparation')
    if target_present:
        if _node_projection(current_nodes[target], target=True) != _node_projection(expected_nodes[target], target=True):
            raise ValueError('selected worker identity, capacity or resource usage changed')
        if require_bypass and not current_nodes[target].get('bypass'):
            raise ValueError('selected worker scheduling fence is not observed')
    return current


def _node_get(operator, target):
    rows = operator.cli('node', 'get', target)
    if isinstance(rows, dict):
        rows = [rows]
    matches = [row for row in rows if row.get('name') == target]
    if len(matches) != 1:
        raise ValueError('core did not return exactly one selected worker record')
    return matches[0]


def _command(operator, host, argv, *, check=True):
    output = operator.command(host, argv, check=check)
    if not operator.events:
        raise RuntimeError('operator did not record a command result')
    event = operator.events[-1]
    if event.get('host') != host or event.get('argv') != argv:
        raise RuntimeError('operator command journal does not match the requested alias and command')
    return output, event.get('exit_code')


def _services_active(operator, alias):
    units = ['ssh.service', 'tailscaled.service', 'docker.service', 'containerd.service']
    output, status = _command(operator, alias,
        ['sudo', '-n', 'systemctl', 'is-active', *units], check=False)
    states = [line.strip() for line in output.splitlines() if line.strip()]
    if status != 0 or states != ['active'] * len(units):
        raise ValueError('preserved SSH/Tailscale/Docker/containerd services are not all active')


def _agent_active(operator, alias):
    output, status = _command(operator, alias,
        ['sudo', '-n', 'systemctl', 'is-active', 'eru-agent.service'], check=False)
    states = [line.strip() for line in output.splitlines() if line.strip()]
    if status != 0 or states != ['active']:
        raise ValueError('selected worker eru-agent.service is not active before fencing')


def _agent_stopped(operator, alias):
    output, status = _command(operator, alias,
        ['sudo', '-n', 'systemctl', 'is-active', 'eru-agent.service'], check=False)
    states = [line.strip() for line in output.splitlines() if line.strip()]
    if status == 0 or states != ['inactive']:
        raise ValueError('selected worker eru-agent.service stop is not confirmed')
    _services_active(operator, alias)


def _load_plan(operator, plan_id, expected_hash):
    from labctl import code_inputs, load_inventory, membership

    plan_id = _identifier(plan_id)
    path = operator.root / 'plans' / (plan_id + '.json')
    if path.is_symlink() or not path.is_file():
        raise ValueError('provider reimage plan is missing or unsafe')
    envelope = _read(path)
    if not isinstance(envelope, dict) or not isinstance(envelope.get('plan'), dict):
        raise ValueError('provider reimage plan envelope is malformed')
    plan = envelope['plan']
    if digest(plan) != envelope.get('sha256') or expected_hash != envelope.get('sha256'):
        raise ValueError('plan hash mismatch')
    if (plan.get('operation') != 'rebuild-node' or plan.get('rebuild_mode') != 'provider-reimage'
            or plan.get('executable') is not False):
        raise ValueError('preparation requires a review-only provider-reimage plan')
    readiness = plan.get('reimage_preparation')
    if not isinstance(readiness, dict) or readiness.get('executable') is not True:
        raise ValueError('provider reimage preparation has unresolved blockers')
    if readiness.get('blockers'):
        raise ValueError('provider reimage preparation has unresolved blockers')
    target = plan.get('node')
    host = next((row for row in plan.get('bindings', {}).get('inventory', [])
                 if row.get('node') == target), None)
    if host is None or host.get('role') != 'worker' or host.get('alias') not in {
            'ckc-disposable-02', 'ckc-disposable-03', 'ckc-disposable-04'}:
        raise ValueError('provider reimage target is outside the reviewed worker aliases')
    if target not in ('worker-2', 'worker-3', 'worker-4'):
        raise ValueError('provider reimage target is outside the reviewed worker names')
    if plan.get('blockers') != readiness['blockers'] + [
            'Owner console reimage, receipt and replacement-host verification are separate manual stages',
            'Generation commit and recovery executor are not implemented']:
        raise ValueError('provider reimage plan stage contract changed; create a new plan')
    current_bindings = {
        'inventory': load_inventory(operator.project),
        'inputs': code_inputs(operator.project),
        'cluster': operator.cluster(),
    }
    intent_binding = plan.get('bindings', {}).get('provider_reimage_intent')
    if not isinstance(intent_binding, dict):
        raise ValueError('provider reimage intent binding is missing')
    from reimage_review import load_intent
    loaded = load_intent(operator.project, intent_binding.get('path', ''), node=target,
                         alias=host['alias'],
                         machine_id=plan['snapshot']['hosts'][host['alias']]['machine_id'])
    if loaded['path'] != intent_binding.get('path') or loaded['sha256'] != intent_binding.get('sha256'):
        raise ValueError('provider reimage intent changed; create a new plan')
    if loaded['intent'] != plan.get('provider_reimage_intent'):
        raise ValueError('provider reimage intent values changed; create a new plan')
    current_bindings['provider_reimage_intent'] = intent_binding
    if current_bindings != plan.get('bindings'):
        raise ValueError('inventory, generation, intent or pinned inputs changed; create a new plan')
    return plan, host


def require_prepared(operator, plan, plan_sha256):
    """Require an exact successful preparation journal before owner receipt."""
    from labctl import identifier

    plan_id = _identifier(plan.get('id'))
    path = operator.root / 'runs' / (identifier(plan_id) + '.json')
    if path.is_symlink() or not path.is_file():
        raise ValueError('provider reimage preparation journal is missing or unsafe')
    journal = _read(path)
    intent_target = plan.get('provider_reimage_intent', {}).get('target', {})
    if (journal.get('operation') != 'provider-reimage-prepare'
            or journal.get('id') != plan_id or journal.get('plan_hash') != plan_sha256
            or journal.get('status') != 'prepared'
            or journal.get('stage') != 'awaiting-owner-console-reimage'
            or journal.get('target') != plan.get('node')
            or journal.get('target_alias') != intent_target.get('alias')
            or journal.get('fence_observed', {}).get('bypass') is not True
            or journal.get('agent_stop_observed', {}).get('active') is not False
            or journal.get('agent_stop_observed', {}).get('empty_runtime_confirmed') is not True
            or journal.get('registration_removed', {}).get('verified_absent') is not True):
        raise ValueError('provider reimage preparation is incomplete or does not match this plan')
    allowed_hosts = {operator.core['alias'], intent_target.get('alias')}
    events = journal.get('events', [])
    if any(event.get('host') not in allowed_hosts for event in events):
        raise ValueError('preparation journal contains a command outside the bound worker/core aliases')

    def completed(host, predicate):
        return any(event.get('host') == host and event.get('status') == 'complete'
                   and event.get('exit_code') == 0 and predicate(event.get('argv', []))
                   for event in events)

    if not completed(intent_target.get('alias'), lambda argv: argv == [
            'sudo', '-n', 'systemctl', 'stop', 'eru-agent.service']):
        raise ValueError('preparation journal does not prove the bound worker agent was stopped')
    if not completed(operator.core['alias'], lambda argv: len(argv) >= 3
                     and argv[-3:] == ['node', 'down', plan['node']]):
        raise ValueError('preparation journal does not prove the selected worker was fenced')
    if not completed(operator.core['alias'], lambda argv: len(argv) >= 3
                     and argv[-3:] == ['node', 'remove', plan['node']]):
        raise ValueError('preparation journal does not prove the selected registration was removed')
    if not completed(operator.core['alias'], lambda argv: len(argv) >= 3
                     and argv[-3:] == ['node', 'get', plan['node']]):
        raise ValueError('preparation journal does not prove the selected worker fence was read back')
    summary = {key: journal[key] for key in (
        'id', 'operation', 'plan_hash', 'status', 'stage', 'target', 'target_alias',
        'fence_observed', 'agent_stop_observed', 'registration_removed')}
    return {'path': str(path.relative_to(operator.project)), 'summary': summary,
            'summary_sha256': digest(summary)}


def prepare_reimage(operator, plan_id, expected_hash):
    """Fence and deregister exactly one empty worker, stopping before console use."""
    from labctl import consistency_issues, membership

    plan, host = _load_plan(operator, plan_id, expected_hash)
    target = plan['node']
    alias = host['alias']
    run_path = operator.root / 'runs' / (plan['id'] + '.json')
    if run_path.exists() or run_path.is_symlink():
        raise ValueError('preparation already has a journal; inspect/reconcile it and do not replay')

    operator.events = []
    operator.journal_path = run_path
    operator.journal = {
        'id': plan['id'], 'operation': 'provider-reimage-prepare', 'plan_hash': expected_hash,
        'status': 'running', 'started_at': _now(), 'controller_pid': __import__('os').getpid(),
        'events': [], 'target': target, 'target_alias': alias,
        'cluster_id': plan['bindings']['cluster']['cluster_id'],
        'generation': plan['bindings']['cluster']['generation'],
        'inventory_hash': digest(plan['bindings']['inventory']), 'source_commit': plan['source_commit'],
    }
    operator.stage('preflight')
    try:
        current = operator.snapshot()
        issues = consistency_issues(current, operator.inventory)
        health = operator.health()
        operator.journal['etcd_health'] = health
        if health.get('exit_code'):
            issues.append('etcd health failed; mutations blocked')
        if issues:
            raise ValueError('; '.join(issues))
        if current['hosts'] != plan['snapshot']['hosts'] or membership(current) != membership(plan['snapshot']):
            raise ValueError('host identity or cluster state changed; create a new provider reimage plan')
        _assert_empty_target(current, target, alias)
        _agent_active(operator, alias)
        _services_active(operator, alias)
        _assert_cluster_state(operator, plan, target_present=True)
        if _node_get(operator, target).get('bypass', False):
            raise ValueError('selected worker was already fenced or node state differs from the reviewed plan')
        operator.journal['preparation_preflight'] = {
            'at': _now(), 'status': 'passed', 'target': target, 'target_alias': alias,
            'snapshot_membership_sha256': digest(membership(current)),
            'preserved_services': ['ssh.service', 'tailscaled.service', 'docker.service', 'containerd.service'],
        }
        operator.stage('preflighted')

        operator.stage('fencing-' + target)
        core_argv = ['sudo', '-n', '/usr/local/bin/eru-cli', '--eru',
                     operator.core['ip'] + ':5001', 'node', 'down', target]
        _command(operator, operator.core['alias'], core_argv)
        node = _node_get(operator, target)
        if not node.get('bypass'):
            raise ValueError('selected worker scheduling fence was not observed')
        _assert_cluster_state(operator, plan, target_present=True, require_bypass=True)
        operator.journal['fence_observed'] = {'at': _now(), 'bypass': True}
        operator.stage('fenced-' + target)

        operator.stage('stopping-agent-' + target)
        _command(operator, alias, ['sudo', '-n', 'systemctl', 'stop', 'eru-agent.service'])
        _agent_stopped(operator, alias)
        _assert_cluster_state(operator, plan, target_present=True, require_bypass=True)
        _assert_host_state(operator, plan, alias)
        operator.journal['agent_stop_observed'] = {'at': _now(), 'active': False,
                                                  'empty_runtime_confirmed': True}
        operator.stage('agent-stopped-' + target)

        operator.stage('removing-registration-' + target)
        _assert_cluster_state(operator, plan, target_present=True, require_bypass=True)
        _assert_host_state(operator, plan, alias)
        _command(operator, operator.core['alias'], ['sudo', '-n', '/usr/local/bin/eru-cli',
            '--eru', operator.core['ip'] + ':5001', 'node', 'remove', target])
        _assert_cluster_state(operator, plan, target_present=False)
        operator.journal['registration_removed'] = {'at': _now(), 'verified_absent': True}
        operator.journal.update(status='prepared', finished_at=_now())
        operator.stage('awaiting-owner-console-reimage')
        return operator.journal
    except BaseException as exc:
        operator.journal.update(status='failed', failed_at=operator.journal['stage'],
                                error=str(exc), finished_at=_now())
        operator.save_journal()
        raise


def reconcile_preparation(operator, run_id, journal=None):
    """Read only core-side state after a preparation failure or interruption."""
    from labctl import identifier, read

    run_id = _identifier(run_id)
    path = operator.root / 'runs' / (run_id + '.json')
    if path.is_symlink() or not path.is_file():
        raise ValueError('provider reimage preparation journal is missing or unsafe')
    journal = journal if journal is not None else read(path)
    if journal.get('operation') != 'provider-reimage-prepare':
        raise ValueError('journal is not a provider reimage preparation')
    observation = {
        'at': _now(),
        'policy': 'Read-only core observation; no SSH to the worker and no command replay.',
        'remote_mutation_performed': False,
    }
    try:
        target = journal['target']
        nodes = operator.cli('pod', 'nodes', 'eru')
        matches = [node for node in nodes if node.get('name') == target]
        workloads = operator.cli('workload', 'list')
        health = operator.health()
        observation.update({
            'target_registered': len(matches) == 1,
            'target_bypass': matches[0].get('bypass') if len(matches) == 1 else None,
            'target_workload_count': sum(row.get('nodename') == target for row in workloads),
            'other_registered_nodes': sorted(node['name'] for node in nodes if node.get('name') != target),
            'core_health_exit_code': health.get('exit_code'),
        })
    except BaseException as exc:
        observation['error'] = type(exc).__name__ + ': ' + str(exc)
    if journal.get('status') == 'running':
        journal.update(status='interrupted', failed_at=journal.get('stage'), reconciled_at=_now())
    else:
        journal['reconciled_at'] = _now()
    journal['reconciliation'] = observation
    atomic_json(path, journal)
    return journal

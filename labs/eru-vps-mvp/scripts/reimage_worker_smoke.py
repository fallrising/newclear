"""Run a fenced single-worker smoke with continuous guards on its two peers."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid

from canaries import HTTPGuards, guard_targets
from labops import atomic_json, digest, lock_fds
import reimage_worker_install as install
import reimage_worker_registration as registration

SMOKE_TIMEOUT = 600
SERVICE_PROPERTIES = (
    'Id,ActiveState,SubState,MainPID,InvocationID,NRestarts,'
    'ExecMainStartTimestampMonotonic,ActiveEnterTimestampMonotonic'
)
CORE_UNITS = [
    'ssh.service', 'tailscaled.service', 'docker.service', 'containerd.service',
    'eru-core.service', 'eru-etcd.service', 'eru-mvp-firewall.service',
]
WORKER_UNITS = [
    'ssh.service', 'tailscaled.service', 'docker.service', 'containerd.service',
    'eru-agent.service', 'eru-containerd-proxy.socket', 'eru-containerd-proxy.service',
]


def _now():
    return datetime.now(timezone.utc).isoformat()


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate field in worker smoke record')
        value[key] = item
    return value


def _read_json(path, label):
    path = Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError(label + ' is missing or unsafe')
    try:
        raw = path.read_bytes()
        value = json.loads(raw, object_pairs_hook=_unique_object)
    except (OSError, json.JSONDecodeError) as exc:
        raise ValueError(label + ' is not valid JSON') from exc
    if not isinstance(value, dict):
        raise ValueError(label + ' is malformed')
    return value, hashlib.sha256(raw).hexdigest()


def _cluster_projection(snapshot):
    from reimage_prepare import _workload_projection
    return {
        'pods': sorted(row.get('name') for row in snapshot['pods']),
        'nodes': sorted((registration._projection(row) for row in snapshot['nodes']),
                        key=lambda row: row['name']),
        'workloads': _workload_projection(snapshot['workloads']),
    }


def _service_state_hashes(operator):
    result = {}
    for host in operator.inventory:
        units = CORE_UNITS if host['role'] == 'core' else WORKER_UNITS
        output = operator.command(host['alias'], [
            'sudo', '-n', 'systemctl', 'show', '--property=' + SERVICE_PROPERTIES, *units])
        if not isinstance(output, str) or not output.strip():
            raise ValueError('service state is unreadable on ' + host['alias'])
        result[host['alias']] = hashlib.sha256(output.encode()).hexdigest()
    return result


def _registration_journal(operator, bootstrap_plan, bootstrap_hash, *, require_success=True):
    run_id = bootstrap_plan['id'] + '-register'
    from labctl import identifier
    identifier(run_id)
    journal, journal_hash = _read_json(operator.root / 'runs' / (run_id + '.json'),
                                       'worker registration journal')
    if (journal.get('id') != run_id
            or journal.get('bootstrap_plan_id') != bootstrap_plan['id']
            or journal.get('operation') != 'provider-reimage-worker-registration'
            or journal.get('plan_hash') != bootstrap_hash
            or journal.get('target') != bootstrap_plan['target']['node']
            or journal.get('target_alias') != bootstrap_plan['target']['alias']):
        raise ValueError('worker registration journal differs from the bootstrap plan')
    if require_success and (
            journal.get('status') != 'registered-awaiting-smoke'
            or journal.get('node_registered') is not True
            or journal.get('agent_started') is not True
            or journal.get('available') is not True
            or journal.get('bypass') is not True):
        raise ValueError('worker registration is not complete in the fenced, available state')
    return journal, journal_hash


def _bootstrap_context(operator, bootstrap_id, bootstrap_hash, *, require_registration=True):
    from labctl import identifier
    bootstrap_id = identifier(bootstrap_id)
    plan, source_plan, receipt, observation, trusted, preparation = install._validated_context(
        operator, bootstrap_id, bootstrap_hash)
    release = registration._validate_stage(operator, plan)
    journal, journal_hash = _registration_journal(
        operator, plan, bootstrap_hash, require_success=require_registration)
    return plan, source_plan, receipt, observation, trusted, preparation, release, journal, journal_hash


def _canary_context(operator, snapshot, run_id, target):
    from labctl import identifier
    run_id = identifier(run_id)
    evidence, evidence_hash = _read_json(
        operator.project / 'private' / 'smoke' / (run_id + '.json'), 'peer canary evidence')
    if evidence.get('run_id') != run_id:
        raise ValueError('peer canary evidence ID mismatch')
    expected_nodes = {'worker-2', 'worker-3', 'worker-4'} - {target}
    targets = guard_targets(operator, snapshot, run_id, expected_nodes=expected_nodes)
    if len(targets) != 2 or {row['node'] for row in targets} != expected_nodes:
        raise ValueError('peer canaries do not guard exactly the other two workers')
    return evidence_hash, targets


def _observe(operator, context, canary_run):
    bootstrap, source_plan, receipt, observation, trusted, _prep, release, _reg_journal, _reg_hash = context
    target = bootstrap['target']
    alias, name = target['alias'], target['node']
    health = install._check_health(operator)
    snapshot = registration._assert_cluster(
        operator, source_plan, bootstrap['registration'], target_present=True, require_available=True)
    install._other_hosts_unchanged(operator, source_plan, alias)
    current_host = install._read_replacement(operator, alias, receipt, observation, trusted)
    audit = install._worker_audit(operator, bootstrap, trusted)
    facts = install._post_facts(
        operator, bootstrap, trusted, expected_agent_active='active', expected_agent_unit='enabled')
    if (current_host['machine_id'] != target['machine_id']
            or current_host['boot_id'] != target['boot_id']
            or audit.get('scope_verified') is not True
            or facts['machine_id'] != target['machine_id']
            or facts['boot_id'] != target['boot_id']):
        raise ValueError('worker identity or installed ownership changed before fenced smoke')
    core_runtime = registration._core_runtime(operator)
    if core_runtime['sha256'] != release['artifact_sha256']:
        raise ValueError('running core binary is not the verified safe AddNode release')
    canary_hash, targets = _canary_context(operator, snapshot, canary_run, name)
    services = _service_state_hashes(operator)
    return {
        'snapshot': _cluster_projection(snapshot),
        'core_runtime': core_runtime,
        'canary_evidence_sha256': canary_hash,
        'canary_targets': targets,
        'service_state_sha256': services,
        'worker': {
            'machine_id': facts['machine_id'], 'boot_id': facts['boot_id'],
            'agent_active_state': facts['agent_active_state'],
            'agent_unit_state': facts['agent_unit_state'],
            'runtime_counts': facts['runtime_counts'],
            'manifest_sha256': audit.get('manifest_sha256'),
        },
        'core_health': health,
    }


def plan_reimage_worker_smoke(operator, bootstrap_plan_id, bootstrap_hash, canary_run):
    """Create a read-only plan for smoke on the registered worker while still fenced."""
    from labctl import code_inputs, identifier
    operator.events = []
    operator.journal_path = None
    operator.journal = None
    context = _bootstrap_context(operator, bootstrap_plan_id, bootstrap_hash)
    bootstrap, _source, _receipt, _observation, _trusted, _prep, release, reg_journal, reg_hash = context
    observation = _observe(operator, context, canary_run)
    cluster_binding = operator.cluster()
    plan_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    run_id = identifier(plan_id)
    plan = {
        'schema': 1,
        'id': plan_id,
        'created_at': _now(),
        'operation': 'provider-reimage-worker-smoke',
        'bootstrap_plan': {'id': bootstrap['id'], 'sha256': bootstrap_hash},
        'registration_run': {'id': reg_journal['id'], 'sha256': reg_hash},
        'source_reimage_plan': bootstrap['source_reimage_plan'],
        'target': {key: bootstrap['target'][key] for key in
                   ('alias', 'node', 'machine_id', 'boot_id')},
        'core_release': release,
        'core_runtime': observation['core_runtime'],
        'cluster_binding': cluster_binding,
        'code_inputs_sha256': digest(code_inputs(operator.project)),
        'cluster_snapshot': observation['snapshot'],
        'worker': observation['worker'],
        'service_state_sha256': observation['service_state_sha256'],
        'canary_run': identifier(canary_run),
        'canary_evidence_sha256': observation['canary_evidence_sha256'],
        'canary_targets': observation['canary_targets'],
        'executable': True,
        'blockers': [],
        'mutation_hosts': [operator.core['alias'], bootstrap['target']['alias'],
                           *sorted(row['alias'] for row in observation['canary_targets'])],
        'steps': [
            'Revalidate the safe core, replacement worker identity, registration journal and two peer canaries',
            'Run only the target worker nginx lifecycle/resource smoke while bypass=true',
            'Keep continuous HTTP guards on the other two workers during smoke and post-checks',
            'Require smoke cleanup, zero target usage, unchanged services and cluster membership',
            'Stop at smoked-awaiting-resume; do not run node up or update inventory/generation',
        ],
    }
    path = operator.root / 'reimage-worker-smoke-plans' / (run_id + '.json')
    if path.exists() or path.is_symlink():
        raise ValueError('worker smoke plan already exists; do not overwrite it')
    envelope = {'plan': plan, 'sha256': digest(plan)}
    atomic_json(path, envelope)
    atomic_json(operator.root / 'observations' / (run_id + '-worker-smoke-plan.json'), operator.events)
    return envelope


def _load_plan(operator, plan_id, expected_hash):
    from labctl import identifier
    plan_id = identifier(plan_id)
    envelope, _raw_hash = _read_json(
        operator.root / 'reimage-worker-smoke-plans' / (plan_id + '.json'), 'worker smoke plan')
    plan = envelope.get('plan')
    if (not isinstance(plan, dict) or digest(plan) != envelope.get('sha256')
            or expected_hash != envelope.get('sha256') or plan.get('id') != plan_id
            or plan.get('operation') != 'provider-reimage-worker-smoke'
            or plan.get('executable') is not True or plan.get('blockers') != []):
        raise ValueError('worker smoke plan hash or stage contract is invalid')
    return plan


def _validate_plan_context(operator, plan, *, require_registration_hash=True):
    from labctl import code_inputs
    if digest(code_inputs(operator.project)) != plan.get('code_inputs_sha256'):
        raise ValueError('worker smoke code inputs changed after planning')
    bootstrap_ref = plan.get('bootstrap_plan')
    if not isinstance(bootstrap_ref, dict):
        raise ValueError('worker smoke plan lacks its bootstrap binding')
    context = _bootstrap_context(operator, bootstrap_ref.get('id'), bootstrap_ref.get('sha256'),
                                require_registration=require_registration_hash)
    bootstrap, _source, _receipt, _observation, _trusted, _prep, release, reg_journal, reg_hash = context
    target = bootstrap['target']
    if (plan.get('target') != {key: target[key] for key in ('alias', 'node', 'machine_id', 'boot_id')}
            or plan.get('source_reimage_plan') != bootstrap.get('source_reimage_plan')
            or plan.get('core_release') != release):
        raise ValueError('worker smoke plan target or safe core binding changed')
    if require_registration_hash and (
            plan.get('registration_run') != {'id': reg_journal['id'], 'sha256': reg_hash}):
        raise ValueError('worker registration journal changed after smoke planning')
    if operator.cluster() != plan.get('cluster_binding'):
        raise ValueError('cluster generation changed after worker smoke planning')
    observation = _observe(operator, context, plan['canary_run'])
    if (observation['snapshot'] != plan.get('cluster_snapshot')
            or observation['core_runtime'] != plan.get('core_runtime')
            or observation['worker'] != plan.get('worker')
            or observation['service_state_sha256'] != plan.get('service_state_sha256')
            or observation['canary_evidence_sha256'] != plan.get('canary_evidence_sha256')
            or observation['canary_targets'] != plan.get('canary_targets')):
        raise ValueError('worker, canary, service, core or cluster state changed after smoke planning')
    return context, observation


def _smoke_files(project):
    root = Path(project) / 'private' / 'smoke'
    if root.is_symlink() or not root.is_dir():
        raise ValueError('private smoke evidence directory is missing or unsafe')
    return {path.name for path in root.glob('*.json') if path.is_file() and not path.is_symlink()}


def _run_smoke_child(operator, plan):
    from labctl import identifier
    evidence_before = _smoke_files(operator.project)
    log_path = operator.root / 'runs' / (plan['id'] + '-worker-smoke.log')
    if log_path.exists() or log_path.is_symlink():
        raise ValueError('worker smoke log already exists')
    argv = [sys.executable, str(operator.project / 'scripts' / 'smoke-lab.py'),
            '--node', plan['target']['node']]
    fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    event = {'at': _now(), 'host': 'B-local-smoke-runner', 'argv': argv, 'status': 'started'}
    operator.events.append(event)
    operator.save_journal()
    try:
        with os.fdopen(fd, 'w') as stream:
            result = subprocess.run(argv, stdout=stream, stderr=subprocess.STDOUT,
                                    timeout=SMOKE_TIMEOUT, pass_fds=lock_fds())
    except BaseException as exc:
        event.update(status='uncertain', error=type(exc).__name__)
        operator.save_journal()
        raise
    log_hash = hashlib.sha256(log_path.read_bytes()).hexdigest()
    evidence_after = _smoke_files(operator.project)
    evidence_files = sorted(evidence_after - evidence_before)
    event.update(status='complete', exit_code=result.returncode, log_sha256=log_hash,
                 evidence_files=evidence_files)
    operator.save_journal()
    return {'returncode': result.returncode, 'evidence_files': evidence_files,
            'log_path': str(log_path.relative_to(operator.project)), 'log_sha256': log_hash}


def _validate_smoke_result(operator, plan, result):
    from labctl import identifier
    if not isinstance(result, dict) or result.get('returncode') != 0:
        raise ValueError('worker nginx smoke failed or its result is uncertain')
    files = result.get('evidence_files')
    if not isinstance(files, list) or len(files) != 1:
        raise ValueError('worker smoke did not produce exactly one private evidence record')
    name = files[0]
    if not isinstance(name, str) or Path(name).name != name or not name.endswith('.json'):
        raise ValueError('worker smoke evidence path is malformed')
    run_id = identifier(name[:-5])
    report, report_hash = _read_json(operator.project / 'private' / 'smoke' / name,
                                     'worker smoke evidence')
    rows = report.get('nodes')
    state = rows.get(plan['target']['node']) if isinstance(rows, dict) else None
    if (report.get('run_id') != run_id or report.get('pass') is not True
            or not isinstance(rows, dict) or set(rows) != {plan['target']['node']}
            or not isinstance(state, dict) or state.get('result') != 'PASS'
            or state.get('workloads_empty') is not True or state.get('usage_restored') is not True):
        raise ValueError('worker smoke evidence does not prove a clean, successful target lifecycle')
    return {'run_id': run_id, 'path': str((Path('private') / 'smoke' / name)),
            'sha256': report_hash, 'result': state['result'],
            'workloads_empty': state['workloads_empty'], 'usage_restored': state['usage_restored']}


def _validate_guard_summary(summary, targets):
    expected = {row['alias'] for row in targets}
    if not isinstance(summary, dict) or summary.get('failures') != []:
        raise ValueError('peer HTTP guard reported failures or missing workers')
    hosts = summary.get('hosts')
    if not isinstance(hosts, dict) or set(hosts) != expected:
        raise ValueError('peer HTTP guard reported failures or missing workers')
    for alias in expected:
        row = hosts[alias]
        if (row.get('samples', 0) < 2 or row.get('failures') != 0
                or row.get('max_gap_seconds', 0) > 5 or row.get('duration_seconds', 0) <= 0):
            raise ValueError('peer HTTP guard coverage was incomplete: ' + alias)


def run_reimage_worker_smoke(operator, plan_id, expected_hash, *, guard_factory=None, smoke_runner=None):
    """Smoke one fenced replacement worker and stop before resume or generation commit."""
    from labctl import identifier
    plan_id = identifier(plan_id)
    plan = _load_plan(operator, plan_id, expected_hash)
    run_path = operator.root / 'runs' / (plan_id + '.json')
    if run_path.exists() or run_path.is_symlink():
        raise ValueError('worker smoke already has a journal; reconcile it and never replay')
    operator.events = []
    operator.journal_path = run_path
    operator.journal = {
        'id': plan_id, 'operation': 'provider-reimage-worker-smoke', 'plan_hash': expected_hash,
        'bootstrap_plan_id': plan['bootstrap_plan']['id'],
        'bootstrap_plan_hash': plan['bootstrap_plan']['sha256'],
        'registration_run_id': plan['registration_run']['id'],
        'status': 'running', 'started_at': _now(),
        'target': plan['target']['node'], 'target_alias': plan['target']['alias'], 'events': [],
    }
    operator.stage('preflight')
    try:
        context, observation = _validate_plan_context(operator, plan)
        operator.journal.update(
            preflight={'core_runtime': observation['core_runtime'],
                       'cluster_sha256': digest(observation['snapshot']),
                       'service_state_sha256': observation['service_state_sha256'],
                       'canary_run': plan['canary_run']})
        operator.stage('starting-peer-http-guards')
        factory = guard_factory or HTTPGuards
        guard = factory(operator.project, plan_id, observation['canary_targets'])
        smoke_result = None
        smoke_evidence = None
        try:
            with guard:
                guard.check()
                operator.journal['remote_mutation_attempted'] = True
                operator.journal['remote_mutation_performed'] = None
                operator.stage('running-fenced-worker-smoke-' + plan['target']['node'])
                runner = smoke_runner or _run_smoke_child
                smoke_result = runner(operator, plan)
                operator.journal['smoke_child'] = {
                    'returncode': smoke_result.get('returncode') if isinstance(smoke_result, dict) else None,
                    'log_path': smoke_result.get('log_path') if isinstance(smoke_result, dict) else None,
                    'log_sha256': smoke_result.get('log_sha256') if isinstance(smoke_result, dict) else None,
                }
                operator.save_journal()
                smoke_evidence = _validate_smoke_result(operator, plan, smoke_result)
                operator.journal['smoke_evidence'] = smoke_evidence
                operator.save_journal()
                guard.check()
                operator.stage('verifying-fenced-worker-after-smoke')
                _context2, after = _validate_plan_context(operator, plan)
                guard.check()
            summary = getattr(guard, 'summary', None)
            _validate_guard_summary(summary, observation['canary_targets'])
            operator.journal.update(
                status='smoked-awaiting-resume', smoke_evidence=smoke_evidence,
                http_guards=summary, available=True, bypass=True,
                remote_mutation_performed=True, finished_at=_now())
            operator.stage('awaiting-resume')
            return operator.journal
        finally:
            summary = getattr(guard, 'summary', None)
            if summary is not None:
                operator.journal['http_guards'] = summary
                operator.save_journal()
    except BaseException as exc:
        operator.journal.update(status='failed', failed_at=operator.journal.get('stage'),
                                error=str(exc), finished_at=_now())
        operator.save_journal()
        raise


def reconcile_reimage_worker_smoke(operator, run_id, journal=None):
    """Read actual smoke, workload and guard state without rerunning smoke or resuming."""
    from labctl import identifier
    run_id = identifier(run_id)
    path = operator.root / 'runs' / (run_id + '.json')
    if path.is_symlink() or not path.is_file():
        raise ValueError('worker smoke journal is missing or unsafe')
    journal = journal if journal is not None else json.loads(path.read_text())
    if journal.get('operation') != 'provider-reimage-worker-smoke':
        raise ValueError('journal is not a worker smoke stage')
    operator.journal_path = path
    operator.journal = journal
    operator.events = list(journal.get('events', []))
    result = {
        'at': _now(),
        'policy': 'Read-only smoke reconciliation; no smoke, workload, service, fence or resume command is replayed.',
        'remote_mutation_performed': False,
    }
    try:
        plan = _load_plan(operator, run_id, journal.get('plan_hash'))
        bootstrap_ref = plan['bootstrap_plan']
        context = _bootstrap_context(operator, bootstrap_ref['id'], bootstrap_ref['sha256'],
                                     require_registration=False)
        bootstrap, source_plan, receipt, observation, trusted, _prep, release, reg_journal, reg_hash = context
        result['registration_journal_matches_plan'] = (
            plan.get('registration_run') == {'id': reg_journal['id'], 'sha256': reg_hash})
        runtime = registration._core_runtime(operator)
        from reimage_prepare import _cluster
        snapshot = _cluster(operator)
        rows = registration._node_rows(operator, bootstrap['target']['node'])
        result['core_runtime'] = {
            'active': runtime['ActiveState'] == 'active',
            'sha256_matches_safe_release': runtime['sha256'] == release['artifact_sha256'],
            'invocation_id': runtime['InvocationID'],
        }
        result['target_registration'] = {
            'count': len(rows), 'present': bool(rows),
            'available': rows[0].get('available') if len(rows) == 1 else None,
            'bypass': rows[0].get('bypass') if len(rows) == 1 else None,
        }
        try:
            scoped = registration._assert_cluster(
                operator, source_plan, bootstrap['registration'],
                target_present=len(rows) == 1, require_available=False)
            result['cluster_scope_matches'] = (
                _cluster_projection(scoped) == plan.get('cluster_snapshot'))
        except BaseException as exc:
            result['cluster_scope_matches'] = False
            result['cluster_scope_error'] = type(exc).__name__ + ': ' + str(exc)
        try:
            current_host = install._read_replacement(operator, bootstrap['target']['alias'],
                                                     receipt, observation, trusted)
            facts = install._post_facts(operator, bootstrap, trusted,
                                        expected_agent_active=None, expected_agent_unit=None)
            result['worker'] = {
                'machine_id': current_host['machine_id'], 'boot_id': current_host['boot_id'],
                'agent_active_state': facts['agent_active_state'],
                'agent_unit_state': facts['agent_unit_state'],
                'runtime_counts': facts['runtime_counts'],
            }
        except BaseException as exc:
            result['worker_error'] = type(exc).__name__ + ': ' + str(exc)
        try:
            result['service_state_sha256'] = _service_state_hashes(operator)
            result['service_state_matches_plan'] = (
                result['service_state_sha256'] == plan.get('service_state_sha256'))
        except BaseException as exc:
            result['service_error'] = type(exc).__name__ + ': ' + str(exc)
        try:
            result['core_health'] = install._check_health(operator)
        except BaseException as exc:
            result['core_health_error'] = type(exc).__name__ + ': ' + str(exc)
        canary_evidence, canary_hash = _read_json(
            operator.project / 'private' / 'smoke' / (plan['canary_run'] + '.json'),
            'peer canary evidence')
        result['canary_evidence'] = {
            'run_id': canary_evidence.get('run_id'),
            'sha256_matches_plan': canary_hash == plan.get('canary_evidence_sha256'),
        }
        if journal.get('smoke_evidence'):
            evidence_ref = journal['smoke_evidence']
            evidence, evidence_hash = _read_json(operator.project / evidence_ref['path'],
                                                 'worker smoke evidence')
            result['smoke_evidence'] = {
                'run_id': evidence.get('run_id'), 'pass': evidence.get('pass'),
                'sha256_matches_journal': evidence_hash == evidence_ref.get('sha256'),
            }
        else:
            result['smoke_evidence'] = {'present': False}
    except BaseException as exc:
        result['error'] = type(exc).__name__ + ': ' + str(exc)
    if journal.get('status') == 'running':
        journal.update(status='interrupted', failed_at=journal.get('stage'), reconciled_at=_now())
    else:
        journal['reconciled_at'] = _now()
    journal['reconciliation'] = result
    journal['events'] = operator.events
    atomic_json(path, journal)
    return journal

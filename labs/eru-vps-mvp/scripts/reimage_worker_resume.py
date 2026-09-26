"""Resume a smoked replacement worker exactly once and keep generation unchanged."""
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import uuid

from labops import atomic_json, digest
import eru_node_resume
import reimage_worker_install as install
import reimage_worker_registration as registration
import reimage_worker_smoke as smoke


def _now():
    return datetime.now(timezone.utc).isoformat()


def _smoke_journal(operator, smoke_plan, smoke_hash, *, require_success=True):
    run_id = smoke_plan['id']
    from labctl import identifier
    identifier(run_id)
    path = operator.root / 'runs' / (run_id + '.json')
    journal, journal_hash = smoke._read_json(path, 'fenced worker smoke journal')
    if (journal.get('id') != run_id
            or journal.get('operation') != 'provider-reimage-worker-smoke'
            or journal.get('plan_hash') != smoke_hash
            or journal.get('target') != smoke_plan['target']['node']
            or journal.get('target_alias') != smoke_plan['target']['alias']):
        raise ValueError('worker smoke journal does not match the source plan')
    if require_success and (
            journal.get('status') != 'smoked-awaiting-resume'
            or journal.get('stage') != 'awaiting-resume'
            or journal.get('available') is not True or journal.get('bypass') is not True
            or journal.get('remote_mutation_performed') is not True):
        raise ValueError('worker smoke has not completed successfully while the target remains fenced')
    return journal, journal_hash


def _smoke_evidence(operator, plan, journal):
    from labctl import identifier
    ref = journal.get('smoke_evidence')
    if not isinstance(ref, dict) or not isinstance(ref.get('path'), str):
        raise ValueError('successful smoke journal lacks its private evidence reference')
    path = Path(ref['path'])
    if path.is_absolute() or '..' in path.parts or path.parts[:2] != ('private', 'smoke'):
        raise ValueError('worker smoke evidence path is outside private/smoke')
    report, report_hash = smoke._read_json(operator.project / path, 'worker smoke evidence')
    run_id = identifier(report.get('run_id'))
    rows = report.get('nodes')
    target = plan['target']['node']
    state = rows.get(target) if isinstance(rows, dict) else None
    if (report_hash != ref.get('sha256') or report.get('pass') is not True
            or not isinstance(rows, dict) or set(rows) != {target}
            or not isinstance(state, dict) or state.get('result') != 'PASS'
            or state.get('workloads_empty') is not True
            or state.get('usage_restored') is not True):
        raise ValueError('worker smoke evidence no longer proves a clean target lifecycle')
    return {'run_id': run_id, 'path': str(path), 'sha256': report_hash,
            'result': 'PASS', 'workloads_empty': True, 'usage_restored': True}


def _prior_resume_attempt(operator, smoke_plan_id):
    runs = operator.root / 'runs'
    if runs.is_symlink() or not runs.is_dir():
        raise ValueError('private run journal directory is missing or unsafe')
    for path in runs.glob('*.json'):
        if path.is_symlink() or not path.is_file():
            continue
        try:
            journal, _ = smoke._read_json(path, 'worker resume journal')
        except ValueError:
            continue
        source = journal.get('source_smoke_plan')
        if (journal.get('operation') == 'provider-reimage-worker-resume'
                and isinstance(source, dict) and source.get('id') == smoke_plan_id
                and journal.get('resume_attempted') is True):
            raise ValueError('worker resume was already attempted; reconcile it and never send node up again')


def _resume_context(operator, smoke_plan_id, smoke_hash):
    from labctl import code_inputs, identifier
    smoke_plan_id = identifier(smoke_plan_id)
    _prior_resume_attempt(operator, smoke_plan_id)
    smoke_plan = smoke._load_plan(operator, smoke_plan_id, smoke_hash)
    context, observation = smoke._validate_plan_context(operator, smoke_plan)
    journal, journal_hash = _smoke_journal(operator, smoke_plan, smoke_hash)
    evidence = _smoke_evidence(operator, smoke_plan, journal)
    smoke._validate_guard_summary(journal.get('http_guards'), smoke_plan['canary_targets'])
    bootstrap = context[0]
    release = context[6]
    expected = {
        'bootstrap_plan': {'id': bootstrap['id'], 'sha256': smoke_plan['bootstrap_plan']['sha256']},
        'registration_run': smoke_plan['registration_run'],
        'source_reimage_plan': bootstrap['source_reimage_plan'],
        'target': smoke_plan['target'],
        'core_ip': operator.core['ip'],
        'registration': bootstrap['registration'],
        'core_release': release,
        'core_runtime': observation['core_runtime'],
        'cluster_binding': operator.cluster(),
        'cluster_snapshot': observation['snapshot'],
        'worker': observation['worker'],
        'service_state_sha256': observation['service_state_sha256'],
        'canary_run': smoke_plan['canary_run'],
        'canary_evidence_sha256': observation['canary_evidence_sha256'],
        'canary_targets': observation['canary_targets'],
        'smoke_evidence': evidence,
        'smoke_guard_summary_sha256': digest(journal['http_guards']),
        'code_inputs_sha256': digest(code_inputs(operator.project)),
    }
    return smoke_plan, smoke_hash, context, observation, journal, journal_hash, expected


def plan_reimage_worker_resume(operator, smoke_plan_id, smoke_hash):
    """Create a hash-bound plan after successful fenced smoke; no remote mutation."""
    from labctl import identifier
    operator.events = []
    operator.journal_path = None
    operator.journal = None
    smoke_plan, smoke_hash, _context, observation, journal, journal_hash, bound = _resume_context(
        operator, smoke_plan_id, smoke_hash)
    plan_id = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8]
    run_id = identifier(plan_id)
    plan = {
        'schema': 1,
        'id': plan_id,
        'created_at': _now(),
        'operation': 'provider-reimage-worker-resume',
        'smoke_plan': {'id': smoke_plan['id'], 'sha256': smoke_hash},
        'smoke_journal': {'id': journal['id'], 'sha256': journal_hash},
        **bound,
        'executable': True,
        'blockers': [],
        'mutation_hosts': [operator.core['alias']],
        'steps': [
            'Revalidate the successful fenced smoke, safe core, replacement identity, peers and services',
            'Wait for the worker to remain available and bypass=true, then send one explicit node up via the core SSH alias',
            'Verify the exact worker is available=true and bypass=false while peer HTTP guards remain active',
            'Stop before host inventory, worker IP or cluster generation commit',
        ],
    }
    path = operator.root / 'reimage-worker-resume-plans' / (run_id + '.json')
    if path.exists() or path.is_symlink():
        raise ValueError('worker resume plan already exists; do not overwrite it')
    envelope = {'plan': plan, 'sha256': digest(plan)}
    atomic_json(path, envelope)
    atomic_json(operator.root / 'observations' / (run_id + '-worker-resume-plan.json'), operator.events)
    return envelope


def _load_plan(operator, plan_id, expected_hash):
    from labctl import identifier
    plan_id = identifier(plan_id)
    envelope, _ = smoke._read_json(
        operator.root / 'reimage-worker-resume-plans' / (plan_id + '.json'), 'worker resume plan')
    plan = envelope.get('plan')
    if (not isinstance(plan, dict) or digest(plan) != envelope.get('sha256')
            or expected_hash != envelope.get('sha256') or plan.get('id') != plan_id
            or plan.get('operation') != 'provider-reimage-worker-resume'
            or plan.get('executable') is not True or plan.get('blockers') != []
            or plan.get('mutation_hosts') != [operator.core['alias']]):
        raise ValueError('worker resume plan hash or stage contract is invalid')
    return plan


def _validate_plan_context(operator, plan):
    from labctl import code_inputs
    if digest(code_inputs(operator.project)) != plan.get('code_inputs_sha256'):
        raise ValueError('worker resume code inputs changed after planning')
    smoke_ref = plan.get('smoke_plan')
    if not isinstance(smoke_ref, dict):
        raise ValueError('worker resume plan lacks its smoke plan binding')
    values = _resume_context(operator, smoke_ref.get('id'), smoke_ref.get('sha256'))
    smoke_plan, smoke_hash, context, observation, journal, journal_hash, expected = values
    expected['smoke_plan'] = {'id': smoke_plan['id'], 'sha256': smoke_hash}
    expected['smoke_journal'] = {'id': journal['id'], 'sha256': journal_hash}
    for key, value in expected.items():
        if plan.get(key) != value:
            raise ValueError('worker resume binding changed after planning: ' + key)
    return smoke_plan, context, observation, journal


def _operator_runner(operator, plan, guard):
    target_node = plan['target']['node']

    def run(argv, *, capture_output=True, text=True, timeout=30, check=False):
        is_resume = argv[-3:] == ['node', 'up', target_node]
        if is_resume:
            if operator.journal.get('resume_attempted') is True:
                raise ValueError('node up is single-use and has already been attempted')
            guard.check()
            _validate_plan_context(operator, plan)
            operator.journal.update(resume_attempted=True, resume_outcome='unknown',
                                    remote_mutation_attempted=True, remote_mutation_performed=None)
            operator.save_journal()
        try:
            stdout = operator.command(operator.core['alias'], argv, check=False,
                                      timeout=timeout, record_output=True)
        except BaseException:
            if is_resume:
                operator.journal['resume_outcome'] = 'uncertain'
                operator.save_journal()
            raise
        event = operator.events[-1]
        returncode = event.get('exit_code')
        if is_resume:
            operator.journal['resume_outcome'] = 'response-received' if returncode == 0 else 'rejected-or-uncertain'
            if returncode == 0:
                operator.journal['remote_mutation_performed'] = True
            operator.save_journal()
        return subprocess.CompletedProcess(argv, returncode if isinstance(returncode, int) else 255,
                                           stdout, event.get('stderr') or '')

    return run


def _validate_resumed_cluster(operator, source_plan, plan):
    from reimage_prepare import _cluster, _workload_projection
    snapshot = _cluster(operator)
    before = source_plan['snapshot']
    if sorted(row.get('name') for row in snapshot['pods']) != sorted(row.get('name') for row in before['pods']):
        raise ValueError('pod membership changed during worker resume')
    if _workload_projection(snapshot['workloads']) != _workload_projection(before['workloads']):
        raise ValueError('workload membership changed during worker resume')
    name = plan['target']['node']
    targets = [row for row in snapshot['nodes'] if row.get('name') == name]
    if len(targets) != 1:
        raise ValueError('resumed worker registration is missing or duplicated')
    expected_other = {row['name']: registration._projection(row)
                      for row in before['nodes'] if row.get('name') != name}
    actual_other = {row['name']: registration._projection(row)
                    for row in snapshot['nodes'] if row.get('name') != name}
    if actual_other != expected_other:
        raise ValueError('unrelated worker registration changed during resume')
    row = targets[0]
    registration_plan = plan['registration']
    if (row.get('name') != registration_plan['node']
            or row.get('podname') != registration_plan['podname']
            or row.get('endpoint') != registration_plan['endpoint']
            or row.get('labels') != registration_plan['labels']
            or registration._json_value(row.get('resource_capacity'), 'resumed capacity')
               != registration._json_value(registration_plan['resource_capacity'], 'planned capacity')
            or not registration._zero(registration._json_value(row.get('resource_usage', '{}'), 'resumed usage'))
            or row.get('available') is not True or row.get('bypass') is not False):
        raise ValueError('resumed worker identity, capacity, usage or scheduling state is invalid')
    if any(workload.get('nodename') == name for workload in snapshot['workloads']):
        raise ValueError('new workloads appeared on the worker during resume verification')
    return snapshot


def _post_resume(operator, plan, context):
    bootstrap, source_plan = context[0], context[1]
    install._check_health(operator)
    if operator.cluster() != plan['cluster_binding']:
        raise ValueError('cluster generation changed during worker resume')
    snapshot = _validate_resumed_cluster(operator, source_plan, plan)
    install._other_hosts_unchanged(operator, source_plan, plan['target']['alias'])
    current_host = install._read_replacement(operator, plan['target']['alias'], context[2], context[3], context[4])
    audit = install._worker_audit(operator, bootstrap, context[4])
    facts = install._post_facts(operator, bootstrap, context[4],
                                expected_agent_active='active', expected_agent_unit='enabled')
    if (current_host['machine_id'] != plan['target']['machine_id']
            or current_host['boot_id'] != plan['target']['boot_id']
            or facts['machine_id'] != plan['target']['machine_id']
            or facts['boot_id'] != plan['target']['boot_id']
            or audit.get('scope_verified') is not True):
        raise ValueError('replacement worker identity or owner manifest changed during resume')
    runtime = registration._core_runtime(operator)
    if runtime != plan['core_runtime']:
        raise ValueError('core process or safe artifact changed during worker resume')
    service_hashes = smoke._service_state_hashes(operator)
    if service_hashes != plan['service_state_sha256']:
        raise ValueError('preserved service state changed during worker resume')
    return {'target_available': True, 'target_bypass': False,
            'cluster_sha256': digest(smoke._cluster_projection(snapshot)),
            'core_runtime': runtime, 'worker_manifest_sha256': audit.get('manifest_sha256'),
            'service_state_sha256': service_hashes}


def resume_reimage_worker(operator, plan_id, expected_hash, *, guard_factory=None, sleep=None,
                          attempts=60, interval=1):
    """Explicitly resume a successful smoke target once and do not commit its generation."""
    from labctl import identifier
    plan_id = identifier(plan_id)
    plan = _load_plan(operator, plan_id, expected_hash)
    run_path = operator.root / 'runs' / (plan_id + '.json')
    if run_path.exists() or run_path.is_symlink():
        raise ValueError('worker resume already has a journal; reconcile it and never replay')
    operator.events = []
    operator.journal_path = run_path
    operator.journal = {
        'id': plan_id, 'operation': 'provider-reimage-worker-resume', 'plan_hash': expected_hash,
        'source_smoke_plan': plan['smoke_plan'], 'smoke_journal': plan['smoke_journal'],
        'target': plan['target']['node'], 'target_alias': plan['target']['alias'],
        'status': 'running', 'started_at': _now(), 'resume_attempted': False,
        'remote_mutation_attempted': False, 'remote_mutation_performed': False, 'events': [],
    }
    operator.stage('preflight')
    try:
        _smoke_plan, context, observation, _smoke_journal = _validate_plan_context(operator, plan)
        operator.journal['preflight'] = {
            'smoke_evidence': plan['smoke_evidence'],
            'core_runtime': observation['core_runtime'],
            'cluster_sha256': digest(observation['snapshot']),
            'service_state_sha256': observation['service_state_sha256'],
            'smoke_guard_summary_sha256': plan['smoke_guard_summary_sha256'],
        }
        operator.save_journal()
        operator.stage('starting-peer-http-guards')
        factory = guard_factory or smoke.HTTPGuards
        guard = factory(operator.project, plan_id, observation['canary_targets'])
        try:
            with guard:
                guard.check()
                operator.stage('waiting-ready-while-fenced-' + plan['target']['node'])
                helper = eru_node_resume.resume_registered_worker
                kwargs = {'runner': _operator_runner(operator, plan, guard),
                          'attempts': attempts, 'interval': interval}
                if sleep is not None:
                    kwargs['sleep'] = sleep
                result = helper(plan['core_ip'], plan['target']['node'],
                                plan['registration']['endpoint'], **kwargs)
                operator.journal['resume_result'] = result
                operator.save_journal()
                guard.check()
                operator.stage('verifying-resumed-worker')
                post = _post_resume(operator, plan, context)
                operator.journal['post_resume'] = post
                guard.check()
            summary = getattr(guard, 'summary', None)
            smoke._validate_guard_summary(summary, observation['canary_targets'])
            operator.journal.update(status='resumed-awaiting-generation-commit', resume_attempted=True,
                                    remote_mutation_attempted=True, remote_mutation_performed=True,
                                    available=True, bypass=False, http_guards=summary, finished_at=_now())
            operator.stage('awaiting-generation-commit')
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


def reconcile_reimage_worker_resume(operator, run_id, journal=None):
    """Read the resumed worker, peers and services without sending node up or cleanup."""
    from labctl import identifier
    run_id = identifier(run_id)
    path = operator.root / 'runs' / (run_id + '.json')
    if path.is_symlink() or not path.is_file():
        raise ValueError('worker resume journal is missing or unsafe')
    journal = journal if journal is not None else smoke._read_json(path, 'worker resume journal')[0]
    if journal.get('operation') != 'provider-reimage-worker-resume':
        raise ValueError('journal is not a worker resume stage')
    operator.journal_path = path
    operator.journal = journal
    operator.events = list(journal.get('events', []))
    result = {
        'at': _now(),
        'policy': 'Read-only resume reconciliation; never send node up, smoke, cleanup or inventory changes.',
        'node_up_replayed': False,
    }
    try:
        plan = _load_plan(operator, run_id, journal.get('plan_hash'))
        smoke_plan = smoke._load_plan(operator, plan['smoke_plan']['id'], plan['smoke_plan']['sha256'])
        smoke_journal, smoke_hash = _smoke_journal(operator, smoke_plan, plan['smoke_plan']['sha256'],
                                                   require_success=False)
        result['smoke_journal_matches_plan'] = (
            {'id': smoke_journal['id'], 'sha256': smoke_hash} == plan.get('smoke_journal'))
        bootstrap, source_plan, receipt, observation, trusted, _prep, release, _reg, _reg_hash = \
            smoke._bootstrap_context(operator, smoke_plan['bootstrap_plan']['id'],
                                     smoke_plan['bootstrap_plan']['sha256'], require_registration=False)
        runtime = registration._core_runtime(operator)
        rows = registration._node_rows(operator, plan['target']['node'])
        result['core_runtime'] = {'active': runtime['ActiveState'] == 'active',
                                  'sha256_matches_safe_release': runtime['sha256'] == release['artifact_sha256'],
                                  'invocation_id': runtime['InvocationID']}
        result['target_registration'] = {
            'count': len(rows), 'present': len(rows) == 1,
            'available': rows[0].get('available') if len(rows) == 1 else None,
            'bypass': rows[0].get('bypass') if len(rows) == 1 else None,
            'endpoint_matches_plan': (len(rows) == 1 and rows[0].get('endpoint') == bootstrap['registration']['endpoint']),
        }
        try:
            snapshot = _validate_resumed_cluster(operator, source_plan, plan)
            result['cluster_scope_matches_plan'] = True
            result['cluster_generation_matches_plan'] = operator.cluster() == plan.get('cluster_binding')
        except BaseException as exc:
            result['cluster_scope_matches_plan'] = False
            result['cluster_scope_error'] = type(exc).__name__ + ': ' + str(exc)
        try:
            current_host = install._read_replacement(operator, plan['target']['alias'], receipt, observation, trusted)
            facts = install._post_facts(operator, bootstrap, trusted,
                                        expected_agent_active=None, expected_agent_unit=None)
            result['worker'] = {'machine_id': current_host['machine_id'], 'boot_id': current_host['boot_id'],
                                'agent_active_state': facts['agent_active_state'],
                                'agent_unit_state': facts['agent_unit_state'],
                                'runtime_counts': facts['runtime_counts']}
        except BaseException as exc:
            result['worker_error'] = type(exc).__name__ + ': ' + str(exc)
        try:
            result['service_state_sha256'] = smoke._service_state_hashes(operator)
            result['service_state_matches_plan'] = result['service_state_sha256'] == plan.get('service_state_sha256')
        except BaseException as exc:
            result['service_error'] = type(exc).__name__ + ': ' + str(exc)
        try:
            result['core_health'] = install._check_health(operator)
        except BaseException as exc:
            result['core_health_error'] = type(exc).__name__ + ': ' + str(exc)
        evidence, evidence_hash = smoke._read_json(
            operator.project / 'private' / 'smoke' / (smoke_plan['canary_run'] + '.json'),
            'peer canary evidence')
        result['canary_evidence'] = {'run_id': evidence.get('run_id'),
                                     'sha256_matches_plan': evidence_hash == plan.get('canary_evidence_sha256')}
        try:
            smoke_evidence = _smoke_evidence(operator, smoke_plan, smoke_journal)
            result['smoke_evidence'] = {'run_id': smoke_evidence['run_id'], 'pass': True,
                                        'sha256_matches_plan': smoke_evidence['sha256'] ==
                                            plan.get('smoke_evidence', {}).get('sha256')}
        except BaseException as exc:
            result['smoke_evidence_error'] = type(exc).__name__ + ': ' + str(exc)
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

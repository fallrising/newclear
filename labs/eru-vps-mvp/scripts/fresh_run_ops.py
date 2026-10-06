"""One bounded fresh run entry; fixed network/bootstrap steps and observation recovery.

Every next call runs one exact reviewed operation under owned admission. This
driver never releases pending or commits an accepted cluster generation.
"""
import copy
from datetime import datetime, timezone
import importlib
import os

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import PrivateFiles, AREA as EXECUTIONS, _review, _record
from fresh_rebuild import plan_digest
from fresh_reimage_receipt_ops import _complete_run, _pending_matches
from fresh_run_lock import FreshRunLock
import pending_generation


# Wire input cannot select a module, command, transport or Python callable.
OPERATIONS = {
    'prepare_bootstrap': ('fresh_bootstrap_ops',
        ('plan_id', 'plan_sha', 'network_receipt_sha', 'input_file', 'input_sha'), None),
    'execute_bootstrap': ('fresh_bootstrap_ops',
        ('run_id', 'bootstrap_sha', 'step_index', 'authorization_file', 'authorization_sha'), 'adapter'),
    'reconcile_bootstrap': ('fresh_bootstrap_ops',
        ('run_id', 'step_index', 'expected_intent_sha'), 'observer'),
    'inspect_receipts': ('fresh_reimage_receipt_ops',
        ('run_id', 'execution_sha', 'input_file'), None),
    'collect_replacement_facts': ('fresh_replacement_ops',
        ('run_id', 'execution_sha', 'input_file', 'input_sha', 'observation_id'), 'reader'),
    'prepare_network_access': ('fresh_network_access_ops',
        ('run_id', 'execution_sha', 'input_file', 'input_sha', 'plan_id'), None),
    'prepare_network_manual_setup': ('fresh_network_ready_ops',
        ('plan_id', 'plan_sha', 'authorization_file', 'authorization_sha', 'input_file', 'input_sha'), None),
    'prepare_network_directory': ('fresh_network_directory_ops',
        ('plan_id', 'expected_sha', 'authorization_file', 'authorization_sha', 'host_index'), 'adapter'),
    'stage_network_files': ('fresh_network_staging_ops',
        ('plan_id', 'expected_sha', 'authorization_file', 'authorization_sha', 'host_index'), 'adapter'),
    'activate_network_firewall': ('fresh_network_firewall_ops',
        ('plan_id', 'expected_sha', 'authorization_file', 'authorization_sha', 'host_index'), 'adapter'),
    'record_network_manual_setup': ('fresh_network_ready_ops',
        ('run_id', 'expected_intent_sha', 'receipt_file', 'receipt_sha'), None),
    'accept_network_ready': ('fresh_network_ready_ops',
        ('run_id', 'expected_manual_receipt_sha'), 'collector'),
    'reconcile_network_directory': ('fresh_network_directory_ops',
        ('run_id', 'host_index', 'expected_intent_sha'), 'observer'),
    'reconcile_network_files': ('fresh_network_staging_ops',
        ('run_id', 'host_index', 'expected_intent_sha'), 'observer'),
    'reconcile_network_firewall': ('fresh_network_firewall_ops',
        ('run_id', 'host_index', 'expected_intent_sha'), 'observer'),
}
RECOVERY = frozenset(name for name in OPERATIONS if name.startswith('reconcile_'))
ERRORS = (ValueError, RuntimeError, OSError, KeyError, TypeError, AttributeError)
PUBLIC_FIELDS = frozenset({
    'status', 'id', 'run_id', 'operation', 'execution_sha256', 'pending_sha256',
    'sha256', 'intent_sha256', 'receipt_sha256', 'manual_receipt_sha256',
    'host_count', 'host_index', 'file_count', 'next_stage', 'stage_accepted',
    'generation_changed', 'dispatch_attempted', 'remote_mutation_performed',
    'integrity_verified', 'current_authority_verified', 'current_network_ready',
    'historical_integrity', 'pending_present', 'uncertain', 'journal_receipt_count',
    'execution_integrity_verified', 'journal_integrity_verified',
    'bootstrap_sha256', 'step_index', 'step_count', 'stage', 'worker_count', 'completed_step_count',
    'v01_elapsed_seconds',
})


def _time(now):
    value = now() if callable(now) else now
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('fresh run requires timezone-aware time')
    return value.astimezone(timezone.utc)


def _summary(run):
    return {'status': 'blocked', 'id': run, 'generation_changed': False,
            'stage_accepted': False, 'current_network_ready': False,
            'current_authority_verified': False, 'integrity_verified': False,
            'dispatch_attempted': None, 'remote_mutation_performed': None}


def public_summary(value):
    """Only reviewed scalar output fields, never private evidence or exceptions."""
    return {key: item for key, item in value.items() if key in PUBLIC_FIELDS
            and type(item) in (str, int, bool, type(None))}


def _execution(files, run, expected, now, source_state, *, current=False):
    _complete_run(files, run)
    envelope, _, _ = files.json(EXECUTIONS + '/' + run + '/execution.json')
    exact(envelope, {'execution', 'sha256'})
    record = envelope['execution']
    if envelope['sha256'] != expected or plan_digest(record) != expected:
        raise ValueError('fresh run execution digest mismatch')
    binding = record['binding']
    if binding['run_id'] != run or timestamp(record['created_at']) > _time(now):
        raise ValueError('fresh run execution identity or chronology invalid')
    observed = _time(now) if current else timestamp(record['created_at'])
    plan, source = _review(files, binding['plan_id'], binding['review_sha256'], observed, source_state)
    rebuilt = _record(files, plan, binding['review_sha256'], run,
                      record['input']['path'], observed, source)
    rebuilt['created_at'] = record['created_at']
    if plan_digest(rebuilt) != expected:
        raise ValueError('fresh run execution derivation changed')
    files.recheck()
    return record


def _reservation(record, digest):
    binding = record['binding']
    result = {key: binding[key] for key in (
        'cluster_id', 'run_id', 'generation_before', 'target_generation',
        'review_sha256', 'scope_sha256')}
    result.update(execution_sha256=digest, cluster_sha256=record['cluster_sha256'],
                  fence_sha256=record['evidence']['writer_fence']['sha256'])
    return result


def start_run(project, plan_id, review_sha, input_file, run_id, *, now=None, source_state=None):
    """Prepare and reserve once; validated evidence is rechecked inside the lock."""
    identifier(plan_id)
    identifier(run_id)
    sha256(review_sha)
    base = dict(_summary(run_id), dispatch_attempted=False, remote_mutation_performed=False)
    try:
        from fresh_execution_ops import prepare_execution
        if pending_generation.inspect(project)['status'] != 'absent':
            return base
        envelope, _ = prepare_execution(project, plan_id, review_sha, input_file, run_id,
            now=_time(now), source_state=source_state)
        digest = envelope['sha256']
        bindings = _reservation(envelope['execution'], digest)
        def verify(lock):
            files = PrivateFiles(project)
            try:
                record = _execution(files, run_id, digest, now, source_state, current=True)
                lock.check_private_root()
                files.recheck()
                return _reservation(record, digest)
            finally:
                files.close()
        pending_sha = pending_generation.reserve(project, bindings, verify=verify)
        observed = pending_generation.inspect(project)
        files = PrivateFiles(project)
        try:
            record = _execution(files, run_id, digest, now, source_state, current=True)
            if (observed['status'] != 'pending' or observed['sha256'] != pending_sha
                    or not _pending_matches(observed, record, digest, files.identity)):
                return base
            files.recheck()
        finally:
            files.close()
        return {**base, 'status': 'reserved', 'execution_sha256': digest,
                'pending_sha256': pending_sha, 'integrity_verified': True,
                'pending_present': True, 'next_stage': 'hosts-reimaged'}
    except ERRORS:
        return base


def _request(files, input_file, input_sha, run, execution_sha, pending, *, recovery):
    document, _, digest = files.json(str(input_file))
    if digest != input_sha:
        raise ValueError('fresh step request bytes changed')
    exact(document, {'schema_version', 'operation', 'run_id', 'execution_sha256',
                     'pending_sha256', 'step', 'parameters', 'renewal'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != 'fresh-run-step' or document['run_id'] != run
            or document['execution_sha256'] != execution_sha
            or document['pending_sha256'] != pending['sha256']):
        raise ValueError('fresh step request binding mismatch')
    step = document['step']
    if step not in OPERATIONS or (step in RECOVERY) != recovery:
        raise ValueError('fresh step operation not allowed')
    parameters = document['parameters']
    exact(parameters, set(OPERATIONS[step][1]))
    if any(type(value) not in (str, int) for value in parameters.values()):
        raise ValueError('fresh step accepts only exact scalar parameters')
    if ('run_id' in parameters and parameters['run_id'] != run
            or 'execution_sha' in parameters and parameters['execution_sha'] != execution_sha):
        raise ValueError('fresh step target belongs to another execution')
    ref = document['renewal']
    exact(ref, {'path', 'sha256'})
    sha256(ref['sha256'])
    files.binding(ref)
    files.recheck()
    return document


def _adapter(project, step, parameters):
    if step in ('execute_bootstrap', 'reconcile_bootstrap'):
        from fresh_bootstrap_ops import AREA as BOOTSTRAP
        from fresh_bootstrap_ssh import SSHBootstrapAdapter
        files = PrivateFiles(project, max_bytes=128 * 1024 * 1024)
        try:
            envelope, _, _ = files.json(BOOTSTRAP + '/' + parameters['run_id'] + '/plan.json')
            exact(envelope, {'plan', 'sha256'})
            if (plan_digest(envelope['plan']) != envelope['sha256']
                    or envelope['plan']['run_id'] != parameters['run_id']
                    or step == 'execute_bootstrap' and envelope['sha256'] != parameters['bootstrap_sha']):
                raise ValueError('bootstrap transport plan binding differs')
            rendered = envelope['plan']['network_render']
            by_ip = dict(line.split(' ', 1) for line in rendered['controller_known_hosts'].splitlines())
            keys = {host['alias']: by_ip[host['ip']] for host in rendered['hosts']}
            files.recheck()
        finally:
            files.close()
        adapter = SSHBootstrapAdapter(keys)
        return ObservationOnly(adapter.observe) if step in RECOVERY else adapter
    if step == 'collect_replacement_facts':
        return None
    if step == 'accept_network_ready':
        return None
    if step in RECOVERY:
        # The original intent identifies the immutable plan, never a current alias.
        module = importlib.import_module(OPERATIONS[step][0])
        path = module.AREA + '/' + parameters['run_id'] + '/host-' + str(parameters['host_index']) + '/intent.json'
    else:
        path = None
    files = PrivateFiles(project)
    try:
        if path:
            envelope, _, _ = files.json(path)
            if (envelope['sha256'] != parameters['expected_intent_sha']
                    or plan_digest(envelope['intent']) != envelope['sha256']):
                raise ValueError('fresh recovery intent digest changed')
            plan_id = envelope['intent']['action']['plan_id']
            expected = envelope['intent']['action']['plan_sha256']
        else:
            plan_id = parameters['plan_id']
            expected = parameters['expected_sha']
        plan, _, _ = files.json('private/operations/fresh-rebuild/network-access-plans/' + plan_id + '/plan.json')
        if plan['sha256'] != expected or plan_digest(plan['plan']) != expected:
            raise ValueError('fresh transport plan digest changed')
        rendered = plan['plan']['render']
        by_ip = dict(line.split(' ', 1) for line in rendered['controller_known_hosts'].splitlines())
        keys = {host['alias']: by_ip[host['ip']] for host in rendered['hosts']}
        files.recheck()
    finally:
        files.close()
    if step in ('prepare_network_directory', 'reconcile_network_directory'):
        from fresh_network_directory_ssh import SSHNetworkDirectoryAdapter
        adapter = SSHNetworkDirectoryAdapter(keys)
    elif step in ('stage_network_files', 'reconcile_network_files'):
        from fresh_network_staging_ssh import SSHNetworkStagingAdapter
        adapter = SSHNetworkStagingAdapter(keys)
    else:
        from fresh_network_firewall_ssh import SSHNetworkFirewallAdapter
        adapter = SSHNetworkFirewallAdapter(keys)
    return ObservationOnly(adapter.observe) if step in RECOVERY else adapter


class ObservationOnly:
    """Recovery receives one fixed observation callable and no mutator API."""
    __slots__ = ('observe',)

    def __init__(self, observe):
        self.observe = observe


def next_step(project, run_id, execution_sha, input_file, input_sha, *,
              now=None, source_state=None, adapters=None, recovery=False):
    """Run one named step; repeated writers use their original no-replay journal."""
    identifier(run_id)
    sha256(execution_sha)
    sha256(input_sha)
    base = _summary(run_id)
    files = None
    try:
        pending = pending_generation.inspect(project)
        if pending['status'] != 'pending':
            return base
        with FreshRunLock(project, pending) as lock:
            files = PrivateFiles(project)
            record = _execution(files, run_id, execution_sha, now, source_state)
            if not _pending_matches(pending, record, execution_sha, files.identity):
                return base
            request = _request(files, input_file, input_sha, run_id, execution_sha, pending, recovery=recovery)
            step, parameters = request['step'], copy.deepcopy(request['parameters'])
            module_name, _, injection = OPERATIONS[step]
            from fresh_run_authority import current_step
            with current_step(project, request['renewal'], operation=step, target=parameters,
                              now=now, source_state=source_state, lock=lock):
                function = getattr(importlib.import_module(module_name), step)
                kwargs = dict(parameters, now=now, source_state=source_state)
                if injection:
                    adapter = (adapters or {}).get(step)
                    if adapter is None:
                        adapter = _adapter(project, step, parameters)
                    if adapter is not None:
                        kwargs[injection] = adapter
                if step in ('execute_bootstrap', 'reconcile_bootstrap'):
                    collector = (adapters or {}).get('bootstrap_network_collector')
                    if collector is not None:
                        kwargs['collector'] = collector
                result = function(project, **kwargs)
                files.recheck()
                lock.check_pending()
            return public_summary({**base, **result, 'run_id': run_id, 'operation': step,
                'execution_sha256': execution_sha, 'pending_sha256': pending['sha256'],
                'remote_mutation_performed': False if recovery else result.get('remote_mutation_performed'),
                'current_authority_verified': result['status'] != 'blocked'})
    except ERRORS:
        return base
    finally:
        if files is not None:
            files.close()


def _network_state(files, run):
    """Observe journal shape/counts only; no remote calls or semantic acceptance."""
    complete, uncertain = 0, False
    for module in ('fresh_network_directory_ops', 'fresh_network_staging_ops', 'fresh_network_firewall_ops'):
        area = importlib.import_module(module).AREA
        try:
            parent = files.directory(files.parts(area) + (run,))
        except FileNotFoundError:
            continue
        try:
            names = sorted(os.listdir(parent))
            if names != ['host-' + str(i) for i in range(len(names))] or len(names) > 4:
                raise ValueError('fresh run journal has foreign entries or holes')
        finally:
            os.close(parent)
        for name in names:
            directory = files.directory(files.parts(area) + (run, name))
            try:
                entries = set(os.listdir(directory))
                if entries == {'intent.json', 'receipt.json'}:
                    complete += 1
                elif entries == {'intent.json'}:
                    uncertain = True
                else:
                    raise ValueError('fresh run journal incomplete or poisoned')
            finally:
                os.close(directory)
    return complete, uncertain


def status_run(project, run_id, execution_sha, *, now=None, source_state=None):
    """Read historical integrity; this never claims current authority/readiness."""
    identifier(run_id)
    sha256(execution_sha)
    base, files = dict(_summary(run_id), dispatch_attempted=False, remote_mutation_performed=False), None
    try:
        files = PrivateFiles(project)
        record = _execution(files, run_id, execution_sha, now, source_state)
        pending = pending_generation.inspect(project)
        if not _pending_matches(pending, record, execution_sha, files.identity):
            return base
        completed, uncertain = _network_state(files, run_id)
        status = 'uncertain' if uncertain else ('reserved' if pending['status'] == 'pending' else 'prepared')
        result = {**base, 'status': status, 'execution_integrity_verified': True,
                  'journal_integrity_verified': False,
                  'execution_sha256': execution_sha, 'pending_present': pending['status'] == 'pending',
                  'journal_receipt_count': completed, 'uncertain': uncertain}
        from fresh_network_ready_ops import AREA as READY
        try:
            receipt, _, _ = files.json(READY + '/' + run_id + '/receipt.json')
        except FileNotFoundError:
            pass
        else:
            exact(receipt, {'receipt', 'sha256'})
            from fresh_run_authority import inspect_history
            historical = inspect_history(project, run_id, execution_sha, receipt['sha256'],
                                         now=now, source_state=source_state)
            if not historical.get('historical_integrity'):
                return base
            result.update(status='network-history-verified', historical_integrity=True,
                          integrity_verified=True, journal_integrity_verified=True,
                          receipt_sha256=receipt['sha256'], next_stage='empty-control-plane')
        from fresh_bootstrap_ops import AREA as BOOTSTRAP, inspect_bootstrap
        bootstrap_files = PrivateFiles(project, max_bytes=128 * 1024 * 1024)
        try:
            try:
                bootstrap, _, _ = bootstrap_files.json(BOOTSTRAP + '/' + run_id + '/plan.json')
            except FileNotFoundError:
                pass
            else:
                exact(bootstrap, {'plan', 'sha256'})
                historical = inspect_bootstrap(project, run_id, bootstrap['sha256'],
                                                now=now, source_state=source_state)
                if not historical.get('historical_integrity'):
                    return base
                result.update(status='uncertain' if historical['uncertain'] else 'bootstrap-history-verified',
                              historical_integrity=True, integrity_verified=True,
                              journal_integrity_verified=True, bootstrap_sha256=bootstrap['sha256'],
                              completed_step_count=historical['journal_receipt_count'],
                              journal_receipt_count=completed + historical['journal_receipt_count'],
                              uncertain=historical['uncertain'], next_stage=historical['next_stage'])
            bootstrap_files.recheck()
        finally:
            bootstrap_files.close()
        files.recheck()
        if pending_generation.inspect(project) != pending:
            return base
        return result
    except ERRORS:
        return base
    finally:
        if files is not None:
            files.close()


def recover_run(project, run_id, execution_sha, input_file=None, input_sha=None, **options):
    """Default is local observation; an explicit recovery request can only observe."""
    if input_file is None and input_sha is None:
        return status_run(project, run_id, execution_sha, **options)
    if input_file is None or input_sha is None:
        return _summary(run_id)
    return next_step(project, run_id, execution_sha, input_file, input_sha, recovery=True, **options)

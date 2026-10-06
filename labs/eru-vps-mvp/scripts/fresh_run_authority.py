"""Explicit, one-operation renewal and separately labelled historical integrity.

No clock is replaced. Original records retain their own validation timestamps;
new observations and current authority always use the caller's current clock.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timedelta, timezone
from functools import wraps
import inspect
import json
from pathlib import Path

from fresh_execution import exact, timestamp
from fresh_execution_ops import AREA, PrivateFiles
from fresh_network_admission import validate
from fresh_rebuild import plan_digest
import pending_generation

_ACTIVE = ContextVar('fresh_run_current_step', default=None)
_PREPLAN = {'inspect_receipts', 'collect_replacement_facts', 'prepare_network_access'}
_EXCLUDED = {'project', 'adapter', 'observer', 'collector', 'reader', 'now', 'source_state'}


def current_time(now=None):
    value = now() if callable(now) else now
    value = value or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('run authority requires timezone')
    return value.astimezone(timezone.utc)


def active():
    return _ACTIVE.get()


def event_time(value, current):
    """Choose only an explicitly recorded event time under a scoped operation."""
    if active() is None:
        return current
    result = timestamp(value)
    if result > current:
        raise ValueError('historical event is future')
    return result


class _Step:
    def __init__(self, project, operation, target, now, source_state):
        self.files = PrivateFiles(project)
        self.operation, self.target = operation, target
        self.now, self.source_state = now, source_state
        self.entered = self.used = False
        self.historical = False
        self.pending = pending_generation.inspect(project)
        if self.pending['status'] != 'pending':
            self.files.close()
            raise ValueError('renewal requires pending run')

    def scope(self, record):
        for key in ('run_id', 'execution_sha256'):
            if record.get(key) != self.binding[key]:
                raise ValueError('renewal execution differs')
        if self.binding['plan_id'] is None:
            if self.operation not in _PREPLAN:
                raise ValueError('operation requires existing plan')
            return
        if record.get('id', record.get('plan_id')) != self.binding['plan_id']:
            raise ValueError('renewal plan differs')
        digest = record.get('plan_sha256', plan_digest(record))
        if digest != self.binding['plan_sha256']:
            raise ValueError('renewal plan hash differs')

    def operation_authority(self):
        modules = {'prepare_network_directory': 'fresh_network_directory',
                   'stage_network_files': 'fresh_network_staging',
                   'activate_network_firewall': 'fresh_network_firewall',
                   'prepare_network_manual_setup': 'fresh_network_ready'}
        if self.operation not in modules:
            return None
        import importlib
        contract = importlib.import_module(modules[self.operation])
        ref = {'path': self.target['authorization_file'], 'sha256': self.target['authorization_sha']}
        auth = self.files.binding(ref)
        expected = {key: self.binding[key] for key in
                    ('plan_id', 'plan_sha256', 'execution_sha256', 'pending_sha256')}
        if self.operation == 'prepare_network_manual_setup':
            expected['input'] = {'sha256': self.target['input_sha']}
        elif self.operation == 'activate_network_firewall':
            from fresh_network_staging_ops import AREA as STAGING_AREA
            path = STAGING_AREA + '/' + self.binding['run_id'] + '/host-' + str(self.target['host_index'])
            intent, _, _ = self.files.json(path + '/intent.json')
            receipt, _, _ = self.files.json(path + '/receipt.json')
            exact(intent, {'intent', 'sha256'})
            exact(receipt, {'receipt', 'sha256'})
            if (intent['sha256'] != plan_digest(intent['intent'])
                    or receipt['sha256'] != plan_digest(receipt['receipt'])):
                raise ValueError('renewed firewall staging digest differs')
            expected = contract.action(self.plan, self.binding['plan_sha256'], self.pending,
                self.target['host_index'], intent['sha256'], receipt['sha256'])
        return contract.authorization, auth, expected

    def check(self):
        if pending_generation.inspect(self.files.project) != self.pending:
            raise ValueError('renewal pending changed')
        self.files.recheck()
        if not self.historical:
            from fresh_run_lock import FreshRunLock
            if not isinstance(self.lock, FreshRunLock):
                raise ValueError('current renewal requires owned run lock')
            self.lock.check_pending()
            if self.lock.project.absolute() != self.files.project or self.lock._expected != json.dumps(
                    self.pending, sort_keys=True, separators=(',', ':'), allow_nan=False):
                raise ValueError('renewal lock reservation differs')
        if self.historical:
            return
        self.files.binding(self.ref)
        if self.document['admission_request'] is None:
            return self.check_direct()
        request = self.files.binding(self.document['admission_request'])
        auth = self.files.binding(request['owner_authorization'])
        fence = self.files.binding(request['writer_fence'])
        isolation = self.files.binding(fence['isolation'])
        self.files.binding(fence['prior_fence'])
        for host in isolation['old_hosts']:
            raw, path, digest = self.files.read(host['proof']['path'])
            if not raw or {'path': path, 'sha256': digest} != host['proof']:
                raise ValueError('renewal isolation proof changed')
        operation_auth = self.operation_authority()
        self.files.recheck()
        current = current_time(self.now)
        start, end = timestamp(self.document['issued_at']), timestamp(self.document['expires_at'])
        if not start <= current < end or not timedelta(0) < end-start <= timedelta(minutes=15):
            raise ValueError('step renewal expired or future')
        if operation_auth is not None:
            validator, operation_document, expected = operation_auth
            validator(operation_document, expected, current)
        validate(request, auth, fence, isolation, execution=self.execution,
                 execution_sha=self.binding['execution_sha256'], pending_sha=self.pending['sha256'],
                 replacement=self.replacement, baseline=self.baseline, now=current)
        if isolation['old_hosts'] != self.original_isolation['old_hosts']:
            raise ValueError('renewal changed original old-host isolation proofs')

    def check_direct(self):
        from fresh_network_admission import HOST_FIELDS
        d = self.document
        fence = self.files.binding(d['writer_fence'])
        exact(fence, {'schema_version', 'kind', 'binding', 'observed_at', 'active',
                      'controller_count', 'in_flight_writers', 'prior_fence', 'isolation'})
        isolation = self.files.binding(fence['isolation'])
        exact(isolation, {'schema_version', 'kind', 'binding', 'observed_at',
                          'other_controllers_stopped', 'ci_writers_stopped', 'app_writers_stopped', 'old_hosts'})
        for value, kind in ((fence, 'fresh-run-step-fence'), (isolation, 'fresh-run-step-isolation')):
            if (type(value['schema_version']) is not int or value['schema_version'] != 1
                    or value['kind'] != kind or value['binding'] != self.binding):
                raise ValueError('direct renewal evidence binding differs')
        if (fence['active'] is not True or type(fence['controller_count']) is not int
                or fence['controller_count'] != 1 or type(fence['in_flight_writers']) is not int
                or fence['in_flight_writers'] != 0 or fence['prior_fence'] != self.execution['evidence']['writer_fence']
                or any(isolation[k] is not True for k in ('other_controllers_stopped', 'ci_writers_stopped', 'app_writers_stopped'))):
            raise ValueError('direct renewal fence is not exclusive')
        self.files.binding(fence['prior_fence'])
        if type(isolation['old_hosts']) is not list or len(isolation['old_hosts']) != 4:
            raise ValueError('direct renewal requires all old hosts')
        paths, digests = set(), set()
        for host, original in zip(isolation['old_hosts'], self.baseline['hosts']):
            exact(host, HOST_FIELDS | {'isolated', 'method', 'proof'})
            if ({k: host[k] for k in HOST_FIELDS} != original or host['isolated'] is not True
                    or host['method'] not in ('network', 'provider-console')):
                raise ValueError('direct renewal old incarnation differs')
            ref = host['proof']
            exact(ref, {'path', 'sha256'})
            raw, path, digest = self.files.read(ref['path'])
            if not raw or ref != {'path': path, 'sha256': digest} or path in paths or digest in digests:
                raise ValueError('direct renewal proof differs or reused')
            paths.add(path)
            digests.add(digest)
        if self.original_isolation is not None and isolation['old_hosts'] != self.original_isolation['old_hosts']:
            raise ValueError('direct renewal changed original isolation proofs')
        operation_auth = self.operation_authority()
        self.files.recheck()
        current = current_time(self.now)
        if operation_auth is not None:
            validator, operation_document, expected = operation_auth
            validator(operation_document, expected, current)
        issued, expires = timestamp(d['issued_at']), timestamp(d['expires_at'])
        observed, isolated = timestamp(fence['observed_at']), timestamp(isolation['observed_at'])
        if (not issued <= current < expires or not timedelta(0) < expires-issued <= timedelta(minutes=15)
                or not timestamp(self.execution['created_at']) <= isolated <= observed <= current
                or current-isolated > timedelta(minutes=15)):
            raise ValueError('direct renewal time invalid')

    def historical_authorizations(self, intent):
        refs = [intent['authorization']] + getattr(self, 'manual_refs', [])
        if not self.historical:
            refs += self.document['manual_authorizations']
        return [self.files.binding(ref) for ref in refs]


@contextmanager
def current_step(project, renewal_ref, *, operation, target, lock, now=None, source_state=None):
    """Consume one exact owner-reviewed operation, never a campaign capability."""
    if active() is not None:
        raise ValueError('nested run renewal forbidden')
    step = _Step(project, operation, target, now, source_state)
    step.lock = lock
    token = None
    try:
        step.ref = renewal_ref
        d = step.document = step.files.binding(renewal_ref)
        exact(d, {'schema_version', 'kind', 'authority', 'approved', 'owner_confirmed',
                  'binding', 'target', 'admission_request', 'issued_at', 'expires_at',
                  'manual_authorizations', 'writer_fence'})
        if (type(d['schema_version']) is not int or d['schema_version'] != 1
                or d['kind'] != 'fresh-run-step-renewal' or d['authority'] != 'owner'
                or d['approved'] is not True or d['owner_confirmed'] is not True
                or type(d['manual_authorizations']) is not list):
            raise ValueError('invalid step owner authority')
        b = step.binding = d['binding']
        exact(b, {'run_id', 'execution_sha256', 'pending_sha256', 'plan_id', 'plan_sha256',
                  'operation', 'target_sha256'})
        if (b['operation'] != operation or plan_digest(d['target']) != plan_digest(target)
                or b['target_sha256'] != plan_digest(target) or b['pending_sha256'] != step.pending['sha256']):
            raise ValueError('renewal operation target differs')
        if (d['admission_request'] is None) == (d['writer_fence'] is None):
            raise ValueError('renewal requires exactly one current fence route')
        if (b['plan_id'] is None) != (b['plan_sha256'] is None):
            raise ValueError('partial renewal plan binding')
        if b['plan_id'] is None and operation not in _PREPLAN:
            raise ValueError('operation requires existing plan')
        env, _, _ = step.files.json(AREA + '/' + b['run_id'] + '/execution.json')
        step.execution = env['execution']
        from fresh_reimage_receipt_ops import _pending_matches
        if (env['sha256'] != b['execution_sha256'] or plan_digest(step.execution) != b['execution_sha256']
                or not _pending_matches(step.pending, step.execution, b['execution_sha256'], step.files.identity)):
            raise ValueError('renewal execution reservation differs')
        step.baseline = step.files.binding(step.execution['evidence']['host_baseline'])
        step.original_isolation = None
        if b['plan_id'] is not None:
            from fresh_network_access_ops import AREA as PLAN_AREA
            envelope, _, _ = step.files.json(PLAN_AREA + '/' + b['plan_id'] + '/plan.json')
            if envelope['sha256'] != b['plan_sha256'] or plan_digest(envelope['plan']) != b['plan_sha256']:
                raise ValueError('renewal plan changed')
            plan = step.plan = envelope['plan']
            step.scope(plan)
            original_input = step.files.binding(plan['input'])
            original = step.files.binding(original_input['admission_request'])
            original_fence = step.files.binding(original['writer_fence'])
            step.original_isolation = step.files.binding(original_fence['isolation'])
        if d['admission_request'] is not None:
            if b['plan_id'] is None:
                raise ValueError('preplan renewal requires direct fence')
            request = step.files.binding(d['admission_request'])
            if request['replacement_observation'] != original['replacement_observation']:
                raise ValueError('renewal replacement differs')
            replacement = step.files.binding(request['replacement_observation'])
            if replacement['sha256'] != plan_digest(replacement['observation']):
                raise ValueError('renewal replacement digest differs')
            step.replacement = replacement['observation']
        for ref in d['manual_authorizations']:
            step.files.binding(ref)
        step.check()
        token = _ACTIVE.set(step)
        yield step
        step.check()
        if not step.used:
            raise ValueError('renewal did not execute its exact operation')
    finally:
        if token is not None:
            _ACTIVE.reset(token)
        step.files.close()


def operation(function):
    """Check canonical actual public arguments before any operation work."""
    signature = inspect.signature(function)
    @wraps(function)
    def wrapped(*args, **kwargs):
        step = active()
        if step is None:
            return function(*args, **kwargs)
        if step.entered and function.__name__ == 'inspect_receipts' and step.operation != 'inspect_receipts':
            return function(*args, **kwargs)
        bound = signature.bind(*args, **kwargs)
        bound.apply_defaults()
        actual = {k: str(v) if isinstance(v, Path) else v for k, v in bound.arguments.items() if k not in _EXCLUDED}
        if (step.used or step.entered or function.__name__ != step.operation or plan_digest(actual) != plan_digest(step.target)
                or Path(bound.arguments['project']).absolute() != step.files.project):
            raise ValueError('renewal cannot authorize a different or repeated operation')
        step.check()
        step.entered = step.used = True
        try:
            result = function(*args, **kwargs)
            step.check()
            return result
        finally:
            step.entered = False
    return wrapped


def check_current():
    if active() is not None:
        active().check()


def validate_slot(contract, intent, receipt, digest, expected, ref, predecessor, identity, auth, current):
    created = event_time(intent['created_at'], current)
    step = active()
    if (step is not None and not step.historical and step.target.get('host_index') == expected.get('host_index')
            and step.operation in {'prepare_network_directory', 'stage_network_files', 'activate_network_firewall'}
            and step.operation == {'fresh-network-directory-preparation': 'prepare_network_directory',
                                   'fresh-network-file-staging': 'stage_network_files',
                                   'fresh-network-firewall-activation': 'activate_network_firewall'}.get(expected['operation'])):
        contract.authorization(auth, expected, current)
    contract.authorization(auth, expected, created)
    contract.validate_intent(intent, expected, ref, predecessor, identity, created)
    if receipt is not None:
        completed = event_time(receipt['created_at'], current)
        if completed < timestamp(intent['created_at']):
            raise ValueError('receipt precedes intent')
        # A recovered receipt timestamps a later read-only observation, not a
        # second writer completion. Its new observation is current-gated by
        # reconciliation; original writer authority still binds the intent.
        if receipt['recovered'] is not True:
            contract.authorization(auth, expected, completed)
        contract.validate_receipt(receipt, intent, digest, completed)


def validate_manual(value, intent, digest, current):
    from fresh_network_ready import authorization, validate_manual_receipt
    step = active()
    if step is None:
        return validate_manual_receipt(value, intent, digest, current)
    # Shape/action/chronology are checked with the same validator, each actual
    # host interval independently. No idle time between console actions is authority.
    authorizations = step.historical_authorizations(intent)
    for row in value['hosts']:
        start, end = timestamp(row['started_at']), timestamp(row['completed_at'])
        if not timestamp(intent['created_at']) <= start <= end <= current:
            raise ValueError('manual action chronology invalid')
        intervals = []
        for auth in authorizations:
            a, b = timestamp(auth['authorized_at']), timestamp(auth['expires_at'])
            if a > current:
                raise ValueError('manual authorization is future')
            authorization(auth, intent, a)
            intervals.append((a, b))
        cursor = start
        for a, b in sorted(intervals):
            if a <= cursor < b:
                cursor = b
        if cursor <= end:
            raise ValueError('manual action lacks uninterrupted short-lived authority')
    exact(value, {'schema_version', 'operation', 'intent_sha256', 'owner_confirmed', 'hosts'})
    if (type(value['schema_version']) is not int or value['schema_version'] != 1
            or value['operation'] != 'fresh-network-manual-setup-receipt' or value['intent_sha256'] != digest
            or value['owner_confirmed'] is not True or type(value['hosts']) is not list or len(value['hosts']) != 4):
        raise ValueError('manual setup requires four bound owner receipts')
    for row, action in zip(value['hosts'], intent['actions']):
        exact(row, {'action', 'started_at', 'completed_at', 'owner_confirmed'})
        if row['owner_confirmed'] is not True or plan_digest(row['action']) != plan_digest(action):
            raise ValueError('manual setup action receipt differs from intent')

    return value


def inspect_history(project, run_id, execution_sha, expected_receipt_sha, *, now=None, source_state=None):
    """Read-only full accepted-chain integrity, never current network eligibility."""
    from fresh_network_ready_ops import MANUAL_AREA, inspect_network_ready
    if active() is not None:
        raise ValueError('nested historical inspection forbidden')
    target = {'run_id': run_id, 'expected_receipt_sha': expected_receipt_sha}
    step = _Step(project, 'inspect_network_ready', target, now, source_state)
    step.historical = True
    token = None
    try:
        env, _, _ = step.files.json(MANUAL_AREA + '/' + run_id + '/intent.json')
        record = env['intent']
        if (env['sha256'] != plan_digest(record) or record['run_id'] != run_id
                or record['execution_sha256'] != execution_sha or record['pending_sha256'] != step.pending['sha256']):
            raise ValueError('historical run binding differs')
        step.binding = {'run_id': run_id, 'execution_sha256': execution_sha,
                        'plan_id': record['plan_id'], 'plan_sha256': record['plan_sha256']}
        token = _ACTIVE.set(step)
        result = inspect_network_ready(project, run_id, expected_receipt_sha, now=now, source_state=source_state)
        step.check()
        return {**result, 'status': 'historically-valid' if result['status'] == 'network-ready' else 'blocked',
                'stage_accepted': False, 'current_network_ready': False,
                'historical_integrity': result['status'] == 'network-ready'}
    finally:
        if token is not None:
            _ACTIVE.reset(token)
        step.files.close()

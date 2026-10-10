"""Complete manual-console network stage with immutable current probe acceptance.

No console mutation is automated. All remote activity is fixed readonly collection.
"""
import copy
import os
import fresh_run_authority as authority

from fresh_execution import exact, identifier, sha256, timestamp
import fresh_network_access_ops as access
import fresh_network_directory_ops as directory_ops
import fresh_network_firewall_ops as firewall_ops
from fresh_network_staging import fresh
from fresh_network_ready import OPERATION, authorization, manual_actions, validate_setup
validate_manual_receipt = authority.validate_manual
from fresh_network_admission_ops import _pending
from fresh_observation_ops import _publish
from fresh_rebuild import plan_digest
from fresh_replacement_ops import ERRORS

MANUAL_AREA = 'private/operations/fresh-rebuild/network-manual-intents'
MANUAL_RECEIPT_AREA = 'private/operations/fresh-rebuild/network-manual-receipts'
AREA = 'private/operations/fresh-rebuild/network-ready'


def _summary(run):
    return {'status': 'blocked', 'id': run, 'stage': 'network-and-access-ready',
            'stage_accepted': False, 'generation_changed': False,
            'remote_mutation_performed': False, 'external_fence_verified': False}


def _poison(fd):
    try:
        mark = os.open('.publication-failed', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                       0o600, dir_fd=fd)
        os.close(mark)
        os.fsync(fd)
    except OSError:
        pass


class _Session:
    def __init__(self, project, now, source):
        self.firewall = firewall_ops._Session(project, now, source)
        self.directory = None
        self.files = self.firewall.files
        self.publications = self.firewall.publications
        self.pending = self.firewall.pending
        self.now, self.source, self.project = now, source, project
        self.plan = self.intent = self.manual = None

    def close(self):
        if self.directory is not None:
            self.directory.close()
        self.firewall.close()

    def current(self, plan_id, digest, *, predecessors=False):
        self.plan = self.firewall.plan(plan_id, digest)
        run = self.plan['run_id']
        if not predecessors:
            return self.plan
        last, receipt = self.firewall.validate_slot(run, 3)
        if receipt is None:
            raise ValueError('network readiness requires four firewall receipts')
        for _, r, a, _, _, _ in self.firewall.loaded:
            if r is None or a['plan_id'] != plan_id or a['plan_sha256'] != digest:
                raise ValueError('network firewall predecessor belongs to another plan')
        if self.directory is not None:
            self.directory.close()
        self.directory = directory_ops._Session(self.project, self.now, self.source)
        if self.directory.files.identity != self.files.identity or self.directory.pending != self.pending:
            raise ValueError('network predecessor authority differs')
        dlast, dr = self.directory.validate_slot(run, 3)
        if dr is None:
            raise ValueError('network readiness requires four directory receipts')
        for _, r, a, _, _, _ in self.directory.loaded:
            if r is None or a['plan_id'] != plan_id or a['plan_sha256'] != digest:
                raise ValueError('network directory predecessor belongs to another plan')
        self.last_firewall, self.last_directory = last, dlast
        refs = {}
        for name, area in [('directory', directory_ops.AREA),
                           ('staging', firewall_ops.staging.AREA), ('firewall', firewall_ops.AREA)]:
            rows = []
            for index in range(4):
                for filename in ('intent.json', 'receipt.json'):
                    path = area + '/' + run + '/host-' + str(index) + '/' + filename
                    _, relative, digest = self.files.read(path)
                    rows.append({'path': relative, 'sha256': digest})
            refs[name] = rows
        self.predecessors = refs
        return self.plan

    def load(self, area, run, name, field):
        path = area + '/' + run + '/' + name
        self.publications.pin(path, [name])
        value, _, _ = self.files.json(path)
        exact(value, {field, 'sha256'})
        if sha256(value['sha256']) != plan_digest(value[field]):
            raise ValueError('network journal digest mismatch')
        return value

    def manual_intent(self, run, wanted=None):
        envelope = self.load(MANUAL_AREA, run, 'intent.json', 'intent')
        record = envelope['intent']
        exact(record, {'schema_version', 'operation', 'run_id', 'plan_id', 'plan_sha256',
                       'execution_sha256', 'pending_sha256', 'authorization', 'input',
                       'setup', 'actions', 'private_identity', 'created_at'})
        if wanted is not None and envelope['sha256'] != wanted:
            raise ValueError('manual intent digest differs')
        plan = self.current(record['plan_id'], record['plan_sha256'])
        setup = self.files.binding(record['input'])
        auth = self.files.binding(record['authorization'])
        validate_setup(setup, plan['render'])
        rebuilt = self.intent_record(plan, record['plan_sha256'], record['authorization'],
                                      record['input'], setup, record['created_at'])
        if plan_digest(rebuilt) != plan_digest(record) or record['run_id'] != run:
            raise ValueError('manual intent not current derivation')
        authorization(auth, record, timestamp(record['created_at']))
        self.intent, self.auth = envelope, auth
        return envelope

    def intent_record(self, plan, digest, auth, ref, setup, created):
        return {'schema_version': 1, 'operation': OPERATION + '-intent',
                'run_id': plan['run_id'], 'plan_id': plan['id'], 'plan_sha256': digest,
                'execution_sha256': plan['execution_sha256'], 'pending_sha256': self.pending['sha256'],
                'authorization': auth, 'input': ref, 'setup': copy.deepcopy(setup),
                'actions': manual_actions(setup, plan['render']),
                'private_identity': self.files.identity, 'created_at': created}

    def manual_receipt(self, run, wanted=None):
        envelope = self.load(MANUAL_RECEIPT_AREA, run, 'receipt.json', 'receipt')
        record = envelope['receipt']
        extra = {'manual_authorizations'} if record.get('schema_version') == 2 else set()
        exact(record, {'schema_version', 'operation', 'intent_sha256', 'input',
                       'owner_receipt', 'created_at', 'private_identity'} | extra)
        if extra:
            if authority.active() is None or type(record['manual_authorizations']) is not list:
                raise ValueError('renewed manual receipt requires explicit run validation')
            for ref in record['manual_authorizations']:
                self.files.binding(ref)
            authority.active().manual_refs = record['manual_authorizations']
        if (wanted is not None and envelope['sha256'] != wanted):
            raise ValueError('manual receipt digest differs')
        intent = self.manual_intent(run, record['intent_sha256'])
        owner = self.files.binding(record['input'])
        if (type(record['schema_version']) is not int or record['schema_version'] not in (1, 2)
                or record['operation'] != OPERATION + '-record'
                or owner != record['owner_receipt'] or record['private_identity'] != self.files.identity):
            raise ValueError('manual receipt publication binding invalid')
        validate_manual_receipt(owner, intent['intent'], intent['sha256'],
                                authority.event_time(record['created_at'], access._time(self.now)))
        created = fresh(record['created_at'], authority.event_time(record['created_at'], access._time(self.now)))
        if any(timestamp(row['completed_at']) > created for row in owner['hosts']):
            raise ValueError('manual receipt recording precedes console completion')
        self.manual = envelope
        return envelope

    def final(self, evidence=None, recorded_at=None):
        if self.directory is not None:
            self.directory.final(self.last_directory)
            self.firewall.final(self.last_firewall)
        self.files.recheck()
        self.publications.check()
        if self.directory is not None:
            self.directory.files.recheck()
            self.directory.publications.check()
        _pending(self.files, self.pending, self.firewall.plans[-1][1][4], self.plan['execution_sha256'])
        # No source/filesystem work may follow the final clock validation.
        current = access._time(self.now)
        for session in (self.directory, self.firewall, self.firewall.staging):
            if session is None:
                continue
            for plan, values in session.plans:
                access._fresh(plan, values, self.pending, current)
            for env, receipt, action, ref, predecessor, auth in session.loaded:
                if receipt is None:
                    raise ValueError('network predecessor incomplete')
                if session is self.directory:
                    contract = directory_ops
                elif session is self.firewall:
                    contract = firewall_ops
                else:
                    contract = firewall_ops.staging
                authority.validate_slot(contract.contract, env['intent'], receipt['receipt'], env['sha256'],
                                        action, ref, predecessor, self.files.identity, auth, current)
        if self.intent is not None:
            intent_time = authority.event_time(self.intent['intent']['created_at'], current)
            fresh(self.intent['intent']['created_at'], intent_time)
            authorization(self.auth, self.intent['intent'], intent_time)
        if self.manual is not None:
            manual_time = authority.event_time(self.manual['receipt']['created_at'], current)
            fresh(self.manual['receipt']['created_at'], manual_time)
            validate_manual_receipt(self.manual['receipt']['owner_receipt'],
                                    self.intent['intent'], self.intent['sha256'], manual_time)
        authority.check_current()
        current = access._time(self.now)
        if evidence is not None:
            from fresh_network_probe import validate_network_evidence
            probe_time = current
            if authority.active() is not None and authority.active().historical and recorded_at is not None:
                probe_time = authority.event_time(recorded_at, current)
            validate_network_evidence(evidence, self.plan['render'], probe_time,
                                      setup=self.intent['intent']['setup'])
            if any(timestamp(row['completed_at']) > timestamp(evidence['observed_at'])
                   for row in self.manual['receipt']['owner_receipt']['hosts']):
                raise ValueError('network probes precede console setup')

    def publish(self, area, run, name, envelope):
        parent = self.files.directory(self.files.parts(area), create=True)
        fd = None
        try:
            os.mkdir(run, 0o700, dir_fd=parent)
            created = os.stat(run, dir_fd=parent, follow_symlinks=False)
            fd = self.files.directory(self.files.parts(area) + (run,))
            opened = os.fstat(fd)
            if (created.st_dev, created.st_ino) != (opened.st_dev, opened.st_ino) or os.listdir(fd):
                raise ValueError('network publication claim changed')
            os.fsync(parent)
            path = area + '/' + run + '/' + name
            self.publications.pin(path, [])
            raw = _publish(self.files, fd, name, envelope)
            parts = self.files.parts(path)[:-1]
            pinned, _ = self.publications.directories[parts]
            self.publications.directories[parts] = (pinned, [name])
            stored = self.files.binding({'path': path, 'sha256': raw})
            if stored != envelope:
                raise ValueError('network published bytes changed')
            self.final(envelope['receipt'].get('evidence') if 'receipt' in envelope else None)
        except BaseException:
            if fd is not None:
                _poison(fd)
            raise
        finally:
            os.close(parent)
            if fd is not None:
                os.close(fd)


@authority.operation
def prepare_network_manual_setup(project, plan_id, plan_sha, authorization_file, authorization_sha,
                                 input_file, input_sha, *, now=None, source_state=None):
    identifier(plan_id)
    sha256(plan_sha)
    sha256(authorization_sha)
    sha256(input_sha)
    base, session = _summary(None), None
    try:
        session = _Session(project, now, source_state)
        plan = session.current(plan_id, plan_sha)
        run = base['id'] = plan['run_id']
        ref = {'path': str(input_file), 'sha256': input_sha}
        authref = {'path': str(authorization_file), 'sha256': authorization_sha}
        setup, auth = session.files.binding(ref), session.files.binding(authref)
        record = session.intent_record(plan, plan_sha, authref, ref, setup, access._time(now).isoformat())
        envelope = {'intent': record, 'sha256': plan_digest(record)}
        session.intent, session.auth = envelope, auth
        session.final()
        # Existing intent is immutable; prepare is idempotent only for exact inputs.
        try:
            existing = session.load(MANUAL_AREA, run, 'intent.json', 'intent')
        except FileNotFoundError:
            session.publish(MANUAL_AREA, run, 'intent.json', envelope)
        else:
            if any(existing['intent'][k] != record[k] for k in record if k != 'created_at'):
                raise ValueError('manual intent already belongs to another input')
            envelope = session.manual_intent(run, existing['sha256'])
            session.final()
        return {**base, 'status': 'manual-setup-prepared', 'intent_sha256': envelope['sha256'], 'host_count': 4}
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()


@authority.operation
def record_network_manual_setup(project, run_id, expected_intent_sha, receipt_file, receipt_sha,
                                *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_intent_sha)
    sha256(receipt_sha)
    base, session = _summary(run_id), None
    try:
        session = _Session(project, now, source_state)
        intent = session.manual_intent(run_id, expected_intent_sha)
        ref = {'path': str(receipt_file), 'sha256': receipt_sha}
        owner = session.files.binding(ref)
        validate_manual_receipt(owner, intent['intent'], intent['sha256'], access._time(now))
        record = {'schema_version': 1, 'operation': OPERATION + '-record',
                  'intent_sha256': intent['sha256'], 'input': ref, 'owner_receipt': owner,
                  'created_at': access._time(now).isoformat(), 'private_identity': session.files.identity}
        if authority.active() is not None:
            record['schema_version'] = 2
            record['manual_authorizations'] = authority.active().document['manual_authorizations']
        envelope = {'receipt': record, 'sha256': plan_digest(record)}
        session.manual = envelope
        session.final()
        try:
            existing = session.load(MANUAL_RECEIPT_AREA, run_id, 'receipt.json', 'receipt')
        except FileNotFoundError:
            session.publish(MANUAL_RECEIPT_AREA, run_id, 'receipt.json', envelope)
        else:
            if any(existing['receipt'][k] != record[k] for k in record if k != 'created_at'):
                raise ValueError('manual receipt already belongs to another input')
            envelope = session.manual_receipt(run_id, existing['sha256'])
            session.final()
        return {**base, 'status': 'manual-setup-recorded', 'manual_receipt_sha256': envelope['sha256'], 'host_count': 4}
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()


def _accepted(session, run, expected=None):
    envelope = session.load(AREA, run, 'receipt.json', 'receipt')
    record = envelope['receipt']
    exact(record, {'schema_version', 'operation', 'run_id', 'manual_receipt_sha256',
                   'intent_sha256', 'plan_sha256', 'pending_sha256', 'private_identity',
                   'evidence', 'predecessors', 'created_at', 'next_stage'})
    if (type(record['schema_version']) is not int or record['schema_version'] != 1
            or record['operation'] != 'fresh-network-ready-receipt' or record['run_id'] != run
            or record['intent_sha256'] != session.intent['sha256']
            or record['manual_receipt_sha256'] != session.manual['sha256']
            or record['plan_sha256'] != session.intent['intent']['plan_sha256']
            or record['pending_sha256'] != session.pending['sha256']
            or record['private_identity'] != session.files.identity
            or plan_digest(record['predecessors']) != plan_digest(session.predecessors)
            or record['next_stage'] != 'empty-control-plane'
            or expected is not None and envelope['sha256'] != expected):
        raise ValueError('network acceptance publication binding invalid')
    created = fresh(record['created_at'], authority.event_time(record['created_at'], access._time(session.now)))
    if (timestamp(session.manual['receipt']['created_at']) > created
            or any(timestamp(receipt['receipt']['created_at']) > timestamp(record['evidence']['observed_at'])
                   for s in (session.directory, session.firewall, session.firewall.staging)
                   for _, receipt, _, _, _, _ in s.loaded)):
        raise ValueError('network acceptance precedes required completion')
    if timestamp(record['evidence']['observed_at']) > created:
        raise ValueError('network acceptance precedes probes')
    session.final(record['evidence'], recorded_at=record['created_at'])
    return envelope


def _success(base, envelope):
    return {**base, 'status': 'network-ready', 'receipt_sha256': envelope['sha256'],
            'host_count': 4, 'stage_accepted': True, 'next_stage': 'empty-control-plane'}


@authority.operation
def accept_network_ready(project, run_id, expected_manual_receipt_sha, collector=None,
                         *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_manual_receipt_sha)
    base, session = _summary(run_id), None
    try:
        session = _Session(project, now, source_state)
        session.manual_receipt(run_id, expected_manual_receipt_sha)
        session.current(session.intent['intent']['plan_id'], session.intent['intent']['plan_sha256'],
                        predecessors=True)
        session.final()
        try:
            accepted = _accepted(session, run_id)
        except FileNotFoundError:
            accepted = None
        if accepted is not None:
            return _success(base, accepted)
        if collector is None:
            from fresh_network_probe import collect_network_evidence
            collector = collect_network_evidence
        render = session.plan['render']
        by_ip = dict(line.split(' ', 1) for line in render['controller_known_hosts'].splitlines())
        keys = {host['alias']: by_ip[host['ip']] for host in render['hosts']}
        try:
            evidence = copy.deepcopy(collector(copy.deepcopy(render), keys,
                setup=copy.deepcopy(session.intent['intent']['setup']), now=access._time(now)))
        except Exception:
            return base
        session.final(evidence)
        record = {'schema_version': 1, 'operation': 'fresh-network-ready-receipt', 'run_id': run_id,
                  'manual_receipt_sha256': session.manual['sha256'], 'intent_sha256': session.intent['sha256'],
                  'plan_sha256': session.intent['intent']['plan_sha256'], 'pending_sha256': session.pending['sha256'],
                  'private_identity': session.files.identity, 'evidence': evidence, 'predecessors': session.predecessors,
                  'created_at': access._time(now).isoformat(), 'next_stage': 'empty-control-plane'}
        envelope = {'receipt': record, 'sha256': plan_digest(record)}
        session.publish(AREA, run_id, 'receipt.json', envelope)
        return _success(base, _accepted(session, run_id, envelope['sha256']))
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()


@authority.operation
def inspect_network_ready(project, run_id, expected_receipt_sha, *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_receipt_sha)
    base, session = _summary(run_id), None
    try:
        session = _Session(project, now, source_state)
        session.manual_receipt(run_id)
        session.current(session.intent['intent']['plan_id'], session.intent['intent']['plan_sha256'],
                        predecessors=True)
        return _success(base, _accepted(session, run_id, expected_receipt_sha))
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()

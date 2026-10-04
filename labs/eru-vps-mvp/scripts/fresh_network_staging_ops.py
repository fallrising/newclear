"""Durable single-dispatch staging coordinator; no production transport or activation."""
import copy
from datetime import datetime, timezone
import os

from fresh_execution import exact, identifier, sha256
from fresh_execution_ops import PrivateFiles
import fresh_network_access_ops as access
from fresh_network_admission_ops import _pending, _Publications
from fresh_network_staging import (OPERATION, action, authorization, host_index as validate_host_index,
    intent_record, observation, validate_intent, validate_receipt)
from fresh_observation_ops import _publish
from fresh_rebuild import plan_digest
from fresh_replacement_ops import ERRORS
import pending_generation

AREA = 'private/operations/fresh-rebuild/network-staging'


class _ReceiptCollision(ValueError):
    """Another publisher owns the slot; never poison another writer."""


def _time(now):
    value = now or datetime.now(timezone.utc)
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError('staging time requires timezone')
    return value.astimezone(timezone.utc)


def _summary(run, index):
    return {'status': 'blocked', 'id': run, 'host_index': index, 'dispatch_attempted': False,
            'stage_accepted': False, 'generation_changed': False, 'external_fence_verified': False}


def _path(run, index):
    return AREA + '/' + run + '/host-' + str(index)


def _poison(directory):
    if directory is not None:
        try:
            fd = os.open('.staging-failed', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
            os.close(fd)
            os.fsync(directory)
        except OSError:
            pass


class _Session:
    def __init__(self, project, now, source_state):
        self.files = PrivateFiles(project)
        self.publications = _Publications(self.files)
        self.now, self.source_state = now, source_state
        self.loaded, self.plans = [], []
        self.receipt_owned = False
        self.pending = pending_generation.inspect(project)
        if self.pending['status'] != 'pending':
            self.close()
            raise ValueError('staging requires pending execution')

    def close(self):
        self.publications.close()
        self.files.close()

    def plan(self, plan_id, digest):
        path = access.AREA + '/' + identifier(plan_id) + '/plan.json'
        self.publications.pin(path, ['plan.json'])
        envelope, _, _ = self.files.json(path)
        exact(envelope, {'plan', 'sha256'})
        record = envelope['plan']
        if envelope['sha256'] != digest or plan_digest(record) != digest:
            raise ValueError('staging plan digest mismatch')
        run = identifier(record['run_id'])
        execution = sha256(record['execution_sha256'])
        self.files.binding(record['input'])
        document, ref, rendered, values = access._context(self.files, self.publications,
            run, execution, record['input']['path'], record['input']['sha256'],
            self.pending, _time(self.now), self.source_state)
        rebuilt = access._record(self.files, document, ref, rendered, plan_id, run, execution,
                                  record['created_at'])
        if plan_digest(rebuilt) != digest:
            raise ValueError('staging plan not current derivation')
        self.files.recheck()
        _pending(self.files, self.pending, values[4], execution)
        self.publications.check()
        access._fresh(record, values, self.pending, _time(self.now))
        self.plans.append((record, values))
        return record

    def context(self, plan_id, digest, authorization_ref, index):
        plan = self.plan(plan_id, digest)
        expected = action(plan, digest, self.pending, index)
        auth = self.files.binding(authorization_ref)
        authorization(auth, expected, _time(self.now))
        return expected, auth

    def check_run(self, run, allow_missing=False):
        path = AREA + '/' + run + '/journal-entry'
        try:
            directory = self.files.directory(self.files.parts(path)[:-1])
        except FileNotFoundError:
            if allow_missing:
                return
            raise
        try:
            names = sorted(os.listdir(directory))
            if names != ['host-' + str(i) for i in range(len(names))] or len(names) > 4:
                raise ValueError('staging run has unknown entries or host holes')
        finally:
            os.close(directory)
        self.publications.pin(path, names)

    def slot(self, run, index):
        self.check_run(run)
        path = _path(run, index) + '/intent.json'
        directory = self.files.directory(self.files.parts(path)[:-1])
        try:
            names = sorted(os.listdir(directory))
            if names not in (['intent.json'], ['intent.json', 'receipt.json']):
                raise ValueError('staging journal is incomplete or poisoned')
        finally:
            os.close(directory)
        self.publications.pin(path, names)
        envelope, _, _ = self.files.json(path)
        exact(envelope, {'intent', 'sha256'})
        if sha256(envelope['sha256']) != plan_digest(envelope['intent']):
            raise ValueError('staging intent digest mismatch')
        receipt = None
        if 'receipt.json' in names:
            receipt, _, _ = self.files.json(_path(run, index) + '/receipt.json')
            exact(receipt, {'receipt', 'sha256'})
            if sha256(receipt['sha256']) != plan_digest(receipt['receipt']):
                raise ValueError('staging receipt digest mismatch')
        return envelope, receipt

    def validate_slot(self, run, index, wanted=None, binding=None):
        envelope, receipt = self.slot(run, index)
        intent, digest = envelope['intent'], envelope['sha256']
        if wanted is not None and wanted != digest:
            raise ValueError('staging expected intent mismatch')
        a, ref = intent['action'], intent['authorization']
        if binding is not None and binding != (a['plan_id'], a['plan_sha256'], ref):
            raise ValueError('staging slot belongs to another plan or authorization')
        expected, auth = self.context(a['plan_id'], a['plan_sha256'], ref, index)
        if expected['run_id'] != run:
            raise ValueError('staging execution slot mismatch')
        predecessor = self.predecessor(expected)
        validate_intent(intent, expected, ref, predecessor, self.files.identity, _time(self.now))
        authorization(auth, expected, access.timestamp(intent['created_at']))
        if receipt is not None:
            validate_receipt(receipt['receipt'], intent, digest, _time(self.now))
        self.loaded.append((envelope, receipt, expected, ref, predecessor, auth))
        return envelope, receipt

    def predecessor(self, expected):
        previous = expected['execution_sha256']
        for index in range(expected['host_index']):
            envelope, receipt = self.validate_slot(expected['run_id'], index)
            if receipt is None or envelope['intent']['action']['plan_sha256'] != expected['plan_sha256']:
                raise ValueError('staging predecessor is missing or belongs to another plan')
            previous = receipt['sha256']
        return previous

    def final(self, envelope):
        intent = envelope['intent']
        a, ref = intent['action'], intent['authorization']
        expected, auth = self.context(a['plan_id'], a['plan_sha256'], ref, a['host_index'])
        predecessor = self.predecessor(expected)
        self.plan(a['plan_id'], a['plan_sha256'])
        self.files.recheck()
        self.publications.check()
        last_plan, last_values = self.plans[-1]
        _pending(self.files, self.pending, last_values[4], last_plan['execution_sha256'])
        # Final checks are pure: no filesystem or source work follows this clock.
        current = _time(self.now)
        for plan, values in self.plans:
            access._fresh(plan, values, self.pending, current)
        authorization(auth, expected, current)
        validate_intent(intent, expected, ref, predecessor, self.files.identity, current)
        for loaded, receipt, prior_action, prior_ref, prior_digest, prior_auth in self.loaded:
            authorization(prior_auth, prior_action, current)
            validate_intent(loaded['intent'], prior_action, prior_ref, prior_digest,
                            self.files.identity, current)
            if receipt is not None:
                validate_receipt(receipt['receipt'], loaded['intent'], loaded['sha256'], current)

    def publish(self, directory, run, index, name, envelope):
        raw = _publish(self.files, directory, name, envelope)
        path = _path(run, index) + '/' + name
        parts = self.files.parts(path)[:-1]
        pinned, names = self.publications.directories[parts]
        self.publications.directories[parts] = (pinned, sorted(names + [name]))
        stored = self.files.binding({'path': path, 'sha256': raw})
        if plan_digest(stored) != plan_digest(envelope):
            raise ValueError('staging publication changed')


def _success(base, envelope, receipt=None):
    result = {**base, 'status': 'uncertain', 'intent_sha256': envelope['sha256'], 'file_count': 2}
    if receipt is not None:
        result.update(status='staged', receipt_sha256=receipt['sha256'])
    return result


def _receipt(session, directory, envelope, observed, recovered):
    intent, digest = envelope['intent'], envelope['sha256']
    record = {'schema_version': 1, 'operation': OPERATION + '-receipt', 'intent_sha256': digest,
              'observation': observed, 'created_at': _time(session.now).isoformat(), 'recovered': recovered}
    validate_receipt(record, intent, digest, _time(session.now))
    result = {'receipt': record, 'sha256': plan_digest(record)}
    session.final(envelope)
    a = intent['action']
    try:
        claim = os.open('.receipt-claim', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                        0o600, dir_fd=directory)
    except FileExistsError:
        raise _ReceiptCollision('staging receipt publication already claimed') from None
    session.receipt_owned = True
    os.close(claim)
    # A winner can finish and remove its claim before this delayed caller opens
    # its own claim. Never let that late loser poison the immutable receipt.
    try:
        os.stat('receipt.json', dir_fd=directory, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        session.receipt_owned = False
        os.unlink('.receipt-claim', dir_fd=directory)
        os.fsync(directory)
        raise _ReceiptCollision('staging receipt already published')
    parts = session.files.parts(_path(a['run_id'], a['host_index']))
    pinned, names = session.publications.directories[parts]
    session.publications.directories[parts] = (pinned, sorted(names + ['.receipt-claim']))
    os.fsync(directory)
    session.publish(directory, a['run_id'], a['host_index'], 'receipt.json', result)
    os.unlink('.receipt-claim', dir_fd=directory)
    os.fsync(directory)
    session.publications.directories[parts] = (pinned, ['intent.json', 'receipt.json'])
    session.final(envelope)
    validate_receipt(record, intent, digest, _time(session.now))
    return result


def stage_network_files(project, plan_id, expected_sha, authorization_file, authorization_sha,
                        host_index, adapter, *, now=None, source_state=None):
    identifier(plan_id)
    sha256(expected_sha)
    sha256(authorization_sha)
    index = validate_host_index(host_index)
    base, session, directory, claimed = _summary(None, index), None, None, False
    try:
        session = _Session(project, now, source_state)
        ref = {'path': str(authorization_file), 'sha256': authorization_sha}
        expected, auth = session.context(plan_id, expected_sha, ref, index)
        run = expected['run_id']
        base['id'] = run
        path = _path(run, index)
        session.check_run(run, allow_missing=True)
        try:
            existing = session.files.directory(session.files.parts(path))
        except FileNotFoundError:
            existing = None
        if existing is not None:
            os.close(existing)
            envelope, receipt = session.validate_slot(run, index, binding=(plan_id, expected_sha, ref))
            session.final(envelope)
            if receipt is not None:
                validate_receipt(receipt['receipt'], envelope['intent'], envelope['sha256'], _time(now))
            return _success(base, envelope, receipt)
        predecessor = session.predecessor(expected)
        try:
            before = copy.deepcopy(adapter.observe(copy.deepcopy(expected)))
            observation(before, expected, _time(now))
        except Exception:
            return base
        parent = session.files.directory(session.files.parts(path)[:-1], create=True)
        try:
            session.check_run(run)
            os.mkdir('host-' + str(index), 0o700, dir_fd=parent)
            claimed = True
            parts = session.files.parts(path)[:-1]
            pinned, names = session.publications.directories[parts]
            session.publications.directories[parts] = (pinned, sorted(names + ['host-' + str(index)]))
            directory = session.files.directory(session.files.parts(path))
            os.fsync(parent)
        finally:
            os.close(parent)
        session.publications.pin(path + '/intent.json', [])
        record = intent_record(expected, ref, before, predecessor, _time(now).isoformat(), session.files.identity)
        envelope = {'intent': record, 'sha256': plan_digest(record)}
        session.publish(directory, run, index, 'intent.json', envelope)
        session.final(envelope)
        base['intent_sha256'] = envelope['sha256']
        base['dispatch_attempted'] = True
        try:
            adapter.stage(copy.deepcopy(expected), envelope['sha256'])
        except Exception:
            return _success(base, envelope)
        try:
            observed = copy.deepcopy(adapter.observe(copy.deepcopy(expected)))
            observation(observed, expected, _time(now), intent_sha=envelope['sha256'], since=record['created_at'])
        except Exception:
            return _success(base, envelope)
        receipt = _receipt(session, directory, envelope, observed, False)
        return _success(base, envelope, receipt)
    except BaseException as error:
        if claimed and (not base['dispatch_attempted'] or session.receipt_owned):
            _poison(directory)
        if not isinstance(error, ERRORS):
            raise
        return base
    finally:
        if directory is not None:
            os.close(directory)
        if session is not None:
            session.close()


def inspect_network_staging(project, run_id, host_index, expected_intent_sha, *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_intent_sha)
    index = validate_host_index(host_index)
    base, session = _summary(run_id, index), None
    try:
        session = _Session(project, now, source_state)
        envelope, receipt = session.validate_slot(run_id, index, expected_intent_sha)
        session.final(envelope)
        if receipt is not None:
            validate_receipt(receipt['receipt'], envelope['intent'], envelope['sha256'], _time(now))
        return _success(base, envelope, receipt)
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()


def reconcile_network_files(project, run_id, host_index, expected_intent_sha, observer,
                            *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_intent_sha)
    index = validate_host_index(host_index)
    base, session, directory, publishing = _summary(run_id, index), None, None, False
    try:
        session = _Session(project, now, source_state)
        envelope, receipt = session.validate_slot(run_id, index, expected_intent_sha)
        session.final(envelope)
        if receipt is not None:
            validate_receipt(receipt['receipt'], envelope['intent'], envelope['sha256'], _time(now))
            return _success(base, envelope, receipt)
        intent = envelope['intent']
        try:
            observed = copy.deepcopy(observer.observe(copy.deepcopy(intent['action'])))
            observation(observed, intent['action'], _time(now), intent_sha=envelope['sha256'], since=intent['created_at'])
        except Exception:
            return _success(base, envelope)
        directory = session.files.directory(session.files.parts(_path(run_id, index)))
        publishing = True
        receipt = _receipt(session, directory, envelope, observed, True)
        return _success(base, envelope, receipt)
    except BaseException as error:
        if publishing and session.receipt_owned:
            _poison(directory)
        if not isinstance(error, ERRORS):
            raise
        return base
    finally:
        if directory is not None:
            os.close(directory)
        if session is not None:
            session.close()

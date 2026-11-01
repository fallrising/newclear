"""Immutable fresh replay coordinator; one fixed action per current renewal."""
import copy
import os

import fresh_replay as contract
import fresh_run_authority as authority
from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import PrivateFiles, _decode
from fresh_network_admission_ops import _Publications
from fresh_network_access_ops import AREA as NETWORK_PLANS
from fresh_observation_ops import _publish
from fresh_rebuild import plan_digest
import pending_generation

AREA = 'private/operations/fresh-rebuild/replay'
ERRORS = (ValueError, RuntimeError, OSError, KeyError, TypeError, AttributeError, IndexError)
LIMIT = 128 * 1024 * 1024


def _time(now):
    return authority.current_time(now)


def _summary(run, index=None):
    return {'status': 'blocked', 'id': run, 'step_index': index,
            'stage_accepted': False, 'generation_changed': False,
            'dispatch_attempted': False, 'current_network_ready': False,
            'remote_mutation_performed': False}


def _path(run, index=None):
    path = AREA + '/' + identifier(run)
    if index is not None and (type(index) is not int or index < 0):
        raise ValueError('invalid replay index')
    return path if index is None else path + '/steps/step-' + str(index)


def _raw_ref(files, ref):
    exact(ref, {'path', 'sha256'})
    raw, path, digest = files.read(ref['path'])
    if ref != {'path': path, 'sha256': sha256(digest)} or not raw:
        raise ValueError('replay raw input differs')
    return raw


def _poison(directory):
    if directory is not None:
        try:
            fd = os.open('.publication-failed', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                         0o600, dir_fd=directory)
            os.close(fd)
            os.fsync(directory)
        except OSError:
            pass


def _require_current():
    step = authority.active()
    if step is None or step.historical:
        raise ValueError('replay requires explicit current step renewal')
    authority.check_current()


class _Session:
    def __init__(self, project, now, source_state):
        self.files = PrivateFiles(project, max_bytes=LIMIT)
        self.publications = _Publications(self.files)
        self.project, self.now, self.source_state = project, now, source_state
        self.pending = pending_generation.inspect(project)
        self.plan = self.digest = None
        self.loaded = {}
        self.receipt_owned = False
        if self.pending['status'] != 'pending':
            self.close()
            raise ValueError('replay requires exact pending reservation')

    def close(self):
        self.publications.close()
        self.files.close()

    def derive(self, run, bootstrap_sha, receipt_sha, created):
        import fresh_bootstrap_ops as boot
        import fresh_bootstrap as bc
        bootstrap = boot._Session(self.project, self.now, self.source_state)
        try:
            record = bootstrap.load_plan(run, bootstrap_sha)
            for index in range(len(bc.STEPS)):
                _, receipt = bootstrap.slot(index)
                if receipt is None:
                    raise ValueError('replay requires complete bootstrap chain')
            intent, last = bootstrap.slot(21)
            if last['sha256'] != receipt_sha:
                raise ValueError('replay bootstrap receipt differs')
            bootstrap.final()
            facts = bootstrap.facts(21, last['receipt']['observation'], intent_sha=intent['sha256'],
                                    since=intent['intent']['created_at'], now=timestamp(last['receipt']['created_at']))
            for path, digest in bootstrap.files.seen.items():
                _raw_ref(self.files, {'path': path, 'sha256': digest})
            execution_path = 'private/operations/fresh-rebuild/executions/' + run + '/execution.json'
            execution = self.files.json(execution_path)[0]
            review_path = 'private/operations/fresh-rebuild/review-plans/' + execution['execution']['binding']['plan_id'] + '.json'
            review = self.files.json(review_path)[0]
            desired = [row['spec'] for row in review['plan']['desired_apps']]
            prior_raw = self.files.binding(record['prior']['observation'])['observation']
            prior_ids = sorted({wid for capture in prior_raw['captures']
                for wid in capture['outputs']['containers'].splitlines()} |
                {row['id'] for row in _decode(prior_raw['captures'][0]['outputs']['workloads'].encode())})
            from app_desired import spec_identity
            for row, spec in zip(review['plan']['desired_apps'], desired):
                normalized, digest, appname = spec_identity(spec)
                if row != {'logical_app': normalized['name'], 'spec': normalized, 'spec_sha256': digest, 'appname': appname}:
                    raise ValueError('review desired manifest differs')
            lock = _decode((self.files.project / 'artifacts.amd64.lock.json').read_bytes())
            image = lock['nginx']['image']
            from app_desired import IMAGE
            if type(image) is not str or not IMAGE.fullmatch(image):
                raise ValueError('canary image is not pinned')
            dependencies = [{'path': path, 'sha256': digest} for path, digest in sorted(self.files.seen.items())
                            if not path.startswith(AREA + '/')]
            return {'schema_version': 1, 'operation': 'fresh-replay-plan', 'run_id': run,
                **{k: record[k] for k in ('plan_id','plan_sha256','execution_sha256','pending_sha256',
                                           'network_render','network_setup','render','prior')},
                'bootstrap_sha256': bootstrap_sha, 'bootstrap_receipt_sha256': receipt_sha,
                'created_at': created, 'private_identity': self.files.identity,
                'desired_apps': desired, 'canary_image': image, 'steps': contract.steps(desired),
                'bootstrap_facts': {**facts, 'prior_workload_ids': prior_ids}, 'dependencies': dependencies,
                'context_refs': {'review': review_path, 'execution': execution_path,
                    'bootstrap': boot._path(run) + '/plan.json',
                    'network': NETWORK_PLANS + '/' + record['plan_id'] + '/plan.json'}}
        finally:
            bootstrap.close()

    def load_plan(self, run, digest):
        path = _path(run) + '/plan.json'
        parent = self.files.directory(self.files.parts(_path(run)))
        try:
            names = sorted(os.listdir(parent))
            if names not in (['plan.json'], ['plan.json', 'steps']):
                raise ValueError('replay plan publication is incomplete or poisoned')
        finally:
            os.close(parent)
        self.publications.pin(path, names)
        envelope, _, _ = self.files.json(path)
        exact(envelope, {'plan', 'sha256'})
        record = envelope['plan']
        if envelope['sha256'] != digest or plan_digest(record) != digest or record['run_id'] != run:
            raise ValueError('replay plan digest differs')
        for ref in record['dependencies']:
            _raw_ref(self.files, ref)
        rebuilt = self.derive(record['run_id'], record['bootstrap_sha256'], record['bootstrap_receipt_sha256'], record['created_at'])
        rebuilt['dependencies'] = record['dependencies']
        if rebuilt != record or timestamp(record['created_at']) > _time(self.now):
            raise ValueError('replay plan is not current derivation')
        self.plan, self.digest = record, digest
        return record

    def slots(self, *, missing=False):
        path = _path(self.plan['run_id']) + '/steps'
        try:
            fd = self.files.directory(self.files.parts(path))
        except FileNotFoundError:
            if missing:
                return []
            raise
        try:
            names = sorted(os.listdir(fd))
            expected = sorted('step-' + str(i) for i in range(len(names)))
            if names != expected or len(names) > len(self.plan['steps']):
                raise ValueError('replay journal contains holes or unknown data')
        finally:
            os.close(fd)
        self.publications.pin(path + '/entry', names)
        return names

    def slot(self, index, wanted=None):
        self.slots()
        path = _path(self.plan['run_id'], index)
        fd = self.files.directory(self.files.parts(path))
        try:
            names = sorted(os.listdir(fd))
            if names not in (['intent.json'], ['intent.json', 'receipt.json']):
                raise ValueError('replay step journal incomplete or poisoned')
        finally:
            os.close(fd)
        self.publications.pin(path + '/intent.json', names)
        intent, _, _ = self.files.json(path + '/intent.json')
        exact(intent, {'intent', 'sha256'})
        if plan_digest(intent['intent']) != intent['sha256'] or wanted is not None and wanted != intent['sha256']:
            raise ValueError('replay intent digest differs')
        receipt = None
        if 'receipt.json' in names:
            receipt, _, _ = self.files.json(path + '/receipt.json')
            exact(receipt, {'receipt', 'sha256'})
            if plan_digest(receipt['receipt']) != receipt['sha256']:
                raise ValueError('replay receipt digest differs')
        expected = contract.action(self.plan, self.digest, index)
        previous = self.plan['bootstrap_receipt_sha256']
        if index:
            _, prior_receipt = self.validate_prefix(index-1)
            if prior_receipt is None:
                raise ValueError('replay predecessor is uncertain')
            previous = prior_receipt['sha256']
            if timestamp(prior_receipt['receipt']['created_at']) > timestamp(intent['intent']['created_at']):
                raise ValueError('replay predecessor follows intent')
        for ref in intent['intent']['predecessor_refs']:
            _raw_ref(self.files, ref)
        auth = self.files.binding(intent['intent']['authorization'])
        created = timestamp(intent['intent']['created_at'])
        if created > _time(self.now):
            raise ValueError('replay intent is future')
        contract.authorization(auth, expected, created)
        contract.validate_intent(intent['intent'], expected, intent['intent']['authorization'],
                                  previous, self.files.identity, created, self.predecessor_refs(index))
        self.network_valid(intent['intent']['network'], index, created)
        self.loaded[index] = intent, None
        if receipt is not None:
            self.validate_receipt(intent, receipt, auth)
        self.loaded[index] = intent, receipt
        return intent, receipt

    def predecessor_refs(self, index):
        if index:
            paths = [_path(self.plan['run_id'], index-1) + '/' + name
                     for name in ('intent.json', 'receipt.json')]
        else:
            paths = ['private/operations/fresh-rebuild/bootstrap/' + self.plan['run_id'] + '/steps/step-21/receipt.json']
        result = []
        for path in paths:
            _, relative, digest = self.files.read(path)
            result.append({'path': relative, 'sha256': digest})
        return result

    def validate_prefix(self, index):
        if index not in self.loaded:
            return self.slot(index)
        return self.loaded[index]

    def network_valid(self, evidence, index, now, *, after=False):
        from fresh_network_probe import validate_network_evidence
        validate_network_evidence(evidence, self.plan['network_render'], now,
            setup=self.plan['network_setup'], expected_services=contract.expected_services(index, after=after))

    def collect(self, collector, index, *, after=False):
        from fresh_network_probe import collect_network_evidence
        collector = collect_network_evidence if collector is None else collector
        render = self.plan['network_render']
        by_ip = dict(line.split(' ', 1) for line in render['controller_known_hosts'].splitlines())
        keys = {host['alias']: by_ip[host['ip']] for host in render['hosts']}
        started = _time(self.now)
        evidence = copy.deepcopy(collector(copy.deepcopy(render), keys, setup=copy.deepcopy(self.plan['network_setup']),
            now=started, expected_services=contract.expected_services(index, after=after)))
        if timestamp(evidence['observed_at']) < started:
            raise ValueError('replay network evidence predates this collection')
        self.network_valid(evidence, index, _time(self.now), after=after)
        return evidence

    def facts(self, index, observed, *, intent_sha=None, since=None, before=False, now=None):
        expected = contract.action(self.plan, self.digest, index)
        facts = contract.observation(observed, expected, _time(self.now) if now is None else now,
                                     intent_sha=intent_sha, since=since, before=before)
        from fresh_replay_host import validate_transition
        prior = None
        if index:
            previous_intent, previous_receipt = self.validate_prefix(index-1)
            if previous_receipt is None:
                raise ValueError('replay predecessor is uncertain')
            prior = previous_receipt['receipt']['observation']
        if before:
            from fresh_replay_host import validate_boundary
            validate_boundary(expected,observed,prior)
        if not before:
            old = self.loaded.get(index)
            before_value = old[0]['intent']['before'] if old else None
            validate_transition(expected, before_value, observed, prior)
        return facts

    def validate_receipt(self, intent, receipt, auth):
        record = receipt['receipt']
        index = intent['intent']['action']['step_index']
        path = _path(self.plan['run_id'], index) + '/intent.json'
        if record['intent_ref'] != {'path': path, 'sha256': self.files.read(path)[2]}:
            raise ValueError('replay receipt raw intent differs')
        completed = timestamp(record['created_at'])
        if not timestamp(intent['intent']['created_at']) <= completed <= _time(self.now):
            raise ValueError('replay receipt chronology differs')
        contract.validate_receipt(record, intent['intent'], intent['sha256'], completed)
        self.facts(index, intent['intent']['before'], before=True, now=timestamp(intent['intent']['created_at']))
        self.loaded[index] = intent, None
        self.facts(index, record['observation'], intent_sha=intent['sha256'],
                   since=intent['intent']['created_at'], now=completed)
        if intent['intent']['action']['step'] not in contract.READONLY:
            for key in ('started_at','completed_at'):
                contract.authorization(auth, intent['intent']['action'], timestamp(record['observation']['provenance'][key]))
        if not timestamp(record['observation']['observed_at']) <= timestamp(record['network']['observed_at']) <= completed:
            raise ValueError('replay post-action network chronology differs')
        self.network_valid(record['network'], index, completed, after=True)
        if record['timing'] != self.timing(index, record['observation']['observed_at']):
            raise ValueError('replay timing differs')

    def timing(self, index, observed_at):
        if self.plan['steps'][index]['step'] != 'residue-accept':
            return None
        return {'residue_completed_at': observed_at, 'candidate_seconds': 1800}

    def final(self, network=None, index=None, *, after=False):
        record = self.plan
        rebuilt = self.derive(record['run_id'], record['bootstrap_sha256'], record['bootstrap_receipt_sha256'], record['created_at'])
        # derive has also read each journal authorization, which is deliberately
        # outside immutable preparation dependencies; compare the original subset.
        rebuilt['dependencies'] = record['dependencies']
        if plan_digest(rebuilt) != self.digest:
            raise ValueError('replay derivation changed at action boundary')
        for ref in record['dependencies']:
            _raw_ref(self.files, ref)
        self.files.recheck()
        self.publications.check()
        if pending_generation.inspect(self.project) != self.pending:
            raise ValueError('replay pending reservation changed')
        if not getattr(self, 'historical', False):
            authority.check_current()
        current = _time(self.now)
        if network is not None:
            self.network_valid(network, index, current, after=after)
        if timestamp(record['created_at']) > current:
            raise ValueError('replay plan is future')

    def publish(self, fd, path, filename, envelope):
        raw = _publish(self.files, fd, filename, envelope)
        parts = self.files.parts(path)
        pinned, names = self.publications.directories[parts]
        self.publications.directories[parts] = (pinned, sorted(names + [filename]))
        if self.files.binding({'path': path + '/' + filename, 'sha256': raw}) != envelope:
            raise ValueError('replay publication changed')

    def claim(self, path):
        parts = self.files.parts(path)
        parent = self.files.directory(parts[:-1], create=True)
        fd = None
        try:
            os.mkdir(parts[-1], 0o700, dir_fd=parent)
            created = os.stat(parts[-1], dir_fd=parent, follow_symlinks=False)
            fd = self.files.directory(parts)
            opened = os.fstat(fd)
            if (created.st_dev, created.st_ino) != (opened.st_dev, opened.st_ino) or os.listdir(fd):
                raise ValueError('replay claim changed')
            os.fsync(parent)
            if parts[:-1] in self.publications.directories:
                pinned, names = self.publications.directories[parts[:-1]]
                self.publications.directories[parts[:-1]] = (pinned, sorted(names + [parts[-1]]))
            self.publications.pin(path + '/entry', [])
            result, fd = fd, None
            return result
        finally:
            os.close(parent)
            if fd is not None:
                os.close(fd)


def _success(base, intent, receipt=None):
    index = intent['intent']['action']['step_index']
    value = {**base, 'status': 'uncertain', 'intent_sha256': intent['sha256'], 'stage': contract.stage(index, contract.steps(intent['intent']['action']['desired_apps']))}
    if receipt is not None:
        value.update(status='replay-step-complete', receipt_sha256=receipt['sha256'])
        if intent['intent']['action']['step'] in ('apps-accept', 'resources-accept', 'residue-accept'):
            value.update(status=contract.stage(index, contract.steps(intent['intent']['action']['desired_apps'])), stage_accepted=True,
                         next_stage={'apps-accept':'resources-accepted','resources-accept':'residue-audited','residue-accept':'generation-accepted'}[intent['intent']['action']['step']])
    return value


@authority.operation
def prepare_replay(project, run_id, bootstrap_sha, bootstrap_receipt_sha, *, now=None, source_state=None):
    identifier(run_id); sha256(bootstrap_sha); sha256(bootstrap_receipt_sha)
    base, session, fd = _summary(run_id), None, None
    try:
        _require_current()
        session = _Session(project, now, source_state)
        record = session.derive(run_id, bootstrap_sha, bootstrap_receipt_sha, _time(now).isoformat())
        try:
            existing, _, _ = session.files.json(_path(run_id) + '/plan.json')
        except FileNotFoundError:
            pass
        else:
            record['created_at'] = existing['plan']['created_at']
            digest = plan_digest(record)
            session.load_plan(run_id, digest)
            session.final()
            return {**base, 'status':'replay-planned','replay_sha256':digest,'sha256':digest,'step_count':len(record['steps'])}
        digest = plan_digest(record)
        session.plan, session.digest = record, digest
        session.final()
        fd = session.claim(_path(run_id))
        session.publish(fd, _path(run_id), 'plan.json', {'plan':record,'sha256':digest})
        session.final()
        return {**base,'status':'replay-planned','replay_sha256':digest,'sha256':digest,'step_count':len(record['steps'])}
    except BaseException as error:
        if fd is not None: _poison(fd)
        if not isinstance(error, ERRORS): raise
        return base
    finally:
        if fd is not None: os.close(fd)
        if session is not None: session.close()


def _seal(session, fd, intent, observed, network, observer, recovered):
    index = intent['intent']['action']['step_index']
    record = {'schema_version': 1, 'operation': 'fresh-replay-receipt',
              'intent_sha256': intent['sha256'], 'observation': observed,
              'created_at': _time(session.now).isoformat(), 'recovered': recovered,
              'network': network,
              'intent_ref': {'path': _path(session.plan['run_id'], index) + '/intent.json',
                             'sha256': session.files.read(_path(session.plan['run_id'], index) + '/intent.json')[2]},
              'timing': session.timing(index, observed['observed_at'])}
    receipt = {'receipt': record, 'sha256': plan_digest(record)}
    auth = session.files.binding(intent['intent']['authorization'])
    session.validate_receipt(intent, receipt, auth)
    session.final(network, index, after=True)
    # The exact run lock serializes normal calls; exclusive publication still
    # prevents a stale observer from overwriting another completed receipt.
    claim = os.open('.receipt-claim', os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW,
                    0o600, dir_fd=fd)
    os.close(claim)
    try:
        os.stat('receipt.json', dir_fd=fd, follow_symlinks=False)
    except FileNotFoundError:
        pass
    else:
        os.unlink('.receipt-claim', dir_fd=fd)
        os.fsync(fd)
        raise ValueError('replay receipt already published')
    session.receipt_owned = True
    parts = session.files.parts(_path(session.plan['run_id'], index))
    pinned, names = session.publications.directories[parts]
    session.publications.directories[parts] = (pinned, sorted(names + ['.receipt-claim']))
    os.fsync(fd)
    session.publish(fd, _path(session.plan['run_id'], index), 'receipt.json', receipt)
    os.unlink('.receipt-claim', dir_fd=fd)
    os.fsync(fd)
    session.publications.directories[parts] = (pinned, ['intent.json', 'receipt.json'])
    session.final(network, index, after=True)
    session.loaded[index] = intent, receipt
    session.receipt_owned = False
    return receipt


@authority.operation
def execute_replay(project, run_id, replay_sha, step_index, authorization_file, authorization_sha,
                      adapter, collector=None, *, now=None, source_state=None):
    identifier(run_id)
    sha256(replay_sha)
    sha256(authorization_sha)
    index = step_index
    if type(index) is not int or index < 0:
        raise ValueError('invalid replay index')
    base, session, fd = _summary(run_id, index), None, None
    try:
        _require_current()
        session = _Session(project, now, source_state)
        session.load_plan(run_id, replay_sha)
        expected = contract.action(session.plan, replay_sha, index)
        ref = {'path': str(authorization_file), 'sha256': authorization_sha}
        auth = session.files.binding(ref)
        contract.authorization(auth, expected, _time(now))
        names = session.slots(missing=True)
        if 'step-' + str(index) in names:
            intent, receipt = session.slot(index)
            if intent['intent']['authorization'] != ref:
                raise ValueError('replay existing intent authorization differs')
            session.final()
            return _success(base, intent, receipt)
        previous = session.plan['bootstrap_receipt_sha256']
        if index:
            _, prior = session.validate_prefix(index-1)
            if prior is None:
                raise ValueError('replay predecessor uncertain')
            previous = prior['sha256']
        network = session.collect(collector, index)
        observed_start = _time(now)
        before = copy.deepcopy(adapter.observe(copy.deepcopy(expected)))
        if timestamp(before['observed_at']) < observed_start:
            raise ValueError('replay host evidence predates this observation')
        session.facts(index, before, before=True)
        session.final(network, index)
        contract.authorization(auth, expected, _time(now))
        # Create steps only after all no-side-effect guards have passed.
        if not names:
            path = _path(run_id) + '/steps'
            parent = session.files.directory(session.files.parts(_path(run_id)))
            try:
                os.mkdir('steps', 0o700, dir_fd=parent)
                os.fsync(parent)
            finally:
                os.close(parent)
            parts = session.files.parts(_path(run_id))
            pinned, _ = session.publications.directories[parts]
            session.publications.directories[parts] = (pinned, ['plan.json', 'steps'])
            session.publications.pin(path + '/entry', [])
        fd = session.claim(_path(run_id, index))
        record = contract.intent_record(expected, ref, before, previous, _time(now).isoformat(),
                                         session.files.identity, network, session.predecessor_refs(index))
        intent = {'intent': record, 'sha256': plan_digest(record)}
        session.publish(fd, _path(run_id, index), 'intent.json', intent)
        session.final(network, index)
        contract.authorization(auth, expected, _time(now))
        base['intent_sha256'] = intent['sha256']
        if expected['step'] not in contract.READONLY:
            # Historical bootstrap checks do not replace the current owner
            # renewal/fence at this action's last controller writer boundary.
            _require_current()
            base['dispatch_attempted'] = True
            base['remote_mutation_performed'] = None
            try:
                adapter.dispatch(copy.deepcopy(expected), intent['sha256'])
            except Exception:
                return _success(base, intent)
        try:
            observed = copy.deepcopy(adapter.observe(copy.deepcopy(expected)))
            session.loaded[index] = intent, None
            session.facts(index, observed, intent_sha=intent['sha256'], since=record['created_at'])
            network = session.collect(collector, index, after=True)
        except Exception:
            return _success(base, intent)
        receipt = _seal(session, fd, intent, observed, network, adapter, False)
        return _success({**base, 'current_network_ready': True}, intent, receipt)
    except BaseException as error:
        if fd is not None and (session.receipt_owned or not base['dispatch_attempted']):
            _poison(fd)
        if not isinstance(error, ERRORS):
            raise
        return base
    finally:
        if fd is not None:
            os.close(fd)
        if session is not None:
            session.close()


@authority.operation
def reconcile_replay(project, run_id, step_index, expected_intent_sha, observer, collector=None,
                        *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_intent_sha)
    index = step_index
    if type(index) is not int or index < 0:
        raise ValueError('invalid replay index')
    base, session, fd = _summary(run_id, index), None, None
    try:
        _require_current()
        session = _Session(project, now, source_state)
        plan, _, _ = session.files.json(_path(run_id) + '/plan.json')
        session.load_plan(run_id, plan['sha256'])
        intent, receipt = session.slot(index, expected_intent_sha)
        session.final()
        if receipt is not None:
            return _success(base, intent, receipt)
        expected = intent['intent']['action']
        try:
            observed = copy.deepcopy(observer.observe(copy.deepcopy(expected)))
            session.facts(index, observed, intent_sha=intent['sha256'], since=intent['intent']['created_at'])
            network = session.collect(collector, index, after=True)
        except Exception:
            return _success(base, intent)
        fd = session.files.directory(session.files.parts(_path(run_id, index)))
        receipt = _seal(session, fd, intent, observed, network, observer, True)
        return _success({**base, 'current_network_ready': True}, intent, receipt)
    except BaseException as error:
        if session is not None and session.receipt_owned:
            _poison(fd)
        if not isinstance(error, ERRORS):
            raise
        return base
    finally:
        if fd is not None:
            os.close(fd)
        if session is not None:
            session.close()


def inspect_replay(project, run_id, replay_sha, *, now=None, source_state=None):
    """Local historical integrity only; never gathers probes or grants readiness."""
    identifier(run_id)
    sha256(replay_sha)
    base, session = _summary(run_id), None
    try:
        session = _Session(project, now, source_state)
        session.historical = True
        session.load_plan(run_id, replay_sha)
        names = session.slots(missing=True)
        completed, uncertain = 0, False
        for index in range(len(names)):
            _, receipt = session.slot(index)
            if receipt is None:
                if index != len(names)-1:
                    raise ValueError('replay continued after uncertain action')
                uncertain = True
            else:
                completed += 1
        session.final()
        return {**base, 'status': 'uncertain' if uncertain else 'historically-valid',
                'replay_sha256': replay_sha, 'historical_integrity': True,
                'journal_receipt_count': completed, 'uncertain': uncertain,
                'next_stage': 'generation-accepted' if completed == len(session.plan['steps']) else 'apps-replayed'}
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()


def load_acceptance(project, run_id, replay_sha, *, now=None, source_state=None):
    """Deep historical evidence loading; never current readiness or a writer grant.

    Before generation commit this reads the canonical pending-before inputs.
    After commit the caller must provide the independently verified historical
    view hook; no validator here bypasses changed current bytes or authority.
    """
    identifier(run_id); sha256(replay_sha)
    session = _Session(project, now, source_state)
    session.historical = True
    try:
        record = session.load_plan(run_id, replay_sha)
        names = session.slots(missing=True)
        if len(names) != len(record['steps']):
            raise ValueError('acceptance requires the complete fixed replay schedule')
        receipts = []
        for index in range(len(names)):
            _, receipt = session.slot(index)
            if receipt is None: raise ValueError('acceptance has uncertain action')
            receipts.append(receipt)
        from fresh_replay_host import validate_evidence
        app_index = next(i for i,s in enumerate(record['steps']) if s['step']=='apps-accept')
        app_facts = validate_evidence(contract.action(record,replay_sha,app_index),receipts[app_index]['receipt']['observation'])
        final_facts = validate_evidence(contract.action(record,replay_sha,len(names)-1),receipts[-1]['receipt']['observation'])
        # Exact full-keyspace values, full desired workload IDs and all plugin
        # quota/capacity rows must return to the post-desired baseline after all
        # run-owned V02/V03/V04 canaries were individually removed/rejected.
        for key in ('metadata','nodes','workloads'):
            if plan_digest(app_facts[key]) != plan_digest(final_facts[key]):
                raise ValueError('full residue differs from exact desired baseline')
        session.final()
        context = {key:session.files.json(path)[0] for key,path in record['context_refs'].items()}
        context['replay'] = session.files.json(_path(run_id)+'/plan.json')[0]
        def ref(path):
            raw,relative,digest=session.files.read(path)
            _decode(raw)
            return {'path':relative,'sha256':digest,'kind':'json'}
        bootstrap_ref=ref('private/operations/fresh-rebuild/bootstrap/'+run_id+'/steps/step-21/receipt.json')
        checks={k:[] for k in ('V01','V02','V03','V04','residual_node_workload_plugin_capacity')}
        checks['V01']=[bootstrap_ref]
        for i,step in enumerate(record['steps']):
            raw_ref=ref(_path(run_id,i)+'/receipt.json')
            name=step['step']
            if step['canary'] and name not in ('host-deploy','host-http','host-remove','memory-reject','storage-reject','quota-accept'):
                checks['V02'].append(raw_ref)
            if name in ('bridge-http','host-deploy','host-http','host-remove','apps-accept'):
                checks['V03'].append(raw_ref)
            if name in ('memory-reject','storage-reject','quota-accept','resources-accept'):
                checks['V04'].append(raw_ref)
            if name=='residue-accept': checks['residual_node_workload_plugin_capacity'].append(raw_ref)
        # A proved generation before-view returns sealed original bytes without
        # recording them as physical file reads. Retain the plan dependencies
        # already verified by load_plan so acceptance has the same raw evidence
        # identity before and during generation history validation.
        observed = dict(session.files.seen)
        for dependency in record['dependencies']:
            _raw_ref(session.files, dependency)
            path, digest = dependency['path'], dependency['sha256']
            if path in observed and observed[path] != digest:
                raise ValueError('acceptance dependency evidence differs')
            observed[path] = digest
        evidence=[]
        for path,digest in sorted(observed.items()):
            raw=_raw_ref(session.files,{'path':path,'sha256':digest})
            try: _decode(raw); kind='json'
            except ValueError: kind='raw'
            evidence.append({'path':path,'sha256':digest,'kind':kind})
        session.files.recheck(); session.publications.check()
        bootstrap_receipt=session.files.json(bootstrap_ref['path'])[0]['receipt']
        return {'schema_version':1,'operation':'fresh-replay-acceptance-evidence','run_id':run_id,
            **{k:record[k] for k in ('execution_sha256','pending_sha256','bootstrap_sha256','private_identity')},
            'replay_sha256':replay_sha,'receipt_sha256':receipts[-1]['sha256'],
            'context':context,'evidence_refs':evidence,'checks':checks,
            'timing':{'bootstrap':bootstrap_receipt['timing'],
                'apps_ready_at':receipts[app_index]['receipt']['observation']['observed_at'],
                'residue_completed_at':receipts[-1]['receipt']['observation']['observed_at'],
                'refs':[bootstrap_ref,ref(_path(run_id,app_index)+'/receipt.json'),ref(_path(run_id,len(names)-1)+'/receipt.json')]}}
    finally: session.close()


verify_acceptance_chain = load_acceptance

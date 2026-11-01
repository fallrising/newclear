"""Immutable fresh bootstrap coordinator; one fixed action per current renewal."""
import base64
import copy
import hashlib
import os

import fresh_bootstrap as contract
import fresh_run_authority as authority
from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import PrivateFiles, _decode
from fresh_network_admission_ops import _Publications
from fresh_network_access_ops import AREA as NETWORK_PLANS
from fresh_network_ready_ops import AREA as NETWORK_RECEIPTS, MANUAL_AREA, MANUAL_RECEIPT_AREA
from fresh_observation_ops import _publish
from fresh_rebuild import plan_digest
from fresh_run_ops import _execution
import pending_generation

AREA = 'private/operations/fresh-rebuild/bootstrap'
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
    return path if index is None else path + '/steps/step-' + str(contract.step_index(index))


def _raw_ref(files, ref):
    exact(ref, {'path', 'sha256'})
    raw, path, digest = files.read(ref['path'])
    if ref != {'path': path, 'sha256': sha256(digest)} or not raw:
        raise ValueError('bootstrap raw input differs')
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
        raise ValueError('bootstrap requires explicit current step renewal')
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
            raise ValueError('bootstrap requires exact pending reservation')

    def close(self):
        self.publications.close()
        self.files.close()

    def history(self, network, receipt_sha):
        result = authority.inspect_history(self.project, network['run_id'], network['execution_sha256'],
            receipt_sha, now=self.now, source_state=self.source_state)
        if result.get('historical_integrity') is not True:
            raise ValueError('bootstrap historical network chain differs')

    def references(self, value, visited=None):
        """Pin all transitive raw references; logical JSON equality is insufficient."""
        visited = set() if visited is None else visited
        if type(value) is dict:
            if {'path', 'sha256'} <= set(value) and type(value['path']) is str and value['path'].startswith('private/'):
                ref = {k: value[k] for k in ('path', 'sha256')}
                if ref['path'] not in visited:
                    visited.add(ref['path'])
                    raw = _raw_ref(self.files, ref)
                    try:
                        child = _decode(raw)
                    except ValueError:
                        child = None
                    self.references(child, visited)
            else:
                for child in value.values():
                    self.references(child, visited)
        elif type(value) is list:
            for child in value:
                self.references(child, visited)

    def derive(self, plan_id, plan_sha, receipt_sha, input_ref, created):
        network_path = NETWORK_PLANS + '/' + identifier(plan_id) + '/plan.json'
        self.publications.pin(network_path, ['plan.json'])
        envelope, _, _ = self.files.json(network_path)
        exact(envelope, {'plan', 'sha256'})
        network = envelope['plan']
        if envelope['sha256'] != plan_sha or plan_digest(network) != plan_sha:
            raise ValueError('bootstrap network plan digest differs')
        self.history(network, receipt_sha)
        run = network['run_id']
        execution = _execution(self.files, run, network['execution_sha256'], self.now, self.source_state)
        review, _, _ = self.files.json('private/operations/fresh-rebuild/review-plans/' +
                                      execution['binding']['plan_id'] + '.json')
        policy = review['plan']['fresh_policy']
        for area, name in ((NETWORK_RECEIPTS, 'receipt.json'), (MANUAL_AREA, 'intent.json'),
                           (MANUAL_RECEIPT_AREA, 'receipt.json')):
            path = area + '/' + run + '/' + name
            self.publications.pin(path, [name])
            value, _, _ = self.files.json(path)
            self.references(value)
            if area == MANUAL_AREA:
                setup = value['intent']['setup']
        self.references(envelope)
        self.references(execution)
        document = self.files.binding(input_ref)
        contract.validate_request(document, network, plan_sha, self.pending, receipt_sha)
        baseline = self.files.binding(execution['evidence']['host_baseline'])
        if baseline.get('schema_version') != 2 or document['prior_baseline'] != baseline['observation']:
            raise ValueError('bootstrap requires the original captured baseline')
        original = self.files.binding(document['prior_baseline'])['observation']
        outputs = original['captures'][0]['outputs']
        status = _decode(outputs['status_before'].encode())[0]['Status']
        members = _decode(outputs['members'].encode())['members']
        prior = {'cluster_id': str(status['header']['cluster_id']),
                 'member_ids': [str(row['ID']) for row in members],
                 'host_baseline': execution['evidence']['host_baseline'],
                 'observation': document['prior_baseline']}
        token = _raw_ref(self.files, document['token_file'])
        if (hashlib.sha256(token).hexdigest() != policy['target_token_sha256']
                or policy['target_token_sha256'] == policy['prior_token_sha256']):
            raise ValueError('bootstrap token differs from reviewed fresh token')
        binary = _raw_ref(self.files, document['safe_core_binary'])
        from core_release import validation_record
        selection = validation_record(self.files.project, 'patches/core-v0.1.5-safe-node-add.validation.json')
        if hashlib.sha256(binary).hexdigest() != selection['artifact_sha256']:
            raise ValueError('bootstrap core binary is not the validated safe AddNode artifact')
        # _execution pins and rechecks all public code/lock bytes using no-follow IO.
        lock_raw = (self.files.project / 'artifacts.amd64.lock.json').read_bytes()
        if hashlib.sha256(lock_raw).hexdigest() != document['artifact_lock_sha256']:
            raise ValueError('bootstrap artifact lock differs')
        from fresh_bootstrap_render import build_render
        rendered = build_render(network['render'], _decode(lock_raw), token, run_id=run,
            target_token_sha256=policy['target_token_sha256'], prior_token_sha256=policy['prior_token_sha256'],
            safe_core={'selection': selection, 'binary_base64': base64.b64encode(binary).decode()},
            core_key_path=setup['core_key']['path'], capacities=document['capacities'])
        # The proved before-view supplies these logical bytes without adding
        # them to the physical read cache. Bind them explicitly in either view.
        from fresh_generation import PATHS
        dependency_hashes = dict(self.files.seen)
        for path in PATHS:
            _, relative, digest = self.files.read(path)
            if relative != path or (path in dependency_hashes and dependency_hashes[path] != digest):
                raise ValueError('bootstrap canonical dependency differs')
            dependency_hashes[path] = digest
        dependencies = [{'path': path, 'sha256': digest} for path, digest in sorted(dependency_hashes.items())
                        if not path.startswith(AREA + '/')]
        return {'schema_version': 1, 'operation': 'fresh-bootstrap-plan', 'run_id': run,
                'plan_id': plan_id, 'plan_sha256': plan_sha, 'network_receipt_sha256': receipt_sha,
                'execution_sha256': network['execution_sha256'], 'pending_sha256': self.pending['sha256'],
                'input': input_ref, 'created_at': created, 'private_identity': self.files.identity,
                'network_render': network['render'], 'network_setup': setup,
                'render': rendered, 'prior': prior, 'dependencies': dependencies}

    def load_plan(self, run, digest):
        path = _path(run) + '/plan.json'
        parent = self.files.directory(self.files.parts(_path(run)))
        try:
            names = sorted(os.listdir(parent))
            if names not in (['plan.json'], ['plan.json', 'steps']):
                raise ValueError('bootstrap plan publication is incomplete or poisoned')
        finally:
            os.close(parent)
        self.publications.pin(path, names)
        envelope, _, _ = self.files.json(path)
        exact(envelope, {'plan', 'sha256'})
        record = envelope['plan']
        if envelope['sha256'] != digest or plan_digest(record) != digest or record['run_id'] != run:
            raise ValueError('bootstrap plan digest differs')
        for ref in record['dependencies']:
            _raw_ref(self.files, ref)
        rebuilt = self.derive(record['plan_id'], record['plan_sha256'], record['network_receipt_sha256'],
                              record['input'], record['created_at'])
        if rebuilt != record or timestamp(record['created_at']) > _time(self.now):
            raise ValueError('bootstrap plan is not current derivation')
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
            if names != expected or len(names) > len(contract.STEPS):
                raise ValueError('bootstrap journal contains holes or unknown data')
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
                raise ValueError('bootstrap step journal incomplete or poisoned')
        finally:
            os.close(fd)
        self.publications.pin(path + '/intent.json', names)
        intent, _, _ = self.files.json(path + '/intent.json')
        exact(intent, {'intent', 'sha256'})
        if plan_digest(intent['intent']) != intent['sha256'] or wanted is not None and wanted != intent['sha256']:
            raise ValueError('bootstrap intent digest differs')
        receipt = None
        if 'receipt.json' in names:
            receipt, _, _ = self.files.json(path + '/receipt.json')
            exact(receipt, {'receipt', 'sha256'})
            if plan_digest(receipt['receipt']) != receipt['sha256']:
                raise ValueError('bootstrap receipt digest differs')
        expected = contract.action(self.plan, self.digest, index)
        previous = self.plan['network_receipt_sha256']
        if index:
            _, prior_receipt = self.validate_prefix(index-1)
            if prior_receipt is None:
                raise ValueError('bootstrap predecessor is uncertain')
            previous = prior_receipt['sha256']
            if timestamp(prior_receipt['receipt']['created_at']) > timestamp(intent['intent']['created_at']):
                raise ValueError('bootstrap predecessor follows intent')
        for ref in intent['intent']['predecessor_refs']:
            _raw_ref(self.files, ref)
        auth = self.files.binding(intent['intent']['authorization'])
        created = timestamp(intent['intent']['created_at'])
        if created > _time(self.now):
            raise ValueError('bootstrap intent is future')
        contract.authorization(auth, expected, created)
        contract.validate_intent(intent['intent'], expected, intent['intent']['authorization'],
                                  previous, self.files.identity, created, self.predecessor_refs(index))
        self.network_valid(intent['intent']['network'], index, created)
        if receipt is not None:
            self.validate_receipt(intent, receipt, auth)
        self.loaded[index] = intent, receipt
        return intent, receipt

    def predecessor_refs(self, index):
        if index:
            paths = [_path(self.plan['run_id'], index-1) + '/' + name
                     for name in ('intent.json', 'receipt.json')]
        else:
            paths = [NETWORK_RECEIPTS + '/' + self.plan['run_id'] + '/receipt.json']
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
            raise ValueError('bootstrap network evidence predates this collection')
        self.network_valid(evidence, index, _time(self.now), after=after)
        return evidence

    def facts(self, index, observed, *, intent_sha=None, since=None, before=False, now=None):
        expected = contract.action(self.plan, self.digest, index)
        facts = contract.observation(observed, expected, _time(self.now) if now is None else now,
                                     intent_sha=intent_sha, since=since, before=before)
        if index in contract.ACCEPTANCE:
            etcd = facts['etcd']
            if (etcd is None or etcd['healthy'] is not True or len(etcd['member_ids']) != 1
                    or etcd['member_id'] != etcd['member_ids'][0]
                    or etcd['cluster_id'] == self.plan['prior']['cluster_id']
                    or set(etcd['member_ids']) & set(self.plan['prior']['member_ids'])
                    or etcd['token_sha256'] != self.plan['render']['target_token_sha256']
                    or etcd['data_root'] != self.plan['render']['data_root']):
                raise ValueError('fresh etcd identity or provenance differs')
            if index == 2 and etcd['keys'] != []:
                raise ValueError('fresh etcd entire keyspace is not empty')
            if index == 21:
                empty, receipt = self.validate_prefix(2)
                prior_facts = contract.validate_receipt(receipt['receipt'], empty['intent'], empty['sha256'],
                                                        timestamp(receipt['receipt']['created_at']))
                if any(etcd[k] != prior_facts['etcd'][k] for k in ('cluster_id', 'member_id', 'member_ids')):
                    raise ValueError('bootstrap etcd identity changed after empty acceptance')
                core = facts['core']
                if core is None or core['readable'] is not True or core['runtime_sha256'] != self.plan['render']['safe_core_sha256']:
                    raise ValueError('bootstrap core unavailable or binary changed')
                want = [{k: row[k] for k in ('node', 'podname', 'endpoint', 'resource_capacity', 'labels')} |
                        {'available': True, 'bypass': False} for row in self.plan['render']['workers']]
                if plan_digest(facts['workers']) != plan_digest(want):
                    raise ValueError('bootstrap workers differ from exact reviewed set')
        return facts

    def validate_receipt(self, intent, receipt, auth):
        record = receipt['receipt']
        path = _path(self.plan['run_id'], intent['intent']['action']['step_index']) + '/intent.json'
        if record['intent_ref'] != {'path': path, 'sha256': self.files.read(path)[2]}:
            raise ValueError('bootstrap receipt raw intent differs')
        _raw_ref(self.files, record['intent_ref'])
        index = intent['intent']['action']['step_index']
        completed = timestamp(record['created_at'])
        if not timestamp(intent['intent']['created_at']) <= completed <= _time(self.now):
            raise ValueError('bootstrap receipt chronology differs')
        contract.validate_receipt(record, intent['intent'], intent['sha256'], completed)
        self.facts(index, record['observation'], intent_sha=intent['sha256'],
                   since=intent['intent']['created_at'], now=completed)
        if index not in contract.ACCEPTANCE:
            provenance = record['observation']['provenance']
            # Recovery time never extends the original action's writer interval.
            for key in ('started_at', 'completed_at'):
                contract.authorization(auth, intent['intent']['action'], timestamp(provenance[key]))
        if not timestamp(record['observation']['observed_at']) <= timestamp(record['network']['observed_at']) <= completed:
            raise ValueError('bootstrap post-action network chronology differs')
        self.network_valid(record['network'], index, completed, after=True)
        if index != 21:
            if record['agents'] != [] or record['timing'] is not None:
                raise ValueError('unexpected bootstrap final evidence')
        else:
            self.agents(record['agents'], completed)
            if record['timing'] != self.timing(record['observation']['observed_at']):
                raise ValueError('bootstrap timing differs')

    def agents(self, observations, now):
        if type(observations) is not list or len(observations) != 3:
            raise ValueError('bootstrap requires three current agent observations')
        for observed, index in zip(observations, (9, 14, 19)):
            intent, receipt = self.validate_prefix(index)
            current = self.facts(index, observed, intent_sha=intent['sha256'],
                                  since=intent['intent']['created_at'], now=now)
            old = contract.validate_receipt(receipt['receipt'], intent['intent'], intent['sha256'],
                                             timestamp(receipt['receipt']['created_at']))
            if current['agent'] is None or current['agent'] != old['agent']:
                raise ValueError('bootstrap current agent incarnation differs')

    def timing(self, observed_at):
        first, receipt = self.validate_prefix(0)
        start = receipt['receipt']['observation']['provenance']['started_at']
        elapsed = (timestamp(observed_at)-timestamp(start)).total_seconds()
        if elapsed < 0:
            raise ValueError('bootstrap timing is negative')
        return {'installation_started_at': start, 'ready_at': observed_at, 'wall_seconds': elapsed,
                'candidate_seconds': 1800, 'within_candidate': elapsed <= 1800,
                'provider_queue_seconds': None, 'monotonic_seconds': None}

    def final(self, network=None, index=None, *, after=False):
        record = self.plan
        rebuilt = self.derive(record['plan_id'], record['plan_sha256'], record['network_receipt_sha256'],
                              record['input'], record['created_at'])
        # derive has also read each journal authorization, which is deliberately
        # outside immutable preparation dependencies; compare the original subset.
        rebuilt['dependencies'] = record['dependencies']
        if plan_digest(rebuilt) != self.digest:
            raise ValueError('bootstrap derivation changed at action boundary')
        for ref in record['dependencies']:
            _raw_ref(self.files, ref)
        self.files.recheck()
        self.publications.check()
        if pending_generation.inspect(self.project) != self.pending:
            raise ValueError('bootstrap pending reservation changed')
        authority.check_current()
        current = _time(self.now)
        if network is not None:
            self.network_valid(network, index, current, after=after)
        if timestamp(record['created_at']) > current:
            raise ValueError('bootstrap plan is future')

    def publish(self, fd, path, filename, envelope):
        raw = _publish(self.files, fd, filename, envelope)
        parts = self.files.parts(path)
        pinned, names = self.publications.directories[parts]
        self.publications.directories[parts] = (pinned, sorted(names + [filename]))
        if self.files.binding({'path': path + '/' + filename, 'sha256': raw}) != envelope:
            raise ValueError('bootstrap publication changed')

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
                raise ValueError('bootstrap claim changed')
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
    value = {**base, 'status': 'uncertain', 'intent_sha256': intent['sha256'], 'stage': contract.stage(index)}
    if receipt is not None:
        value.update(status='bootstrap-step-complete', receipt_sha256=receipt['sha256'])
        if index in contract.ACCEPTANCE:
            value.update(status=contract.stage(index), stage_accepted=True,
                         next_stage='cluster-bootstrapped' if index == 2 else 'apps-replayed')
    return value


@authority.operation
def prepare_bootstrap(project, plan_id, plan_sha, network_receipt_sha, input_file, input_sha,
                      *, now=None, source_state=None):
    identifier(plan_id)
    for value in (plan_sha, network_receipt_sha, input_sha):
        sha256(value)
    base, session, fd = _summary(None), None, None
    try:
        _require_current()
        session = _Session(project, now, source_state)
        ref = {'path': str(input_file), 'sha256': input_sha}
        record = session.derive(plan_id, plan_sha, network_receipt_sha, ref, _time(now).isoformat())
        run = base['id'] = record['run_id']
        digest = plan_digest(record)
        try:
            existing, _, _ = session.files.json(_path(run) + '/plan.json')
        except FileNotFoundError:
            pass
        else:
            record['created_at'] = existing['plan']['created_at']
            digest = plan_digest(record)
            session.load_plan(run, digest)
            session.final()
            return {**base, 'status': 'bootstrap-planned', 'bootstrap_sha256': digest, 'sha256': digest, 'step_count': len(contract.STEPS)}
        session.plan, session.digest = record, digest
        session.final()
        fd = session.claim(_path(run))
        session.publish(fd, _path(run), 'plan.json', {'plan': record, 'sha256': digest})
        session.final()
        return {**base, 'status': 'bootstrap-planned', 'bootstrap_sha256': digest, 'sha256': digest, 'step_count': len(contract.STEPS)}
    except BaseException as error:
        if fd is not None:
            _poison(fd)
        if not isinstance(error, ERRORS):
            raise
        return base
    finally:
        if fd is not None:
            os.close(fd)
        if session is not None:
            session.close()


def _seal(session, fd, intent, observed, network, observer, recovered):
    index = intent['intent']['action']['step_index']
    agents = []
    if index == 21:
        for agent_index in (9, 14, 19):
            old, _ = session.validate_prefix(agent_index)
            agents.append(copy.deepcopy(observer.observe(copy.deepcopy(old['intent']['action']))))
        session.agents(agents, _time(session.now))
    record = {'schema_version': 1, 'operation': 'fresh-bootstrap-receipt',
              'intent_sha256': intent['sha256'], 'observation': observed,
              'created_at': _time(session.now).isoformat(), 'recovered': recovered,
              'network': network, 'agents': agents,
              'intent_ref': {'path': _path(session.plan['run_id'], index) + '/intent.json',
                             'sha256': session.files.read(_path(session.plan['run_id'], index) + '/intent.json')[2]},
              'timing': session.timing(observed['observed_at']) if index == 21 else None}
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
        raise ValueError('bootstrap receipt already published')
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
def execute_bootstrap(project, run_id, bootstrap_sha, step_index, authorization_file, authorization_sha,
                      adapter, collector=None, *, now=None, source_state=None):
    identifier(run_id)
    sha256(bootstrap_sha)
    sha256(authorization_sha)
    index = contract.step_index(step_index)
    base, session, fd = _summary(run_id, index), None, None
    try:
        _require_current()
        session = _Session(project, now, source_state)
        session.load_plan(run_id, bootstrap_sha)
        expected = contract.action(session.plan, bootstrap_sha, index)
        ref = {'path': str(authorization_file), 'sha256': authorization_sha}
        auth = session.files.binding(ref)
        contract.authorization(auth, expected, _time(now))
        names = session.slots(missing=True)
        if 'step-' + str(index) in names:
            intent, receipt = session.slot(index)
            if intent['intent']['authorization'] != ref:
                raise ValueError('bootstrap existing intent authorization differs')
            session.final()
            return _success(base, intent, receipt)
        previous = session.plan['network_receipt_sha256']
        if index:
            _, prior = session.validate_prefix(index-1)
            if prior is None:
                raise ValueError('bootstrap predecessor uncertain')
            previous = prior['sha256']
        network = session.collect(collector, index)
        observed_start = _time(now)
        before = copy.deepcopy(adapter.observe(copy.deepcopy(expected)))
        if timestamp(before['observed_at']) < observed_start:
            raise ValueError('bootstrap host evidence predates this observation')
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
        if index not in contract.ACCEPTANCE:
            base['dispatch_attempted'] = True
            base['remote_mutation_performed'] = None
            try:
                adapter.dispatch(copy.deepcopy(expected), intent['sha256'])
            except Exception:
                return _success(base, intent)
        try:
            observed = copy.deepcopy(adapter.observe(copy.deepcopy(expected)))
            session.facts(index, observed, intent_sha=intent['sha256'], since=record['created_at'])
            network = session.collect(collector, index, after=True)
        except Exception:
            return _success(base, intent)
        receipt = _seal(session, fd, intent, observed, network, adapter, False)
        return _success({**base, 'current_network_ready': True}, intent, receipt)
    except BaseException as error:
        if fd is not None and (session.receipt_owned or not base['dispatch_attempted'] and index not in contract.ACCEPTANCE):
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
def reconcile_bootstrap(project, run_id, step_index, expected_intent_sha, observer, collector=None,
                        *, now=None, source_state=None):
    identifier(run_id)
    sha256(expected_intent_sha)
    index = contract.step_index(step_index)
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


def inspect_bootstrap(project, run_id, bootstrap_sha, *, now=None, source_state=None):
    """Local historical integrity only; never gathers probes or grants readiness."""
    identifier(run_id)
    sha256(bootstrap_sha)
    base, session = _summary(run_id), None
    try:
        session = _Session(project, now, source_state)
        session.load_plan(run_id, bootstrap_sha)
        names = session.slots(missing=True)
        completed, uncertain = 0, False
        for index in range(len(names)):
            _, receipt = session.slot(index)
            if receipt is None:
                if index != len(names)-1:
                    raise ValueError('bootstrap continued after uncertain action')
                uncertain = True
            else:
                completed += 1
        session.final()
        return {**base, 'status': 'uncertain' if uncertain else 'historically-valid',
                'bootstrap_sha256': bootstrap_sha, 'historical_integrity': True,
                'journal_receipt_count': completed, 'uncertain': uncertain,
                'next_stage': 'apps-replayed' if completed == len(contract.STEPS) else
                    'cluster-bootstrapped' if completed >= 3 else 'empty-control-plane'}
    except ERRORS:
        return base
    finally:
        if session is not None:
            session.close()

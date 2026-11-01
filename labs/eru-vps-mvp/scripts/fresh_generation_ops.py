"""Local generation commit, immutable evidence, and verified barrier completion.

No provider, SSH or cluster command can be dispatched here. Recovery observes;
only explicit finalize writes the remaining exact local prefix.
"""
import base64
from contextlib import contextmanager
import os
from pathlib import Path

import fresh_generation as contract
from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import PrivateFiles, _decode, _safe, _identity
from fresh_observation_ops import _publish, _raw
from fresh_rebuild import plan_digest, ACCEPTANCE_CHECKS
import fresh_run_authority as authority
import pending_generation as pending

AREA = 'private/operations/fresh-rebuild/generation'
ACCEPTED = 'private/operations/fresh-rebuild/accepted-runs'
LIMIT = 128 * 1024 * 1024
ERRORS = (ValueError, RuntimeError, OSError, KeyError, TypeError, AttributeError, IndexError)


def _path(run, name):
    return AREA + '/' + identifier(run) + '/' + name + '.json'


def _ref(files, path):
    raw, relative, digest = files.read(path)
    return {'path': relative, 'sha256': digest}


def _raw_ref(files, ref):
    exact(ref, {'path', 'sha256'})
    raw, path, digest = files.read(ref['path'])
    if ref != {'path': path, 'sha256': digest} or not raw:
        raise ValueError('generation evidence raw binding differs')
    return raw


def _envelope(files, run, name):
    value, path, digest = files.json(_path(run, name))
    exact(value, {name, 'sha256'})
    if value['sha256'] != plan_digest(value[name]):
        raise ValueError('generation envelope digest differs')
    return value[name], value['sha256'], {'path': path, 'sha256': digest}


def _publish_once(files, path, value):
    parts = files.parts(path)
    fd = files.directory(parts[:-1], create=True)
    try:
        try:
            existing = files.read(path)[0]
        except FileNotFoundError:
            pass
        else:
            if existing != _raw(value):
                raise ValueError('immutable generation record differs')
            return _ref(files, path)
        _publish(files, fd, parts[-1], value)
        return _ref(files, path)
    finally:
        os.close(fd)


def _seal(files, run, name, value):
    return _publish_once(files, _path(run, name), {name: value, 'sha256': plan_digest(value)})


def _summary(run):
    return {'status': 'blocked', 'id': run, 'stage_accepted': False,
        'generation_changed': False, 'remote_mutation_performed': False,
        'dispatch_attempted': False, 'current_network_ready': False}


def _binding(acceptance):
    review = acceptance['context']['review']['plan']
    return {**{k: acceptance[k] for k in ('run_id', 'execution_sha256', 'pending_sha256', 'replay_sha256')},
            'scope_sha256': review['scope']['scope_sha256']}


def _timing(files, acceptance, input_ref, now=None):
    """Derive durations from owner-reviewed raw console events and clock ticks.

    These are manual owner attestations, not independent machine attestation.
    The original preparation renewal binds every raw source through the input.
    """
    document = files.binding(input_ref)
    exact(document, {'schema_version', 'operation', 'binding', 'timing', 'proofs'})
    if (type(document['schema_version']) is not int or document['schema_version'] != 1
            or document['operation'] != 'fresh-generation-timing' or document['binding'] != _binding(acceptance)):
        raise ValueError('generation timing binding differs')
    if type(document['proofs']) is not list or len(document['proofs']) != 1:
        raise ValueError('generation timing requires one complete raw observation proof')
    observation = files.binding(document['proofs'][0])
    exact(observation, {'schema_version','operation','binding','timing','source','owner_confirmed',
                       'reviewed_at','console_queues','clock_intervals'})
    current = authority.current_time(now)
    if (type(observation['schema_version']) is not int or observation['schema_version'] != 1
            or observation['operation'] != 'fresh-generation-timing-observation'
            or observation['binding'] != document['binding'] or observation['timing'] != document['timing']
            or observation['source'] != 'manual-console-owner-review' or observation['owner_confirmed'] is not True):
        raise ValueError('generation requires explicit owner-reviewed manual timing sources')
    measured = document['timing']; timing = acceptance['timing']
    execution = acceptance['context']['execution']['execution']
    fence = files.binding(execution['evidence']['writer_fence'])
    expected = {'installation_started_at': timing['bootstrap']['installation_started_at'],
        'v01_completed_at': timing['bootstrap']['ready_at'],
        'residue_completed_at': timing['residue_completed_at']}
    if any(measured[k] != v for k,v in expected.items()):
        raise ValueError('generation timing differs from verified stage observations')
    if not (timestamp(measured['quiesced_at']) <= timestamp(fence['observed_at']) <= timestamp(measured['installation_started_at'])
            and timestamp(measured['residue_completed_at']) <= timestamp(observation['reviewed_at']) <= current):
        raise ValueError('generation timing chronology or review is invalid')
    source_refs = {ref['path']:ref for ref in acceptance['evidence_refs']}
    queues = observation['console_queues']
    if type(queues) is not list or len(queues) != 4:
        raise ValueError('generation timing requires four exact console observations')
    intervals = []; used = set(); console_ids = set()
    from fresh_rebuild import TOPOLOGY
    for queue_ref,(alias,node,role) in zip(queues,TOPOLOGY):
        queue = files.binding(queue_ref)
        exact(queue, {'schema_version','operation','binding','alias','node','action','receipt',
                      'provider_console_action_ref','requested_at','started_at','owner_confirmed'})
        if (type(queue['schema_version']) is not int or queue['schema_version'] != 1
                or queue['operation'] != 'fresh-generation-console-queue' or queue['binding'] != document['binding']
                or queue['alias'] != alias or queue['node'] != node or queue['owner_confirmed'] is not True):
            raise ValueError('generation console queue observation identity differs')
        for ref in (queue['action'],queue['receipt']):
            exact(ref,{'path','sha256'})
            if source_refs.get(ref['path']) != {**ref,'kind':'json'} or ref['path'] in used:
                raise ValueError('generation queue source was not semantically accepted')
            used.add(ref['path'])
        action = files.binding(queue['action']); receipt = files.binding(queue['receipt'])
        console_id = queue['provider_console_action_ref']
        if (type(console_id) is not str or not 0 < len(console_id) <= 512 or console_id in console_ids
                or action.get('kind') != 'fresh-console-action' or receipt.get('kind') != 'fresh-console-receipt'
                or action.get('provider_api_used') is not False or receipt.get('provider_api_used') is not False
                or action.get('owner_confirmed') is not True or receipt.get('owner_confirmed') is not True
                or action['target'].get('alias') != alias or action['target'].get('node') != node
                or action['target'] != receipt['target'] or action['binding'] != receipt['binding']
                or action['provider_console_action_ref'] != console_id or receipt['provider_console_action_ref'] != console_id
                or receipt['action'] != queue['action']):
            raise ValueError('generation queue does not bind original manual console action and receipt')
        console_ids.add(console_id)
        start,end = timestamp(queue['requested_at']),timestamp(queue['started_at'])
        if not (timestamp(action['created_at']) <= start <= end <= timestamp(receipt['console_completed_at'])
                and timestamp(measured['quiesced_at']) <= start
                and end <= timestamp(measured['installation_started_at'])):
            raise ValueError('generation queue event outside exact original console interval')
        if start != end:
            intervals.append({'started_at':queue['requested_at'],'completed_at':queue['started_at']})
    if measured['provider_queue_intervals'] != intervals or measured['no_queue_observed'] is not (not intervals):
        raise ValueError('generation queue summary differs from four raw observations')
    clock_refs = observation['clock_intervals']; exact(clock_refs,{'total','installation'})
    identity = None; clocks = {}
    for kind,start_key,end_key,duration_key in (
            ('total','quiesced_at','residue_completed_at','total_monotonic_seconds'),
            ('installation','installation_started_at','v01_completed_at','installation_monotonic_seconds')):
        clock = files.binding(clock_refs[kind])
        exact(clock, {'schema_version','operation','binding','kind','observer','clock_id','started_at',
                      'completed_at','started_monotonic_ns','completed_monotonic_ns'})
        if (type(clock['schema_version']) is not int or clock['schema_version'] != 1
                or clock['operation'] != 'fresh-generation-clock-interval' or clock['binding'] != document['binding']
                or clock['kind'] != kind or clock['started_at'] != measured[start_key]
                or clock['completed_at'] != measured[end_key]):
            raise ValueError('generation raw clock binding or endpoints differ')
        observed_identity = (identifier(clock['observer']),identifier(clock['clock_id']))
        if identity is not None and identity != observed_identity:
            raise ValueError('generation timing crosses observer or clock identity')
        identity = observed_identity
        clocks[kind] = clock
        start,end = clock['started_monotonic_ns'],clock['completed_monotonic_ns']
        if (type(start) is not int or type(end) is not int or not 0 <= start <= end < 2**63
                or type(measured[duration_key]) not in (int,float) or measured[duration_key] != (end-start)/1_000_000_000):
            raise ValueError('generation duration was not derived from raw monotonic ticks')
    total,install = clocks['total'],clocks['installation']
    if not (total['started_monotonic_ns'] <= install['started_monotonic_ns']
            <= install['completed_monotonic_ns'] <= total['completed_monotonic_ns']):
        raise ValueError('generation intervals disagree on the same monotonic clock')
    for endpoint in ('started','completed'):
        wall = (timestamp(install[endpoint+'_at'])-timestamp(total['started_at'])).total_seconds()
        monotonic = (install[endpoint+'_monotonic_ns']-total['started_monotonic_ns'])/1_000_000_000
        if abs(wall-monotonic)>1:
            raise ValueError('generation same-clock wall/tick origin differs')
    return contract.measured_timing(measured), document


def _prepare_review(files, ref, index, acceptance):
    review = files.binding(ref)
    exact(review, {'schema_version','kind','authority','approved','owner_confirmed','binding','target',
                  'admission_request','issued_at','expires_at','manual_authorizations','writer_fence'})
    target = {'run_id':index['run_id'],'replay_sha':index['binding']['replay_sha256'],
              'input_file':index['timing_input']['path'],'input_sha':index['timing_input']['sha256']}
    network = acceptance['context']['network']
    binding = {'run_id':index['run_id'],'execution_sha256':index['binding']['execution_sha256'],
        'pending_sha256':index['binding']['pending_sha256'],'plan_id':network['plan']['id'],
        'plan_sha256':network['sha256'],'operation':'prepare_generation','target_sha256':plan_digest(target)}
    start,end = timestamp(review['issued_at']),timestamp(review['expires_at'])
    prepared = timestamp(index['created_at'])
    if (type(review['schema_version']) is not int or review['schema_version'] != 1
            or review['kind'] != 'fresh-run-step-renewal' or review['authority'] != 'owner'
            or review['approved'] is not True or review['owner_confirmed'] is not True
            or review['binding'] != binding or review['target'] != target
            or not start <= prepared < end or not 0 < (end-start).total_seconds() <= 900
            or type(review['manual_authorizations']) is not list
            or (review['admission_request'] is None) == (review['writer_fence'] is None)):
        raise ValueError('generation original prepare owner renewal differs or was expired')
    return review


def _acceptance(project, run, digest, now, source_state):
    from fresh_replay_ops import load_acceptance
    value = load_acceptance(project, run, digest, now=now, source_state=source_state)
    if (type(value) is not dict or value.get('schema_version') != 1
            or value.get('operation') != 'fresh-replay-acceptance-evidence'
            or value.get('run_id') != run or value.get('replay_sha256') != digest
            or set(value.get('checks', {})) != ACCEPTANCE_CHECKS):
        raise ValueError('generation requires verified complete replay acceptance')
    for refs in value['checks'].values():
        if type(refs) is not list or not refs or any(type(ref) is not dict or set(ref) != {'path','sha256','kind'}
                or ref['kind'] != 'json' for ref in refs):
            raise ValueError('generation requires gate receipts, never caller PASS or counts')
    return value


def _evidence(files, acceptance, extra):
    refs = {}
    for ref in acceptance['evidence_refs']:
        exact(ref, {'path', 'sha256', 'kind'})
        if ref['kind'] not in ('json', 'raw') or ref['path'] in refs:
            raise ValueError('generation evidence types/duplicates invalid')
        _raw_ref(files, {k: ref[k] for k in ('path','sha256')})
        if ref['kind'] == 'json':
            _decode(files.read(ref['path'])[0])
        refs[ref['path']] = ref
    visited = set()
    def include(path, expected=None):
        raw, relative, digest = files.read(path)
        if expected is not None and expected != {'path':relative,'sha256':digest}:
            raise ValueError('generation transitive raw reference differs')
        if relative in visited:
            return
        visited.add(relative)
        try:
            value = _decode(raw); kind = 'json'
        except ValueError:
            value = None; kind = 'raw'
        row = {'path':relative,'sha256':digest,'kind':kind}
        if relative in refs and refs[relative] != row:
            raise ValueError('generation transitive evidence type or digest differs')
        refs[relative] = row
        def visit(value):
            if type(value) is dict:
                if {'path','sha256'} <= set(value) and type(value['path']) is str and value['path'].startswith('private/'):
                    include(value['path'],{k:value[k] for k in ('path','sha256')})
                else:
                    for child in value.values(): visit(child)
            elif type(value) is list:
                for child in value: visit(child)
        visit(value)
    for path in extra:
        include(path)
    for paths in acceptance['checks'].values():
        if any(refs.get(ref['path']) != ref for ref in paths):
            raise ValueError('generation gate missing from complete evidence index')
    return [refs[p] for p in sorted(refs) if p not in contract.PATHS]


def _writes(before, after):
    return [{'path': p, 'before_base64': base64.b64encode(before[p]).decode(),
        'before_sha256': contract.sha(before[p]), 'after_base64': base64.b64encode(after[p]).decode(),
        'after_sha256': contract.sha(after[p])} for p in contract.PATHS]


def _prepared(index_ref, index, rto):
    return {'schema_version': 1, 'operation': 'fresh-generation-prepared', 'run_id': index['run_id'],
        'index': index_ref, 'binding': index['binding'], 'rto': rto, 'created_at': index['created_at'],
        'candidate_comparison': {'total_within_candidate': rto['total_seconds'] <= 1800,
                                 'installation_within_candidate': rto['installation_seconds'] <= 1800}}


def _intent(prepared_ref, index, writes):
    return {'schema_version': 1, 'operation': 'fresh-generation-commit-intent', 'run_id': index['run_id'],
        'prepared': prepared_ref, 'binding': index['binding'], 'private_identity': index['private_identity'],
        'writes': writes, 'created_at': index['created_at']}


def _assert_current(project):
    step = authority.active()
    from fresh_run_lock import FreshRunLock
    if step is None or step.historical or not isinstance(step.lock, FreshRunLock) or step.lock.project.absolute() != Path(project).absolute():
        raise ValueError('generation requires exact owned lock and current renewal')
    authority.check_current()
    return step


@authority.operation
def prepare_generation(project, run_id, replay_sha, input_file, input_sha, *, now=None, source_state=None):
    identifier(run_id); sha256(replay_sha); sha256(input_sha)
    result = _summary(run_id)
    files = None
    try:
        step = _assert_current(project)
        files = PrivateFiles(project, max_bytes=LIMIT)
        observed = pending.inspect(project)
        if observed['status'] != 'pending' or observed != step.pending:
            raise ValueError('generation reservation differs')
        acceptance = _acceptance(project, run_id, replay_sha, now, source_state)
        if acceptance['private_identity'] != files.identity or acceptance['pending_sha256'] != observed['sha256']:
            raise ValueError('generation replay root/reservation differs')
        rto, timing = _timing(files, acceptance, {'path':input_file, 'sha256':input_sha}, now)
        before = {p: files.read(p)[0] for p in contract.PATHS}
        after = contract.derive_after(acceptance['context'], before)
        created = authority.current_time(now).isoformat()
        try:
            existing, _, _ = _envelope(files, run_id, 'index')
            created = existing['created_at']
        except FileNotFoundError:
            pass
        evidence = _evidence(files, acceptance, [input_file,step.ref['path']])
        index = {'schema_version': 1, 'operation': 'fresh-generation-evidence-index', 'run_id':run_id,
            'binding': _binding(acceptance), 'private_identity': files.identity, 'pending': observed,
            'created_at': created, 'acceptance_sha256': plan_digest(acceptance),
            'context_sha256': plan_digest(acceptance['context']), 'checks': acceptance['checks'],
            'evidence_refs': evidence, 'timing_input': {'path':input_file, 'sha256':input_sha},
            'prepare_renewal':step.ref,
            'snapshots': [{'path':p, 'sha256':contract.sha(before[p]),
                'before_base64':base64.b64encode(before[p]).decode()} for p in contract.PATHS]}
        _prepare_review(files,step.ref,index,acceptance)
        files.recheck(); authority.check_current()
        index_ref = _seal(files, run_id, 'index', index)
        authority.check_current()
        prepared_ref = _seal(files, run_id, 'prepared', _prepared(index_ref, index, rto))
        intent = _intent(prepared_ref, index, _writes(before,after))
        authority.check_current()
        _seal(files, run_id, 'intent', intent)
        authority.check_current(); files.recheck()
        return {**result, 'status':'generation-prepared', 'generation_sha256':plan_digest(intent)}
    except ERRORS:
        return result
    finally:
        if files is not None:
            files.close()


def _load(files, run, generation_sha, now, source_state, *, historical=False):
    """Physical index closure first, then full historical semantic replay validation."""
    with contract._physical():
        directory = files.directory(files.parts(AREA + '/' + identifier(run)))
        try:
            if sorted(os.listdir(directory)) not in (['index.json','intent.json','prepared.json'],
                    ['commit.json','index.json','intent.json','prepared.json']):
                raise ValueError('generation journal has unknown or incomplete records')
        finally:
            os.close(directory)
        index, _, index_ref = _envelope(files, run, 'index')
        exact(index, {'schema_version','operation','run_id','binding','private_identity','pending','created_at',
            'acceptance_sha256','context_sha256','checks','evidence_refs','timing_input','prepare_renewal','snapshots'})
        if (type(index['schema_version']) is not int or index['schema_version'] != 1
                or index['operation'] != 'fresh-generation-evidence-index' or index['run_id'] != run
                or index['private_identity'] != files.identity or timestamp(index['created_at']) > authority.current_time(now)):
            raise ValueError('generation index identity differs')
        from fresh_run_lock import _snapshot
        _snapshot(index['pending'])
        b = index['pending']['reservation']['bindings']
        if (b['run_id'] != run or index['binding']['pending_sha256'] != index['pending']['sha256']
                or index['binding']['execution_sha256'] != b['execution_sha256']
                or index['pending']['reservation']['private_identity'] != files.identity):
            raise ValueError('generation original pending differs')
        snapshots = index['snapshots']
        if type(snapshots) is not list or [s.get('path') for s in snapshots] != list(contract.PATHS):
            raise ValueError('generation snapshot scope differs')
        before = {}
        for snapshot in snapshots:
            exact(snapshot, {'path','sha256','before_base64'})
            raw = contract.decode(snapshot['before_base64'])
            if contract.sha(raw) != snapshot['sha256'] or len(raw) > files.max_bytes:
                raise ValueError('generation snapshot bytes differ')
            _decode(raw)
            before[snapshot['path']] = raw
        refs = index['evidence_refs']
        if type(refs) is not list or [r.get('path') for r in refs] != sorted({r.get('path') for r in refs}):
            raise ValueError('generation evidence duplicate or unordered')
        for ref in refs:
            exact(ref, {'path','sha256','kind'})
            if ref['path'] in contract.PATHS or ref['kind'] not in ('raw','json'):
                raise ValueError('generation index evidence type differs')
            raw = _raw_ref(files, {k:ref[k] for k in ('path','sha256')})
            if ref['kind'] == 'json':
                _decode(raw)
        prepared, _, prepared_ref = _envelope(files, run, 'prepared')
        intent, digest, intent_ref = _envelope(files, run, 'intent')
        if digest != sha256(generation_sha):
            raise ValueError('generation intent digest differs')
        watched = {ref['path']:ref['sha256'] for ref in (index_ref,prepared_ref,intent_ref)}
        def check():
            with contract._physical():
                files.check()
                verify = PrivateFiles(files.project, max_bytes=LIMIT)
                try:
                    for path, wanted in watched.items():
                        if verify.read(path)[2] != wanted:
                            raise ValueError('generation sealed input drift')
                finally:
                    verify.close()
        with contract._historical(files.project, before, index['pending'], files.identity, check):
            acceptance = _acceptance(files.project, run, index['binding']['replay_sha256'], now, source_state)
            if (plan_digest(acceptance) != index['acceptance_sha256']
                    or plan_digest(acceptance['context']) != index['context_sha256']
                    or acceptance['checks'] != index['checks'] or _binding(acceptance) != index['binding']):
                raise ValueError('generation sealed acceptance semantic derivation differs')
            rto, timing = _timing(files, acceptance, index['timing_input'], timestamp(index['created_at']))
            _prepare_review(files,index['prepare_renewal'],index,acceptance)
            evidence = _evidence(files, acceptance,
                [index['timing_input']['path'],index['prepare_renewal']['path']])
            if evidence != refs:
                raise ValueError('generation index is not full exact evidence closure')
            after = contract.derive_after(acceptance['context'], before)
            if (prepared != _prepared(index_ref,index,rto)
                    or intent != _intent(prepared_ref,index,_writes(before,after))):
                raise ValueError('generation local write derivation differs')
        current = ({p:contract.sha(after[p]) for p in contract.PATHS} if historical else
                   {p: files.read(p)[2] for p in contract.PATHS})
        status, prefix = contract.classify(intent['writes'], current)
        for path in contract.PATHS:
            files.seen.pop(path, None)
        files.recheck()
        return {'index':index, 'index_ref':index_ref, 'prepared':prepared, 'prepared_ref':prepared_ref,
            'intent':intent, 'intent_ref':intent_ref, 'acceptance':acceptance, 'before':before,
            'after':after, 'check':check, 'status':status, 'prefix_length':prefix, 'current_hashes':current}


def _accepted(state):
    review = state['acceptance']['context']['review']; plan = review['plan']
    return {'schema_version':1, 'operation':'full-cluster-fresh-rebuild-acceptance','status':'accepted',
        'plan_id':plan['id'],'plan_sha256':review['sha256'],'cluster_id':'eru-vps-mvp',
        'generation':plan['generation_after'],'series_id':plan['series']['id'],'iteration':plan['series']['iteration'],
        'checks':{k:'passed' for k in sorted(ACCEPTANCE_CHECKS)}, 'rto':state['prepared']['rto'],
        'evidence_index_sha256':state['index_ref']['sha256']}


def _commit(state, created):
    return {'schema_version':1, 'operation':'fresh-generation-commit-receipt','run_id':state['index']['run_id'],
        'intent':state['intent_ref'],'index':state['index_ref'],'private_identity':state['index']['private_identity'],
        'after_hashes':{p:contract.sha(raw) for p,raw in state['after'].items()},'created_at':created,
        'sealing_seconds':(timestamp(created)-timestamp(state['index']['created_at'])).total_seconds()}


def _completion(state, commit_ref, acceptance_ref):
    return {'schema_version':1,'operation':'fresh-generation-barrier-completion',
        'run_id':state['index']['run_id'],'reservation_sha256':state['index']['pending']['sha256'],
        'generation_sha256':plan_digest(state['intent']),'index':state['index_ref'],
        'commit':commit_ref,'acceptance':acceptance_ref,'private_identity':state['index']['private_identity']}


def _seals(files, state, *, completion_required=False, pending_directory='pending-generation'):
    run = state['index']['run_id']
    accepted_path = ACCEPTED + '/' + state['acceptance']['context']['review']['plan']['id'] + '.json'
    completion_path = 'private/' + pending_directory + '/completion.json'
    has_commit = has_accepted = has_completion = False
    try:
        commit, _, commit_ref = _envelope(files, run, 'commit'); has_commit = True
    except FileNotFoundError:
        pass
    try:
        accepted, _, _ = files.json(accepted_path)
        acceptance_ref = _ref(files,accepted_path); has_accepted = True
    except FileNotFoundError:
        pass
    try:
        completion, _, _ = files.json(completion_path); has_completion = True
    except FileNotFoundError:
        pass
    if has_commit and (state['status'] != 'all-after' or commit != _commit(state,commit['created_at'])
            or commit['sealing_seconds'] < 0):
        raise ValueError('generation commit without exact all-after state')
    if has_accepted and (not has_commit or accepted != _accepted(state)):
        raise ValueError('generation accepted seal precedes/differs from commit')
    if has_completion and (not has_accepted or completion != _completion(state,commit_ref,acceptance_ref)):
        raise ValueError('generation completion precedes/differs from accepted seal')
    if completion_required and not has_completion:
        raise ValueError('generation barrier completion missing')
    return has_commit, has_accepted, has_completion



def _location(files, state):
    original = state['index']['pending']
    for directory in ('pending-generation', 'generation-history/' + original['sha256'] + '/pending-generation'):
        actual = pending._inspect_reservation(files.project,allow_completion=True,directory=directory)
        if actual == original:
            return actual,directory
    raise ValueError('generation retained reservation identity changed')


def verify_retained_completion(project, run_id, generation_sha, pending_directory, *,
                               current=False, now=None, source_state=None):
    """Deep historical proof at exactly the original retained directory inode."""
    with contract._physical():
        files = PrivateFiles(project,max_bytes=LIMIT)
        try:
            state = _load(files,run_id,generation_sha,now,source_state,historical=not current)
            original = state['index']['pending']
            if pending_directory not in ('pending-generation',
                    'generation-history/' + original['sha256'] + '/pending-generation'):
                raise ValueError('retained completion directory differs')
            actual = pending._inspect_reservation(project,allow_completion=True,directory=pending_directory)
            if actual != original:
                raise ValueError('retained completion reservation differs')
            _seals(files,state,completion_required=True,pending_directory=pending_directory)
            files.recheck()
            return {'original_pending':original,'generation_sha256':generation_sha,'status':'completed'}
        finally:
            files.close()


def _recheck_moved(files,state):
    actual,directory = _location(files,state)
    if directory != 'pending-generation':
        for path,wanted in list(files.seen.items()):
            if path.startswith('private/pending-generation/'):
                moved = 'private/' + directory + '/' + path.rsplit('/',1)[-1]
                if files.read(moved)[2] != wanted:
                    raise ValueError('retired generation bytes changed')
                files.seen.pop(path)
    files.recheck()

def _transition(files, state, expected_pending, now, source_state, *, completion=False):
    index = state['index']
    if expected_pending is not None and expected_pending != index['pending']:
        raise ValueError('generation transition original reservation differs')
    actual,directory = _location(files,state)
    seals = _seals(files,state,completion_required=completion,pending_directory=directory)
    status = 'completed' if seals[2] else state['status']
    retired = state.get('retired',False)
    claim_path = pending.HISTORY + '/' + actual['sha256']
    try:
        claim = files.directory(files.parts(claim_path))
    except FileNotFoundError:
        pass
    else:
        try:
            names = os.listdir(claim)
            if 'receipt.json' not in names or '.retirement-failed' in names:
                status = 'all-after'
            elif directory != 'pending-generation':
                pending._retirement(files,actual['sha256'],now=now,source_state=source_state)
                retired = True
        finally:
            os.close(claim)
    actual_status = pending._inspect_reservation(files.project,allow_completion=True) if retired else (
        {**actual,'status':'completed','blocked':False} if status == 'completed' else actual)
    return {'status':status,'retired':retired,'run_id':index['run_id'],'generation_sha256':plan_digest(state['intent']),
        'prefix_length':state['prefix_length'],'current_hashes':state['current_hashes'],
        'before_hashes':{p:contract.sha(v) for p,v in state['before'].items()},
        'after_hashes':{p:contract.sha(v) for p,v in state['after'].items()},
        'pending':actual_status,
        'original_pending':index['pending'],'private_identity':files.identity}



def _load_transition(files,run,generation_sha,now,source_state):
    index,_,_ = _envelope(files,run,'index')
    digest = sha256(index['pending']['sha256'])
    try:
        fd = files.directory(files.parts(pending.HISTORY+'/'+digest))
    except FileNotFoundError:
        retired = False
    else:
        try:
            names = os.listdir(fd)
            retired = 'receipt.json' in names and '.retirement-failed' not in names
        finally:
            os.close(fd)
    if retired:
        pending._retirement(files,digest,now=now,source_state=source_state)
    state = _load(files,run,generation_sha,now,source_state,historical=retired)
    state['retired'] = retired
    if retired:
        state['current_hashes'] = {p:files.read(p)[2] for p in contract.PATHS}
        for path in contract.PATHS:
            files.seen.pop(path,None)
    return state

def verify_transition(project, run_id, generation_sha, expected_pending, *, now=None, source_state=None):
    with contract._physical():
        files = PrivateFiles(project,max_bytes=LIMIT)
        try:
            state = _load_transition(files,run_id,generation_sha,now,source_state)
            result = _transition(files,state,expected_pending,now,source_state)
            files.recheck(); return result
        finally:
            files.close()


@contextmanager
def verified_history(project, run_id, generation_sha, expected_pending=None, *, now=None, source_state=None):
    with contract._physical():
        files = PrivateFiles(project,max_bytes=LIMIT)
        try:
            state = _load_transition(files,run_id,generation_sha,now,source_state)
            transition = _transition(files,state,expected_pending,now,source_state)
            with contract._historical(project,state['before'],state['index']['pending'],files.identity,state['check']):
                yield transition
            _recheck_moved(files,state)
        finally:
            files.close()


def inspect_generation(project, run_id, generation_sha, *, now=None, source_state=None):
    result = _summary(run_id)
    try:
        value = verify_transition(project,run_id,generation_sha,None,now=now,source_state=source_state)
        return {**result,'status':value['status'],'generation_sha256':generation_sha,
            'prefix_length':value['prefix_length'],'historical_integrity':True,'retired':value['retired'],
            'generation_committed':value['prefix_length']==3,
            'barrier_completed':value['status']=='completed'}
    except ERRORS:
        return result


def _replace(files, path, before_sha, raw):
    """Descriptor-relative compare-and-swap under the exact controller lock."""
    with contract._physical():
        parts = files.parts(path); parent = files.directory(parts[:-1])
        temporary = '.' + parts[-1] + '.fresh-generation.tmp'
        try:
            check = PrivateFiles(files.project,max_bytes=LIMIT)
            try:
                if check.read(path)[2] != before_sha:
                    raise ValueError('generation compare-and-swap before differs')
            finally:
                check.close()
            try:
                fd = os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600,dir_fd=parent)
            except FileExistsError:
                fd = os.open(temporary,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK,dir_fd=parent)
                try:
                    info = os.fstat(fd); _safe(info)
                    if info.st_size != len(raw) or os.read(fd,len(raw)+1) != raw:
                        raise ValueError('generation interrupted temporary bytes differ')
                finally:
                    os.close(fd)
            else:
                with os.fdopen(fd,'wb') as stream:
                    stream.write(raw); stream.flush(); os.fsync(stream.fileno())
            files.check()
            again = files.directory(parts[:-1])
            try:
                if _identity(os.fstat(again)) != _identity(os.fstat(parent)):
                    raise ValueError('generation write parent changed')
            finally:
                os.close(again)
            checked = PrivateFiles(files.project,max_bytes=LIMIT)
            try:
                if checked.read(path)[2] != before_sha:
                    raise ValueError('generation compare-and-swap changed before replace')
            finally:
                checked.close()
            os.replace(temporary,parts[-1],src_dir_fd=parent,dst_dir_fd=parent)
            os.fsync(parent); files.check()
        finally:
            os.close(parent)


@authority.operation
def finalize_generation(project, run_id, generation_sha, *, now=None, source_state=None):
    identifier(run_id); sha256(generation_sha)
    result = _summary(run_id); files = None
    try:
        step = _assert_current(project)
        with contract._physical():
            files = PrivateFiles(project,max_bytes=LIMIT)
            state = _load(files,run_id,generation_sha,now,source_state)
            _transition(files,state,step.pending,now,source_state)
            if state['index']['pending']['sha256'] in pending._history_names(files):
                authority.check_current()
                pending.retire_completed(project,step.lock.private_fd,now=now,source_state=source_state)
                step.lock.accept_completion(run_id,generation_sha,now=now,source_state=source_state)
                return {**result,'status':'completed','generation_sha256':generation_sha,
                    'generation_changed':True,'stage_accepted':True,'historical_integrity':True}
            for write in state['intent']['writes'][state['prefix_length']:]:
                state['check'](); step.lock.check_pending(); authority.check_current()
                _replace(files,write['path'],write['before_sha256'],contract.decode(write['after_base64']))
            state = _load(files,run_id,generation_sha,now,source_state)
            if state['status'] != 'all-after':
                raise ValueError('generation local commit is incomplete')
            try:
                commit, _, commit_ref = _envelope(files,run_id,'commit')
                if commit != _commit(state,commit['created_at']):
                    raise ValueError('generation existing commit differs')
            except FileNotFoundError:
                authority.check_current()
                commit_ref = _seal(files,run_id,'commit',_commit(state,authority.current_time(now).isoformat()))
            accepted_path = ACCEPTED + '/' + state['acceptance']['context']['review']['plan']['id'] + '.json'
            authority.check_current()
            accepted_ref = _publish_once(files,accepted_path,_accepted(state))
            authority.check_current()
            _publish_once(files,'private/pending-generation/completion.json',_completion(state,commit_ref,accepted_ref))
            _transition(files,state,step.pending,now,source_state,completion=True)
            files.recheck()
            step.lock.accept_completion(run_id,generation_sha,now=now,source_state=source_state)
            return {**result,'status':'completed','generation_sha256':generation_sha,
                'generation_changed':True,'stage_accepted':True,'historical_integrity':True}
    except ERRORS:
        return result
    finally:
        if files is not None:
            files.close()


def verify_completed(project, run_id, *, private_fd=None, now=None, source_state=None):
    with contract._physical():
        files = PrivateFiles(project,max_bytes=LIMIT)
        try:
            if private_fd is not None and _identity(os.fstat(private_fd)) != files.identity:
                raise ValueError('completion private descriptor differs')
            _,generation_sha,_ = _envelope(files,run_id,'intent')
            state = _load(files,run_id,generation_sha,now,source_state)
            result = _transition(files,state,None,now,source_state,completion=True)
            files.recheck(); return result
        finally:
            files.close()


def verify_accepted_lineage(project, acceptance_ref, *, now=None, source_state=None):
    """Validate immediate predecessor evidence/commit, including archived history."""
    with contract._physical():
        files = PrivateFiles(project,max_bytes=LIMIT)
        try:
            accepted = files.binding(acceptance_ref)
            if acceptance_ref['path'] != ACCEPTED + '/' + identifier(accepted['plan_id']) + '.json':
                raise ValueError('accepted lineage canonical path differs')
            parent = files.directory(files.parts(AREA))
            try:
                names = sorted(os.listdir(parent))
            finally:
                os.close(parent)
            matches = []
            for run in names:
                index, _, ref = _envelope(files,identifier(run),'index')
                if ref['sha256'] == accepted['evidence_index_sha256']:
                    matches.append(run)
            if len(matches) != 1:
                raise ValueError('accepted lineage evidence index is not unique')
            run = matches[0]; _, digest, _ = _envelope(files,run,'intent')
            state = _load(files,run,digest,now,source_state,historical=True)
            if accepted != _accepted(state):
                raise ValueError('accepted lineage schema/evidence differs')
            directory = 'pending-generation'
            original = pending._inspect_reservation(project,allow_completion=True)
            if original != state['index']['pending']:
                directory = 'generation-history/' + state['index']['pending']['sha256'] + '/pending-generation'
            reservation_path = 'private/' + directory + '/reservation.json'
            reservation = files.json(reservation_path)[0]
            if (reservation != state['index']['pending']['reservation']
                    or files.read(reservation_path)[2] != state['index']['pending']['sha256']):
                raise ValueError('accepted lineage retained reservation differs')
            _seals(files,state,completion_required=True,pending_directory=directory)
            files.recheck()
            return {'run_id':run,'generation_sha256':digest,'evidence_index_sha256':accepted['evidence_index_sha256'],
                    'generation':accepted['generation'],'historical_integrity':True}
        finally:
            files.close()

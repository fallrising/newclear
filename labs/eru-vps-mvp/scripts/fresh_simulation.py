"""Synthetic fresh journal coordinator; no production CLI or live adapters.

Simulation(root, review_envelope, bindings) pins caller-supplied synthetic facts
in an isolated RecordStore. execute(current_bindings) performs at most one built-in
fake action; reconcile(current_bindings) only observes the fake ledger. Neither
function operates hosts, reserves a real generation, or creates accepted-runs.
Every call revalidates the complete journal and current synthetic bindings.

This is a stage-level protocol simulation, not the executor: host substeps,
live freshness/fence verification, pending barriers, evidence files, local commit,
and real acceptance remain unimplemented. Hashes provide linkage, not signatures
or protection against an attacker replacing the entire simulation directory.
"""
from __future__ import annotations

import copy
from datetime import datetime
import hashlib
import json
import re

from fresh_rebuild import ALIASES, TOPOLOGY, plan_digest
from fresh_simulation_store import RecordStore, record_digest

STAGES = (
    'controller-ready', 'scope-reviewed', 'writers-quiesced',
    'generation-started', 'hosts-reimaged', 'network-and-access-ready',
    'empty-control-plane', 'cluster-bootstrapped', 'apps-replayed',
    'resources-accepted', 'residue-audited', 'generation-accepted',
)
_SHA = re.compile(r'[0-9a-f]{64}')


def _require(condition):
    if not condition:
        raise ValueError('invalid or changed synthetic simulation evidence')


def _sha(value):
    _require(isinstance(value, str) and _SHA.fullmatch(value) is not None)


def _same(left, right):
    # JSON comparison distinguishes true from 1 and rejects non-standard values.
    return record_digest({'value': left}) == record_digest({'value': right})


def _validate_review(envelope):
    try:
        _require(isinstance(envelope, dict) and set(envelope) == {'plan', 'sha256'})
        plan = envelope['plan']
        _require(isinstance(plan, dict) and set(plan) == {
            'schema_version', 'id', 'created_at', 'operation', 'mode', 'topology_profile',
            'series', 'campaign_sha256', 'cluster_id', 'generation_before', 'generation_after',
            'scope', 'bindings', 'fresh_policy', 'desired_apps', 'desired_apps_sha256',
            'stages', 'acceptance', 'decision', 'blockers', 'executable',
            'execution_implemented', 'remote_mutation_performed', 'checks_not_performed'})
        _require(envelope['sha256'] == plan_digest(plan))
        _require(type(plan['schema_version']) is int and plan['schema_version'] == 1)
        _require(plan['operation'] == 'full-cluster-fresh-rebuild-review-plan')
        _require(plan['mode'] == 'fresh' and plan['topology_profile'] == 'profile-a-four-host-basic')
        _require(plan['cluster_id'] == 'eru-vps-mvp')
        _require(isinstance(plan['id'], str) and re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_-]{0,95}', plan['id']))
        _require(plan['decision'] == 'reviewable' and plan['blockers'] == [])
        _require(all(plan[key] is False for key in (
            'executable', 'execution_implemented', 'remote_mutation_performed')))
        before, after = plan['generation_before'], plan['generation_after']
        _require(type(before) is int and before > 0 and type(after) is int and after == before + 1)
        stages = plan['stages']
        _require(isinstance(stages, list) and len(stages) == len(STAGES))
        for ordinal, (stage, name) in enumerate(zip(stages, STAGES)):
            _require(set(stage) == {'stage', 'implemented', 'executable', 'destructive',
                                   'host_scope', 'prerequisites', 'required_evidence', 'evidence_status'})
            _require(stage['stage'] == name and stage['implemented'] is False and stage['executable'] is False)
            _require(stage['destructive'] is (4 <= ordinal <= 9))
            _require(stage['host_scope'] == list(ALIASES))
            _require(stage['prerequisites'] == ([] if ordinal == 0 else [STAGES[ordinal - 1]]))
            _require(stage['evidence_status'] == 'checks_not_performed')
            _require(isinstance(stage['required_evidence'], list) and stage['required_evidence']
                     and all(isinstance(item, str) and item for item in stage['required_evidence']))
        scope = plan['scope']
        _require(set(scope) == {'hosts', 'host_count', 'volume_count', 'scope_sha256'})
        hosts = scope['hosts']
        _require(type(scope['host_count']) is int and scope['host_count'] == len(hosts) == 4)
        _require(scope['scope_sha256'] == plan_digest(hosts))
        resources, volumes, images, machines = set(), set(), set(), set()
        for host, (alias, node, role) in zip(hosts, TOPOLOGY):
            _require(set(host) == {'alias', 'node', 'role', 'inventory_ip', 'provider_api_used',
                                  'provider_resource_ref', 'os_image_ref', 'current_machine_id',
                                  'erase_scope', 'reviewed_at', 'source'})
            _require(host['current_machine_id'] not in machines)
            machines.add(host['current_machine_id'])
            _require(host['alias'] == alias and host['node'] == node and host['role'] == role)
            _require(host['provider_api_used'] is False)
            for key in ('provider_resource_ref', 'os_image_ref', 'current_machine_id', 'inventory_ip'):
                _require(isinstance(host[key], str) and bool(host[key]))
            _require(host['provider_resource_ref'] not in resources)
            resources.add(host['provider_resource_ref'])
            images.add(host['os_image_ref'])
            erase = host['erase_scope']
            _require(set(erase) == {'boot_volume_ref', 'additional_volume_refs'})
            _require(isinstance(erase['additional_volume_refs'], list))
            for volume in [erase['boot_volume_ref'], *erase['additional_volume_refs']]:
                _require(isinstance(volume, str) and bool(volume) and volume not in volumes)
                volumes.add(volume)
            _require(set(host['source']) == {'path', 'sha256'})
            _sha(host['source']['sha256'])
        _require(len(images) == 1 and type(scope['volume_count']) is int and scope['volume_count'] == len(volumes))
        bindings = plan['bindings']
        _require(set(bindings) == {'fresh_input', 'inventory', 'cluster_record', 'controller_report',
                                  'current_source', 'code_inputs_sha256', 'code_inputs',
                                  'artifacts_lock_sha256', 'upstream_lock_sha256',
                                  'core_validation_sha256', 'controller', 'writer_quiescence_review',
                                  'data_disposition_review', 'external_materials'})
        for key in ('fresh_input', 'inventory', 'cluster_record', 'controller_report'):
            _require(set(bindings[key]) == {'path', 'sha256'})
            _require(isinstance(bindings[key]['path'], str) and bool(bindings[key]['path']))
            _sha(bindings[key]['sha256'])
        for key in ('code_inputs_sha256', 'artifacts_lock_sha256', 'upstream_lock_sha256', 'core_validation_sha256'):
            _sha(bindings[key])
        code_hash = hashlib.sha256(json.dumps(bindings['code_inputs'], sort_keys=True,
                                              separators=(',', ':')).encode()).hexdigest()
        _require(code_hash == bindings['code_inputs_sha256'])
        controller = bindings['controller']
        source = bindings['current_source']
        _require(set(source) == {'commit', 'project_clean'} and source['project_clean'] is True)
        _require(isinstance(source['commit'], str) and re.fullmatch(r'[0-9a-f]{40}', source['commit']))
        _require(controller['source_commit'] == source['commit'] and controller['project_clean'] is True)
        _require(controller['ready_for_review'] is True and type(controller['reported_blocker_count']) is int
                 and controller['reported_blocker_count'] == 0)
        _require(controller['lock_digests'] == {
            'artifact_sha256': bindings['artifacts_lock_sha256'],
            'upstream_sha256': bindings['upstream_lock_sha256'],
            'core_validation_sha256': bindings['core_validation_sha256']})
        created = datetime.fromisoformat(plan['created_at'])
        checked = datetime.fromisoformat(controller['checked_at'])
        _require(created.tzinfo is not None and checked.tzinfo is not None
                 and 0 <= (created - checked).total_seconds() <= 86400)
        _require(bindings['writer_quiescence_review']['confirmed'] is True)
        _require(bindings['data_disposition_review']['confirmed_discardable'] is True)
        _require(set(bindings['external_materials']) == {
            'bootstrap_secrets', 'provider_console_access', 'external_evidence_store'})
        for material in bindings['external_materials'].values():
            _require(material['available'] is True)
            _sha(material['evidence_sha256'])
        policy = plan['fresh_policy']
        _require(policy['etcd_mode'] == 'new-empty' and policy['restore_source'] is None)
        for key in ('restore_allowed', 'existing_etcd_allowed', 'existing_runtime_authoritative', 'old_metadata_import_allowed'):
            _require(policy[key] is False)
        _sha(policy['prior_token_sha256'])
        _sha(policy['target_token_sha256'])
        _require(policy['prior_token_sha256'] != policy['target_token_sha256'])
        _require(plan['desired_apps'] and plan['desired_apps_sha256'] == plan_digest(plan['desired_apps']))
        campaign = {
            'topology_profile': plan['topology_profile'], 'source_commit': source['commit'],
            **{key: bindings[key] for key in ('artifacts_lock_sha256', 'upstream_lock_sha256', 'core_validation_sha256')},
            'host_scope': [{key: host[key] for key in ('alias', 'node', 'role', 'provider_resource_ref',
                                                     'os_image_ref', 'erase_scope')} for host in hosts],
            'desired_apps_sha256': plan['desired_apps_sha256'],
        }
        _require(plan['campaign_sha256'] == plan_digest(campaign))
    except (KeyError, TypeError, AttributeError, OverflowError) as exc:
        raise ValueError('malformed synthetic review envelope') from exc
    return plan


def synthetic_bindings(envelope):
    """Explicit fixture facts only; these are never live authorization/proof."""
    plan = _validate_review(envelope)
    return {
        'synthetic': True, 'review_sha256': envelope['sha256'],
        'plan_bindings_sha256': plan_digest(plan['bindings']),
        'scope_sha256': plan['scope']['scope_sha256'],
        'generation_before': plan['generation_before'], 'generation_after': plan['generation_after'],
        'authorization': {'synthetic': True, 'approved': True, 'review_sha256': envelope['sha256']},
        'fence': {'synthetic': True, 'active': True, 'in_flight': 0, 'controller_count': 1},
        'hosts': [{'synthetic': True, 'host_sha256': plan_digest(host),
                   'boot_sha256': plan_digest({'synthetic_boot': host['current_machine_id']})}
                  for host in plan['scope']['hosts']],
    }


def _evidence(intent, result='passed'):
    return {'synthetic': True, 'action_id': intent['action_id'],
            'bindings_sha256': intent['bindings_sha256'], 'result': result,
            'postcondition': 'complete' if result == 'passed' else 'incomplete'}


class SimulationAdapter:
    """Fixed in-memory fake; lost means fake completion followed by lost reply.

    observations is a synthetic test ledger, not a source of real host facts.
    A fresh adapter after process restart has no evidence until fixture data is
    explicitly supplied; absence is uncertain and never causes a second action.
    """
    def __init__(self, *, outcomes=None):
        self.outcomes = copy.deepcopy(outcomes or {})
        _require(isinstance(self.outcomes, dict) and set(self.outcomes) <= set(STAGES))
        _require(all(value in ('passed', 'failed', 'lost', 'absent') for value in self.outcomes.values()))
        self.mutation_calls = []
        self.observation_calls = []
        self.observations = {}

    def mutate(self, intent):
        self.mutation_calls.append(intent['action_id'])
        outcome = self.outcomes.get(intent['stage'], 'passed')
        evidence = _evidence(intent, 'failed' if outcome == 'failed' else 'passed')
        self.observations[intent['action_id']] = copy.deepcopy(evidence)
        if outcome == 'lost':
            raise RuntimeError('synthetic lost response')
        return None if outcome == 'absent' else evidence

    def observe(self, intent):
        self.observation_calls.append(intent['action_id'])
        return copy.deepcopy(self.observations.get(intent['action_id']))


class Simulation:
    def __init__(self, root, envelope, bindings, *, adapter=None):
        self.envelope = copy.deepcopy(envelope)
        self.bindings = copy.deepcopy(bindings)
        _require(_same(self.bindings, synthetic_bindings(self.envelope)))
        self.adapter = adapter if adapter is not None else SimulationAdapter()
        _require(type(self.adapter) is SimulationAdapter)
        self.store = RecordStore(root)
        self.execution = {'schema_version': 1, 'operation': 'fresh-simulation',
                          'synthetic': True, 'review': self.envelope, 'bindings': self.bindings}
        self.execution_sha = record_digest(self.execution)
        if not self.store.names():
            self.store.write_once('execution.json', self.execution)
        self._audit(bindings)

    def _intent(self, ordinal, predecessor):
        identity = {'execution_sha256': self.execution_sha, 'ordinal': ordinal,
                    'stage': STAGES[ordinal], 'predecessor_sha256': predecessor,
                    'bindings_sha256': record_digest(self.bindings)}
        return {'schema_version': 1, 'operation': 'fresh-simulation-intent',
                'synthetic': True, **identity, 'action_id': record_digest(identity)}

    def _receipt(self, intent, evidence, observation_sha=None):
        return {'schema_version': 1, 'operation': 'fresh-simulation-receipt',
                'synthetic': True, 'intent_sha256': record_digest(intent),
                'evidence': evidence, 'observation_sha256': observation_sha}

    def _observation(self, intent, evidence, ordinal, predecessor):
        return {'schema_version': 1, 'operation': 'fresh-simulation-observation',
                'synthetic': True, 'intent_sha256': record_digest(intent),
                'ordinal': ordinal, 'predecessor_sha256': predecessor, 'evidence': evidence}

    def _audit(self, current_bindings):
        _require(_same(self.bindings, synthetic_bindings(self.envelope)))
        _require(_same(current_bindings, self.bindings))
        _require(_same(self.store.read('execution.json'), self.execution))
        names = set(self.store.names())
        expected_names = {'execution.json'}
        predecessor = self.execution_sha
        state = None
        completed = 0
        for ordinal in range(len(STAGES)):
            intent = self._intent(ordinal, predecessor)
            intent_name = f'intent-{ordinal:03d}.json'
            if intent_name not in names:
                state = (ordinal, intent, None, [], predecessor)
                break
            expected_names.add(intent_name)
            _require(_same(self.store.read(intent_name), intent))
            observations = []
            observation_predecessor = record_digest(intent)
            while True:
                name = f'observation-{ordinal:03d}-{len(observations):03d}.json'
                if name not in names:
                    break
                _require(len(observations) < 1000)
                observed = self.store.read(name)
                _require(observed.get('evidence') is None or any(
                    _same(observed.get('evidence'), _evidence(intent, result))
                    for result in ('passed', 'failed')))
                expected = self._observation(intent, observed.get('evidence'), len(observations), observation_predecessor)
                _require(_same(observed, expected))
                # Incomplete evidence is retained, never promoted to completion.
                observation_predecessor = record_digest(observed)
                observations.append(observed)
                expected_names.add(name)
            receipt_name = f'receipt-{ordinal:03d}.json'
            if receipt_name not in names:
                state = (ordinal, intent, None, observations, observation_predecessor)
                break
            receipt = self.store.read(receipt_name)
            expected_names.add(receipt_name)
            evidence = receipt.get('evidence')
            _require(any(_same(evidence, _evidence(intent, result)) for result in ('passed', 'failed')))
            observation_sha = receipt.get('observation_sha256')
            if observation_sha is not None:
                _require(observations and observation_sha == record_digest(observations[-1]))
                _require(_same(observations[-1]['evidence'], _evidence(intent)))
                _require(_same(evidence, _evidence(intent)))
            else:
                _require(not observations)
            _require(_same(receipt, self._receipt(intent, evidence, observation_sha)))
            if evidence['result'] != 'passed':
                state = (ordinal, intent, receipt, observations, observation_predecessor)
                break
            completed += 1
            predecessor = record_digest(receipt)
        _require(names == expected_names)
        return completed, state

    def _summary(self, completed, status):
        return {'status': status, 'synthetic': True, 'completed_stages': completed,
                'execution_sha256': self.execution_sha, 'remote_mutation_performed': False,
                'accepted_run_created': False, 'generation_changed': False}

    def execute(self, current_bindings):
        completed, state = self._audit(current_bindings)
        if state is None:
            return self._summary(completed, 'simulation-complete')
        ordinal, intent, receipt, _, _ = state
        if receipt is not None:
            return self._summary(completed, 'failed')
        name = f'intent-{ordinal:03d}.json'
        if name in self.store.names():
            return self._summary(completed, 'uncertain')
        # Publication/fsync errors propagate; dispatch only after durable return.
        self.store.write_once(name, intent)
        self._audit(current_bindings)
        try:
            # Class dispatch prevents instance-level arbitrary callback injection.
            evidence = SimulationAdapter.mutate(self.adapter, copy.deepcopy(intent))
        except Exception:
            return self._summary(completed, 'uncertain')
        if evidence is None:
            return self._summary(completed, 'uncertain')
        _require(any(_same(evidence, _evidence(intent, result)) for result in ('passed', 'failed')))
        self.store.write_once(f'receipt-{ordinal:03d}.json', self._receipt(intent, evidence))
        completed, _ = self._audit(current_bindings)
        return self._summary(completed, 'simulation-complete' if completed == len(STAGES) else evidence['result'])

    def reconcile(self, current_bindings):
        completed, state = self._audit(current_bindings)
        if state is None:
            return self._summary(completed, 'simulation-complete')
        ordinal, intent, receipt, observations, predecessor = state
        if f'intent-{ordinal:03d}.json' not in self.store.names():
            return self._summary(completed, 'not-started')
        if receipt is not None:
            return self._summary(completed, 'failed')
        try:
            evidence = SimulationAdapter.observe(self.adapter, copy.deepcopy(intent))
        except Exception:
            evidence = None
        _require(len(observations) < 1000)
        if not any(_same(evidence, _evidence(intent, result)) for result in ('passed', 'failed')):
            evidence = None
        observation = self._observation(intent, evidence, len(observations), predecessor)
        observation_sha = self.store.write_once(
            f'observation-{ordinal:03d}-{len(observations):03d}.json', observation)
        if not _same(evidence, _evidence(intent)):
            return self._summary(completed, 'uncertain')
        self.store.write_once(f'receipt-{ordinal:03d}.json', self._receipt(intent, evidence, observation_sha))
        completed, _ = self._audit(current_bindings)
        return self._summary(completed, 'simulation-complete' if completed == len(STAGES) else 'observed-complete')

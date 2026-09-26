"""Reviewed exact-ID cleanup after a new app revision has passed readiness."""
import json
import re
from datetime import datetime, timezone
from pathlib import Path
import uuid

from app_desired import WORKERS, build_plan, canonical_bytes, sha256, snapshot_binding, spec_identity
from app_executor import PLAN_ID, UncertainExecution, _safe_revision_rows, plan_digest
from labops import ClusterLock, atomic_json

REMOTE_STAGES = {'remove_intent', 'verify_remove', 'verify_new_revision'}


def _now():
    return datetime.now(timezone.utc).isoformat()


class AppRevisionCleanup:
    """Plan and execute exact-ID cleanup after a completed app deploy journal."""

    def __init__(self, root, api):
        self.root = Path(root)
        self.api = api

    def journal_path(self, plan_id):
        if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
            raise ValueError('invalid app cleanup plan ID')
        return self.root / 'runs' / ('remove-' + plan_id + '.json')

    def _read_source(self, source_run_id):
        path = self.root / 'runs' / (source_run_id + '.json')
        if not path.exists() or path.is_symlink():
            raise FileNotFoundError('source app run journal missing')
        source = json.loads(path.read_text())
        if (source.get('status') != 'complete'
                or source.get('result') != 'revision_ready_old_revisions_retained'):
            raise ValueError('cleanup requires a completed ready app revision')
        normalized, digest, appname = spec_identity(source.get('spec'))
        if (source.get('logical_app') != normalized['name']
                or source.get('spec_sha256') != digest
                or source.get('appname') != appname):
            raise ValueError('source app journal identity mismatch')
        source_hash = source.get('plan_sha256')
        ids = source.get('observed_workload_ids')
        probes = source.get('probes')
        if (not isinstance(source_hash, str)
                or not re.fullmatch(r'[0-9a-f]{64}', source_hash)
                or not isinstance(ids, list)
                or any(not isinstance(workload_id, str) for workload_id in ids)
                or len(set(ids)) != len(ids)
                or len(ids) != normalized['replicas']
                or not isinstance(probes, list) or len(probes) != len(ids)
                or any(not isinstance(item, dict) or item.get('passed') is not True
                       for item in probes)
                or sorted(item.get('workload_id') for item in probes
                          if isinstance(item.get('workload_id'), str)) != sorted(ids)):
            raise ValueError('source app revision lacks complete HTTP readiness evidence')
        targets = source.get('older_owned_revisions')
        target_ids = source.get('older_owned_revisions_retained')
        if (not isinstance(targets, list) or not targets
                or not isinstance(target_ids, list)
                or any(not isinstance(workload_id, str) for workload_id in target_ids)
                or any(not isinstance(item, dict)
                       or set(item) != {'id', 'node', 'spec_sha256'}
                       or not isinstance(item.get('id'), str)
                       or not re.fullmatch(r'erumvp[0-9a-f]{12}_[A-Za-z0-9_-]+',
                                           item['id'])
                       or item.get('node') not in WORKERS
                       or not isinstance(item.get('spec_sha256'), str)
                       or not re.fullmatch(r'[0-9a-f]{64}', item['spec_sha256'])
                       or item['spec_sha256'] == digest for item in targets)
                or len({item['id'] for item in targets if isinstance(item, dict)})
                   != len(targets)
                or sorted(item['id'] for item in targets) != sorted(target_ids)):
            raise ValueError('source journal has no complete older revision identities')
        return source, normalized, digest, appname, targets

    def _preflight(self, snapshot):
        result = self.api.preflight(snapshot)
        if (not isinstance(result, dict) or result.get('health_ok') is not True
                or not isinstance(result.get('consistency_issues'), list)
                or result.get('consistency_issues')):
            return False, {
                'health_ok': isinstance(result, dict) and result.get('health_ok') is True,
                'consistency_issue_count': (
                    len(result['consistency_issues'])
                    if isinstance(result, dict)
                    and isinstance(result.get('consistency_issues'), list) else None),
            }
        return True, {'health_ok': True, 'consistency_issue_count': 0}

    def plan(self, source_run_id, plan_id=None):
        if not isinstance(source_run_id, str) or not PLAN_ID.fullmatch(source_run_id):
            raise ValueError('invalid source app run ID')
        source, spec, digest, appname, prior = self._read_source(source_run_id)
        snapshot = self.api.snapshot()
        clean, preflight_summary = self._preflight(snapshot)
        reviewed = build_plan(spec, snapshot)
        blockers = list(reviewed['blockers'])
        if not clean:
            blockers.append('live health/consistency preflight failed')
        if reviewed['action'] != 'no_op':
            blockers.append('new revision is not the exact current desired revision')
        source_ids = source['observed_workload_ids']
        current_ids = sorted(item['id'] for item in reviewed['current_revision'])
        if sorted(source_ids) != current_ids:
            blockers.append('new revision identity differs from the ready source run')
        prior_by_id = {item['id']: item for item in prior}
        remaining_targets = reviewed['older_owned_revisions']
        if (not remaining_targets
                or any(prior_by_id.get(item['id']) != item
                       for item in remaining_targets)):
            blockers.append('older revision ownership differs from the ready source run')

        plan_id = plan_id or (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
                              + uuid.uuid4().hex[:8])
        if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
            raise ValueError('invalid app cleanup plan ID')
        plan = {
            'schema_version': 1,
            'operation': 'app-remove-plan',
            'id': plan_id,
            'source_run_id': source_run_id,
            'source_plan_sha256': source.get('plan_sha256'),
            'logical_app': spec['name'],
            'appname': appname,
            'spec': spec,
            'spec_sha256': digest,
            'snapshot_sha256': reviewed['snapshot_sha256'],
            'snapshot': snapshot_binding(snapshot),
            'preflight': preflight_summary,
            'current_revision': reviewed['current_revision'],
            'targets': remaining_targets,
            'decision': 'blocked' if blockers else 'ready',
            'blockers': sorted(set(blockers)),
            'executable': not blockers,
            'steps': [
                'Recheck health, consistency, snapshot, and exact ready revision before removal',
                'Read each target by exact ID and verify owner, logical app, digest, and node',
                'Remove only the listed workload IDs; never remove by appname or label selector',
                'After each remove, reconcile exact target absence and cluster consistency',
                'Retain and re-probe the new desired revision',
            ],
        }
        plan['plan_sha256'] = plan_digest(plan)
        return plan

    def _source_matches_plan(self, plan):
        source, spec, digest, appname, targets = self._read_source(plan['source_run_id'])
        planned_targets = plan.get('targets')
        if (not isinstance(planned_targets, list)
                or len({item.get('id') for item in planned_targets
                        if isinstance(item, dict)}) != len(planned_targets)
                or any(item not in targets for item in planned_targets)):
            raise ValueError('cleanup plan target IDs are not a subset of the ready source run')
        if (source.get('plan_sha256') != plan.get('source_plan_sha256')
                or source['logical_app'] != plan.get('logical_app')
                or source['appname'] != plan.get('appname')
                or digest != plan.get('spec_sha256')
                or spec != plan.get('spec')
                or source['observed_workload_ids'] !=
                   sorted(item['id'] for item in plan.get('current_revision', []))):
            raise ValueError('ready source run differs from the reviewed cleanup plan')
        return source

    def _review_payload(self, plan):
        reviewed = build_plan(plan['spec'], plan['snapshot'])
        if (reviewed['action'] != 'no_op' or reviewed['blockers']
                or reviewed['snapshot_sha256'] != plan.get('snapshot_sha256')
                or reviewed['current_revision'] != plan.get('current_revision')
                or reviewed['older_owned_revisions'] != plan.get('targets')):
            raise ValueError('cleanup plan does not match exact reviewed app state')
        return reviewed

    @staticmethod
    def _target_matches(row, target, logical_app):
        if not isinstance(row, dict) or row.get('id') != target['id']:
            return False
        labels = row.get('labels')
        return (row.get('nodename') == target['node']
                and isinstance(labels, dict)
                and labels.get('owner') == 'eru-vps-mvp'
                and labels.get('logical_app') == logical_app
                and labels.get('spec_sha256') == target['spec_sha256'])

    def _ready_current_revision(self, plan):
        stub = {
            'appname': plan['appname'], 'logical_app': plan['logical_app'],
            'spec_sha256': plan['spec_sha256'], 'spec': plan['spec'],
        }
        rows = self.api.list_revision(plan['appname'])
        valid, reason, ids = _safe_revision_rows(rows, stub)
        if not valid or ids != sorted(item['id'] for item in plan['current_revision']):
            return False, reason or 'current_revision_identity_changed', []
        summaries = []
        for row in rows:
            result = self.api.probe(row, plan['spec'])
            if (not isinstance(result, dict) or isinstance(result.get('status'), bool)
                    or not isinstance(result.get('status'), int)
                    or not isinstance(result.get('body_match'), bool)):
                return False, 'malformed_probe_result', summaries
            passed = (result['status'] == plan['spec']['service']['expected_status']
                      and result['body_match'])
            summaries.append({'workload_id': row['id'], 'http_status': result['status'],
                              'body_match': result['body_match'], 'passed': passed})
            if not passed:
                return False, 'new_revision_http_readiness_failed', summaries
        return True, None, summaries

    def _save(self, path, journal):
        journal['updated_at'] = _now()
        atomic_json(path, journal)

    def _stage(self, path, journal, stage):
        journal['stage'] = stage
        journal.setdefault('events', []).append({'at': _now(), 'event': stage})
        self._save(path, journal)

    def execute(self, plan, expected_sha256):
        project = self.root.parents[2]
        with ClusterLock(project):
            return self._execute_locked(plan, expected_sha256)

    def _execute_locked(self, plan, expected_sha256):
        if not isinstance(plan, dict) or plan.get('plan_sha256') != plan_digest(plan):
            raise ValueError('cleanup plan hash mismatch')
        if expected_sha256 != plan['plan_sha256']:
            raise ValueError('cleanup plan hash mismatch')
        if (plan.get('operation') != 'app-remove-plan'
                or plan.get('executable') is not True
                or plan.get('blockers')):
            raise ValueError('cleanup plan is blocked or review-only')
        self._review_payload(plan)
        self._source_matches_plan(plan)
        journal_path = self.journal_path(plan.get('id'))
        if journal_path.exists() or journal_path.is_symlink():
            raise ValueError('cleanup plan already has a journal; reconcile and create a fresh plan')
        targets = plan['targets']
        journal = {
            'id': plan['id'], 'operation': 'app-remove', 'status': 'running',
            'stage': 'created', 'started_at': _now(), 'plan_sha256': plan['plan_sha256'],
            'source_run_id': plan['source_run_id'], 'source_plan_sha256': plan['source_plan_sha256'],
            'logical_app': plan['logical_app'], 'appname': plan['appname'],
            'spec_sha256': plan['spec_sha256'], 'targets': targets,
            'current_revision_ids': sorted(item['id'] for item in plan['current_revision']),
            'removed_ids': [], 'events': [],
        }
        self._save(journal_path, journal)
        try:
            self._stage(journal_path, journal, 'preflight')
            current = self.api.snapshot()
            clean, summary = self._preflight(current)
            journal['preflight_recheck'] = summary
            if not clean:
                journal.update(status='failed', reason='live_preflight_not_clean')
                self._save(journal_path, journal)
                raise ValueError('live preflight failed; no remove attempted')
            if sha256(canonical_bytes(snapshot_binding(current))) != plan['snapshot_sha256']:
                journal.update(status='failed', reason='cluster_snapshot_changed')
                self._save(journal_path, journal)
                raise ValueError('cluster snapshot changed; create a fresh cleanup plan')

            initial_ids = sorted(row['id'] for row in current['workloads']
                                 if isinstance(row, dict) and isinstance(row.get('id'), str))
            if len(initial_ids) != len(current['workloads']):
                journal.update(status='failed', reason='malformed_workload_snapshot')
                self._save(journal_path, journal)
                raise ValueError('malformed workload snapshot; no remove attempted')
            initial_workloads = snapshot_binding(current).get('workloads')
            if (not isinstance(initial_workloads, list)
                    or any(not isinstance(row, dict)
                           or not isinstance(row.get('id'), str)
                           for row in initial_workloads)
                    or sorted(row.get('id') for row in initial_workloads
                              if isinstance(row, dict)) != initial_ids):
                journal.update(status='failed', reason='malformed_workload_identity_snapshot')
                self._save(journal_path, journal)
                raise ValueError('malformed workload identity snapshot; no remove attempted')

            for target in targets:
                self._stage(journal_path, journal, 'verify_new_revision')
                ready, reason, probes = self._ready_current_revision(plan)
                journal['new_revision_probes'] = probes
                if not ready:
                    journal.update(status='needs_review' if journal['removed_ids'] else 'failed',
                                   reason=reason)
                    self._save(journal_path, journal)
                    raise RuntimeError('new revision is not ready; old revision retained')

                self._stage(journal_path, journal, 'verify_remove')
                row = self.api.get_workload(target['id'])
                if not self._target_matches(row, target, plan['logical_app']):
                    journal.update(status='needs_review' if journal['removed_ids'] else 'failed',
                                   reason='target_identity_changed')
                    self._save(journal_path, journal)
                    raise RuntimeError('exact cleanup target identity changed')
                self._stage(journal_path, journal, 'remove_intent')
                try:
                    self.api.remove_exact(target['id'])
                except Exception as remove_error:
                    try:
                        after_error = self.api.get_workload(target['id'])
                    except Exception as reconcile_error:
                        journal.update(status='uncertain',
                                       reason='remove_reply_and_reconcile_unavailable',
                                       remove_error_type=type(remove_error).__name__,
                                       reconcile_error_type=type(reconcile_error).__name__)
                        self._save(journal_path, journal)
                        raise UncertainExecution(
                            'remove reply and read-only reconciliation are unavailable') from None
                    if after_error is None:
                        journal['removed_ids'].append(target['id'])
                        journal.setdefault('events', []).append({
                            'at': _now(), 'event': 'remove_reply_lost_target_absent',
                            'workload_id': target['id'],
                        })
                        self._save(journal_path, journal)
                    else:
                        journal.update(status='uncertain',
                                       reason='remove_reply_lost_target_still_visible',
                                       remove_error_type=type(remove_error).__name__)
                        self._save(journal_path, journal)
                        raise UncertainExecution(
                            'remove reply was lost and target remains; do not replay') from None
                else:
                    after_remove = self.api.get_workload(target['id'])
                    if after_remove is not None:
                        journal.update(status='uncertain', reason='removed_target_still_visible')
                        self._save(journal_path, journal)
                        raise UncertainExecution('removed target remains visible; do not replay')
                    journal['removed_ids'].append(target['id'])
                    journal.setdefault('events', []).append({
                        'at': _now(), 'event': 'exact_target_absent',
                        'workload_id': target['id'],
                    })
                    self._save(journal_path, journal)

                self._stage(journal_path, journal, 'post_remove_audit')
                after = self.api.snapshot()
                removed_ids = set(journal['removed_ids'])
                expected_ids = sorted(set(initial_ids) - removed_ids)
                observed_ids = sorted(row['id'] for row in after['workloads']
                                      if isinstance(row, dict) and isinstance(row.get('id'), str))
                expected_workloads = [row for row in initial_workloads
                                      if row['id'] not in removed_ids]
                observed_workloads = snapshot_binding(after).get('workloads')
                clean, summary = self._preflight(after)
                journal['last_preflight'] = summary
                if (observed_ids != expected_ids
                        or observed_workloads != expected_workloads or not clean):
                    journal.update(status='needs_review',
                                   reason='post_remove_state_or_consistency_changed')
                    self._save(journal_path, journal)
                    raise RuntimeError(
                        'post-remove state changed: workload identity or consistency changed')

            self._stage(journal_path, journal, 'final_verify')
            ready, reason, probes = self._ready_current_revision(plan)
            if not ready:
                journal.update(status='needs_review', reason=reason)
                self._save(journal_path, journal)
                raise RuntimeError('new revision failed final readiness check')
            final = self.api.snapshot()
            final_ids = sorted(row['id'] for row in final['workloads']
                               if isinstance(row, dict) and isinstance(row.get('id'), str))
            removed_ids = set(journal['removed_ids'])
            expected_final_workloads = [
                row for row in initial_workloads if row['id'] not in removed_ids]
            final_workloads = snapshot_binding(final).get('workloads')
            if any(target['id'] in final_ids for target in targets):
                journal.update(status='needs_review', reason='cleanup_target_still_visible')
                self._save(journal_path, journal)
                raise RuntimeError('a cleanup target remains visible')
            if final_workloads != expected_final_workloads:
                journal.update(status='needs_review', reason='final_workload_identity_changed')
                self._save(journal_path, journal)
                raise RuntimeError('final workload identities differ from the reviewed cleanup')
            clean, summary = self._preflight(final)
            if not clean:
                journal.update(status='needs_review', reason='final_consistency_failed',
                               last_preflight=summary)
                self._save(journal_path, journal)
                raise RuntimeError('final cluster consistency failed')
            journal.update(status='complete', stage='complete', completed_at=_now(),
                           result='older_revisions_removed_new_revision_ready',
                           new_revision_probes=probes)
            self._save(journal_path, journal)
            return journal
        except UncertainExecution:
            raise
        except BaseException as exc:
            if journal.get('status') == 'running':
                status = 'uncertain' if journal.get('removed_ids') or journal.get('stage') in REMOTE_STAGES else 'failed'
                journal.update(status=status, reason=type(exc).__name__)
                self._save(journal_path, journal)
            raise

    def reconcile(self, plan_id):
        """Read-only cleanup reconciliation; never removes or probes workloads."""
        path = self.journal_path(plan_id)
        if not path.exists() or path.is_symlink():
            raise FileNotFoundError('app cleanup journal missing')
        journal = json.loads(path.read_text())
        if journal.get('status') == 'complete':
            return journal
        observations = []
        for target in journal.get('targets', []):
            workload_id = target.get('id') if isinstance(target, dict) else None
            try:
                row = self.api.get_workload(workload_id)
                observations.append({
                    'workload_id': workload_id,
                    'state': 'absent' if row is None else
                             ('matches_target' if self._target_matches(
                                 row, target, journal['logical_app']) else 'identity_mismatch'),
                })
            except Exception as exc:
                observations.append({'workload_id': workload_id,
                                     'state': 'query_error',
                                     'error_type': type(exc).__name__})
        journal['reconciliation'] = {
            'at': _now(), 'read_only': True, 'remove_replayed': False,
            'targets': observations,
        }
        journal.update(status='needs_review', stage='reconciled_read_only')
        self._save(path, journal)
        return journal

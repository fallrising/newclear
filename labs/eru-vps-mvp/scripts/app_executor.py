"""Hash-bound executor state machine for ERU-012 app revisions.

The executor depends on a narrow API adapter and is fully testable offline.
The adapter is responsible for the existing Eru CLI/SSH calls; this module
never retries a create after an uncertain reply and never removes old revisions.
"""
from datetime import datetime, timezone
import re
import uuid

from app_desired import build_plan, canonical_bytes, sha256, snapshot_binding, spec_identity
from labops import ClusterLock, atomic_json

PLAN_ID = re.compile(r'^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$')
REMOTE_STAGES = {'deploy_intent', 'deploy_reply_lost', 'verify_revision', 'probe'}


class UncertainExecution(RuntimeError):
    """The remote create may have happened; inspect state and create a fresh plan."""


def plan_digest(plan):
    unsigned = dict(plan)
    unsigned.pop('plan_sha256', None)
    return sha256(canonical_bytes(unsigned))


def execution_plan(document, snapshot, health_ok, consistency_issues=(), plan_id=None):
    """Upgrade a review plan into an executable, health-bound local plan."""
    if (not isinstance(consistency_issues, (list, tuple))
            or any(not isinstance(issue, str) or not issue for issue in consistency_issues)):
        raise ValueError('consistency_issues must be a list of nonempty strings')
    plan = build_plan(document, snapshot)
    reviewed_hash = plan.pop('plan_sha256')
    plan_id = plan_id or (datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ-')
                          + uuid.uuid4().hex[:8])
    if not isinstance(plan_id, str) or not PLAN_ID.fullmatch(plan_id):
        raise ValueError('invalid app plan ID')
    issues = list(consistency_issues)
    if health_ok is not True:
        plan['blockers'].append('live control-plane health preflight failed')
    plan['blockers'].extend('cluster consistency preflight: ' + issue for issue in issues)
    plan['blockers'] = sorted(set(plan['blockers']))
    plan.update({
        'id': plan_id,
        'review_plan_sha256': reviewed_hash,
        'snapshot': snapshot_binding(snapshot),
        'preflight': {'source': 'caller_supplied', 'health_ok': health_ok is True,
                      'consistency_issues': issues},
        'decision': 'blocked' if plan['blockers'] else 'ready',
        'executable': not plan['blockers'] and plan['action'] in ('deploy_revision', 'no_op'),
        'execution_implemented': True,
        'capacity_admission': 'authoritative check is performed by Eru core during create',
        'checks_not_performed': [
            'predictive resource fit; authoritative quota admission is performed by Eru core',
            'external service discovery or load-balancer cutover; v1 probes each worker directly',
        ],
    })
    plan['plan_sha256'] = plan_digest(plan)
    return plan


def _utc_now():
    return datetime.now(timezone.utc).isoformat()


def _safe_revision_rows(rows, plan):
    if not isinstance(rows, list) or len(rows) != plan['spec']['replicas']:
        return False, 'replica_count_mismatch', []
    expected_prefix = plan['appname'] + '_'
    seen = set()
    identifiers = []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get('id'), str):
            return False, 'malformed_workload_row', identifiers
        wid = row['id']
        labels = row.get('labels')
        if wid in seen:
            return False, 'duplicate_workload_id', identifiers
        seen.add(wid)
        if not wid.startswith(expected_prefix):
            return False, 'unexpected_workload_name', identifiers
        if row.get('nodename') != plan['spec']['node']:
            return False, 'unexpected_workload_node', identifiers
        if not isinstance(labels, dict) or labels.get('owner') != 'eru-vps-mvp':
            return False, 'unverified_workload_owner', identifiers
        if labels.get('logical_app') != plan['logical_app']:
            return False, 'logical_app_mismatch', identifiers
        if labels.get('spec_sha256') != plan['spec_sha256']:
            return False, 'spec_digest_mismatch', identifiers
        identifiers.append(wid)
    return True, None, sorted(identifiers)


class AppExecutor:
    """Execute/reconcile one plan through a narrow, injectable Eru API adapter.

    Required adapter methods:
      snapshot() -> labctl-style snapshot
      preflight(snapshot) -> {'health_ok': bool, 'consistency_issues': list[str]}
      deploy(plan) -> returns only after CLI reports completion (may lose reply)
      list_revision(appname) -> workload rows for the exact Eru appname
      probe(row, spec) -> {'status': int, 'body_match': bool}; never returns body text
    """
    def __init__(self, root, api):
        self.root = root
        self.api = api

    def run_path(self, run_id):
        if not isinstance(run_id, str) or not PLAN_ID.fullmatch(run_id):
            raise ValueError('invalid app plan ID')
        return self.root / 'runs' / (run_id + '.json')

    def _save(self, path, journal):
        journal['updated_at'] = _utc_now()
        atomic_json(path, journal)

    def _stage(self, path, journal, stage):
        journal['stage'] = stage
        journal.setdefault('events', []).append({'at': _utc_now(), 'event': stage})
        self._save(path, journal)

    def _new_journal(self, plan):
        return {
            'id': plan['id'],
            'operation': 'app-reconcile',
            'status': 'running',
            'stage': 'created',
            'started_at': _utc_now(),
            'plan_sha256': plan['plan_sha256'],
            'logical_app': plan['logical_app'],
            'appname': plan['appname'],
            'spec_sha256': plan['spec_sha256'],
            'target_node': plan['spec']['node'],
            'replicas': plan['spec']['replicas'],
            'spec': plan['spec'],
            'older_owned_revisions': plan['older_owned_revisions'],
            'older_owned_revisions_retained': [x['id'] for x in plan['older_owned_revisions']],
            'events': [],
        }

    def _verify_and_probe(self, path, journal, plan):
        self._stage(path, journal, 'verify_revision')
        rows = self.api.list_revision(plan['appname'])
        valid, reason, identifiers = _safe_revision_rows(rows, plan)
        journal['observed_workload_ids'] = identifiers
        if not valid:
            journal.update(status='uncertain', reason=reason)
            self._save(path, journal)
            raise UncertainExecution('revision listing is incomplete or mismatched; do not replay this plan')
        self._stage(path, journal, 'probe')
        probe_summaries = []
        for row in rows:
            result = self.api.probe(row, plan['spec'])
            if (not isinstance(result, dict) or isinstance(result.get('status'), bool)
                    or not isinstance(result.get('body_match'), bool)):
                journal.update(status='failed', reason='malformed_probe_result')
                self._save(path, journal)
                raise RuntimeError('HTTP probe returned an invalid result')
            status = result.get('status')
            body_match = result['body_match']
            if not isinstance(status, int):
                journal.update(status='failed', reason='malformed_probe_result')
                self._save(path, journal)
                raise RuntimeError('HTTP probe returned an invalid result')
            passed = status == plan['spec']['service']['expected_status'] and body_match
            probe_summaries.append({'workload_id': row['id'], 'http_status': status,
                                    'body_match': body_match, 'passed': passed})
            journal['probes'] = list(probe_summaries)
            self._save(path, journal)
            if not passed:
                journal.update(status='failed', reason='http_readiness_failed')
                self._save(path, journal)
                raise RuntimeError('HTTP readiness failed; keep this revision for inspection')
        journal.update(status='complete', stage='ready', completed_at=_utc_now(),
                       probes=probe_summaries, result='revision_ready_old_revisions_retained')
        self._save(path, journal)
        return journal

    def execute(self, plan, expected_sha256):
        # App creates share the existing controller-local mutation lock with
        # rebuild/reapply operations. The lock is intentionally nonblocking.
        with ClusterLock(self.root.parents[2]):
            return self._execute_locked(plan, expected_sha256)

    def _execute_locked(self, plan, expected_sha256):
        if not isinstance(plan, dict) or plan.get('plan_sha256') != plan_digest(plan):
            raise ValueError('plan hash mismatch')
        if expected_sha256 != plan['plan_sha256']:
            raise ValueError('plan hash mismatch')
        if plan.get('execution_implemented') is not True or plan.get('executable') is not True:
            raise ValueError('app plan is blocked or review-only')
        if plan.get('action') not in ('deploy_revision', 'no_op'):
            raise ValueError('unsupported app action')
        try:
            reviewed = build_plan(plan['spec'], plan['snapshot'])
            _, expected_spec_hash, expected_appname = spec_identity(plan['spec'])
        except (KeyError, TypeError, ValueError) as exc:
            raise ValueError('invalid app plan payload') from exc
        for key in ('action', 'spec_sha256', 'appname', 'snapshot_sha256',
                    'current_revision', 'older_owned_revisions'):
            if plan.get(key) != reviewed.get(key):
                raise ValueError('app plan does not match its reviewed desired-state payload')
        if (plan.get('review_plan_sha256') != reviewed.get('plan_sha256')
                or plan.get('spec_sha256') != expected_spec_hash
                or plan.get('appname') != expected_appname):
            raise ValueError('app plan identity/hash binding mismatch')
        preflight = plan.get('preflight')
        if (not isinstance(preflight, dict)
                or preflight.get('health_ok') is not True
                or not isinstance(preflight.get('consistency_issues'), list)
                or preflight.get('consistency_issues')
                or plan.get('blockers')):
            raise ValueError('app plan preflight is not clean')
        path = self.run_path(plan.get('id'))
        if path.exists() or path.is_symlink():
            raise ValueError('app run already exists; reconcile it and create a fresh plan')
        journal = self._new_journal(plan)
        self._save(path, journal)
        try:
            self._stage(path, journal, 'preflight')
            current = self.api.snapshot()
            live_preflight = self.api.preflight(current)
            if (not isinstance(live_preflight, dict)
                    or live_preflight.get('health_ok') is not True
                    or not isinstance(live_preflight.get('consistency_issues'), list)
                    or live_preflight.get('consistency_issues')):
                journal.update(status='failed', reason='live_preflight_not_clean')
                journal['preflight_recheck'] = {
                    'health_ok': isinstance(live_preflight, dict)
                                 and live_preflight.get('health_ok') is True,
                    'consistency_issue_count': (
                        len(live_preflight['consistency_issues'])
                        if isinstance(live_preflight, dict)
                        and isinstance(live_preflight.get('consistency_issues'), list)
                        else None),
                }
                self._save(path, journal)
                raise ValueError('live health/consistency preflight failed; no create attempted')
            journal['preflight_recheck'] = {
                'health_ok': True, 'consistency_issue_count': 0,
            }
            self._save(path, journal)
            if sha256(canonical_bytes(snapshot_binding(current))) != plan['snapshot_sha256']:
                journal.update(status='failed', reason='cluster_snapshot_changed')
                self._save(path, journal)
                raise ValueError('cluster snapshot changed; create a fresh app plan')
            if plan['action'] == 'deploy_revision':
                self._stage(path, journal, 'deploy_intent')
                try:
                    self.api.deploy(plan)
                    journal.setdefault('events', []).append(
                        {'at': _utc_now(), 'event': 'deploy_reply_received'})
                    self._save(path, journal)
                except Exception as exc:
                    journal.update(stage='deploy_reply_lost', deploy_error_type=type(exc).__name__)
                    journal.setdefault('events', []).append(
                        {'at': _utc_now(), 'event': 'deploy_reply_lost'})
                    self._save(path, journal)
                    try:
                        rows = self.api.list_revision(plan['appname'])
                    except Exception as reconcile_exc:
                        journal.update(status='uncertain',
                                       reconcile_error_type=type(reconcile_exc).__name__,
                                       reason='deploy_reply_lost_reconcile_unavailable')
                        self._save(path, journal)
                        raise UncertainExecution(
                            'deploy reply and read-only reconciliation are unavailable; do not retry') from None
                    valid, reason, identifiers = _safe_revision_rows(rows, plan)
                    journal['observed_workload_ids'] = identifiers
                    journal['reply_reconciliation'] = {
                        'read_only': True, 'observed_count': len(rows) if isinstance(rows, list) else None,
                        'exact_revision_observed': valid, 'reason': reason,
                    }
                    if not valid:
                        journal.update(status='uncertain', reason='deploy_reply_lost_' + str(reason))
                        self._save(path, journal)
                        raise UncertainExecution(
                            'deploy reply was lost and exact revision is not visible; do not retry') from None
                    journal.setdefault('events', []).append(
                        {'at': _utc_now(), 'event': 'created_revision_found_after_lost_reply'})
                    self._save(path, journal)
            return self._verify_and_probe(path, journal, plan)
        except UncertainExecution as exc:
            if journal.get('status') == 'running':
                journal.update(status='uncertain', reason=type(exc).__name__)
                self._save(path, journal)
            raise
        except BaseException as exc:
            if journal.get('status') == 'running':
                state = 'uncertain' if journal.get('stage') in REMOTE_STAGES else 'failed'
                journal.update(status=state, reason=type(exc).__name__)
                self._save(path, journal)
            raise

    def reconcile(self, run_id):
        """Read-only lookup after interruption; never deploy, probe, or remove."""
        with ClusterLock(self.root.parents[2]):
            return self._reconcile_locked(run_id)

    def _reconcile_locked(self, run_id):
        path = self.run_path(run_id)
        if not path.exists() or path.is_symlink():
            raise FileNotFoundError('app run journal missing')
        import json
        journal = json.loads(path.read_text())
        if journal.get('status') == 'complete':
            return journal
        try:
            rows = self.api.list_revision(journal['appname'])
            plan_stub = {
                'appname': journal['appname'],
                'logical_app': journal['logical_app'],
                'spec_sha256': journal['spec_sha256'],
                'spec': {'node': journal['target_node'], 'replicas': journal['replicas']},
            }
            valid, reason, identifiers = _safe_revision_rows(rows, plan_stub)
            journal['reconciliation'] = {
                'at': _utc_now(), 'read_only': True, 'deploy_replayed': False,
                'observed_count': len(rows) if isinstance(rows, list) else None,
                'exact_revision_observed': valid, 'reason': reason,
                'workload_ids': identifiers,
            }
        except Exception as exc:
            journal['reconciliation'] = {
                'at': _utc_now(), 'read_only': True, 'deploy_replayed': False,
                'error_type': type(exc).__name__,
            }
        journal.update(status='needs_review', stage='reconciled_read_only')
        self._save(path, journal)
        return journal

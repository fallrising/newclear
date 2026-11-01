"""Read-only assessment of operator-supplied four-host console attestations.

Historical preparation is revalidated at its creation time; no expired authority
or writer-fence evidence is renewed. A successful assessment admits no stage.
"""
from datetime import datetime, timezone
import os
import fresh_run_authority as authority
import subprocess

from fresh_execution import exact, identifier, sha256, timestamp
from fresh_execution_ops import AREA, PrivateFiles, _record, _review
from fresh_rebuild import plan_digest
from fresh_reimage_receipts import validate_receipts
import pending_generation


def _complete_run(files, run_id):
    run = files.directory(files.parts(AREA) + (run_id,))
    try:
        if os.listdir(run) != ['execution.json']:
            raise ValueError('fresh preparation publication incomplete')
    finally:
        os.close(run)


def _pending_matches(pending, record, execution_sha, identity):
    if pending['status'] == 'absent':
        return True
    if pending['status'] != 'pending':
        return False
    binding = record['binding']
    expected = {key: binding[key] for key in (
        'cluster_id', 'run_id', 'generation_before', 'target_generation',
        'review_sha256', 'scope_sha256')}
    expected.update(execution_sha256=execution_sha,
                    cluster_sha256=record['cluster_sha256'],
                    fence_sha256=record['evidence']['writer_fence']['sha256'])
    reservation = pending['reservation']
    return (plan_digest(reservation['bindings']) == plan_digest(expected)
            and reservation['private_identity'] == identity)


@authority.operation
def inspect_receipts(project, run_id, execution_sha, input_file, *, now=None, source_state=None):
    """Assess all four receipts locally; never write, connect, reserve or accept."""
    identifier(run_id)
    sha256(execution_sha)
    base = {'status': 'blocked', 'id': run_id, 'execution_sha256': execution_sha,
            'stage_accepted': False, 'executable': False,
            'remote_mutation_performed': False, 'generation_changed': False}
    files = None
    try:
        current = authority.current_time(now)
        if current.tzinfo is None or current.utcoffset() is None:
            raise ValueError('fresh receipt current time requires timezone')
        current = current.astimezone(timezone.utc)
        before = pending_generation.inspect(project)
        files = PrivateFiles(project)
        _complete_run(files, run_id)
        envelope, _, _ = files.json(AREA + '/' + run_id + '/execution.json')
        exact(envelope, {'execution', 'sha256'})
        record = envelope['execution']
        if envelope['sha256'] != execution_sha or plan_digest(record) != execution_sha:
            raise ValueError('fresh receipt execution hash mismatch')
        created = timestamp(record['created_at'])
        if created > current:
            raise ValueError('fresh receipt preparation is future')
        binding = record['binding']
        plan, source = _review(files, binding['plan_id'], binding['review_sha256'], created, source_state)
        rebuilt = _record(files, plan, binding['review_sha256'], run_id,
                          record['input']['path'], created, source)
        rebuilt['created_at'] = record['created_at']
        if plan_digest(rebuilt) != execution_sha:
            raise ValueError('fresh receipt original preparation changed')
        baseline = files.binding(record['evidence']['host_baseline'])
        document, relative, raw_sha = files.json(str(input_file))
        exact(document, {'schema_version', 'binding', 'hosts'})
        rows = document['hosts']
        if type(rows) is not list or len(rows) != 4:
            raise ValueError('fresh receipt request requires four hosts')
        actions, receipts = [], []
        for row in rows:
            exact(row, {'alias', 'node', 'action', 'receipt'})
            actions.append(files.binding(row['action']))
            receipts.append(files.binding(row['receipt']))
        validated = validate_receipts(document, actions, receipts, plan=plan,
                                      execution=envelope, baseline=baseline, now=current)
        from fresh_observation_ops import load_observation
        load_observation(files, baseline['observation'], plan, record['binding'], created)
        files.recheck()
        _complete_run(files, run_id)
        after = pending_generation.inspect(project)
        files.check()
        if before != after or not _pending_matches(after, record, execution_sha, files.identity):
            raise ValueError('fresh receipt pending linkage changed or mismatched')
        assessment = {'schema_version': 1, 'operation': 'fresh-console-receipts-assessment',
                      'input': {'path': relative, 'sha256': raw_sha}, **validated}
        return {**base, 'status': 'receipts-reviewed', 'sha256': plan_digest(assessment), 'host_count': 4}
    except (OSError, ValueError, RuntimeError, KeyError, TypeError, IndexError,
            AttributeError, RecursionError, OverflowError, subprocess.SubprocessError):
        return base
    finally:
        if files is not None:
            files.close()

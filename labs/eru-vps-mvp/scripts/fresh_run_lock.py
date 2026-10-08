"""Exclusive admission for the exact observed owner of a permanent reservation.

This coordinates one controller checkout only. It grants no live authorization,
never expires or releases pending, and never admits through an inherited lock.
"""
import json
import os
from pathlib import Path

from labops import ClusterLock, LOCK_ENV
import pending_generation as pending


def _snapshot(expected):
    """Accept a complete inspect observation, preserving exact JSON types."""
    fields = {'status', 'blocked', 'reservation', 'sha256',
              'pending_identity', 'record_identity'}
    if (type(expected) is not dict or set(expected) != fields
            or expected['status'] != 'pending' or expected['blocked'] is not True
            or type(expected['sha256']) is not str
            or not pending._HASH.fullmatch(expected['sha256'])):
        raise ValueError('fresh run requires exact pending inspection')
    value = expected['reservation']
    if (type(value) is not dict or set(value) != {
            'schema', 'operation', 'bindings', 'private_identity'}
            or type(value['schema']) is not int or value['schema'] != 1
            or value['operation'] != 'fresh-generation-reservation'):
        raise ValueError('fresh run requires exact pending reservation')
    pending._bindings(value['bindings'])
    for identity in (value['private_identity'], expected['pending_identity'],
                     expected['record_identity']):
        if (type(identity) is not list or len(identity) != 2
                or any(type(item) is not int or item < 0 for item in identity)):
            raise ValueError('fresh run requires exact pending path identity')
    return json.dumps(expected, sort_keys=True, separators=(',', ':'), allow_nan=False)


class FreshRunLock(ClusterLock):
    """Acquire independently; recheck the complete reservation at both boundaries.

    expected_pending is the complete successful pending_generation.inspect result,
    not a run ID, token or authorization. Call check_pending() at a final action
    boundary when a context contains multiple local steps.
    """
    def __init__(self, project, expected_pending):
        super().__init__(project)
        self.project = Path(project)
        self._expected = _snapshot(expected_pending)
        self._completion = None

    def __enter__(self):
        if LOCK_ENV in os.environ:
            raise RuntimeError('fresh run cannot use an inherited controller lock')
        return super().__enter__()

    def _admit(self):
        self.check_pending()

    def check_pending(self):
        """Fail closed on record, raw bytes, path or pinned backing-root drift."""
        self.check_private_root()
        if self._completion is not None:
            from fresh_run_authority import active
            owner = active()
            # The driver checks the lock after the operation decorator has
            # cleared entered. Re-enter the exact owner's current proof, which
            # calls this lock again at positive depth and checks completion.
            if (owner is not None and owner.operation == 'finalize_generation'
                    and not owner.historical and not owner.entered
                    and owner.lock is self and owner._generation_proof_depth == 0):
                return owner.check()
            from fresh_generation_ops import verify_completed
            run, digest, now, source_state = self._completion
            proof = verify_completed(self.project, run, private_fd=self.private_fd, now=now, source_state=source_state)
            if (proof['generation_sha256'] != digest or _snapshot(proof['original_pending']) != self._expected):
                raise RuntimeError('owned completion changed')
            return
        actual = pending.inspect(self.project)
        if json.dumps(actual, sort_keys=True, separators=(',', ':'), allow_nan=False) != self._expected:
            raise RuntimeError('owned pending reservation changed')
        expected = json.loads(self._expected)
        if pending._identity(os.fstat(self.private_fd)) != expected['reservation']['private_identity']:
            raise RuntimeError('controller private root changed')
        self.check_private_root()

    def accept_completion(self, run_id, generation_sha, *, now=None, source_state=None):
        """Switch exit validation only after the exact completion deeply verifies."""
        from fresh_generation_ops import verify_completed
        self.check_private_root()
        proof = verify_completed(self.project, run_id, private_fd=self.private_fd,now=now,source_state=source_state)
        if proof['generation_sha256'] != generation_sha or _snapshot(proof['original_pending']) != self._expected:
            raise RuntimeError('completion does not own this reservation')
        self._completion = (run_id,generation_sha,now,source_state)
        self.check_pending()

    def __exit__(self, *exc):
        try:
            self.check_pending()
        finally:
            super().__exit__(*exc)

import copy
import unittest
from pi_hook_evidence import CASES, verify_hook_boundary


def report(resumed=False):
    cases = CASES + ((('old_token', 401),) if resumed else ())
    return {'schema': 'lab.pi.hook-probe.v1', 'verified': True,
            'cases': [{'name': name, 'status': status, 'unchanged': True} for name, status in cases]}


class HookEvidenceTest(unittest.TestCase):
    def test_complete_start_and_rotated_token_reports(self):
        self.assertTrue(verify_hook_boundary(report()))
        self.assertTrue(verify_hook_boundary(report(True), resumed=True))
        self.assertFalse(verify_hook_boundary(report(), resumed=True))
        self.assertFalse(verify_hook_boundary(report(True)))

    def test_missing_repeated_reordered_and_extra_cases_fail(self):
        for mutate in (lambda v: v['cases'].pop(),
                       lambda v: v['cases'].append(v['cases'][0]),
                       lambda v: v['cases'].reverse(),
                       lambda v: v['cases'].__setitem__(1, v['cases'][0])):
            value = report(); mutate(value)
            self.assertFalse(verify_hook_boundary(value))

    def test_status_state_and_sensitive_fields_fail_closed(self):
        for key, replacement in [('status', 200), ('status', '401'), ('status', True),
                                  ('unchanged', False), ('unchanged', 1), ('token', 'private')]:
            value = report(); value['cases'][0][key] = replacement
            self.assertFalse(verify_hook_boundary(value))
        for key, replacement in [('verified', 1), ('verified', False), ('session', 'private'),
                                  ('schema', 'unknown'), ('cases', None)]:
            value = report(); value[key] = replacement
            self.assertFalse(verify_hook_boundary(value))
        for value in (None, [], {}, copy.copy(CASES)):
            self.assertFalse(verify_hook_boundary(value))

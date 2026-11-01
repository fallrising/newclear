"""Pure local commit order and timing contracts; no host operations."""
import unittest
from fresh_generation import classify, measured_timing


class GenerationContractTests(unittest.TestCase):
    def test_only_exact_write_prefix_can_resume(self):
        writes = [{'path': str(i), 'before_sha256': 'a' + str(i), 'after_sha256': 'b' + str(i)} for i in range(3)]
        for prefix in range(4):
            current = {str(i): ('b' if i < prefix else 'a') + str(i) for i in range(3)}
            self.assertEqual(classify(writes, current), ('before' if prefix == 0 else 'all-after' if prefix == 3 else 'prefix', prefix))
        for current in ({'0': 'a0', '1': 'b1', '2': 'a2'}, {'0': 'b0', '1': 'a1', '2': 'b2'}, {'0': 'x', '1': 'a1', '2': 'a2'}):
            with self.assertRaises(ValueError):
                classify(writes, current)

    def timing(self):
        return {'quiesced_at': '2026-10-06T00:00:00+00:00',
                'installation_started_at': '2026-10-06T00:01:00+00:00',
                'v01_completed_at': '2026-10-06T00:05:00+00:00',
                'residue_completed_at': '2026-10-06T00:06:00+00:00',
                'provider_queue_intervals': [
                    {'started_at': '2026-10-06T00:00:00+00:00', 'completed_at': '2026-10-06T00:00:40+00:00'},
                    {'started_at': '2026-10-06T00:00:20+00:00', 'completed_at': '2026-10-06T00:01:00+00:00'}],
                'no_queue_observed': False, 'total_monotonic_seconds': 360,
                'installation_monotonic_seconds': 240}

    def test_queue_union_does_not_double_count(self):
        self.assertEqual(measured_timing(self.timing()), {'total_seconds': 360, 'provider_queue_seconds': 60,
            'installation_seconds': 240, 'candidate_seconds': 1800})

    def test_unknown_queue_never_becomes_zero(self):
        for intervals in (None, []):
            value = self.timing(); value['provider_queue_intervals'] = intervals
            with self.assertRaises(ValueError):
                measured_timing(value)

    def test_explicit_observed_no_queue_can_be_zero(self):
        value = self.timing(); value.update(provider_queue_intervals=[], no_queue_observed=True)
        self.assertEqual(measured_timing(value)['provider_queue_seconds'], 0)

    def test_invalid_or_unmeasured_durations_fail(self):
        for key, item in [('total_monotonic_seconds', None), ('total_monotonic_seconds', float('nan')),
                          ('installation_monotonic_seconds', -1), ('total_monotonic_seconds', True),
                          ('quiesced_at', '2026-10-06T00:00:00'), ('v01_completed_at', '2026-10-06T00:00:00Z')]:
            value = self.timing(); value[key] = item
            with self.subTest(key=key, item=item), self.assertRaises(ValueError):
                measured_timing(value)

"""Independent acceptance checks; run with network/write denied, never import in the runner."""
import copy
import importlib.util
from pathlib import Path
import random
import sys
import unittest

candidate = Path(sys.argv.pop(1)).resolve()
spec = importlib.util.spec_from_file_location('candidate_queue', candidate)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AcceptanceTests(unittest.TestCase):
    def test_all_active_states(self):
        for state in ('starting', 'running', 'waiting_input', 'cancelling'):
            with self.subTest(state=state):
                self.assertIsNone(module.next_task([
                    dict(id='q', state='queued', created_at=-1),
                    dict(id='active', state=state, created_at=10)]))

    def test_terminal_and_unknown_states(self):
        for state in ('completed', 'failed', 'cancelled', 'interrupted', 'unknown'):
            with self.subTest(state=state):
                self.assertEqual(module.next_task([
                    dict(id='ignored', state=state, created_at=-1),
                    dict(id='q', state='queued', created_at=0)]), 'q')

    def test_empty_and_no_queued(self):
        self.assertIsNone(module.next_task([]))
        self.assertIsNone(module.next_task([dict(id='done', state='failed', created_at=0)]))

    def test_stable_ties(self):
        self.assertEqual(module.next_task([
            dict(id='z', state='queued', created_at=2),
            dict(id='a', state='queued', created_at=2)]), 'z')

    def test_random_order_and_nonmutation(self):
        rng = random.Random(67129)
        for trial in range(100):
            tasks = [dict(id=f'{trial}-{i}', state=rng.choice(['queued', 'failed', 'completed']),
                          created_at=rng.randrange(-10, 10)) for i in range(20)]
            rng.shuffle(tasks)
            before = copy.deepcopy(tasks)
            eligible = [t for t in tasks if t['state'] == 'queued']
            expected = min(eligible, key=lambda t: t['created_at'])['id'] if eligible else None
            self.assertEqual(module.next_task(tasks), expected)
            self.assertEqual(tasks, before)


if __name__ == '__main__':
    unittest.main(verbosity=2)

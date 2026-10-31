import copy
import unittest

from task_queue import next_task


class QueueTests(unittest.TestCase):
    def test_empty(self):
        self.assertIsNone(next_task([]))

    def test_oldest_queued(self):
        tasks = [dict(id='new', state='queued', created_at=9),
                 dict(id='old', state='queued', created_at=2)]
        self.assertEqual(next_task(tasks), 'old')

    def test_running_blocks_dispatch(self):
        tasks = [dict(id='queued', state='queued', created_at=0),
                 dict(id='busy', state='running', created_at=1)]
        self.assertIsNone(next_task(tasks))

    def test_terminal_is_ignored(self):
        self.assertIsNone(next_task([dict(id='done', state='completed', created_at=0)]))

    def test_does_not_mutate(self):
        tasks = [dict(id='new', state='queued', created_at=9),
                 dict(id='old', state='queued', created_at=2)]
        before = copy.deepcopy(tasks)
        next_task(tasks)
        self.assertEqual(tasks, before)


if __name__ == '__main__':
    unittest.main()

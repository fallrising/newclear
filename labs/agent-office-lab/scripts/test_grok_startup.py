import unittest
from pathlib import Path
from grok_startup import native_args
from run_grok_startup import collect_owned, alive_owned


class GrokStartupTests(unittest.TestCase):
    def setUp(self):
        self.workspace = Path('/fixture/workspace')
        self.session = '5b945e76-768e-4bcb-a770-e082d25dd7fe'
        self.args = ['--no-alt-screen', '--trust', '--leader-socket',
                     str(self.workspace / '.agent-office/grok-leader.sock'), '--session-id', self.session]
        self.socket = Path('/private/tmp/office-grok-fixture/leader.sock')

    def test_native_session_preserved_and_socket_shortened(self):
        args = native_args(self.args, self.workspace, self.socket)
        self.assertEqual(args[3], str(self.socket))
        self.assertEqual(args[5], self.session)
        self.assertNotIn('--always-approve', args)
        self.assertEqual(args[args.index('--tools') + 1], '')

    def test_prompt_resume_model_and_arbitrary_socket_rejected(self):
        for extra in [['--', 'task'], ['--resume', self.session], ['--model', 'anything']]:
            with self.assertRaises(ValueError): native_args(self.args + extra, self.workspace, self.socket)
        for index, value in [(3, '/another/socket'), (5, 'not-uuid'), (1, '--always-approve')]:
            args = self.args.copy(); args[index] = value
            with self.assertRaises(ValueError): native_args(args, self.workspace, self.socket)

    def test_cleanup_tracks_descendants_and_unique_detached_leader_only(self):
        rows = {1: (0, 'system'), 10: (1, 'office fixture'), 11: (10, 'pty'),
                12: (11, 'worker'), 13: (1, 'grok --leader-socket ' + str(self.socket)),
                14: (1, 'grok --leader-socket /other/socket')}
        owned = collect_owned(rows, {}, 10, self.socket)
        self.assertEqual(set(owned), {10, 11, 12, 13})
        rows[12] = (1, 'unrelated reused PID')
        self.assertEqual(set(alive_owned(rows, owned)), {10, 11, 13})


if __name__ == '__main__': unittest.main()

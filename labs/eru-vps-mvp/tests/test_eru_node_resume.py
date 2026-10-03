"""Offline tests for fenced, explicit worker resume after node registration."""
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from eru_node_resume import main, resume_registered_worker


CORE_IP = '100.64.0.1'
ENDPOINT = 'containerd://ckc@100.64.0.4:22'
NODE = 'worker-4'


def node(available, bypass, endpoint=ENDPOINT):
    return {'name': NODE, 'endpoint': endpoint, 'available': available, 'bypass': bypass}


class Runner:
    def __init__(self, states, up_returncode=0):
        self.states = list(states)
        self.up_returncode = up_returncode
        self.calls = []

    def __call__(self, argv, *, capture_output, text, timeout, check):
        self.calls.append(argv)
        if argv[-3:] == ['node', 'up', NODE]:
            return SimpleNamespace(returncode=self.up_returncode, stdout='', stderr='')
        if not self.states:
            raise AssertionError('unexpected extra node get')
        return SimpleNamespace(returncode=0, stdout=json.dumps(self.states.pop(0)), stderr='')


class EruNodeResumeTests(unittest.TestCase):
    def test_waits_for_agent_while_fenced_then_resumes_once_and_verifies(self):
        runner = Runner([
            [node(False, True)],
            [node(True, True)],
            [node(True, False)],
        ])
        sleeps = []
        result = resume_registered_worker(
            CORE_IP, NODE, ENDPOINT, runner=runner, sleep=sleeps.append,
            attempts=3, interval=2,
        )
        self.assertEqual(result, {
            'node': NODE, 'status': 'resumed', 'available': True, 'bypass': False,
        })
        self.assertEqual(sleeps, [2])
        self.assertEqual(len(runner.calls), 4)
        self.assertEqual(sum(call[-3:] == ['node', 'up', NODE] for call in runner.calls), 1)

    def test_refuses_a_node_that_lost_its_fence_before_readiness(self):
        runner = Runner([[node(True, False)]])
        with self.assertRaisesRegex(ValueError, 'lost its scheduling fence'):
            resume_registered_worker(CORE_IP, NODE, ENDPOINT, runner=runner, sleep=lambda _: None)
        self.assertFalse(any(call[-3:] == ['node', 'up', NODE] for call in runner.calls))

    def test_readiness_timeout_never_resumes(self):
        runner = Runner([[node(False, True)], [node(False, True)]])
        sleeps = []
        with self.assertRaisesRegex(ValueError, 'did not report ready'):
            resume_registered_worker(
                CORE_IP, NODE, ENDPOINT, runner=runner, sleep=sleeps.append,
                attempts=2, interval=1,
            )
        self.assertEqual(sleeps, [1])
        self.assertFalse(any(call[-3:] == ['node', 'up', NODE] for call in runner.calls))

    def test_endpoint_drift_blocks_resume(self):
        runner = Runner([[node(True, True, 'containerd://ckc@100.64.0.99:22')]])
        with self.assertRaisesRegex(ValueError, 'identity or endpoint differs'):
            resume_registered_worker(CORE_IP, NODE, ENDPOINT, runner=runner, sleep=lambda _: None)
        self.assertFalse(any(call[-3:] == ['node', 'up', NODE] for call in runner.calls))

    def test_uncertain_post_resume_state_is_not_retried(self):
        runner = Runner([[node(True, True)], [node(True, True)]])
        with self.assertRaisesRegex(ValueError, 'outcome is uncertain'):
            resume_registered_worker(CORE_IP, NODE, ENDPOINT, runner=runner, sleep=lambda _: None)
        self.assertEqual(sum(call[-3:] == ['node', 'up', NODE] for call in runner.calls), 1)

    def test_standalone_cli_requires_the_hash_bound_labctl_plan(self):
        with self.assertRaisesRegex(SystemExit, 'Use scripts/labctl.py resume-reimage-worker'):
            main()

    def test_scope_is_limited_to_tailnet_and_reviewed_worker_names(self):
        runner = Runner([])
        for core, name, endpoint in [
            ('192.0.2.1', NODE, ENDPOINT),
            (CORE_IP, 'worker-1', ENDPOINT),
            (CORE_IP, NODE, 'containerd://ckc@192.0.2.4:22'),
        ]:
            with self.subTest(core=core, name=name, endpoint=endpoint):
                with self.assertRaises(ValueError):
                    resume_registered_worker(core, name, endpoint, runner=runner)
        self.assertEqual(runner.calls, [])


if __name__ == '__main__':
    unittest.main()

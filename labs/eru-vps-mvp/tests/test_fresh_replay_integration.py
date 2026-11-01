"""Preparation assertions reused by the single full fresh completion mainline.

The root-owned full CLI test supplies its already verified real bootstrap and
prepared replay result. Sharing the costly prefix preserves every assertion.
"""
import fresh_replay_ops as replay
from fresh_bootstrap_host import _decode


def assert_prepared_replay(testcase,fixture,envelope,result):
    project=fixture.project; run=fixture.run
    receipt=_decode((project/'private/operations/fresh-rebuild/bootstrap'/run/'steps/step-21/receipt.json').read_bytes())
    testcase.assertEqual(result['status'],'replay-planned',result)
    review=_decode((project/envelope['plan']['context_refs']['review']).read_bytes())
    testcase.assertEqual(envelope['plan']['desired_apps'],[row['spec'] for row in review['plan']['desired_apps']])
    testcase.assertEqual(envelope['plan']['bootstrap_receipt_sha256'],receipt['sha256'])
    status=replay.inspect_replay(project,run,envelope['sha256'],now=lambda:fixture.now,source_state=fixture.source)
    testcase.assertTrue(status['historical_integrity'],status)
    testcase.assertFalse(status['current_network_ready'])
    with testcase.assertRaises(ValueError):
        replay.load_acceptance(project,run,envelope['sha256'],now=lambda:fixture.now,source_state=fixture.source)
